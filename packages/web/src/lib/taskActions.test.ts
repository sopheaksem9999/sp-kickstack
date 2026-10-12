import { describe, it, expect } from 'vitest';
import { canMarkDone, canRetry, canSendNote, pausedLabel, retryOutcome } from './taskActions';

const t = (role: string, status: string, extra: Record<string, unknown> = {}) => ({ role, status, ...extra }) as any;

describe('canRetry', () => {
  it('offers retry for stopped goals and tickets of an open requirement', () => {
    for (const status of ['failed', 'needs_human', 'rate_limited']) {
      expect(canRetry(t('goal', status), 'in_progress')).toBe(true);
      expect(canRetry(t('ticket', status), 'ready')).toBe(true);
    }
  });

  it('does not offer retry for running or finished work, placeholders, or closed requirements', () => {
    expect(canRetry(t('goal', 'running'), 'in_progress')).toBe(false);
    expect(canRetry(t('goal', 'done'), 'in_progress')).toBe(false);
    expect(canRetry(t('waiting', 'failed'), 'in_progress')).toBe(false);
    expect(canRetry(t('goal', 'failed'), 'cancelled')).toBe(false);
    expect(canRetry(t('goal', 'failed'), 'done')).toBe(false);
  });
});

describe('canMarkDone', () => {
  it('is offered for work that is not finished or closed', () => {
    for (const status of ['pending', 'queued', 'running', 'needs_human', 'held', 'in_review', 'qa', 'failed', 'rate_limited']) {
      expect(canMarkDone(t('goal', status))).toBe(true);
    }
  });

  it('is not offered for done or cancelled tasks', () => {
    expect(canMarkDone(t('goal', 'done'))).toBe(false);
    expect(canMarkDone(t('ticket', 'cancelled'))).toBe(false);
  });
});

describe('pausedLabel', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');

  it('shows when a rate-limited task resumes', () => {
    const until = '2026-10-10T15:30:00.000Z';
    const time = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(pausedLabel(t('goal', 'rate_limited', { paused_until: until }), now)).toBe(`Rate limited · resumes ${time}`);
  });

  it('says it resumes automatically when the time is unknown or already passed', () => {
    expect(pausedLabel(t('goal', 'rate_limited', { paused_until: null }), now)).toBe('Rate limited · resumes automatically');
    expect(pausedLabel(t('goal', 'rate_limited', { paused_until: '2026-10-10T11:00:00Z' }), now)).toBe('Rate limited · resumes automatically');
  });

  it('is empty for tasks that are not rate limited', () => {
    expect(pausedLabel(t('goal', 'running'), now)).toBeNull();
  });
});

describe('retryOutcome', () => {
  it('reports a retry that did not reach the engine as an error', () => {
    expect(retryOutcome({ status: 'failed', last_error: 'connection refused' } as any)).toEqual({
      kind: 'error', message: 'Retry failed: connection refused',
    });
    expect(retryOutcome({ status: 'rate_limited' } as any).kind).toBe('info');
    expect(retryOutcome({ status: 'queued' } as any)).toEqual({ kind: 'success', message: 'Task sent to its engine again' });
  });
});

describe('canSendNote', () => {
  it('offers notes to tasks whose agent is still working or waiting', () => {
    for (const status of ['queued', 'running', 'needs_human', 'held', 'rate_limited']) {
      expect(canSendNote(t('goal', status, { engine_task_id: 'e1' }))).toBe(true);
    }
    expect(canSendNote(t('goal', 'in_review', { engine_task_id: 'e1' }))).toBe(false);
    expect(canSendNote(t('goal', 'running', { engine_task_id: null }))).toBe(false);
    expect(canSendNote(t('waiting', 'held', { engine_task_id: 'e1' }))).toBe(false);
  });
});
