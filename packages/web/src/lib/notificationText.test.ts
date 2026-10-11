import { describe, it, expect } from 'vitest';
import { CHANNEL_HINTS, NOTIFY_EVENT_LABELS, describeNotification, newChannel } from './notificationText';

const e = (type: string, payload: Record<string, unknown>, req_id: string | null = 'REQ-001') =>
  ({ id: 1, type, payload, req_id, read: false, at: '2026-10-10T10:00:00Z' }) as any;

describe('notification text', () => {
  it('describes the events people care about and links to the requirement', () => {
    expect(describeNotification(e('question_asked', { project: 'mobile', question: 'Redis?' }))).toEqual({
      title: 'mobile agent asks a question', detail: 'Redis?', tone: 'warning', href: '/requirements/REQ-001',
    });
    expect(describeNotification(e('requirement_in_review', { reqId: 'REQ-001' }))?.title).toBe('REQ-001 is ready for review');
    expect(describeNotification(e('merge_failed', { error: 'conflict\nmore' }))).toMatchObject({ tone: 'error', detail: 'conflict' });
    expect(describeNotification(e('engine_down', { project: 'backend' }, null))).toMatchObject({ title: 'backend engine is down', href: undefined });
  });

  it('leaves routine status noise out of the bell', () => {
    expect(describeNotification(e('task_status_changed', { newStatus: 'running' }))).toBeNull();
    expect(describeNotification(e('task_updated', {}))).toBeNull();
  });

  it('labels every notifiable event and explains each channel type', () => {
    expect(Object.keys(NOTIFY_EVENT_LABELS)).toHaveLength(11);
    expect(CHANNEL_HINTS.telegram).toMatch(/sendMessage\?chat_id=/);
    const a = newChannel();
    const b = newChannel();
    expect(a).toMatchObject({ type: 'slack', url: '', enabled: true });
    expect(a.id).not.toBe(b.id);
  });
});
