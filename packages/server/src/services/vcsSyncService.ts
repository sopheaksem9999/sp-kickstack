import path from 'node:path';
import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { LinkService } from './linkService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { BridgeTask } from '@sp-kickstack/shared';
import { TaskReactor } from './taskReactor.js';

export interface GitHubWebhookPayload {
  action: string;
  pull_request?: {
    html_url: string;
    number: number;
    title: string;
    body: string | null;
    state: string;
    merged: boolean;
    head: {
      ref: string;
    };
    base: {
      ref: string;
    };
  };
  repository?: {
    name: string;
    full_name: string;
  };
}

export interface VcsSyncResult {
  processed: boolean;
  action?: 'task_in_review' | 'task_merged' | 'ignored';
  taskId?: number;
  reqId?: string;
  message?: string;
}

export class VcsSyncService {
  private reactor: TaskReactor;

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private requirementService: RequirementService,
    private linkService: LinkService,
    private broadcaster: SseBroadcaster,
    reactor?: TaskReactor
  ) {
    this.reactor =
      reactor ?? new TaskReactor(db, requirementService, linkService, (evt) => broadcaster.broadcast(evt));
  }

  public async handleGitHubWebhook(
    event: string,
    payload: GitHubWebhookPayload
  ): Promise<VcsSyncResult> {
    if (event !== 'pull_request' || !payload.pull_request) {
      return { processed: false, action: 'ignored', message: `Unhandled event type: ${event}` };
    }

    const pr = payload.pull_request;
    const repoName = payload.repository?.name;
    const branch = pr.head.ref;

    const match = this.findMatchingTask(repoName, branch, pr.title, pr.html_url);
    if (!match.task) {
      return { processed: false, action: 'ignored', message: match.reason };
    }

    const task = match.task;
    const now = new Date().toISOString();

    // 1. PR Opened or Reopened -> transition to in_review
    if (payload.action === 'opened' || payload.action === 'reopened') {
      this.db
        .prepare(`
          UPDATE bridge_tasks
          SET status = 'in_review', engine_status_raw = 'needs_review', pr_url = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(pr.html_url, now, task.id);

      // Record event
      this.db
        .prepare(`
          INSERT INTO events (req_id, type, payload, at)
          VALUES (?, 'task_pr_opened', ?, ?)
        `)
        .run(
          task.req_id,
          JSON.stringify({ taskId: task.id, prUrl: pr.html_url, branch }),
          now
        );

      await this.reactor.onTaskStatusChanged(task, task.status, 'in_review', 'webhook', {
        rawStatus: 'needs_review',
        prUrl: pr.html_url,
      });

      return {
        processed: true,
        action: 'task_in_review',
        taskId: task.id,
        reqId: task.req_id,
      };
    }

    // 2. PR Merged -> transition to done and unblock dependents
    if (payload.action === 'closed' && pr.merged) {
      this.db
        .prepare(`
          UPDATE bridge_tasks
          SET status = 'done', engine_status_raw = 'merged', pr_url = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(pr.html_url, now, task.id);

      // Record event
      this.db
        .prepare(`
          INSERT INTO events (req_id, type, payload, at)
          VALUES (?, 'task_pr_merged', ?, ?)
        `)
        .run(
          task.req_id,
          JSON.stringify({ taskId: task.id, prUrl: pr.html_url, branch }),
          now
        );

      // Releases dependents and re-derives the requirement status (same path as the watcher)
      await this.reactor.onTaskStatusChanged(task, task.status, 'done', 'webhook', {
        rawStatus: 'merged',
        prUrl: pr.html_url,
      });

      return {
        processed: true,
        action: 'task_merged',
        taskId: task.id,
        reqId: task.req_id,
      };
    }

    return { processed: false, action: 'ignored', message: `PR action '${payload.action}' ignored` };
  }

  private resolveProjectName(repoName?: string): string | null {
    if (!repoName) return null;
    const projects = this.projectService.listProjects();
    const project =
      projects.find((p) => p.name === repoName) ||
      projects.find((p) => path.basename(p.repo_path) === repoName);
    return project?.name ?? null;
  }

  /**
   * Find the one active goal/ticket a pull request belongs to. Requires a registered
   * repository and an explicit REQ-### in the branch or title; among several candidates
   * prefer the task whose PR URL was recorded, then an explicit task-<id> reference.
   * Anything still ambiguous is ignored (and recorded) rather than guessed.
   */
  private findMatchingTask(
    repoName: string | undefined,
    branch: string,
    title: string,
    prUrl: string
  ): { task?: BridgeTask; reason: string } {
    const project = this.resolveProjectName(repoName);
    if (!project) return { reason: `Repository ${repoName ?? '(none)'} is not a registered project` };

    const text = `${branch} ${title}`;
    const reqMatch = text.match(/REQ-\d+/i);
    if (!reqMatch) return { reason: 'Pull request names no requirement (REQ-###) in its branch or title' };
    const reqId = reqMatch[0].toUpperCase();

    const candidates = this.db
      .prepare(`
        SELECT * FROM bridge_tasks
        WHERE req_id = ? AND project = ? AND role IN ('goal', 'ticket')
          AND status NOT IN ('done', 'cancelled', 'failed')
        ORDER BY id
      `)
      .all(reqId, project) as BridgeTask[];

    const byUrl = candidates.find((t) => t.pr_url === prUrl);
    if (byUrl) return { task: byUrl, reason: 'matched by PR URL' };

    const taskRef = text.match(/\btask[-_/#]?(\d+)\b/i);
    const byRef = taskRef ? candidates.find((t) => t.id === Number(taskRef[1])) : undefined;
    if (byRef) return { task: byRef, reason: 'matched by task reference' };

    if (candidates.length === 1) return { task: candidates[0], reason: 'single active task' };

    if (candidates.length === 0) {
      return { reason: `No active task for ${reqId} in ${project}` };
    }

    const reason = `Ambiguous: ${candidates.length} active tasks for ${reqId} in ${project}; add task-<id> to the branch or title`;
    this.db
      .prepare("INSERT INTO events (req_id, type, payload, read, at) VALUES (?, 'webhook_ignored', ?, 0, ?)")
      .run(reqId, JSON.stringify({ reason, prUrl, project, candidateTaskIds: candidates.map((t) => t.id) }), new Date().toISOString());
    return { reason };
  }
}
