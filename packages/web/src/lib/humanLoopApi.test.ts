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
