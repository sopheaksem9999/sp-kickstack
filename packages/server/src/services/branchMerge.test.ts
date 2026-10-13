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
import { makeRepo, headOf, commitOnBranch, sh } from '../testing/gitFixture.js';
import { MergeGateService, tempDirPrefix } from './mergeGate.js';
import { BranchService, pushesSettled } from './branchService.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { WorkspaceService } from './workspaceService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { SettingsService } from './settingsService.js';
import { prepareRetry } from './taskRetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-branch-merge');
let caseCounter = 0;

function makeGitHarness(opts: { withOrigin?: boolean; push?: boolean } = {}) {
  const withOrigin = opts.withOrigin ?? true;
  const ws = path.join(tempRoot, `case-${process.pid}-${caseCounter++}`);
  const backendRepo = makeRepo(path.join(ws, 'backend'), { withOrigin });
  const mobileRepo = makeRepo(path.join(ws, 'mobile'), { withOrigin });

  const db = initDatabase(':memory:');
  if (!opts.push) new SettingsService(db).updateBranchMergeSettings({ push_branches: false });
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
  const branches = new BranchService(db, projectService);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter, branches);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter, branches);
  const logText = (taskId: number) =>
    (db.prepare('SELECT message FROM task_logs WHERE task_id = ?').all(taskId) as Array<{ message: string }>).map((r) => r.message).join('\n');
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

  const gate = new MergeGateService(db, projectService, requirementService, reactor, {
    getAdapter,
    testTimeoutMs: 20_000,
    tmpRoot: path.join(ws, 'tmp'),
  });
  const repoOf = (project: string) => (project === 'backend' ? backendRepo : mobileRepo);

  return {
    ws, db, backendRepo, mobileRepo, projectService, requirementService, backendEngine, mobileEngine,
    adapters, linkService, ticketService, fanOutService, reactor, watcher, emitted, createRequirement, task, engineBody,
    gate, repoOf, branches, logText,
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
      expect(row.branch).toBe(req.id);
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
    expect(ticket.branch).toBe(`${req.id}-ticket-${t.ticketId}`);
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

describe('Branch-mode dependencies', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());

  async function blockOn(projects: [string, string]) {
    const [provider, consumer] = projects;
    const goals = await h.fanOutService.execute(h.createRequirement([provider, consumer]).id);
    const source = goals.find((g) => g.project === consumer)!;
    const t = await h.ticketService.createTicket(
      { to: provider, type: 'api_request', title: 'GET /loc', body: 'Provide location endpoint', blocking: true },
      consumer,
      source.engine_task_id!
    );
    return { source, ticket: h.task(t.ticketId) };
  }

  it('releases the held source when the blocking ticket reaches in_review, naming its branch', async () => {
    const { source, ticket } = await blockOn(['backend', 'mobile']);
    expect(h.task(source.id).status).toBe('held');
    h.backendEngine.setTaskStatus(ticket.engine_task_id, 'in_review', 'needs_review');

    await h.watcher.scanOnce();

    const [link] = h.linkService.getLinksForTask(source.id);
    expect(link.state).toBe('released');
    expect(link.context_md).toContain(ticket.branch);
    expect(link.context_md).toMatch(/not merged yet/);
    expect(h.mobileEngine.getTaskData(source.engine_task_id!)!.status).toBe('queued');
  });

  it("tells the released agent that both branches merge into the requirement's target branch", async () => {
    const req = h.createRequirement(['backend', 'mobile']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const source = (await h.fanOutService.execute(req.id)).find((g) => g.project === 'mobile')!;
    const t = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /loc', body: 'Provide location endpoint', blocking: true },
      'mobile',
      source.engine_task_id!
    );
    h.backendEngine.setTaskStatus(h.task(t.ticketId).engine_task_id, 'in_review', 'needs_review');

    await h.watcher.scanOnce();

    const [link] = h.linkService.getLinksForTask(source.id);
    expect(link.context_md).toContain('merges both branches into release/1.3');
  });

  it('still waits for done when the projects do not use branches', async () => {
    for (const name of ['pa', 'pb']) {
      const dir = path.join(h.ws, name);
      fs.mkdirSync(dir);
      h.projectService.registerProject({ name, repo_path: dir, engine_type: 'stoneforge', engine_url: 'http://127.0.0.1:3457', base_branch: 'develop' });
    }
    const { source, ticket } = await blockOn(['pa', 'pb']);
    expect(ticket.branch).toBeNull();
    h.backendEngine.setTaskStatus(ticket.engine_task_id, 'in_review', 'needs_review');

    await h.watcher.scanOnce();

    expect(h.linkService.getLinksForTask(source.id)[0].state).toBe('waiting');
  });
});

describe('Merge gate', () => {
  let h: GitHarness;
  afterEach(() => h.db.close());

  /** Fan out, commit work on every task branch, and put everything in review. */
  async function readyForGate(projects = ['backend', 'mobile'], files: Record<string, { file: string; content: string } | null> = {}) {
    const req = h.createRequirement(projects);
    const goals = await h.fanOutService.execute(req.id);
    for (const g of goals) {
      const row = h.task(g.id);
      const change = files[g.project] === undefined ? { file: `${g.project}-${g.id}.txt`, content: `work ${g.id}\n` } : files[g.project];
      if (change) commitOnBranch(h.repoOf(g.project).repo, row.branch, change.file, change.content);
      h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(g.id);
    }
    h.requirementService.updateStatus(req.id, 'in_review');
    return { req, goals };
  }

  const statusOf = (err: unknown) => (err as { status?: number }).status;
  const reqRow = (id: string) => h.db.prepare('SELECT status, merge_state, merge_error FROM requirements WHERE id = ?').get(id) as any;

  it('merges every task branch, fast-forwards local develop and moves the requirement to QA', async () => {
    h = makeGitHarness();
    const { req, goals } = await readyForGate();

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome).toMatchObject({ ok: true, projects: ['backend', 'mobile'], warnings: [] });
    for (const g of goals) {
      const { repo, origin } = h.repoOf(g.project);
      expect(sh(repo, ['show', `develop:${g.project}-${g.id}.txt`])).toBe(`work ${g.id}`);
      if (origin) {
        expect(() => sh(origin, ['show', `develop:${g.project}-${g.id}.txt`])).toThrow();
      }
      const row = h.task(g.id);
      expect(row.status).toBe('done');
      expect(row.merged_at).toBeTruthy();
      expect(sh(repo, ['rev-list', '--parents', '-n', '1', row.merge_sha]).split(' ')).toHaveLength(3);
      const engine = g.project === 'backend' ? h.backendEngine : h.mobileEngine;
      expect(engine.getTaskData(g.engine_task_id!)!.notes.join('\n')).toMatch(/Merged into `develop`/);
    }
    expect(reqRow(req.id)).toMatchObject({ status: 'qa', merge_state: 'idle' });
  });

  it('changes nothing anywhere when one project conflicts, and tells that task to rebase', async () => {
    h = makeGitHarness();
    const { req, goals } = await readyForGate(['backend', 'mobile'], { mobile: { file: 'README.md', content: 'task change\n' } });
    commitOnBranch(h.mobileRepo.repo, 'develop', 'README.md', 'develop change\n');
    sh(h.mobileRepo.repo, ['push', '-q', 'origin', 'develop']);
    const before = ['backend', 'mobile'].map((p) => [headOf(h.repoOf(p).repo, 'develop'), headOf(h.repoOf(p).origin!, 'develop')]);

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain('README.md');
      expect(outcome.error).toContain(h.task(goals.find((g) => g.project === 'mobile')!.id).branch);
      expect(outcome.mergedProjects).toEqual([]);
    }
    const after = ['backend', 'mobile'].map((p) => [headOf(h.repoOf(p).repo, 'develop'), headOf(h.repoOf(p).origin!, 'develop')]);
    expect(after).toEqual(before);
    expect(reqRow(req.id)).toMatchObject({ status: 'in_review', merge_state: 'failed' });
    const mobileGoal = goals.find((g) => g.project === 'mobile')!;
    expect(h.mobileEngine.getTaskData(mobileGoal.engine_task_id!)!.notes.join('\n')).toMatch(/rebase/i);
  });

  it('changes nothing when the project test command fails', async () => {
    h = makeGitHarness();
    h.projectService.updateProject('backend', { test_command: 'echo boom && exit 7' });
    const { req } = await readyForGate();
    const before = headOf(h.backendRepo.origin!, 'develop');

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/exit 7/);
      expect(outcome.error).toContain('boom');
    }
    expect(headOf(h.backendRepo.origin!, 'develop')).toBe(before);
    expect(headOf(h.mobileRepo.origin!, 'develop')).toBe(headOf(h.mobileRepo.repo, 'develop'));
  });

  it('refuses before changing anything when a repo has a dirty checkout on base branch', async () => {
    h = makeGitHarness();
    const { req } = await readyForGate();
    fs.writeFileSync(path.join(h.backendRepo.repo, 'README.md'), 'my unsaved work\n');
    const localBefore = headOf(h.backendRepo.repo, 'develop');

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/uncommitted/);
    expect(headOf(h.backendRepo.repo, 'develop')).toBe(localBefore);
    expect(fs.readFileSync(path.join(h.backendRepo.repo, 'README.md'), 'utf8')).toBe('my unsaved work\n');
  });

  it('refuses before changing anything when a repo without origin has a dirty checkout', async () => {
    h = makeGitHarness({ withOrigin: false });
    const { req } = await readyForGate();
    fs.writeFileSync(path.join(h.backendRepo.repo, 'README.md'), 'my unsaved work\n');
    const before = ['backend', 'mobile'].map((p) => headOf(h.repoOf(p).repo, 'develop'));

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/uncommitted/);
    expect(['backend', 'mobile'].map((p) => headOf(h.repoOf(p).repo, 'develop'))).toEqual(before);
  });

  it('reports a partial merge when a later project fails to advance, and a retry merges only the rest', async () => {
    h = makeGitHarness();
    const { req, goals } = await readyForGate();
    fs.writeFileSync(path.join(h.mobileRepo.repo, '.git', 'index.lock'), '');

    const first = await h.gate.start(req.id, 'manual').done;

    expect(first).toMatchObject({ ok: false, mergedProjects: ['backend'] });
    const backendGoal = goals.find((g) => g.project === 'backend')!;
    const mobileGoal = goals.find((g) => g.project === 'mobile')!;
    expect(h.task(backendGoal.id).merge_sha).toBeTruthy();
    expect(h.task(mobileGoal.id).merged_at).toBeNull();
    expect(reqRow(req.id)).toMatchObject({ status: 'in_review', merge_state: 'failed' });

    fs.rmSync(path.join(h.mobileRepo.repo, '.git', 'index.lock'));
    const second = await h.gate.start(req.id, 'manual').done;

    expect(second).toMatchObject({ ok: true, projects: ['mobile'] });
    expect(sh(h.backendRepo.repo, ['rev-list', '--merges', '--count', 'develop'])).toBe('1');
    expect(reqRow(req.id).status).toBe('qa');
  });

  it('refuses to start unless every task is in review, the requirement is in review, and no merge is running', async () => {
    h = makeGitHarness();
    const { req, goals } = await readyForGate();

    h.db.prepare("UPDATE bridge_tasks SET status = 'running' WHERE id = ?").run(goals[0].id);
    try { h.gate.start(req.id, 'manual'); expect.unreachable(); } catch (err) { expect(statusOf(err)).toBe(409); }
    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goals[0].id);

    h.requirementService.updateStatus(req.id, 'in_progress');
    try { h.gate.start(req.id, 'manual'); expect.unreachable(); } catch (err) { expect(statusOf(err)).toBe(409); }
    h.requirementService.updateStatus(req.id, 'in_review');

    const run = h.gate.start(req.id, 'manual');
    try { h.gate.start(req.id, 'manual'); expect.unreachable(); } catch (err) { expect(statusOf(err)).toBe(409); }
    await run.done;
  });

  it('skips a branch with no commits and still succeeds', async () => {
    h = makeGitHarness();
    const { req, goals } = await readyForGate(['backend', 'mobile'], { mobile: null });

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome.ok).toBe(true);
    const mobile = h.task(goals.find((g) => g.project === 'mobile')!.id);
    expect(mobile.merged_at).toBeTruthy();
    expect(mobile.merge_sha).toBeNull();
    expect(mobile.status).toBe('done');
  });

  it('marks a merge left running by a crash as failed on restart', async () => {
    h = makeGitHarness();
    const req = h.createRequirement();
    h.db.prepare("UPDATE requirements SET merge_state = 'running' WHERE id = ?").run(req.id);

    expect(h.gate.resetInterrupted()).toBe(1);
    expect(reqRow(req.id)).toMatchObject({ merge_state: 'failed' });
    expect(reqRow(req.id).merge_error).toMatch(/restart/i);
  });

  it('serializes two requirements merging into the same repository', async () => {
    h = makeGitHarness();
    const a = await readyForGate(['backend']);
    const b = await readyForGate(['backend']);

    const [ra, rb] = await Promise.all([h.gate.start(a.req.id, 'manual').done, h.gate.start(b.req.id, 'manual').done]);

    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    for (const r of [a, b]) {
      const goal = r.goals[0];
      expect(sh(h.backendRepo.repo, ['show', `develop:backend-${goal.id}.txt`])).toBe(`work ${goal.id}`);
    }
  });
});

describe('Merge gate triggers and API', () => {
  let h: GitHarness;
  let app: any;
  beforeEach(async () => {
    h = makeGitHarness();
    const { createApp } = await import('../api/app.js');
    const { WorkspaceService } = await import('./workspaceService.js');
    const { SseBroadcaster } = await import('../sse/broadcaster.js');
    const { Notifier } = await import('../notify/notifier.js');
    app = createApp({
      db: h.db, workspaceService: new WorkspaceService(h.db), projectService: h.projectService,
      requirementService: h.requirementService, fanOutService: h.fanOutService, linkService: h.linkService,
      ticketService: h.ticketService, broadcaster: new SseBroadcaster(), notifier: new Notifier(),
      reactor: h.reactor, mergeGate: h.gate,
    });
  });
  afterEach(() => h.db.close());

  async function inReview() {
    const req = h.createRequirement();
    const goals = await h.fanOutService.execute(req.id);
    for (const g of goals) {
      commitOnBranch(h.repoOf(g.project).repo, h.task(g.id).branch, `${g.project}-${g.id}.txt`, `work ${g.id}\n`);
      h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(g.id);
    }
    h.requirementService.updateStatus(req.id, 'in_review');
    return { req, goals };
  }

  async function settled(reqId: string) {
    for (let i = 0; i < 200; i++) {
      const row = h.requirementService.getRequirement(reqId)!;
      if (row.merge_state !== 'running') return row;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('merge did not finish');
  }

  it('moving the requirement to QA starts the merge (202) and lands in QA', async () => {
    const { testRequest } = await import('../api/testHelper.js');
    const { req } = await inReview();

    const res = await testRequest(app, 'PUT', `/api/requirements/${req.id}/status`, { body: { status: 'qa' } });

    expect(res.status).toBe(202);
    expect(res.body.merge_state).toBe('running');
    expect((await settled(req.id)).status).toBe('qa');
  });

  it('merge-to-qa starts the merge, and explains why when tasks are still running', async () => {
    const { testRequest } = await import('../api/testHelper.js');
    const { req, goals } = await inReview();
    h.db.prepare("UPDATE bridge_tasks SET status = 'running' WHERE id = ?").run(goals[0].id);

    const refused = await testRequest(app, 'POST', `/api/requirements/${req.id}/merge-to-qa`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/not in review/);

    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goals[0].id);
    const started = await testRequest(app, 'POST', `/api/requirements/${req.id}/merge-to-qa`);
    expect(started.status).toBe(202);
    expect((await settled(req.id)).status).toBe('qa');
  });

  it('cannot skip the merge by setting QA or confirming the merge directly', async () => {
    const { req } = await inReview();
    expect(() => h.requirementService.updateRequirementStatus(req.id, 'qa')).toThrow(/Merge & move to QA/);
    expect(() => h.requirementService.confirmMerged(req.id)).toThrow(/Merge & move to QA/);
  });

  it('auto-merge policy merges as soon as the last task reaches review', async () => {
    h.reactor.setHooks({ onRequirementInReview: (id) => h.gate.autoStart(id) });
    const req = h.createRequirement();
    h.requirementService.updateRequirementMergePolicy(req.id, 'auto_merge');
    const goals = await h.fanOutService.execute(req.id);
    for (const g of goals) {
      commitOnBranch(h.repoOf(g.project).repo, h.task(g.id).branch, `${g.project}-${g.id}.txt`, `work ${g.id}\n`);
      (g.project === 'backend' ? h.backendEngine : h.mobileEngine).setTaskStatus(g.engine_task_id!, 'in_review', 'needs_review');
    }

    await h.watcher.scanOnce();

    expect((await settled(req.id)).status).toBe('qa');
  });

  it('review-first policy waits for a person', async () => {
    h.reactor.setHooks({ onRequirementInReview: (id) => h.gate.autoStart(id) });
    const req = h.createRequirement();
    const goals = await h.fanOutService.execute(req.id);
    for (const g of goals) {
      (g.project === 'backend' ? h.backendEngine : h.mobileEngine).setTaskStatus(g.engine_task_id!, 'in_review', 'needs_review');
    }

    await h.watcher.scanOnce();

    expect(h.requirementService.getRequirement(req.id)).toMatchObject({ status: 'in_review', merge_state: 'idle' });
  });
});

describe('Merge gate review fixes', () => {
  let h: GitHarness;
  afterEach(() => h.db.close());

  async function ready(projects = ['backend', 'mobile']) {
    const req = h.createRequirement(projects);
    const goals = await h.fanOutService.execute(req.id);
    for (const g of goals) {
      commitOnBranch(h.repoOf(g.project).repo, h.task(g.id).branch, `${g.project}-${g.id}.txt`, `work ${g.id}\n`);
      h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(g.id);
    }
    h.requirementService.updateStatus(req.id, 'in_review');
    return { req, goals };
  }
  const repoFiles = (project: string) => sh(h.repoOf(project).repo, ['ls-tree', '--name-only', 'develop']);

  it('marking every branched task done keeps the requirement in review so it can still be merged', async () => {
    h = makeGitHarness();
    const { req, goals } = await ready();
    for (const g of goals) {
      const t = h.task(g.id);
      h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(g.id);
      await h.reactor.onTaskStatusChanged(t, t.status, 'done', 'manual');
    }

    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_review');
    expect((await h.gate.start(req.id, 'manual').done).ok).toBe(true);
    expect(repoFiles('backend')).toMatch(/backend-\d+\.txt/);
  });

  it('does not push when a branch gets new commits while the merge runs', async () => {
    h = makeGitHarness();
    h.projectService.updateProject('backend', { test_command: 'sleep 1' });
    const { req, goals } = await ready(['backend']);
    const run = h.gate.start(req.id, 'manual').done;
    await new Promise((r) => setTimeout(r, 300));
    commitOnBranch(h.backendRepo.repo, h.task(goals[0].id).branch, 'late.txt', 'late\n');

    const outcome = await run;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/changed during the merge/);
    expect(repoFiles('backend')).not.toMatch(/backend-\d+\.txt/);
    expect(h.task(goals[0].id).merged_at).toBeNull();
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_review');
  });

  it('does not push or revive a requirement cancelled while the merge runs', async () => {
    h = makeGitHarness();
    h.projectService.updateProject('backend', { test_command: 'sleep 1' });
    const { req } = await ready(['backend']);
    const run = h.gate.start(req.id, 'manual').done;
    await new Promise((r) => setTimeout(r, 300));
    await h.fanOutService.cancel(req.id);

    const outcome = await run;

    expect(outcome.ok).toBe(false);
    expect(repoFiles('backend')).not.toMatch(/backend-\d+\.txt/);
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('cancelled');
  });

  it('fails if the local fast-forward fails and leaves the requirement in review', async () => {
    h = makeGitHarness();
    const { req, goals } = await ready(['backend']);
    fs.writeFileSync(path.join(h.backendRepo.repo, '.git', 'index.lock'), '');

    const outcome = await h.gate.start(req.id, 'manual').done;
    fs.rmSync(path.join(h.backendRepo.repo, '.git', 'index.lock'));

    expect(outcome.ok).toBe(false);
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_review');
  });

  it('does not push to origin during the merge', async () => {
    h = makeGitHarness();
    const { req } = await ready(['backend']);
    const originDevelopBefore = headOf(h.backendRepo.origin!, 'develop');

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome.ok).toBe(true);
    expect(headOf(h.backendRepo.origin!, 'develop')).toBe(originDevelopBefore);
  });

  it('deletes merged task branches when auto_delete_branch is on, whatever is checked out', async () => {
    h = makeGitHarness();
    new SettingsService(h.db).updateBranchMergeSettings({ auto_delete_branch: true });
    sh(h.backendRepo.repo, ['checkout', '-q', '-b', 'main']);
    const { req, goals } = await ready(['backend']);
    const branch = h.task(goals[0].id).branch;

    expect((await h.gate.start(req.id, 'manual').done).ok).toBe(true);

    expect(sh(h.backendRepo.repo, ['branch', '--list', branch])).toBe('');
  });

  it('kills the whole test process tree when the test command times out', async () => {
    h = makeGitHarness();
    const pidFile = path.join(h.ws, 'child.pid');
    h.projectService.updateProject('backend', { test_command: `sleep 30 & echo $! > ${pidFile}; wait` });
    const { req } = await ready(['backend']);
    const gate = new MergeGateService(h.db, h.projectService, h.requirementService, h.reactor, {
      testTimeoutMs: 500, tmpRoot: path.join(h.ws, 'tmp'),
    });

    const outcome = await gate.start(req.id, 'manual').done;
    await new Promise((r) => setTimeout(r, 200));

    expect(outcome.ok).toBe(false);
    const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(() => process.kill(childPid, 0)).toThrow();
  }, 15_000);

  it('keeps temporary merge folders inside the temp root whatever the project is named', () => {
    expect(tempDirPrefix('REQ-001', 'a/../../etc')).not.toMatch(/[\\/]/);
  });

  it('tells the dependent agent which repository holds the branch', async () => {
    h = makeGitHarness();
    const ctx = h.linkService.formatUpstreamContext(
      { id: 9, title: 'GET /loc', body_md: 'x', branch: 'req/REQ-001/task-9', merged_at: null } as any,
      'backend',
      'openapi.yaml',
      'develop',
      h.backendRepo.repo
    );
    expect(ctx).toContain(`git -C ${h.backendRepo.repo} show req/REQ-001/task-9:openapi.yaml`);
  });

  it('reports a task branch with no new commits as a warning', async () => {
    h = makeGitHarness();
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goal.id);
    h.requirementService.updateStatus(req.id, 'in_review');

    const outcome = await h.gate.start(req.id, 'manual').done;

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.warnings.join('\n')).toMatch(/no new commits/);
  });
});

describe('Task branch names', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());

  it('adds -2 when the name is already taken in the repository', async () => {
    const req = h.createRequirement(['backend']);
    sh(h.backendRepo.repo, ['branch', req.id]);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).branch).toBe(`${req.id}-2`);
  });

  it('a branch under the name counts as taken', async () => {
    const req = h.createRequirement(['backend']);
    sh(h.backendRepo.repo, ['branch', `${req.id}/old`]);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).branch).toBe(`${req.id}-2`);
  });

  it('follows the Settings pattern', async () => {
    new SettingsService(h.db).updateBranchMergeSettings({ task_branch_pattern: '{project}/{req}' });
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).branch).toBe(`backend/${req.id}`);
  });

  it('changing the pattern renames nothing', async () => {
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    new SettingsService(h.db).updateBranchMergeSettings({ task_branch_pattern: 'feature/{req}' });
    h.db.prepare("UPDATE bridge_tasks SET status = 'failed' WHERE id = ?").run(goal.id);
    await prepareRetry(h.db, goal.id, 'goal', (name) => h.adapters[name]);
    await h.fanOutService.dispatchGoal(goal.id);
    expect(h.task(goal.id).branch).toBe(req.id);
  });
});

describe('Requirement target branch', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());
  const targetEvents = () =>
    (h.db.prepare("SELECT payload FROM events WHERE type = 'target_branch_created'").all() as Array<{ payload: string }>).map((r) => JSON.parse(r.payload));

  it('creates a missing target branch from the base and starts the task branch from it', async () => {
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    const repo = h.backendRepo.repo;
    expect(headOf(repo, 'release/1.3')).toBe(headOf(repo, 'develop'));
    expect(h.task(goal.id).base_sha).toBe(headOf(repo, 'release/1.3'));
    expect(h.engineBody('backend', goal.engine_task_id!)).toContain('release/1.3');
    expect(targetEvents()).toEqual([{ reqId: req.id, project: 'backend', branch: 'release/1.3', from: 'develop' }]);
  });

  it('uses an existing target branch as it is', async () => {
    const repo = h.backendRepo.repo;
    sh(repo, ['branch', 'release/1.3']);
    const tip = commitOnBranch(repo, 'release/1.3', 'release.txt', 'r\n');
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).base_sha).toBe(tip);
    expect(targetEvents()).toEqual([]);
  });

  it('two requirements with the same new target branch share it', async () => {
    const first = h.createRequirement(['backend']);
    const second = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(first.id, { target_branch: 'release/1.3' });
    h.requirementService.updateRunSettings(second.id, { target_branch: 'release/1.3' });
    await h.fanOutService.execute(first.id);
    const [goal] = await h.fanOutService.execute(second.id);
    expect(h.task(goal.id).base_sha).toBe(headOf(h.backendRepo.repo, 'release/1.3'));
    expect(targetEvents()).toHaveLength(1);
  });

  it('a target branch that only exists on origin', async () => {
    const { repo, origin } = h.backendRepo;
    const tip = commitOnBranch(repo, 'develop', 'next.txt', 'n\n');
    sh(repo, ['push', '-q', 'origin', `${tip}:refs/heads/release/1.3`]);
    sh(repo, ['reset', '-q', '--hard', 'HEAD~1']);
    sh(repo, ['fetch', '-q', 'origin']);
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).base_sha).toBe(tip);
    commitOnBranch(repo, h.task(goal.id).branch, 'feature.txt', 'f\n');
    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goal.id);
    h.requirementService.updateStatus(req.id, 'in_review');
    expect((await h.gate.start(req.id, 'manual').done).ok).toBe(true);
    expect(sh(repo, ['show', 'release/1.3:feature.txt'])).toBe('f');
  });

  it('a ticket of the requirement branches from the target in its own repository', async () => {
    const req = h.createRequirement(['mobile']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [mobileGoal] = await h.fanOutService.execute(req.id);
    const t = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /loc', body: 'Provide location endpoint', blocking: false },
      'mobile',
      mobileGoal.engine_task_id!
    );
    const ticket = h.task(t.ticketId);
    expect(ticket.branch).toBe(`${req.id}-ticket-${t.ticketId}`);
    expect(ticket.base_sha).toBe(headOf(h.backendRepo.repo, 'release/1.3'));
  });

  it('merges into the target branch and leaves develop alone', async () => {
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    const { repo } = h.backendRepo;
    const developBefore = headOf(repo, 'develop');
    commitOnBranch(repo, h.task(goal.id).branch, 'feature.txt', 'f\n');
    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goal.id);
    h.requirementService.updateStatus(req.id, 'in_review');
    expect((await h.gate.start(req.id, 'manual').done).ok).toBe(true);
    expect(sh(repo, ['show', 'release/1.3:feature.txt'])).toBe('f');
    expect(headOf(repo, 'develop')).toBe(developBefore);
  });
});

describe('Pushing branches to origin', () => {
  let h: GitHarness;
  afterEach(async () => {
    await pushesSettled();
    h.db.close();
  });
  const remoteHead = (origin: string, branch: string) => {
    try {
      return sh(origin, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    } catch {
      return null;
    }
  };

  it('pushes a new task branch and a new target branch at fan-out', async () => {
    h = makeGitHarness({ push: true });
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    await pushesSettled();
    const { repo, origin } = h.backendRepo;
    expect(remoteHead(origin!, req.id)).toBe(headOf(repo, req.id));
    expect(remoteHead(origin!, 'release/1.3')).toBe(headOf(repo, 'release/1.3'));
    expect(h.logText(goal.id)).toContain(`↑ Pushed ${req.id} to origin`);
  });

  it('pushes new commits of a task branch when asked (after an agent run)', async () => {
    h = makeGitHarness({ push: true });
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    await pushesSettled();
    const { repo, origin } = h.backendRepo;
    commitOnBranch(repo, req.id, 'a.txt', 'a\n');
    h.branches.pushTaskBranch(goal.id);
    await pushesSettled();
    expect(remoteHead(origin!, req.id)).toBe(headOf(repo, req.id));
  });

  it('never forces: a branch that moved on origin stays, and the task log says why', async () => {
    h = makeGitHarness({ push: true });
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    await pushesSettled();
    const { repo, origin } = h.backendRepo;
    const other = commitOnBranch(repo, 'develop', 'other.txt', 'o\n');
    sh(repo, ['push', '-q', '--force', 'origin', `${other}:refs/heads/${req.id}`]); // someone else moved it
    commitOnBranch(repo, req.id, 'mine.txt', 'm\n');
    h.branches.pushTaskBranch(goal.id);
    await pushesSettled();
    expect(remoteHead(origin!, req.id)).toBe(other);
    expect(h.logText(goal.id)).toContain(`Could not push ${req.id} to origin:`);
  });

  it('an unreachable origin does not hold up fan-out', async () => {
    h = makeGitHarness({ push: true });
    sh(h.backendRepo.repo, ['remote', 'set-url', 'origin', path.join(h.ws, 'no-such-origin.git')]);
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).status).toBe('queued');
    await pushesSettled();
    expect(h.logText(goal.id)).toContain(`Could not push ${req.id} to origin:`);
  });

  it('pushes nothing when turned off or without origin', async () => {
    h = makeGitHarness();
    const req = h.createRequirement(['backend']);
    await h.fanOutService.execute(req.id);
    await pushesSettled();
    expect(remoteHead(h.backendRepo.origin!, req.id)).toBeNull();
    h.db.close();
    h = makeGitHarness({ withOrigin: false, push: true });
    const other = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(other.id);
    await pushesSettled();
    expect(h.logText(goal.id)).not.toContain('origin');
  });
});

describe('Branch list', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());

  it('lists the branches of the chosen repositories and where each exists, without task branches', async () => {
    const req = h.createRequirement(['backend', 'mobile']);
    await h.fanOutService.execute(req.id);
    sh(h.backendRepo.repo, ['branch', 'release/1.3']);
    sh(h.mobileRepo.repo, ['branch', 'feature/x']);
    expect(h.branches.listBranches(['backend', 'mobile'])).toEqual([
      { name: 'develop', projects: ['backend', 'mobile'] },
      { name: 'feature/x', projects: ['mobile'] },
      { name: 'release/1.3', projects: ['backend'] },
    ]);
    expect(() => h.branches.listBranches(['nope'])).toThrow('Unknown repository: nope');
  });

  it('answers GET /api/branches', async () => {
    const app = createApp({
      db: h.db, workspaceService: new WorkspaceService(h.db), projectService: h.projectService, requirementService: h.requirementService,
      fanOutService: h.fanOutService, linkService: h.linkService, ticketService: h.ticketService, broadcaster: new SseBroadcaster(),
      notifier: new Notifier(), branchService: h.branches,
    });
    expect((await testRequest(app, 'GET', '/api/branches?projects=backend')).body).toEqual([{ name: 'develop', projects: ['backend'] }]);
    expect((await testRequest(app, 'GET', '/api/branches')).status).toBe(400);
  });
});

describe('Target and task branches never collide', () => {
  let h: GitHarness;
  afterEach(() => h.db.close());
  const rowsOf = (reqId: string) => h.db.prepare('SELECT COUNT(*) AS n FROM bridge_tasks WHERE req_id = ?').get(reqId);

  it("a requirement whose target is its own ID gets another task branch, and the merge keeps the agent's work", async () => {
    h = makeGitHarness({ withOrigin: false });
    new SettingsService(h.db).updateBranchMergeSettings({ auto_delete_branch: true });
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: req.id });
    const [goal] = await h.fanOutService.execute(req.id);
    const repo = h.backendRepo.repo;
    expect(h.task(goal.id).branch).toBe(`${req.id}-2`);

    commitOnBranch(repo, h.task(goal.id).branch, 'feature.txt', 'f\n');
    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goal.id);
    h.requirementService.updateStatus(req.id, 'in_review');
    expect((await h.gate.start(req.id, 'manual').done).ok).toBe(true);
    expect(sh(repo, ['show', `${req.id}:feature.txt`])).toBe('f');
  });

  it("another open requirement's target branch is not used as a task branch", async () => {
    h = makeGitHarness();
    const first = h.createRequirement(['backend']);
    const second = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(first.id, { target_branch: second.id });
    const [goal] = await h.fanOutService.execute(second.id);
    expect(h.task(goal.id).branch).toBe(`${second.id}-2`);
  });

  it('fan-out refuses a target that is a task branch, before reserving anything', async () => {
    h = makeGitHarness();
    const [goal] = await h.fanOutService.execute(h.createRequirement(['backend']).id);
    const second = h.createRequirement(['backend']);
    h.db.prepare('UPDATE requirements SET target_branch = ? WHERE id = ?').run(h.task(goal.id).branch, second.id);
    await expect(h.fanOutService.execute(second.id)).rejects.toThrow(`is the branch of task #${goal.id}`);
    expect(rowsOf(second.id)).toEqual({ n: 0 });
  });

  it('refuses at save a target that git cannot create next to an existing branch, either way round', () => {
    h = makeGitHarness();
    const repo = h.backendRepo.repo;
    sh(repo, ['branch', 'release/1.3']);
    sh(repo, ['branch', 'stable']);
    const req = h.createRequirement(['backend']);
    expect(() => h.requirementService.updateRunSettings(req.id, { target_branch: 'release' })).toThrow('release/1.3');
    expect(() => h.requirementService.updateRunSettings(req.id, { target_branch: 'stable/2' })).toThrow('stable');
    expect(h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.4' }).target_branch).toBe('release/1.4');
  });

  it('fan-out refuses such a target before reserving anything, so the target can still change', async () => {
    h = makeGitHarness();
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'hotfix' });
    sh(h.backendRepo.repo, ['branch', 'hotfix/1']);
    await expect(h.fanOutService.execute(req.id)).rejects.toThrow('hotfix/1');
    expect(rowsOf(req.id)).toEqual({ n: 0 });
    expect(h.requirementService.updateRunSettings(req.id, { target_branch: 'hotfix-2' }).target_branch).toBe('hotfix-2');
  });

  it('refuses at creation a target that git cannot create or that is a task branch, and creates nothing', async () => {
    h = makeGitHarness();
    sh(h.backendRepo.repo, ['branch', 'release/1.3']);
    const create = (target_branch: string) =>
      h.requirementService.createRequirement({
        title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal', target_branch,
      });
    expect(() => create('release')).toThrow('release/1.3');
    const [goal] = await h.fanOutService.execute(h.createRequirement(['backend']).id);
    expect(() => create(h.task(goal.id).branch)).toThrow(`is the branch of task #${goal.id}`);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM requirements').get()).toEqual({ n: 1 });
  });

  it('a task branch pattern that puts the branch under an existing branch fails with the reason', async () => {
    h = makeGitHarness();
    const req = h.createRequirement(['backend']);
    sh(h.backendRepo.repo, ['branch', req.id]);
    new SettingsService(h.db).updateBranchMergeSettings({ task_branch_pattern: '{req}/{project}' });
    await expect(h.fanOutService.execute(req.id)).rejects.toThrow(`${req.id}/backend in backend: the branch ${req.id} exists there`);
    expect(rowsOf(req.id)).toEqual({ n: 0 });
  });
});
