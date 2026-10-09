import { describe, it, expect, beforeEach } from 'vitest';
import { FakeEngineServer } from './fakeEngine.js';
import { StoneforgeAdapter } from './stoneforgeAdapter.js';
import { ManualAdapter } from './manualAdapter.js';
import { parseRetryAfter } from './rateLimit.js';

describe('Engine Adapters with FakeEngineServer', () => {
  let fakeEngine: FakeEngineServer;
  let adapter: StoneforgeAdapter;

  beforeEach(() => {
    fakeEngine = new FakeEngineServer('http://127.0.0.1:3457');
    adapter = new StoneforgeAdapter(
      'http://127.0.0.1:3457',
      '/tmp/test-repo',
      undefined,
      fakeEngine.fetch
    );
  });

  it('checks health successfully', async () => {
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.version).toBe('fake-stoneforge-0.2.0');
  });

  it('creates a goal and normalizes status', async () => {
    const goal = await adapter.createGoal({
      title: 'Implement rider location API',
      bodyMd: '# Goal specification',
    });

    expect(goal.id).toBeDefined();
    expect(goal.title).toBe('Implement rider location API');
    expect(goal.status).toBe('queued');
    expect(goal.rawStatus).toBe('ready');
  });

  it('creates a task, holds it, and releases with context', async () => {
    const task = await adapter.createTask({
      title: 'Blocking ticket task',
      bodyMd: 'Need endpoint',
    });

    // Hold task
    await adapter.holdTask(task.id, 'Waiting on backend');
    let fetched = await adapter.getTask(task.id);
    expect(fetched?.status).toBe('held');
    expect(fetched?.rawStatus).toBe('deferred');

    // Release task with context
    await adapter.releaseTask(task.id, 'Upstream PR #123 merged');
    fetched = await adapter.getTask(task.id);
    expect(fetched?.status).toBe('queued');
    expect(fetched?.rawStatus).toBe('ready');

    const internalData = fakeEngine.getTaskData(task.id);
    expect(internalData?.notes).toContain('Upstream PR #123 merged');
  });

  it('cancels a task', async () => {
    const task = await adapter.createTask({
      title: 'Task to cancel',
      bodyMd: 'Cancel me',
    });

    await adapter.cancelTask(task.id);
    const fetched = await adapter.getTask(task.id);
    expect(fetched?.status).toBe('cancelled');
  });
});

describe('Manual Adapter', () => {
  it('manages task lifecycle in memory', async () => {
    const manual = new ManualAdapter();
    const task = await manual.createGoal({ title: 'Manual task', bodyMd: 'Do by hand' });
    expect(task.status).toBe('queued');

    await manual.holdTask(task.id, 'hold');
    let fetched = await manual.getTask(task.id);
    expect(fetched?.status).toBe('held');

    await manual.releaseTask(task.id, 'released');
    fetched = await manual.getTask(task.id);
    expect(fetched?.status).toBe('queued');
  });
});

describe('StoneforgeAdapter status normalization', () => {
  it('recognizes the normalized review names as well as engine review statuses', () => {
    const adapter = new StoneforgeAdapter('http://127.0.0.1:1', '/r');
    expect(adapter.normalizeStatus('in_review')).toBe('in_review');
    expect(adapter.normalizeStatus('needs_review')).toBe('in_review');
    expect(adapter.normalizeStatus('qa')).toBe('in_review');
  });
});

describe('Rate-limit signals from Stoneforge', () => {
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

  it('maps engine rate-limit statuses to rate_limited', () => {
    const adapter = new StoneforgeAdapter('http://127.0.0.1:1', '/r');
    for (const raw of ['rate_limited', 'rate-limited', 'quota_exceeded', 'usage_limited', 'throttled']) {
      expect(adapter.normalizeStatus(raw)).toBe('rate_limited');
    }
  });

  it('exposes the resume time the engine reports', async () => {
    const adapter = new StoneforgeAdapter('http://e', '/r', undefined, respond(200, {
      id: 7, title: 't', status: 'rate_limited', resetAt: '2026-10-10T15:00:00.000Z',
    }));
    expect(await adapter.getTask('7')).toMatchObject({ status: 'rate_limited', resumeAt: '2026-10-10T15:00:00.000Z' });
  });

  it('turns HTTP 429 into an EngineRateLimitError carrying Retry-After', async () => {
    const adapter = new StoneforgeAdapter('http://e', '/r', undefined, respond(429, 'slow down', { 'Retry-After': '120' }));
    await expect(adapter.createGoal({ title: 't', bodyMd: 'b' })).rejects.toMatchObject({
      name: 'EngineRateLimitError', retryAfterMs: 120_000, local: false,
    });
  });

  it('reports a rate-limited health check as a rate limit, not as a down engine', async () => {
    const adapter = new StoneforgeAdapter('http://e', '/r', undefined, respond(429, '', { 'Retry-After': '30' }));
    await expect(adapter.health()).rejects.toMatchObject({ name: 'EngineRateLimitError', retryAfterMs: 30_000 });
  });

  it('parses Retry-After seconds and HTTP dates, and ignores garbage', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(parseRetryAfter('15', now)).toBe(15_000);
    expect(parseRetryAfter('Sat, 10 Oct 2026 12:05:00 GMT', now)).toBe(300_000);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});
