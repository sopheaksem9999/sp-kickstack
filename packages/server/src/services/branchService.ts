import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { SettingsService } from './settingsService.js';
import { BridgeTask, DEFAULT_TASK_BRANCH_PATTERN, Project, normalizeMergePolicy, renderTaskBranchPattern } from '@sp-kickstack/shared';
import { createBranch, hasBranchesUnder, hasRemote, isGitWorkTree, listBranchNames, pushCommit, resolveCommit } from '../lib/gitRepo.js';
import { badRequest } from '../lib/httpError.js';
import { oneLine } from '../lib/promptSafety.js';
import { folderName } from '../localEngine/worktrees.js';

export type TaskBranchRole = 'goal' | 'ticket';

/** Pushes in flight; tests wait for them. */
const pendingPushes = new Set<Promise<void>>();
const PUSH_TIMEOUT_MS = 120_000;

export async function pushesSettled(): Promise<void> {
  while (pendingPushes.size > 0) await Promise.all([...pendingPushes]);
}

export type EffectiveMergePolicy = 'manual_review_merge' | 'auto_merge';

/** Prompt section telling the agent where to commit and who merges. */
export function branchInstructions(branch: string, base: string, policy: EffectiveMergePolicy): string {
  const when =
    policy === 'auto_merge'
      ? 'automatically, once all work for the requirement is in review and the tests pass'
      : 'after a person reviews it and moves the requirement to QA';
  return `## Your branch
- Work and commit only on \`${branch}\` (created from \`${base}\` by the bridge).
- Do not commit to \`${base}\` and do not merge anything into it; the bridge merges your branch into \`${base}\` ${when}.
- If you are told about a merge conflict, rebase your branch onto \`${base}\` and resolve it there.`;
}

/** Names and creates the per-task branches (req/<REQ-ID>/task-<id>) in project repositories. */
export class BranchService {
  private settings: SettingsService;

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    settingsService?: SettingsService
  ) {
    this.settings = settingsService ?? new SettingsService(db);
  }

  /** The repository's own base branch: its setting, else Settings → default base branch. */
  public projectBaseBranch(project: Project): string {
    return project.base_branch || this.settings.getBranchMergeSettings().default_base_branch || 'develop';
  }

  /** Where a requirement's tasks start and merge: its target branch, else the repository's base branch. */
  public baseBranchFor(project: Project, reqId?: string): string {
    const row = reqId
      ? (this.db.prepare('SELECT target_branch FROM requirements WHERE id = ?').get(reqId) as { target_branch: string | null } | undefined)
      : undefined;
    return row?.target_branch || this.projectBaseBranch(project);
  }

  /**
   * A free branch name for a task: the Settings pattern (default {req}), plus -ticket-{task} for
   * tickets, plus -2, -3… when the name is taken locally, on origin, by another task or by a branch under it.
   */
  public nameTaskBranch(project: Project, reqId: string, taskId: number, role: TaskBranchRole): string {
    const pattern = this.settings.getBranchMergeSettings().task_branch_pattern || DEFAULT_TASK_BRANCH_PATTERN;
    const stem =
      renderTaskBranchPattern(pattern, { req: reqId, task: taskId, project: folderName(project.name) }) +
      (role === 'ticket' ? `-ticket-${taskId}` : '');
    for (let n = 1; ; n++) {
      const name = n === 1 ? stem : `${stem}-${n}`;
      if (!this.branchTaken(project, name, taskId)) return name;
    }
  }

  private branchTaken(project: Project, name: string, taskId: number): boolean {
    const recorded = this.db.prepare('SELECT 1 FROM bridge_tasks WHERE project = ? AND branch = ? AND id <> ? LIMIT 1').get(project.name, name, taskId);
    if (recorded) return true;
    const repo = project.repo_path;
    if (!isGitWorkTree(repo)) return false;
    return Boolean(resolveCommit(repo, `refs/heads/${name}`) || resolveCommit(repo, `refs/remotes/origin/${name}`) || hasBranchesUnder(repo, name));
  }

  /** Branches of the chosen repositories (one workspace) and which repositories have each; task branches excluded. */
  public listBranches(projectNames: string[]): Array<{ name: string; projects: string[] }> {
    const projects = projectNames.map((name) => {
      const project = this.projectService.getProject(name);
      if (!project) throw badRequest(`Unknown repository: ${name}`);
      return project;
    });
    if (new Set(projects.map((p) => p.workspace_id || 'default')).size > 1) throw badRequest('Choose repositories of one workspace');
    const taskBranches = new Set(
      (this.db.prepare('SELECT DISTINCT branch FROM bridge_tasks WHERE branch IS NOT NULL').all() as Array<{ branch: string }>).map((r) => r.branch)
    );
    const found = new Map<string, Set<string>>();
    for (const project of projects) {
      if (!this.usesBranches(project)) continue;
      for (const name of listBranchNames(project.repo_path)) {
        if (taskBranches.has(name)) continue;
        if (!found.has(name)) found.set(name, new Set());
        found.get(name)!.add(project.name);
      }
    }
    return [...found.entries()]
      .map(([name, where]) => ({ name, projects: [...where].sort() }))
      .sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name))
      .slice(0, 200);
  }

  /** Only projects whose repo_path is the root of a git work tree get task branches. */
  public usesBranches(project: Project): boolean {
    return isGitWorkTree(project.repo_path);
  }

  /** Requirement override, else the workspace default. */
  public policyFor(reqId: string): EffectiveMergePolicy {
    const row = this.db.prepare('SELECT merge_policy FROM requirements WHERE id = ?').get(reqId) as
      | { merge_policy: string | null }
      | undefined;
    return normalizeMergePolicy(row?.merge_policy || this.settings.getBranchMergeSettings().merge_policy);
  }

  /**
   * Make sure the task's branch exists: created from the requirement's target branch (created first,
   * from the repository's base, when this repository lacks it) or from the base branch. Idempotent.
   * Returns null for tasks without a branch (non-git).
   */
  public ensureTaskBranch(taskId: number): { branch: string; baseSha: string } | null {
    const task = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as BridgeTask | undefined;
    if (!task?.branch) return null;
    const project = this.projectService.getProject(task.project);
    if (!project) throw new Error(`Project ${task.project} not found`);
    const repo = project.repo_path;

    const existing = resolveCommit(repo, `refs/heads/${task.branch}`);
    if (existing) {
      const baseSha = task.base_sha || existing;
      if (!task.base_sha) this.recordBase(taskId, baseSha);
      return { branch: task.branch, baseSha };
    }

    const created: string[] = [];
    const base = this.baseBranchFor(project, task.req_id);
    let start = resolveCommit(repo, `refs/heads/${base}`) ?? resolveCommit(repo, `refs/remotes/origin/${base}`);
    const projectBase = this.projectBaseBranch(project);
    if (!start && base !== projectBase) {
      // The requirement's target branch is new to this repository: create it from the repository's base.
      const from = resolveCommit(repo, `refs/heads/${projectBase}`) ?? resolveCommit(repo, `refs/remotes/origin/${projectBase}`);
      if (!from) throw new Error(`Base branch "${projectBase}" was not found in ${repo}`);
      createBranch(repo, base, from);
      created.push(base);
      this.recordEvent('target_branch_created', task.req_id, task.id, { reqId: task.req_id, project: project.name, branch: base, from: projectBase });
      start = from;
    }
    if (!start) {
      throw new Error(`Base branch "${base}" was not found in ${repo}`);
    }
    createBranch(repo, task.branch, start);
    created.push(task.branch);
    this.recordBase(taskId, start);
    this.afterCreate(repo, created, taskId);
    return { branch: task.branch, baseSha: start };
  }

  private afterCreate(repo: string, branches: string[], taskId: number): void {
    for (const branch of branches) this.queuePush(repo, branch, taskId);
  }

  /** Push a task's branch after it got new commits (a Local AI CLI run). */
  public pushTaskBranch(taskId: number): void {
    const task = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as BridgeTask | undefined;
    const project = task?.branch ? this.projectService.getProject(task.project) : undefined;
    if (task?.branch && project) this.queuePush(project.repo_path, task.branch, taskId);
  }

  /** Push `branch` to origin when Settings → push branches is on and origin exists. Never forced, never blocking. */
  private queuePush(repo: string, branch: string, taskId: number): void {
    if (!this.settings.getBranchMergeSettings().push_branches || !hasRemote(repo)) return;
    const sha = resolveCommit(repo, `refs/heads/${branch}`);
    if (!sha) return;
    const push: Promise<void> = pushCommit(repo, sha, branch, 'origin', PUSH_TIMEOUT_MS)
      .then(() => this.log(taskId, `↑ Pushed ${branch} to origin`))
      .catch((err) => this.log(taskId, `Could not push ${branch} to origin: ${oneLine(err?.message || String(err), 300)}`))
      .finally(() => {
        pendingPushes.delete(push);
      });
    pendingPushes.add(push);
  }

  private log(taskId: number, message: string) {
    try {
      this.db
        .prepare("INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, 'system', ?, ?)")
        .run(taskId, message, new Date().toISOString());
    } catch {
      // The database closed meanwhile (shutdown): nothing to record.
    }
  }

  private recordEvent(type: string, reqId: string, taskId: number, payload: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(reqId, taskId, type, JSON.stringify(payload), new Date().toISOString());
  }

  private recordBase(taskId: number, sha: string) {
    this.db.prepare('UPDATE bridge_tasks SET base_sha = ? WHERE id = ? AND base_sha IS NULL').run(sha, taskId);
  }
}
