import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QaService } from './qaService.js';
import { OutboxScanner } from '../watcher/outboxScanner.js';
import { commitOnBranch, sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses, makeLocalHarness, type LocalHarness } from '../testing/localEngineFixture.js';
import { makeE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

const now = () => new Date().toISOString();

/** A task of `reqId` in `project` (the repository card findings go to). */
function addWork(h: LocalHarness, reqId = h.req.id, fields: Record<string, unknown> = {}, role = 'goal', project = 'backend'): number {
  const id = Number(
    h.db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, ?, ?, 'Ride tracking', 'done', ?, ?)")
      .run(reqId, project, role, now(), now()).lastInsertRowid
  );
  for (const [column, value] of Object.entries(fields)) h.db.prepare(`UPDATE bridge_tasks SET ${column} = ? WHERE id = ?`).run(value, id);
  return id;
}

function setup(h: LocalHarness = makeLocalHarness()) {
  let nudges = 0;
  const qa = new QaService({
    db: h.db, projectService: h.projectService, requirementService: h.requirementService, settingsService: h.settingsService,
    engine: { status: () => h.runner.status(), nudge: () => { nudges++; } },
  });
  const toQa = (id = h.req.id) => h.db.prepare("UPDATE requirements SET status = 'qa' WHERE id = ?").run(id);
  const runOf = (taskId: number) => h.db.prepare('SELECT * FROM local_runs WHERE bridge_task_id = ?').get(taskId) as any;
  const comments = (reqId = h.req.id) => h.db.prepare('SELECT * FROM review_comments WHERE req_id = ? ORDER BY id').all(reqId) as any[];
  return { h, qa, toQa, runOf, comments, nudges: () => nudges };
}

/** AI QA started for h.req with one goal on backend. */
function started(s: ReturnType<typeof setup>) {
  const goalId = addWork(s.h);
  s.toQa();
  const view = s.qa.start(s.h.req.id, 'manual');
  const task = view.runs[0].task;
  return { goalId, view, task, runId: s.runOf(task.id)?.id as string };
}

describe('AI QA: starting', () => {
  it('queues one QA run per git repository at the branch tip, with the QA prompt and the AI QA settings', () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ agentCli: 'claude-cli', model: 'sonnet', effort: 'high' });
    const { view, task, runId } = started(s);
    expect(view).toMatchObject({ reqId: s.h.req.id, round: 1, running: true, skipped: [], findings: { total: 0 } });
    expect(task).toMatchObject({ role: 'qa', project: 'backend', status: 'queued', base_sha: sh(s.h.repo, ['rev-parse', 'develop']), revision: 1, engine_task_id: null });
    const run = s.runOf(task.id);
    expect(run).toMatchObject({ id: runId, status: 'queued', model: 'sonnet', effort: 'high', preferred_cli: 'claude-cli' });
    expect(run.body_md).toContain(`# AI QA of ${s.h.req.id} in backend`);
    expect(run.body_md).toContain('1. Rides tracked');
    expect(s.nudges()).toBe(1);
  });

  it('uses the merged commit the merge gate gives', () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    const merged = sh(s.h.repo, ['rev-parse', 'develop']);
    commitOnBranch(s.h.repo, 'develop', 'later.txt', 'later\n');
    expect(s.qa.start(s.h.req.id, 'auto', { backend: merged }).runs[0].task.base_sha).toBe(merged);
  });

  it("checks the tip of the requirement's target branch", () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    sh(s.h.repo, ['branch', 'release/1', 'develop']);
    const tip = commitOnBranch(s.h.repo, 'release/1', 'release.txt', 'release\n');
    s.h.db.prepare("UPDATE requirements SET target_branch = 'release/1' WHERE id = ?").run(s.h.req.id);
    expect(s.qa.start(s.h.req.id, 'manual').runs[0].task.base_sha).toBe(tip);
  });

  it('lists changed files from the merge commits after the branches are deleted', () => {
    const s = setup();
    const branch = `req/${s.h.req.id}/task-99`;
    sh(s.h.repo, ['branch', branch, 'develop']);
    commitOnBranch(s.h.repo, branch, 'src/rides.ts', 'export const rides = [];\n');
    sh(s.h.repo, ['merge', '--no-ff', '-q', '-m', 'Merge rides', branch]);
    const mergeSha = sh(s.h.repo, ['rev-parse', 'HEAD']);
    const parent = sh(s.h.repo, ['rev-parse', `${mergeSha}^1`]);
    sh(s.h.repo, ['branch', '-D', branch]);
    addWork(s.h, s.h.req.id, { branch, merge_sha: mergeSha, merged_at: now() });
    s.toQa();
    const body = s.runOf(s.qa.start(s.h.req.id, 'manual').runs[0].task.id).body_md as string;
    expect(body).toContain('- src/rides.ts');
    expect(body).toContain(`git diff ${parent.slice(0, 12)}..${mergeSha.slice(0, 12)}`);
  });

  it('refuses outside QA, while QA runs, and without a git repository', () => {
    const s = setup();
    addWork(s.h);
    expect(() => s.qa.start(s.h.req.id, 'manual')).toThrow(`${s.h.req.id} is draft; AI QA runs while a requirement is in QA`);
    s.toQa();
    s.qa.start(s.h.req.id, 'manual');
    expect(() => s.qa.start(s.h.req.id, 'manual')).toThrow(`AI QA is already running for ${s.h.req.id}`);

    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    const docs = s.h.requirementService.createRequirement({ title: 'Docs', goal: 'Write docs', acceptance_criteria: [], affected_projects: ['docs'], priority: 'normal' });
    addWork(s.h, docs.id, {}, 'goal', 'docs');
    s.toQa(docs.id);
    expect(() => s.qa.start(docs.id, 'manual')).toThrow(`No repository of ${docs.id} is a git repository; AI QA needs one`);
  });

  it('skips repositories that are not git repositories and says so', () => {
    const s = setup();
    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    addWork(s.h);
    addWork(s.h, s.h.req.id, {}, 'goal', 'docs');
    s.toQa();
    const view = s.qa.start(s.h.req.id, 'manual');
    expect(view.runs.map((r) => r.project)).toEqual(['backend']);
    expect(view.skipped).toEqual([{ project: 'docs', reason: 'not a git repository' }]);
  });

  it('fails at once when no AI CLI can run QA', () => {
    const s = setup();
    s.h.settingsService.updateLocalEngineSettings({ enabled: false });
    const { task } = started(s);
    expect(task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: the Local AI CLI engine is turned off (Settings → AI & Local Engines)' });
    expect(s.runOf(task.id)).toBeUndefined();
    expect(s.qa.status(s.h.req.id).running).toBe(false);

    const other = setup();
    other.h.settingsService.updateAiQaSettings({ agentCli: 'codex-cli' });
    expect(started(other).task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: Codex is chosen for AI QA but is not installed on this PC' });
  });

  it('starts on entering QA only when Run automatically is on', () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    s.h.settingsService.updateAiQaSettings({ runAutomatically: false });
    s.qa.onEnteredQa(s.h.req.id, {});
    expect(s.qa.status(s.h.req.id).round).toBe(0);
    s.h.settingsService.updateAiQaSettings({ runAutomatically: true });
    s.qa.onEnteredQa(s.h.req.id, {});
    expect(s.qa.status(s.h.req.id).round).toBe(1);
    expect(() => s.qa.onEnteredQa(s.h.req.id, {})).not.toThrow(); // already running: logged, not thrown
  });
});

describe('AI QA: findings and result', () => {
  it("saves a finding as an open AI QA comment on the repository's goal card", () => {
    const s = setup();
    const { goalId, task, runId } = started(s);
    expect(s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved', body: 'POST /rides answers 500', file_path: 'src/rides.ts', line: 12 }, 'backend', runId))
      .toMatchObject({ duplicate: false });
    expect(s.comments()).toEqual([
      expect.objectContaining({
        task_id: goalId, state: 'open', source: 'ai-qa', severity: 'blocker', file_path: 'src/rides.ts', line: 12, qa_task_id: task.id,
        body_md: '**Rides are not saved**\n\nPOST /rides answers 500',
      }),
    ]);
    expect(s.h.logText(task.id)).toContain('⚑ blocker: Rides are not saved (src/rides.ts:12)');
  });

  it('puts the finding on the first ticket when the repository has no goal', () => {
    const s = setup();
    const ticketId = addWork(s.h, s.h.req.id, {}, 'ticket');
    s.toQa();
    const task = s.qa.start(s.h.req.id, 'manual').runs[0].task;
    s.qa.addFinding({ severity: 'minor', title: 'Naming is unclear' }, 'backend', s.runOf(task.id).id);
    expect(s.comments()[0]).toMatchObject({ task_id: ticketId, file_path: null, line: null, body_md: '**Naming is unclear**' });
  });

  it('saves the same finding once, refuses unsafe paths, and stops at the findings limit', () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ maxFindings: 2 });
    const { runId } = started(s);
    const first = s.qa.addFinding({ severity: 'major', title: 'Missing check', file_path: 'a.ts', line: 3 }, 'backend', runId);
    expect(s.qa.addFinding({ severity: 'major', title: '  missing   CHECK ', file_path: 'a.ts', line: 3 }, 'backend', runId)).toEqual({ commentId: first.commentId, duplicate: true });
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Outside', file_path: '../etc/passwd' }, 'backend', runId)).toThrow(/relative to the repository/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'No file', line: 4 }, 'backend', runId)).toThrow('--line needs --file');
    s.qa.addFinding({ severity: 'minor', title: 'Second one' }, 'backend', runId);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Third one' }, 'backend', runId)).toThrow('The QA run reached its limit of 2 findings');
    expect(s.comments()).toHaveLength(2);
  });

  it('refuses reports from unknown runs and once the requirement left QA', () => {
    const s = setup();
    const { runId } = started(s);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', 'local-nope')).toThrow(/^No QA run local-nope for backend/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', undefined)).toThrow(/^No QA run/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Wrong repo' }, 'mobile', runId)).toThrow(/^No QA run/);
    s.h.db.prepare("UPDATE requirements SET status = 'in_progress' WHERE id = ?").run(s.h.req.id);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Too late' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this finding was not saved`);
    expect(() => s.qa.recordResult({ passed: true, summary: 'ok' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this result was not saved`);
  });

  it('records the result, reports the header status, and a new round starts fresh', () => {
    const s = setup();
    const { task, runId } = started(s);
    s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved' }, 'backend', runId);
    s.qa.addFinding({ severity: 'minor', title: 'Naming' }, 'backend', runId);
    expect(s.qa.recordResult({ passed: false, summary: '1 blocker, 1 minor' }, 'backend', runId)).toEqual({ ok: true, passed: false, summary: '1 blocker, 1 minor' });
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(task.id);
    expect(s.qa.status(s.h.req.id)).toMatchObject({
      round: 1, running: false, findings: { total: 2, blocker: 1, major: 0, minor: 1 },
      runs: [{ project: 'backend', status: 'done', passed: false, summary: '1 blocker, 1 minor', error: null, findings: 2 }],
    });

    const next = s.qa.start(s.h.req.id, 'manual');
    expect(next).toMatchObject({ round: 2, running: true, findings: { total: 0 } });
    expect(next.runs).toHaveLength(1);
  });
});

describe('AI QA: reports through the outbox', () => {
  it('an AI QA run reports its findings and result through the outbox', async () => {
    const e = makeE2E();
    const s = setup(e);
    const req = e.requirementService.createRequirement({
      title: 'Rides', goal: 'Track rides\nFAKE: qa-comment major|src/rides.ts|7|Missing validation\nFAKE: qa-result failed|One major problem',
      acceptance_criteria: ['Rides tracked'], affected_projects: ['backend'], priority: 'normal',
    });
    addWork(e, req.id);
    s.toQa(req.id);
    const task = s.qa.start(req.id, 'manual').runs[0].task;
    await e.settle();

    const scanner = new OutboxScanner(e.projectService, e.tickets, e.questions, path.join(e.ws, 'agent-outbox'), s.qa);
    expect(await scanner.scanOnce()).toBe(2);
    expect(s.comments(req.id)).toEqual([
      expect.objectContaining({ source: 'ai-qa', severity: 'major', file_path: 'src/rides.ts', line: 7, body_md: '**Missing validation**' }),
    ]);
    expect(e.task(task.id)).toMatchObject({ status: 'done', qa_passed: 0, qa_summary: 'One major problem' });
  });

  it('rejects a late outbox finding once the requirement left QA', async () => {
    const e = makeE2E();
    const s = setup(e);
    const { runId } = started(s);
    e.db.prepare("UPDATE requirements SET status = 'in_progress' WHERE id = ?").run(e.req.id);
    const outbox = path.join(e.ws, 'agent-outbox', 'backend');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(path.join(outbox, 'qa-comment-1.json'), JSON.stringify({ kind: 'qa-comment', severity: 'minor', title: 'Late one', project: 'backend', engineTaskId: runId }));

    const scanner = new OutboxScanner(e.projectService, e.tickets, e.questions, path.join(e.ws, 'agent-outbox'), s.qa);
    expect(await scanner.scanOnce()).toBe(0);
    expect(fs.existsSync(path.join(outbox, 'qa-comment-1.json'))).toBe(false);
    expect(fs.readFileSync(path.join(outbox, 'failed', 'qa-comment-1.json.error.txt'), 'utf8')).toContain('is no longer in QA; this finding was not saved');
    expect(s.comments()).toEqual([]);
  });
});
