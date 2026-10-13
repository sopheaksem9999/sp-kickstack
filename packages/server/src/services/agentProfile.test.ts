// Agent model / effort: workspace default, requirement choice, recorded per run.
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
import { WorkspaceService } from './workspaceService.js';
import { testRequest } from '../api/testHelper.js';
import { ReviewService } from './reviewService.js';
import { RetrySweeper } from './retrySweeper.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import { ManualAdapter } from '../adapters/manualAdapter.js';
import { resolveAgentProfile } from './agentProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-agent-profile');
let n = 0;

function makeHarness() {
  const ws = path.join(tempRoot, `case-${process.pid}-${n++}`);
  for (const p of ['backend', 'mobile']) fs.mkdirSync(path.join(ws, p), { recursive: true });
  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const workspaceService = new WorkspaceService(db);
  const engine = new FakeEngineServer('http://127.0.0.1:3457');
  const backend = new StoneforgeAdapter('http://127.0.0.1:3457', path.join(ws, 'backend'), undefined, ((u: any, i?: any) => engine.fetch(u, i)) as typeof fetch);
  const manual = new ManualAdapter();
  const getAdapter = (name: string) => (name === 'backend' ? backend : (manual as any));
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
  const review = new ReviewService(db, requirementService, fanOutService, ticketService, getAdapter);
  const clock = { now: Date.now() };
  const sweeper = new RetrySweeper(db, fanOutService, ticketService, linkService, { now: () => clock.now });

  db.exec(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('speedx', 'Speedx', 'x', 'x')`);
  projectService.registerProject({
    name: 'backend', kind: 'backend', repo_path: path.join(ws, 'backend'), engine_type: 'stoneforge',
    engine_url: 'http://127.0.0.1:3457', base_branch: 'develop', enabled: true, workspace_id: 'speedx',
  } as any);
  projectService.registerProject({
    name: 'mobile', kind: 'mobile', repo_path: path.join(ws, 'mobile'), engine_type: 'manual',
    base_branch: 'develop', enabled: true, workspace_id: 'speedx',
  } as any);

  const createRequirement = (projects = ['backend']) =>
    requirementService.createRequirement({
      workspace_id: 'speedx', title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects: projects, priority: 'normal',
    });
  const task = (id: number) => db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  const sent = (engineId: string) => engine.getTaskData(engineId) as any;
  /** Send matching requests to `handler`; `pass` forwards one to the fake engine. */
  const intercept = (match: (url: string, init?: any) => boolean, handler: (pass: () => Promise<Response>) => Promise<Response>) => {
    const original = engine.fetch.bind(engine);
    (engine as any).fetch = async (url: any, init?: any) => {
      const pass = () => original(url, init);
      return match(String(url), init) ? handler(pass) : pass();
    };
    return () => { (engine as any).fetch = original; };
  };
  /** A requirement with one dispatched backend goal; `profile` is the requirement's choice. */
  const startGoal = async (profile: { model?: string; effort?: any } = {}) => {
    const req = createRequirement();
    if (profile.model || profile.effort) requirementService.updateAgentProfile(req.id, profile);
    const [goal] = await fanOutService.execute(req.id);
    return { req, goal };
  };
  /** The goal stopped on its own (engine still lists the task as running). */
  const fail = (id: number) => db.prepare("UPDATE bridge_tasks SET status = 'failed', last_error = 'boom' WHERE id = ?").run(id);
  const makeApp = async () => {
    const { createApp } = await import('../api/app.js');
    const { SseBroadcaster } = await import('../sse/broadcaster.js');
    const { Notifier } = await import('../notify/notifier.js');
    return createApp({
      db, workspaceService, projectService, requirementService, fanOutService, linkService, ticketService,
      broadcaster: new SseBroadcaster(), notifier: new Notifier(), getAdapter,
    });
  };

  return {
    db, projectService, requirementService, workspaceService, ticketService, fanOutService, engine, createRequirement, task, sent,
    getAdapter, linkService, review, clock, sweeper, intercept, startGoal, fail, makeApp,
  };
}

type H = ReturnType<typeof makeHarness>;

afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('Agent model and effort', () => {
  let h: H;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  it('sends nothing and records nothing when no model or effort is set', async () => {
    const [goal] = await h.fanOutService.execute(h.createRequirement().id);
    expect(h.sent(goal.engine_task_id!).model).toBeUndefined();
    expect(h.sent(goal.engine_task_id!).effort).toBeUndefined();
    expect(h.task(goal.id)).toMatchObject({ model: null, effort: null });
  });

  it('uses the requirement choice over the workspace default, field by field, and records it', async () => {
    h.workspaceService.updateWorkspace('speedx', { agent_model: 'sonnet', agent_effort: 'medium' });
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { effort: 'high' });

    const [goal] = await h.fanOutService.execute(req.id);

    expect(h.sent(goal.engine_task_id!)).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(h.task(goal.id)).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(resolveAgentProfile(h.db, goal.id)).toEqual({ model: 'sonnet', effort: 'high', cli: null });
  });

  it('a task pin wins over the requirement and the workspace', async () => {
    h.workspaceService.updateWorkspace('speedx', { agent_model: 'sonnet' });
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { model: 'haiku', effort: 'low' });
    const [goal] = await h.fanOutService.execute(req.id);
    h.db.prepare("UPDATE bridge_tasks SET model_override = 'opus' WHERE id = ?").run(goal.id);

    expect(resolveAgentProfile(h.db, goal.id)).toEqual({ model: 'opus', effort: 'low', cli: null });
  });

  it('keeps a value on undefined, clears it on null, and refuses bad values', () => {
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { model: 'opus', effort: 'max' });
    expect(h.requirementService.updateAgentProfile(req.id, { effort: 'high' })).toMatchObject({ agent_model: 'opus', agent_effort: 'high' });
    expect(h.requirementService.updateAgentProfile(req.id, { model: null })).toMatchObject({ agent_model: null, agent_effort: 'high' });
    expect(() => h.requirementService.updateAgentProfile(req.id, { model: 'rm -rf /' })).toThrow(/Model ids use/);
    expect(() => h.requirementService.updateAgentProfile(req.id, { effort: 'huge' as any })).toThrow();
    expect(() => h.requirementService.updateAgentProfile('REQ-404', { model: 'opus' })).toThrow(/not found/);
  });

  it('workspace defaults are set and cleared without touching rules', () => {
    h.workspaceService.updateWorkspace('speedx', { rules: 'Be careful', agent_model: 'opus', agent_effort: 'high' });
    expect(h.workspaceService.updateWorkspace('speedx', { agent_effort: null })).toMatchObject({ rules: 'Be careful', agent_model: 'opus', agent_effort: null });
    expect(h.workspaceService.getWorkspace('speedx')).toMatchObject({ agent_model: 'opus' });
  });

  it('tickets use their requirement choice too', async () => {
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { model: 'opus', effort: 'xhigh' });

    const ticket = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: false, req_id: req.id }, 'manual'
    );

    expect(h.sent(h.task(ticket.ticketId).engine_task_id)).toMatchObject({ model: 'opus', effort: 'xhigh' });
    expect(h.task(ticket.ticketId)).toMatchObject({ model: 'opus', effort: 'xhigh' });
  });

  it('records no model or effort for a manual project, whose work no agent runs', async () => {
    const req = h.createRequirement(['backend', 'mobile']);
    h.requirementService.updateAgentProfile(req.id, { model: 'opus', effort: 'xhigh' });

    const goals = await h.fanOutService.execute(req.id);
    const manualGoal = goals.find((g) => g.project === 'mobile')!;
    const backendGoal = goals.find((g) => g.project === 'backend')!;
    const manualTicket = await h.ticketService.createTicket(
      { to: 'mobile', type: 'api_request', title: 'Screen', body: 'Build the screen please', blocking: false, req_id: req.id }, 'manual'
    );

    expect(manualGoal.engine_task_id).toBeTruthy();
    expect(h.task(manualGoal.id)).toMatchObject({ status: 'queued', model: null, effort: null });
    expect(h.task(manualTicket.ticketId)).toMatchObject({ status: 'queued', model: null, effort: null });
    expect(h.task(backendGoal.id)).toMatchObject({ model: 'opus', effort: 'xhigh' });
  });

  it('PUT /api/requirements/:id/agent-profile saves and validates', async () => {
    const { createApp } = await import('../api/app.js');
    const { testRequest } = await import('../api/testHelper.js');
    const { SseBroadcaster } = await import('../sse/broadcaster.js');
    const { Notifier } = await import('../notify/notifier.js');
    const app = createApp({
      db: h.db, workspaceService: h.workspaceService, projectService: h.projectService, requirementService: h.requirementService,
      fanOutService: h.fanOutService, linkService: h.linkService, ticketService: h.ticketService,
      broadcaster: new SseBroadcaster(), notifier: new Notifier(), getAdapter: h.getAdapter,
    });
    const req = h.createRequirement();

    const ok = await testRequest(app, 'PUT', `/api/requirements/${req.id}/agent-profile`, { body: { model: 'opus', effort: 'high' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ agent_model: 'opus', agent_effort: 'high' });
    expect((await testRequest(app, 'PUT', `/api/requirements/${req.id}/agent-profile`, { body: { effort: 'huge' } })).status).toBe(400);
    const ws = await testRequest(app, 'PUT', '/api/workspaces/speedx', { body: { agent_model: 'sonnet' } });
    expect(ws.body.agent_model).toBe('sonnet');
  });
});

describe('Pin a model and effort on Retry and Request changes', () => {
  let h: H;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  const retryBody = (goalId: number, body: unknown) => async () => {
    const app = await h.makeApp();
    return testRequest(app, 'POST', `/api/tasks/${goalId}/retry`, { body });
  };

  it('Retry pins the model and effort: the new engine task gets them and the row records them', async () => {
    const { goal } = await h.startGoal();
    h.fail(goal.id);

    const retried = await h.fanOutService.retryGoal(goal.id, { model: 'opus', effort: 'max' });

    expect(retried).toMatchObject({ status: 'queued', model_override: 'opus', effort_override: 'max', model: 'opus', effort: 'max' });
    expect(retried.engine_task_id).not.toBe(goal.engine_task_id);
    expect(h.sent(retried.engine_task_id!)).toMatchObject({ model: 'opus', effort: 'max' });
  });

  it('retrying a ticket pins too', async () => {
    const { req } = await h.startGoal({ model: 'sonnet' });
    const ticket = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: false, req_id: req.id }, 'manual'
    );
    h.fail(ticket.ticketId);

    const retried = await h.ticketService.retryTicket(ticket.ticketId, { effort: 'high' });

    expect(retried).toMatchObject({ status: 'queued', model_override: null, effort_override: 'high', model: 'sonnet', effort: 'high' });
    expect(h.sent(retried.engine_task_id!)).toMatchObject({ model: 'sonnet', effort: 'high' });
  });

  it('keeps the pins on a retry without model or effort', async () => {
    const { goal } = await h.startGoal();
    h.fail(goal.id);
    await h.fanOutService.retryGoal(goal.id, { model: 'opus', effort: 'max' });
    h.fail(goal.id);

    const again = await h.fanOutService.retryGoal(goal.id);

    expect(again).toMatchObject({ model_override: 'opus', effort_override: 'max', model: 'opus', effort: 'max' });
    expect(h.sent(again.engine_task_id!)).toMatchObject({ model: 'opus', effort: 'max' });
  });

  it('the pin survives an automatic re-dispatch', async () => {
    const { goal } = await h.startGoal({ model: 'sonnet' });
    h.fail(goal.id);
    const restore = h.intercept((url, init) => init?.method === 'POST' && url.endsWith('/api/goals'), async () => new Response('down', { status: 500 }));

    const failed = await h.fanOutService.retryGoal(goal.id, { model: 'opus' });

    // The old run is gone and no new one started, so no model is claimed.
    expect(failed).toMatchObject({ status: 'failed', engine_task_id: null, model_override: 'opus', model: null, effort: null });
    restore();
    h.clock.now += 60_000;
    expect(await h.sweeper.sweepOnce()).toMatchObject({ goals: 1 });

    const row = h.task(goal.id);
    expect(row).toMatchObject({ status: 'queued', model_override: 'opus', model: 'opus' });
    expect(h.sent(row.engine_task_id)).toMatchObject({ model: 'opus' });
  });

  it('null clears a pin, so the next run uses the requirement choice again', async () => {
    const { goal } = await h.startGoal({ model: 'sonnet', effort: 'low' });
    h.fail(goal.id);
    await h.fanOutService.retryGoal(goal.id, { model: 'opus', effort: 'max' });
    h.fail(goal.id);

    const cleared = await h.fanOutService.retryGoal(goal.id, { model: null });

    expect(cleared).toMatchObject({ model_override: null, effort_override: 'max', model: 'sonnet', effort: 'max' });
    expect(h.sent(cleared.engine_task_id!)).toMatchObject({ model: 'sonnet', effort: 'max' });
  });

  it('refuses a bad model or effort with 400 before touching the task or the engine', async () => {
    const { goal } = await h.startGoal();
    h.fail(goal.id);
    h.db.prepare("UPDATE bridge_tasks SET model_override = 'sonnet' WHERE id = ?").run(goal.id);
    const before = h.task(goal.id);

    for (const body of [{ model: 'bad model!' }, { effort: 'huge' }, { model: 42 }]) {
      expect((await retryBody(goal.id, body)()).status).toBe(400);
    }
    await expect(h.fanOutService.retryGoal(goal.id, { model: 'bad model!' })).rejects.toThrow(/Model ids use/);

    expect(h.task(goal.id)).toEqual(before);
    expect(h.sent(goal.engine_task_id!).status).not.toBe('cancelled');
    expect(h.sent(String(Number(goal.engine_task_id) + 1))).toBeUndefined();
  });

  it('restores the previous pin, model and effort when the old engine task cannot be stopped', async () => {
    const { goal } = await h.startGoal({ model: 'haiku', effort: 'medium' });
    h.fail(goal.id);
    h.db.prepare("UPDATE bridge_tasks SET model_override = 'sonnet', effort_override = 'low' WHERE id = ?").run(goal.id);
    expect(h.task(goal.id)).toMatchObject({ model: 'haiku', effort: 'medium' });
    h.intercept((url) => url.endsWith('/cancel'), async () => new Response('busy', { status: 409 }));

    await expect(h.fanOutService.retryGoal(goal.id, { model: 'opus', effort: 'max' })).rejects.toMatchObject({ status: 503 });

    expect(h.task(goal.id)).toMatchObject({
      status: 'failed', engine_task_id: goal.engine_task_id,
      model_override: 'sonnet', effort_override: 'low', model: 'haiku', effort: 'medium',
    });
  });

  it('POST /api/tasks/:id/retry takes the pin from the body', async () => {
    const { goal } = await h.startGoal();
    h.fail(goal.id);

    const res = await retryBody(goal.id, { model: 'opus' })();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'queued', model_override: 'opus', effort_override: null, model: 'opus' });
    expect(h.sent(res.body.engine_task_id)).toMatchObject({ model: 'opus' });
    expect(h.task(goal.id)).toMatchObject({ model_override: 'opus', model: 'opus' });
  });

  it('POST /api/tasks/:id/retry still works without a body', async () => {
    const { goal } = await h.startGoal({ effort: 'low' });
    h.fail(goal.id);
    const app = await h.makeApp();

    const res = await testRequest(app, 'POST', `/api/tasks/${goal.id}/retry`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'queued', model_override: null, effort_override: null, effort: 'low' });
  });

  describe('Request changes', () => {
    /** A goal and a ticket of one requirement, both finished and waiting in review with a comment each. */
    const inReview = async () => {
      const { req, goal } = await h.startGoal({ model: 'sonnet' });
      const ticket = await h.ticketService.createTicket(
        { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: false, req_id: req.id }, 'manual'
      );
      const ids = [goal.id, ticket.ticketId];
      const again = () => {
        for (const id of ids) {
          h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(id);
          h.review.addComment(req.id, { task_id: id, body: 'Fix it' });
        }
        h.db.prepare("UPDATE requirements SET status = 'in_review' WHERE id = ?").run(req.id);
      };
      again();
      return { req, ids, again };
    };

    it('pins every re-run task, sends the pin to the engine, and keeps it when the next round names none', async () => {
      const { req, ids, again } = await inReview();

      await h.review.requestChanges(req.id, { effort: 'xhigh' });

      for (const id of ids) {
        const row = h.task(id);
        expect(row).toMatchObject({ status: 'queued', model_override: null, effort_override: 'xhigh', model: 'sonnet', effort: 'xhigh' });
        expect(h.sent(row.engine_task_id)).toMatchObject({ model: 'sonnet', effort: 'xhigh' });
      }

      again();
      await h.review.requestChanges(req.id);

      for (const id of ids) {
        const row = h.task(id);
        expect(row).toMatchObject({ effort_override: 'xhigh', effort: 'xhigh' });
        expect(h.sent(row.engine_task_id)).toMatchObject({ model: 'sonnet', effort: 'xhigh' });
      }

      again();
      await h.review.requestChanges(req.id, { model: 'opus', effort: null });

      for (const id of ids) {
        const row = h.task(id);
        expect(row).toMatchObject({ model_override: 'opus', effort_override: null, model: 'opus', effort: null });
        expect(h.sent(row.engine_task_id)).toMatchObject({ model: 'opus' });
        expect(h.sent(row.engine_task_id).effort).toBeUndefined();
      }
    });

    it('refuses a bad model or effort before sending anything back', async () => {
      const { req, ids } = await inReview();
      const before = ids.map((id) => h.task(id));

      await expect(h.review.requestChanges(req.id, { model: 'bad model!' })).rejects.toThrow(/Model ids use/);
      await expect(h.review.requestChanges(req.id, { effort: 'huge' as any })).rejects.toThrow();

      expect(ids.map((id) => h.task(id))).toEqual(before);
      expect(h.review.listComments(req.id).map((c) => c.state)).toEqual(['open', 'open']);
      expect(h.sent(before[0].engine_task_id).status).not.toBe('cancelled');
    });

    it('POST /api/requirements/:id/request-changes refuses a bad effort with 400 and changes nothing', async () => {
      const { req, ids } = await inReview();
      const before = ids.map((id) => h.task(id));
      const app = await h.makeApp();

      const res = await testRequest(app, 'POST', `/api/requirements/${req.id}/request-changes`, { body: { effort: 'huge' } });

      expect(res.status).toBe(400);
      expect(ids.map((id) => h.task(id))).toEqual(before);
      expect(h.review.listComments(req.id).map((c) => c.state)).toEqual(['open', 'open']);
      expect(h.sent(before[0].engine_task_id).status).not.toBe('cancelled');
      expect(h.sent(before[1].engine_task_id).status).not.toBe('cancelled');
      expect(h.db.prepare('SELECT status FROM requirements WHERE id = ?').get(req.id)).toEqual({ status: 'in_review' });
    });

    it('restores the previous pin, model and effort of a task whose old engine task cannot be stopped, and re-runs the others', async () => {
      const { req, ids } = await inReview();
      const [stuckId, otherId] = ids;
      h.db
        .prepare("UPDATE bridge_tasks SET model_override = 'haiku', effort_override = 'low', model = 'haiku', effort = 'low' WHERE id = ?")
        .run(stuckId);
      const stuck = h.task(stuckId);
      h.intercept((url) => url.endsWith(`/api/tasks/${stuck.engine_task_id}/cancel`), async () => new Response('busy', { status: 409 }));

      const result = await h.review.requestChanges(req.id, { model: 'opus', effort: 'max' });

      expect(result.results.find((r) => r.taskId === stuckId)).toMatchObject({ ok: false, error: expect.stringMatching(/Could not stop the old engine task/) });
      expect(result.results.find((r) => r.taskId === otherId)).toMatchObject({ ok: true });
      // The task that could not be stopped keeps its old run, its old pin and its comment.
      expect(h.task(stuckId)).toMatchObject({
        status: 'in_review', engine_task_id: stuck.engine_task_id,
        model_override: 'haiku', effort_override: 'low', model: 'haiku', effort: 'low',
      });
      expect(h.review.listComments(req.id).map((c) => [c.task_id, c.state])).toEqual([[stuckId, 'open'], [otherId, 'sent']]);
      // The other task took the new pin.
      const other = h.task(otherId);
      expect(other).toMatchObject({ status: 'queued', model_override: 'opus', effort_override: 'max', model: 'opus', effort: 'max' });
      expect(h.sent(other.engine_task_id)).toMatchObject({ model: 'opus', effort: 'max' });
    });
  });
});
