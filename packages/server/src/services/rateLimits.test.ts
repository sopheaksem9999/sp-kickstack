// Rate-limited engines: work waits and resumes instead of failing.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { TaskReactor } from './taskReactor.js';
import { RetrySweeper } from './retrySweeper.js';
import { EngineWatcher } from '../watcher/engineWatcher.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import { EngineThrottle } from '../lib/engineThrottle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-rate-limits');
let n = 0;

function makeHarness() {
  const ws = path.join(tempRoot, `case-${process.pid}-${n++}`);
  fs.mkdirSync(path.join(ws, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'mobile'), { recursive: true });

  const clock = { now: Date.now() };
  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const engines = { backend: new FakeEngineServer('http://127.0.0.1:3457'), mobile: new FakeEngineServer('http://127.0.0.1:3477') };
  /** Per engine: answer every request with 429 while set. */
  const limited: Record<string, string | null> = { backend: null, mobile: null };
  const calls: Record<string, number> = { backend: 0, mobile: 0 };
  const fetchFor = (name: 'backend' | 'mobile') => (async (url: any, init?: any) => {
    calls[name]++;
    if (limited[name] !== null) return new Response('slow down', { status: 429, headers: { 'Retry-After': limited[name]! } });
    return engines[name].fetch(url, init);
  }) as typeof fetch;
  const raw: Record<string, StoneforgeAdapter> = {
    backend: new StoneforgeAdapter('http://127.0.0.1:3457', path.join(ws, 'backend'), undefined, fetchFor('backend')),
    mobile: new StoneforgeAdapter('http://127.0.0.1:3477', path.join(ws, 'mobile'), undefined, fetchFor('mobile')),
  };
  const throttle = new EngineThrottle({ now: () => clock.now, maxStartsPerMinute: 0 });
  const getAdapter = throttle.wrap((name) => raw[name]);
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
  const reactor = new TaskReactor(db, requirementService, linkService);
  const watcher = new EngineWatcher(db, projectService, requirementService, getAdapter, undefined, 5000, reactor);
  const sweeper = new RetrySweeper(db, fanOutService, ticketService, linkService, { now: () => clock.now, throttle });

  for (const [name, port] of [['backend', 3457], ['mobile', 3477]] as const) {
    projectService.registerProject({
      name, kind: name, repo_path: path.join(ws, name), engine_type: 'stoneforge',
      engine_url: `http://127.0.0.1:${port}`, base_branch: 'develop', enabled: true,
    });
  }
  const createRequirement = (projects = ['backend', 'mobile']) =>
    requirementService.createRequirement({ title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects: projects, priority: 'normal' });
  const task = (id: number) => db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  const events = (type: string) => (db.prepare('SELECT COUNT(*) c FROM events WHERE type = ?').get(type) as any).c as number;

  return { db, clock, engines, limited, calls, throttle, linkService, ticketService, fanOutService, watcher, sweeper, requirementService, createRequirement, task, events };
}

type H = ReturnType<typeof makeHarness>;

afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('Rate-limited engines', () => {
  let h: H;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  it('waits instead of failing when an engine rate-limits a dispatch, then dispatches after the reset', async () => {
    h.limited.backend = '120';
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);

    const row = h.task(goal.id);
    expect(row.status).toBe('rate_limited');
    expect(row.last_error).toMatch(/rate limited/i);
    expect(Date.parse(row.paused_until) - Date.now()).toBeGreaterThan(100_000);
    expect(row.attempts).toBe(0);
    expect(h.events('task_failed')).toBe(0);

    h.clock.now += 60_000;
    await h.sweeper.sweepOnce();
    expect(h.task(goal.id).status).toBe('rate_limited');

    h.limited.backend = null;
    h.clock.now += 61_000;
    await h.sweeper.sweepOnce();
    expect(h.task(goal.id)).toMatchObject({ status: 'queued' });
    expect(h.task(goal.id).engine_task_id).toBeTruthy();
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_progress');
  });

  it('never exhausts the retry cap however many times the limit repeats', async () => {
    h.limited.backend = '30';
    const [goal] = await h.fanOutService.execute(h.createRequirement(['backend']).id);
    for (let i = 0; i < 8; i++) {
      h.clock.now += 31_000;
      await h.sweeper.sweepOnce();
      expect(h.task(goal.id).status).toBe('rate_limited');
      expect(h.task(goal.id).attempts).toBeLessThan(5);
    }
    h.limited.backend = null;
    h.clock.now += 31_000;
    await h.sweeper.sweepOnce();
    expect(h.task(goal.id).status).toBe('queued');
  });

  it('does not report a rate-limited engine as down and does not poll it until the reset', async () => {
    const req = h.createRequirement(['backend']);
    await h.fanOutService.execute(req.id);
    h.limited.backend = '120';

    await h.watcher.scanOnce();
    const callsAfterTrip = h.calls.backend;
    await h.watcher.scanOnce();
    await h.watcher.scanOnce();

    expect(h.calls.backend).toBe(callsAfterTrip);
    expect(h.events('engine_down')).toBe(0);
    expect(h.throttle.isTripped('backend')).toBe(true);

    h.limited.backend = null;
    h.clock.now += 121_000;
    await h.watcher.scanOnce();
    expect(h.calls.backend).toBeGreaterThan(callsAfterTrip);
  });

  it('shows a task the engine paused for a rate limit, with its resume time, and clears it on resume', async () => {
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    const resumeAt = new Date(Date.now() + 3_600_000).toISOString();
    h.engines.backend.setTaskStatus(goal.engine_task_id!, 'rate_limited' as any, 'rate_limited');
    (h.engines.backend.getTaskData(goal.engine_task_id!) as any).resetAt = resumeAt;

    await h.watcher.scanOnce();

    expect(h.task(goal.id)).toMatchObject({ status: 'rate_limited', paused_until: resumeAt });
    expect(h.events('task_rate_limited')).toBe(1);
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_progress');

    h.engines.backend.setTaskStatus(goal.engine_task_id!, 'running', 'in_progress');
    await h.watcher.scanOnce();
    expect(h.task(goal.id)).toMatchObject({ status: 'running', paused_until: null });
  });

  it('skips release and cancel retries for a tripped engine without using them up', async () => {
    const req = h.createRequirement();
    const goals = await h.fanOutService.execute(req.id);
    const mobileGoal = goals.find((g) => g.project === 'mobile')!;
    const t = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: true }, 'mobile', mobileGoal.engine_task_id!
    );
    h.limited.mobile = '600';
    await h.linkService.evaluateDependencyResolved(t.ticketId);
    expect(h.linkService.getLinksForTask(mobileGoal.id)[0].state).toBe('error');

    const before = h.calls.mobile;
    for (let i = 0; i < 6; i++) {
      h.clock.now += 60_000;
      await h.sweeper.sweepOnce();
    }
    expect(h.calls.mobile).toBe(before);

    h.limited.mobile = null;
    h.clock.now += 601_000;
    await h.sweeper.sweepOnce();
    expect(h.linkService.getLinksForTask(mobileGoal.id)[0].state).toBe('released');
  });

  it('accepts a ticket for a rate-limited engine and dispatches it after the reset', async () => {
    const req = h.createRequirement();
    h.limited.backend = '120';
    const resp = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: false, req_id: req.id },
      'manual'
    );
    expect(resp.status).toBe('rate_limited');

    h.limited.backend = null;
    h.clock.now += 121_000;
    await h.sweeper.sweepOnce();
    expect(h.task(resp.ticketId).engine_task_id).toBeTruthy();
  });
});

describe('Retry task', () => {
  let h: H;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  async function failedInEngine(project: 'backend' | 'mobile' = 'backend') {
    const req = h.createRequirement([project]);
    const [goal] = await h.fanOutService.execute(req.id);
    h.engines[project].setTaskStatus(goal.engine_task_id!, 'failed', 'error');
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('failed');
    return { req, goal };
  }

  it('re-dispatches a goal that failed inside its engine and cancels the old engine task', async () => {
    const { goal } = await failedInEngine();
    const oldEngineId = goal.engine_task_id!;

    await h.fanOutService.retryGoal(goal.id);

    const row = h.task(goal.id);
    expect(row.status).toBe('queued');
    expect(row.engine_task_id).toBeTruthy();
    expect(row.engine_task_id).not.toBe(oldEngineId);
    expect(row.attempts).toBe(1);
    expect(h.engines.backend.getTaskData(oldEngineId)!.status).toBe('cancelled');
    expect(h.engines.backend.getTaskData(row.engine_task_id)!.notes[0]).toMatch(/previous attempt/i);
    expect(h.events('task_retried')).toBe(1);
  });

  it('lets a person retry a goal whose dispatch used up every automatic attempt', async () => {
    const req = h.createRequirement(['backend']);
    h.limited.backend = null;
    const original = (h as any).engines.backend.fetch;
    (h as any).engines.backend.fetch = async () => { throw new Error('connection refused'); };
    const [goal] = await h.fanOutService.execute(req.id);
    h.db.prepare('UPDATE bridge_tasks SET attempts = 5 WHERE id = ?').run(goal.id);
    (h as any).engines.backend.fetch = original;

    await h.fanOutService.retryGoal(goal.id);

    expect(h.task(goal.id).status).toBe('queued');
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_progress');
  });

  it('re-dispatches a ticket that failed inside its engine', async () => {
    const req = h.createRequirement();
    const resp = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: false, req_id: req.id }, 'manual'
    );
    const oldEngineId = h.task(resp.ticketId).engine_task_id;
    h.engines.backend.setTaskStatus(oldEngineId, 'failed', 'error');
    await h.watcher.scanOnce();

    await h.ticketService.retryTicket(resp.ticketId);

    expect(h.task(resp.ticketId).engine_task_id).not.toBe(oldEngineId);
    expect(h.task(resp.ticketId).status).toBe('queued');
  });

  it('refuses to retry finished work or work of a cancelled requirement', async () => {
    const { req, goal } = await failedInEngine();
    h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(goal.id);
    await expect(h.fanOutService.retryGoal(goal.id)).rejects.toMatchObject({ status: 409 });

    h.db.prepare("UPDATE bridge_tasks SET status = 'failed' WHERE id = ?").run(goal.id);
    h.requirementService.updateStatus(req.id, 'cancelled');
    await expect(h.fanOutService.retryGoal(goal.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('Retry task API', () => {
  it('POST /api/tasks/:id/retry retries a failed goal, 404 for unknown tasks', async () => {
    const h = makeHarness();
    const { createApp } = await import('../api/app.js');
    const { testRequest } = await import('../api/testHelper.js');
    const { WorkspaceService } = await import('./workspaceService.js');
    const { SseBroadcaster } = await import('../sse/broadcaster.js');
    const { Notifier } = await import('../notify/notifier.js');
    const app = createApp({
      db: h.db, workspaceService: new WorkspaceService(h.db), projectService: new ProjectService(h.db),
      requirementService: h.requirementService, fanOutService: h.fanOutService, linkService: h.linkService,
      ticketService: h.ticketService, broadcaster: new SseBroadcaster(), notifier: new Notifier(),
    });
    const [goal] = await h.fanOutService.execute(h.createRequirement(['backend']).id);
    h.engines.backend.setTaskStatus(goal.engine_task_id!, 'failed', 'error');
    await h.watcher.scanOnce();

    const ok = await testRequest(app, 'POST', `/api/tasks/${goal.id}/retry`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('queued');
    expect((await testRequest(app, 'POST', '/api/tasks/9999/retry')).status).toBe(404);
    h.db.close();
  });
});
