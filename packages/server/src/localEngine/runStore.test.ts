import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { LATEST_VERSION, getUserVersion } from '../db/migrations.js';
import { RunStore } from './runStore.js';

const store = () => new RunStore(initDatabase(':memory:'));
const input = (bridgeTaskId = 1) => ({ bridgeTaskId, project: 'backend', title: 'T', bodyMd: 'Do it' });

describe('RunStore', () => {
  it('is created by migration 8 and kept by later ones', () => {
    const db = initDatabase(':memory:');
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'local_runs'").get()).toBeTruthy();
  });

  it('queues a run with a local- id', () => {
    const runs = store();
    const run = runs.create({ ...input(), model: 'opus', effort: 'high' });
    expect(run).toMatchObject({ bridge_task_id: 1, project: 'backend', status: 'queued', model: 'opus', effort: 'high', notes_md: '', interruptions: 0 });
    expect(run.id).toMatch(/^local-[0-9a-f-]{36}$/);
    expect(runs.queued().map((r) => r.id)).toEqual([run.id]);
  });

  it('changes status only from the listed states', () => {
    const runs = store();
    const run = runs.create(input());
    expect(runs.transition(run.id, ['running'], { status: 'review' })).toBe(false);
    expect(runs.transition(run.id, ['queued'], { status: 'running', pid: 42 })).toBe(true);
    expect(runs.get(run.id)).toMatchObject({ status: 'running', pid: 42 });
    expect(runs.count('running')).toBe(1);
  });

  it('refuses to change a column that is not a run field', () => {
    const runs = store();
    const run = runs.create(input());
    expect(() => runs.update(run.id, { id: 'x' } as any)).toThrow(/cannot be changed/);
  });

  it('collects notes, and a new run of the same task takes the notes earlier runs never delivered', () => {
    const runs = store();
    const first = runs.create(input(7));
    runs.transition(first.id, ['queued'], { status: 'failed' });
    runs.appendNote(first.id, 'Use the v2 endpoint');
    runs.appendNote(first.id, 'Keep the old route');
    expect(runs.get(first.id)!.notes_md).toBe('Use the v2 endpoint\n\nKeep the old route');

    const other = runs.create(input(8));
    const second = runs.create(input(7));
    expect(second.notes_md).toBe('Use the v2 endpoint\n\nKeep the old route');
    expect(runs.get(first.id)!.notes_md).toBe('');
    expect(other.notes_md).toBe('');
  });

  it('reports a CLI as paused only while a rate-limited run waits for a future reset', () => {
    const runs = store();
    const now = Date.parse('2026-10-13T10:00:00Z');
    const a = runs.create(input(1));
    const b = runs.create(input(2));
    runs.update(a.id, { status: 'rate_limited', cli: 'agy-cli', resume_at: '2026-10-13T11:00:00.000Z' });
    runs.update(b.id, { status: 'rate_limited', cli: 'claude-cli', resume_at: '2026-10-13T09:00:00.000Z' });
    expect([...runs.pausedClis(now)]).toEqual([['agy-cli', '2026-10-13T11:00:00.000Z']]);
  });
});
