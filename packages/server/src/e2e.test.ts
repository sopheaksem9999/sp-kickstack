import { describe, it, expect, afterAll } from 'vitest';
import { initDatabase } from './db/index.js';
import { ProjectService } from './services/projectService.js';
import { RequirementService } from './services/requirementService.js';
import { FanOutService } from './services/fanOutService.js';
import { LinkService } from './services/linkService.js';
import { TicketService } from './services/ticketService.js';
import { EngineWatcher } from './watcher/engineWatcher.js';
import { FakeEngineServer } from './adapters/fakeEngine.js';
import { StoneforgeAdapter } from './adapters/stoneforgeAdapter.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(__dirname, '../.temp/sp-e2e-workspace');

describe('MVP Acceptance Scenario (§16 Full End-to-End)', () => {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const dbFile = `${workspaceDir}/bridge.db`;

  afterAll(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('runs complete cross-repo flow: fan-out -> xticket -> hold -> unblock with context -> done -> restart recovery', async () => {
    // 1. Three engines running (backend, admin, mobile)
    const backendEngine = new FakeEngineServer('http://127.0.0.1:3457');
    const adminEngine = new FakeEngineServer('http://127.0.0.1:3467');
    const mobileEngine = new FakeEngineServer('http://127.0.0.1:3477');

    const backendAdapter = new StoneforgeAdapter('http://127.0.0.1:3457', '/repos/backend', undefined, backendEngine.fetch);
    const adminAdapter = new StoneforgeAdapter('http://127.0.0.1:3467', '/repos/admin', undefined, adminEngine.fetch);
    const mobileAdapter = new StoneforgeAdapter('http://127.0.0.1:3477', '/repos/mobile', undefined, mobileEngine.fetch);

    const adapterMap: Record<string, StoneforgeAdapter> = {
      backend: backendAdapter,
      admin: adminAdapter,
      mobile: mobileAdapter,
    };
    const getAdapter = (name: string) => adapterMap[name];

    // Initialize database
    let db = initDatabase(dbFile);
    let projectService = new ProjectService(db);
    let requirementService = new RequirementService(db, workspaceDir);
    let linkService = new LinkService(db, projectService, getAdapter);
    let ticketService = new TicketService(db, projectService, linkService, getAdapter);
    let fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
    let watcher = new EngineWatcher(db, projectService, requirementService, getAdapter);

    // Register projects
    projectService.registerProject({
      name: 'backend',
      kind: 'backend',
      repo_path: '/repos/backend',
      engine_type: 'stoneforge',
      engine_url: 'http://127.0.0.1:3457',
      base_branch: 'main',
      contract_path: 'openapi.yaml',
      enabled: true,
    });
    projectService.registerProject({
      name: 'admin',
      kind: 'frontend',
      repo_path: '/repos/admin',
      engine_type: 'stoneforge',
      engine_url: 'http://127.0.0.1:3467',
      base_branch: 'main',
      enabled: true,
    });
    projectService.registerProject({
      name: 'mobile',
      kind: 'mobile',
      repo_path: '/repos/mobile',
      engine_type: 'stoneforge',
      engine_url: 'http://127.0.0.1:3477',
      base_branch: 'main',
      enabled: true,
    });

    // Test connection: all ok
    expect((await backendAdapter.health()).ok).toBe(true);
    expect((await adminAdapter.health()).ok).toBe(true);
    expect((await mobileAdapter.health()).ok).toBe(true);

    // 2. Operator creates REQ-001 for backend and mobile
    const req = requirementService.createRequirement({
      title: 'Rider can see nearby drivers',
      goal: 'Realtime map with driver location markers',
      acceptance_criteria: ['Driver positions shown on map', '5-second polling'],
      affected_projects: ['backend', 'mobile'],
      priority: 'high',
    });
    expect(req.id).toBe('REQ-001');

    // 3. Fan-out
    const goalTasks = await fanOutService.execute(req.id);
    expect(goalTasks.length).toBe(2);
    const backendGoal = goalTasks.find((t) => t.project === 'backend')!;
    const mobileGoal = goalTasks.find((t) => t.project === 'mobile')!;

    // 4. Mobile agent needs endpoint: files blocking ticket to backend
    const ticketResp = await ticketService.createTicket(
      {
        to: 'backend',
        type: 'api_request',
        title: 'GET /v1/rides/nearby',
        body: 'Provide list of active driver lat/longs within radius',
        blocking: true,
      },
      'mobile',
      mobileGoal.engine_task_id!
    );
    expect(ticketResp.blocking).toBe(true);
    expect(ticketResp.target).toBe('backend');

    // Verify mobile is held
    const mobileTaskAfter = db.prepare('SELECT status FROM bridge_tasks WHERE id = ?').get(mobileGoal.id) as any;
    expect(mobileTaskAfter.status).toBe('held');

    // 5. Backend work completes and merges
    const backendTicketTask = db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(ticketResp.ticketId) as any;
    backendEngine.setTaskStatus(backendTicketTask.engine_task_id, 'done', 'merged', 'https://github.com/pulls/101');
    backendEngine.setTaskStatus(backendGoal.engine_task_id!, 'done', 'merged');

    // Watcher polls backend
    await watcher.scanOnce();

    // Check dependency link release
    const releasedLinks = await linkService.evaluateDependencyResolved(ticketResp.ticketId);
    expect(releasedLinks.length).toBe(1);
    expect(releasedLinks[0].state).toBe('released');
    expect(releasedLinks[0].context_md).toContain('Contract file: openapi.yaml');

    // Mobile goal resumes to queued
    const mobileResumed = db.prepare('SELECT status FROM bridge_tasks WHERE id = ?').get(mobileGoal.id) as any;
    expect(mobileResumed.status).toBe('queued');

    // 6. Mobile agent completes work
    mobileEngine.setTaskStatus(mobileGoal.engine_task_id!, 'done', 'merged');
    await watcher.scanOnce();

    // 7. Overall requirement is now done!
    const finalReq = requirementService.getRequirement(req.id);
    expect(finalReq?.status).toBe('done');

    // 8. Test Bridge restart recovery
    db.close();

    // Re-open database from disk
    const reloadedDb = initDatabase(dbFile);
    const reloadedReqService = new RequirementService(reloadedDb, workspaceDir);
    const restoredReq = reloadedReqService.getRequirement('REQ-001');

    expect(restoredReq).toBeDefined();
    expect(restoredReq?.status).toBe('done');
    expect(restoredReq?.title).toBe('Rider can see nearby drivers');

    reloadedDb.close();
  });
});
