# 08 Rate limits and Retry

This page explains how the bridge waits out engine rate limits on its own, how it retries
failed engine calls, and when and how you retry a stopped task yourself.

## When an engine is rate limited

An engine (or the AI provider behind it) can refuse work for a while. The bridge notices this in
two ways:

- The engine answers a call with HTTP **429**. The bridge waits as long as the `Retry-After`
  header says (seconds or a date), or 60 seconds when it says nothing, but never more than
  24 hours.
- The engine reports a task as rate limited (statuses such as `rate_limited`, `quota_exceeded`
  or `throttled`; see the table in [02](02-projects-and-engines.md#stoneforge)).

### What you see

- The task badge shows **RATE LIMITED**, and the card says
  `Rate limited · resumes 15:30`, or `Rate limited · resumes automatically` when no time is known.
- When the engine answers 429, a toast says
  "<project> engine is rate limited until 15:30; work resumes automatically", the bell shows
  "<project> engine is rate limited", and your channels get **An engine is rate limited**
  (on by default).
- When the engine reports one of its tasks as rate limited, a toast says "A <project> task is
  paused by a rate limit; it resumes automatically".

### What happens next

- **After a 429, the bridge stops calling that engine until the reset.** Status checks,
  starts, notes and releases for that project wait; other projects carry on.
- **You are told once per incident.** If the engine refuses again within 5 minutes after the
  reset, it counts as the same incident: the bridge waits twice as long as last time (up to
  15 minutes, or longer if the engine asks for longer) and does not notify again.
- **Work the bridge could not start** (a goal or ticket refused by the limit) is parked as
  RATE LIMITED with the reset time and started again automatically after it. This does not use
  up one of its retry attempts and does not send a "task failed" notification.
- **Work already running in the engine** that the engine reports as rate limited is resumed by
  the engine itself. The bridge shows the resume time when the engine reports one; it reads the
  fields `resumeAt`, `resetAt`, `rateLimitResetAt` or `rate_limit_reset_at`. Which of them your
  Stoneforge version sends is not confirmed.

You do not need to do anything. **Retry** is offered on RATE LIMITED tasks, but it stops the
current engine task and starts a new one, so use it only if a task seems stuck after its resume
time.

## The start limit

To avoid hitting limits in the first place, the bridge starts at most **10 new agents (goals or
tickets) per project per minute**. Further starts wait for a free slot and show RATE LIMITED with
"Waiting for a start slot on the engine until <time>; it is retried automatically". They start
on their own.

Change the limit with the `ENGINE_MAX_STARTS_PER_MINUTE` environment variable when you start the
server (`0` turns it off):

```bash
ENGINE_MAX_STARTS_PER_MINUTE=4 npm run dev
```

## Retry a stopped task

**Retry** sends a goal or ticket to its engine again, on the same branch.

### When it is offered

On goal and ticket cards that are **FAILED**, **NEEDS HUMAN** or **RATE LIMITED**, while the
requirement is not Done or Cancelled.

### Steps

1. Read the error on the task card (shown under the title) and fix the cause if you can (for
   example a missing base branch or a wrong Engine URL).
2. Click **Retry**.

### What happens next

1. The bridge stops the old engine task, so two agents never work on the same branch. If the
   engine refuses and the old agent is still working, nothing changes and you see
   `Could not stop the old engine task <id> (<reason>); try again later`.
2. It starts a new engine task on the same branch, with the original prompt plus:

   ```text
   ## Retry
   A previous attempt stopped (<last error or status>). Continue from the commits already on `req/REQ-007/task-12`.
   ```

3. The task's retry attempts start again from 1. A "task was retried" entry appears in the bell.

A toast tells you the result:

| Toast | Meaning |
|---|---|
| `Task sent to its engine again` | The new engine task was created. |
| `Retry queued: the engine is rate limited; it starts automatically` | The engine is limited; the start waits for the reset. |
| `Retry failed: <reason>` | The engine refused the new task. The task is FAILED again. |

The new agent starts with the commits on the branch but without the old agent's conversation.
To give it context, add it in a **Note** once it runs, or use the review comments (see
[06](06-review-qa-and-merge.md)) when the work is finished.

### When Retry is refused

- `Task #<id> is still waiting on another task; release or cancel that dependency first`: the
  task waits on a blocking ticket or an open question. Answer the question, or release the link
  (see [04](04-agents-tickets-and-questions.md#dependency-links)).
- `Task #<id> is <status>; only failed, stuck or rate-limited tasks can be retried`
- `Requirement <REQ-ID> is <status>; its tasks cannot be retried` (Done or Cancelled)
- `Task #<id> changed meanwhile (another retry or review?); refresh and try again`

## Automatic retries

The bridge also retries on its own:

- **Starting a goal or ticket**: a goal gets 3 quick tries in a row, a ticket one. If that
  fails, the task is FAILED and the background retry takes over: up to **5 attempts** in total, waiting 5 seconds × 2^attempts
  between them (at most 5 minutes). Retries pause while the project's engine is Down or rate
  limited.
- **Resuming a paused task** (after a ticket or a question) and **cancelling** tasks in an
  engine: retried up to 5 times with the same waits.

You are notified on the **first** failure and when the **last** attempt fails, not on every
attempt in between. After the last attempt the task stays FAILED until you press **Retry**.

When resuming a paused task fails 5 times, you get "A task is blocked" with "Releasing the held
task failed 5 times; release it in its engine manually". When cancelling fails 5 times, you get
"A task failed" with "Cancelling in the engine failed 5 times; stop these agents manually".

## What "A task failed" means

The **A task failed** notification (event `task_failed`) is sent when:

- a goal or ticket could not be started in its engine (first failure, and again after the last
  attempt);
- the engine reports a task as failed (`failed`, `error`, `abandoned`);
- cancelling a requirement's tasks in the engine failed 5 times.

It is not sent for rate limits. Open the requirement, read the error on the task card, and use
**Retry** when the cause is fixed.

## If something goes wrong

- **A task stays RATE LIMITED long after its resume time**: check the engine itself. If the
  engine is fine, press **Retry**.
- **Many tasks wait for a start slot**: you started more work than the start limit allows. Wait,
  or raise `ENGINE_MAX_STARTS_PER_MINUTE`.
- **FAILED tasks are not retried automatically**: they used up their 5 attempts, or the
  project's engine is marked Down (see
  [Troubleshooting](10-troubleshooting.md#an-engine-stays-down)). Press **Retry**.
