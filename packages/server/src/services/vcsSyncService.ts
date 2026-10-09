import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { LinkService } from './linkService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { BridgeTask } from '@sp-kickstack/shared';

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
  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private requirementService: RequirementService,
    private linkService: LinkService,
    private broadcaster: SseBroadcaster
  ) {}

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
    const titleAndBody = `${pr.title} ${pr.body || ''}`;

    // Find candidate matching tasks in bridge_tasks
    const candidateTasks = this.findMatchingTasks(repoName, branch, titleAndBody);

    if (candidateTasks.length === 0) {
      return {
        processed: false,
        action: 'ignored',
        message: 'No matching bridge tasks found for pull request',
      };
    }

    const task = candidateTasks[0];
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

      this.broadcaster.broadcast({
        type: 'task_status_changed',
        payload: {
          taskId: task.id,
          reqId: task.req_id,
          status: 'in_review',
          prUrl: pr.html_url,
        },
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

      // Evaluate and release downstream dependents waiting on this task
      const releasedLinks = await this.linkService.evaluateDependencyResolved(task.id);

      // Check if all tasks for the requirement are done
      this.checkAndUpdateRequirementCompletion(task.req_id);

      this.broadcaster.broadcast({
        type: 'task_status_changed',
        payload: {
          taskId: task.id,
          reqId: task.req_id,
          status: 'done',
          prUrl: pr.html_url,
          releasedLinksCount: releasedLinks.length,
        },
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

  private findMatchingTasks(
    repoName?: string,
    branch?: string,
    text?: string
  ): BridgeTask[] {
    // 1. Look for explicit REQ-XXX pattern in branch or text
    const reqMatches = (branch ? branch + ' ' : '') + (text || '');
    const reqIdMatch = reqMatches.match(/REQ-\d+/i);
    const reqId = reqIdMatch ? reqIdMatch[0].toUpperCase() : null;

    let query = "SELECT * FROM bridge_tasks WHERE status != 'done'";
    const params: any[] = [];

    if (reqId) {
      query += ' AND req_id = ?';
      params.push(reqId);
    }

    if (repoName) {
      query += ' AND project = ?';
      params.push(repoName);
    }

    query += ' ORDER BY id DESC';
    const results = this.db.prepare(query).all(...params) as BridgeTask[];
    if (results.length > 0) return results;

    // Fallback: match by project alone if only one active task
    if (repoName) {
      return this.db
        .prepare("SELECT * FROM bridge_tasks WHERE project = ? AND status != 'done' ORDER BY id DESC")
        .all(repoName) as BridgeTask[];
    }

    return [];
  }

  private checkAndUpdateRequirementCompletion(reqId: string): void {
    const activeTasks = this.db
      .prepare("SELECT COUNT(*) as count FROM bridge_tasks WHERE req_id = ? AND role = 'goal' AND status != 'done'")
      .get(reqId) as { count: number };

    if (activeTasks && activeTasks.count === 0) {
      this.requirementService.updateStatus(reqId, 'done');
      this.broadcaster.broadcast({
        type: 'requirement_status_changed',
        payload: { id: reqId, status: 'done' },
      });
    }
  }
}
