import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from './humanLoopApi';

/** Stub fetch with one response; returns the calls it saw. */
function respond(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    })
  );
  return calls;
}

describe('questions api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists questions by status and requirement', async () => {
    const calls = respond(200, []);
    await api.fetchQuestions({ status: 'open', reqId: 'REQ-001' });
    await api.fetchQuestions();
    expect(calls.map((c) => c.url)).toEqual(['/api/questions?status=open&req=REQ-001', '/api/questions']);
  });

  it('posts an answer and surfaces the server error', async () => {
    const calls = respond(200, { id: 1, status: 'answered' });
    await api.answerQuestion(1, { option: 'redis' });
    expect(calls[0]).toMatchObject({ url: '/api/questions/1/answer', init: { method: 'POST', body: JSON.stringify({ option: 'redis' }) } });

    respond(409, { error: 'Question #1 is already answered' });
    await expect(api.answerQuestion(1, { option: 'redis' })).rejects.toThrow('Question #1 is already answered');
  });
});

describe('review api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the review routes', async () => {
    const calls = respond(200, {});
    await api.fetchReviewComments('REQ-001');
    await api.addReviewComment('REQ-001', { task_id: 3, body: 'Fix', file_path: 'a.ts', line: 2 });
    await api.updateReviewComment(5, { state: 'resolved' });
    await api.deleteReviewComment(5);
    await api.requestChanges('REQ-001', [3]);
    await api.sendTaskNote(3, 'Use v2');
    expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/requirements/REQ-001/comments',
      'POST /api/requirements/REQ-001/comments',
      'PATCH /api/comments/5',
      'DELETE /api/comments/5',
      'POST /api/requirements/REQ-001/request-changes',
      'POST /api/tasks/3/note',
    ]);
    expect(JSON.parse(String(calls[4].init?.body))).toEqual({ task_ids: [3] });
    expect(JSON.parse(String(calls[5].init?.body))).toEqual({ body: 'Use v2' });
  });
});

describe('notification api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the notification routes', async () => {
    const calls = respond(200, {});
    await api.fetchNotificationFeed();
    await api.markAllNotificationsRead();
    await api.fetchNotificationSettings();
    await api.saveNotificationSettings({ app_url: '' });
    await api.testNotificationChannel('team');
    expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/notifications',
      'POST /api/notifications/read',
      'GET /api/settings/notifications',
      'PUT /api/settings/notifications',
      'POST /api/settings/notifications/test',
    ]);
    expect(JSON.parse(String(calls[4].init?.body))).toEqual({ channel_id: 'team' });
  });
});
