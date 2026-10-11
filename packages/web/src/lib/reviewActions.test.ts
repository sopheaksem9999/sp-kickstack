import { describe, it, expect } from 'vitest';
import { commentLocation, requestChangesOutcome, requestChangesState, reviewableTasks } from './reviewActions';

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
});
