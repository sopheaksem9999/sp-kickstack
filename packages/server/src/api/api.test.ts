import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { FanOutService } from '../services/fanOutService.js';
import { LinkService } from '../services/linkService.js';
import { TicketService } from '../services/ticketService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import { createApp } from './app.js';
import { testRequest } from './testHelper.js';
import { Express } from 'express';

describe('Bridge REST API Integration Tests', () => {
  let app: Express;
  let db: AppDatabase;
  let backendEngine: FakeEngineServer;
  let mobileEngine: FakeEngineServer;

  beforeEach(() => {
    db = initDatabase(':memory:');
    const projectService = new ProjectService(db);
    const requirementService = new RequirementService(db, '/tmp/test-workspace');

    backendEngine = new FakeEngineServer('http://127.0.0.1:3457');
    mobileEngine = new FakeEngineServer('http://127.0.0.1:3477');

    const backendAdapter = new StoneforgeAdapter(
      'http://127.0.0.1:3457',
      '/tmp/backend',
      undefined,
      backendEngine.fetch
    );
    const mobileAdapter = new StoneforgeAdapter(
      'http://127.0.0.1:3477',
      '/tmp/mobile',
      undefined,
      mobileEngine.fetch
    );

    const getAdapter = (name: string) => (name === 'backend' ? backendAdapter : mobileAdapter);

    const linkService = new LinkService(db, projectService, getAdapter);
    const ticketService = new TicketService(db, projectService, linkService, getAdapter);
    const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
    const broadcaster = new SseBroadcaster();
    const notifier = new Notifier();

    app = createApp({
      db,
      projectService,
      requirementService,
      fanOutService,
      linkService,
      ticketService,
      broadcaster,
      notifier,
    });

    // Seed projects
    projectService.registerProject({
      name: 'backend',
      kind: 'backend',
      repo_path: '/tmp/backend',
      engine_type: 'stoneforge',
      engine_url: 'http://127.0.0.1:3457',
      base_branch: 'main',
      enabled: true,
    });

    projectService.registerProject({
      name: 'mobile',
      kind: 'mobile',
      repo_path: '/tmp/mobile',
      engine_type: 'stoneforge',
      engine_url: 'http://127.0.0.1:3477',
      base_branch: 'main',
      enabled: true,
    });
  });

  it('GET /api/health returns ok', async () => {
    const res = await testRequest(app, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe('0.2.0');
  });

  it('GET /api/projects lists registered projects', async () => {
    const res = await testRequest(app, 'GET', '/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.map((p: any) => p.name)).toContain('backend');
  });

  it('POST /api/requirements creates a requirement', async () => {
    const res = await testRequest(app, 'POST', '/api/requirements', {
      body: {
        title: 'Ride tracking',
        goal: 'Track drivers on map',
        acceptance_criteria: ['Map pins updated'],
        affected_projects: ['backend', 'mobile'],
        priority: 'high',
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('REQ-001');
    expect(res.body.status).toBe('draft');
  });

  it('POST /api/requirements/:id/ready triggers fanout', async () => {
    const createRes = await testRequest(app, 'POST', '/api/requirements', {
      body: {
        title: 'Ride tracking',
        goal: 'Track drivers on map',
        acceptance_criteria: ['Map pins updated'],
        affected_projects: ['backend', 'mobile'],
      },
    });

    const reqId = createRes.body.id;

    const fanOutRes = await testRequest(app, 'POST', `/api/requirements/${reqId}/ready`);
    expect(fanOutRes.status).toBe(200);
    expect(fanOutRes.body.ok).toBe(true);
    expect(fanOutRes.body.tasks.length).toBe(2);
  });

  it('POST /api/agent/tickets creates ticket from agent environment', async () => {
    // 1. Create requirement & fan-out
    const createRes = await testRequest(app, 'POST', '/api/requirements', {
      body: {
        title: 'API endpoint requirement',
        goal: 'Need endpoints',
        acceptance_criteria: ['Endpoints live'],
        affected_projects: ['backend', 'mobile'],
      },
    });
    const fanOutRes = await testRequest(app, 'POST', `/api/requirements/${createRes.body.id}/ready`);
    const mobileTask = fanOutRes.body.tasks.find((t: any) => t.project === 'mobile');

    // 2. Mobile agent files ticket
    const ticketRes = await testRequest(app, 'POST', '/api/agent/tickets', {
      body: {
        to: 'backend',
        type: 'api_request',
        title: 'GET /v1/routes',
        body: 'Provide route calculation endpoint',
        blocking: true,
        project: 'mobile',
        engineTaskId: mobileTask.engine_task_id,
      },
    });

    expect(ticketRes.status).toBe(201);
    expect(ticketRes.body.ticketId).toBeDefined();
    expect(ticketRes.body.blocking).toBe(true);
  });
});
