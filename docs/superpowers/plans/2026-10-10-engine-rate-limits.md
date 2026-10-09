# Engine Rate Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When an engine (or the agent inside it) is rate limited, the bridge pauses and resumes on its own instead of failing tasks, burning retries, polling the limited API, or calling the engine "down"; and any failed task can be retried on its existing branch.

**Architecture:** Rate limits become a first-class signal. The Stoneforge adapter turns HTTP 429 into `EngineRateLimitError` (with `Retry-After`) and maps rate-limit task statuses to a new normalized status `rate_limited` (with a resume time). A throttling wrapper around the adapter factory (`lib/engineThrottle.ts`) is a per-engine circuit breaker (trip on 429, fast-fail until the reset, one notification per trip) plus a per-engine start limit for new agents. Dispatch, watcher and retry sweep treat rate limits as "wait until X" — no attempt is consumed, no task_failed, no engine_down. A manual "Retry task" resets a failed/stuck task and re-dispatches it on the same branch.

**Tech Stack:** Node 22.19.0, TypeScript, Express 4, better-sqlite3, Vitest, React/TanStack Query.

**Spec:** this document (design approved in chat 2026-10-10: items 1–5 of the rate-limit suggestions; the operator asked to implement on the current branch, `main`).

## Global Constraints

- `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`; `npm run verify` must pass for every commit, checked in an isolated worktree (another session has uncommitted work in this checkout — stage only my own hunks).
- Shared changes need `npm run --workspace=@sp-kickstack/shared build`.
- Default start limit `ENGINE_MAX_STARTS_PER_MINUTE` = 10 per engine (0 = unlimited). Default trip length when no `Retry-After` = 60 s; maximum honoured wait = 24 h.
- New normalized status name exactly `rate_limited`; events `engine_rate_limited`, `task_rate_limited`, `task_retried`.

## Review Focus

1. A limit lasting hours must never exhaust the 5-attempt cap or produce a permanent failure.
2. While an engine is tripped the bridge makes no network calls to it (watcher, dispatch, sweep) and does not emit `engine_down`.
3. Exactly one notification per trip, not one per call.
4. Retrying a task must not lose committed work (same branch) or leave an orphan agent (old engine task cancelled).
5. Self-imposed start limits delay dispatch but never trip the breaker for polling.

---

### Task 1: Rate-limit signals (status, error, data)

**Files:** `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`, `packages/server/src/db/migrations.ts` (migration 4), `packages/server/src/adapters/rateLimit.ts` (new), `packages/server/src/adapters/stoneforgeAdapter.ts`; tests `packages/server/src/adapters/adapters.test.ts`, `packages/server/src/db/migrations.test.ts`.

**Produces:** `NormStatus` += `'rate_limited'`; `EngineTask.resumeAt?: string`; `BridgeTask.paused_until?: string | null`; `EventType` += `engine_rate_limited | task_rate_limited | task_retried`; column `bridge_tasks.paused_until`; `class EngineRateLimitError extends Error { retryAfterMs: number; local: boolean }`, `parseRetryAfter(header: string | null, now?: number): number | null`, `isRateLimit(err): err is EngineRateLimitError`.

- [ ] Failing tests: adapter maps raw `rate_limited`, `rate-limited`, `quota_exceeded`, `usage_limited`, `throttled` → `rate_limited` and exposes `resumeAt` from `resumeAt`/`resetAt`/`rateLimitResetAt`; a 429 with `Retry-After: 120` rejects with `EngineRateLimitError` (`retryAfterMs` 120000); an HTTP-date `Retry-After` parses; `health()` rethrows a rate limit instead of `{ok:false}`; migration 4 adds `paused_until`, `LATEST_VERSION` 4.
- [ ] Implement; rebuild shared; verify; commit `feat(server,shared): rate-limit status, error and resume time from engines`.

### Task 2: Engine throttle (circuit breaker + start limit)

**Files:** `packages/server/src/lib/engineThrottle.ts` (new), `packages/server/src/index.ts`; test `packages/server/src/lib/engineThrottle.test.ts`.

**Produces:**
```ts
export class EngineThrottle {
  constructor(opts?: { maxStartsPerMinute?: number; defaultTripMs?: number; now?: () => number; onTrip?: (project: string, until: number) => void });
  isTripped(project: string): boolean;
  trippedUntil(project: string): number | null;
  trip(project: string, retryAfterMs?: number): void;          // extends, never shortens; onTrip only when newly tripped or extended
  wrap(getAdapter: AdapterFactory): AdapterFactory;          // throttled adapters
}
```
Wrapped adapter: every method fast-fails with `EngineRateLimitError` while tripped (no network); a call rejecting with a rate limit trips the project and rethrows; `createGoal`/`createTask` take a start token (sliding 60 s window) and, when none is left, reject with a *local* `EngineRateLimitError` (retryAfter = time to the next free slot) without tripping.

- [ ] Failing tests: trip/fast-fail/no network calls while tripped; reset after the window; `onTrip` once per trip (and again only when extended); start limit rejects the 11th start in a minute with `local: true` and does not trip; health/getTask still allowed when only the start budget is exhausted.
- [ ] Implement; wire in `index.ts` (`const throttle = new EngineThrottle({ onTrip: … engine_rate_limited event + broadcast })`, `getAdapter = throttle.wrap(rawGetAdapter)`); verify; commit `feat(server): per-engine rate-limit circuit breaker and start limit`.

### Task 3: Consumers wait instead of failing

**Files:** `services/fanOutService.ts`, `services/ticketService.ts`, `services/retrySweeper.ts`, `watcher/engineWatcher.ts`, `services/taskReactor.ts`; tests `packages/server/src/services/rateLimits.test.ts` (new).

- [ ] Failing tests:
  - dispatch rejected with a rate limit: task `failed` with `paused_until` set, `last_error` "rate limited until …", attempts NOT consumed, no `task_failed` event; the sweep does not retry before `paused_until`, then dispatches after it (even after more than 5 rate-limited rounds).
  - watcher: engine 429 on `/health` or `getTask` → no `engine_down`, project skipped while tripped, no further calls; resumes after the trip.
  - engine reports `rate_limited` with `resumeAt`: task `rate_limited`, `paused_until` stored, one `task_rate_limited` event, requirement stays `in_progress`; back to `running` clears `paused_until`.
  - release/cancel retries skip tripped engines without consuming attempts.
- [ ] Implement: dispatch loops stop on a rate limit and record `paused_until`, `attempts = MAX(attempts - 1, 0)`; `RetrySweeper` skips tasks with `paused_until > now` and projects that are tripped (claims and side-effect retries); watcher skips tripped projects, treats rate limits from `health`/`getTask` quietly, stores/clears `paused_until`; reactor records `task_rate_limited`.
- [ ] Verify; commit `feat(server): rate-limited work pauses and resumes instead of failing`.

### Task 4: Retry a failed task on its branch

**Files:** `services/taskRetry.ts` (new), `api/app.ts` (`POST /api/tasks/:id/retry`), `index.ts`; tests in `rateLimits.test.ts`.

**Produces:** `retryTask(taskId)` on `FanOutService` (goals) and `TicketService` (tickets) via shared `prepareRetry(db, task)`; route answers the re-read task.

- [ ] Failing tests: a goal `failed` inside its engine (has engine id) → retry cancels the old engine task, creates a new one, same `branch`, `attempts` reset, `task_retried` event; a dispatch-failed goal past the cap can be retried; tickets too; 409 for done/cancelled tasks or cancelled/done requirements; requirement `ready` (all goals failed) becomes `in_progress`.
- [ ] Implement; verify; commit `feat(server): retry a failed task on its existing branch`.

### Task 5: Web

**Files:** `web/src/components/StatusBadge.tsx`, `web/src/lib/api.ts` (`retryTask`), `web/src/pages/RequirementDetailPage.tsx` (Retry button, "until HH:MM"), `web/src/lib/useEvents.ts` (toasts), `web/src/lib/taskActions.ts` (+test).

- [ ] Failing tests (pure helpers): `canRetry(task, reqStatus)`; `pausedLabel(task, now)` → "Rate limited · resumes 15:00" / null.
- [ ] Implement; verify (web typecheck); commit `feat(web): rate-limit status, resume time and Retry task`.
