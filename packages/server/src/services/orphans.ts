import { AppDatabase } from '../db/index.js';
import { EngineAdapter } from '../adapters/types.js';

/**
 * An engine accepted a task after its bridge row stopped being 'pending' (the requirement
 * was cancelled meanwhile). Record the engine id and cancel it there so no agent keeps
 * working on cancelled work.
 */
export async function cancelOrphan(db: AppDatabase, adapter: EngineAdapter, taskId: number, engineTaskId: string) {
  const row = db.prepare('SELECT status FROM bridge_tasks WHERE id = ?').get(taskId) as { status: string } | undefined;
  if (row?.status !== 'cancelled') return;

  db.prepare('UPDATE bridge_tasks SET engine_task_id = ? WHERE id = ? AND engine_task_id IS NULL').run(engineTaskId, taskId);
  try {
    await adapter.cancelTask(engineTaskId);
  } catch (err: any) {
    db.prepare("UPDATE bridge_tasks SET status = 'queued', last_error = ? WHERE id = ?").run(
      `Cancel failed: ${err?.message || err}`,
      taskId
    );
  }
}
