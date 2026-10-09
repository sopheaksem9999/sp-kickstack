/** Wait used when an engine signals a rate limit without saying for how long. */
export const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
/** Longest wait honoured from an engine; anything longer is clamped. */
export const MAX_RATE_LIMIT_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * An engine (or the bridge's own start limit, when `local`) refused work because of a rate
 * limit. Callers wait `retryAfterMs` instead of counting it as a failure.
 */
export class EngineRateLimitError extends Error {
  public readonly name = 'EngineRateLimitError';

  constructor(
    message: string,
    public readonly retryAfterMs: number = DEFAULT_RATE_LIMIT_WAIT_MS,
    public readonly local: boolean = false
  ) {
    super(message);
  }
}

export function isRateLimit(err: unknown): err is EngineRateLimitError {
  return err instanceof EngineRateLimitError || (err as { name?: string } | null)?.name === 'EngineRateLimitError';
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date; null when absent/unparseable. */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.min(Math.round(Number(value) * 1000), MAX_RATE_LIMIT_WAIT_MS);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_RATE_LIMIT_WAIT_MS);
}
