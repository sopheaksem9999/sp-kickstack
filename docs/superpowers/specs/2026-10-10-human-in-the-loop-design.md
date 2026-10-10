# Human in the loop: agent questions, review comments, notifications — design

Status: approved by the user ("do your suggestion"), 2026-10-10.

## Problem

Once a requirement is dispatched, people and agents cannot talk to each other:

- **Agents cannot ask a person.** An engine task that stops for help shows up only as a
  `NEEDS HUMAN` badge and a generic toast ("Task status: needs_human (backend)"). The
  question text is never stored, and the only action is **Retry**, which stops the agent and
  starts over (the branch is kept, the agent's reasoning is lost). `xticket --type question`
  only reaches another project's agent.
- **Reviewers cannot send feedback.** In review or QA there is no comment model, no endpoint
  and no UI. Moving QA back to In Progress tells no agent anything; the card bounces back to
  In Review.
- **Nobody is told.** `Notifier` (Slack / Telegram / webhook) is constructed with no channels
  and never called. The header bell is a static icon; `fetchNotifications` has no caller.
  Events that need a person ("ready for review", "agent needs help") are not even recorded.

## Goals

1. An agent can ask a person a question (optionally with choices) and **wait** for the answer
   without losing its context; the person sees the question, answers in one click, and the
   agent resumes with the answer.
2. A reviewer can leave comments on a task (optionally on a file and line) and **Request
   changes**: the agent starts a new run **on the same branch** with the comments as
   instructions. Works from In Review and from QA (after the merge).
3. A person can send a **note to a running agent**.
4. People are **notified** in the app (bell + toasts) and, if configured, on Slack, Telegram or
   a webhook, for the events that need them.
5. A **user guide** explains every module.

Non-goals: threaded discussions, multiple users/authentication, editing comments inside the
diff viewer (comments carry a file path + line instead), engine-specific "native" question APIs.

## Design

### Agent questions — reuse the hold/release machinery

A question is a `bridge_tasks` row with `role = 'question'` (no engine id), plus a `links`
row from the asking task to it. That makes the existing machinery do the work:

- **Ask** (`xticket ask`, `POST /api/agent/questions`): resolve the asking task from
  `(project, engineTaskId)`, store the question (`title` = question, `body_md` = context,
  new `options` JSON column, status `needs_human`), link it, hold the asking task in its
  engine (`holdTask`), record `question_asked`. Idempotent per (task, question text) so the
  outbox and agent retries never file twice. A hold refused by a rate limit answers 503
  quietly (no extra notification); other hold failures answer 502; the resubmit retries.
- **Answer** (`POST /api/questions/:id/answer`, option and/or free text): claim the row
  (`needs_human` → `done`, `answer_md`), mark the link `ready` with the answer as context,
  and release the asking task (`releaseSourceIfUnblocked`) — or, if it still waits on a
  cross-repo ticket, send the answer as a note and keep it held. A failed release is retried
  by the existing sweeper (links in `error`). If the hold never happened, the answer is sent
  as a note.
- Cancel of the requirement cancels open questions (existing cancel path). Question rows are
  excluded from the dependency graph and from status derivation (already `role IN
  ('goal','ticket')`).
- Agent prompts (goal and ticket) tell agents when and how to use `xticket ask`.

### Review comments and Request changes — reuse the retry rerun

- New table `review_comments` (task, optional file path + line, body, state
  `open | sent | resolved`, round).
- **Request changes** (`POST /api/requirements/:id/request-changes`): allowed in `in_review`
  or `qa` when no merge is running; each target task (in review or done, with open comments)
  is re-run through the same claim-first path as Retry (old engine task stopped, row restored
  if it cannot be), with a "Review feedback (round N)" note listing the comments; merge
  fields are cleared so the merge gate merges the new commits; the requirement returns to
  `in_progress` (explicitly when coming from `qa`). Comments become `sent` with the round.
- Bridge notes at the end of a prompt are delimited by `<!-- bridge:<kind> -->` markers
  (`review`, `retry`), replaced per kind; untrusted text cannot contain a marker
  (neutralized like `untrusted_input` tags). A retry after a review keeps the review note;
  a new review round drops the stale retry note.
- **Note to agent** (`POST /api/tasks/:id/note`): `appendNote` to a running task's engine.

### Notifications

- `notification_settings` (settings table): channels (`slack | telegram | webhook`, URL,
  enabled), per-event toggles, app URL for links. Defaults notify on: question asked, agent
  needs help, ready for review, merged to QA, merge failed, task failed, task blocked, engine
  down, engine rate limited.
- `NotificationService.dispatchPending()` runs on the scheduler tick: it reads `events` after
  a persisted cursor (first run starts at the current end — no history replay), formats each
  enabled event and sends it to every enabled channel. A failing or slow channel (10 s
  timeout) never blocks the others or the tick. **Send test** reports per-channel results.
- New recorded events: `requirement_in_review`, `task_needs_human` (with the engine's summary
  text), plus `question_asked`, `question_answered`, `changes_requested`, `task_note_sent`.
- Web: a real bell (unread count, list, mark all read, click → requirement), an "open
  questions" header shortcut, toasts for the new events, and a Notifications tab in Settings.

### Shared-checkout constraint

Another session has staged edits in `api/app.ts`, `web/src/lib/api.ts` and
`web/src/lib/useEvents.ts`. New routes live in `api/humanLoopRoutes.ts` and new web calls in
`web/src/lib/humanLoopApi.ts`, so those files change by a few lines only.
