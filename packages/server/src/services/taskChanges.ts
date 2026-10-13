// What a task changed on its branch, against the branch it started from (base or target branch):
// the review card's "Changed files" list and one file's diff. Read straight from git, no checkout.
import type { BridgeTask, TaskChanges, TaskDiffLine, TaskFileDiff } from '@sp-kickstack/shared';
import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { BranchService } from './branchService.js';
import { HttpError, badRequest } from '../lib/httpError.js';
import { diffFile, diffSummary, isGitWorkTree, resolveCommit } from '../lib/gitRepo.js';
import { baseRef, isSafeRelativePath } from './reviewAssist.js';

/** Files listed at most; the rest is reported as truncated. */
const MAX_FILES = 300;
/** Diff lines shown at most for one file. */
const MAX_DIFF_LINES = 4000;

/** A unified diff (one file) as numbered lines; headers are dropped. */
export function parseUnifiedDiff(text: string, max = MAX_DIFF_LINES): { binary: boolean; lines: TaskDiffLine[]; truncated: boolean } {
  if (/^Binary files .* differ$/m.test(text)) return { binary: true, lines: [], truncated: false };
  const lines: TaskDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of text.split('\n')) {
    if (lines.length >= max) return { binary: false, lines, truncated: true };
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      oldLine = Number(m?.[1] ?? 0);
      newLine = Number(m?.[2] ?? 0);
      inHunk = true;
      lines.push({ type: 'hunk', text: raw });
    } else if (!inHunk) {
      continue;
    } else if (raw.startsWith('+')) {
      lines.push({ type: 'add', text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith(' ')) {
      lines.push({ type: 'context', text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return { binary: false, lines, truncated: false };
}

export class TaskChangesService {
  private projects: ProjectService;
  private branches: BranchService;

  constructor(private db: AppDatabase) {
    this.projects = new ProjectService(db);
    this.branches = new BranchService(db, this.projects);
  }

  public changes(taskId: number): TaskChanges {
    const at = this.locate(taskId);
    if (!at.from) return { branch: at.branch, base: at.base, files: [], additions: 0, deletions: 0, truncated: false };
    const all = diffSummary(at.repo, at.from, at.branch!).sort((a, b) => a.path.localeCompare(b.path));
    return {
      branch: at.branch,
      base: at.base,
      files: all.slice(0, MAX_FILES),
      additions: all.reduce((sum, f) => sum + f.additions, 0),
      deletions: all.reduce((sum, f) => sum + f.deletions, 0),
      truncated: all.length > MAX_FILES,
    };
  }

  public fileDiff(taskId: number, file: string): TaskFileDiff {
    if (!file || !isSafeRelativePath(file)) throw badRequest('The file path must be relative to the repository (no leading / and no ..)');
    const at = this.locate(taskId);
    if (!at.from) throw new HttpError(404, `Task #${taskId} has no branch to compare`);
    const entry = diffSummary(at.repo, at.from, at.branch!).find((f) => f.path === file);
    if (!entry) throw new HttpError(404, `${file} is not changed on ${at.branch}`);
    const text = diffFile(at.repo, at.from, at.branch!, entry.oldPath ? [entry.oldPath, entry.path] : [entry.path]) ?? '';
    return { path: file, ...parseUnifiedDiff(text) };
  }

  /** The task's repository, branch, base branch and the ref to compare with (null when there is nothing to compare). */
  private locate(taskId: number): { repo: string; branch: string | null; base: string | null; from: string | null } {
    const task = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as BridgeTask | undefined;
    if (!task) throw new HttpError(404, `Task #${taskId} not found`);
    const project = this.projects.getProject(task.project);
    const base = project ? this.branches.baseBranchFor(project, task.req_id) : null;
    const repo = project?.repo_path ?? '';
    const branch = task.branch ?? null;
    const usable = Boolean(repo && branch && base && isGitWorkTree(repo) && resolveCommit(repo, `refs/heads/${branch}`));
    return { repo, branch, base, from: usable ? baseRef(repo, base!) : null };
  }
}
