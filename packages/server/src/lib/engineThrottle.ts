import type { EngineAdapter, CreateEngineTaskInput } from '../adapters/types.js';
import type { AdapterFactory } from '../services/fanOutService.js';
import { DEFAULT_RATE_LIMIT_WAIT_MS, EngineRateLimitError, isRateLimit } from '../adapters/rateLimit.js';

export interface EngineThrottleOptions {
  /** New agents (goals/tickets) an engine may start per minute; 0 = unlimited. Default ENGINE_MAX_STARTS_PER_MINUTE or 10. */
  maxStartsPerMinute?: number;
  /** Trip length when a rate limit says nothing about its reset. */
  defaultTripMs?: number;
  now?: () => number;
  /** Called when an engine becomes rate limited (or the limit is extended by more than a minute). */
  onTrip?: (project: string, until: number) => void;
}

const WINDOW_MS = 60_000;
const RENOTIFY_EXTENSION_MS = 60_000;
/** A new trip this soon after the last one ended belongs to the same incident. */
const INCIDENT_GRACE_MS = 5 * 60_000;
/** Back-to-back trips double their wait (when the engine keeps refusing), up to this. */
const MAX_ESCALATED_TRIP_MS = 15 * 60_000;

function envStartLimit(): number {
  const value = Number(process.env.ENGINE_MAX_STARTS_PER_MINUTE);
  return Number.isFinite(value) && value >= 0 ? value : 10;
}

/**
 * Per-engine rate-limit handling around the adapter factory:
 * - circuit breaker: an engine that answered with a rate limit gets no calls at all until the
 *   reset (calls fail fast with EngineRateLimitError), and one notification per trip;
 * - start limit: at most N new agents per engine per minute; excess starts fail fast with a
 *   *local* EngineRateLimitError (wait for the next slot) without tripping the engine.
 */
export class EngineThrottle {
  private trippedUntilMs = new Map<string, number>();
  private notifiedUntilMs = new Map<string, number>();
  /** Per engine: the current/last rate-limit incident (kept after a trip expires, for the grace window). */
  private incidents = new Map<string, { lastUntil: number; length: number }>();
  private starts = new Map<string, number[]>();
  private readonly maxStarts: number;
  private readonly defaultTripMs: number;
  private readonly now: () => number;

  constructor(private opts: EngineThrottleOptions = {}) {
    this.maxStarts = opts.maxStartsPerMinute ?? envStartLimit();
    this.defaultTripMs = opts.defaultTripMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
    this.now = opts.now ?? Date.now;
  }

  public trippedUntil(project: string): number | null {
    const until = this.trippedUntilMs.get(project);
    if (until === undefined) return null;
    if (until <= this.now()) {
      this.trippedUntilMs.delete(project);
      return null;
    }
    return until;
  }

  public isTripped(project: string): boolean {
    return this.trippedUntil(project) !== null;
  }

  /**
   * Mark an engine rate limited. Never shortens an existing trip. A trip that starts again
   * within the grace window after the last one ended is the same incident: its wait doubles
   * (capped) and no new notification is sent; only a new incident, or a long extension of an
   * active trip, notifies.
   */
  public trip(project: string, retryAfterMs: number = this.defaultTripMs) {
    const now = this.now();
    const current = this.trippedUntil(project);
    const incident = this.incidents.get(project);
    const sameIncident = incident !== undefined && now - incident.lastUntil <= INCIDENT_GRACE_MS;

    let length = Math.max(retryAfterMs, 1_000);
    if (sameIncident && current === null) {
      length = Math.min(Math.max(length, incident!.length * 2), Math.max(MAX_ESCALATED_TRIP_MS, retryAfterMs));
    }
    const until = now + length;
    if (current !== null && current >= until) return;

    this.trippedUntilMs.set(project, until);
    this.incidents.set(project, { lastUntil: until, length: sameIncident ? Math.max(length, incident!.length) : length });

    const notified = this.notifiedUntilMs.get(project);
    const longExtension = current !== null && until - (notified ?? 0) > RENOTIFY_EXTENSION_MS;
    if (!sameIncident || longExtension) {
      this.notifiedUntilMs.set(project, until);
      this.opts.onTrip?.(project, until);
    }
  }

  public wrap(getAdapter: AdapterFactory): AdapterFactory {
    return (project: string) => this.throttled(project, getAdapter(project));
  }

  private throttled(project: string, inner: EngineAdapter): EngineAdapter {
    const guard = async <T>(call: () => Promise<T>): Promise<T> => {
      const until = this.trippedUntil(project);
      if (until !== null) {
        throw new EngineRateLimitError(
          `${project} engine is rate limited until ${new Date(until).toISOString()}`,
          until - this.now()
        );
      }
      try {
        return await call();
      } catch (err) {
        if (isRateLimit(err) && !err.local) this.trip(project, err.retryAfterMs);
        throw err;
      }
    };
    const start = <T>(call: () => Promise<T>): Promise<T> =>
      guard(() => {
        this.takeStartSlot(project);
        return call();
      });

    return {
      type: inner.type,
      health: () => guard(() => inner.health()),
      createGoal: (input: CreateEngineTaskInput) => start(() => inner.createGoal(input)),
      createTask: (input: CreateEngineTaskInput) => start(() => inner.createTask(input)),
      getTask: (id: string) => guard(() => inner.getTask(id)),
      listTasks: (ids: string[]) => guard(() => inner.listTasks(ids)),
      holdTask: (id: string, reason: string) => guard(() => inner.holdTask(id, reason)),
      releaseTask: (id: string, context: string) => guard(() => inner.releaseTask(id, context)),
      appendNote: (id: string, bodyMd: string) => guard(() => inner.appendNote(id, bodyMd)),
      cancelTask: (id: string) => guard(() => inner.cancelTask(id)),
      ...(inner.subscribe ? { subscribe: inner.subscribe.bind(inner) } : {}),
    };
  }

  /** Sliding one-minute window of agent starts per engine. */
  private takeStartSlot(project: string) {
    if (this.maxStarts <= 0) return;
    const now = this.now();
    const recent = (this.starts.get(project) ?? []).filter((t) => t > now - WINDOW_MS);
    if (recent.length >= this.maxStarts) {
      this.starts.set(project, recent);
      throw new EngineRateLimitError(
        `${project} engine start limit reached (${this.maxStarts}/min)`,
        recent[0] + WINDOW_MS - now,
        true
      );
    }
    recent.push(now);
    this.starts.set(project, recent);
  }
}
