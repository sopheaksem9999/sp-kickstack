// Fan-out → Local AI CLI engine → watcher, with the real services.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prepareRetry } from '../services/taskRetry.js';
import { OutboxScanner } from '../watcher/outboxScanner.js';
import { sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses } from '../testing/localEngineFixture.js';
import { makeE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

describe('Local AI CLI engine through fan-out', () => {
  it('moves a task QUEUED → RUNNING → IN REVIEW by itself after Start Fan-Out', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: sleep 300', 'FAKE: commit rides.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    expect(goal).toMatchObject({ status: 'queued', project: 'backend' });
    expect(goal.engine_task_id).toMatch(/^local-/);

    await h.runner.tick();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('running');

    await h.runner.idle();
    await h.watcher.scanOnce();
    expect(h.task(goal.id)).toMatchObject({ status: 'in_review', engine_status_raw: 'review' });
    expect(sh(h.repo, ['log', '--format=%s', '-1', goal.branch!])).toBe('add rides.ts');
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_review');
  }, 15_000);

  it('Retry after a failure continues in the same worktree with the retry note and earlier notes', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: commit first.ts', 'FAKE: fail-unless-retry 3']);
    const [goal] = await h.fanOut.execute(req.id);
    await h.settle();
    await h.watcher.scanOnce();
    const failed = h.task(goal.id);
    expect(failed.status).toBe('failed');
    expect(failed.last_error).toContain('failed on purpose (3)');
    const firstRun = h.runner.runs.get(goal.engine_task_id!)!;
    await h.getAdapter('backend').appendNote(firstRun.id, 'Use the v2 endpoint');

    await prepareRetry(h.db, goal.id, 'goal', h.getAdapter);
    await h.fanOut.dispatchGoal(goal.id);
    const retried = h.task(goal.id);
    expect(retried.engine_task_id).not.toBe(firstRun.id);
    await h.settle();
    await h.watcher.scanOnce();

    expect(h.task(goal.id).status).toBe('in_review');
    const secondRun = h.runner.runs.get(retried.engine_task_id)!;
    expect(secondRun.worktree).toBe(firstRun.worktree);
    const prompt = h.prompts(secondRun.id)[0];
    expect(prompt).toContain('## Retry');
    expect(prompt).toContain('## Notes since your last run\nUse the v2 endpoint');
    expect(sh(h.repo, ['rev-list', '--count', `develop..${goal.branch}`])).toBe('2');
  }, 20_000);

  it('pauses for a question and continues with the answer', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: wait-for-note 20000', 'FAKE: commit answer.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    await h.runner.tick();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('running');

    const asked: any = await h.questions.ask({ question: 'Postgres or Redis?', options: ['postgres', 'redis'] }, 'backend', goal.engine_task_id!);
    expect(asked).toMatchObject({ held: true });
    expect(h.task(goal.id).status).toBe('held');
    await h.runner.idle();

    await h.questions.answer(asked.questionId, { option: 'postgres' });
    await h.settle();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('in_review');
    expect(h.prompts(goal.engine_task_id!)[1]).toMatch(/## Notes since your last run[\s\S]*postgres/i);
  }, 20_000);

  it('keeps the board in step while the engine is turned off, and shows it as down', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: sleep 300', 'FAKE: commit rides.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    await h.runner.tick();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('running');

    h.settingsService.updateLocalEngineSettings({ enabled: false });
    await h.runner.idle(); // the running agent finishes while the engine is off
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('in_review');
    expect(h.projectService.getProject('backend')!.engine_status).toBe('down');

    h.settingsService.updateLocalEngineSettings({ enabled: true });
    await h.watcher.scanOnce(); // no backoff: back at once
    expect(h.projectService.getProject('backend')!.engine_status).toBe('ok');
  }, 15_000);

  it('files a question an agent left in its outbox while the bridge was unreachable', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: wait-for-note 20000', 'FAKE: commit answer.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    await h.runner.tick();
    await h.watcher.scanOnce();
    const outbox = path.join(h.ws, 'agent-outbox', 'backend');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(
      path.join(outbox, 'question-1.json'),
      JSON.stringify({ kind: 'question', question: 'Postgres or Redis?', options: ['postgres', 'redis'], project: 'backend', engineTaskId: goal.engine_task_id })
    );
    const scanner = new OutboxScanner(h.projectService, h.tickets, h.questions, path.join(h.ws, 'agent-outbox'));
    expect(await scanner.scanOnce()).toBe(1);
    expect(h.task(goal.id).status).toBe('held');
    expect(fs.existsSync(path.join(outbox, 'processed', 'question-1.json'))).toBe(true);
    await h.runner.cancel(goal.engine_task_id!);
  }, 15_000);

  it('shows the engine as down with the reason when no CLI can run', async () => {
    const h = makeE2E();
    h.settingsService.updateLocalEngineSettings({ enabled: false });
    expect(await h.getAdapter('backend').health()).toEqual({ ok: false, error: 'The Local AI CLI engine is turned off in Settings → AI & Local Engines' });
  });
});
