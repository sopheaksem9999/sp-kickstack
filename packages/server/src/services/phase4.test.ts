import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { OutboxScanner } from '../watcher/outboxScanner.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 4: Cross-Repo Tickets, Links, and Outbox Scanner', () => {
  let db: AppDatabase;
  let projectService: ProjectService;
  let requirementService: RequirementService;
  let fanOutService: FanOutService;
  let linkService: LinkService;
  let ticketService: TicketService;
  let outboxScanner: OutboxScanner;
  let backendEngine: FakeEngineServer;
  let mobileEngine: FakeEngineServer;
  let backendAdapter: StoneforgeAdapter;
  let mobileAdapter: StoneforgeAdapter;

  const tempRepoBackend = `/tmp/sp-test-repo-backend-${Date.now()}`;
  const tempRepoMobile = `/tmp/sp-test-repo-mobile-${Date.now()}`;

  beforeEach(() => {
    fs.mkdirSync(tempRepoBackend, { recursive: true });
    fs.mkdirSync(tempRepoMobile, { recursive: true });

    db = initDatabase(':memory:');
    projectService = new ProjectService(db);
    requirementService = new RequirementService(db, '/tmp/workspace');

    backendEngine = new FakeEngineServer('http://127.0.0.1:3457');
    mobileEngine = new FakeEngineServer('http://127.0.0.1:3477');

    backendAdapter = new StoneforgeAdapter(
      'http://127.0.0.1:3457',
      tempRepoBackend,
      undefined,
      backendEngine.fetch
    );
    mobileAdapter = new StoneforgeAdapter(
      'http://127.0.0.1:3477',
      tempRepoMobile,
      undefined,
      mobileEngine.fetch
    );

    const adapterMap: Record<string, StoneforgeAdapter> = {
      backend: backendAdapter,
      mobile: mobileAdapter,
    };

    const getAdapter = (name: string) => adapterMap[name];

    linkService = new LinkService(db, projectService, getAdapter);
    ticketService = new TicketService(db, projectService, linkService, getAdapter);
    outboxScanner = new OutboxScanner(projectService, ticketService);
    fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);

    projectService.registerProject({
      name: 'backend',
      kind: 'backend',
      repo_path: tempRepoBackend,
      engine_type: 'stoneforge',
      engine_url: 'http://127.0.0.1:3457',
      base_branch: 'main',
      contract_path: 'openapi.yaml',
      enabled: true,
    });

    projectService.registerProject({
      name: 'mobile',
      kind: 'mobile',
      repo_path: tempRepoMobile,
      engine_type: 'stoneforge',
      engine_url: 'http://127.0.0.1:3477',
      base_branch: 'main',
      enabled: true,
    });

    db.prepare(`
      INSERT INTO requirements (id, seq, title, status, body_md, file_path, created_at, updated_at)
      VALUES ('REQ-001', 1, 'Default Req', 'ready', '# Req', '/tmp/req.md', datetime('now'), datetime('now'))
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('detects and rejects dependency cycles', () => {
    // Insert two tasks
    const t1 = db.prepare(`
      INSERT INTO bridge_tasks (req_id, project, role, title, created_at, updated_at)
      VALUES ('REQ-001', 'backend', 'goal', 'Task 1', datetime('now'), datetime('now'))
    `).run();
    const t2 = db.prepare(`
      INSERT INTO bridge_tasks (req_id, project, role, title, created_at, updated_at)
      VALUES ('REQ-001', 'mobile', 'goal', 'Task 2', datetime('now'), datetime('now'))
    `).run();

    const id1 = Number(t1.lastInsertRowid);
    const id2 = Number(t2.lastInsertRowid);

    // Link: t1 waits for t2
    linkService.createLink(id1, id2);

    // Attempt to make t2 wait for t1 -> must be rejected as cycle!
    expect(linkService.wouldCreateCycle(id2, id1)).toBe(true);
    expect(() => linkService.createLink(id2, id1)).toThrow(/cyclic dependency/);
  });

  it('creates blocking ticket, holds source task, and unblocks with upstream context on completion', async () => {
    // 1. Create requirement and fan-out
    const req = requirementService.createRequirement({
      title: 'Ride tracking',
      goal: 'Ride tracking flow',
      acceptance_criteria: ['Rides tracked'],
      affected_projects: ['backend', 'mobile'],
    });
    const tasks = await fanOutService.execute(req.id);
    const mobileGoal = tasks.find((t) => t.project === 'mobile')!;

    // 2. Mobile agent files a blocking ticket for backend
    const ticketResp = await ticketService.createTicket(
      {
        to: 'backend',
        type: 'api_request',
        title: 'GET /v1/rides/location',
        body: 'Provide ride location endpoint with lat/long and driver ID',
        blocking: true,
      },
      'mobile',
      mobileGoal.engine_task_id!
    );

    expect(ticketResp.blocking).toBe(true);
    expect(ticketResp.target).toBe('backend');

    // Verify source task is held
    const mobileTaskAfter = db
      .prepare('SELECT status FROM bridge_tasks WHERE id = ?')
      .get(mobileGoal.id) as any;
    expect(mobileTaskAfter.status).toBe('held');

    // Verify link exists
    const links = linkService.getLinksForTask(mobileGoal.id);
    expect(links.length).toBe(1);
    expect(links[0].depends_on_id).toBe(ticketResp.ticketId);

    // 3. Backend completes the ticket
    const backendTicketTask = db
      .prepare('SELECT * FROM bridge_tasks WHERE id = ?')
      .get(ticketResp.ticketId) as any;
    backendEngine.setTaskStatus(backendTicketTask.engine_task_id, 'done', 'merged', 'https://github.com/pr/42');

    // Unblock dependent
    const released = await linkService.evaluateDependencyResolved(ticketResp.ticketId);
    expect(released.length).toBe(1);
    expect(released[0].state).toBe('released');
    expect(released[0].context_md).toContain('Contract file: openapi.yaml');
    expect(released[0].context_md).toContain('Ticket #');

    // Verify mobile task is resumed to queued
    const mobileResumed = db
      .prepare('SELECT status FROM bridge_tasks WHERE id = ?')
      .get(mobileGoal.id) as any;
    expect(mobileResumed.status).toBe('queued');
  });

  it('outbox scanner picks up drop files from .devflow/outbox and creates tickets', async () => {
    const outboxDir = path.join(tempRepoMobile, '.devflow', 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });

    const ticketPayload = {
      to: 'backend',
      type: 'api_request',
      title: 'Outbox endpoint ticket',
      body: 'Generated from sandboxed agent file outbox',
      blocking: false,
    };

    fs.writeFileSync(
      path.join(outboxDir, 'ticket-1.json'),
      JSON.stringify(ticketPayload),
      'utf-8'
    );

    const processedCount = await outboxScanner.scanOnce();
    expect(processedCount).toBe(1);

    // File should have been moved to processed/
    expect(fs.existsSync(path.join(outboxDir, 'ticket-1.json'))).toBe(false);
    expect(fs.existsSync(path.join(outboxDir, 'processed', 'ticket-1.json'))).toBe(true);

    // Ticket should exist in bridge tasks
    const ticketInDb = db
      .prepare('SELECT * FROM bridge_tasks WHERE title = ?')
      .get('Outbox endpoint ticket') as any;
    expect(ticketInDb).toBeDefined();
    expect(ticketInDb.project).toBe('backend');
    expect(ticketInDb.role).toBe('ticket');
  });
});
