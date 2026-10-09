// Git operations for task branches and the merge gate. Every call passes argv to git
// (never a shell); only runShell() executes the operator-configured test command.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';

/** Merge commits made by the bridge are attributed to it, independent of repo config. */
export const BRIDGE_GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'SP-Kickstack Bridge',
  GIT_AUTHOR_EMAIL: 'bridge@sp-kickstack.local',
  GIT_COMMITTER_NAME: 'SP-Kickstack Bridge',
  GIT_COMMITTER_EMAIL: 'bridge@sp-kickstack.local',
};

/** Run git in `repo`; throws an Error carrying git's stderr. */
export function runGit(repo: string, args: string[], env: Record<string, string> = {}): string {
  try {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err: any) {
    const detail = (err?.stderr?.toString?.() || err?.message || String(err)).trim();
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
}

function tryGit(repo: string, args: string[]): string | null {
  try {
    return runGit(repo, args);
  } catch {
    return null;
  }
}

/**
 * True only when `dir` is the top of a git work tree. A folder merely nested inside some
 * other repository must not get branches created in that parent repository.
 */
export function isGitWorkTree(dir: string): boolean {
  if (!dir || !fs.existsSync(dir)) return false;
  const top = tryGit(dir, ['rev-parse', '--show-toplevel'])?.trim();
  return Boolean(top) && fs.realpathSync(top!) === fs.realpathSync(dir);
}

/** Full commit sha for `ref`, or null when it does not exist. */
export function resolveCommit(repo: string, ref: string): string | null {
  return tryGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim() || null;
}

export function hasRemote(repo: string, remote = 'origin'): boolean {
  return (tryGit(repo, ['remote']) || '').split('\n').some((r) => r.trim() === remote);
}

export function fetchBranch(repo: string, branch: string, remote = 'origin'): void {
  runGit(repo, ['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
}

/** Create `name` at `startSha` without checking it out; no-op if it already exists. */
export function createBranch(repo: string, name: string, startSha: string): void {
  if (resolveCommit(repo, `refs/heads/${name}`)) return;
  runGit(repo, ['branch', '--', name, startSha]);
}

export function addDetachedWorktree(repo: string, dir: string, sha: string): void {
  runGit(repo, ['worktree', 'add', '--quiet', '--detach', dir, sha]);
}

/** Remove a worktree this module created; best effort, never throws. */
export function removeWorktree(repo: string, dir: string): void {
  tryGit(repo, ['worktree', 'remove', '--force', dir]);
  fs.rmSync(dir, { recursive: true, force: true });
  tryGit(repo, ['worktree', 'prune']);
}

export function commitsAhead(repo: string, from: string, to: string): number {
  return Number(runGit(repo, ['rev-list', '--count', `${from}..${to}`]).trim()) || 0;
}

export function mergeNoFf(
  worktree: string,
  branch: string,
  message: string
): { ok: true; sha: string } | { ok: false; conflicts: string[]; error: string } {
  try {
    runGit(worktree, ['merge', '--no-ff', '--no-edit', '-m', message, branch], BRIDGE_GIT_ENV);
    return { ok: true, sha: runGit(worktree, ['rev-parse', 'HEAD']).trim() };
  } catch (err: any) {
    const conflicts = (tryGit(worktree, ['diff', '--name-only', '--diff-filter=U']) || '')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    tryGit(worktree, ['merge', '--abort']);
    return { ok: false, conflicts, error: err?.message || String(err) };
  }
}

/** Push a commit to `remote`'s `branch`. Never forces: a moved remote makes this throw. */
export function pushCommit(repo: string, sha: string, branch: string, remote = 'origin'): void {
  runGit(repo, ['push', '--quiet', remote, `${sha}:refs/heads/${branch}`]);
}

export function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  return tryGit(repo, ['merge-base', '--is-ancestor', ancestor, descendant]) !== null;
}

/** Path of the worktree (main checkout included) that has `branch` checked out, if any. */
export function checkoutPathOf(repo: string, branch: string): string | null {
  const listing = tryGit(repo, ['worktree', 'list', '--porcelain']) || '';
  let current: string | null = null;
  for (const line of listing.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

export function isClean(dir: string): boolean {
  return (tryGit(dir, ['status', '--porcelain']) ?? 'unknown').trim() === '';
}

/**
 * Move local `branch` to `sha` only as a fast-forward. A checked-out branch is advanced
 * with `merge --ff-only` when its working tree is clean; otherwise it is left alone and a
 * warning explains what to run. Never touches uncommitted work.
 */
export function fastForwardBranch(repo: string, branch: string, sha: string): { advanced: boolean; warning?: string } {
  const current = resolveCommit(repo, `refs/heads/${branch}`);
  if (current === sha) return { advanced: true };
  if (current && !isAncestor(repo, current, sha)) {
    return { advanced: false, warning: `local ${branch} has commits that are not in the merge; it was left unchanged` };
  }

  const checkout = checkoutPathOf(repo, branch);
  if (!checkout) {
    runGit(repo, ['update-ref', `refs/heads/${branch}`, sha, ...(current ? [current] : [])]);
    return { advanced: true };
  }
  if (!isClean(checkout)) {
    return {
      advanced: false,
      warning: `${checkout} has uncommitted changes on ${branch}; run "git merge --ff-only ${sha.slice(0, 7)}" there when ready`,
    };
  }
  runGit(checkout, ['merge', '--ff-only', '--quiet', sha]);
  return { advanced: true };
}

/** Delete a local branch that is fully merged; best effort. */
export function deleteMergedBranch(repo: string, branch: string): void {
  tryGit(repo, ['branch', '-d', '--', branch]);
}

/** Run an operator-configured shell command (the project's test command). */
export function runShell(cwd: string, command: string, timeoutMs: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: process.env },
      (err: any, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`;
        if (!err) return resolve({ code: 0, output });
        const code = typeof err.code === 'number' ? err.code : 1;
        resolve({ code: code === 0 ? 1 : code, output: err.killed ? `${output}\n[timed out after ${timeoutMs} ms]` : output });
      }
    );
  });
}
