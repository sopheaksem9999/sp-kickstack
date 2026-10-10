import { describe, it, expect } from 'vitest';
import { EngineThrottle } from './engineThrottle.js';
import { EngineRateLimitError } from '../adapters/rateLimit.js';
import type { EngineAdapter } from '../adapters/types.js';

function fakeAdapter(behavior: Partial<Record<keyof EngineAdapter, () => Promise<any>>> = {}) {
  const calls: string[] = [];
  const make = (name: keyof EngineAdapter, fallback: () => Promise<any>) => async () => {
    calls.push(name as string);
    return (behavior[name] ?? fallback)();
  };
  const adapter = {
    type: 'stoneforge' as const,
    health: make('health', async () => ({ ok: true })),
    createGoal: make('createGoal', async () => ({ id: '1', title: 't', status: 'queued', rawStatus: 'ready' })),
    createTask: make('createTask', async () => ({ id: '2', title: 't', status: 'queued', rawStatus: 'ready' })),
    getTask: make('getTask', async () => ({ id: '1', title: 't', status: 'running', rawStatus: 'in_progress' })),
    listTasks: make('listTasks', async () => []),
    holdTask: make('holdTask', async () => undefined),
    releaseTask: make('releaseTask', async () => undefined),
    appendNote: make('appendNote', async () => undefined),
    cancelTask: make('cancelTask', async () => undefined),
  } as unknown as EngineAdapter;
  return { adapter, calls };
}

describe('EngineThrottle', () => {
  it('trips on a rate limit and fast-fails every call to that engine until the reset, without network calls', async () => {
    let now = 1_000_000;
    const trips: Array<[string, number]> = [];
    const throttle = new EngineThrottle({ now: () => now, onTrip: (p, until) => trips.push([p, until]) });
    const { adapter, calls } = fakeAdapter({ createGoal: async () => { throw new EngineRateLimitError('429', 5_000); } });
    const getAdapter = throttle.wrap(() => adapter);

    await expect(getAdapter('backend').createGoal({ title: 't', bodyMd: 'b' })).rejects.toMatchObject({ name: 'EngineRateLimitError' });
    expect(throttle.isTripped('backend')).toBe(true);
    expect(trips).toEqual([['backend', now + 5_000]]);

    const before = calls.length;
    await expect(getAdapter('backend').getTask('1')).rejects.toMatchObject({ name: 'EngineRateLimitError' });
    await expect(getAdapter('backend').health()).rejects.toMatchObject({ name: 'EngineRateLimitError' });
    expect(calls.length).toBe(before);
    expect(throttle.isTripped('mobile')).toBe(false);

    now += 5_001;
    expect(throttle.isTripped('backend')).toBe(false);
    await expect(getAdapter('backend').getTask('1')).resolves.toMatchObject({ id: '1' });
  });

  it('notifies once per trip, and again only when the trip is extended by more than a minute', () => {
    let now = 0;
    const trips: number[] = [];
    const throttle = new EngineThrottle({ now: () => now, onTrip: (_p, until) => trips.push(until) });
    throttle.trip('backend', 30_000);
    throttle.trip('backend', 40_000);
    expect(trips).toEqual([30_000]);
    throttle.trip('backend', 10 * 60_000);
    expect(trips).toEqual([30_000, 600_000]);
  });

  it('limits how many agents an engine starts per minute without tripping the engine', async () => {
    let now = 0;
    const throttle = new EngineThrottle({ now: () => now, maxStartsPerMinute: 2 });
    const { adapter, calls } = fakeAdapter();
    const getAdapter = throttle.wrap(() => adapter);
    await getAdapter('backend').createGoal({ title: 't', bodyMd: 'b' });
    now += 10_000;
    await getAdapter('backend').createTask({ title: 't', bodyMd: 'b' });

    const third = getAdapter('backend').createGoal({ title: 't', bodyMd: 'b' });
    await expect(third).rejects.toMatchObject({ name: 'EngineRateLimitError', local: true, retryAfterMs: 50_000 });
    expect(calls.filter((c) => c === 'createGoal' || c === 'createTask')).toHaveLength(2);
    expect(throttle.isTripped('backend')).toBe(false);
    await expect(getAdapter('backend').getTask('1')).resolves.toBeTruthy();

    now += 50_001;
    await expect(getAdapter('backend').createGoal({ title: 't', bodyMd: 'b' })).resolves.toBeTruthy();
  });

  it('trips on a rate-limited health check and lets ordinary errors through untouched', async () => {
    const throttle = new EngineThrottle({ now: () => 0 });
    const limited = fakeAdapter({ health: async () => { throw new EngineRateLimitError('429', 1_000); } });
    await expect(throttle.wrap(() => limited.adapter)('a').health()).rejects.toMatchObject({ name: 'EngineRateLimitError' });
    expect(throttle.isTripped('a')).toBe(true);

    const broken = fakeAdapter({ getTask: async () => { throw new Error('boom'); } });
    await expect(throttle.wrap(() => broken.adapter)('b').getTask('1')).rejects.toThrow('boom');
    expect(throttle.isTripped('b')).toBe(false);
  });
});

describe('EngineThrottle repeated limits', () => {
  it('treats back-to-back trips as one incident: one notification, growing waits', () => {
    let now = 0;
    const trips: number[] = [];
    const throttle = new EngineThrottle({ now: () => now, onTrip: (_p, until) => trips.push(until) });
    let previousLength = 0;
    for (let i = 0; i < 30; i++) {
      throttle.trip('backend', 60_000);
      const length = throttle.trippedUntil('backend')! - now;
      expect(length).toBeGreaterThanOrEqual(previousLength);
      previousLength = length;
      now += length + 1_000;
    }
    expect(trips).toHaveLength(1);
    expect(previousLength).toBeGreaterThan(60_000);
    expect(previousLength).toBeLessThanOrEqual(15 * 60_000);
  });

  it('reports the escalated wait on the error it rethrows, so paused tasks show the real resume time', async () => {
    let now = 1_000_000;
    const throttle = new EngineThrottle({ now: () => now, maxStartsPerMinute: 0 });
    const { adapter } = fakeAdapter({ createGoal: async () => { throw new EngineRateLimitError('429', 60_000); } });
    const getAdapter = throttle.wrap(() => adapter);

    await expect(getAdapter('backend').createGoal({ title: 't', bodyMd: 'b' })).rejects.toMatchObject({ retryAfterMs: 60_000 });
    now += 61_000; // the trip ended; the engine refuses again: same incident, doubled wait
    await expect(getAdapter('backend').createGoal({ title: 't', bodyMd: 'b' })).rejects.toMatchObject({ retryAfterMs: 120_000 });
    expect(throttle.trippedUntil('backend')).toBe(now + 120_000);
  });

  it('starts a new incident after a quiet period', () => {
    let now = 0;
    const trips: number[] = [];
    const throttle = new EngineThrottle({ now: () => now, onTrip: (_p, until) => trips.push(until) });
    throttle.trip('backend', 60_000);
    now += 60_000 + 10 * 60_000;
    throttle.trip('backend', 60_000);
    expect(trips).toHaveLength(2);
    expect(throttle.trippedUntil('backend')! - now).toBe(60_000);
  });
});
