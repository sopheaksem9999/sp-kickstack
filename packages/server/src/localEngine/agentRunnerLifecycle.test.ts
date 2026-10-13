import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { cleanLocalHarnesses, makeLocalHarness } from '../testing/localEngineFixture.js';
import { deleteMergedBranch, checkoutPathOf } from '../lib/gitRepo.js';
import { isAlive, spawnAgent } from './processes.js';

afterAll(() => cleanLocalHarnesses());

describe('AgentRunner: server restarts', () => {
  it('a clean restart never counts against the run, however often it happens', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: sleep 1500\nFAKE: commit a.txt');
    let runner = h.runner;
    for (let restart = 0; restart < 3; restart++) {
      await runner.tick();
      const pid = h.run(run.id).pid!;
      await runner.shutdown();
      expect(h.run(run.id)).toMatchObject({ status: 'queued', continuation: 1, interruptions: 0, pid: null });
      expect(isAlive(pid)).toBe(false);
      runner = h.newRunner();
      await runner.recoverOnStartup();
    }
    await h.settle(runner);
    expect(h.run(run.id)).toMatchObject({ status: 'review', interruptions: 0 });
    expect(h.logText(task.id)).toContain('⏹ Server stopping; this run continues when the server starts again');
  }, 30_000);

  it('after a crash stops only its own leftover agent and queues the run again; the third crash fails it', async () => {
    const h = makeLocalHarness();
    const orphan = spawnAgent({ bin: '/bin/sleep', args: ['30'], stdin: null }, h.ws, process.env);
    const ours = h.queueRun('FAKE: commit a.txt');
    h.runner.runs.update(ours.run.id, { status: 'running', pid: orphan.pid, pid_started_at: orphan.startedAt });
    const stranger = h.queueRun('FAKE: commit b.txt');
    h.runner.runs.update(stranger.run.id, { status: 'running', pid: process.pid, pid_started_at: 'Mon Jan  1 00:00:00 2001' });
    const third = h.queueRun('FAKE: commit c.txt');
    h.runner.runs.update(third.run.id, { status: 'running', interruptions: 2 });

    await h.runner.recoverOnStartup();

    expect(isAlive(orphan.pid)).toBe(false);
    expect(isAlive(process.pid)).toBe(true);
    expect(h.run(ours.run.id)).toMatchObject({ status: 'queued', interruptions: 1, continuation: 1, pid: null });
    expect(h.run(stranger.run.id)).toMatchObject({ status: 'queued', interruptions: 1 });
    expect(h.run(third.run.id)).toMatchObject({ status: 'failed', interruptions: 3 });
    expect(h.run(third.run.id).error).toBe('Interrupted 3 times (the server stopped while the agent was running); Retry starts it again');
    expect(h.logText(ours.task.id)).toContain('↻ The server restarted while the agent was running; it continues from the branch');
  }, 15_000);
});

describe('AgentRunner: worktrees and status', () => {
  it('removes the worktree once the task is complete, and keeps one with uncommitted changes', async () => {
    const h = makeLocalHarness();
    const done = h.queueRun('FAKE: commit a.txt');
    const dirty = h.queueRun('FAKE: commit b.txt\nFAKE: dirty wip.txt');
    await h.settle();
    const doneDir = h.run(done.run.id).worktree!;
    const dirtyDir = h.run(dirty.run.id).worktree!;
    h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id IN (?, ?)").run(done.task.id, dirty.task.id);
    await h.runner.tick();
    await h.runner.tick();
    expect(fs.existsSync(doneDir)).toBe(false);
    expect(h.run(done.run.id).worktree).toBeNull();
    expect(fs.existsSync(dirtyDir)).toBe(true);
    expect(h.logs(dirty.task.id).filter((l) => l.message.startsWith('Kept ')).length).toBe(1);
  });

  it('frees a worktree so the merge gate can delete the merged branch', async () => {
    const h = makeLocalHarness();
    const { task } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(checkoutPathOf(h.repo, task.branch)).not.toBeNull();
    expect(h.runner.releaseWorktree(task.id)).toBe(true);
    expect(checkoutPathOf(h.repo, task.branch)).toBeNull();
    expect(deleteMergedBranch(h.repo, task.branch, task.branch)).toBe(true);
  });

  it('reports the CLI that runs next, counts and pauses', async () => {
    let clock = Date.now();
    const h = makeLocalHarness({ runner: { now: () => clock } });
    const limited = h.queueRun(`FAKE: limit ${Math.floor(clock / 1000) + 600}`);
    await h.settle();
    h.queueRun('FAKE: commit a.txt');
    const status = h.runner.status();
    expect(status).toMatchObject({ enabled: true, cli: 'claude-cli', problem: null, maxParallel: 2, counts: { running: 0, queued: 1, held: 0, rate_limited: 1 } });
    expect(status.worktreeRoot.endsWith('agent-worktrees')).toBe(true);
    const claude = status.clis.find((c) => c.id === 'claude-cli')!;
    expect(claude).toMatchObject({ label: 'Claude Code', installed: true, enabled: true, pausedUntil: h.run(limited.run.id).resume_at });
    expect(status.clis.map((c) => c.id)).toEqual(['claude-cli', 'agy-cli', 'codex-cli']);
  });
});
