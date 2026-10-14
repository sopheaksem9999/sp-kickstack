import { describe, it, expect, afterAll } from 'vitest';
import { createApp } from './app.js';
import { testRequest } from './testHelper.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { QaService } from '../services/qaService.js';
import { cleanLocalHarnesses } from '../testing/localEngineFixture.js';
import { makeE2E, type LocalE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

function appFor(h: LocalE2E, extra: { agentToken?: string; withEngine?: boolean } = {}) {
  const engine = extra.withEngine === false ? undefined : { status: () => h.runner.status(), nudge: () => {} };
  const qaService = new QaService({ db: h.db, projectService: h.projectService, requirementService: h.requirementService, settingsService: h.settingsService, engine });
  return createApp({
    db: h.db, workspaceService: new WorkspaceService(h.db), projectService: h.projectService, requirementService: h.requirementService,
    fanOutService: h.fanOut, linkService: h.linkService, ticketService: h.tickets, broadcaster: new SseBroadcaster(), notifier: new Notifier(),
    getAdapter: h.getAdapter, settingsService: h.settingsService, localEngine: h.runner, qaService, agentToken: extra.agentToken,
  });
}

/** h.req in QA with one goal on backend. */
function inQa(h: LocalE2E): number {
  const now = new Date().toISOString();
  const goalId = Number(
    h.db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'goal', 'Ride tracking', 'done', ?, ?)")
      .run(h.req.id, now, now).lastInsertRowid
  );
  h.db.prepare("UPDATE requirements SET status = 'qa' WHERE id = ?").run(h.req.id);
  return goalId;
}

const runIdOf = (h: LocalE2E, taskId: number) => (h.db.prepare('SELECT id FROM local_runs WHERE bridge_task_id = ?').get(taskId) as { id: string }).id;

describe('AI QA routes', () => {
  it('Run AI QA starts QA (202), refuses while it runs (409), and reports the status', async () => {
    const h = makeE2E();
    const app = appFor(h);
    inQa(h);
    expect(await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).toMatchObject({ status: 202, body: { round: 1, running: true } });
    expect(await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).toMatchObject({
      status: 409, body: { error: `AI QA is already running for ${h.req.id}` },
    });
    expect((await testRequest(app, 'GET', `/api/requirements/${h.req.id}/qa`)).body).toMatchObject({ round: 1, runs: [{ project: 'backend', status: 'queued' }] });
    expect((await testRequest(app, 'GET', '/api/requirements/REQ-999/qa')).status).toBe(404);
  });

  it('Run AI QA in review starts a review round (202)', async () => {
    const h = makeE2E();
    const app = appFor(h);
    inQa(h);
    h.db.prepare("UPDATE requirements SET status = 'in_review' WHERE id = ?").run(h.req.id);
    expect(await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).toMatchObject({ status: 202, body: { stage: 'review', running: true } });
  });

  it('answers 503 when the server runs no Local AI CLI engine', async () => {
    const h = makeE2E();
    inQa(h);
    expect((await testRequest(appFor(h, { withEngine: false }), 'POST', `/api/requirements/${h.req.id}/qa`)).status).toBe(503);
  });

  it('agents report findings and the result with the agent token', async () => {
    const h = makeE2E();
    const app = appFor(h, { agentToken: 'secret' });
    const goalId = inQa(h);
    const task = (await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).body.runs[0].task;
    const runId = runIdOf(h, task.id);
    const headers = { authorization: 'Bearer secret' };
    const finding = { severity: 'major', title: 'Missing validation', file_path: 'src/a.ts', line: 2, project: 'backend', engineTaskId: runId };

    expect((await testRequest(app, 'POST', '/api/agent/qa/comments', { body: finding })).status).toBe(401);
    expect(await testRequest(app, 'POST', '/api/agent/qa/comments', { body: finding, headers })).toMatchObject({ status: 201, body: { duplicate: false } });
    expect(await testRequest(app, 'POST', '/api/agent/qa/result', { body: { passed: false, summary: 'One major', project: 'backend', engineTaskId: runId }, headers }))
      .toMatchObject({ status: 200, body: { passed: false } });
    expect((await testRequest(app, 'GET', `/api/requirements/${h.req.id}/comments`)).body).toEqual([
      expect.objectContaining({ task_id: goalId, source: 'ai-qa', severity: 'major', state: 'open', file_path: 'src/a.ts', line: 2 }),
    ]);
    expect((await testRequest(app, 'POST', '/api/agent/qa/comments', { body: { ...finding, engineTaskId: 'local-nope' }, headers })).status).toBe(404);
    expect((await testRequest(app, 'POST', '/api/agent/qa/comments', { body: { ...finding, severity: 'huge' }, headers })).status).toBe(400);
  });

  it('keeps AI QA tasks out of the requirement graph', async () => {
    const h = makeE2E();
    const app = appFor(h);
    inQa(h);
    await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`);
    const graph = (await testRequest(app, 'GET', `/api/requirements/${h.req.id}/graph`)).body;
    expect(graph.tasks.map((t: any) => t.role)).toEqual(['goal']);
  });
});
