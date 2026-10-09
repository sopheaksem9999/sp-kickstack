# Design: Branch per Task and Local Merge Gate (v1)

Status: approved in chat on 2026-10-09 (spec/plan review gates waived by the operator: "can implement now").
Builds on: `2026-10-09-ticket-merge-policy-attachments-hub-design.md` (effective policy = requirement override, else workspace default).

## Problem

All engine agents are told to commit directly to the base branch (`develop`). Work from different
requirements interleaves on one branch, nothing isolates a task, the bridge never merges anything,
and the existing "merge policy" setting only changes one sentence of the agent prompt.

## Goal

Every bridge task (goal or cross-repo ticket) is implemented on its own branch. When a requirement
moves **In Review → QA**, the bridge merges that requirement's branches into each project's base
branch, all-or-nothing, after the project's tests pass, and pushes. The merge policy setting decides
whether a person triggers that move ("Review first") or the bridge does it as soon as all work is in
review ("Auto-merge").

Out of scope for v1: PR mode (GitHub API), rollback (`git revert -m 1 <merge_sha>` uses the data this
records), develop → main releases.

## Decisions

| Topic | Decision |
|---|---|
| Branch owner | The bridge creates the branch; the agent works on it. |
| Branch name | `req/<REQ-ID>/task-<task id>` (e.g. `req/REQ-012/task-34`). |
| Branch start | Project `base_branch` (else global `default_base_branch`); if the local ref is missing, `origin/<base>`. Created with `git branch <name> <start>` in `repo_path` — no checkout. Idempotent. |
| When | Name decided when the task row is reserved (so the prompt can name it); branch created at dispatch, before the engine call. Creation failure = dispatch failure (retried with backoff). |
| Non-git projects | `repo_path` not a git work tree → no branch, legacy prompt, ignored by the merge gate. |
| Dependencies in branch mode | A dependency task reaching `in_review` resolves its links (the work is complete on its branch); the upstream context names the branch. Otherwise a held source could never reach In Review and QA could never be reached. |
| Merge trigger | Manual: moving the requirement to QA (Kanban, status select, "Merge & move to QA" button). Auto: when the effective policy is `auto_merge` and the requirement's derived status becomes `in_review`. |
| Preconditions | Requirement is `in_review`; every non-cancelled goal/ticket is `in_review` or `done`; at least one has a branch without `merge_sha`; no gate already running for it (`merge_state` `idle` or `failed` → retry allowed). Otherwise 409 with the reason. |
| Execution | Background; the API answers 202. `requirements.merge_state` = `idle` / `running` / `failed`, `merge_error` text. SSE: `merge_started`, `merge_succeeded`, `merge_failed`. A `running` state left by a crash becomes `failed` ("Interrupted by restart") at startup. |
| Phase 1 (prepare) | Per project with unmerged branched tasks: if remote `origin` exists, `git fetch origin <base>` and start from `origin/<base>`, else local `<base>`. Temporary detached worktree at the start commit. Merge each task branch `--no-ff` (dependencies first, then task id), merge commits authored "SP-Kickstack Bridge". Branch with no new commits → skipped. Conflict → abort, fail with branch + conflicting files, add a rebase note to that task in its engine. Then run the project's `test_command` (if set) via `/bin/sh -c` in the worktree (timeout 15 min); non-zero → fail with the last 50 output lines. Local-only repos (no origin) must not have the base branch checked out with uncommitted changes — checked here so nothing advances. |
| Phase 2 (advance) | Only if every project passed phase 1. Per project: push `<result>:refs/heads/<base>` to origin (never force); then fast-forward the local base (update-ref with old-value check if not checked out; `merge --ff-only` in the checkout if clean; dirty checkout → warning only, origin already has it). Record `merge_sha`/`merged_at` per task, mark tasks `done` through the TaskReactor, note "Merged into <base> at <sha>" on each engine task, delete merged task branches locally when `auto_delete_branch` is on. Then requirement → `qa`, `merge_state` → `idle`. |
| Partial failure | A push rejected after another project advanced: requirement stays `in_review`, `merge_failed` names the projects already merged. Retry merges only tasks without `merge_sha`. |
| Concurrency | One gate per requirement (CAS on `merge_state`); gates touching the same `repo_path` are serialized in-process. |
| Setting | `merge_policy`: `manual_review_merge` ("Review first", default) or `auto_merge` ("Auto-merge, no review"). `auto_merge_main` is accepted as an alias and migrated. |
| Confirm merged | For requirements with branched, unmerged tasks, `merge-to-main` / "Confirm merged" is refused (409) and hidden; the gate is the way to QA. |
| Project setting | New optional `test_command` (e.g. `npm ci && npm test`); runs in a fresh worktree, so it must install what it needs. |
| Data | Migration 3: `bridge_tasks.branch, base_sha, merge_sha, merged_at`; `requirements.merge_state (default 'idle'), merge_error`; `projects.test_command`; policy value rename. |

## Components

- `lib/gitRepo.ts` — small git operations on top of `safeExec` (argv only): repo detection, refs, branch creation, fetch, worktrees, merge with conflict listing, push, fast-forward of a possibly checked-out branch.
- `services/branchService.ts` — branch naming, prompt instructions, `ensureTaskBranch` at dispatch.
- `services/mergeGate.ts` — `MergeGateService`: preconditions, background run, phase 1/2, state, events.
- Changes: `FanOutService` / `TicketService` (reserve with branch name, ensure branch at dispatch), `TaskReactor` (in_review resolves branched dependencies; in-review hook for auto-merge), `LinkService.formatUpstreamContext` (branch), `RequirementService.confirmMerged` (guard), routes (`PUT status` → gate for QA, `POST /requirements/:id/merge-to-qa`), `index.ts` (wiring, startup reset), web (settings labels, project test command, requirement merge button/state, task branch display, toasts).

## Testing

Real temporary git repos with a bare `origin`: clean merge + push + local fast-forward; conflict leaves base and origin unchanged and notes the task; failing tests leave everything unchanged; two projects where one fails → neither base moves; dirty checked-out base with origin → origin advances + warning; dirty checked-out base without origin → refused in phase 1; retry after partial push merges only the rest; auto policy starts the gate when the last task reaches in_review; branch created at dispatch from base and named in the prompt; non-git projects untouched; in_review ticket releases a held source in branch mode.
