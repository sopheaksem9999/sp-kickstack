# Requirement run settings — design

Status: design approved by the user in chat ("look good"), 2026-10-13. Task branch names (`REQ-008`) and
pushing branches to `origin` added at the user's request the same day. Builds on the Local AI CLI engine
(2026-10-13), agent model/effort per requirement (2026-10-12) and the branch merge gate (2026-10-09).

## Problem

A person cannot shape how one requirement runs.

- **CLI:** the AI CLI is chosen once for the PC (Settings), but some work needs a different CLI, model or
  effort. Model and effort per requirement exist; the CLI does not.
- **Target branch:** every task branches from, and merges into, its repository's base branch (`develop`).
  A feature meant for another branch or the next release (`release/1.3`) cannot say so.
- **Kanban:** dragging a card that has not started to **In Progress** only changes its status; no fan-out
  happens, so the board shows work in progress while nothing runs. There is no moment to review the
  settings before agents start.

## Decisions (user, 2026-10-13)

- **CLI, model and effort** per requirement. CLIs have their own model names, so they are chosen together.
  This applies to Local AI CLI repositories; empty means the Settings default.
- **Target branch** per requirement: tasks branch from it and merge into it. A repository that does not
  have it yet gets it created from that repository's base branch at fan-out.
- **Kanban:** dragging a not-started card to In Progress opens a dialog showing repositories, CLI + model +
  effort, target branch and merge policy, editable. **Start Fan-Out** confirms.
- **Task branch names** are the requirement ID, `REQ-008`, instead of `req/REQ-008/task-8`. The pattern is
  a setting.
- **Branches are pushed to `origin`** by the bridge: when created, and after every agent run that commits.
  It is a setting, on by default.
- **Approach:** the settings live on the requirement, and one shared "Run settings" dialog is used
  everywhere. Rejected alternatives:
  - choosing the settings only at fan-out: nothing stays editable, and the merge gate needs the target
    later anyway;
  - a target branch per repository: more UI than asked for.

## What the person sees

- **Requirement page:** a **Run settings** card shows CLI · model · effort · target branch · merge
  policy, with an **Edit** button that opens the dialog in edit mode (**Save**).
  - This card replaces today's model/effort control (`RequirementAgentControl`) and merge-policy
    selector, so each setting is edited in one place.
  - **Edit Repos** stays as it is.
- **Start Fan-Out** (requirement page and detail sheet) opens the dialog in fan-out mode. **Start
  Fan-Out** inside the dialog saves, then fans out.
- **Kanban:** dropping a **Draft** or **Ready** card on **In Progress** opens the same dialog in
  fan-out mode.
  - **Cancel** leaves the card in its column.
  - Errors from saving or fan-out, such as `No enabled projects`, show inside the dialog. The card moves
    only after a successful fan-out.
  - Dragging a card that has already started keeps today's rules (QA → In Progress for rework; other moves
    are refused with the reason).

## The dialog

Built on the existing Radix dialog (`components/ui/dialog.tsx`), following Rule C. Fields:

| Field | Values | Notes |
|---|---|---|
| **Repositories** (fan-out mode only) | Checkboxes for this workspace's enabled repositories | At least one is required. A Manual repository shows "Manual: nobody works on it until you switch it to Local AI CLI". |
| **CLI** | Use default, Claude Code, AGY, Codex | "Use default" stores null. Shown with a note that it applies to Local AI CLI repositories. |
| **Model** | Free text with suggestions | Suggestions follow the CLI: Claude Code → `opus`, `sonnet`, `haiku`, `fable`; AGY → the models in its Settings preset list; Codex → its Settings model. Empty = the CLI's Settings model. Validated as today (`AgentModelSchema`). |
| **Effort** | low, medium, high, xhigh, max, or empty | Empty = the CLI's Settings effort. |
| **Target branch** | Searchable list plus free text | See below. |
| **Merge policy** | Review first, or auto-merge, or empty | Empty = the workspace/Settings default. |

**Target branch field:**
- It lists the branches that exist (locally or on `origin`) in the chosen repositories. Each branch shows
  which repositories have it; for example, `release/1.3 · backend, frontend` or `release/1.3 · backend
  only`.
- Typing a name that does not exist shows **Create `<name>`**: "created from each repository's base
  branch at fan-out".
- Empty means each repository's base branch.
- Once the requirement has been fanned out, the field is read-only and explains why.

## Server

### Data (migration 9)

`requirements` gains two columns:
- `agent_cli TEXT NULL`: `claude-cli`, `agy-cli` or `codex-cli`; null = Settings default.
- `target_branch TEXT NULL`: null = each repository's base branch.

Shared `Requirement` type and schemas gain both fields. `UpdateRequirementInputSchema` gains
`agent_cli`, `agent_model`, `agent_effort` and `target_branch`; each is optional, and null clears it.
Model and effort keep their current validation. The existing `PUT /api/requirements/:id/agent-profile`
stays for compatibility.

**Branch name rule:**
- Allowed characters: letters, digits, `.`, `_`, `/`, `-`, at most 100 characters.
- It must not start with `-` or `/`, end with `/`, `.` or `.lock`, or contain `..`, `//` or `@{`.
- It must not be a branch the bridge created for a task (any `bridge_tasks.branch`), since a target must
  not be one task's own work.

Refused names are a 400 with the reason.

**Lock:** changing `target_branch` on a requirement that already has goal or ticket tasks is a 409:
`<REQ> was already fanned out to <branch>; the target branch cannot change (create a new requirement for
another branch)`. Setting it to the same value is a no-op. Other fields stay editable; they apply to
runs started afterwards, as model/effort do today.

### Where the target branch is read

One function: `BranchService.baseBranchFor(project, reqId?)`. The requirement's `target_branch` wins,
then the project's `base_branch`, then the Settings default. Every caller passes the requirement:
- fan-out: the goal prompt's branch rules (`formatGoalBody`) and `ensureTaskBranch`;
- ticket dispatch: a ticket belongs to the same requirement;
- the merge gate (`prepare`, fast-forward, push, branch deletion);
- `hasUnmergedBranches` and any other check that compares a task branch with its base.

**Creating a missing target branch:**
- When it runs: in `ensureTaskBranch`, before the task branch is created.
- Where it starts from: if the target branch exists neither locally nor as `origin/<target>`, it is created
  locally from the repository's own base branch (local, else `origin/<base>`).
- Pushed right away when `push_branches` is on (see "Pushing branches to `origin`"). Otherwise, or if that
  push fails, the merge gate pushes it with the first merge, when the repository has a remote.
- Record: a `target_branch_created` event `{ reqId, project, branch, from }`.

**Merge gate with a target the remote does not have yet:**
- It starts from the local target branch instead of `origin/<target>`.
- The push creates the remote branch.
- Pushing still never forces.

### Branch list

`GET /api/branches?projects=backend,frontend` (projects of one workspace) returns:

```json
[{ "name": "release/1.3", "projects": ["backend", "frontend"] }, { "name": "develop", "projects": ["backend", "frontend"] }]
```

- Contents: local branches plus `origin/*` (shown without the `origin/` prefix), excluding `HEAD` and the
  branches the bridge created for tasks (any `bridge_tasks.branch`, old `req/…` names included).
- Order: most repositories first, then by name.
- Limit: at most 200 names.
- Repositories without git return nothing.
- Unknown project names are a 400.
- No `fetch` is run: the list reflects the last fetch.

### Task branch names

`taskBranchName` (used by fan-out for goals and by ticket creation) builds names from a pattern in
Settings → Git & Branch Rules: `task_branch_pattern`, default `{req}`. The tokens are `{req}`
(`REQ-008`), `{task}` (the task number) and `{project}` (the repository's folder-safe name).

| Task | Default name |
|---|---|
| Goal: one per requirement per repository | `REQ-008` |
| Ticket: another task of the same requirement in that repository | `REQ-008-ticket-12` (the pattern plus `-ticket-{task}`) |
| Name already taken in the repository | the first free of `REQ-008-2`, `REQ-008-3`, … |

- **Ticket names use a dash.** Each task has its own worktree and git cannot check out one branch
  twice; git also refuses both `REQ-008` and `REQ-008/…` as branch names.
- **"Taken"** means the name exists as a local branch, as `origin/<name>`, or as another task's recorded
  branch. The bridge never reuses or overwrites a branch it did not create for this task. A later revision
  of the same requirement therefore gets `REQ-008-2`.
- **Pattern validation:** it must contain `{req}`, and the name it produces must pass the branch name rule.
  Refused patterns are a 400 with the reason.
- **Existing branches:** tasks that already have a branch keep it (`req/REQ-008/task-8` stays; it has a
  worktree and may be in review). Only tasks created after the change get the new names.
- The goal prompt's branch rules name the actual branch, as today.

### Pushing branches to `origin`

Settings → Git & Branch Rules: `push_branches`, on by default.

When it is on and the repository has an `origin` remote, the bridge pushes:
- a **task branch** when fan-out or ticket creation creates it;
- a **task branch** again after every Local AI CLI run that added commits (end commit ≠ start commit);
- a **new target branch** when fan-out creates it.

How it pushes:
- **Never forced:** `git push origin <sha>:refs/heads/<branch>`, the existing `pushCommit`. If the
  remote branch moved, or the push fails (no credentials, offline, a timeout of 2 minutes), the task is
  not affected. The task log shows `Could not push <branch> to origin: <reason>`, and the next push of that
  branch tries again.
- **Never blocking:** pushes run asynchronously (`runGitAsync`), after the branch exists, and never delay
  fan-out or a run's result.
- **Logged:** a successful push logs `↑ Pushed <branch> to origin` on the task.
- **Agents still never push.** Their prompt keeps "never push"; only the bridge pushes, so every push is
  controlled and visible.
- **Branches made before the change:** they are pushed the next time something changes on them.

A consequence to know: a task branch starts from the local base branch, so local commits not yet on
`origin/<base>` become visible on `origin` with the task branch. The merge gate pushes them anyway when
it merges.

### Settings (Rule B)

`BranchMergeSettings` gains `task_branch_pattern` (string, default `{req}`) and `push_branches` (boolean,
default `true`), validated as above. They are saved through the existing
`PUT /api/settings/branch-merge` and shown on Settings → Git & Branch Rules as a text field (with a live
example: `REQ-008`, `REQ-008-ticket-12`) and a switch.

### CLI per requirement (Local AI CLI)

- **Resolution:** `resolveAgentProfile` gains `cli`, from the requirement's `agent_cli`, else null.
  There is no task pin and no workspace default for the CLI.
- **Dispatch:** sends `cli` in `CreateEngineTaskInput`. `StoneforgeAdapter.engineBody` keeps sending only
  its known fields, so Stoneforge never sees it.
- **Storage:** the local adapter stores it as the run's preferred CLI, a new `local_runs.preferred_cli`
  column (migration 9).
- **Choosing the CLI per run:** the runner chooses the CLI for each queued run instead of once per pass.
  - A preferred CLI, if set, must be enabled and installed. Otherwise the run fails with `<CLI> is chosen
    for <REQ-ID> but is not installed on this PC` (or `…is turned off in Settings → AI & Local
    Engines`).
  - Without a preference, today's choice applies (Settings → Agent CLI, else the AI default, else the
    first usable).
- **Usage-limit pauses:** checked per run's CLI, so a paused AGY does not hold back a Claude Code run.
  `maxParallel` still counts all runs together.
- **Model and effort:** as today. The resolved values are used, else the chosen CLI's Settings values,
  and what was used is recorded on the task.

### Kanban, server side

No new status rule. The dialog saves through `PUT /api/requirements/:id` and starts through the existing
fan-out route (`POST /api/requirements/:id/ready`), which already moves Draft/Ready → In Progress. The web
client no longer sends a plain status change for Draft/Ready → In Progress.

## Web

- **New `RunSettingsDialog`** (one component, `mode: 'edit' | 'fan-out'`). Pure helpers live in
  `lib/runSettings.ts`, with tests:
  - the draft built from a requirement;
  - branch-name validation, mirroring the server rule;
  - model suggestions per CLI;
  - the target-branch options built from the branch list.
- **Branch picker:** Radix popover listbox (the pattern of `RepositoryFilter` / `listboxNav`) with arrow
  keys.
- **`RunSettingsCard`** on the requirement page, replacing `RequirementAgentControl` and the merge-policy
  selector.
- **Start Fan-Out buttons** (`RequirementDetailPage`, `RequirementDetailSheet`) open the dialog in fan-out
  mode.
- **`RequirementsPage`:** `handleDropOnGroup` opens the dialog when a Draft/Ready card is dropped on In
  Progress; other drops are unchanged.
- **API functions:** `updateRequirement` (existing) and new `fetchBranches(projects)`.

Desktop (Rule A): every call goes through `BASE`, and no new server dependency is added.

## Testing

**Server, with real git repositories:**

| Area | Checks |
|---|---|
| Target branch | a missing target is created from the base and the task branch starts from it; an existing target is used as is; the goal prompt names the target |
| Merge gate | merges into the target and fast-forwards it, including when `origin` lacks it (the push creates it) |
| Tickets | a ticket of the requirement branches from the target |
| Validation | refused branch names (400); target change after fan-out (409); same value accepted |
| Branch list | union across repositories, task branches excluded, unknown project refused |
| CLI | the preferred CLI is used per run; an unusable preferred CLI fails clearly; a paused CLI blocks only its own runs; Stoneforge body unchanged (now asserted) |
| Branch names | goal `REQ-008`; ticket in the same repo `REQ-008-ticket-12`; a taken name gets `-2`; pattern with `{project}`; a pattern without `{req}` refused; existing tasks keep `req/…` |
| Push | with a bare `origin`: a new task branch, new commits after a run, and a new target branch reach `origin`; a moved remote branch is not forced and the task goes on with the log line; repositories without `origin` and `push_branches: false` push nothing |

**Web:** helper tests in `lib/runSettings.test.ts`, then typecheck and build.

## Docs

- `03-requirements-and-fan-out.md`: the Run settings card and dialog, Start Fan-Out through the dialog,
  and Kanban drag to In Progress.
- `06-review-qa-and-merge.md`: merging into the target branch, and creating it.
- `09-settings-and-environment.md`: the task branch name pattern and the push switch.
- Every `req/<REQ-ID>/task-<id>` in the guide becomes the new names, noting that older tasks keep theirs.
- `02-projects-and-engines.md`: the CLI per requirement for Local AI CLI.
- `10-troubleshooting.md`: the new messages (branch name refused, target locked, preferred CLI
  unavailable).

## Out of scope

- A different target branch per repository.
- Choosing which branch a new target branch is created from (always the repository's base branch).
- A CLI choice on Retry or Request changes.
- Fetching remotes to refresh the branch list.
- Changing the target branch after fan-out.
- Renaming branches that already exist (`req/REQ-008/task-8` stays).
- Deleting merged branches on `origin` (auto-delete still removes only the local branch).
- Agents pushing by themselves.
