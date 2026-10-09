import { AppDatabase } from '../db/index.js';
import { AdapterFactory } from './fanOutService.js';
import { ProjectService } from './projectService.js';
import { Link, LinkState, BridgeTask } from '@sp-kickstack/shared';
import { wrapUntrusted } from '../lib/promptSafety.js';

export class LinkService {
  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private getAdapter: AdapterFactory
  ) {}

  public wouldCreateCycle(taskId: number, dependsOnId: number): boolean {
    if (taskId === dependsOnId) return true;

    // Check if there is already a path from dependsOnId to taskId
    const row = this.db
      .prepare(`
        WITH RECURSIVE reachable(id) AS (
          SELECT depends_on_id FROM links WHERE task_id = ?
          UNION
          SELECT l.depends_on_id FROM links l JOIN reachable r ON l.task_id = r.id
        )
        SELECT 1 FROM reachable WHERE id = ? LIMIT 1
      `)
      .get(dependsOnId, taskId);

    return Boolean(row);
  }

  public createLink(taskId: number, dependsOnId: number, placeholderId?: number | null): Link {
    if (this.wouldCreateCycle(taskId, dependsOnId)) {
      throw new Error(`Cannot link task ${taskId} to ${dependsOnId}: creates a cyclic dependency`);
    }

    const now = new Date().toISOString();
    const info = this.db
      .prepare(`
        INSERT INTO links (task_id, depends_on_id, placeholder_id, state, created_at)
        VALUES (?, ?, ?, 'waiting', ?)
      `)
      .run(taskId, dependsOnId, placeholderId || null, now);

    return this.getLink(Number(info.lastInsertRowid))!;
  }

  public getLink(id: number): Link | null {
    return (this.db.prepare('SELECT * FROM links WHERE id = ?').get(id) as Link) || null;
  }

  public getLinksForTask(taskId: number): Link[] {
    return this.db.prepare('SELECT * FROM links WHERE task_id = ?').all(taskId) as Link[];
  }

  public getDependents(dependsOnId: number): Link[] {
    return this.db.prepare('SELECT * FROM links WHERE depends_on_id = ?').all(dependsOnId) as Link[];
  }

  public formatUpstreamContext(
    ticketTask: BridgeTask,
    targetProjectName: string,
    contractPath?: string,
    baseBranch: string = 'main'
  ): string {
    const summaryBlock = ticketTask.body_md
      ? wrapUntrusted('summary', ticketTask.title)
      : 'Ticket resolved.';

    const contractBlock = contractPath
      ? `Contract file: ${contractPath} (now on ${baseBranch}). Regenerate clients/types if applicable, then finish remaining plan steps.`
      : 'Finish remaining implementation steps and run tests.';

    return `## Update: dependency complete
Ticket #${ticketTask.id} to ${targetProjectName} is done (${ticketTask.pr_url || 'merged'}).
Summary from ${targetProjectName}:
${summaryBlock}
${contractBlock}
`;
  }

  public async evaluateDependencyResolved(dependsOnId: number): Promise<Link[]> {
    const dependencyTask = this.db
      .prepare('SELECT * FROM bridge_tasks WHERE id = ?')
      .get(dependsOnId) as BridgeTask;

    if (!dependencyTask) return [];

    const links = this.getDependents(dependsOnId);
    const releasedLinks: Link[] = [];

    for (const link of links) {
      if (link.state !== 'waiting') continue;

      const waitingTask = this.db
        .prepare('SELECT * FROM bridge_tasks WHERE id = ?')
        .get(link.task_id) as BridgeTask;

      if (!waitingTask) continue;

      const targetProject = this.projectService.getProject(dependencyTask.project);
      const upstreamContext = this.formatUpstreamContext(
        dependencyTask,
        dependencyTask.project,
        targetProject?.contract_path || undefined,
        targetProject?.base_branch
      );

      const sourceAdapter = this.getAdapter(waitingTask.project);

      // Release hold on the source engine task or placeholder
      const taskToRelease = link.placeholder_id
        ? (this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(link.placeholder_id) as BridgeTask)
        : waitingTask;

      if (taskToRelease && taskToRelease.engine_task_id) {
        try {
          await sourceAdapter.releaseTask(taskToRelease.engine_task_id, upstreamContext);
        } catch (err) {
          // If release fails, mark link error
          this.db.prepare("UPDATE links SET state = 'error' WHERE id = ?").run(link.id);
          continue;
        }
      }

      const now = new Date().toISOString();
      this.db
        .prepare(`
          UPDATE links SET state = 'released', context_md = ?, released_at = ? WHERE id = ?
        `)
        .run(upstreamContext, now, link.id);

      // Update waiting task status back to queued/running
      this.db
        .prepare(`
          UPDATE bridge_tasks SET status = 'queued', updated_at = ? WHERE id = ?
        `)
        .run(now, waitingTask.id);

      releasedLinks.push(this.getLink(link.id)!);
    }

    return releasedLinks;
  }
}
