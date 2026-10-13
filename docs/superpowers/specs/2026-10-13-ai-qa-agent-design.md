# AI QA agent — design

Status: design approved by the user in chat, section by section, 2026-10-13. Builds on the merge gate
(`services/mergeGate.ts`), review comments and Request changes (`services/reviewService.ts`), the Local AI CLI
runner (`localEngine/`), `xticket` and the per-task "Changed files" view (`services/taskChanges.ts`).

## Problem

When a requirement reaches **QA**, its task branches are merged and each project's test command has passed.
Checking the result is left to a person: do the acceptance criteria really hold, is the code sound, do the
build and lint pass, does the app work? Review comments and Request changes exist, but every comment is
written by hand.

## Decisions (user, 2026-10-13)

- **What the QA agent checks:** acceptance criteria, code review, tests / build / lint, and trying the app.
- **When:** automatically when a requirement enters QA (a Settings switch, on by default), and from a
  **Run AI QA** button.
- **After QA:** the **person decides**. Findings are open review comments marked **AI QA** with a severity;
  nothing is sent back to the agents automatically.
- **Approach A — one QA run per repository:** parallel runs on the merged code, in a temporary read-only
  checkout, each reporting findings onto that repository's card. Rejected: one run for all repositories
  (slow, all-or-nothing); QA through each repository's own engine (Manual / Stoneforge cannot run commands).
- **Two phases:** phase 1 = criteria, code review, tests / build / lint; phase 2 = trying the app.

## What the person sees

- **Entering QA** (after a successful merge): when **Run automatically** is on, a QA run starts for each
  repository. The requirement header shows `AI QA running… (backend ✓, frontend …)`, then
  `AI QA: 3 findings (1 blocker)` or `AI QA passed`, or `AI QA failed: <reason>` for a run that could not
  finish.
- **Run AI QA** (header, while the requirement is in QA): starts the QA runs again, e.g. after fixes were
  merged. Disabled while QA runs are going.
- **Findings** are open review comments on the repository's card, badged **AI QA · blocker / major / minor**,
  with the file and line when the agent named them. They are edited, resolved, deleted and sent with
  **Request changes** like any comment.
- **Logs:** each QA run has its own log (what it ran and its output), opened from the header status.

## Runs and data

- **QA task:** one `bridge_tasks` row per repository with `role = 'qa'`, `branch = NULL`,
  `base_sha` = the commit to check (see below), `status` following its run (`queued` → `running` →
  `done` / `failed` / `cancelled`). QA tasks carry logs and runs; they are excluded from Kanban counts,
  derived requirement status, the merge gate, Request changes, the review cards and the fan-out graph
  (like `question` rows).
- **The commit to check:**
  - On entering QA, the merge gate records each repository's merged result (`resultSha`, today used only to
    fast-forward the base branch) and creates the QA tasks with it.
  - **Run AI QA** later uses the current tip of the branch the requirement merged into
    (`BranchService.baseBranchFor`: the target branch, else the repository's base branch).
- **QA runs** go through the Local AI CLI runner (`AgentRunner`), with these differences for `role = 'qa'`:
  - allowed for any project whose repository is a git work tree (not only `engine_type = 'local'`);
  - the checkout is a temporary **detached** worktree at `base_sha` (`addDetachedWorktree`), removed when
    the run finishes (`removeWorktree`); anything the agent changes there never reaches a branch;
  - its own prompt (below) without the "commit your work" rules;
  - its own finish: exit 0 → `done` (with the summary from `qa-result`, or "finished without a result");
    a non-zero exit, a spawn error or the time limit → `failed` with the reason; nothing is checked for
    commits;
  - the time limit is Settings → AI QA → time limit, not the engine's run limit;
  - it shares **Max parallel runs** and the usage-limit pauses with agent runs.
- **Review comments** gain `source TEXT NOT NULL DEFAULT 'person'` (`'person' | 'ai-qa'`) and
  `severity TEXT` (`'blocker' | 'major' | 'minor'`, NULL for people's comments), through a new numbered
  migration (the next free number when this is built; the AI Chat MCP plan also adds one).
- The same migration adds `bridge_tasks.qa_passed INTEGER` and `bridge_tasks.qa_summary TEXT` (a QA task's
  result from `qa-result`).
- `ReviewComment` (shared) gains `source` and `severity`; `BridgeTask` gains `qa_passed` and `qa_summary`.

## The agent's job

**QA prompt** (`localEngine/qaPrompt.ts`, `buildQaPrompt`):

1. The requirement (title and text, as untrusted input) with its acceptance criteria numbered.
2. What changed in this repository: the changed files (from `TaskChangesService` for the requirement's
   tasks in this project) and the commit range to inspect with `git log` / `git diff`.
3. The repository's own rules: `CLAUDE.md` / `AGENTS.md` are in the checkout; read and follow them.
4. The checks, in order:
   1. For each acceptance criterion: is it met by the code? Report gaps.
   2. Review the changed files: bugs, missing error handling and edge cases, security problems, and
      breaches of the repository's rules.
   3. Run the project's **Test command**, **Build command** and **Lint command** (each only when set);
      report each failure with the key lines of its output.
   4. *(phase 2)* Start the app with **Start command**, open **App URL**, exercise the changed flows.
5. Rules: do not commit, push, switch branches or fix anything; one finding per problem; severity
   **blocker** (a criterion is not met, tests or build fail, data loss, security), **major** (a real bug or
   a likely failure), **minor** (quality, naming, small gaps).
6. Reporting (below), and finish with `xticket qa-result`.

## Reporting through `xticket`

- `xticket comment --severity blocker|major|minor [--file <path> [--line <n>]] --title "<one line>"
  [--body "<details>" | --body-file <path>]` → `POST /api/agent/qa/comments`
  `{ severity, file_path?, line?, title, body?, project, engineTaskId }`.
- `xticket qa-result (--passed | --failed) --summary "<text>"` → `POST /api/agent/qa/result`
  `{ passed, summary, project, engineTaskId }`.
- Both use the agent token (`requireAgentToken`), `XTICKET_PROJECT` and `XTICKET_TASK` like `xticket ask`, and
  the same outbox fallback when the bridge cannot be reached.

**Server** (`services/qaService.ts`):

- `engineTaskId` + `project` → the QA task (`role = 'qa'`). Unknown → 404 "No QA run …".
- The requirement must still be in **QA**; otherwise 409 "<REQ> is no longer in QA; this finding was not
  saved".
- A finding becomes an **open** review comment with `source = 'ai-qa'` and its severity, on the
  repository's goal task of the requirement (else its first ticket); the comment text is
  `**<title>**\n\n<body>`; a file path is checked like people's comments (relative, no `..`).
- The same finding (same QA task, file, line and normalized title) is saved once.
- At most **Maximum findings per QA run** (Settings) per QA task; beyond it → 409 "The QA run reached its
  limit of N findings".
- `qa-result` stores `passed` and the summary on the QA task (`qa_passed`, `qa_summary`); `last_error` keeps
  a run's failure reason.

## Settings

- **Settings → AI & Local Engines → AI QA** card (Rule B; `AiQaSettingsSchema` in `schemas.ts`, `AiQaSettings`
  in `types.ts`, saved by `SettingsService` under `ai_qa_settings`):
  - **Run automatically when a requirement enters QA** (default on);
  - **CLI**, **model**, **effort** for QA runs (default: the Local AI CLI engine's choice);
  - **Time limit per QA run** (default 30 minutes);
  - **Maximum findings per QA run** (default 30).
- **Projects form:** **Build command** and **Lint command** (optional, next to **Test command**;
  `Project.build_command`, `Project.lint_command`). Phase 2 adds **Start command** and **App URL**.

## Lifecycle and errors

| Situation | Behaviour |
|---|---|
| No usable AI CLI | The QA task fails: "No AI CLI can run QA: …" (the engine's own wording) |
| Repository is not a git work tree | No QA task for it; the header notes "skipped <project>: not a git repository" |
| Merged commit unknown (Run AI QA) | Uses the tip of the target / base branch; if missing, the QA task fails with the reason |
| Agent exits non-zero / times out | `failed` with the reason; the log stays |
| Agent finishes without `qa-result` | `done` with "finished without a result" |
| Requirement leaves QA (Request changes, done, cancelled) while QA runs | Its QA runs are cancelled; late findings get 409 |
| Run AI QA while QA runs are going | Refused: "AI QA is already running for <REQ>" |

## Web

- Requirement header (side panel and full page), in QA: the AI QA status line and **Run AI QA**
  (`POST /api/requirements/:id/qa`).
- Review comments: an **AI QA · <severity>** badge on `source = 'ai-qa'` comments; severity colours.
- The QA log opens in the existing task log drawer (the QA task id).
- Settings card and the two Projects form fields.

## Testing

- **Runner:** a QA run checks out `base_sha` detached, never touches a branch, ends `done` without commits,
  removes its checkout; failure and timeout paths; QA runs for a non-local project.
- **Merge gate:** on success it records each repository's merged commit and, with the switch on, creates the
  QA tasks (none with the switch off).
- **QA service and routes:** comment mapping to the goal card, severity and source, safe paths, duplicates,
  the findings cap, 409 outside QA, `qa-result`; cancel when the requirement leaves QA; Run AI QA refused
  while running.
- **xticket:** argument parsing for `comment` and `qa-result`; outbox fallback.
- **Fake agent CLI:** new `FAKE: qa-comment …` and `FAKE: qa-result …` lines that call `xticket`, for an
  end-to-end QA run.
- **Web:** helpers for the status line and badges; Settings and forms via typecheck and build.

## Phases

- **Phase 1 (first plan):** everything above except trying the app.
- **Phase 2:** trying the app — Projects **Start command** and **App URL**, starting and stopping the app
  inside the QA run's checkout, prompt step 4, and optionally a browser MCP server from the AI Chat settings.

## Docs

- `06-review-qa-and-merge.md`: AI QA in the QA section (what runs, findings, Run AI QA).
- `09-settings-and-environment.md`: the AI QA card; `02-projects-and-engines.md`: Build / Lint command.
- `10-troubleshooting.md`: the messages above.
- `xticket` help text and the agent prompt rules for `comment` / `qa-result`.

## Out of scope

- Sending findings back automatically (the person decides).
- QA across repositories in one run (each repository is checked on its own).
- QA before the merge (in review); QA of Manual-only folders that are not git repositories.
