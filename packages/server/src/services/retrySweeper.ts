import { AppDatabase } from '../db/index.js';
import { BridgeTask } from '@sp-kickstack/shared';
import { FanOutService } from './fanOutService.js';
import { TicketService } from './ticketService.js';
import { LinkService } from './linkService.js';
import { MAX_DISPATCH_ATTEMPTS, shouldNotifyFailure } from '../lib/retryPolicy.js';

export interface RetrySweeperOptions {
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Engine dispatch attempts per goal/ticket (each attempt = 3 quick tries). */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** A 'pending' reservation older than this was abandoned (crash) and is re-dispatched. */
  stalePendingMs?: number;
}

type RetryRow = Pick<BridgeTask, 'id' | 'req_id' | 'status' | 'updated_at'> & { attempts: number };

/**
 * Retries the engine side effects that failed transiently: goal and ticket creation,
 * link releases and cancellations. Backoff: min(2^attempts x base, max).
 */
export class RetrySweeper {
  private isSweeping = false;
  private now: () => number;
  private maxAttempts: number;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private stalePendingMs: number;

  constructor(
    private db: AppDatabase,
    private fanOutService: FanOutService,
    private ticketService: TicketService,
    private linkService: LinkService,
    options: RetrySweeperOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.maxAttempts = options.maxAttempts ?? MAX_DISPATCH_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? 5000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60 * 1000;
    this.stalePendingMs = options.stalePendingMs ?? 60 * 1000;
  }

  public async sweepOnce(): Promise<{ goals: number; tickets: number; releases: number; cancels: number }> {
    if (this.isSweeping) return { goals: 0, tickets: 0, releases: 0, cancels: 0 };
    this.isSweeping = true;
    try {
      return {
        goals: await this.retryGoals(),
        tickets: await this.retryTickets(),
        releases: await this.retryReleases(),
        cancels: await this.retryCancels(),
      };
    } finally {
      this.isSweeping = false;
    }
  }

  private dueAfter(updatedAt: string, delayMs: number): boolean {
    return Date.parse(updatedAt) + delayMs <= this.now();
  }

  private backoffMs(attempts: number): number {
    return Math.min(2 ** attempts * this.baseDelayMs, this.maxDelayMs);
  }

  private undispatched(role: 'goal' | 'ticket'): RetryRow[] {
    return this.db
      .prepare(`
        SELECT t.id, t.req_id, t.status, t.updated_at, t.attempts FROM bridge_tasks t
        JOIN requirements r ON r.id = t.req_id
        WHERE t.role = ? AND t.engine_task_id IS NULL AND t.status IN ('failed', 'pending')
          AND t.attempts < ? AND r.status NOT IN ('cancelled', 'done')
        ORDER BY t.id
      `)
      .all(role, this.maxAttempts) as RetryRow[];
  }

  /** Claim a retry: a failed row past its backoff, or a pending row abandoned by a crash. */
  private claim(row: RetryRow): boolean {
    const now = new Date().toISOString();
    if (row.status === 'failed' && this.dueAfter(row.updated_at, this.backoffMs(row.attempts))) {
      return (
        this.db
          .prepare(`
            UPDATE bridge_tasks SET status = 'pending', attempts = attempts + 1, last_error = NULL, updated_at = ?
            WHERE id = ? AND status = 'failed' AND engine_task_id IS NULL
          `)
          .run(now, row.id).changes === 1
      );
    }
    if (row.status === 'pending' && this.dueAfter(row.updated_at, this.stalePendingMs)) {
      return (
        this.db
          .prepare(`
            UPDATE bridge_tasks SET attempts = attempts + 1, updated_at = ?
            WHERE id = ? AND status = 'pending' AND engine_task_id IS NULL AND updated_at = ?
          `)
          .run(now, row.id, row.updated_at).changes === 1
      );
    }
    return false;
  }

  private async retryGoals(): Promise<number> {
    let retried = 0;
    const requirements = new Set<string>();
    for (const row of this.undispatched('goal')) {
      if (!this.claim(row)) continue;
      await this.fanOutService.dispatchGoal(row.id, { recordFailure: shouldNotifyFailure(row.attempts + 1) });
      requirements.add(row.req_id);
      retried++;
    }
    for (const reqId of requirements) {
      const goals = this.db
        .prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND role = 'goal' AND status <> 'cancelled'")
        .all(reqId) as BridgeTask[];
      this.fanOutService.applyFanOutStatus(reqId, goals);
    }
    return retried;
  }

  private async retryTickets(): Promise<number> {
    let retried = 0;
    for (const row of this.undispatched('ticket')) {
      if (!this.claim(row)) continue;
      await this.ticketService
        .dispatchTicket(row.id, { recordFailure: shouldNotifyFailure(row.attempts + 1) })
        .catch(() => {});
      retried++;
    }
    return retried;
  }

  /**
   * Releases and cancels have no attempts column; their retry state lives here
   * (resets on restart, which simply allows another capped round).
   */
  private sideEffects = new Map<string, { attempts: number; nextAt: number }>();

  private isRetryDue(key: string, lastChange: string): boolean {
    const state = this.sideEffects.get(key);
    if (!state) return this.dueAfter(lastChange, this.baseDelayMs);
    return state.attempts < this.maxAttempts && state.nextAt <= this.now();
  }

  private recordOutcome(key: string, ok: boolean, onGiveUp: () => void) {
    if (ok) {
      this.sideEffects.delete(key);
      return;
    }
    const attempts = (this.sideEffects.get(key)?.attempts ?? 0) + 1;
    this.sideEffects.set(key, { attempts, nextAt: this.now() + this.backoffMs(attempts) });
    if (attempts === this.maxAttempts) onGiveUp();
  }

  private recordEvent(type: string, reqId: string, taskId: number | null, payload: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(reqId, taskId, type, JSON.stringify(payload), new Date().toISOString());
  }

  private async retryReleases(): Promise<number> {
    const sources = this.db
      .prepare(`
        SELECT DISTINCT l.task_id, t.req_id, t.updated_at FROM links l
        JOIN bridge_tasks t ON t.id = l.task_id
        JOIN requirements r ON r.id = t.req_id
        WHERE l.state = 'error' AND r.status NOT IN ('cancelled', 'done')
      `)
      .all() as Array<{ task_id: number; req_id: string; updated_at: string }>;

    let released = 0;
    for (const source of sources) {
      const key = `release:${source.task_id}`;
      if (!this.isRetryDue(key, source.updated_at)) continue;
      this.db.prepare("UPDATE links SET state = 'ready' WHERE task_id = ? AND state = 'error'").run(source.task_id);
      if ((await this.linkService.releaseSourceIfUnblocked(source.task_id)).length > 0) released++;

      const stillFailing = (
        this.db.prepare("SELECT COUNT(*) AS c FROM links WHERE task_id = ? AND state = 'error'").get(source.task_id) as { c: number }
      ).c > 0;
      this.recordOutcome(key, !stillFailing, () =>
        this.recordEvent('task_blocked', source.req_id, source.task_id, {
          taskId: source.task_id,
          reason: `Releasing the held task failed ${this.maxAttempts} times; release it in its engine manually`,
        })
      );
    }
    return released;
  }

  private async retryCancels(): Promise<number> {
    const pending = this.db
      .prepare(`
        SELECT t.req_id, MAX(t.updated_at) AS updated_at FROM bridge_tasks t
        JOIN requirements r ON r.id = t.req_id
        WHERE r.status = 'cancelled' AND t.engine_task_id IS NOT NULL
          AND t.status NOT IN ('done', 'cancelled', 'failed')
        GROUP BY t.req_id
      `)
      .all() as Array<{ req_id: string; updated_at: string }>;

    let retried = 0;
    for (const row of pending) {
      const key = `cancel:${row.req_id}`;
      if (!this.isRetryDue(key, row.updated_at)) continue;
      const { failed } = await this.fanOutService.cancel(row.req_id);
      retried++;
      this.recordOutcome(key, failed.length === 0, () =>
        this.recordEvent('task_failed', row.req_id, failed[0] ?? null, {
          stage: 'cancel',
          taskIds: failed,
          reason: `Cancelling in the engine failed ${this.maxAttempts} times; stop these agents manually`,
        })
      );
    }
    return retried;
  }
}
