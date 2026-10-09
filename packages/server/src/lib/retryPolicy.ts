/** Engine dispatch attempts per goal/ticket (each attempt = 3 quick tries) and per release/cancel. */
export const MAX_DISPATCH_ATTEMPTS = 5;

/** Notify on the first failure and when retries are exhausted, not on every retry in between. */
export function shouldNotifyFailure(attempt: number): boolean {
  return attempt <= 1 || attempt >= MAX_DISPATCH_ATTEMPTS;
}
