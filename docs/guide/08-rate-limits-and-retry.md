# 08 Rate limits and Retry

This page explains how the bridge waits out engine rate limits on its own, how it retries
failed engine calls, and when and how you retry a stopped task yourself, also with another model
or effort.

## When an engine is rate limited

An engine (or the AI provider behind it) can refuse work for a while. The bridge notices this in
two ways:

- The engine answers a call with HTTP **429**. The bridge waits as long as the `Retry-After`
  header says (seconds or a date), or 60 seconds when it says nothing, but never more than
  24 hours.
- The engine reports a task as rate limited (statuses such as `rate_limited`, `quota_exceeded`
  or `throttled`; see the table in [02](02-projects-and-engines.md#stoneforge)).

### What you see

- The task badge shows **RATE LIMITED**, and the task card on the requirement page says
  `Rate limited · resumes 15:30`, or `Rate limited · resumes automatically` when no time is
  known. (The error text of a RATE LIMITED task is hidden on that page.)
- When the engine answers 429, a toast says
  "<project> engine is rate limited until 15:30; work resumes automatically", the bell shows
  "<project> engine is rate limited", and your channels get **An engine is rate limited**
  (on by default).
- When the engine reports one of its tasks as rate limited, a toast says "A <project> task is
  paused by a rate limit; it resumes automatically".

These texts say "automatically". What really resumes on its own depends on who paused the work,
as described next.

### What happens next

- **After a 429, the bridge stops calling that engine until the reset.** Status checks,
  starts, notes and releases for that project wait; other projects carry on.
- **You are told once per incident.** If the engine refuses again within 5 minutes after the
  reset, it counts as the same incident: the bridge waits twice as long as last time (up to
  15 minutes, or longer if the engine asks for longer) and does not notify again.
- **Work the bridge could not start** (a goal or ticket refused by a 429 or by the start limit)
  is parked by the bridge as RATE LIMITED with the reset time, and the bridge starts it again
  automatically after that time. This does not use up one of its retry attempts and does not
  send a "task failed" notification. You do not need to do anything.
- **Work already running in the engine** that the engine reports as rate limited is only shown
  by the bridge: it copies the engine's status and, if the engine sends one, its resume time
  (from the field `resumeAt`, `resetAt`, `rateLimitResetAt` or `rate_limit_reset_at`; which one
  your Stoneforge version sends is not confirmed). The bridge does nothing to resume such a
  task. Whether and when it continues depends on the engine. The badge changes back as soon as
  the engine reports a new status.

If a task the engine paused stays RATE LIMITED long after the time shown, press **Retry**. Retry
stops the current engine task and starts a new one on the same branch, so use it only when the
task is really stuck.

## The start limit

To avoid hitting limits in the first place, the bridge starts at most **10 new agents (goals or
tickets) per project per minute**. Further starts wait for a free slot: the task shows
**RATE LIMITED**, and its card on the requirement page says `Rate limited · resumes 15:30` with
the time the next slot frees up. The bridge starts it on its own after that time. (The side panel
on the board shows the underlying text instead: `Waiting for a start slot on the engine until
<time>; it is retried automatically`, with the time in ISO format.)

Change the limit with the `ENGINE_MAX_STARTS_PER_MINUTE` environment variable when you start the
server (`0` turns it off):

```bash
ENGINE_MAX_STARTS_PER_MINUTE=4 pnpm run dev
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
   A previous attempt stopped (<last error or status>). Continue from the commits already on `REQ-007`.
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

### Retry with a different model or effort

A task that failed on a hard problem may do better with a stronger model, and an easy one may be
cheaper with a smaller one. You can pin a model and effort on the task while you retry it. This is
optional; the plain **Retry** button keeps the task's current setting.

1. Next to **Retry** on the task card, click the small arrow. Its tooltip says
   **Retry with a different model or effort**. A panel titled **Retry with** opens. If the task is
   already pinned, it says `Pinned now: opus · high.`
2. Under **Model**, click a model (`opus`, `sonnet`, `haiku`, `fable`), or type another id into
   **Other model id** and press Enter. Under **Effort**, click `low`, `medium`, `high`, `xhigh` or
   `max`. Leave **Keep** where you do not want to change anything: **Keep** leaves this task's
   setting as it is.
3. Optional, only shown when the task has a pin: tick **Clear pin (use the requirement's or
   workspace's setting)**. The model and effort choices are greyed out while it is ticked.
4. Click **Retry** in the panel. The usual toast tells you the result (see the table above).

#### What happens next

- The bridge retries as described above, and the model and effort you picked are **pinned on the
  task**: stored on it, used for this new run and for every later run of the task, including the
  automatic retries after a failed start. A pin wins over the requirement's and the workspace's
  settings (see [Which setting wins](03-requirements-and-fan-out.md#which-setting-wins)).
- Model and effort are pinned separately. If you pick only an effort, the model still comes from the
  requirement or the workspace, and a model you pinned earlier stays.
- **Clear pin** removes both parts of the pin, so the requirement's and the workspace's settings
  apply again. Without it, you cannot remove a pin, only replace it with another choice.
- The task card shows a marker such as `pinned: opus · high` next to the model line. The
  model line is blank until the new run has been sent, then it shows what the new run was sent
  with.
- Tasks of Manual projects show no arrow and no marker: they ignore a model and effort.
- If the old engine task cannot be stopped, nothing changes, and the old pin stays.

A model id that does not start with a letter or digit, or that has characters other than letters,
digits and `. _ : / -`, is not accepted: the panel shows a red hint, and what you typed is not
used.

Local AI CLIs apply the chosen model and effort directly to the command line; Stoneforge receives
them in the request payload; Manual projects ignore them (see [02](02-projects-and-engines.md#model-and-effort-sent-to-the-engine)).

### When Retry is refused

- `Task #<id> is waiting for an answer to question #<question id>; answer it (Let the agent decide is enough), then retry`:
  the task has an open question. Answer it on the requirement page (see
  [05](05-answering-questions-and-notes.md#answer-a-question)), then press **Retry** again.
- `Task #<id> is still waiting on another task; release or cancel that dependency first`: the
  task waits on a blocking ticket. Finish or retry the ticket, or release the link (see
  [04](04-agents-tickets-and-questions.md#dependency-links)).
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
- **A retried task shows no model line**: it fills in once the new run has been sent. If it stays
  empty, the project is **Manual**, or the retry is parked by a rate limit and has not started
  yet.
- **The task runs with a model you did not pick**: a part you left on **Keep** keeps the task's
  own setting, so that part still comes from its earlier pin, the requirement or the workspace.
- **FAILED tasks are not retried automatically**: they used up their 5 attempts, or the
  project's engine is marked Down (see
  [Troubleshooting](10-troubleshooting.md#an-engine-stays-down)). Press **Retry**.
