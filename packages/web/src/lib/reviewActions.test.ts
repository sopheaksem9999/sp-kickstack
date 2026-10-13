import { describe, it, expect } from 'vitest';
import { appendMention, changeStatusLabel, changeSummary, commentLocation, fileSize, gitReviewHeadline, gitReviewTasks, requestChangesOutcome, requestChangesState, reviewableTasks, taskReviewView } from './reviewActions';

const c = (task_id: number, state: string) => ({ task_id, state }) as any;

describe('review actions', () => {
  it('lists goals and tickets that are not cancelled', () => {
    const tasks = [{ id: 1, role: 'goal', status: 'in_review' }, { id: 2, role: 'waiting', status: 'held' }, { id: 3, role: 'ticket', status: 'cancelled' }] as any;
    expect(reviewableTasks(tasks).map((t) => t.id)).toEqual([1]);
  });

  it('shows where a comment points', () => {
    expect(commentLocation({ file_path: 'src/a.ts', line: 4 })).toBe('src/a.ts:4');
    expect(commentLocation({ file_path: 'src/a.ts', line: null })).toBe('src/a.ts');
    expect(commentLocation({ file_path: null, line: null })).toBe('General');
  });

  it('explains when Request changes is not available', () => {
    const open = [c(1, 'open'), c(1, 'open'), c(2, 'open'), c(2, 'sent')];
    expect(requestChangesState({ status: 'in_progress' } as any, open)).toMatchObject({ ok: false, reason: expect.stringMatching(/review or QA/) });
    expect(requestChangesState({ status: 'qa', merge_state: 'running' } as any, open)).toMatchObject({ ok: false, reason: expect.stringMatching(/merge/) });
    expect(requestChangesState({ status: 'in_review' } as any, [c(1, 'sent')])).toMatchObject({ ok: false, reason: 'Add a comment first' });
    expect(requestChangesState({ status: 'in_review' } as any, open)).toEqual({ ok: true, open: 3, tasks: 2 });
  });

  it('turns the result into one message', () => {
    expect(requestChangesOutcome({ round: 1, results: [{ taskId: 1, ok: true }] })).toEqual({ kind: 'success', message: 'Round 1 sent: 1 task started a new run' });
    expect(requestChangesOutcome({ round: 2, results: [{ taskId: 1, ok: true }, { taskId: 2, ok: false, error: 'rate limited' }] })).toEqual({
      kind: 'warning',
      message: 'Round 2 sent to 1 of 2 tasks. Task #2: rate limited. Its comments stay open; press Request changes again to retry.',
    });
    expect(
      requestChangesOutcome({
        round: 3,
        results: [{ taskId: 1, ok: true }, { taskId: 2, ok: false, error: 'rate limited' }, { taskId: 4, ok: false, error: 'engine offline.' }],
      })
    ).toEqual({
      kind: 'warning',
      message: 'Round 3 sent to 1 of 3 tasks. Task #2: rate limited; Task #4: engine offline. Their comments stay open; press Request changes again to retry.',
    });
  });

  it("gives each repository's task card its own comments, and a comment box only in review or QA", () => {
    const goal = { id: 8, role: 'goal', status: 'in_review' } as any;
    const comments = [{ id: 1, task_id: 8, state: 'open' }, { id: 2, task_id: 9, state: 'open' }] as any;
    expect(taskReviewView({ status: 'in_review' }, goal, comments)).toEqual({ show: true, canAdd: true, comments: [comments[0]] });
    expect(taskReviewView({ status: 'qa' }, goal, [])).toEqual({ show: true, canAdd: true, comments: [] });
    expect(taskReviewView({ status: 'in_progress' }, goal, comments)).toEqual({ show: true, canAdd: false, comments: [comments[0]] });
    expect(taskReviewView({ status: 'in_progress' }, goal, [])).toMatchObject({ show: false });
    expect(taskReviewView({ status: 'in_review' }, { id: 7, role: 'waiting', status: 'held' } as any, [])).toMatchObject({ show: false });
  });

  it('shows attachment sizes', () => {
    expect(fileSize(900)).toBe('900 B');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  it('sums up changed files, words their status and adds #path to a comment', () => {
    const file = { path: 'a.ts', status: 'M' as const, additions: 1, deletions: 0, binary: false };
    expect(changeSummary({ branch: 'REQ-1', base: 'develop', files: [file, file], additions: 120, deletions: 30, truncated: false })).toBe('2 files · +120 −30');
    expect(changeSummary({ branch: 'REQ-1', base: 'develop', files: [file], additions: 1, deletions: 0, truncated: false })).toBe('1 file · +1 −0');
    expect(changeSummary({ branch: 'REQ-1', base: 'develop', files: [file], additions: 9, deletions: 9, truncated: true })).toBe('1+ files · +9 −9');
    expect(['A', 'M', 'D', 'R'].map((s) => changeStatusLabel(s as 'A'))).toEqual(['added', 'modified', 'deleted', 'renamed']);
    expect(appendMention('', 'src/a.ts')).toBe('#src/a.ts ');
    expect(appendMention('Fix this', 'src/a.ts')).toBe('Fix this #src/a.ts ');
    expect(appendMention('Fix this\n', 'src/a.ts')).toBe('Fix this\n#src/a.ts ');
  });

  it('lists the branched goals and tickets for Git Review and words what the merge brings', () => {
    const t = (id: number, project: string, over: object = {}) =>
      ({ id, project, role: 'goal', status: 'in_review', branch: 'REQ-008', merged_at: null, ...over }) as any;
    const tasks = [t(2, 'frontend'), t(1, 'backend'), t(3, 'backend', { role: 'question', branch: null }), t(4, 'mobile', { branch: null }), t(5, 'api', { status: 'cancelled' })];
    expect(gitReviewTasks(tasks).map((x) => x.id)).toEqual([1, 2]);
    expect(gitReviewHeadline('REQ-008', [{ merged: false, base: 'develop' }, { merged: false, base: 'develop' }])).toBe('What merging REQ-008 brings into develop');
    expect(gitReviewHeadline('REQ-008', [{ merged: true, base: 'develop' }, { merged: true, base: 'main' }])).toBe('What REQ-008 merged into develop, main');
    expect(gitReviewHeadline('REQ-008', [{ merged: true, base: 'develop' }, { merged: false, base: 'develop' }])).toBe(
      'REQ-008: some branches merged into develop, some still to merge'
    );
    expect(gitReviewHeadline('REQ-008', [])).toBe('REQ-008: no branches to review');
  });
});
