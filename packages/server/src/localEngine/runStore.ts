import { randomUUID } from 'node:crypto';
import type { AgentCliId } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';

/** Raw status of one agent run: the Local AI CLI engine's own state. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'held'
  | 'rate_limited'
  | 'review'
  | 'no_changes'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

/** A run in one of these states never starts again (Retry creates a new run). */
export const FINISHED_RUN_STATUSES: RunStatus[] = ['review', 'no_changes', 'failed', 'timed_out', 'cancelled'];

export interface LocalRun {
  id: string;
  bridge_task_id: number;
  project: string;
  title: string;
  body_md: string;
  model: string | null;
  effort: string | null;
  cli: AgentCliId | null;
  status: RunStatus;
  /** Notes and answers not yet given to the agent; delivered when its next run starts. */
  notes_md: string;
  /** 1 when the next start continues earlier work (after a question, a usage limit or a restart). */
  continuation: number;
  worktree: string | null;
  start_sha: string | null;
  end_sha: string | null;
  pid: number | null;
  /** `ps` start time of `pid`: with the pid it proves a process is ours after a restart. */
  pid_started_at: string | null;
  exit_code: number | null;
  error: string | null;
  resume_at: string | null;
  /** Crash recoveries of this run; at 3 it fails. */
  interruptions: number;
  hold_requested_at: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export type RunPatch = Partial<Omit<LocalRun, 'id' | 'bridge_task_id' | 'project' | 'created_at' | 'updated_at'>>;

const PATCHABLE = new Set<string>([
  'title', 'body_md', 'model', 'effort', 'cli', 'status', 'notes_md', 'continuation', 'worktree', 'start_sha', 'end_sha',
  'pid', 'pid_started_at', 'exit_code', 'error', 'resume_at', 'interruptions', 'hold_requested_at', 'cancel_requested_at',
  'started_at', 'finished_at',
]);

export interface CreateRunInput {
  bridgeTaskId: number;
  project: string;
  title: string;
  bodyMd: string;
  model?: string | null;
  effort?: string | null;
}

/** Storage for agent runs (table local_runs). Status changes are compare-and-set. */
export class RunStore {
  constructor(private db: AppDatabase) {}

  /**
   * Queue a new run. Notes that earlier runs of the same task never delivered (sent after they
   * finished) move to the new run, so Retry and Request changes do not lose them.
   */
  create(input: CreateRunInput): LocalRun {
    const id = `local-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const pending = this.db
        .prepare("SELECT notes_md FROM local_runs WHERE bridge_task_id = ? AND notes_md <> '' ORDER BY created_at, rowid")
        .all(input.bridgeTaskId) as Array<{ notes_md: string }>;
      if (pending.length) {
        this.db
          .prepare("UPDATE local_runs SET notes_md = '', updated_at = ? WHERE bridge_task_id = ? AND notes_md <> ''")
          .run(now, input.bridgeTaskId);
      }
      this.db
        .prepare(`
          INSERT INTO local_runs (id, bridge_task_id, project, title, body_md, model, effort, status, notes_md, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        `)
        .run(
          id, input.bridgeTaskId, input.project, input.title, input.bodyMd, input.model ?? null, input.effort ?? null,
          pending.map((r) => r.notes_md).join('\n\n'), now, now
        );
    })();
    return this.get(id)!;
  }

  get(id: string): LocalRun | undefined {
    return this.db.prepare('SELECT * FROM local_runs WHERE id = ?').get(id) as LocalRun | undefined;
  }

  /** Change fields without a status check. */
  update(id: string, patch: RunPatch): void {
    const { sql, values } = this.setClause(patch);
    this.db.prepare(`UPDATE local_runs SET ${sql} WHERE id = ?`).run(...values, id);
  }

  /** Compare-and-set: apply `patch` only while the run is in one of `from`. True when applied. */
  transition(id: string, from: RunStatus[], patch: RunPatch): boolean {
    const { sql, values } = this.setClause(patch);
    const marks = from.map(() => '?').join(', ');
    return this.db.prepare(`UPDATE local_runs SET ${sql} WHERE id = ? AND status IN (${marks})`).run(...values, id, ...from).changes === 1;
  }

  appendNote(id: string, note: string): boolean {
    const text = note.trim();
    if (!text) return false;
    return (
      this.db
        .prepare("UPDATE local_runs SET notes_md = CASE WHEN notes_md = '' THEN ? ELSE notes_md || char(10) || char(10) || ? END, updated_at = ? WHERE id = ?")
        .run(text, text, new Date().toISOString(), id).changes === 1
    );
  }

  /** Queued runs, oldest first. */
  queued(): LocalRun[] {
    return this.withStatus(['queued']);
  }

  withStatus(statuses: RunStatus[]): LocalRun[] {
    const marks = statuses.map(() => '?').join(', ');
    return this.db.prepare(`SELECT * FROM local_runs WHERE status IN (${marks}) ORDER BY created_at, rowid`).all(...statuses) as LocalRun[];
  }

  forTask(taskId: number): LocalRun[] {
    return this.db.prepare('SELECT * FROM local_runs WHERE bridge_task_id = ? ORDER BY created_at, rowid').all(taskId) as LocalRun[];
  }

  count(status: RunStatus): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM local_runs WHERE status = ?').get(status) as { n: number }).n;
  }

  /** CLIs paused by a usage limit: the latest future resume time among their rate-limited runs. */
  pausedClis(now: number = Date.now()): Map<AgentCliId, string> {
    const rows = this.db
      .prepare(`
        SELECT cli, MAX(resume_at) AS until FROM local_runs
        WHERE status = 'rate_limited' AND cli IS NOT NULL AND resume_at > ?
        GROUP BY cli
      `)
      .all(new Date(now).toISOString()) as Array<{ cli: AgentCliId; until: string }>;
    return new Map(rows.map((r) => [r.cli, r.until]));
  }

  private setClause(patch: RunPatch): { sql: string; values: unknown[] } {
    const keys = Object.keys(patch);
    for (const key of keys) {
      if (!PATCHABLE.has(key)) throw new Error(`local_runs.${key} cannot be changed`);
    }
    const values = keys.map((k) => (patch as Record<string, unknown>)[k] ?? null);
    return {
      sql: [...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', '),
      values: [...values, new Date().toISOString()],
    };
  }
}
