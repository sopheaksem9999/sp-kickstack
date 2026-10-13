import { describe, it, expect, afterAll } from 'vitest';
import { createApp } from './app.js';
import { testRequest } from './testHelper.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { cleanLocalHarnesses } from '../testing/localEngineFixture.js';
import { makeE2E, type LocalE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

function appFor(h: LocalE2E, withEngine = true) {
  return createApp({
    db: h.db, workspaceService: new WorkspaceService(h.db), projectService: h.projectService, requirementService: h.requirementService,
    fanOutService: h.fanOut, linkService: h.linkService, ticketService: h.tickets, broadcaster: new SseBroadcaster(), notifier: new Notifier(),
    getAdapter: h.getAdapter, settingsService: h.settingsService, ...(withEngine ? { localEngine: h.runner } : {}),
  });
}

describe('Local AI CLI engine routes', () => {
  it('reads and saves the settings, refusing bad values with the field name', async () => {
    const h = makeE2E();
    const app = appFor(h);
    expect((await testRequest(app, 'GET', '/api/settings/local-engine')).body).toMatchObject({ enabled: true, agentCli: 'claude-cli', maxParallel: 2 });
    const saved = await testRequest(app, 'PUT', '/api/settings/local-engine', { body: { maxParallel: 4 } });
    expect(saved).toMatchObject({ status: 200, body: { maxParallel: 4 } });
    const refused = await testRequest(app, 'PUT', '/api/settings/local-engine', { body: { maxParallel: 20 } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('maxParallel');
  });

  it('reports live status, or 503 when the server runs no local engine', async () => {
    const h = makeE2E();
    expect((await testRequest(appFor(h), 'GET', '/api/local-engine/status')).body).toMatchObject({ enabled: true, cli: 'claude-cli', counts: { running: 0 } });
    expect((await testRequest(appFor(h, false), 'GET', '/api/local-engine/status')).status).toBe(503);
  });

  it('hands queued Manual tasks to the local engine when the repository switches to Local AI CLI', async () => {
    const h = makeE2E();
    h.projectService.updateProject('backend', { engine_type: 'manual' });
    const req = h.createRequirement(['FAKE: commit handed.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    expect(goal.engine_task_id).toMatch(/^manual-/);
    const otherReq = h.createRequirement(['FAKE: commit other.ts']);
    const [heldGoal] = await h.fanOut.execute(otherReq.id);
    h.db.prepare("UPDATE bridge_tasks SET status = 'held' WHERE id = ?").run(heldGoal.id);

    const res = await testRequest(appFor(h), 'PUT', '/api/projects/backend', { body: { engine_type: 'local' } });
    expect(res.status).toBe(200);
    expect(h.task(goal.id)).toMatchObject({ status: 'queued' });
    expect(h.task(goal.id).engine_task_id).toMatch(/^local-/);
    expect(h.task(heldGoal.id).engine_task_id).toMatch(/^manual-/);

    await h.settle();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('in_review');
  }, 15_000);
});
