# Local AI CLI engine — design

Status: design approved by the user in chat ("1"), 2026-10-13. Builds on the Agent Queue (28cfb38),
agent model/effort, human-in-the-loop (questions, notes, Retry, Request changes) and the merge gate.

## Problem

The spec says a requirement progresses on its own once a person clicks **Start Fan-Out**. Today every
repository uses the **Manual** engine: fan-out creates `manual-…` tasks that nobody works on, the watcher
skips them, and the Agent Queue shows them QUEUED forever with an empty Logs drawer. Stoneforge, the only
automatic engine, is not installed, and its HTTP API is unconfirmed. Meanwhile the PC already has AI CLIs
that the app detects and uses for drafting (Claude Code 2.1.284 and AGY 1.3.3 here; Codex supported but
not installed).

## Decisions (user, 2026-10-13)

- **Autonomy**: the agent may edit files and run commands, but only in a separate git worktree of the
  repository on the task branch. The person's own checkout is never touched.
- **Which CLI**: the Settings default (**AI & Local Engines**; AGY today). The requirement/task model and
  effort still apply.
- **Parallel runs**: 2 at a time, changeable in Settings.
- **Approach**: a new engine type inside the bridge. It implements the existing `EngineAdapter`, so fan-out,
  the watcher, Retry, questions, notes, rate limits, cancel and the merge gate work unchanged. A direct "fan-out
  starts processes" shortcut and a separate fake-Stoneforge daemon were rejected: the first duplicates
  status/retry/cancel logic, the second is a second server to keep alive (also in the desktop app).

## What the person sees

1. In **Repositories**, the engine picker offers **Manual**, **Stoneforge** and **Local AI CLI** (no URL).
2. After **Start Fan-Out**, each task of a Local AI CLI repository moves QUEUED → RUNNING → IN REVIEW by
   itself. At most N run at once (default 2); the rest wait in QUEUED.
3. **Logs** shows what the agent does (its messages, the commands and edits it makes, the final summary),
   refreshed every 2.5 s like today.
4. Questions (`xticket ask`), cross-repo tickets (`xticket create`), Retry, Request changes, model/effort,
   rate limits, Cancel and the merge policy behave as they do for any engine.

## Components (server)

| Unit | Purpose | Depends on |
|---|---|---|
| `EngineType` `'local'` | New value in `EngineTypeSchema` / `EngineType`. `projects.engine_type` is TEXT: no migration. | shared |
| `local_runs` table (migration) | One row per agent run; the engine's own state. | db |
| `LocalCliAdapter` | `EngineAdapter` over `local_runs`; never spawns anything itself. | `local_runs`, runner |
| `AgentRunner` | Starts queued runs within the parallel limit, supervises processes, classifies exits. One per server. | `local_runs`, `AgentWorktrees`, `CliProfiles`, settings |
| `AgentWorktrees` | Create, reuse and remove a task's worktree (`lib/gitRepo.ts` helpers). | git |
| `CliProfiles` | Per CLI: binary (`findCliBinary`, Settings custom path), headless command line, output parser, rate-limit detector. | settings |

`createAdapter` gets `case 'local': return new LocalCliAdapter(project, runner)`. The watcher already polls
every non-manual project, so it picks up local tasks without changes.

### `local_runs`

`id` (`local-<uuid>`, the task's `engine_task_id`), `bridge_task_id`, `project`, `title`, `body_md`,
`model`, `effort`, `cli`, `status`, `notes_md` (notes and answers not yet delivered to the agent),
`worktree`, `start_sha`, `end_sha`, `pid`, `pid_started_at`, `exit_code`, `error`, `resume_at`,
`interruptions`, `hold_requested_at`, `created_at`, `started_at`, `finished_at`, `updated_at`.

Raw statuses map to bridge statuses in `getTask`:

| raw | bridge |
|---|---|
| `queued` | queued |
| `running` | running |
| `held` | held |
| `rate_limited` (+ `resume_at` as `resumeAt`) | rate_limited |
| `review` | in_review |
| `no_changes` | needs_human |
| `failed`, `timed_out` | failed |
| `cancelled` | cancelled |

The adapter needs the bridge task id to find the branch and to write logs, so `CreateEngineTaskInput` gets
an optional `bridgeTaskId`. Fan-out and ticket dispatch pass it. `StoneforgeAdapter` sends only the
fields it sends today (title, body, priority, labels, model, effort), so its request body does not change.

## A run, step by step

1. **Dispatch.** `createGoal`/`createTask` insert a `queued` run and return at once (claim-first stays
   intact). The runner is nudged, so a free slot starts it without waiting for its 5 s tick.
2. **Start.** Oldest queued run first, skipping CLIs paused for a rate limit, while `running < maxParallel`
   (counted in the DB, all workspaces: it is one PC).
   - **Worktree**: `git worktree add <root>/<project>/task-<id> <branch>` (`<root>` defaults to
     `<workspace>/agent-worktrees`), reused when it already exists for that branch. If the branch is
     checked out somewhere else, the run fails with "branch … is checked out in <path>; switch that
     checkout to another branch, then Retry". A repository that is not a git work tree fails with "Local
     AI CLI needs a git repository".
   - **CLI**: Settings → Agent CLI. "Use AI default" follows `ai_cli.defaultProvider`; if that is
     Ollama, Heuristic or Auto (none can edit code), the first enabled and installed of Claude Code, AGY,
     Codex is used. None available → the run waits in `queued` and `health()` reports why (the watcher
     shows the engine as down).
   - **Model/effort**: the task's resolved profile (task pin → requirement → workspace), else the CLI's
     Settings model/effort. The values used are recorded on the task, as today.
   - **Prompt**: the task's prompt (branch rules, `xticket` instructions, untrusted-input wrapping), plus a
     "Local run" section (you run unattended in `<worktree>` on `<branch>`; nobody answers until you
     finish; stay in this folder; commit your work on the branch before you finish; never push or switch
     branches), plus `notes_md` ("Notes since your last run"), plus a continuation note when this run
     resumes earlier work. Written to the run's folder and passed on stdin where the CLI accepts it.
   - **Environment**: `XTICKET_URL` (this server), `XTICKET_PROJECT`, `XTICKET_TASK` (the run id),
     `XTICKET_TOKEN` (when `AGENT_TOKEN` is set). An `xticket` launcher is put first on `PATH`.
   - **Process**: own process group; `pid` and its start time are recorded.
3. **Output.** Each stdout/stderr line goes through the CLI's parser into readable log lines in
   `task_logs` (assistant text; `→ Bash: npm test`; `→ Edit: src/a.ts`; the final summary). Lines
   longer than 2,000 characters are cut, and logging stops at 5,000 lines per run with a note. The raw
   output is also kept in `<workspace>/agent-runs/<run id>.log`.
4. **Exit.** Checked in this order:
   1. cancel requested → `cancelled`
   2. hold requested → `held`
   3. time limit reached → `timed_out`
   4. CLI reported a usage or rate limit → `rate_limited`
   5. exit code ≠ 0 → `failed`, error = the last 20 output lines
   6. exit code 0 and the branch has commits ahead of its base → `review`
   7. exit code 0, nothing committed → `no_changes` ("finished without committing anything")
   Uncommitted files left in the worktree are listed in the log ("not part of the review").

## Questions, notes, Retry, cancel

- **Question** (`xticket ask` → QuestionService → `holdTask`): the run becomes `held` at once, so the watcher
  never flips the task back to running. The agent was told to commit WIP and stop. If it is still running
  2 minutes later, it is stopped.
- **Answer / dependency released** (`releaseTask(id, context)`): the context is appended to `notes_md`,
  the run returns to `queued`, and the next start continues in the same worktree.
- **Notes** (`appendNote`: notes to agents, merge-conflict notes, answers): stored in `notes_md` and
  delivered at the run's next start. A headless CLI cannot read new input mid-run; the guide says so.
- **Retry / Request changes**: unchanged. `rerunTask` cancels the old run, and dispatch creates a new run
  that reuses the task's worktree, so the agent continues from the branch.
- **Cancel** (`cancelTask`): queued or held → `cancelled`. Running → SIGTERM to its process group, SIGKILL
  after 10 s, then `cancelled`. Already finished → no-op, so `stopEngineTask` treats it as stopped.
- **Time limit**: Settings, default 60 min. Same stop sequence; status `timed_out`, so Retry works.

## Rate limits

When the parser sees the CLI's usage or rate-limit message, the run ends as `rate_limited`, with
`resume_at` set as follows:
- the reset time named in the message;
- otherwise, the reset time from the provider's live quota, which `AiDraftService` already reads;
- otherwise, 15 minutes from now;
- in all cases, at most 24 h.

The CLI counts as paused while any of its runs is `rate_limited` with a future `resume_at`, so no other
run starts on it. This is derived from `local_runs`, so it survives restarts. At `resume_at` the runner re-queues the run
with a continuation note. The bridge's existing start-rate limits still apply at dispatch.

## Restarts

`npm run dev` uses `tsx watch`, which restarts the server on every server file change, and the desktop app
can quit while agents are running.
- **Clean shutdown** (SIGINT/SIGTERM): the runner stops its agents and marks their runs `queued` with a
  continuation note. This does not count as an interruption, so editing server code during `npm run dev`
  never fails a run.
- **Startup**: a run still marked `running` belongs to a crashed server. If its `pid` is alive with the
  recorded start time, it is ours, and its process group is stopped. Either way, the run is re-queued with
  `interruptions + 1`.
- **Limit**: after 3 crash recoveries, a run fails ("interrupted 3 times"; Retry starts again).

The runner never kills a process it cannot identify by `pid` plus start time.

## Worktree lifecycle

The worktree lives as long as the task:
- **Kept** across runs (questions, Retry, Request changes).
- **Removed** once the task is `done` or `cancelled`. Removal skips a dirty worktree and logs that once.
- **Before branch deletion**: the merge gate asks the runner to release a task's worktree before it
  deletes that task's merged branch, because git refuses to delete a checked-out branch.

## Existing Manual tasks

Changing a repository from **Manual** to **Local AI CLI** hands its `queued` Manual tasks to the local
engine:
- They are claimed back to `pending` with no engine id, and the existing dispatch path sends them again.
- Manual has nothing running, so this is safe.
- Tasks in other states are left alone.

REQ-008 (#8, #9) starts this way.

## Settings (Rule B) and API

New section `local_engine` (shared schema and type, `SettingsService` getter/updater, SQLite), shown on
**AI & Local Engines**. It uses Radix controls (Rule C).

| Setting | Default | Range / choices |
|---|---|---|
| `enabled` | on | when off, runs stay queued and the engine shows as down |
| `agentCli` | Use AI default | Use AI default, Claude Code, AGY, Codex |
| `maxParallel` | 2 | 1–8 |
| `runTimeoutMinutes` | 60 | 5–480 |
| `worktreeRoot` | empty (`<workspace>/agent-worktrees`) | absolute path |

The section also shows live status: the CLI that will run plus its `Installed on PC` / `Not Detected`
badge, `HEALTHY` / `PAUSED until …` per CLI, and counts of running, queued, held and rate-limited runs.

Routes:
- `GET` / `PUT /api/settings/local-engine`
- `GET /api/local-engine/status`

The runner reads Settings on every tick; nothing is hardcoded.

## Desktop (Rule A)

The runner lives inside the server, so it works in the Tauri sidecar too.
- Binaries are found through `findCliBinary`, which covers the short `PATH` of a GUI app.
- The `xticket` launcher must work from the bundled server: bundle the CLI next to it if needed. Verified
  with `npm run desktop:bundle-server`.
- Process groups are POSIX. Windows uses `taskkill /T`.

## Safety, stated plainly

The agent works in the task's worktree, but its commands run as the person's user account:
- **Codex**: write access is restricted to the worktree.
- **Claude Code and AGY**: the agent is told to stay in its folder. Nothing outside the worktree is
  physically blocked.

The Settings section and the guide say this.

## Testing

All runner and adapter tests use a fake CLI script, configured through the CLI's Settings custom path, with
real temporary git repositories. No real AI runs in tests. The fake can:
- print parser-format lines;
- commit, or exit with an error;
- print a usage-limit message;
- sleep;
- run `xticket ask`.

| Area | Checks |
|---|---|
| Lifecycle | fan-out → watcher → `queued` → `running` → `in_review`; `no_changes` → needs_human; non-zero exit → failed with the last lines |
| Limits | parallel limit (3 tasks, limit 2); time limit → failed |
| Questions and notes | hold during a run → held, then answer → re-run with the answer in the prompt; notes delivered at the next start |
| Retry and cancel | Retry reuses the worktree; cancel stops the process group |
| Rate limits | → rate_limited, the CLI is paused, then resumes |
| Restarts | clean-shutdown requeue without counting; crash recovery with pid/start-time check; failed after 3 crash recoveries |
| Manual hand-over | Manual → Local AI CLI hands over queued Manual tasks |
| Settings, routes, UI | settings validation and both routes; the Settings section and the engine picker |

## Docs

- Update `docs/guide`:
  - Repositories: the engine choice.
  - Settings guide: replace its unimplemented "headless dispatch" promise with the real section.
  - Agent Queue / Logs: what the agent output looks like; notes arrive at the next run.
- Add a "Run REQ-008 automatically" walkthrough.

## Verify while planning

- **Exact headless command line per installed version**:
  - Claude Code: `-p`, `--output-format stream-json --verbose`, `--permission-mode bypassPermissions`,
    `--model`, `--effort`.
  - AGY: `-p`, `--output-format stream-json`, `--dangerously-skip-permissions`, `--model`, `--effort`.
  - Codex: `exec --json --sandbox workspace-write -C <worktree>`.
- **Output and messages**: the event shapes the parsers read, and the rate-limit message formats.
- **Prompt input**: whether each CLI takes the prompt on stdin.
- **Desktop**: how the bundle ships `xticket`.

## Out of scope

- An OS-level sandbox.
- Falling back from one CLI to another.
- Changes to Stoneforge.
- Delivering notes into a run that is already going.
- Pushing branches or opening pull requests.
- A per-repository CLI choice (one Settings choice for the PC).
