import { AppDatabase } from '../db/index.js';
import { BridgeTask } from '@sp-kickstack/shared';
import { HttpError, conflict } from '../lib/httpError.js';
import type { EngineAdapter } from '../adapters/types.js';
import { isRateLimit } from '../adapters/rateLimit.js';
import { oneLine } from '../lib/promptSafety.js';
import { cancelOrphan } from './orphans.js';

/** Task states a person may retry: stopped work that will not continue on its own. */
const RETRYABLE = ['failed', 'needs_human', 'rate_limited'];
/** Engine states in which the old agent no longer works. */
const STOPPED = ['done', 'failed', 'cancelled'];
/** The note an earlier retry appended (always the end of the body). */
const RETRY_NOTE = /\n\n## Retry\nA previous attempt stopped [^\n]*\n$/;

type TaskRow = BridgeTask & { attempts: number };

/**
 * Reset a stopped goal/ticket so it can be dispatched again on the same branch: the old
 * engine task is cancelled (so no orphan agent keeps working), attempts restart at 1, and
 * the prompt gets a note to continue from what is already on the branch.
 */
export async function prepareRetry(
  db: AppDatabase,
  taskId: number,
  role: 'goal' | 'ticket',
  adapterFor: (project: string) => EngineAdapter
): Promise<BridgeTask> {
  const task = db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
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

  const reason = oneLine(task.last_error || task.status, 200);
  const note = `\n\n## Retry\nA previous attempt stopped (${reason}). ${
    task.branch ? `Continue from the commits already on \`${task.branch}\`.` : 'Start again from the current code.'
  }\n`;
  const body = `${(task.body_md || '').replace(RETRY_NOTE, '')}${note}`;
  const now = new Date().toISOString();
  // Claimed before the engine call: a 'pending' row without an engine id is left alone by
  // the watcher and by a second retry while the old engine task is being stopped.
  const claimed = db.prepare(`
    UPDATE bridge_tasks
    SET status = 'pending', engine_task_id = NULL, engine_status_raw = NULL, engine_url = NULL, last_error = NULL,
        paused_until = NULL, attempts = 1, body_md = ?, updated_at = ?
    WHERE id = ? AND status = ? AND engine_task_id IS ?
  `).run(body, now, taskId, task.status, task.engine_task_id ?? null);
  if (claimed.changes !== 1) {
    throw conflict(`Task #${taskId} changed while it was being retried (another retry?); refresh and try again`);
  }

  // The old agent must be stopped first, or two agents would work on the same branch.
  if (task.engine_task_id) {
    const adapter = adapterFor(task.project);
    const refusal = await stopEngineTask(adapter, task.engine_task_id);
    if (refusal) {
      const restored = db.prepare(`
        UPDATE bridge_tasks
        SET status = ?, engine_task_id = ?, engine_status_raw = ?, engine_url = ?, last_error = ?,
            paused_until = ?, attempts = ?, body_md = ?, updated_at = ?
        WHERE id = ? AND status = 'pending' AND engine_task_id IS NULL
      `).run(
        task.status, task.engine_task_id, task.engine_status_raw ?? null, task.engine_url ?? null, task.last_error ?? null,
        task.paused_until ?? null, task.attempts, task.body_md ?? null, new Date().toISOString(), taskId
      );
      // Cancelled meanwhile: track the old agent so the cancel retry stops it.
      if (restored.changes === 0) await cancelOrphan(db, adapter, taskId, task.engine_task_id);
      throw new HttpError(503, `Could not stop the old engine task ${task.engine_task_id} (${refusal}); try again later`);
    }
  }

  db.prepare("INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, 'task_retried', ?, 0, ?)").run(
    task.req_id,
    taskId,
    JSON.stringify({ taskId, project: task.project, oldEngineTaskId: task.engine_task_id ?? null }),
    now
  );
  return task;
}

/** Cancel an engine task; null once its agent has stopped (or the task is gone), else why not. */
async function stopEngineTask(adapter: EngineAdapter, engineTaskId: string): Promise<string | null> {
  try {
    await adapter.cancelTask(engineTaskId);
    return null;
  } catch (err: any) {
    if (isRateLimit(err)) return 'the engine is rate limited';
    if (/\(404\)/.test(err?.message || '')) return null;
    // Engines may refuse to cancel finished work; that is fine once the agent has stopped.
    try {
      const current = await adapter.getTask(engineTaskId);
      if (!current || STOPPED.includes(current.status)) return null;
    } catch {
      // State unknown: refuse.
    }
    return err?.message || String(err);
  }
}
