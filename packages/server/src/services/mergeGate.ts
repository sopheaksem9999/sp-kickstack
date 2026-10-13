import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../db/index.js';
import { BridgeTask, Project } from '@sp-kickstack/shared';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { TaskReactor } from './taskReactor.js';
import { SettingsService } from './settingsService.js';
import { BranchService } from './branchService.js';
import type { AdapterFactory } from './fanOutService.js';
import { HttpError, conflict } from '../lib/httpError.js';
import * as git from '../lib/gitRepo.js';

export type MergeOutcome =
  | { ok: true; projects: string[]; warnings: string[] }
  | { ok: false; error: string; mergedProjects: string[] };

export interface MergeGateOptions {
  /** Used to leave merge / conflict notes on engine tasks. */
  getAdapter?: AdapterFactory;
  /** Free a task's agent worktree (Local AI CLI), so its merged branch can be deleted. */
  releaseWorktree?: (taskId: number) => boolean;
  settingsService?: SettingsService;
  testTimeoutMs?: number;
  /** Limit for fetch, push, merge and worktree operations (default 2 min). */
  gitTimeoutMs?: number;
  /** Where temporary merge worktrees are created (default: the OS temp dir). */
  tmpRoot?: string;
}

/** Temp folder prefix that can never contain a path separator, whatever the names are. */
export function tempDirPrefix(reqId: string, project: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `sp-merge-${safe(reqId)}-${safe(project)}-`;
}

const DEFAULT_TEST_TIMEOUT_MS = 15 * 60 * 1000;
const READY_FOR_MERGE = ['in_review', 'done'];

class GateFailure extends Error {
  constructor(message: string, public note?: { task: BridgeTask; text: string }) {
    super(message);
  }
}

interface PreparedProject {
  project: Project;
  repo: string;
  base: string;
  remote: boolean;
  tmpDir: string;
  worktree: string;
  startSha: string;
  resultSha: string;
  /** tipSha: the branch commit that was merged; it must not move before the push. */
  merges: Array<{ task: BridgeTask; tipSha: string; mergeSha: string | null }>;
}

function tail(text: string, lines: number): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n');
}

/**
 * Merges a requirement's task branches into each project's base branch, all-or-nothing:
 * phase 1 prepares every project in a temporary worktree (merges + project tests) without
 * touching any branch; phase 2 pushes and fast-forwards only when every project passed.
 */
export class MergeGateService {
  private settings: SettingsService;
  private branches: BranchService;
  private repoLocks = new Map<string, Promise<void>>();

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private requirementService: RequirementService,
    private reactor: TaskReactor,
    private options: MergeGateOptions = {}
  ) {
    this.settings = options.settingsService ?? new SettingsService(db);
    this.branches = new BranchService(db, projectService, this.settings);
  }

  /** True when the requirement has branched work that has not been merged yet. */
  public needsMerge(reqId: string): boolean {
    return Boolean(
      this.db
        .prepare(`
          SELECT 1 FROM bridge_tasks
          WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'
            AND branch IS NOT NULL AND merged_at IS NULL
          LIMIT 1
        `)
        .get(reqId)
    );
  }

  /** Validate and start a merge in the background. Throws 404/409 when it cannot start. */
  public start(reqId: string, trigger: 'manual' | 'auto'): { done: Promise<MergeOutcome> } {
    const req = this.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
    if (req.status !== 'in_review') {
      throw conflict(`${reqId} is ${req.status}; only a requirement in review can be merged and moved to QA`);
    }

    const work = this.db
      .prepare("SELECT status FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'")
      .all(reqId) as Array<{ status: string }>;
    const open = work.filter((t) => !READY_FOR_MERGE.includes(t.status));
    if (open.length > 0) throw conflict(`${open.length} task(s) of ${reqId} are not in review yet`);
    if (!this.needsMerge(reqId)) throw conflict(`${reqId} has no unmerged branches`);

    const claimed = this.db
      .prepare(`
        UPDATE requirements SET merge_state = 'running', merge_error = NULL, updated_at = datetime('now')
        WHERE id = ? AND COALESCE(merge_state, 'idle') IN ('idle', 'failed')
      `)
      .run(reqId);
    if (claimed.changes !== 1) throw conflict(`${reqId} is already being merged`);

    this.reactor.recordEvent('merge_started', reqId, undefined, { reqId, trigger });
    return { done: this.run(reqId) };
  }

  /** Auto-merge policy: start as soon as all work is in review; "not ready" is not an error. */
  public autoStart(reqId: string): void {
    if (this.branches.policyFor(reqId) !== 'auto_merge' || !this.needsMerge(reqId)) return;
    try {
      void this.start(reqId, 'auto').done;
    } catch {
      // Not ready yet, or already merging.
    }
  }

  /** A merge cannot survive a restart; let the operator start it again. */
  public resetInterrupted(): number {
    return this.db
      .prepare(`
        UPDATE requirements SET merge_state = 'failed', merge_error = 'Interrupted by a restart; start the merge again'
        WHERE merge_state = 'running'
      `)
      .run().changes;
  }

  private async run(reqId: string): Promise<MergeOutcome> {
    const mergedProjects: string[] = [];
    const prepared: PreparedProject[] = [];
    const groups = this.pendingByProject(reqId);
    const projectNames = [...groups.keys()].sort();
    const repos = projectNames.map((name) => this.projectService.getProject(name)?.repo_path ?? name);

    try {
      return await this.withRepoLocks(repos, async () => {
        for (const name of projectNames) {
          prepared.push(await this.prepare(reqId, name, groups.get(name)!));
        }
        // Phase 1 can take minutes (tests). Nothing is pushed unless everything still holds.
        this.revalidate(reqId, prepared);

        const warnings: string[] = [];
        for (const p of prepared) {
          for (const m of p.merges) {
            if (!m.mergeSha) warnings.push(`${p.project.name}: task #${m.task.id} (${m.task.branch}) had no new commits and was skipped`);
          }
          const warning = await this.advance(p);
          if (warning) warnings.push(`${p.project.name}: ${warning}`);
          mergedProjects.push(p.project.name);
        }
        await this.finishSuccess(reqId, prepared, warnings);
        return { ok: true as const, projects: mergedProjects, warnings };
      });
    } catch (err) {
      try {
        return await this.finishFailure(reqId, err, mergedProjects);
      } catch (inner: any) {
        // Even recording the failure failed (e.g. database closed): never reject from a background run.
        console.warn(`[merge] ${reqId}: could not record the merge failure: ${inner?.message || inner}`);
        return { ok: false, error: String((err as Error)?.message || err), mergedProjects };
      }
    } finally {
      for (const p of prepared) this.cleanup(p.repo, p.worktree, p.tmpDir);
    }
  }

  /** Unmerged branched goal/ticket tasks per project, dependencies before dependents. */
  private pendingByProject(reqId: string): Map<string, BridgeTask[]> {
    const tasks = this.db
      .prepare(`
        SELECT * FROM bridge_tasks
        WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'
          AND branch IS NOT NULL AND merged_at IS NULL
        ORDER BY id
      `)
      .all(reqId) as BridgeTask[];
    const ids = new Set(tasks.map((t) => t.id));
    const links = this.db.prepare('SELECT task_id, depends_on_id FROM links').all() as Array<{
      task_id: number;
      depends_on_id: number;
    }>;
    const dependsOn = new Map<number, number[]>();
    for (const l of links) {
      if (ids.has(l.task_id) && ids.has(l.depends_on_id)) {
        dependsOn.set(l.task_id, [...(dependsOn.get(l.task_id) ?? []), l.depends_on_id]);
      }
    }

    const ordered: BridgeTask[] = [];
    const placed = new Set<number>();
    while (ordered.length < tasks.length) {
      const next =
        tasks.find((t) => !placed.has(t.id) && (dependsOn.get(t.id) ?? []).every((d) => placed.has(d))) ??
        tasks.find((t) => !placed.has(t.id))!; // cycle guard: fall back to id order
      ordered.push(next);
      placed.add(next.id);
    }

    const groups = new Map<string, BridgeTask[]>();
    for (const t of ordered) groups.set(t.project, [...(groups.get(t.project) ?? []), t]);
    return groups;
  }

  /** Phase 1: merge every branch in a temporary worktree and run the tests. Touches no branch. */
  private async prepare(reqId: string, name: string, tasks: BridgeTask[]): Promise<PreparedProject> {
    const project = this.projectService.getProject(name);
    if (!project) throw new GateFailure(`${name}: project not found`);
    const repo = project.repo_path;
    const base = this.branches.baseBranchFor(project, reqId);
    const remote = false; // Strictly local merge: never fetch or push to origin

    const gitTimeout = this.options.gitTimeoutMs;
    let startSha = git.resolveCommit(repo, `refs/heads/${base}`);
    if (!startSha) {
      // Fallback: check remote ref if local branch has not been created yet
      const remoteRef = git.resolveCommit(repo, `refs/remotes/origin/${base}`);
      if (remoteRef) {
        git.createBranch(repo, base, remoteRef);
        startSha = remoteRef;
      }
    }
    if (!startSha) throw new GateFailure(`${name}: base branch ${base} was not found`);

    const checkout = git.checkoutPathOf(repo, base);
    if (checkout && !git.isClean(checkout)) {
      throw new GateFailure(
        `${name}: ${checkout} has uncommitted changes on ${base}; commit or stash them, then merge again`
      );
    }

    const tmpRoot = this.options.tmpRoot ?? os.tmpdir();
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(tmpRoot, tempDirPrefix(reqId, name)));
    const worktree = path.join(tmpDir, 'wt');
    await git.addDetachedWorktree(repo, worktree, startSha, gitTimeout);

    try {
      const merges: PreparedProject['merges'] = [];
      for (const task of tasks) {
        const branch = task.branch!;
        const tipSha = git.resolveCommit(repo, `refs/heads/${branch}`);
        if (!tipSha) {
          throw new GateFailure(`${name}: branch ${branch} (task #${task.id}) does not exist`);
        }
        if (git.commitsAhead(worktree, 'HEAD', tipSha) === 0) {
          merges.push({ task, tipSha, mergeSha: null }); // nothing to merge
          continue;
        }
        const result = await git.mergeNoFf(worktree, tipSha, `Merge ${reqId} task-${task.id}: ${task.title}`, gitTimeout);
        if (!result.ok) {
          const files = result.conflicts.length ? ` in ${result.conflicts.join(', ')}` : '';
          throw new GateFailure(`${name}: merging ${branch} (task #${task.id}) into ${base} conflicts${files}`, {
            task,
            text: `## Merge conflict\nMerging \`${branch}\` into \`${base}\` conflicts${files}. Rebase your branch onto \`${base}\`, resolve the conflicts, commit, and report back for review.`,
          });
        }
        merges.push({ task, tipSha, mergeSha: result.sha });
      }

      if (project.test_command) {
        const timeout = this.options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
        const run = await git.runShell(worktree, project.test_command, timeout);
        if (run.code !== 0) {
          throw new GateFailure(`${name}: tests failed (exit ${run.code})\n${tail(run.output, 50)}`);
        }
      }

      const resultSha = git.resolveCommit(worktree, 'HEAD')!;
      return { project, repo, base, remote, tmpDir, worktree, startSha, resultSha, merges };
    } catch (err) {
      this.cleanup(repo, worktree, tmpDir);
      throw err;
    }
  }

  /**
   * Before anything is pushed: the requirement must still be in review, every task still in
   * review/done, and every branch still at the commit that was merged and tested.
   */
  private revalidate(reqId: string, prepared: PreparedProject[]) {
    const status = this.requirementService.getRequirement(reqId)?.status;
    if (status !== 'in_review') {
      throw new GateFailure(`${reqId} changed to ${status} during the merge; nothing was pushed`);
    }
    for (const p of prepared) {
      for (const m of p.merges) {
        const row = this.db.prepare('SELECT status FROM bridge_tasks WHERE id = ?').get(m.task.id) as
          | { status: string }
          | undefined;
        if (!row || !READY_FOR_MERGE.includes(row.status)) {
          throw new GateFailure(`task #${m.task.id} went back to ${row?.status ?? 'missing'} during the merge; nothing was pushed`);
        }
        if (git.resolveCommit(p.repo, `refs/heads/${m.task.branch}`) !== m.tipSha) {
          throw new GateFailure(`${p.project.name}: branch ${m.task.branch} changed during the merge (new commits); nothing was pushed — merge again`);
        }
      }
    }
  }

  /**
   * Phase 2 for one project: fast-forward the local base branch (strictly local merge, never pushes to origin).
   */
  private async advance(p: PreparedProject): Promise<string | undefined> {
    if (p.resultSha === p.startSha) {
      this.recordMerged(p); // every branch was empty: handled, nothing to advance
      return undefined;
    }

    const ff = git.fastForwardBranch(p.repo, p.base, p.resultSha);
    if (!ff.advanced) {
      throw new GateFailure(`${p.project.name}: could not advance ${p.base}: ${ff.warning}`);
    }
    this.recordMerged(p);
    return ff.warning;
  }

  private recordMerged(p: PreparedProject) {
    const now = new Date().toISOString();
    const update = this.db.prepare('UPDATE bridge_tasks SET merge_sha = ?, merged_at = ?, updated_at = ? WHERE id = ?');
    for (const m of p.merges) update.run(m.mergeSha, now, now, m.task.id);
  }

  private async finishSuccess(reqId: string, prepared: PreparedProject[], warnings: string[]) {
    // QA first: it is operator-owned, so the task completions below cannot recompute it away.
    const movedToQa = this.db
      .prepare("UPDATE requirements SET status = 'qa', updated_at = datetime('now') WHERE id = ? AND status = 'in_review'")
      .run(reqId).changes === 1;
    if (!movedToQa) warnings.push(`${reqId} changed status during the merge; it was left as it is`);

    const merged = this.db
      .prepare(`
        SELECT * FROM bridge_tasks
        WHERE req_id = ? AND role IN ('goal', 'ticket') AND merged_at IS NOT NULL AND status = 'in_review'
      `)
      .all(reqId) as BridgeTask[];
    for (const task of merged) {
      const updated = this.db
        .prepare('UPDATE bridge_tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run('done', new Date().toISOString(), task.id, task.status);
      if (updated.changes === 1) {
        await this.reactor.onTaskStatusChanged(task, task.status, 'done', 'manual');
      }
    }

    const deleteBranches = this.settings.getBranchMergeSettings().auto_delete_branch;
    for (const p of prepared) {
      for (const m of p.merges) {
        const sha = m.mergeSha ? m.mergeSha.slice(0, 7) : 'no changes';
        await this.note(
          m.task,
          m.mergeSha
            ? `## Merged into \`${p.base}\`\nYour branch \`${m.task.branch}\` was merged at ${sha}.`
            : `## Merged into \`${p.base}\`\nYour branch \`${m.task.branch}\` had no new commits, so nothing changed.`
        );
        if (deleteBranches) {
          this.options.releaseWorktree?.(m.task.id);
          git.deleteMergedBranch(p.repo, m.task.branch!, p.resultSha);
        }
      }
    }

    this.reactor.recordEvent('merge_succeeded', reqId, undefined, {
      reqId,
      projects: prepared.map((p) => p.project.name),
      warnings,
    });
    // Last: "not running" must mean every side effect above has happened.
    this.db.prepare("UPDATE requirements SET merge_state = 'idle', merge_error = NULL WHERE id = ?").run(reqId);
  }

  private async finishFailure(reqId: string, err: unknown, mergedProjects: string[]): Promise<MergeOutcome> {
    const base = err instanceof GateFailure ? err.message : `Merge failed: ${(err as Error)?.message || err}`;
    const error = mergedProjects.length
      ? `${base}\nAlready merged and pushed: ${mergedProjects.join(', ')}. Starting the merge again merges only the rest.`
      : base;

    if (err instanceof GateFailure && err.note) await this.note(err.note.task, err.note.text);
    this.reactor.recordEvent('merge_failed', reqId, undefined, { reqId, error, mergedProjects });
    // Last, for the same reason as on success.
    this.db.prepare("UPDATE requirements SET merge_state = 'failed', merge_error = ? WHERE id = ?").run(error, reqId);
    return { ok: false, error, mergedProjects };
  }

  private async note(task: BridgeTask, text: string) {
    if (!task.engine_task_id || !this.options.getAdapter) return;
    try {
      await this.options.getAdapter(task.project).appendNote(task.engine_task_id, text);
    } catch {
      // Notes are informational; the merge result is already recorded.
    }
  }

  private cleanup(repo: string, worktree: string, tmpDir: string) {
    git.removeWorktree(repo, worktree);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  /** Serialize gates per repository; locks are taken synchronously so callers queue in order. */
  private async withRepoLocks<T>(repos: string[], fn: () => Promise<T>): Promise<T> {
    const keys = [...new Set(repos)].sort();
    const previous = keys.map((k) => this.repoLocks.get(k) ?? Promise.resolve());
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const k of keys) this.repoLocks.set(k, mine);
    try {
      await Promise.all(previous);
      return await fn();
    } finally {
      release();
      for (const k of keys) {
        if (this.repoLocks.get(k) === mine) this.repoLocks.delete(k);
      }
    }
  }
}
