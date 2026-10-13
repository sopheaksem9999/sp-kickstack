import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, sh } from '../testing/gitFixture.js';
import { checkoutPathOf, createBranch, resolveCommit } from '../lib/gitRepo.js';
import { AgentWorktrees, defaultWorktreeRoot, folderName } from './worktrees.js';
import { isAlive, isSameProcess, processStartTime, spawnAgent, stopGroup } from './processes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(here, '../../.temp/sp-test-worktrees');
let n = 0;
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function setup() {
  const ws = path.join(tempRoot, `case-${process.pid}-${n++}`);
  const { repo } = makeRepo(path.join(ws, 'backend'));
  createBranch(repo, 'req/REQ-001/task-1', resolveCommit(repo, 'refs/heads/develop')!);
  const worktrees = new AgentWorktrees(() => path.join(ws, 'agent-worktrees'));
  return { ws, repo, worktrees, dir: worktrees.pathFor('backend', 1) };
}

describe('AgentWorktrees', () => {
  it('creates one worktree per task on its branch and reuses it, leaving your checkout alone', () => {
    const { repo, worktrees, dir } = setup();
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    expect(sh(dir, ['branch', '--show-current'])).toBe('req/REQ-001/task-1');
    fs.writeFileSync(path.join(dir, 'agent.txt'), 'x');
    expect(fs.existsSync(path.join(repo, 'agent.txt'))).toBe(false);
    expect(sh(repo, ['branch', '--show-current'])).toBe('develop');
    expect(worktrees.uncommitted(dir)).toEqual(['agent.txt']);
  });

  it('refuses a branch that is checked out elsewhere, and a folder that is not a git repository', () => {
    const { ws, repo, worktrees, dir } = setup();
    sh(repo, ['checkout', '-q', 'req/REQ-001/task-1']);
    expect(() => worktrees.ensure(repo, 'req/REQ-001/task-1', dir)).toThrow(/is checked out in .*switch that checkout to another branch, then Retry/);
    const plain = path.join(ws, 'plain');
    fs.mkdirSync(plain);
    expect(() => worktrees.ensure(plain, 'main', path.join(ws, 'x'))).toThrow(/needs a git repository/);
  });

  it('recreates a worktree whose folder was deleted by hand', () => {
    const { repo, worktrees, dir } = setup();
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    fs.rmSync(dir, { recursive: true, force: true });
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    expect(sh(dir, ['branch', '--show-current'])).toBe('req/REQ-001/task-1');
  });

  it('removes only a clean worktree', () => {
    const { repo, worktrees, dir } = setup();
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    fs.writeFileSync(path.join(dir, 'wip.txt'), 'x');
    expect(worktrees.removeIfClean(repo, dir)).toBe('dirty');
    fs.rmSync(path.join(dir, 'wip.txt'));
    expect(worktrees.removeIfClean(repo, dir)).toBe('removed');
    expect(checkoutPathOf(repo, 'req/REQ-001/task-1')).toBeNull();
    expect(worktrees.removeIfClean(repo, dir)).toBe('missing');
  });

  it('keeps task worktrees out of a git work tree by default', () => {
    const { ws, repo } = setup();
    const home = path.join(ws, 'home');
    // npm run dev keeps the server workspace inside SP-Kickstack's own checkout.
    expect(defaultWorktreeRoot(path.join(repo, 'packages', 'server', 'workspace'), home)).toBe(path.join(home, '.sp-kickstack', 'agent-worktrees'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ws-'));
    try {
      expect(defaultWorktreeRoot(outside, home)).toBe(path.join(outside, 'agent-worktrees'));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('names folders safely and finds the shared .git folder', () => {
    const { repo, worktrees } = setup();
    expect(folderName('mobile app/../x')).toBe('mobile-app-..-x');
    expect(folderName('..')).toBe('project');
    expect(folderName('.hidden')).toBe('hidden');
    expect(fs.realpathSync(worktrees.gitCommonDir(repo))).toBe(fs.realpathSync(path.join(repo, '.git')));
  });
});

describe('agent processes', () => {
  it('stops a whole process group and recognises the process only while it lives', async () => {
    const agent = spawnAgent({ bin: '/bin/sh', args: ['-c', 'sleep 30 & sleep 30'], stdin: null }, process.cwd(), process.env);
    expect(agent.startedAt).toBe(processStartTime(agent.pid));
    expect(isSameProcess(agent.pid, agent.startedAt)).toBe(true);
    expect(isSameProcess(agent.pid, 'Mon Jan  1 00:00:00 2001')).toBe(false);
    await stopGroup(agent.pid, agent.exited, 2000);
    expect((await agent.exited).signal).toBe('SIGTERM');
    expect(isAlive(agent.pid)).toBe(false);
  });

  it('reports a binary that cannot start', async () => {
    const agent = spawnAgent({ bin: '/nonexistent/agent', args: [], stdin: null }, process.cwd(), process.env);
    expect((await agent.exited).spawnError).toMatch(/ENOENT/);
  });
});
