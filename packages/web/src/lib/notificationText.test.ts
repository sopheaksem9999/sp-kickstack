import { describe, it, expect } from 'vitest';
import { CHANNEL_HINTS, NOTIFY_EVENT_LABELS, describeNotification, newChannel, notificationDraftProblem } from './notificationText';

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

describe('notificationDraftProblem', () => {
  const draft = (channels: Array<Record<string, unknown>>, app_url = '') =>
    ({ channels: channels.map((c, i) => ({ id: `c${i}`, type: 'slack', name: '', url: '', enabled: true, ...c })), events: {}, app_url }) as any;

  it('asks for the URL of an unnamed channel by its position', () => {
    expect(notificationDraftProblem(draft([{ url: 'https://hooks.slack.com/services/T/B/X' }, { type: 'slack' }]))).toBe(
      'Channel 2 needs a URL starting with https://, for example https://hooks.slack.com/services/….'
    );
    expect(notificationDraftProblem(draft([{ type: 'telegram', url: '   ' }]))).toBe(
      'Channel 1 needs a URL starting with https://, for example https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>.'
    );
  });

  it('quotes the channel name and rejects URLs that are not http(s)', () => {
    expect(notificationDraftProblem(draft([{ type: 'webhook', name: ' Team hook ', url: 'ftp://example.com/hook' }]))).toBe(
      '"Team hook" needs a URL starting with https://, for example https://example.com/hook.'
    );
    expect(notificationDraftProblem(draft([{ name: 'Broken', url: 'https://' }]))).toMatch(/^"Broken" needs a URL/);
  });

  it('explains a bad link address', () => {
    const msg = 'The link address must start with http:// or https://, for example http://localhost:4101. Leave it empty for no links.';
    expect(notificationDraftProblem(draft([], 'localhost:4101'))).toBe(msg);
    expect(notificationDraftProblem(draft([], '  '))).toBe(msg);
  });

  it('reports the channel problem before the link address and accepts a valid draft', () => {
    expect(notificationDraftProblem(draft([{ url: '' }], 'nope'))).toMatch(/^Channel 1 needs a URL/);
    expect(notificationDraftProblem(draft([{ url: 'https://hooks.slack.com/services/T/B/X' }], 'http://localhost:4101'))).toBeNull();
    expect(notificationDraftProblem(draft([]))).toBeNull();
  });
});
