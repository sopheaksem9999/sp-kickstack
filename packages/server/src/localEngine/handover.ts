import type { AppDatabase } from '../db/index.js';

export interface HandoverDispatch {
  dispatchGoal(taskId: number): Promise<void>;
  dispatchTicket(taskId: number): Promise<void>;
}

/**
 * A repository moved from Manual to Local AI CLI: its QUEUED Manual tasks (nobody works on them) are
 * claimed back and dispatched to the local engine. Tasks in other states are left alone.
 */
export async function handOverManualTasks(db: AppDatabase, project: string, dispatch: HandoverDispatch): Promise<number[]> {
  const rows = db
    .prepare(`
      SELECT id, role FROM bridge_tasks
      WHERE project = ? AND status = 'queued' AND role IN ('goal', 'ticket') AND engine_task_id LIKE 'manual-%'
      ORDER BY id
    `)
    .all(project) as Array<{ id: number; role: 'goal' | 'ticket' }>;
  const claim = db.prepare(`
    UPDATE bridge_tasks
    SET status = 'pending', engine_task_id = NULL, engine_status_raw = NULL, engine_url = NULL, last_error = NULL,
        model = NULL, effort = NULL, updated_at = ?
    WHERE id = ? AND status = 'queued' AND engine_task_id LIKE 'manual-%'
  `);
  const claimed = rows.filter((row) => claim.run(new Date().toISOString(), row.id).changes === 1);
  await Promise.allSettled(claimed.map((row) => (row.role === 'goal' ? dispatch.dispatchGoal(row.id) : dispatch.dispatchTicket(row.id))));
  return claimed.map((row) => row.id);
}
