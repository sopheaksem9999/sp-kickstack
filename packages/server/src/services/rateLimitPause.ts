import { AppDatabase } from '../db/index.js';
import { EngineRateLimitError } from '../adapters/rateLimit.js';

/**
 * An engine refused to start a task because of a rate limit: park the reserved row as
 * 'rate_limited' until the reset. The attempt is given back (it was not the task's fault),
 * and no task_failed notification is recorded; the engine trip already notified once.
 */
export function pauseForRateLimit(db: AppDatabase, taskId: number, err: EngineRateLimitError): string {
  const until = new Date(Date.now() + err.retryAfterMs).toISOString();
  const reason = err.local
    ? `Waiting for a start slot on the engine until ${until}; it is retried automatically`
    : `Engine rate limited until ${until}; it is retried automatically`;
  db.prepare(`
    UPDATE bridge_tasks
    SET status = 'rate_limited', paused_until = ?, last_error = ?, attempts = MAX(attempts - 1, 0), updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(until, reason, new Date().toISOString(), taskId);
  return until;
}
