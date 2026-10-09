// Test-only helpers that build real git repositories (optionally with a bare "origin").
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function makeRepo(root: string, opts: { withOrigin?: boolean; base?: string } = {}): { repo: string; origin?: string } {
  const base = opts.base ?? 'develop';
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', base]);
  sh(repo, ['config', 'user.email', 'dev@example.com']);
  sh(repo, ['config', 'user.name', 'Dev']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'init']);

  let origin: string | undefined;
  if (opts.withOrigin) {
    origin = path.join(root, 'origin.git');
    sh(root, ['init', '-q', '--bare', '-b', base, origin]);
    sh(repo, ['remote', 'add', 'origin', origin]);
    sh(repo, ['push', '-q', 'origin', base]);
    sh(repo, ['fetch', '-q', 'origin']);
  }
  return { repo, origin };
}

/** Commit a file on `branch` without disturbing the repo's own checkout. */
export function commitOnBranch(repo: string, branch: string, file: string, content: string, message = `edit ${file}`): string {
  const write = (dir: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
    sh(dir, ['add', '--', file]);
    sh(dir, ['commit', '-q', '-m', message]);
    return sh(dir, ['rev-parse', 'HEAD']);
  };
  if (sh(repo, ['branch', '--show-current']) === branch) return write(repo);

  const wt = path.join(path.dirname(repo), `wt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  sh(repo, ['worktree', 'add', '-q', wt, branch]);
  try {
    return write(wt);
  } finally {
    sh(repo, ['worktree', 'remove', '--force', wt]);
  }
}

export function headOf(repo: string, ref: string): string {
  return sh(repo, ['rev-parse', ref]);
}
