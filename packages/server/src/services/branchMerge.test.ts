// Branch-per-task and merge gate behavior against real git repositories.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { TaskReactor } from './taskReactor.js';
import { EngineWatcher } from '../watcher/engineWatcher.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import { makeRepo, headOf } from '../testing/gitFixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-branch-merge');
let caseCounter = 0;

function makeGitHarness(opts: { withOrigin?: boolean } = { withOrigin: true }) {
  const ws = path.join(tempRoot, `case-${process.pid}-${caseCounter++}`);
  const backendRepo = makeRepo(path.join(ws, 'backend'), { withOrigin: opts.withOrigin });
  const mobileRepo = makeRepo(path.join(ws, 'mobile'), { withOrigin: opts.withOrigin });

  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const backendEngine = new FakeEngineServer('http://127.0.0.1:3457');
  const mobileEngine = new FakeEngineServer('http://127.0.0.1:3477');
  const adapters: Record<string, StoneforgeAdapter> = {
    backend: new StoneforgeAdapter('http://127.0.0.1:3457', backendRepo.repo, undefined, backendEngine.fetch),
    mobile: new StoneforgeAdapter('http://127.0.0.1:3477', mobileRepo.repo, undefined, mobileEngine.fetch),
  };
  const getAdapter = (name: string) => adapters[name] ?? adapters.backend;
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
  const emitted: any[] = [];
  const reactor = new TaskReactor(db, requirementService, linkService, (evt) => { emitted.push(evt); });
  const watcher = new EngineWatcher(db, projectService, requirementService, getAdapter, (evt) => { emitted.push(evt); }, 5000, reactor);

  for (const [name, r] of [['backend', backendRepo], ['mobile', mobileRepo]] as const) {
    projectService.registerProject({
      name, kind: name, repo_path: r.repo, engine_type: 'stoneforge',
      engine_url: name === 'backend' ? 'http://127.0.0.1:3457' : 'http://127.0.0.1:3477',
      base_branch: 'develop', contract_path: 'openapi.yaml', enabled: true,
    });
  }

  const createRequirement = (projects = ['backend', 'mobile']) =>
    requirementService.createRequirement({
      title: 'Ride tracking', goal: 'Track rides', acceptance_criteria: ['Rides tracked'],
      affected_projects: projects, priority: 'normal',
    });
  const task = (id: number) => db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  const engineBody = (project: 'backend' | 'mobile', engineTaskId: string) =>
    (project === 'backend' ? backendEngine : mobileEngine).getTaskData(engineTaskId)!.notes[0];

  return {
    ws, db, backendRepo, mobileRepo, projectService, requirementService, backendEngine, mobileEngine,
    adapters, linkService, ticketService, fanOutService, reactor, watcher, emitted, createRequirement, task, engineBody,
  };
}

type GitHarness = ReturnType<typeof makeGitHarness>;

afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('Branch per task', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());

  it('creates a branch from the base for every goal and names it in the agent prompt', async () => {
    const req = h.createRequirement();
    const goals = await h.fanOutService.execute(req.id);

    for (const goal of goals) {
      const row = h.task(goal.id);
      const repo = goal.project === 'backend' ? h.backendRepo.repo : h.mobileRepo.repo;
      expect(row.branch).toBe(`req/${req.id}/task-${goal.id}`);
      expect(headOf(repo, row.branch)).toBe(headOf(repo, 'develop'));
      expect(row.base_sha).toBe(headOf(repo, 'develop'));
      const body = h.engineBody(goal.project as 'backend' | 'mobile', goal.engine_task_id!);
      expect(body).toContain(row.branch);
      expect(body).not.toMatch(/developed on the `develop` branch/);
    }
  });

  it('creates a branch for a cross-repo ticket and names it in the ticket prompt', async () => {
    const req = h.createRequirement();
    const goals = await h.fanOutService.execute(req.id);
    const mobileGoal = goals.find((g) => g.project === 'mobile')!;

    const t = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /loc', body: 'Provide location endpoint', blocking: false },
      'mobile',
      mobileGoal.engine_task_id!
    );

    const ticket = h.task(t.ticketId);
    expect(ticket.branch).toBe(`req/${req.id}/task-${t.ticketId}`);
    expect(headOf(h.backendRepo.repo, ticket.branch)).toBe(headOf(h.backendRepo.repo, 'develop'));
    expect(h.engineBody('backend', ticket.engine_task_id)).toContain(ticket.branch);
  });

  it('leaves projects that are not git repositories on the legacy prompt', async () => {
    const plain = path.join(h.ws, 'plain');
    fs.mkdirSync(plain);
    h.projectService.registerProject({
      name: 'ops', repo_path: plain, engine_type: 'stoneforge', engine_url: 'http://127.0.0.1:3457', base_branch: 'develop',
    });
    const [goal] = await h.fanOutService.execute(h.createRequirement(['ops']).id);

    expect(h.task(goal.id).branch).toBeNull();
    expect(goal.status).toBe('queued');
    expect(h.engineBody('backend', goal.engine_task_id!)).toMatch(/developed on the `develop` branch/);
  });

  it('fails the dispatch with a clear reason when the base branch does not exist', async () => {
    h.projectService.updateProject('backend', { base_branch: 'release' });
    const [goal] = await h.fanOutService.execute(h.createRequirement(['backend']).id);

    const row = h.task(goal.id);
    expect(row.status).toBe('failed');
    expect(row.last_error).toMatch(/release/);
  });

  it('reuses the same branch when a failed dispatch is retried', async () => {
    const req = h.createRequirement(['backend']);
    const original = h.adapters.backend.createGoal.bind(h.adapters.backend);
    h.adapters.backend.createGoal = async () => { throw new Error('engine down'); };
    const [failed] = await h.fanOutService.execute(req.id);
    const branchSha = headOf(h.backendRepo.repo, h.task(failed.id).branch);
    h.adapters.backend.createGoal = original;

    const [retried] = await h.fanOutService.execute(req.id);

    expect(retried.id).toBe(failed.id);
    expect(retried.status).toBe('queued');
    expect(headOf(h.backendRepo.repo, h.task(retried.id).branch)).toBe(branchSha);
  });
});
