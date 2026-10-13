import { describe, it, expect } from 'vitest';
import { findingsText, qaBadge, qaRunText, qaStatusLine, runAiQaBlocked } from './aiQa';

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
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true }), run('frontend', 'done')]))).toEqual({ text: 'AI QA passed', tone: 'passed' });
  });

  it('says why a run could not finish, and which repositories were skipped', () => {
    expect(
      qaStatusLine(qa([run('backend', 'failed', { error: 'Claude Code failed: exit code 1\nmore output' })], { skipped: [{ project: 'docs', reason: 'not a git repository' }] }))
    ).toEqual({ text: 'AI QA failed: backend: Claude Code failed: exit code 1 · skipped docs: not a git repository', tone: 'failed' });
  });

  it('describes one repository run', () => {
    expect(qaRunText(run('backend', 'done', { passed: false, summary: '1 blocker', findings: 1 }))).toBe('Found problems: 1 blocker · 1 finding');
    expect(qaRunText(run('backend', 'done'))).toBe('Done');
    expect(qaRunText(run('backend', 'queued'))).toBe('Waiting to start');
    expect(qaRunText(run('backend', 'cancelled'))).toBe('Stopped');
    expect(qaRunText(run('backend', 'failed', { error: 'No AI CLI can run QA: off' }))).toBe('Failed: No AI CLI can run QA: off');
  });

  it('badges AI QA findings with their severity', () => {
    expect(qaBadge({ source: 'ai-qa', severity: 'blocker' })).toBe('AI QA · blocker');
    expect(qaBadge({ source: 'person', severity: null })).toBeNull();
  });

  it('offers Run AI QA only in QA and while nothing runs', () => {
    expect(runAiQaBlocked('in_review', undefined)).toBe('AI QA runs while the requirement is in QA');
    expect(runAiQaBlocked('qa', qa([run('backend', 'running')]))).toBe('AI QA is running');
    expect(runAiQaBlocked('qa', qa([run('backend', 'done')]))).toBeNull();
    expect(runAiQaBlocked('qa', undefined)).toBeNull();
  });
});
