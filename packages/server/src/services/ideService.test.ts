import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { SettingsService } from './settingsService.js';
import { ProjectService } from './projectService.js';
import { IdeService } from './ideService.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { WorkspaceService } from './workspaceService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { Express } from 'express';

describe('IdeService & API', () => {
  let db: AppDatabase;
  let settingsService: SettingsService;
  let projectService: ProjectService;
  let ideService: IdeService;
  let app: Express;

  beforeEach(() => {
    db = initDatabase(':memory:');
    settingsService = new SettingsService(db);
    projectService = new ProjectService(db);
    ideService = new IdeService(settingsService, projectService);

    const workspaceService = new WorkspaceService(db);
    const requirementService = new RequirementService(db, '/tmp');
    const broadcaster = new SseBroadcaster();
    const notifier = new Notifier();

    app = createApp({
      db,
      workspaceService,
      projectService,
      requirementService,
      settingsService,
      ideService,
      fanOutService: {} as any,
      linkService: {} as any,
      ticketService: {} as any,
      broadcaster,
      notifier,
    });
  });

  it('provides default settings and allows updates', () => {
    const settings = ideService.getSettings();
    expect(settings.port).toBe(8443);
    expect(settings.enabled).toBe(true);

    const updated = ideService.updateSettings({ port: 9000, externalUrl: 'http://localhost:9000' });
    expect(updated.port).toBe(9000);
    expect(updated.externalUrl).toBe('http://localhost:9000');

    expect(ideService.getSettings().port).toBe(9000);
  });

  it('reports initial status via getStatus()', async () => {
    const status = await ideService.getStatus();
    expect(status).toHaveProperty('installed');
    expect(status).toHaveProperty('running');
    expect(status.port).toBe(8443);
  });

  it('generates correct project folder url', () => {
    const url = ideService.getUrlForFolder('/test/workspace/repo');
    expect(url).toContain('/?folder=%2Ftest%2Fworkspace%2Frepo');
  });

  it('GET /api/ide/status returns status payload', async () => {
    const res = await testRequest(app, 'GET', '/api/ide/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('installed');
    expect(res.body).toHaveProperty('running');
  });

  it('GET /api/ide/settings and PUT /api/ide/settings update config', async () => {
    const getRes = await testRequest(app, 'GET', '/api/ide/settings');
    expect(getRes.status).toBe(200);
    expect(getRes.body.port).toBe(8443);

    const putRes = await testRequest(app, 'PUT', '/api/ide/settings', { body: { port: 8080 } });
    expect(putRes.status).toBe(200);
    expect(putRes.body.port).toBe(8080);
  });

  it('GET /api/ide/projects/:name/url returns url for registered project', async () => {
    projectService.registerProject({
      name: 'test-backend',
      repo_path: '/tmp/test-backend',
      engine_type: 'manual',
    });

    const res = await testRequest(app, 'GET', '/api/ide/projects/test-backend/url');
    expect(res.status).toBe(200);
    expect(res.body.project).toBe('test-backend');
    expect(res.body.url).toContain('%2Ftmp%2Ftest-backend');
  });

  it('detects installed IDEs and sets default correctly', () => {
    const ides = ideService.detectInstalledIdes();
    expect(Array.isArray(ides)).toBe(true);
    if (ides.length > 0) {
      expect(ides.some((i) => i.isDefault)).toBe(true);
      expect(ides[0]).toHaveProperty('id');
      expect(ides[0]).toHaveProperty('name');
    }
  });

  it('GET /api/ide/detected returns detected IDE list', async () => {
    const res = await testRequest(app, 'GET', '/api/ide/detected');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/projects/:name/open-ide validates project existence', async () => {
    const res = await testRequest(app, 'POST', '/api/projects/non-existent-proj/open-ide');
    expect(res.status).toBe(500);
  });
});
