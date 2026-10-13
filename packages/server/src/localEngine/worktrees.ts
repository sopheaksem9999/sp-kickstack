import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkoutPathOf, isClean, isGitWorkTree, removeWorktree, runGit } from '../lib/gitRepo.js';

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** True when `dir` (or its nearest existing parent) lies inside a git work tree. */
function insideGitWorkTree(dir: string): boolean {
  let probe = path.resolve(dir);
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  try {
    return runGit(probe, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Default home of task worktrees: the server workspace, unless that lies inside a git work tree (as with
 * `npm run dev`, inside SP-Kickstack) — there SP-Kickstack's test runner and CLAUDE.md would reach the
 * agents' repositories — then `<home>/.sp-kickstack/agent-worktrees`.
 */
export function defaultWorktreeRoot(workspaceDir: string, homeDir: string = os.homedir()): string {
  return insideGitWorkTree(workspaceDir) ? path.join(homeDir, '.sp-kickstack', 'agent-worktrees') : path.join(workspaceDir, 'agent-worktrees');
}

/** Folder-safe name for a repository (never "." or "..", which would leave the worktree root). */
export function folderName(project: string): string {
  return project.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'project';
}

/** The task copies agents work in: one git worktree per task, on the task branch. */
export class AgentWorktrees {
  constructor(private root: () => string) {}

  pathFor(project: string, taskId: number): string {
    return path.join(this.root(), folderName(project), `task-${taskId}`);
  }

  /** Create the worktree for `branch` at `dir`, or reuse it. Throws an Error a person can act on. */
  ensure(repo: string, branch: string, dir: string): void {
    if (!isGitWorkTree(repo)) throw new Error(`Local AI CLI needs a git repository: ${repo} is not the top of a git work tree`);
    runGit(repo, ['worktree', 'prune']); // forget worktrees whose folder was deleted
    const checkout = checkoutPathOf(repo, branch);
    if (checkout && real(checkout) === real(dir)) return;
    if (checkout) throw new Error(`Branch ${branch} is checked out in ${checkout}; switch that checkout to another branch, then Retry`);
    if (fs.existsSync(dir)) {
      if (fs.readdirSync(dir).length > 0) throw new Error(`Folder ${dir} already exists and is not the worktree of ${branch}; move it away, then Retry`);
      fs.rmdirSync(dir);
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    runGit(repo, ['worktree', 'add', '--quiet', dir, branch]);
  }

  /** AI QA: a fresh detached checkout of `sha` at `dir`; what an earlier attempt left there is removed. */
  checkoutDetached(repo: string, sha: string, dir: string): void {
    if (!isGitWorkTree(repo)) throw new Error(`AI QA needs a git repository: ${repo} is not the top of a git work tree`);
    if (fs.existsSync(dir)) removeWorktree(repo, dir);
    runGit(repo, ['worktree', 'prune']);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    runGit(repo, ['worktree', 'add', '--quiet', '--detach', dir, sha]);
  }

  /** Remove a worktree that has no uncommitted changes. */
  removeIfClean(repo: string, dir: string): 'removed' | 'dirty' | 'missing' {
    if (!fs.existsSync(dir)) {
      try {
        runGit(repo, ['worktree', 'prune']);
      } catch {
        // The repository itself is gone.
      }
      return 'missing';
    }
    if (!isClean(dir)) return 'dirty';
    runGit(repo, ['worktree', 'remove', dir]);
    return 'removed';
  }

  /** Paths with uncommitted changes, as `git status --porcelain` lists them. */
  uncommitted(dir: string): string[] {
    try {
      return runGit(dir, ['status', '--porcelain']).split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** The repository's shared .git folder (absolute). */
  gitCommonDir(repo: string): string {
    return path.resolve(repo, runGit(repo, ['rev-parse', '--git-common-dir']).trim());
  }
}
