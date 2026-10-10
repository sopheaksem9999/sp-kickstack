import { AppDatabase } from '../db/index.js';
import { BridgeTask } from '@sp-kickstack/shared';
import { HttpError, conflict } from '../lib/httpError.js';
import type { EngineAdapter } from '../adapters/types.js';
import { isRateLimit } from '../adapters/rateLimit.js';
import { oneLine } from '../lib/promptSafety.js';

/** Task states a person may retry: stopped work that will not continue on its own. */
const RETRYABLE = ['failed', 'needs_human', 'rate_limited'];

/**
 * Reset a stopped goal/ticket so it can be dispatched again on the same branch: the old
 * engine task is cancelled (best effort, so no orphan agent keeps working), attempts restart
 * at 1, and the prompt gets a note to continue from what is already on the branch.
 */
export async function prepareRetry(
  db: AppDatabase,
  taskId: number,
  role: 'goal' | 'ticket',
  adapterFor: (project: string) => EngineAdapter
): Promise<BridgeTask> {
  const task = db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as BridgeTask | undefined;
  if (!task || task.role !== role) throw new HttpError(404, `${role === 'goal' ? 'Goal' : 'Ticket'} #${taskId} not found`);
  if (!RETRYABLE.includes(task.status)) {
    throw conflict(`Task #${taskId} is ${task.status}; only failed, stuck or rate-limited tasks can be retried`);
  }
  const req = db.prepare('SELECT status FROM requirements WHERE id = ?').get(task.req_id) as { status: string } | undefined;
  if (!req || req.status === 'cancelled' || req.status === 'done') {
    throw conflict(`Requirement ${task.req_id} is ${req?.status ?? 'missing'}; its tasks cannot be retried`);
  }
  const waiting = db.prepare("SELECT COUNT(*) AS c FROM links WHERE task_id = ? AND state = 'waiting'").get(taskId) as { c: number };
  if (waiting.c > 0) {
    throw conflict(`Task #${taskId} is still waiting on another task; release or cancel that dependency first`);
  }

  // The old agent must be stopped first, or two agents would work on the same branch.
  if (task.engine_task_id) {
    try {
      await adapterFor(task.project).cancelTask(task.engine_task_id);
    } catch (err: any) {
      const gone = /\(404\)/.test(err?.message || '');
      if (!gone) {
        const reason = isRateLimit(err) ? 'the engine is rate limited' : err?.message || String(err);
        throw new HttpError(503, `Could not stop the old engine task ${task.engine_task_id} (${reason}); try again later`);
      }
    }
  }

  const reason = oneLine(task.last_error || task.status, 200);
  const note = `\n\n## Retry\nA previous attempt stopped (${reason}). ${
    task.branch ? `Continue from the commits already on \`${task.branch}\`.` : 'Start again from the current code.'
  }\n`;
  const body = (task.body_md || '').includes('\n## Retry\n') ? task.body_md : `${task.body_md || ''}${note}`;
  const now = new Date().toISOString();
  const reset = db.prepare(`
    UPDATE bridge_tasks
    SET status = 'pending', engine_task_id = NULL, engine_status_raw = NULL, engine_url = NULL, last_error = NULL,
        paused_until = NULL, attempts = 1, body_md = ?, updated_at = ?
    WHERE id = ? AND status = ?
  `).run(body, now, taskId, task.status);
  if (reset.changes !== 1) {
    throw conflict(`Task #${taskId} changed while it was being retried (another retry?); refresh and try again`);
  }
  db.prepare("INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, 'task_retried', ?, 0, ?)").run(
    task.req_id,
    taskId,
    JSON.stringify({ taskId, project: task.project, oldEngineTaskId: task.engine_task_id ?? null }),
    now
  );
  return task;
}
