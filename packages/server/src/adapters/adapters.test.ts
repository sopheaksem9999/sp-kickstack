import { describe, it, expect, beforeEach } from 'vitest';
import { FakeEngineServer } from './fakeEngine.js';
import { StoneforgeAdapter } from './stoneforgeAdapter.js';
import { ManualAdapter } from './manualAdapter.js';

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
