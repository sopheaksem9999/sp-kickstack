import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { WorkspaceService } from '../services/workspaceService.js';
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
  let workspaceService: WorkspaceService;
  let projectService: ProjectService;
  let requirementService: RequirementService;
  let backendEngine: FakeEngineServer;
  let mobileEngine: FakeEngineServer;

  beforeEach(() => {
    db = initDatabase(':memory:');
    workspaceService = new WorkspaceService(db);
    projectService = new ProjectService(db);
    requirementService = new RequirementService(db, '/tmp/test-workspace');

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
      workspaceService,
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

  afterEach(() => {
    db.close();
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

  it('GET /api/workspaces and POST /api/workspaces manage workspaces and filter projects/requirements', async () => {
    // 1. Check default workspace
    const listRes = await testRequest(app, 'GET', '/api/workspaces');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body[0].id).toBe('default');

    // 2. Create Workspace B
    const createWsRes = await testRequest(app, 'POST', '/api/workspaces', {
      body: {
        id: 'workspace-b',
        name: 'Workspace B',
        description: 'Secondary workspace',
        rules: 'Use clean architecture patterns.',
        context: 'Golang microservices and Flutter client.',
      },
    });
    expect(createWsRes.status).toBe(201);
    expect(createWsRes.body.id).toBe('workspace-b');
    expect(createWsRes.body.rules).toBe('Use clean architecture patterns.');

    // 3. Register a project in Workspace B
    const createProjRes = await testRequest(app, 'POST', '/api/projects', {
      body: {
        name: 'flutter-client',
        workspace_id: 'workspace-b',
        kind: 'mobile',
        repo_path: '/tmp/flutter-client',
        engine_type: 'manual',
      },
    });
    expect(createProjRes.status).toBe(201);

    // 4. Query projects with and without filter
    const allProjectsRes = await testRequest(app, 'GET', '/api/projects');
    expect(allProjectsRes.body.length).toBe(3); // backend, mobile, flutter-client

    const wsBProjectsRes = await testRequest(app, 'GET', '/api/projects?workspace=workspace-b');
    expect(wsBProjectsRes.body.length).toBe(1);
    expect(wsBProjectsRes.body[0].name).toBe('flutter-client');

    const defaultProjectsRes = await testRequest(app, 'GET', '/api/projects?workspace=default');
    expect(defaultProjectsRes.body.length).toBe(2);

    // 5. Update workspace rules
    const updateRes = await testRequest(app, 'PUT', '/api/workspaces/workspace-b', {
      body: {
        rules: 'Updated rules: 100% test coverage mandatory.',
      },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.rules).toBe('Updated rules: 100% test coverage mandatory.');
  });
});

