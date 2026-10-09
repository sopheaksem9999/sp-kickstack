import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

  beforeAll(() => {
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
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec(`
      DELETE FROM shared_assets;
      DELETE FROM events;
      DELETE FROM links;
      DELETE FROM bridge_tasks;
      DELETE FROM requirement_projects;
      DELETE FROM requirements;
      DELETE FROM sprints;
      DELETE FROM projects;
    `);

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

  it('PUT /api/requirements/:id/projects and merge-policy update requirement', async () => {
    const createRes = await testRequest(app, 'POST', '/api/requirements', {
      body: {
        title: 'Project update test',
        goal: 'Testing editing projects and merge policy',
        acceptance_criteria: ['Saved'],
        affected_projects: ['backend'],
        merge_policy: 'manual_review_merge',
      },
    });
    expect(createRes.status).toBe(201);
    const reqId = createRes.body.id;
    expect(createRes.body.affected_projects).toEqual(['backend']);
    expect(createRes.body.merge_policy).toBe('manual_review_merge');

    // Update projects
    const updateProjRes = await testRequest(app, 'PUT', `/api/requirements/${reqId}/projects`, {
      body: {
        affected_projects: ['backend', 'mobile'],
      },
    });
    expect(updateProjRes.status).toBe(200);
    expect(updateProjRes.body.affected_projects.sort()).toEqual(['backend', 'mobile']);

    // Update merge policy to auto_merge_main
    const updatePolicyRes = await testRequest(app, 'PUT', `/api/requirements/${reqId}/merge-policy`, {
      body: {
        merge_policy: 'auto_merge_main',
      },
    });
    expect(updatePolicyRes.status).toBe(200);
    expect(updatePolicyRes.body.merge_policy).toBe('auto_merge_main');
  });

  it('GET /api/assets, POST /api/assets/shared, and DELETE manage shared assets and ticket attachments', async () => {
    // 1. Create a requirement with attachments
    await testRequest(app, 'POST', '/api/requirements', {
      body: {
        title: 'Requirement with attachment',
        goal: 'Testing asset hub aggregation',
        acceptance_criteria: ['Attached'],
        affected_projects: ['backend'],
        attachments: [
          { name: 'schema.sql', size: 1024, type: 'text/plain', data_url: 'data:text/plain;base64,Zm9v' },
        ],
      },
    });

    // 2. Query assets
    const initialAssets = await testRequest(app, 'GET', '/api/assets');
    expect(initialAssets.status).toBe(200);
    expect(initialAssets.body.ticket_attachments.length).toBeGreaterThan(0);
    expect(initialAssets.body.ticket_attachments.some((a: any) => a.name === 'schema.sql')).toBe(true);

    // 3. Create a shared asset
    const createSharedRes = await testRequest(app, 'POST', '/api/assets/shared', {
      body: {
        workspace_id: 'default',
        name: 'openapi-contract.yaml',
        type: 'application/x-yaml',
        size: 2048,
        data_url: 'data:text/yaml;base64,YXBpOiB2MQ==',
        notes: 'Shared API contract for all microservices',
      },
    });
    expect(createSharedRes.status).toBe(201);
    expect(createSharedRes.body.id).toBeDefined();
    const assetId = createSharedRes.body.id;

    // 4. Verify asset appears in GET
    const afterAssets = await testRequest(app, 'GET', '/api/assets?workspace=default');
    expect(afterAssets.body.shared_assets.some((a: any) => a.id === assetId)).toBe(true);

    // 5. Delete shared asset
    const deleteRes = await testRequest(app, 'DELETE', `/api/assets/shared/${assetId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);

    // 6. Verify deleted
    const finalAssets = await testRequest(app, 'GET', '/api/assets?workspace=default');
    expect(finalAssets.body.shared_assets.some((a: any) => a.id === assetId)).toBe(false);
  });

  it('Sprint API: creates, lists, starts, assigns requirement, and completes with rollover', async () => {
    // 1. Create a planned sprint
    const createSprintRes = await testRequest(app, 'POST', '/api/sprints', {
      body: {
        workspace_id: 'default',
        name: 'Sprint 1 - Launch',
        goal: 'Complete launch tasks',
        start_date: '2026-10-10',
        end_date: '2026-10-24',
      },
    });
    expect(createSprintRes.status).toBe(201);
    expect(createSprintRes.body.id).toBeDefined();
    expect(createSprintRes.body.status).toBe('planned');
    const sprintId = createSprintRes.body.id;

    // 2. List sprints
    const listRes = await testRequest(app, 'GET', '/api/sprints?workspace=default');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].id).toBe(sprintId);

    // 3. Start sprint
    const startRes = await testRequest(app, 'POST', `/api/sprints/${sprintId}/start`);
    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe('active');

    // 4. Create requirement in backlog and assign to sprint
    const createReqRes = await testRequest(app, 'POST', '/api/requirements', {
      body: {
        workspace_id: 'default',
        title: 'User Login Screen',
        goal: 'Allow users to log in',
        affected_projects: ['backend'],
      },
    });
    expect(createReqRes.status).toBe(201);
    const reqId = createReqRes.body.id;
    expect(createReqRes.body.sprint_id).toBeNull();

    // Assign to sprint via PUT /api/requirements/:id/sprint
    const assignRes = await testRequest(app, 'PUT', `/api/requirements/${reqId}/sprint`, {
      body: { sprint_id: sprintId },
    });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.sprint_id).toBe(sprintId);

    // 5. Complete sprint -> incomplete requirement rolls back to backlog (sprint_id = null)
    const completeRes = await testRequest(app, 'POST', `/api/sprints/${sprintId}/complete`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.sprint.status).toBe('completed');
    expect(completeRes.body.rolledOverCount).toBe(1);

    const getReqRes = await testRequest(app, 'GET', `/api/requirements/${reqId}`);
    expect(getReqRes.body.sprint_id).toBeNull();
  });
});

