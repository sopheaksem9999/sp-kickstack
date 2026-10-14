import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses, makeLocalHarness, waitFor, type LocalHarness } from '../testing/localEngineFixture.js';

afterAll(() => cleanLocalHarnesses());

const qaTask = (h: LocalHarness, id: number) => h.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;

describe('AgentRunner: AI QA runs', () => {
  it('checks the commit out detached, ends done without touching a branch, and removes the checkout', async () => {
    const h = makeLocalHarness();
    const sha = sh(h.repo, ['rev-parse', 'develop']);
    const branches = sh(h.repo, ['branch', '--list']);
    const { run, taskId } = h.queueQaRun('FAKE: where\nFAKE: dirty scratch.txt');
    await h.settle();

    expect(h.run(run.id)).toMatchObject({ status: 'done', start_sha: sha, worktree: null, exit_code: 0 });
    expect(qaTask(h, taskId)).toMatchObject({ status: 'done', qa_summary: 'Finished without a result', branch: null });
    const text = h.logText(taskId);
    expect(text).toMatch(new RegExp(`▶ AI QA with Claude Code in .*task-${taskId} at ${sha.slice(0, 7)}`));
    expect(text).toContain(`HEAD ${sha} (detached)`);
    expect(text).toContain('✓ AI QA finished without a result');
    const [call] = h.invocations(run.id);
    expect(fs.existsSync(call.cwd)).toBe(false);
    expect(sh(h.repo, ['branch', '--list'])).toBe(branches);
    expect(sh(h.repo, ['worktree', 'list'])).not.toContain(`task-${taskId}`);
    expect(sh(h.repo, ['status', '--porcelain'])).toBe('');
  });

  it('keeps the result the agent reported', async () => {
    const h = makeLocalHarness();
    const { taskId } = h.queueQaRun('FAKE: say checked');
    h.db.prepare("UPDATE bridge_tasks SET qa_passed = 0, qa_summary = '1 blocker: rides are not saved' WHERE id = ?").run(taskId);
    await h.settle();
    expect(qaTask(h, taskId)).toMatchObject({ status: 'done', qa_passed: 0, qa_summary: '1 blocker: rides are not saved' });
    expect(h.logText(taskId)).toContain('✓ AI QA found problems: 1 blocker: rides are not saved');
  });

  it('fails with the reason when the agent exits non-zero, and still removes the checkout', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: say step one\nFAKE: exit 3');
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'failed', worktree: null });
    const task = qaTask(h, taskId);
    expect(task.status).toBe('failed');
    expect(task.last_error).toMatch(/^Claude Code failed: failed on purpose \(3\)/);
    expect(fs.existsSync(h.invocations(run.id)[0].cwd)).toBe(false);
  });

  it('stops at the AI QA time limit, not the engine run limit', async () => {
    const h = makeLocalHarness();
    h.settingsService.updateAiQaSettings({ timeLimitMinutes: 5 }); // a test minute is 50 ms
    const { run, taskId } = h.queueQaRun('FAKE: sleep 5000');
    await h.settle();
    expect(h.run(run.id).status).toBe('timed_out');
    expect(qaTask(h, taskId).status).toBe('failed');
    expect(qaTask(h, taskId).last_error).toContain('5 minute AI QA time limit (Settings → AI & Local Engines → AI QA)');
  });

  it('runs for a repository on another engine', async () => {
    const h = makeLocalHarness();
    h.projectService.updateProject('backend', { engine_type: 'manual' });
    const { run, taskId } = h.queueQaRun('FAKE: say checked');
    await h.settle();
    expect(h.run(run.id).status).toBe('done');
    expect(qaTask(h, taskId).status).toBe('done');
  });

  it('fails a QA task that has no commit to check', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: say checked');
    h.db.prepare('UPDATE bridge_tasks SET base_sha = NULL WHERE id = ?').run(taskId);
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'failed', error: 'AI QA has no commit to check' });
    expect(qaTask(h, taskId)).toMatchObject({ status: 'failed', last_error: 'AI QA has no commit to check' });
  });

  it('a requirement can be marked done while AI QA runs, and the run stops', async () => {
    const h = makeLocalHarness();
    const now = new Date().toISOString();
    h.db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'goal', 'Ride tracking', 'done', ?, ?)")
      .run(h.req.id, now, now);
    const { run, taskId } = h.queueQaRun('FAKE: sleep 5000');
    await h.runner.tick();
    await waitFor(() => qaTask(h, taskId).status === 'running');

    expect(h.requirementService.updateRequirementStatus(h.req.id, 'done')?.status).toBe('done');
    await h.settle();

    expect(h.run(run.id).status).toBe('cancelled');
    expect(qaTask(h, taskId).status).toBe('cancelled');
    expect(h.logText(taskId)).toContain(`■ ${h.req.id} is no longer in QA; AI QA stops`);
    expect(h.logText(taskId)).toContain('■ AI QA stopped');
  });

  it('finishes and keeps scheduling when an AI QA checkout cannot be deleted', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: readonly locked');
    await h.settle();
    const checkout = h.invocations(run.id)[0].cwd as string;
    try {
      expect(h.run(run.id)).toMatchObject({ status: 'done', worktree: null });
      expect(qaTask(h, taskId).status).toBe('done');
      expect(h.logText(taskId)).toMatch(/⚠ Could not delete the AI QA checkout .*task-\d+ \(.*\); delete it yourself/);

      const next = h.queueRun('FAKE: commit a.txt');
      await h.settle();
      expect(h.run(next.run.id).status).toBe('review');
    } finally {
      fs.chmodSync(path.join(checkout, 'locked'), 0o755);
    }
  });
  it('stops a review run when the requirement is merged to QA', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: sleep 5000', undefined, 'review');
    await h.runner.tick();
    await waitFor(() => qaTask(h, taskId).status === 'running');

    h.db.prepare("UPDATE requirements SET status = 'qa' WHERE id = ?").run(h.req.id);
    await h.settle();

    expect(h.run(run.id).status).toBe('cancelled');
    expect(qaTask(h, taskId).status).toBe('cancelled');
    expect(h.logText(taskId)).toContain(`■ ${h.req.id} is no longer in review; AI QA stops`);
  });

  it('keeps a review run while the requirement stays in review', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: say checked', undefined, 'review');
    await h.settle();
    expect(h.run(run.id).status).toBe('done');
    expect(qaTask(h, taskId)).toMatchObject({ status: 'done', qa_stage: 'review' });
  });

  it('tells the merge gate once when a QA task finishes', async () => {
    const h = makeLocalHarness();
    const calls: string[] = [];
    const runner = h.newRunner({ onQaFinished: (reqId) => calls.push(reqId) });
    h.queueQaRun('FAKE: say checked', undefined, 'review');
    await h.settle(runner);
    expect(calls).toEqual([h.req.id]);
  });
});
