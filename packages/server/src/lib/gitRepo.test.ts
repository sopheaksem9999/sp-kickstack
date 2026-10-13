import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, commitOnBranch, headOf, sh } from '../testing/gitFixture.js';
import {
  isGitWorkTree,
  resolveCommit,
  hasRemote,
  createBranch,
  addDetachedWorktree,
  removeWorktree,
  commitsAhead,
  mergeNoFf,
  pushCommit,
  checkoutPathOf,
  fastForwardBranch,
  runShell,
  runGitAsync,
} from './gitRepo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-gitrepo');
let n = 0;

describe('gitRepo helpers', () => {
  let root: string;
  beforeEach(() => {
    root = path.join(tempRoot, `case-${process.pid}-${n++}`);
    fs.mkdirSync(root, { recursive: true });
  });
  afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it('detects git work trees and remotes', () => {
    const { repo } = makeRepo(root, { withOrigin: true });
    expect(isGitWorkTree(repo)).toBe(true);
    expect(isGitWorkTree(root)).toBe(false);
    expect(isGitWorkTree(path.join(root, 'missing'))).toBe(false);
    expect(hasRemote(repo)).toBe(true);
    expect(resolveCommit(repo, 'develop')).toBe(headOf(repo, 'develop'));
    expect(resolveCommit(repo, 'nope')).toBeNull();
  });

  it('creates a branch from a commit without touching the checkout, idempotently', () => {
    const { repo } = makeRepo(root);
    const base = headOf(repo, 'develop');
    createBranch(repo, 'req/REQ-001/task-1', base);
    createBranch(repo, 'req/REQ-001/task-1', base);
    expect(headOf(repo, 'req/REQ-001/task-1')).toBe(base);
    expect(sh(repo, ['branch', '--show-current'])).toBe('develop');
  });

  it('merges --no-ff as the bridge and reports conflicts without leaving a mess', async () => {
    const { repo } = makeRepo(root);
    const base = headOf(repo, 'develop');
    createBranch(repo, 'clean', base);
    createBranch(repo, 'clash', base);
    commitOnBranch(repo, 'clean', 'b.txt', 'b\n');
    commitOnBranch(repo, 'clash', 'README.md', 'theirs\n');
    commitOnBranch(repo, 'develop', 'README.md', 'ours\n');
    expect(commitsAhead(repo, base, 'clean')).toBe(1);

    const wt = path.join(root, 'merge-wt');
    await addDetachedWorktree(repo, wt, headOf(repo, 'develop'));
    const ok = await mergeNoFf(wt, 'clean', 'Merge clean');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(sh(wt, ['rev-list', '--parents', '-n', '1', ok.sha]).split(' ')).toHaveLength(3);
      expect(sh(wt, ['log', '-1', '--format=%an', ok.sha])).toBe('SP-Kickstack Bridge');
    }

    const bad = await mergeNoFf(wt, 'clash', 'Merge clash');
    expect(bad).toMatchObject({ ok: false, conflicts: ['README.md'] });
    expect(sh(wt, ['status', '--porcelain'])).toBe('');
    removeWorktree(repo, wt);
    expect(fs.existsSync(wt)).toBe(false);
  });

  it('fast-forwards a branch that is not checked out', () => {
    const { repo } = makeRepo(root);
    createBranch(repo, 'target', headOf(repo, 'develop'));
    createBranch(repo, 'ahead', headOf(repo, 'develop'));
    const sha = commitOnBranch(repo, 'ahead', 'x.txt', 'x\n');
    expect(checkoutPathOf(repo, 'target')).toBeNull();
    expect(fastForwardBranch(repo, 'target', sha)).toEqual({ advanced: true });
    expect(headOf(repo, 'target')).toBe(sha);
  });

  it('fast-forwards a clean checked-out branch, updating its files', () => {
    const { repo } = makeRepo(root);
    createBranch(repo, 'feature', headOf(repo, 'develop'));
    const sha = commitOnBranch(repo, 'feature', 'f.txt', 'f\n');
    expect(fs.realpathSync(checkoutPathOf(repo, 'develop')!)).toBe(fs.realpathSync(repo));
    expect(fastForwardBranch(repo, 'develop', sha)).toEqual({ advanced: true });
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('f\n');
  });

  it('leaves a dirty checked-out branch alone with a warning', () => {
    const { repo } = makeRepo(root);
    createBranch(repo, 'feature', headOf(repo, 'develop'));
    const sha = commitOnBranch(repo, 'feature', 'f.txt', 'f\n');
    fs.writeFileSync(path.join(repo, 'README.md'), 'my unsaved work\n');
    const before = headOf(repo, 'develop');

    const result = fastForwardBranch(repo, 'develop', sha);

    expect(result.advanced).toBe(false);
    expect(result.warning).toMatch(/uncommitted/);
    expect(headOf(repo, 'develop')).toBe(before);
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('my unsaved work\n');
  });

  it('refuses to fast-forward over local commits that are not in the target', () => {
    const { repo } = makeRepo(root);
    createBranch(repo, 'feature', headOf(repo, 'develop'));
    const sha = commitOnBranch(repo, 'feature', 'f.txt', 'f\n');
    commitOnBranch(repo, 'develop', 'local.txt', 'local\n');
    const result = fastForwardBranch(repo, 'develop', sha);
    expect(result.advanced).toBe(false);
    expect(result.warning).toMatch(/not in the merge/);
  });

  it('pushes a fast-forward and refuses a non-fast-forward push', async () => {
    const { repo, origin } = makeRepo(root, { withOrigin: true });
    createBranch(repo, 'feature', headOf(repo, 'develop'));
    const sha = commitOnBranch(repo, 'feature', 'f.txt', 'f\n');
    await pushCommit(repo, sha, 'develop');
    expect(headOf(origin!, 'develop')).toBe(sha);

    createBranch(repo, 'other', headOf(repo, 'develop'));
    const unrelated = commitOnBranch(repo, 'other', 'o.txt', 'o\n');
    await expect(pushCommit(repo, unrelated, 'develop')).rejects.toThrow();
    expect(headOf(origin!, 'develop')).toBe(sha);
  });

  it('runs a shell command and reports exit code and output', async () => {
    const ok = await runShell(root, 'echo hello && echo oops 1>&2', 5000);
    expect(ok.code).toBe(0);
    expect(ok.output).toContain('hello');
    expect(ok.output).toContain('oops');
    expect((await runShell(root, 'exit 3', 5000)).code).toBe(3);
    expect((await runShell(root, 'sleep 5', 100)).code).not.toBe(0);
  });
});

describe('git never asks for a password', () => {
  it('ignores a password helper inherited from an IDE terminal (GIT_ASKPASS), so a missing password fails at once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-askpass-'));
    const asked = path.join(dir, 'asked');
    const helper = path.join(dir, 'askpass.sh');
    fs.writeFileSync(helper, `#!/bin/sh\ntouch "${asked}"\necho secret\n`, { mode: 0o755 });
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="origin"' });
      res.end();
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/repo.git`;
    const saved = process.env.GIT_ASKPASS;
    process.env.GIT_ASKPASS = helper;
    try {
      await expect(runGitAsync(dir, ['-c', 'credential.helper=', 'ls-remote', url], { timeoutMs: 20_000 })).rejects.toThrow('terminal prompts disabled');
      expect(fs.existsSync(asked)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.GIT_ASKPASS;
      else process.env.GIT_ASKPASS = saved;
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
