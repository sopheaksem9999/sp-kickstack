import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses, makeLocalHarness, waitFor } from '../testing/localEngineFixture.js';
import { isAlive } from './processes.js';

afterAll(() => cleanLocalHarnesses());

describe('AgentRunner: one run', () => {
  it('runs the agent in the task worktree and marks committed work for review', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: say Working on it\nFAKE: commit a.txt');
    await h.settle();

    expect(h.run(run.id)).toMatchObject({ status: 'review', cli: 'claude-cli', pid: null, exit_code: 0 });
    const text = h.logText(task.id);
    expect(text).toMatch(/▶ Claude Code started in .*task-\d+ on req\/REQ-\d+\/task-\d+/);
    expect(text).toContain('Agent started: Claude Code fake · fake-model');
    expect(text).toContain('Working on it');
    expect(text).toContain('→ Bash: git add a.txt');
    expect(text).toContain(`✓ Finished: 1 commit on ${task.branch} ready for review`);
    // The person's checkout is untouched; the commit is on the task branch.
    expect(sh(h.repo, ['branch', '--show-current'])).toBe('develop');
    expect(sh(h.repo, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(h.repo, 'a.txt'))).toBe(false);
    expect(sh(h.repo, ['log', '--format=%s', '-1', task.branch])).toBe('add a.txt');
  });

  it('gives the agent the xticket environment and launcher', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    const [call] = h.invocations(run.id);
    expect(call.env).toMatchObject({ XTICKET_URL: 'http://127.0.0.1:4100', XTICKET_PROJECT: 'backend', XTICKET_TASK: run.id });
    expect(call.env.PATH.startsWith(path.join(h.ws, 'agent-bin'))).toBe(true);
    expect(fs.existsSync(path.join(h.ws, 'agent-bin', 'xticket'))).toBe(true);
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(h.run(run.id).worktree!));
  });

  it('needs a person when the agent committed nothing, and says where uncommitted work is', async () => {
    const h = makeLocalHarness();
    const clean = h.queueRun('FAKE: say nothing to do');
    const dirty = h.queueRun('FAKE: dirty notes.txt');
    await h.settle();
    expect(h.run(clean.run.id)).toMatchObject({ status: 'no_changes', error: 'Finished without committing anything' });
    expect(h.run(dirty.run.id).status).toBe('no_changes');
    expect(h.run(dirty.run.id).error).toMatch(/^Finished without committing; the uncommitted changes are in .*task-\d+$/);
    expect(h.logText(dirty.task.id)).toContain('⚠ Uncommitted changes left in');
  });

  it('fails with the CLI error and the last output lines when the agent exits non-zero', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: say step one\nFAKE: exit 3');
    await h.settle();
    const failed = h.run(run.id);
    expect(failed).toMatchObject({ status: 'failed', exit_code: 3 });
    expect(failed.error).toMatch(/^Claude Code failed: failed on purpose \(3\)\n/);
    expect(failed.error).toContain('step one');
    expect(h.logText(task.id)).toContain('✗ Claude Code failed: failed on purpose (3)');
  });

  it('fails clearly when the CLI cannot start', async () => {
    const h = makeLocalHarness();
    const broken = path.join(h.ws, 'broken-cli');
    fs.writeFileSync(broken, '#!/nonexistent/interpreter\n', { mode: 0o755 });
    h.settingsService.updateAiCliSettings({ claude: { customPath: broken } } as any);
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(h.run(run.id).status).toBe('failed');
    expect(h.run(run.id).error).toMatch(/^Could not start Claude Code \(.*broken-cli\): .*ENOENT/);
  });

  it('records the model and effort the run used on the task', async () => {
    const h = makeLocalHarness();
    h.settingsService.updateAiCliSettings({ claude: { model: 'sonnet', effort: 'medium' } } as any);
    const first = h.queueRun('FAKE: commit a.txt');
    const task2 = h.addTask();
    const second = h.runner.runs.create({ bridgeTaskId: task2.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit b.txt', model: 'opus', effort: 'high' });
    await h.settle();
    const taskRow = (id: number) => h.db.prepare('SELECT model, effort FROM bridge_tasks WHERE id = ?').get(id);
    expect(taskRow(first.task.id)).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(taskRow(task2.id)).toEqual({ model: 'opus', effort: 'high' });
    expect(h.invocations(second.id)[0].argv).toEqual(expect.arrayContaining(['--model', 'opus', '--effort', 'high']));
  });

  it('runs AGY with the prompt as an argument and reads its output', async () => {
    const h = makeLocalHarness({ cli: 'agy-cli' });
    const { run, task } = h.queueRun('FAKE: say hello from agy\nFAKE: commit a.txt');
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'review', cli: 'agy-cli' });
    expect(h.invocations(run.id)[0].argv[0]).toBe('-p');
    const text = h.logText(task.id);
    expect(text).toContain('▶ AGY started');
    expect(text).toContain('hello from agy');
    expect(text).toContain('→ run_command: git add a.txt');
  });
});

describe('AgentRunner: limits and settings', () => {
  it('runs at most the parallel limit and starts the rest as slots free up', async () => {
    const h = makeLocalHarness();
    const runs = [1, 2, 3].map((i) => h.queueRun(`FAKE: sleep 400\nFAKE: commit f${i}.txt`).run);
    await h.runner.tick();
    expect(h.runner.runs.count('running')).toBe(2);
    expect(h.runner.runs.count('queued')).toBe(1);
    await h.runner.idle();
    expect(runs.map((r) => h.run(r.id).status)).toEqual(['review', 'review', 'review']);
  }, 15_000);

  it('runs one agent per task at a time', async () => {
    const h = makeLocalHarness();
    const { task } = h.queueRun('FAKE: sleep 300\nFAKE: commit a.txt');
    h.queueRun('FAKE: commit b.txt', task);
    await h.runner.tick();
    expect(h.runner.runs.count('running')).toBe(1);
    await h.runner.idle();
    expect(h.runner.runs.count('review')).toBe(2);
  }, 15_000);

  it('stops a run at the time limit', async () => {
    const h = makeLocalHarness(); // minuteMs 50: the 5 minute minimum lasts 250 ms
    h.settingsService.updateLocalEngineSettings({ runTimeoutMinutes: 5 });
    const { run, task } = h.queueRun('FAKE: sleep 10000');
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'timed_out', error: 'Stopped after the 5 minute time limit (Settings → AI & Local Engines)' });
    expect(h.logText(task.id)).toContain('✗ Stopped after the 5 minute time limit');
  }, 15_000);

  it('starts nothing while turned off and picks queued runs up when turned on again', async () => {
    const h = makeLocalHarness();
    h.settingsService.updateLocalEngineSettings({ enabled: false });
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(h.run(run.id).status).toBe('queued');
    expect(h.runner.health()).toEqual({ ok: false, error: 'The Local AI CLI engine is turned off in Settings → AI & Local Engines' });
    h.settingsService.updateLocalEngineSettings({ enabled: true });
    expect(h.runner.health()).toEqual({ ok: true, version: 'local · Claude Code' });
    await h.settle();
    expect(h.run(run.id).status).toBe('review');
  });

  it('fails with what to do when the task branch is checked out in your own checkout, and leaves it alone', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: commit a.txt');
    sh(h.repo, ['checkout', '-q', task.branch]);
    await h.settle();
    expect(h.run(run.id).status).toBe('failed');
    expect(h.run(run.id).error).toContain(`Branch ${task.branch} is checked out in`);
    expect(h.run(run.id).error).toContain('switch that checkout to another branch, then Retry');
    expect(sh(h.repo, ['branch', '--show-current'])).toBe(task.branch);
    expect(sh(h.repo, ['status', '--porcelain'])).toBe('');
  });

  it('finishes even when the agent leaves a background process, and stops it', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt\nFAKE: background 30000');
    await h.settle();
    expect(h.run(run.id).status).toBe('review');
    const pid = Number(fs.readFileSync(path.join(h.promptsDir, `${run.id}-bg.pid`), 'utf8'));
    await waitFor(() => !isAlive(pid));
  }, 15_000);
});

describe('AgentRunner: review fixes', () => {
  it('reports a task whose run added commits, so its branch can be pushed', async () => {
    const pushed: number[] = [];
    const h = makeLocalHarness({ runner: { onCommits: (taskId) => pushed.push(taskId) } });
    const committed = h.queueRun('FAKE: commit a.txt');
    h.queueRun('FAKE: say nothing to do');
    await h.settle();
    expect(pushed).toEqual([committed.task.id]);
  });
  it('survives a leftover process that keeps writing after the agent exits', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt\nFAKE: chatty-background');
    try {
      await h.settle();
      expect(h.run(run.id).status).toBe('review');
      await new Promise((r) => setTimeout(r, 500)); // lines that arrive late must not crash the server
    } finally {
      const pidFile = path.join(h.promptsDir, `${run.id}-bg.pid`);
      const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
      if (pid > 0 && isAlive(pid)) process.kill(pid, 'SIGKILL'); // only the process this test started
    }
  }, 15_000);
});

describe('AgentRunner: agent environment', () => {
  it("gives the agent no server settings, and an outbox the server reads", async () => {
    const h = makeLocalHarness();
    const saved = { PORT: process.env.PORT, npm_lifecycle_event: process.env.npm_lifecycle_event };
    process.env.PORT = '4100';
    process.env.npm_lifecycle_event = 'dev';
    try {
      const { run } = h.queueRun('FAKE: commit a.txt');
      await h.settle();
      const [call] = h.invocations(run.id);
      expect(call.env.PORT).toBeUndefined();
      expect(call.env.npm_lifecycle_event).toBeUndefined();
      expect(call.env.XTICKET_OUTBOX).toBe(path.join(h.ws, 'agent-outbox', 'backend'));
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('AgentRunner: repository engine', () => {
  it('starts no agent for a repository that left Local AI CLI or is disabled, and resumes when it is back', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt');
    h.projectService.updateProject('backend', { engine_type: 'manual' });
    await h.settle();
    expect(h.run(run.id).status).toBe('queued');
    h.projectService.updateProject('backend', { engine_type: 'local', enabled: false });
    await h.settle();
    expect(h.run(run.id).status).toBe('queued');
    expect(h.invocations(run.id)).toHaveLength(0);
    h.projectService.updateProject('backend', { enabled: true });
    await h.settle();
    expect(h.run(run.id).status).toBe('review');
  });
});

describe('AgentRunner: worktree folder', () => {
  it('keeps using a task\'s worktree after the worktree folder setting changes', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    const first = h.run(run.id).worktree!;
    h.settingsService.updateLocalEngineSettings({ worktreeRoot: path.join(h.ws, 'moved-worktrees') });
    const next = h.runner.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit b.txt' });
    await h.settle();
    expect(h.run(next.id)).toMatchObject({ status: 'review', worktree: first });
    const fresh = h.queueRun('FAKE: commit c.txt');
    await h.settle();
    expect(h.run(fresh.run.id).worktree!.startsWith(path.join(h.ws, 'moved-worktrees'))).toBe(true);
  });
});

describe('AgentRunner: default worktree folder', () => {
  it('uses a folder outside git when the server workspace is inside a repository', () => {
    const h = makeLocalHarness();
    h.settingsService.updateLocalEngineSettings({ worktreeRoot: '' });
    const home = path.join(h.ws, 'home');
    const runner = h.newRunner({ workspaceDir: path.join(h.repo, 'workspace'), homeDir: home });
    expect(runner.status().worktreeRoot).toBe(path.join(home, '.sp-kickstack', 'agent-worktrees'));
  });
});

describe('AgentRunner: cancel', () => {
  it('stops a running agent and its process group', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: sleep 10000');
    await h.runner.tick();
    const pid = h.run(run.id).pid!;
    await h.runner.cancel(run.id);
    expect(h.run(run.id).status).toBe('cancelled');
    expect(isAlive(pid)).toBe(false);
    expect(h.logText(task.id)).toContain('■ Stopped: the task was cancelled');
  }, 15_000);

  it('cancels a queued run without starting it, and treats a finished run as stopped', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.runner.cancel(run.id);
    expect(h.run(run.id).status).toBe('cancelled');
    expect(h.invocations(run.id)).toHaveLength(0);
    await h.runner.cancel(run.id);
    await h.runner.cancel('local-missing');
  });
});
