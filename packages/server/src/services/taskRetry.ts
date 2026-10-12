import { AppDatabase } from '../db/index.js';
import { AgentProfileInput, AgentProfileInputSchema, BridgeTask } from '@sp-kickstack/shared';
import { HttpError, conflict } from '../lib/httpError.js';
import type { EngineAdapter } from '../adapters/types.js';
import { isRateLimit } from '../adapters/rateLimit.js';
import { oneLine } from '../lib/promptSafety.js';
import { cancelOrphan } from './orphans.js';

/** Task states a person may retry: stopped work that will not continue on its own. */
const RETRYABLE = ['failed', 'needs_human', 'rate_limited'];
/** Engine states in which the old agent no longer works. */
const STOPPED = ['done', 'failed', 'cancelled'];

export type TaskRow = BridgeTask & { attempts: number };
export type BridgeNoteKind = 'review' | 'retry';

const NOTE_ORDER: BridgeNoteKind[] = ['review', 'retry'];
const MARKER = /\n\n<!-- bridge:(review|retry) -->\n/;
const MARKER_SPLIT = /\n\n<!-- bridge:(review|retry) -->\n/g;
/** Retry note written before the markers existed (always the end of the body). */
const LEGACY_RETRY_NOTE = /\n\n## Retry\nA previous attempt stopped [^\n]*\n$/;

/**
 * Set one bridge note at the end of a prompt and keep the other kinds. Each note follows a
 * `<!-- bridge:<kind> -->` marker, which untrusted text cannot contain (promptSafety
 * neutralizes it). A new review round drops a stale retry note.
 */
export function setBridgeNote(body: string, kind: BridgeNoteKind, note: string): string {
  const start = body.search(MARKER);
  const base = (start === -1 ? body : body.slice(0, start)).replace(LEGACY_RETRY_NOTE, '');
  const notes = new Map<BridgeNoteKind, string>();
  if (start !== -1) {
    // ['', kind1, text1, kind2, text2, ...]
    const parts = body.slice(start).split(MARKER_SPLIT);
    for (let i = 1; i < parts.length; i += 2) notes.set(parts[i] as BridgeNoteKind, parts[i + 1]);
  }
  notes.set(kind, note);
  if (kind === 'review') notes.delete('retry');
  return base + NOTE_ORDER.filter((k) => notes.has(k)).map((k) => `\n\n<!-- bridge:${k} -->\n${notes.get(k)}`).join('');
}

export interface RerunOptions {
  /** Statuses the task may be in (checked again atomically by the claim). */
  from: string[];
  noteKind: BridgeNoteKind;
  note: string;
  /** Engine states in which the old agent counts as stopped, so a refused cancel is fine. */
  stopped?: string[];
  /** Forget the last merge: the new commits must be merged again. */
  clearMerge?: boolean;
  /** Model/effort to pin on the task for this run and the ones after it (already parsed): undefined keeps the pin, null clears it. */
  profile?: AgentProfileInput;
}

/**
 * Claim a task for a new run on its branch, then stop its old engine task. Claiming first
 * ('pending', no engine id) keeps the watcher and a concurrent rerun away from the row; if the
 * old task cannot be stopped the row is restored and 503 is thrown. The caller dispatches.
 */
export async function rerunTask(
  db: AppDatabase,
  task: TaskRow,
  adapterFor: (project: string) => EngineAdapter,
  opts: RerunOptions
): Promise<void> {
  if (!opts.from.includes(task.status)) throw conflict(`Task #${task.id} is ${task.status}`);
  const body = setBridgeNote(task.body_md || '', opts.noteKind, opts.note);
  const clear = opts.clearMerge ? 1 : 0;
  const pick = <T>(next: T | null | undefined, current: T | null | undefined) => (next === undefined ? current ?? null : next);
  const modelOverride = pick(opts.profile?.model, task.model_override);
  const effortOverride = pick(opts.profile?.effort, task.effort_override);
  // The old run is gone: model/effort stay empty until the next dispatch records what that run uses.
  const claimed = db
    .prepare(`
      UPDATE bridge_tasks
      SET status = 'pending', engine_task_id = NULL, engine_status_raw = NULL, engine_url = NULL, last_error = NULL,
          paused_until = NULL, attempts = 1, body_md = ?, updated_at = ?, model = NULL, effort = NULL,
          model_override = ?, effort_override = ?,
          merged_at = CASE WHEN ? = 1 THEN NULL ELSE merged_at END,
          merge_sha = CASE WHEN ? = 1 THEN NULL ELSE merge_sha END
      WHERE id = ? AND status = ? AND engine_task_id IS ?
    `)
    .run(body, new Date().toISOString(), modelOverride, effortOverride, clear, clear, task.id, task.status, task.engine_task_id ?? null);
  if (claimed.changes !== 1) {
    throw conflict(`Task #${task.id} changed meanwhile (another retry or review?); refresh and try again`);
  }

  if (!task.engine_task_id) return;
  // Everything after the claim restores the row on failure, including a failing adapter lookup.
  let adapter: EngineAdapter | undefined;
  let refusal: string | null;
  try {
    adapter = adapterFor(task.project);
    refusal = await stopEngineTask(adapter, task.engine_task_id, opts.stopped ?? STOPPED);
  } catch (err: any) {
    refusal = err?.message || String(err);
  }
  if (!refusal) return;

  const restored = db
    .prepare(`
      UPDATE bridge_tasks
      SET status = ?, engine_task_id = ?, engine_status_raw = ?, engine_url = ?, last_error = ?,
          paused_until = ?, attempts = ?, body_md = ?, merged_at = ?, merge_sha = ?, updated_at = ?,
          model = ?, effort = ?, model_override = ?, effort_override = ?
      WHERE id = ? AND status = 'pending' AND engine_task_id IS NULL
    `)
    .run(
      task.status, task.engine_task_id, task.engine_status_raw ?? null, task.engine_url ?? null, task.last_error ?? null,
      task.paused_until ?? null, task.attempts, task.body_md ?? null, task.merged_at ?? null, task.merge_sha ?? null,
      new Date().toISOString(), task.model ?? null, task.effort ?? null, task.model_override ?? null, task.effort_override ?? null, task.id
    );
  // Cancelled meanwhile: track the old agent so the cancel retry stops it.
  if (restored.changes === 0) {
    if (adapter) await cancelOrphan(db, adapter, task.id, task.engine_task_id);
    else {
      // No adapter to cancel with: record the agent like a failed cancel, which the sweep retries.
      db.prepare("UPDATE bridge_tasks SET engine_task_id = ?, status = 'queued', last_error = ? WHERE id = ? AND status = 'cancelled' AND engine_task_id IS NULL")
        .run(task.engine_task_id, `Cancel failed: ${refusal}`, task.id);
    }
  }
  throw new HttpError(503, `Could not stop the old engine task ${task.engine_task_id} (${refusal}); try again later`);
}

/**
 * Reset a stopped goal/ticket so it can be dispatched again on the same branch: the old
 * engine task is cancelled (so no orphan agent keeps working), attempts restart at 1, and
 * the prompt gets a note to continue from what is already on the branch. `profile` pins a
 * model/effort on the task (undefined keeps its pin, null clears it).
 */
export async function prepareRetry(
  db: AppDatabase,
  taskId: number,
  role: 'goal' | 'ticket',
  adapterFor: (project: string) => EngineAdapter,
  profile?: AgentProfileInput
): Promise<BridgeTask> {
  // A bad model/effort is refused (400) before anything is read, claimed or sent.
  const parsedProfile = AgentProfileInputSchema.parse(profile ?? {});
  const task = db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task || task.role !== role) throw new HttpError(404, `${role === 'goal' ? 'Goal' : 'Ticket'} #${taskId} not found`);
  if (!RETRYABLE.includes(task.status)) {
    throw conflict(`Task #${taskId} is ${task.status}; only failed, stuck or rate-limited tasks can be retried`);
  }
  const req = db.prepare('SELECT status FROM requirements WHERE id = ?').get(task.req_id) as { status: string } | undefined;
  if (!req || req.status === 'cancelled' || req.status === 'done') {
    throw conflict(`Requirement ${task.req_id} is ${req?.status ?? 'missing'}; its tasks cannot be retried`);
  }
  const waiting = db
    .prepare(`
      SELECT l.depends_on_id AS id, d.role FROM links l JOIN bridge_tasks d ON d.id = l.depends_on_id
      WHERE l.task_id = ? AND l.state = 'waiting' ORDER BY d.role = 'question' DESC, l.id
    `)
    .all(taskId) as Array<{ id: number; role: string }>;
  if (waiting[0]?.role === 'question') {
    throw conflict(
      `Task #${taskId} is waiting for an answer to question #${waiting[0].id}; answer it (Let the agent decide is enough), then retry`
    );
  }
  if (waiting.length > 0) {
    throw conflict(`Task #${taskId} is still waiting on another task; release or cancel that dependency first`);
  }

  const reason = oneLine(task.last_error || task.status, 200);
  const note = `## Retry\nA previous attempt stopped (${reason}). ${
    task.branch ? `Continue from the commits already on \`${task.branch}\`.` : 'Start again from the current code.'
  }\n`;
  await rerunTask(db, task, adapterFor, { from: RETRYABLE, noteKind: 'retry', note, profile: parsedProfile });

  db.prepare("INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, 'task_retried', ?, 0, ?)").run(
    task.req_id,
    taskId,
    JSON.stringify({ taskId, project: task.project, oldEngineTaskId: task.engine_task_id ?? null }),
    new Date().toISOString()
  );
  return task;
}

/** Cancel an engine task; null once its agent has stopped (or the task is gone), else why not. */
async function stopEngineTask(adapter: EngineAdapter, engineTaskId: string, stopped: string[]): Promise<string | null> {
  try {
    await adapter.cancelTask(engineTaskId);
    return null;
  } catch (err: any) {
    if (isRateLimit(err)) return 'the engine is rate limited';
    if (/\(404\)/.test(err?.message || '')) return null;
    // Engines may refuse to cancel finished work; that is fine once the agent has stopped.
    try {
      const current = await adapter.getTask(engineTaskId);
      if (!current || stopped.includes(current.status)) return null;
    } catch {
      // State unknown: refuse.
    }
    return err?.message || String(err);
  }
}
