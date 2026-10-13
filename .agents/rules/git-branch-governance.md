# Git Branch Governance Rule

## Standard
Requirement work reaches git only through the bridge's branch module,
`packages/server/src/services/branchService.ts` (`BranchService`). Every change to fan-out, tickets,
the merge gate, the Local AI CLI engine or anything else that touches task branches **MUST** follow
this rule.

---

## 1. Task branch names
- Name task branches only with `BranchService.nameTaskBranch(project, reqId, taskId, role)`. Never
  build `REQ-…` or `req/…` names by hand.
- Names come from Settings → Git & Branch Rules → **Task branch name**: `task_branch_pattern`, default
  `{req}`. The tokens are `{req}` (`REQ-008`), `{task}` (task number) and `{project}` (folder-safe
  repository name).
- A ticket is named with the pattern plus `-ticket-{task}`.
- A name that is taken gets `-2`, `-3`, …. "Taken" means it exists as a local branch, as
  `origin/<name>`, as another task's branch, or as a branch living under `<name>/`.
- Never rename an existing task branch: tasks keep the name recorded in `bridge_tasks.branch`. Older
  tasks keep `req/<REQ-ID>/task-<id>`.

## 2. Base and target branch
- Read where a task starts and merges with `BranchService.baseBranchFor(project, reqId)`. It returns
  the requirement's **target branch**, else the repository's base branch. Do not read
  `project.base_branch` directly for task or merge work.
- A missing target branch is created by `ensureTaskBranch`, from the repository's own base branch,
  and records a `target_branch_created` event.
- Target branch names are validated with `branchNameProblem` (`@sp-kickstack/shared`). A target branch
  must not be a task branch, and it is locked once the requirement has been fanned out
  (`RequirementService.updateRunSettings`).

## 3. Pushing
- Only the bridge pushes, through the `BranchService` push queue (`pushCommit`). Pushes are never
  forced and never block fan-out or a run's result.
- Every push is reported in the task's Logs: `↑ Pushed <branch> to origin` or
  `Could not push <branch> to origin: <reason>`.
- Pushing honours Settings → **Push branches to origin** (`push_branches`) and skips repositories
  without `origin`.
- Agents never push. Their prompt says so; do not remove that line.

## 4. Merging
- Only the merge gate (`services/mergeGate.ts`) merges task branches into the base or target branch.
- It frees a Local AI CLI task worktree (`releaseWorktree`) before deleting a merged branch.

## 5. Settings (Rule B)
- New branch behaviours (naming, pushing, merging) go to Settings → **Git & Branch Rules**: the
  `BranchMergeSettingsSchema` / `BranchMergeSettings` fields, saved by `SettingsService`, and read on
  use. Nothing is hardcoded.

## 6. Tests
- Test git behaviour against real repositories with `testing/gitFixture.ts` (a bare `origin` where
  pushing matters), in `services/branchMerge.test.ts`.
- `makeGitHarness()` turns pushing off; pass `{ push: true }` to test pushes, and
  `await pushesSettled()` before asserting on `origin`.

## Checklist
- [ ] New task branches are named by `nameTaskBranch`; existing names untouched.
- [ ] Base/target reads go through `baseBranchFor(project, reqId)`.
- [ ] No force push; push failures are logged, not thrown; agents do not push.
- [ ] New branch settings are in the Git & Branch Rules tab and the shared schema.
- [ ] Real-git tests cover the change.
