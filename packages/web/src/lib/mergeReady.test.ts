import { describe, it, expect } from 'vitest';
import { isMergeReady, mergeCopy } from './mergeReady';

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
