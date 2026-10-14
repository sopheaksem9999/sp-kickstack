import { describe, it, expect } from 'vitest';
import { DEFAULT_QA_TIERS } from '@sp-kickstack/shared';
import { aiQaDraftProblem, findingsText, mergeWarning, qaBadge, qaCliStatus, qaRoundTitle, qaRunText, qaRunTitle, qaStatusLine, runAiQaBlocked } from './aiQa';

const run = (project: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ task: { id: 1 }, project, status, passed: null, summary: null, error: null, findings: 0, ...extra }) as any;
const qa = (runs: any[], extra: Record<string, unknown> = {}) =>
  ({
    reqId: 'REQ-1', round: 1, running: runs.some((r) => ['pending', 'queued', 'running', 'rate_limited'].includes(r.status)), runs, skipped: [],
    findings: { total: 0, blocker: 0, major: 0, minor: 0 }, ...extra,
  }) as any;

describe('AI QA header', () => {
  it('shows nothing before the first QA run', () => {
    expect(qaStatusLine(undefined)).toBeNull();
    expect(qaStatusLine(qa([], { round: 0 }))).toBeNull();
  });

  it('shows each repository while QA runs', () => {
    expect(qaStatusLine(qa([run('backend', 'done'), run('frontend', 'running')]))).toEqual({ text: 'AI QA running… (backend ✓, frontend …)', tone: 'running' });
  });

  it('counts findings and blockers', () => {
    expect(qaStatusLine(qa([run('backend', 'done', { passed: false })], { findings: { total: 3, blocker: 1, major: 2, minor: 0 } }))).toEqual({
      text: 'AI QA: 3 findings (1 blocker)', tone: 'findings',
    });
    expect(findingsText({ total: 1, blocker: 0, major: 0, minor: 1 })).toBe('1 finding');
    expect(findingsText({ total: 4, blocker: 2, major: 0, minor: 2 })).toBe('4 findings (2 blockers)');
  });

  it('says passed when every run passed without findings', () => {
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true }), run('frontend', 'done', { passed: true })]))).toEqual({ text: 'AI QA passed', tone: 'passed' });
  });

  it('says passed with the count when every run passed and nothing is a blocker', () => {
    const minor = { findings: { total: 3, blocker: 0, major: 0, minor: 3 } };
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true }), run('frontend', 'done', { passed: true })], minor))).toEqual({
      text: 'AI QA passed · 3 minor findings', tone: 'passed',
    });
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true })], { findings: { total: 1, blocker: 0, major: 0, minor: 1 } }))).toEqual({
      text: 'AI QA passed · 1 minor finding', tone: 'passed',
    });
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true })], { findings: { total: 2, blocker: 0, major: 1, minor: 1 } }))).toEqual({
      text: 'AI QA passed · 2 findings (1 major)', tone: 'passed',
    });
    // A blocker outweighs the agent's "passed".
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true })], { findings: { total: 1, blocker: 1, major: 0, minor: 0 } }))).toEqual({
      text: 'AI QA: 1 finding (1 blocker)', tone: 'findings',
    });
  });

  it('never says passed for a run that ended without a result', () => {
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true }), run('frontend', 'done', { summary: 'Finished without a result' })]))).toEqual({
      text: 'AI QA: frontend finished without a result', tone: 'findings',
    });
  });

  it('says why a run could not finish, and which repositories were skipped', () => {
    expect(
      qaStatusLine(qa([run('backend', 'failed', { error: 'Claude Code failed: exit code 1\nmore output' })], { skipped: [{ project: 'docs', reason: 'not a git repository' }] }))
    ).toEqual({ text: 'AI QA failed: backend: Claude Code failed: exit code 1 · skipped docs: not a git repository', tone: 'failed' });
  });

  it('describes one repository run', () => {
    expect(qaRunText(run('backend', 'done', { passed: false, summary: '1 blocker', findings: 1 }))).toBe('Found problems: 1 blocker · 1 finding');
    expect(qaRunText(run('backend', 'done', { summary: 'Finished without a result' }))).toBe('Finished without a result');
    expect(qaRunText(run('backend', 'queued'))).toBe('Waiting to start');
    expect(qaRunText(run('backend', 'cancelled'))).toBe('Stopped');
    expect(qaRunText(run('backend', 'failed', { error: 'No AI CLI can run QA: off' }))).toBe('Failed: No AI CLI can run QA: off');
  });

  it('badges AI QA findings with their severity', () => {
    expect(qaBadge({ source: 'ai-qa', severity: 'blocker' })).toBe('AI QA · blocker');
    expect(qaBadge({ source: 'person', severity: null })).toBeNull();
  });

  it('offers Run AI QA in review and in QA, while nothing runs and no merge runs', () => {
    expect(runAiQaBlocked({ status: 'in_progress' }, undefined)).toBe('AI QA runs while the requirement is in review or in QA');
    expect(runAiQaBlocked({ status: 'in_review' }, undefined)).toBeNull();
    expect(runAiQaBlocked({ status: 'qa', merge_state: 'running' }, undefined)).toBe('A merge is running');
    expect(runAiQaBlocked({ status: 'qa' }, qa([run('backend', 'running')]))).toBe('AI QA is running');
    expect(runAiQaBlocked({ status: 'qa' }, qa([run('backend', 'done')]))).toBeNull();
  });

  it('prefixes review rounds with "AI QA before merge" and names a repository once', () => {
    const review = { stage: 'review' };
    expect(qaStatusLine(qa([run('backend', 'running')], review))?.text).toBe('AI QA before merge running… (backend …)');
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true })], review))).toEqual({ text: 'AI QA before merge: passed', tone: 'passed' });
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true })], { ...review, findings: { total: 2, blocker: 0, major: 0, minor: 2 } }))?.text)
      .toBe('AI QA before merge: passed · 2 minor findings');
    expect(qaStatusLine(qa([run('backend', 'done', { passed: false })], { ...review, findings: { total: 1, blocker: 1, major: 0, minor: 0 } }))?.text)
      .toBe('AI QA before merge: 1 finding (1 blocker)');
    expect(qaStatusLine(qa([run('backend', 'failed', { error: 'backend: merging x into develop conflicts in a.ts' })], review))?.text)
      .toBe('AI QA before merge failed: backend: merging x into develop conflicts in a.ts');
  });

  it("titles the round and shows each repository's tier", () => {
    expect(qaRoundTitle(qa([run('backend', 'done')], { stage: 'review', previewInto: 'develop' }))).toBe('AI QA · round 1 · merge preview into develop');
    expect(qaRoundTitle(qa([run('backend', 'done')], { stage: 'qa', round: 2 }))).toBe('AI QA · round 2');
    expect(qaRunTitle(run('backend', 'done', { tier: 'light', tierReason: '42 lines in 3 files' }))).toBe('backend · light · 42 lines in 3 files');
    expect(qaRunTitle(run('backend', 'done'))).toBe('backend');
  });

  it('asks before a merge while a review round runs or blockers are open', () => {
    expect(mergeWarning(undefined)).toBeNull();
    expect(mergeWarning(qa([run('backend', 'running')], { stage: 'review', openBlockers: 0 }))).toBe('AI QA is still checking this requirement. Merge anyway?');
    expect(mergeWarning(qa([run('backend', 'done')], { stage: 'review', openBlockers: 2 }))).toBe('2 open AI QA blockers. Merge anyway?');
    expect(mergeWarning(qa([run('backend', 'done')], { stage: 'review', openBlockers: 1 }))).toBe('1 open AI QA blocker. Merge anyway?');
    expect(mergeWarning(qa([run('backend', 'done')], { stage: 'review', openBlockers: 0 }))).toBeNull();
  });
});

describe('AI QA settings', () => {
  const draft = {
    runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
    modelMode: 'auto', tiers: DEFAULT_QA_TIERS, lightMaxLines: 150, deepMinLines: 1000,
  } as const;

  it('checks a draft like the server', () => {
    expect(aiQaDraftProblem({ ...draft })).toBeNull();
    expect(aiQaDraftProblem({ ...draft, timeLimitMinutes: 2 })).toBe('Time limit must be a whole number of minutes from 5 to 240.');
    expect(aiQaDraftProblem({ ...draft, maxFindings: 0 })).toBe('Maximum findings must be a whole number from 1 to 200.');
    expect(aiQaDraftProblem({ ...draft, model: 'bad model' })).toBe('Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus');
  });

  it('shows which CLI runs QA, with its live badges', () => {
    const status = {
      enabled: true, cli: 'claude-cli', problem: null, maxParallel: 2, worktreeRoot: '/w',
      counts: { running: 0, queued: 0, held: 0, rate_limited: 0 },
      clis: [
        { id: 'claude-cli', label: 'Claude Code', installed: true, enabled: true, pausedUntil: null },
        { id: 'codex-cli', label: 'Codex', installed: false, enabled: true, pausedUntil: null },
      ],
    } as any;
    expect(qaCliStatus('default', status)).toEqual({ text: 'AI QA runs with Claude Code · Installed on PC · HEALTHY', good: true });
    expect(qaCliStatus('codex-cli', status)).toEqual({ text: 'AI QA runs with Codex · Not Detected · HEALTHY', good: false });
    expect(qaCliStatus('default', { ...status, enabled: false })).toEqual({ text: 'The Local AI CLI engine is turned off: AI QA cannot run', good: false });
    expect(qaCliStatus('default', { ...status, cli: null, problem: 'No AI CLI is installed' })).toEqual({ text: 'No AI CLI is installed', good: false });
    expect(qaCliStatus('default', undefined)).toBeNull();
  });
});
