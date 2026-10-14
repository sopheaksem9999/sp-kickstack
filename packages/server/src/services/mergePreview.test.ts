import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BridgeTask } from '@sp-kickstack/shared';
import { commitOnBranch, makeRepo, sh } from '../testing/gitFixture.js';
import { buildMergePreview } from './mergePreview.js';

const tempRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.temp/sp-test-merge-preview');
let n = 0;
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function repoCase() {
  const root = path.join(tempRoot, `case-${process.pid}-${n++}`);
  const { repo } = makeRepo(path.join(root, 'backend'));
  const tmpRoot = path.join(root, 'tmp');
  return { repo, tmpRoot };
}
const task = (id: number, branch: string) => ({ id, branch, title: `Task ${id}` }) as BridgeTask;
const branchWith = (repo: string, name: string, file: string, content: string) => {
  sh(repo, ['branch', name, 'develop']);
  return commitOnBranch(repo, name, file, content);
};

describe('buildMergePreview', () => {
  it('merges the task branches into the base without moving any branch or ref', async () => {
    const { repo, tmpRoot } = repoCase();
    branchWith(repo, 'req/REQ-1/task-1', 'a.txt', 'a\n');
    branchWith(repo, 'req/REQ-1/task-2', 'b.txt', 'b\n');
    const refs = sh(repo, ['for-each-ref']);
    const base = sh(repo, ['rev-parse', 'develop']);

    const preview = await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(1, 'req/REQ-1/task-1'), task(2, 'req/REQ-1/task-2')], { tmpRoot });

    expect(preview).toMatchObject({ ok: true, from: base });
    const sha = (preview as { sha: string }).sha;
    expect(sh(repo, ['show', `${sha}:a.txt`])).toBe('a');
    expect(sh(repo, ['show', `${sha}:b.txt`])).toBe('b');
    expect(sh(repo, ['log', '--format=%s', '-1', sha])).toBe('Merge REQ-1 task-2: Task 2');
    expect(sh(repo, ['for-each-ref'])).toBe(refs);
    expect(sh(repo, ['rev-parse', 'develop'])).toBe(base);
    expect(sh(repo, ['worktree', 'list'])).not.toContain('sp-qa-preview');
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  it('reports a conflict with its files, and still cleans up', async () => {
    const { repo, tmpRoot } = repoCase();
    branchWith(repo, 'req/REQ-1/task-1', 'README.md', '# from the branch\n');
    commitOnBranch(repo, 'develop', 'README.md', '# from develop\n');
    const preview = await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(1, 'req/REQ-1/task-1')], { tmpRoot });
    expect(preview).toEqual({
      ok: false, error: 'backend: merging req/REQ-1/task-1 into develop conflicts in README.md (Merge & move to QA would conflict too)',
    });
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  it('reports a missing branch or base branch', async () => {
    const { repo, tmpRoot } = repoCase();
    expect(await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(7, 'req/REQ-1/gone')], { tmpRoot }))
      .toEqual({ ok: false, error: 'backend: branch req/REQ-1/gone (task #7) does not exist' });
    expect(await buildMergePreview(repo, 'release/9', 'backend', 'REQ-1', [], { tmpRoot }))
      .toEqual({ ok: false, error: 'backend: base branch release/9 was not found' });
  });

  it('returns the base tip when nothing is ahead', async () => {
    const { repo, tmpRoot } = repoCase();
    sh(repo, ['branch', 'req/REQ-1/task-1', 'develop']);
    const base = sh(repo, ['rev-parse', 'develop']);
    expect(await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(1, 'req/REQ-1/task-1')], { tmpRoot })).toEqual({ ok: true, sha: base, from: base });
  });
});
