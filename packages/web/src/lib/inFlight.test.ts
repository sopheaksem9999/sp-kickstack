import { describe, it, expect } from 'vitest';
import { flightKey, setInFlight } from './inFlight';

describe('setInFlight', () => {
  it('adds and removes a key without changing the set it was given', () => {
    const empty: ReadonlySet<string> = new Set();
    const a = setInFlight(empty, flightKey('retry', 1), true);
    expect([...empty]).toEqual([]);
    expect(a.has('retry:1')).toBe(true);
    const gone = setInFlight(a, 'retry:1', false);
    expect(gone.has('retry:1')).toBe(false);
    expect(a.has('retry:1')).toBe(true);
  });

  it('keeps task A in flight while task B starts and finishes', () => {
    let state: ReadonlySet<string> = new Set();
    state = setInFlight(state, flightKey('retry', 1), true);
    state = setInFlight(state, flightKey('markDone', 2), true);
    expect(state.has(flightKey('retry', 1))).toBe(true);
    state = setInFlight(state, flightKey('markDone', 2), false);
    expect(state.has(flightKey('retry', 1))).toBe(true);
    expect(state.has(flightKey('markDone', 2))).toBe(false);
  });

  it('counts the same task twice only once, and removing a missing key is harmless', () => {
    const once = setInFlight(setInFlight(new Set(), 'retry:1', true), 'retry:1', true);
    expect(once.size).toBe(1);
    expect(setInFlight(new Set(), 'retry:9', false).size).toBe(0);
  });
});

describe('flightKey', () => {
  it('tells the two actions apart for the same task', () => {
    expect(flightKey('retry', 3)).not.toBe(flightKey('markDone', 3));
  });
});
