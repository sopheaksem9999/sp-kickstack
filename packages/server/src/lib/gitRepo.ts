// Git operations for task branches and the merge gate. Every call passes argv to git
// (never a shell); only runShell() executes the operator-configured test command.
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

/** Merge commits made by the bridge are attributed to it, independent of repo config. */
export const BRIDGE_GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'SP-Kickstack Bridge',
  GIT_AUTHOR_EMAIL: 'bridge@sp-kickstack.local',
  GIT_COMMITTER_NAME: 'SP-Kickstack Bridge',
  GIT_COMMITTER_EMAIL: 'bridge@sp-kickstack.local',
};

/** Default limit for network and merge operations. */
export const DEFAULT_GIT_TIMEOUT_MS = 120_000;

/**
 * git must never stop to ask for a password or host-key confirmation: it would hang forever. An
 * empty GIT_ASKPASS also stops git from running a password helper inherited from an IDE terminal
 * (VS Code, Antigravity), whose prompt nobody answers; credentials come from the credential helper.
 */
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    ...(process.env.GIT_SSH_COMMAND || process.env.GIT_SSH ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
    ...extra,
  };
}

/** Run git in `repo` (fast local operations); throws an Error carrying git's stderr. */
export function runGit(repo: string, args: string[], env: Record<string, string> = {}): string {
  try {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv(env),
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err: any) {
    const detail = (err?.stderr?.toString?.() || err?.message || String(err)).trim();
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
}

/** Run git without blocking the event loop (network, merges, worktrees), with a time limit. */
export function runGitAsync(
  repo: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: repo, encoding: 'utf8', env: gitEnv(opts.env), timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err: any, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const detail = err.killed ? `timed out after ${timeoutMs} ms` : (stderr || err.message || String(err)).trim();
        reject(new Error(`git ${args[0]} failed: ${detail}`));
      }
    );
  });
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

export async function fetchBranch(repo: string, branch: string, remote = 'origin', timeoutMs?: number): Promise<void> {
  await runGitAsync(repo, ['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], {
    timeoutMs,
  });
}

/** Create `name` at `startSha` without checking it out; no-op if it already exists. */
export function createBranch(repo: string, name: string, startSha: string): void {
  if (resolveCommit(repo, `refs/heads/${name}`)) return;
  runGit(repo, ['branch', '--', name, startSha]);
}

/** Files changed on `branch` since it left `base` (`base...branch`), at most `limit`. */
export function changedFiles(repo: string, base: string, branch: string, limit = 60): string[] {
  return (tryGit(repo, ['diff', '--name-only', `${base}...${branch}`]) ?? '')
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** A file's content at `ref`, or null when it does not exist there. */
export function readFileAt(repo: string, ref: string, file: string): string | null {
  return tryGit(repo, ['show', `${ref}:${file}`]);
}

/** A branch living under `<name>/` locally or on origin (git then refuses a branch named `name`), or null. */
export function branchUnder(repo: string, name: string): string | null {
  const ref = tryGit(repo, ['for-each-ref', '--count=1', '--format=%(refname)', `refs/heads/${name}/`, `refs/remotes/origin/${name}/`])?.trim();
  return ref ? ref.replace(/^refs\/(heads|remotes\/origin)\//, '') : null;
}

/** A branch, locally or on origin, that `name` would live under (`release` for `release/1.3`), or null. */
export function branchAbove(repo: string, name: string): string | null {
  const parts = name.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    if (resolveCommit(repo, `refs/heads/${prefix}`) || resolveCommit(repo, `refs/remotes/origin/${prefix}`)) return prefix;
  }
  return null;
}

export async function addDetachedWorktree(repo: string, dir: string, sha: string, timeoutMs?: number): Promise<void> {
  await runGitAsync(repo, ['worktree', 'add', '--quiet', '--detach', dir, sha], { timeoutMs });
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

export async function mergeNoFf(
  worktree: string,
  branch: string,
  message: string,
  timeoutMs?: number
): Promise<{ ok: true; sha: string } | { ok: false; conflicts: string[]; error: string }> {
  try {
    await runGitAsync(worktree, ['merge', '--no-ff', '--no-edit', '-m', message, branch], {
      env: BRIDGE_GIT_ENV,
      timeoutMs,
    });
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
export async function pushCommit(
  repo: string,
  sha: string,
  branch: string,
  remote = 'origin',
  timeoutMs?: number
): Promise<void> {
  await runGitAsync(repo, ['push', '--quiet', remote, `${sha}:refs/heads/${branch}`], { timeoutMs });
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

/**
 * Delete a local branch once its tip is contained in `mergedInto` (independent of what is
 * checked out). A branch still checked out in some worktree is kept. Returns true if deleted.
 */
export function deleteMergedBranch(repo: string, branch: string, mergedInto: string): boolean {
  const tip = resolveCommit(repo, `refs/heads/${branch}`);
  if (!tip || !isAncestor(repo, tip, mergedInto) || checkoutPathOf(repo, branch)) return false;
  return tryGit(repo, ['update-ref', '-d', `refs/heads/${branch}`, tip]) !== null;
}

/**
 * Run an operator-configured shell command (the project's test command) in its own process
 * group, so a timeout kills everything it started (npm, test runners), not just the shell.
 */
export function runShell(cwd: string, command: string, timeoutMs: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const MAX_OUTPUT = 16 * 1024 * 1024;
    let output = '';
    let timedOut = false;
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL'); // the whole group: sh and everything it started
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ code: 124, output: `${output}\n[timed out after ${timeoutMs} ms]` });
      resolve({ code: code === 0 ? 0 : code || 1, output });
    });
  });
}

/** Local and origin branch names (origin's without the prefix), each once. */
export function listBranchNames(repo: string): string[] {
  const refs = (prefix: string) =>
    (tryGit(repo, ['for-each-ref', '--format=%(refname)', prefix]) || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const local = refs('refs/heads').map((r) => r.slice('refs/heads/'.length));
  const remote = refs('refs/remotes/origin').map((r) => r.slice('refs/remotes/origin/'.length)).filter((n) => n !== 'HEAD');
  return [...new Set([...local, ...remote])];
}
