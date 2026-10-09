import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Input rejected for safety reasons; the API error middleware maps `status` to the response. */
export class UnsafeInputError extends Error {
  public status = 400;
}

/** Run git with an argv array (no shell), returning stdout. stderr is discarded. */
export function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Run git and return null instead of throwing (for "try this, else fall back" flows). */
export function tryGit(repoPath: string, args: string[]): string | null {
  try {
    return git(repoPath, args);
  } catch {
    return null;
  }
}

const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

/** A branch/ref name safe to pass to git: no shell metacharacters, no option prefix, no `..`. */
export function assertSafeRef(ref: string): string {
  if (!SAFE_REF.test(ref) || ref.startsWith('-') || ref.includes('..')) {
    throw new UnsafeInputError(`Invalid git ref: ${ref}`);
  }
  return ref;
}

/**
 * Resolve a repository-relative path, refusing absolute paths and anything that resolves
 * (lexically or through symlinks) outside the repository root.
 * Returns the absolute path and the normalized POSIX-style relative path for git pathspecs.
 */
export function resolveInRepo(repoPath: string, relPath: string): { fullPath: string; relPath: string } {
  if (!relPath || path.isAbsolute(relPath)) {
    throw new UnsafeInputError(`Path must be relative to the repository: ${relPath}`);
  }

  const root = path.resolve(repoPath);
  const fullPath = path.resolve(root, relPath);
  const rel = path.relative(root, fullPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new UnsafeInputError(`Path escapes the repository: ${relPath}`);
  }

  if (fs.existsSync(fullPath)) {
    const realRel = path.relative(fs.realpathSync(root), fs.realpathSync(fullPath));
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new UnsafeInputError(`Path escapes the repository: ${relPath}`);
    }
  }

  return { fullPath, relPath: rel.split(path.sep).join('/') };
}
