import { AppDatabase } from '../db/index.js';
import { AdapterFactory } from './fanOutService.js';
import { ProjectService } from './projectService.js';
import { Link, LinkState, BridgeTask } from '@sp-kickstack/shared';
import { wrapUntrusted } from '../lib/promptSafety.js';
import { BranchService } from './branchService.js';

export class LinkService {
  private branches: BranchService;

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private getAdapter: AdapterFactory,
    branches?: BranchService
  ) {
    this.branches = branches ?? new BranchService(db, projectService);
  }

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
    baseBranch: string = 'main',
    repoPath?: string
  ): string {
    const summaryBlock = ticketTask.body_md
      ? wrapUntrusted('summary', ticketTask.title)
      : 'Ticket resolved.';

    // Branch mode: the dependency is complete on its own branch but not merged until QA.
    const unmergedBranch = ticketTask.branch && !ticketTask.merged_at ? ticketTask.branch : null;
    const location = unmergedBranch
      ? `Its work is on branch \`${unmergedBranch}\` (not merged yet; the bridge merges both branches into ${baseBranch} at QA).`
      : null;

    const contractBlock = contractPath
      ? location
        ? `${location} Read the contract there: \`git ${repoPath ? `-C ${repoPath} ` : ''}show ${unmergedBranch}:${contractPath}\`. Regenerate clients/types if applicable, then finish remaining plan steps.`
        : `Contract file: ${contractPath} (now on ${baseBranch}). Regenerate clients/types if applicable, then finish remaining plan steps.`
      : location
        ? `${location} Finish remaining implementation steps and run tests.`
        : 'Finish remaining implementation steps and run tests.';

    const state = location ? `ready for review on ${unmergedBranch}` : `done (${ticketTask.pr_url || 'merged'})`;
    return `## Update: dependency complete
Ticket #${ticketTask.id} to ${targetProjectName} is ${state}.
Summary from ${targetProjectName}:
${summaryBlock}
${contractBlock}
`;
  }

  /**
   * A dependency task finished: mark each link waiting on it `ready` and release every
   * source task that has no other `waiting` link left. Sources still blocked by another
   * dependency get the upstream context as a note and stay held.
   */
  public async evaluateDependencyResolved(dependsOnId: number): Promise<Link[]> {
    const dependencyTask = this.db
      .prepare('SELECT * FROM bridge_tasks WHERE id = ?')
      .get(dependsOnId) as BridgeTask;

    if (!dependencyTask) return [];

    const targetProject = this.projectService.getProject(dependencyTask.project);
    const upstreamContext = this.formatUpstreamContext(
      dependencyTask,
      dependencyTask.project,
      targetProject?.contract_path || undefined,
      targetProject ? this.branches.baseBranchFor(targetProject, dependencyTask.req_id) : undefined,
      targetProject?.repo_path
    );

    const releasedLinks: Link[] = [];

    for (const link of this.getDependents(dependsOnId)) {
      // Claim the link synchronously so concurrent callers handle it once.
      const claimed = this.db
        .prepare("UPDATE links SET state = 'ready', context_md = ? WHERE id = ? AND state = 'waiting'")
        .run(upstreamContext, link.id);
      if (claimed.changes !== 1) continue;

      const stillWaiting = (
        this.db
          .prepare("SELECT COUNT(*) AS c FROM links WHERE task_id = ? AND state = 'waiting'")
          .get(link.task_id) as { c: number }
      ).c;

      if (stillWaiting > 0) {
        await this.appendNoteToSource(link.task_id, upstreamContext);
        continue;
      }

      releasedLinks.push(...(await this.releaseSourceIfUnblocked(link.task_id)));
    }

    return releasedLinks;
  }

  private releasing = new Set<number>();

  /**
   * Release a held source task once none of its links are `waiting` and at least one is
   * `ready` (or the operator removed its last dependency, passing `extraContext`): one
   * engine release carrying every upstream context, then links -> released, placeholders
   * -> done, source -> queued. On engine failure links -> error (retryable).
   */
  public async releaseSourceIfUnblocked(sourceTaskId: number, extraContext?: string): Promise<Link[]> {
    if (this.releasing.has(sourceTaskId)) return [];

    const waiting = this.db
      .prepare("SELECT COUNT(*) AS c FROM links WHERE task_id = ? AND state = 'waiting'")
      .get(sourceTaskId) as { c: number };
    const ready = this.db
      .prepare("SELECT * FROM links WHERE task_id = ? AND state = 'ready' ORDER BY id")
      .all(sourceTaskId) as Link[];
    if (waiting.c > 0) return [];

    const sourceTask = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(sourceTaskId) as BridgeTask;
    if (!sourceTask) return [];
    if (ready.length === 0 && !(extraContext && sourceTask.status === 'held')) return [];

    this.releasing.add(sourceTaskId);
    try {
      const context = [...ready.map((l) => l.context_md || ''), extraContext || '']
        .filter(Boolean)
        .join('\n\n');
      const now = new Date().toISOString();

      if (sourceTask.engine_task_id) {
        try {
          await this.getAdapter(sourceTask.project).releaseTask(sourceTask.engine_task_id, context);
        } catch (err: any) {
          this.db.prepare("UPDATE links SET state = 'error' WHERE task_id = ? AND state = 'ready'").run(sourceTaskId);
          this.db
            .prepare('UPDATE bridge_tasks SET last_error = ?, updated_at = ? WHERE id = ?')
            .run(`Release failed: ${err?.message || err}`, now, sourceTaskId);
          return [];
        }
      }

      const ids = ready.map((l) => l.id);
      const markReleased = this.db.prepare("UPDATE links SET state = 'released', released_at = ? WHERE id = ?");
      const markPlaceholderDone = this.db.prepare(
        "UPDATE bridge_tasks SET status = 'done', updated_at = ? WHERE id = ? AND role = 'waiting'"
      );
      this.db.transaction(() => {
        for (const link of ready) {
          markReleased.run(now, link.id);
          if (link.placeholder_id) markPlaceholderDone.run(now, link.placeholder_id);
        }
        this.db
          .prepare("UPDATE bridge_tasks SET status = 'queued', last_error = NULL, updated_at = ? WHERE id = ?")
          .run(now, sourceTaskId);
      })();

      return ids.map((id) => this.getLink(id)!);
    } finally {
      this.releasing.delete(sourceTaskId);
    }
  }

  /**
   * Operator "release anyway": stop waiting on this dependency (whatever its state) and
   * release the source if nothing else blocks it. Also retries a link whose release failed.
   */
  public async forceRelease(linkId: number): Promise<Link[]> {
    const link = this.getLink(linkId);
    if (!link || link.state === 'released' || link.state === 'cancelled') return [];

    this.db
      .prepare(`
        UPDATE links SET state = 'ready', context_md = COALESCE(context_md, ?)
        WHERE id = ? AND state IN ('waiting', 'error', 'ready')
      `)
      .run(
        '## Update: dependency released by operator\nThe operator released this dependency before it finished. Re-check the contract before relying on it.',
        linkId
      );
    return this.releaseSourceIfUnblocked(link.task_id);
  }

  /** Operator stops waiting on a dependency; the source resumes if nothing else blocks it. */
  public async cancelLink(linkId: number): Promise<Link[]> {
    const link = this.getLink(linkId);
    if (!link) return [];

    this.db.prepare("UPDATE links SET state = 'cancelled' WHERE id = ? AND state IN ('waiting', 'ready', 'error')").run(linkId);
    if (link.placeholder_id) {
      this.db
        .prepare("UPDATE bridge_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND role = 'waiting'")
        .run(new Date().toISOString(), link.placeholder_id);
    }
    return this.releaseSourceIfUnblocked(
      link.task_id,
      '## Update: dependency cancelled\nThe operator cancelled a dependency this task was waiting on. Continue without it and note any gaps.'
    );
  }

  private async appendNoteToSource(sourceTaskId: number, note: string) {
    const sourceTask = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(sourceTaskId) as BridgeTask;
    if (!sourceTask?.engine_task_id) return;
    try {
      await this.getAdapter(sourceTask.project).appendNote(sourceTask.engine_task_id, note);
    } catch {
      // The context is also stored on the link and re-sent with the final release.
    }
  }
}
