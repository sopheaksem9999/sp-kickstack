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

  return { db, projectService, requirementService, workspaceService, ticketService, fanOutService, engine, createRequirement, task, sent, getAdapter, linkService };
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
    expect(resolveAgentProfile(h.db, goal.id)).toEqual({ model: 'sonnet', effort: 'high' });
  });

  it('a task pin wins over the requirement and the workspace', async () => {
    h.workspaceService.updateWorkspace('speedx', { agent_model: 'sonnet' });
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { model: 'haiku', effort: 'low' });
    const [goal] = await h.fanOutService.execute(req.id);
    h.db.prepare("UPDATE bridge_tasks SET model_override = 'opus' WHERE id = ?").run(goal.id);

    expect(resolveAgentProfile(h.db, goal.id)).toEqual({ model: 'opus', effort: 'low' });
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

  it('tickets use their requirement choice too, and manual engines ignore it', async () => {
    const req = h.createRequirement(['backend', 'mobile']);
    h.requirementService.updateAgentProfile(req.id, { model: 'opus', effort: 'xhigh' });
    const goals = await h.fanOutService.execute(req.id);
    const manualGoal = goals.find((g) => g.project === 'mobile')!;
    expect(manualGoal.engine_task_id).toBeTruthy();

    const ticket = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: false, req_id: req.id }, 'manual'
    );
    expect(h.sent(h.task(ticket.ticketId).engine_task_id)).toMatchObject({ model: 'opus', effort: 'xhigh' });
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
