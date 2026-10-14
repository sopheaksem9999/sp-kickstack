import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QaService } from './qaService.js';
import { OutboxScanner } from '../watcher/outboxScanner.js';
import { commitOnBranch, makeRepo, sh } from '../testing/gitFixture.js';
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

/** A goal of `reqId` with an unmerged branch carrying one commit. */
function unmergedGoal(h: LocalHarness, file: string, content: string, reqId = h.req.id, repo = h.repo, project = 'backend'): { id: number; branch: string } {
  const branch = `req/${reqId}/${project}-${file.replace(/[^a-z0-9]+/gi, '-')}`;
  const base = sh(repo, ['rev-parse', 'develop']);
  sh(repo, ['branch', branch, 'develop']);
  commitOnBranch(repo, branch, file, content);
  return { id: addWork(h, reqId, { branch, base_sha: base, status: 'in_review' }, 'goal', project), branch };
}

/** A goal whose branch was merged into develop (merge commit), as the merge gate leaves it. */
function mergedGoal(h: LocalHarness, file: string, content: string, reqId = h.req.id): { id: number; mergeSha: string } {
  const branch = `req/${reqId}/merged-${file.replace(/[^a-z0-9]+/gi, '-')}`;
  sh(h.repo, ['branch', branch, 'develop']);
  commitOnBranch(h.repo, branch, file, content);
  sh(h.repo, ['merge', '--no-ff', '-q', '-m', `Merge ${branch}`, branch]);
  const mergeSha = sh(h.repo, ['rev-parse', 'HEAD']);
  return { id: addWork(h, reqId, { branch, merge_sha: mergeSha, merged_at: now() }), mergeSha };
}

function setup(h: LocalHarness = makeLocalHarness()) {
  let nudges = 0;
  const qa = new QaService({
    db: h.db, projectService: h.projectService, requirementService: h.requirementService, settingsService: h.settingsService,
    engine: { status: () => h.runner.status(), nudge: () => { nudges++; } },
  });
  const setStatus = (status: string, id = h.req.id) => h.db.prepare('UPDATE requirements SET status = ? WHERE id = ?').run(status, id);
  const toQa = (id = h.req.id) => setStatus('qa', id);
  const toReview = (id = h.req.id) => setStatus('in_review', id);
  const runOf = (taskId: number) => h.db.prepare('SELECT * FROM local_runs WHERE bridge_task_id = ?').get(taskId) as any;
  const task = (id: number) => h.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  const comments = (reqId = h.req.id) => h.db.prepare('SELECT * FROM review_comments WHERE req_id = ? ORDER BY id').all(reqId) as any[];
  return { h, qa, setStatus, toQa, toReview, runOf, task, comments, nudges: () => nudges };
}

/** AI QA started for h.req (in QA) with one goal on backend. */
async function started(s: ReturnType<typeof setup>) {
  const goalId = addWork(s.h);
  s.toQa();
  const view = await s.qa.start(s.h.req.id, 'manual');
  const task = view.runs[0].task;
  return { goalId, view, task, runId: s.runOf(task.id)?.id as string };
}

describe('AI QA: starting in QA', () => {
  it('queues one QA run per git repository at the branch tip, with the QA prompt and the fixed model', async () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ agentCli: 'claude-cli', model: 'sonnet', effort: 'high', modelMode: 'fixed' });
    const { view, task, runId } = await started(s);
    expect(view).toMatchObject({ reqId: s.h.req.id, round: 1, running: true, skipped: [], findings: { total: 0 }, stage: 'qa', previewInto: null });
    expect(task).toMatchObject({
      role: 'qa', project: 'backend', status: 'queued', base_sha: sh(s.h.repo, ['rev-parse', 'develop']), revision: 1, engine_task_id: null,
      qa_stage: 'qa', qa_tier: null,
    });
    const run = s.runOf(task.id);
    expect(run).toMatchObject({ id: runId, status: 'queued', model: 'sonnet', effort: 'high', preferred_cli: 'claude-cli' });
    expect(run.body_md).toContain(`# AI QA of ${s.h.req.id} in backend`);
    expect(run.body_md).toContain('the code after the requirement was merged');
    expect(run.body_md).toContain('1. Rides tracked');
    expect(s.nudges()).toBe(1);
  });

  it("checks the tip of the requirement's target branch", async () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    sh(s.h.repo, ['branch', 'release/1', 'develop']);
    const tip = commitOnBranch(s.h.repo, 'release/1', 'release.txt', 'release\n');
    s.h.db.prepare("UPDATE requirements SET target_branch = 'release/1' WHERE id = ?").run(s.h.req.id);
    expect((await s.qa.start(s.h.req.id, 'manual')).runs[0].task.base_sha).toBe(tip);
  });

  it('lists changed files from the merge commits after the branches are deleted', async () => {
    const s = setup();
    const { mergeSha, id } = mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    sh(s.h.repo, ['branch', '-D', s.task(id).branch]);
    const parent = sh(s.h.repo, ['rev-parse', `${mergeSha}^1`]);
    s.toQa();
    const body = s.runOf((await s.qa.start(s.h.req.id, 'manual')).runs[0].task.id).body_md as string;
    expect(body).toContain('- src/rides.ts');
    expect(body).toContain(`git diff ${parent.slice(0, 12)}..${mergeSha.slice(0, 12)}`);
  });

  it('refuses outside review and QA, while QA runs, during a merge, and without a git repository', async () => {
    const s = setup();
    addWork(s.h);
    await expect(s.qa.start(s.h.req.id, 'manual')).rejects.toThrow(`${s.h.req.id} is draft; AI QA runs while a requirement is in review or in QA`);
    s.toQa();
    s.h.db.prepare("UPDATE requirements SET merge_state = 'running' WHERE id = ?").run(s.h.req.id);
    await expect(s.qa.start(s.h.req.id, 'manual')).rejects.toThrow(`A merge of ${s.h.req.id} is running; wait for it to finish`);
    s.h.db.prepare("UPDATE requirements SET merge_state = 'idle' WHERE id = ?").run(s.h.req.id);
    await s.qa.start(s.h.req.id, 'manual');
    await expect(s.qa.start(s.h.req.id, 'manual')).rejects.toThrow(`AI QA is already running for ${s.h.req.id}`);

    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    const docs = s.h.requirementService.createRequirement({ title: 'Docs', goal: 'Write docs', acceptance_criteria: [], affected_projects: ['docs'], priority: 'normal' });
    addWork(s.h, docs.id, {}, 'goal', 'docs');
    s.toQa(docs.id);
    await expect(s.qa.start(docs.id, 'manual')).rejects.toThrow(`No repository of ${docs.id} is a git repository; AI QA needs one`);
  });

  it('skips repositories that are not git repositories and says so', async () => {
    const s = setup();
    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    addWork(s.h);
    addWork(s.h, s.h.req.id, {}, 'goal', 'docs');
    s.toQa();
    const view = await s.qa.start(s.h.req.id, 'manual');
    expect(view.runs.map((r) => r.project)).toEqual(['backend']);
    expect(view.skipped).toEqual([{ project: 'docs', reason: 'not a git repository' }]);
  });

  it('fails at once when no AI CLI can run QA', async () => {
    const s = setup();
    s.h.settingsService.updateLocalEngineSettings({ enabled: false });
    const { task } = await started(s);
    expect(task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: the Local AI CLI engine is turned off (Settings → AI & Local Engines)' });
    expect(s.runOf(task.id)).toBeUndefined();
    expect(s.qa.status(s.h.req.id).running).toBe(false);

    const other = setup();
    other.h.settingsService.updateAiQaSettings({ agentCli: 'codex-cli' });
    expect((await started(other)).task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: Codex is chosen for AI QA but is not installed on this PC' });
  });
});

describe('AI QA: in review (merge preview)', () => {
  it('in review, checks a merge preview of the unmerged branches and records the stage', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    const develop = sh(s.h.repo, ['rev-parse', 'develop']);
    const refs = sh(s.h.repo, ['for-each-ref']);
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'manual');
    const task = view.runs[0].task;
    expect(view).toMatchObject({ stage: 'review', previewInto: 'develop', running: true });
    expect(task.qa_stage).toBe('review');
    expect(task.base_sha).not.toBe(develop);
    expect(sh(s.h.repo, ['show', `${task.base_sha}:src/rides.ts`])).toBe('export const rides = [];');
    expect(sh(s.h.repo, ['rev-parse', 'develop'])).toBe(develop);
    expect(sh(s.h.repo, ['for-each-ref'])).toBe(refs);
    const body = s.runOf(task.id).body_md as string;
    expect(body).toContain("a temporary merge of the requirement's branches into `develop`, not merged yet");
    expect(body).toContain('- src/rides.ts');
    expect(body).toContain(`git diff ${develop.slice(0, 12)}..${task.base_sha!.slice(0, 12)}`);
  });

  it("previews into the requirement's target branch", async () => {
    const s = setup();
    sh(s.h.repo, ['branch', 'release/1', 'develop']);
    commitOnBranch(s.h.repo, 'release/1', 'release.txt', 'release\n');
    s.h.db.prepare("UPDATE requirements SET target_branch = 'release/1' WHERE id = ?").run(s.h.req.id);
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'manual');
    const sha = view.runs[0].task.base_sha;
    expect(view.previewInto).toBe('release/1');
    expect(sh(s.h.repo, ['show', `${sha}:release.txt`])).toBe('release');
    expect(sh(s.h.repo, ['show', `${sha}:src/rides.ts`])).toBe('export const rides = [];');
  });

  it('a conflicting branch fails only its repository', async () => {
    const s = setup();
    const { repo: mobileRepo } = makeRepo(path.join(s.h.ws, 'mobile'));
    s.h.projectService.registerProject({ name: 'mobile', kind: 'mobile', repo_path: mobileRepo, engine_type: 'local', base_branch: 'develop', enabled: true });
    const { branch } = unmergedGoal(s.h, 'README.md', '# from the branch\n');
    commitOnBranch(s.h.repo, 'develop', 'README.md', '# from develop\n');
    unmergedGoal(s.h, 'app.ts', 'export {};\n', s.h.req.id, mobileRepo, 'mobile');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'manual');
    const byProject = Object.fromEntries(view.runs.map((r) => [r.project, r]));
    expect(byProject.backend).toMatchObject({
      status: 'failed', error: `backend: merging ${branch} into develop conflicts in README.md (Merge & move to QA would conflict too)`,
    });
    expect(byProject.mobile.status).toBe('queued');
  });

  it('refuses a second start while the first is still building previews', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const first = s.qa.start(s.h.req.id, 'manual');
    await expect(s.qa.start(s.h.req.id, 'auto')).rejects.toThrow(`AI QA is already running for ${s.h.req.id}`);
    expect(s.qa.autoMergeHold(s.h.req.id)).toBe('AI QA is still checking');
    await first;
    expect(s.qa.status(s.h.req.id).round).toBe(1);
  });

  it('reports the round as running while its previews are still being built', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const first = s.qa.start(s.h.req.id, 'manual');
    expect(s.qa.status(s.h.req.id)).toMatchObject({ round: 1, running: true, stage: 'review' });
    await first;
    expect(s.qa.status(s.h.req.id)).toMatchObject({ round: 1, running: true, stage: 'review', runs: [{ project: 'backend' }] });
  });

  it('starts on entering review only when Run automatically is on', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    s.h.settingsService.updateAiQaSettings({ runAutomatically: false });
    await s.qa.onEnteredReview(s.h.req.id);
    expect(s.qa.status(s.h.req.id).round).toBe(0);
    s.h.settingsService.updateAiQaSettings({ runAutomatically: true });
    await s.qa.onEnteredReview(s.h.req.id);
    expect(s.qa.status(s.h.req.id)).toMatchObject({ round: 1, stage: 'review' });
    await expect(s.qa.onEnteredReview(s.h.req.id)).resolves.toBeUndefined(); // already running: logged, not thrown
  });

  it('holds auto-merge while the review round runs or blockers are open', async () => {
    const s = setup();
    s.h.requirementService.updateRequirementMergePolicy(s.h.req.id, 'auto_merge');
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'auto');
    const qaTask = view.runs[0].task;
    expect(s.qa.autoMergeHold(s.h.req.id)).toBe('AI QA is still checking');
    expect(s.qa.status(s.h.req.id).autoMergeHold).toBe('AI QA is still checking');

    s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved' }, 'backend', s.runOf(qaTask.id).id);
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(qaTask.id);
    expect(s.qa.autoMergeHold(s.h.req.id)).toBe('1 open AI QA blocker');
    expect(s.qa.status(s.h.req.id)).toMatchObject({ openBlockers: 1, autoMergeHold: '1 open AI QA blocker' });

    s.h.db.prepare("UPDATE review_comments SET state = 'resolved'").run();
    expect(s.qa.autoMergeHold(s.h.req.id)).toBeNull();
  });

  it('does not hold auto-merge when the review round failed at once', async () => {
    const s = setup();
    s.h.settingsService.updateLocalEngineSettings({ enabled: false });
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'auto');
    expect(view.runs[0].status).toBe('failed');
    expect(s.qa.autoMergeHold(s.h.req.id)).toBeNull();
  });

  it('refuses review findings once the requirement left review', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const runId = s.runOf((await s.qa.start(s.h.req.id, 'manual')).runs[0].task.id).id;
    s.toQa();
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Too late' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in review; this finding was not saved`);
    expect(() => s.qa.recordResult({ passed: true, summary: 'ok' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in review; this result was not saved`);
  });

  it('a QA-stage run after a review round checks the merged tip', async () => {
    const s = setup();
    const goal = unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const review = await s.qa.start(s.h.req.id, 'manual');
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE role = 'qa'").run();
    sh(s.h.repo, ['merge', '--no-ff', '-q', '-m', 'Merge rides', goal.branch]);
    const merged = sh(s.h.repo, ['rev-parse', 'HEAD']);
    s.h.db.prepare('UPDATE bridge_tasks SET merge_sha = ?, merged_at = ? WHERE id = ?').run(merged, now(), goal.id);
    s.toQa();
    const view = await s.qa.start(s.h.req.id, 'manual');
    expect(view).toMatchObject({ round: 2, stage: 'qa' });
    expect(view.runs[0].task.base_sha).toBe(merged);
    expect(view.runs[0].task.base_sha).not.toBe(review.runs[0].task.base_sha);
  });
});

describe('AI QA: model by size and risk', () => {
  it('picks the tier from the change and records why', async () => {
    const s = setup();
    mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    expect(task).toMatchObject({ qa_tier: 'light', qa_tier_reason: '1 line in 1 file' });
    expect(s.runOf(task.id)).toMatchObject({ model: 'haiku', effort: 'low' });
    expect(s.h.logText(task.id)).toContain('· light: 1 line in 1 file → haiku · low');
    expect(s.qa.status(s.h.req.id).runs[0]).toMatchObject({ tier: 'light', tierReason: '1 line in 1 file' });
  });

  it("uses the deep tier for the project's high-risk paths", async () => {
    const s = setup();
    s.h.projectService.updateProject('backend', { high_risk_paths: ['src/'] });
    mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    expect(task).toMatchObject({ qa_tier: 'deep', qa_tier_reason: 'touches src/rides.ts' });
    expect(s.runOf(task.id)).toMatchObject({ model: 'opus', effort: 'high' });
  });

  it('keeps the fixed model in Fixed mode', async () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ modelMode: 'fixed', model: 'sonnet', effort: 'medium' });
    mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    expect(task.qa_tier).toBeNull();
    expect(s.runOf(task.id)).toMatchObject({ model: 'sonnet', effort: 'medium' });
  });
});

describe('AI QA: findings and result', () => {
  it("saves a finding as an open AI QA comment on the repository's goal card", async () => {
    const s = setup();
    const { goalId, task, runId } = await started(s);
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

  it('puts the finding on the first ticket when the repository has no goal', async () => {
    const s = setup();
    const ticketId = addWork(s.h, s.h.req.id, {}, 'ticket');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    s.qa.addFinding({ severity: 'minor', title: 'Naming is unclear' }, 'backend', s.runOf(task.id).id);
    expect(s.comments()[0]).toMatchObject({ task_id: ticketId, file_path: null, line: null, body_md: '**Naming is unclear**' });
  });

  it('saves the same finding once, refuses unsafe paths, and stops at the findings limit', async () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ maxFindings: 2 });
    const { runId } = await started(s);
    const first = s.qa.addFinding({ severity: 'major', title: 'Missing check', file_path: 'a.ts', line: 3 }, 'backend', runId);
    expect(s.qa.addFinding({ severity: 'major', title: '  missing   CHECK ', file_path: 'a.ts', line: 3 }, 'backend', runId)).toEqual({ commentId: first.commentId, duplicate: true });
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Outside', file_path: '../etc/passwd' }, 'backend', runId)).toThrow(/relative to the repository/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'No file', line: 4 }, 'backend', runId)).toThrow('--line needs --file');
    s.qa.addFinding({ severity: 'minor', title: 'Second one' }, 'backend', runId);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Third one' }, 'backend', runId)).toThrow('The QA run reached its limit of 2 findings');
    expect(s.comments()).toHaveLength(2);
  });

  it('refuses reports from unknown runs and once the requirement left QA', async () => {
    const s = setup();
    const { runId } = await started(s);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', 'local-nope')).toThrow(/^No QA run local-nope for backend/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', undefined)).toThrow(/^No QA run/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Wrong repo' }, 'mobile', runId)).toThrow(/^No QA run/);
    s.h.db.prepare("UPDATE requirements SET status = 'in_progress' WHERE id = ?").run(s.h.req.id);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Too late' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this finding was not saved`);
    expect(() => s.qa.recordResult({ passed: true, summary: 'ok' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this result was not saved`);
  });

  it('records the result, reports the header status, and a new round starts fresh', async () => {
    const s = setup();
    const { task, runId } = await started(s);
    s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved' }, 'backend', runId);
    s.qa.addFinding({ severity: 'minor', title: 'Naming' }, 'backend', runId);
    expect(s.qa.recordResult({ passed: false, summary: '1 blocker, 1 minor' }, 'backend', runId)).toEqual({ ok: true, passed: false, summary: '1 blocker, 1 minor' });
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(task.id);
    expect(s.qa.status(s.h.req.id)).toMatchObject({
      round: 1, running: false, findings: { total: 2, blocker: 1, major: 0, minor: 1 }, openBlockers: 0, autoMergeHold: null,
      runs: [{ project: 'backend', status: 'done', passed: false, summary: '1 blocker, 1 minor', error: null, findings: 2 }],
    });

    const next = await s.qa.start(s.h.req.id, 'manual');
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
    const task = (await s.qa.start(req.id, 'manual')).runs[0].task;
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
    const { runId } = await started(s);
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
