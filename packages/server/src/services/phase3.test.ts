import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { EngineWatcher } from '../watcher/engineWatcher.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempWorkspace = path.resolve(__dirname, '../../.temp/sp-test-workspace-phase3');

describe('Phase 3: Requirements, Fan-Out, and Watcher Sync', () => {
  let db: AppDatabase;
  let projectService: ProjectService;
  let requirementService: RequirementService;
  let backendEngine: FakeEngineServer;
  let mobileEngine: FakeEngineServer;
  let backendAdapter: StoneforgeAdapter;
  let mobileAdapter: StoneforgeAdapter;
  let fanOutService: FanOutService;
  let watcher: EngineWatcher;
  const recordedEvents: any[] = [];

  beforeEach(() => {
    fs.mkdirSync(tempWorkspace, { recursive: true });
    db = initDatabase(':memory:');
    projectService = new ProjectService(db);
    requirementService = new RequirementService(db, tempWorkspace);

    backendEngine = new FakeEngineServer('http://127.0.0.1:3457');
    mobileEngine = new FakeEngineServer('http://127.0.0.1:3477');

    backendAdapter = new StoneforgeAdapter(
      'http://127.0.0.1:3457',
      '/tmp/backend',
      undefined,
      backendEngine.fetch
    );
    mobileAdapter = new StoneforgeAdapter(
      'http://127.0.0.1:3477',
      '/tmp/mobile',
      undefined,
      mobileEngine.fetch
    );

    const adapterMap: Record<string, StoneforgeAdapter> = {
      backend: backendAdapter,
      mobile: mobileAdapter,
    };

    const getAdapter = (name: string) => {
      const adapter = adapterMap[name];
      if (!adapter) throw new Error(`No adapter for ${name}`);
      return adapter;
    };

    fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);

    recordedEvents.length = 0;
    watcher = new EngineWatcher(
      db,
      projectService,
      requirementService,
      getAdapter,
      (evt) => recordedEvents.push(evt)
    );

    // Register projects
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

  afterAll(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it('creates requirement with sequential ID and markdown file', () => {
    const req = requirementService.createRequirement({
      title: 'Realtime driver map',
      goal: 'Show nearby drivers on mobile map',
      acceptance_criteria: ['Map displays vehicle markers', 'Polls every 5s'],
      affected_projects: ['backend', 'mobile'],
      priority: 'high',
    });

    expect(req.id).toBe('REQ-001');
    expect(req.status).toBe('draft');
    expect(req.affected_projects).toEqual(['backend', 'mobile']);
    expect(fs.existsSync(req.file_path)).toBe(true);

    const content = fs.readFileSync(req.file_path, 'utf-8');
    expect(content).toContain('id: REQ-001');
    expect(content).toContain('Realtime driver map');
  });

  it('performs fan-out idempotently to affected engines', async () => {
    const req = requirementService.createRequirement({
      title: 'Driver location fanout',
      goal: 'Both teams build driver location integration',
      acceptance_criteria: ['Done'],
      affected_projects: ['backend', 'mobile'],
    });

    const tasks = await fanOutService.execute(req.id);
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.project).sort()).toEqual(['backend', 'mobile']);

    // Check tasks created inside fake engines
    const backendTask = backendEngine.getTaskData(tasks.find((t) => t.project === 'backend')!.engine_task_id!);
    expect(backendTask).toBeDefined();
    expect(backendTask?.notes[0]).toContain('<untrusted_input name="requirement">');
    expect(backendTask?.notes[0]).toContain('Execution Autonomy & Headless Protocol (Strategy A)');
    expect(backendTask?.notes[0]).toContain('Operate headlessly & autonomously');

    // Test idempotency: re-running fan-out must not create duplicate tasks
    const secondRun = await fanOutService.execute(req.id);
    expect(secondRun.length).toBe(2);
    expect(secondRun[0].id).toBe(tasks[0].id);

    const updatedReq = requirementService.getRequirement(req.id);
    expect(updatedReq?.status).toBe('in_progress');
  });

  it('watcher detects status changes and updates requirement status to done', async () => {
    const req = requirementService.createRequirement({
      title: 'Sync test',
      goal: 'Testing watcher sync',
      acceptance_criteria: ['Both done'],
      affected_projects: ['backend', 'mobile'],
    });

    const tasks = await fanOutService.execute(req.id);
    const backendTask = tasks.find((t) => t.project === 'backend')!;
    const mobileTask = tasks.find((t) => t.project === 'mobile')!;

    // Initial watcher scan (no changes yet)
    let changes = await watcher.scanOnce();
    expect(changes).toBe(0);

    // Simulate backend task progress: running
    backendEngine.setTaskStatus(backendTask.engine_task_id!, 'running', 'in_progress');
    changes = await watcher.scanOnce();
    expect(changes).toBe(1);
    expect(recordedEvents.some((e) => e.type === 'task_status_changed' && e.payload.newStatus === 'running')).toBe(true);

    // Simulate both tasks complete: done
    backendEngine.setTaskStatus(backendTask.engine_task_id!, 'done', 'merged');
    mobileEngine.setTaskStatus(mobileTask.engine_task_id!, 'done', 'merged');

    changes = await watcher.scanOnce();
    expect(changes).toBe(2);

    // Requirement status must now automatically derive to 'done'
    const finalReq = requirementService.getRequirement(req.id);
    expect(finalReq?.status).toBe('done');
  });
});
