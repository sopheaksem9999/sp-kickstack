import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { FanOutService } from '../services/fanOutService.js';
import { LinkService } from '../services/linkService.js';
import { TicketService } from '../services/ticketService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { NeuronService } from '../services/neuronService.js';
import { ClefService } from '../services/clefService.js';
import { createApp } from './app.js';
import { testRequest } from './testHelper.js';
import { Express } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempWorkspace = path.resolve(__dirname, '../../.temp/sp-test-neuron-routes');

describe('Browser, Clef & Neuron API Routes', () => {
  let app: Express;
  let db: AppDatabase;
  let neuronService: NeuronService;

  beforeAll(() => {
    fs.mkdirSync(tempWorkspace, { recursive: true });
    db = initDatabase(':memory:');
    const workspaceService = new WorkspaceService(db);
    const projectService = new ProjectService(db);
    const requirementService = new RequirementService(db, tempWorkspace);
    const getAdapter = () => ({} as any);
    const linkService = new LinkService(db, projectService, getAdapter);
    const ticketService = new TicketService(db, projectService, linkService, getAdapter);
    const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
    const broadcaster = new SseBroadcaster();
    const notifier = new Notifier();

    neuronService = new NeuronService(db);
    const clefService = new ClefService();

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
      neuronService,
      clefService,
    });
  });

  describe('Clef Triage Routes', () => {
    it('returns triage classification for an error log', async () => {
      const res = await testRequest(app, 'POST', '/api/clef/triage', {
        body: { error_text: 'FATAL 500 database deadlock connection timeout' },
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.triage.severity).toBe('P0');
      expect(res.body.triage.domain).toBe('database');
      expect(res.body.triage.rationale).toBeDefined();
    });

    it('rejects empty error_text', async () => {
      const res = await testRequest(app, 'POST', '/api/clef/triage', {
        body: { error_text: '' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns disabled status when active_engine is none', async () => {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('system_decision_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify({ active_engine: 'none' }));

      const res = await testRequest(app, 'POST', '/api/clef/triage', {
        body: { error_text: 'FATAL 500 database deadlock' },
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.engine).toBe('none');
      expect(res.body.disabled).toBe(true);

      // Restore to clef
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('system_decision_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify({ active_engine: 'clef' }));
    });
  });

  describe('Browser Fetch Page Route', () => {
    it('rejects missing url query param', async () => {
      const res = await testRequest(app, 'GET', '/api/browser/fetch-page');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('url query parameter is required');
    });

    it('rejects disallowed protocol schemes', async () => {
      const res = await testRequest(app, 'GET', '/api/browser/fetch-page?url=ftp://example.com');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only http: and https: protocols');
    });
  });

  describe('Neuron Rules Routes', () => {
    let createdRuleId: string;

    it('creates a new learned rule', async () => {
      const res = await testRequest(app, 'POST', '/api/neuron/rules', {
        body: {
          project: 'backend',
          category: 'architecture',
          rule_text: 'Always return ISO-8601 UTC timestamps from server endpoints.',
          confidence_score: 0.95,
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.rule).toBeDefined();
      expect(res.body.rule.category).toBe('architecture');
      expect(res.body.rule.confidence_score).toBe(0.95);
      expect(res.body.rule.is_active).toBe(true);
      createdRuleId = res.body.rule.id;
    });

    it('lists rules with filtering', async () => {
      const res = await testRequest(app, 'GET', '/api/neuron/rules?project=backend');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.rules)).toBe(true);
      expect(res.body.rules.some((r: any) => r.id === createdRuleId)).toBe(true);
    });

    it('updates a rule status and confidence score', async () => {
      const res = await testRequest(app, 'PATCH', `/api/neuron/rules/${createdRuleId}`, {
        body: {
          confidence_score: 0.99,
          is_active: false,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.rule.confidence_score).toBe(0.99);
      expect(res.body.rule.is_active).toBe(false);
    });

    it('deletes a rule', async () => {
      const res = await testRequest(app, 'DELETE', `/api/neuron/rules/${createdRuleId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const getRes = await testRequest(app, 'GET', '/api/neuron/rules');
      expect(getRes.body.rules.some((r: any) => r.id === createdRuleId)).toBe(false);
    });
  });
});
