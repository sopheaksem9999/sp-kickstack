# Branch per Task and Local Merge Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every goal/ticket runs on its own bridge-created branch, and moving a requirement In Review → QA (manually, or automatically under the `auto_merge` policy) merges those branches into each project's base branch all-or-nothing, after tests, and pushes.

**Architecture:** `lib/gitRepo.ts` wraps the git operations (argv only). `services/branchService.ts` names/creates task branches and writes the prompt instructions. `services/mergeGate.ts` runs a two-phase merge (prepare in temporary worktrees, then advance + push) in the background, tracked by `requirements.merge_state`. Existing services get small hooks (reserve with branch name, ensure branch at dispatch, in_review resolves branched dependencies, auto-merge hook).

**Tech Stack:** Node 22.19.0, TypeScript, Express 4, better-sqlite3, git CLI via `execFileSync`, Vitest, React/TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-09-branch-merge-gate-design.md`

## Global Constraints

- Run everything with `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`; `npm run verify` must pass before every commit.
- Shared package changes need `npm run --workspace=@sp-kickstack/shared build` before server tests (server imports `dist/`).
- git only through argv (`execFileSync('git', [...])`), never a shell. The only shell use is the operator-configured `test_command` (`/bin/sh -c`).
- Never force-push; never touch the operator's checkout unless a fast-forward on a clean tree.
- Branch name format exactly `req/<REQ-ID>/task-<id>`.
- Merge commits authored `SP-Kickstack Bridge <bridge@sp-kickstack.local>`.
- One commit per task, message `feat(<scope>): <summary>` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Base branch checked out in the operator's repo with uncommitted changes — the operator's files must never change; with origin, origin advances and a warning is shown; without origin, the gate refuses in phase 1.
2. origin moved between fetch and push — push rejected without force; nothing for that project advances; earlier projects are reported as merged and a retry merges only the rest.
3. Agent never committed on its branch (or the branch was deleted) — empty branch is skipped (marked handled); a missing branch fails the gate with its name.
4. Server restart while a gate is running — `merge_state` must not stay `running` forever; temp worktrees must not block later gates.
5. Two requirements merging into the same repo at once — serialized; the second sees the first's result.

---

### Task 1: Data model, shared types, policy rename

**Files:**
- Modify: `packages/server/src/db/migrations.ts` (add migration 3)
- Modify: `packages/shared/src/schemas.ts`, `packages/shared/src/types.ts`
- Modify: `packages/server/src/services/projectService.ts` (persist `test_command`)
- Test: `packages/server/src/db/migrations.test.ts`, `packages/shared/src/schemas.test.ts`

**Interfaces — Produces:**
- Columns: `bridge_tasks.branch, base_sha, merge_sha, merged_at` (TEXT NULL); `requirements.merge_state TEXT NOT NULL DEFAULT 'idle'`, `requirements.merge_error TEXT`; `projects.test_command TEXT`.
- `BranchMergePolicy = 'manual_review_merge' | 'auto_merge'`; `BranchMergePolicySchema` accepts `'auto_merge_main'` and outputs `'auto_merge'`.
- `export function normalizeMergePolicy(v: unknown): 'manual_review_merge' | 'auto_merge'` in shared schemas.
- Types: `BridgeTask.branch?/base_sha?/merge_sha?/merged_at?: string | null`, `Requirement.merge_state: 'idle' | 'running' | 'failed'`, `Requirement.merge_error?: string | null`, `Project.test_command?: string | null`; `EventType` += `'merge_started' | 'merge_succeeded' | 'merge_failed'`.

- [ ] **Step 1: Failing tests**
  - migrations.test: fresh DB has the new columns and `user_version` = 3; a v2 DB with settings `merge_policy: 'auto_merge_main'` and a requirement with `merge_policy = 'auto_merge_main'` migrates both to `'auto_merge'`.
  - schemas.test: `BranchMergePolicySchema.parse('auto_merge_main') === 'auto_merge'`; `ProjectSchema.parse({..., test_command: 'npm test'}).test_command === 'npm test'`.
  - projectService (in migrations.test or a small new test): `registerProject({..., test_command: 'npm test'})` then `getProject().test_command === 'npm test'`; `updateProject(name, { test_command: null })` clears it.
- [ ] **Step 2: Run, expect FAIL** (`npx vitest run packages/server/src/db packages/shared`).
- [ ] **Step 3: Implement**
  - Migration 3 (idempotent `addColumn` calls) + `UPDATE requirements SET merge_policy='auto_merge' WHERE merge_policy='auto_merge_main'` + rewrite the `branch_merge_settings` JSON value.
  - `BranchMergePolicySchema = z.preprocess(normalizeAlias, z.enum(['manual_review_merge','auto_merge']))`.
  - `ProjectSchema.test_command: z.string().max(2000).optional().nullable()`; add `test_command` to `registerProject` INSERT/UPSERT and `updateProject` UPDATE (`validated.test_command || null`).
  - Replace `'auto_merge_main'` usages in server (`fanOutService.formatGoalBody`, `aiChatService.compileWorkspaceContext`) with `normalizeMergePolicy(x) === 'auto_merge'`.
- [ ] **Step 4: Rebuild shared, run, expect PASS; `npm run verify`.**
- [ ] **Step 5: Commit** `feat(server,shared): migration 3 for task branches, merge state, project test command; auto_merge policy`.

### Task 2: git helpers (`lib/gitRepo.ts`)

**Files:** Create `packages/server/src/lib/gitRepo.ts`, `packages/server/src/testing/gitFixture.ts`; Test `packages/server/src/lib/gitRepo.test.ts`.

**Interfaces — Produces** (all synchronous unless noted; `repo` is a path):

```ts
export const BRIDGE_GIT_ENV: Record<string, string>; // author/committer = SP-Kickstack Bridge
export function runGit(repo: string, args: string[], env?: Record<string, string>): string; // throws Error(stderr || message)
export function isGitWorkTree(path: string): boolean;
export function resolveCommit(repo: string, ref: string): string | null;
export function hasRemote(repo: string, remote?: string): boolean; // default 'origin'
export function fetchBranch(repo: string, branch: string, remote?: string): void; // +refs/heads/b:refs/remotes/origin/b
export function createBranch(repo: string, name: string, startSha: string): void; // no-op if it exists
export function addDetachedWorktree(repo: string, path: string, sha: string): void;
export function removeWorktree(repo: string, path: string): void; // best effort + prune
export function commitsAhead(repo: string, from: string, to: string): number;
export function mergeNoFf(worktree: string, branch: string, message: string):
  { ok: true; sha: string } | { ok: false; conflicts: string[]; error: string };
export function pushCommit(repo: string, sha: string, branch: string, remote?: string): void; // never force
export function isAncestor(repo: string, ancestor: string, descendant: string): boolean;
export function checkoutPathOf(repo: string, branch: string): string | null; // from `git worktree list --porcelain`
export function isClean(path: string): boolean;
export function fastForwardBranch(repo: string, branch: string, sha: string): { advanced: boolean; warning?: string };
export function deleteMergedBranch(repo: string, branch: string): void; // git branch -d, best effort
export async function runShell(cwd: string, command: string, timeoutMs: number): Promise<{ code: number; output: string }>;
```

`gitFixture.ts` (test-only helper, not a `.test.ts`):

```ts
export function makeRepo(root: string, opts?: { withOrigin?: boolean; base?: string }): { repo: string; origin?: string };
export function commitOnBranch(repo: string, branch: string, file: string, content: string, message?: string): string; // returns sha
export function headOf(repo: string, ref: string): string;
```

- [ ] **Step 1: Failing tests** (real repos under `packages/server/.temp/sp-test-gitrepo`):
  - `createBranch` creates from a sha without changing `HEAD` of the checkout; second call is a no-op.
  - `mergeNoFf` clean → merge commit with 2 parents authored by the bridge; conflict → `{ ok:false, conflicts:['a.txt'] }` and the worktree is clean afterwards (`git status --porcelain` empty).
  - `fastForwardBranch`: not checked out → ref moves; checked out + clean → working tree updated; checked out + dirty → `{advanced:false, warning}` and the dirty file is untouched; local commits not in target → `{advanced:false, warning}`.
  - `pushCommit` to a bare origin advances `origin/<base>`; a non-fast-forward push throws and origin is unchanged.
  - `runShell('exit 3')` → code 3; output captured; timeout → non-zero.
- [ ] **Step 2: Run, expect FAIL (module missing / assertions).**
- [ ] **Step 3: Implement** (`execFileSync('git', args, { cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'], env:{...process.env, ...env}, maxBuffer: 32MB })`; on error throw `new Error((err.stderr || err.message).trim())`; `runShell` = promisified `execFile('/bin/sh', ['-c', command], { cwd, timeout, maxBuffer: 16MB })`, code from `err.code` (number) or 1, output = stdout+stderr).
- [ ] **Step 4: PASS; verify.**
- [ ] **Step 5: Commit** `feat(server): git helpers for task branches and merges`.

### Task 3: Branch per task (reserve name, prompt, create at dispatch)

**Files:** Create `packages/server/src/services/branchService.ts`; Modify `fanOutService.ts`, `ticketService.ts`; Test `packages/server/src/services/branchMerge.test.ts` (new, shared harness with Tasks 4–6).

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces:
```ts
export function taskBranchName(reqId: string, taskId: number): string; // `req/${reqId}/task-${taskId}`
export function branchInstructions(branch: string, base: string, policy: 'manual_review_merge' | 'auto_merge'): string;
export class BranchService {
  constructor(db: AppDatabase, projectService: ProjectService, settingsService?: SettingsService);
  baseBranchFor(project: Project): string;
  usesBranches(project: Project): boolean;          // isGitWorkTree(repo_path)
  ensureTaskBranch(taskId: number): { branch: string; baseSha: string } | null; // throws if base missing
}
```
- `FanOutService` / `TicketService` constructors gain an optional last param `branches?: BranchService` (default `new BranchService(db, projectService)`).
- `formatGoalBody(..., branch?: string)` and `formatTicketBody(sourceProject, reqId, input, branch?: { name: string; base: string })`.

- [ ] **Step 1: Failing tests** (git fixture repo registered as project `backend`, FakeEngine adapters):
  - fan-out of a requirement on a git project: goal row has `branch = req/REQ-001/task-<id>`; the branch exists in the repo pointing at `develop`; `base_sha` recorded; the body sent to the engine contains the branch name and does not say "developed on the `develop` branch".
  - ticket to a git project: same (branch + prompt).
  - project whose repo_path is not a git repo: `branch` NULL, legacy prompt, dispatch still works.
  - base branch missing in the repo: goal ends `failed` with `last_error` naming the base branch.
  - re-dispatch (sweeper) reuses the existing branch (no error, same sha).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement**
  - Reservation (fan-out transaction / ticket reservation): when `branches.usesBranches(project)`, after the insert compute the name from the new id, re-render the body with it, `UPDATE bridge_tasks SET branch = ?, body_md = ?`.
  - `dispatchGoal` / `dispatchTicket`: first statement inside the engine-call `try`: `this.branches.ensureTaskBranch(taskId)` (a throw becomes a normal dispatch failure).
  - `branchInstructions`: "## Your branch\n- Work and commit only on `<branch>` (created from `<base>` by the bridge).\n- Do not commit to `<base>` and do not merge; the bridge merges your branch into `<base>` when the requirement moves to QA (<after a person reviews it | automatically once all work is in review and tests pass>).\n- Put `task-<id>` in any PR title or branch you push so the bridge can match it."
- [ ] **Step 4: PASS; verify** (existing fan-out/ticket tests use non-git temp dirs → legacy path unchanged).
- [ ] **Step 5: Commit** `feat(server): every goal and ticket runs on its own bridge-created branch`.

### Task 4: Branch-mode dependencies resolve at in_review

**Files:** Modify `services/taskReactor.ts`, `services/linkService.ts`; Test `branchMerge.test.ts`.

- [ ] **Step 1: Failing tests:** in branch mode a blocking ticket reaching `in_review` (watcher) releases the held source; the upstream context contains the ticket branch and "not merged yet"; in non-branch mode `in_review` does NOT release (unchanged behavior).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement:** in `onTaskStatusChanged`, `if ((newStatus === 'done' || (newStatus === 'in_review' && task.branch)) && this.linkService)` evaluate dependencies (`link_released` event as today). `formatUpstreamContext`: when the dependency has `branch` and no `merged_at`, replace the "now on <base>" sentence with "Its work is on branch `<branch>` (not merged yet; the bridge merges both at QA). Read the contract there: `git show <branch>:<contract_path>`."
- [ ] **Step 4: PASS; verify.**
- [ ] **Step 5: Commit** `feat(server): in branch mode a dependency resolves when its ticket is in review`.

### Task 5: Merge gate service

**Files:** Create `packages/server/src/services/mergeGate.ts`; Test `branchMerge.test.ts`.

**Interfaces — Produces:**
```ts
export type MergeOutcome =
  | { ok: true; projects: string[]; warnings: string[] }
  | { ok: false; error: string; mergedProjects: string[] };
export class MergeGateService {
  constructor(db, projectService, requirementService, reactor: TaskReactor,
              options?: { getAdapter?: AdapterFactory; settingsService?: SettingsService; testTimeoutMs?: number; tmpRoot?: string });
  needsMerge(reqId: string): boolean;                 // branched goal/ticket, not cancelled, merged_at IS NULL
  start(reqId: string, trigger: 'manual' | 'auto'): { done: Promise<MergeOutcome> }; // throws HttpError 404/409
  autoStart(reqId: string): void;                     // effective policy auto_merge && needsMerge → start, 409s ignored
  resetInterrupted(): number;                         // running → failed ('Interrupted by restart')
}
```

- [ ] **Step 1: Failing tests** (two git projects `backend` and `mobile`, both with bare origins unless noted; helper `readyForGate()` = fan-out, commit a file on each task branch, set tasks + requirement `in_review`):
  1. clean merge: `ok:true`; `origin/develop` and local `develop` contain both files; requirement `qa`, `merge_state` `idle`; tasks `done` with `merge_sha` (a 2-parent commit) and `merged_at`; engine notes contain "Merged into develop".
  2. conflict in `mobile`: `ok:false`, error names the branch and file; `develop` and `origin/develop` unchanged in BOTH projects; requirement `in_review`, `merge_state` `failed`; the conflicting task has a rebase note.
  3. `test_command: 'exit 7'` on backend: nothing advances; error contains "exit 7"-style code and output tail.
  4. dirty checkout with origin: backend checkout has `develop` checked out with an uncommitted file → `ok:true`, origin advanced, warning mentions the path, the dirty file still dirty.
  5. dirty checkout without origin → `ok:false` before anything advances.
  6. partial push: make `mobile` origin reject (push a different commit to mobile origin first) → `ok:false`, `mergedProjects:['backend']`; backend tasks have `merge_sha`; after fixing mobile origin, a second `start` merges only mobile.
  7. preconditions: a task still `running` → 409; requirement not `in_review` → 409; second `start` while running → 409.
  8. empty branch (no commits) is skipped and marked `merged_at` with null `merge_sha`; gate still succeeds.
  9. `resetInterrupted()` turns `running` into `failed`.
  10. two requirements on the same repo started together: both succeed, `develop` contains both requirements' merges (serialized by the repo lock).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** (structure):
  - `start`: validate (404/409s), CAS `UPDATE requirements SET merge_state='running', merge_error=NULL WHERE id=? AND merge_state IN ('idle','failed')`, record `merge_started`, return `{ done: this.run(...) }` (never rejects: errors become `ok:false`).
  - `run`: collect tasks needing merge grouped by project; order dependencies first (links among them), then id; take in-process locks for all repos (sorted); phase 1 `prepare` per project; phase 2 `advance` per project; `finally` remove all temp worktrees.
  - `prepare`: base = `branches.baseBranchFor(project)`; remote = `hasRemote`; if remote `fetchBranch` and start from `origin/<base>` (fallback local); if no remote and `checkoutPathOf(base)` is dirty → fail; temp worktree under `options.tmpRoot ?? os.tmpdir()`; for each task: branch missing → fail; `commitsAhead(start, branch) === 0` → skipped; `mergeNoFf` (message `Merge <REQ> task-<id>: <title>`) → conflict fail (with note); then `test_command` via `runShell` (fail with exit code + last 50 lines).
  - `advance`: if remote `pushCommit(result, base)` (failure → partial error listing already-advanced projects); `fastForwardBranch` (collect warning); record `merge_sha`/`merged_at`; `auto_delete_branch` → `deleteMergedBranch`.
  - success: requirement `qa` (via `updateStatus`), `merge_state` `idle`; tasks → `done` through `reactor.onTaskStatusChanged(task, old, 'done', 'manual')`; notes; `merge_succeeded` event with warnings.
  - failure: `merge_state` `failed`, `merge_error`; `merge_failed` event `{ error, mergedProjects }`.
- [ ] **Step 4: PASS; verify.**
- [ ] **Step 5: Commit** `feat(server): merge gate merges a requirement's branches all-or-nothing, tests, pushes`.

### Task 6: API, triggers, wiring

**Files:** Modify `api/app.ts`, `services/requirementService.ts`, `services/taskReactor.ts`, `index.ts`; Test `branchMerge.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `PUT /requirements/:id/status {qa}` on a requirement needing merge → 202, body `merge_state: 'running'`; after `done` it is `qa`.
  - `POST /requirements/:id/merge-to-qa` → 202; 409 with the reason when tasks still run.
  - `requirementService.updateRequirementStatus(id, 'qa')` directly while branches are unmerged → 409 (no bypass); `confirmMerged` → 409 "Merge & move to QA".
  - auto policy (`merge_policy: 'auto_merge'` on the requirement): when the watcher moves the last task to `in_review`, the gate starts and the requirement ends `qa`; with `manual_review_merge` it stays `in_review`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement:** `AppDependencies.mergeGate?`; default built in `createApp` (with the default reactor); routes as above (`done.catch(() => {})`); `TaskReactor.setHooks({ onRequirementInReview })` called when the derived status becomes `in_review`; `index.ts`: build `BranchService`, pass to fan-out/ticket services, build `MergeGateService` with `getAdapter`, `reactor.setHooks({ onRequirementInReview: (id) => mergeGate.autoStart(id) })`, `mergeGate.resetInterrupted()` at startup, pass `mergeGate` to `createApp`.
- [ ] **Step 4: PASS; verify.**
- [ ] **Step 5: Commit** `feat(server): QA move, merge-to-qa endpoint and auto-merge policy drive the merge gate`.

### Task 7: Web UI

**Files:** Modify `packages/web/src/lib/api.ts`, `pages/SettingsPage.tsx`, `pages/ProjectsPage.tsx`, `components/CreateRequirementSheet.tsx`, `pages/RequirementDetailPage.tsx`, `components/RequirementDetailSheet.tsx`, `pages/RequirementsPage.tsx`, `lib/useEvents.ts`, `lib/mergeReady.ts`; Test `packages/web/src/lib/mergeReady.test.ts`.

- [ ] **Step 1: Failing tests** (pure helpers in `lib/mergeReady.ts`): `mergeGateAction(req, tasks)` returns `'merge'` when status `in_review`, branched unmerged tasks exist and all are in_review/done; `'merging'` when `merge_state` is `running`; `'confirm'` for the legacy (no branches) path; `null` otherwise. `policyLabel('auto_merge')` = "Auto-merge (no review)", `policyLabel('manual_review_merge')` = "Review first".
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement:** `startMergeToQa(id)` in api.ts; policy option values/labels `auto_merge` in Settings, create sheet, detail page/sheet; Projects page "Test command" input (create + edit); requirement page/sheet: "Merge & move to QA" button (action `merge`), "Merging…" badge (`merging`), merge error banner when `merge_state === 'failed'`, task cards show `branch` and short `merge_sha`; legacy "Confirm merged" only for action `confirm`; Kanban drag toast says "Merging … moves to QA when the merge succeeds" when the response has `merge_state: 'running'`; `useEvents` toasts for `merge_succeeded` / `merge_failed`.
- [ ] **Step 4: PASS; verify (includes web typecheck).**
- [ ] **Step 5: Commit** `feat(web): merge gate controls, branch info, auto-merge policy labels, project test command`.

---

## Self-review

- Spec coverage: branch owner/name/start/timing/non-git (T3), dependency rule (T4), trigger/preconditions/background/phases/partial/concurrency (T5, T6), setting rename (T1, T7), confirm-merged guard (T6), test command (T1, T5, T7), data (T1), startup reset (T5, T6). No gaps.
- Placeholders: none. Types: `merged_at` marks handled tasks (null `merge_sha` = nothing to merge) — used consistently in T5/T6.
- Review Focus items 1–5 map to T5 tests 4/5, 6, 8, 9 and 10.
