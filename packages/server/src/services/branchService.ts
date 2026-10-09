import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { SettingsService } from './settingsService.js';
import { BridgeTask, Project, normalizeMergePolicy } from '@sp-kickstack/shared';
import { createBranch, isGitWorkTree, resolveCommit } from '../lib/gitRepo.js';

export type EffectiveMergePolicy = 'manual_review_merge' | 'auto_merge';

export function taskBranchName(reqId: string, taskId: number): string {
  return `req/${reqId}/task-${taskId}`;
}

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

  public baseBranchFor(project: Project): string {
    return project.base_branch || this.settings.getBranchMergeSettings().default_base_branch || 'develop';
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
   * Make sure the task's branch exists (created from the base branch, or origin/<base> when
   * there is no local base). Idempotent. Returns null for tasks without a branch (non-git).
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

    const base = this.baseBranchFor(project);
    const start = resolveCommit(repo, `refs/heads/${base}`) ?? resolveCommit(repo, `refs/remotes/origin/${base}`);
    if (!start) {
      throw new Error(`Base branch "${base}" was not found in ${repo}`);
    }
    createBranch(repo, task.branch, start);
    this.recordBase(taskId, start);
    return { branch: task.branch, baseSha: start };
  }

  private recordBase(taskId: number, sha: string) {
    this.db.prepare('UPDATE bridge_tasks SET base_sha = ? WHERE id = ? AND base_sha IS NULL').run(sha, taskId);
  }
}
