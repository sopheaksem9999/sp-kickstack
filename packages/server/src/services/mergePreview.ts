// AI QA in In Review: the repository's unmerged task branches merged into its target/base branch in a
// temporary checkout, as Merge & move to QA would do. No branch or ref is created or moved; git keeps the
// unreferenced preview commit for two weeks, far longer than a QA run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BridgeTask } from '@sp-kickstack/shared';
import * as git from '../lib/gitRepo.js';

export type MergePreview = { ok: true; sha: string; from: string } | { ok: false; error: string };

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

export async function buildMergePreview(
  repo: string,
  base: string,
  project: string,
  reqId: string,
  tasks: BridgeTask[],
  opts: { tmpRoot?: string; gitTimeoutMs?: number } = {}
): Promise<MergePreview> {
  const from = git.resolveCommit(repo, `refs/heads/${base}`) ?? git.resolveCommit(repo, `refs/remotes/origin/${base}`);
  if (!from) return { ok: false, error: `${project}: base branch ${base} was not found` };
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, `sp-qa-preview-${safe(reqId)}-${safe(project)}-`));
  const worktree = path.join(tmpDir, 'wt');
  try {
    await git.addDetachedWorktree(repo, worktree, from, opts.gitTimeoutMs);
    for (const task of tasks) {
      const branch = task.branch!;
      const tip = git.resolveCommit(repo, `refs/heads/${branch}`);
      if (!tip) return { ok: false, error: `${project}: branch ${branch} (task #${task.id}) does not exist` };
      if (git.commitsAhead(worktree, 'HEAD', tip) === 0) continue;
      const merged = await git.mergeNoFf(worktree, tip, `Merge ${reqId} task-${task.id}: ${task.title}`, opts.gitTimeoutMs);
      if (!merged.ok) {
        const files = merged.conflicts.length ? ` in ${merged.conflicts.join(', ')}` : '';
        return { ok: false, error: `${project}: merging ${branch} into ${base} conflicts${files} (Merge & move to QA would conflict too)` };
      }
    }
    return { ok: true, sha: git.resolveCommit(worktree, 'HEAD')!, from };
  } catch (err: any) {
    return { ok: false, error: `${project}: the merge preview failed: ${err?.message || err}` };
  } finally {
    try {
      git.removeWorktree(repo, worktree);
    } catch {
      // Best effort: a leftover temporary folder is harmless.
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
