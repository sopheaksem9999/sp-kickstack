import { describe, it, expect } from 'vitest';
import { isMergeReady, mergeCopy, mergeGateAction, policyLabel } from './mergeReady';

const task = (role: string, status: string) => ({ role, status }) as any;

describe('isMergeReady', () => {
  it('is false until every goal and ticket is in review or done', () => {
    expect(isMergeReady('in_progress', [task('goal', 'in_review'), task('goal', 'running')])).toBe(false);
    expect(isMergeReady('in_review', [task('goal', 'in_review'), task('ticket', 'done')])).toBe(true);
  });

  it('ignores cancelled tasks and waiting placeholders', () => {
    expect(isMergeReady('qa', [task('goal', 'done'), task('goal', 'cancelled'), task('waiting', 'held')])).toBe(true);
  });

  it('is false with no dispatched work, or once done or cancelled', () => {
    expect(isMergeReady('qa', [])).toBe(false);
    expect(isMergeReady('done', [task('goal', 'done')])).toBe(false);
    expect(isMergeReady('cancelled', [task('goal', 'done')])).toBe(false);
  });
});

describe('mergeCopy', () => {
  it('never claims a git merge outside demo mode', () => {
    const copy = mergeCopy(false);
    expect(copy.action).toBe('Confirm merged');
    expect(`${copy.action} ${copy.success}`).not.toMatch(/merged into main/i);
    expect(copy.success).toMatch(/no git operation/i);
  });

  it('keeps the demo wording in demo mode', () => {
    expect(mergeCopy(true).action).toMatch(/Merge to Main/);
  });
});

describe('mergeGateAction', () => {
  const t = (role: string, status: string, extra: Record<string, unknown> = {}) => ({ role, status, ...extra }) as any;
  const req = (status: string, merge_state = 'idle') => ({ status, merge_state }) as any;
  const branched = (status: string, merged = false) =>
    t('goal', status, { branch: 'req/REQ-001/task-1', merged_at: merged ? 'x' : null });

  it('offers "merge" when every task is in review and branches are unmerged', () => {
    expect(mergeGateAction(req('in_review'), [branched('in_review'), branched('done')])).toBe('merge');
  });

  it('shows "merging" while the gate runs', () => {
    expect(mergeGateAction(req('in_review', 'running'), [branched('in_review')])).toBe('merging');
  });

  it('offers nothing while some branched work is still running', () => {
    expect(mergeGateAction(req('in_progress'), [branched('in_review'), branched('running')])).toBeNull();
  });

  it('keeps the legacy "confirm" action for work without branches', () => {
    expect(mergeGateAction(req('in_review'), [t('goal', 'in_review', { branch: null })])).toBe('confirm');
  });

  it('offers nothing once everything is merged', () => {
    expect(mergeGateAction(req('qa'), [branched('done', true)])).toBeNull();
  });
});

describe('policyLabel', () => {
  it('names the policies for people', () => {
    expect(policyLabel('manual_review_merge')).toBe('Review first');
    expect(policyLabel('auto_merge')).toBe('Auto-merge (no review)');
  });
});
