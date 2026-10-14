# 02 Projects and engines

A project is one repository the bridge can send work to; its engine is what runs the agents
for it. This page is for whoever sets up projects and engines.

## Register a project

1. In the sidebar, click **Repositories**.
2. Click **Add Project**. The **Register Project** form opens.
3. Fill in the fields:

   | Field | What to enter |
   |---|---|
   | **Workspace** | The workspace the project belongs to (`default` unless you made others). |
   | **Project Name** | A short name such as `backend` or `mobile`. It is saved in lower case. Agents use this name in `xticket create --to <project>`. |
   | **Repository Path (Absolute)** | The full path to the repository on this machine, for example `/Users/you/dev/backend`. |
   | **Kind** | Backend, Frontend, Full-stack, Mobile or Other. Informational. |
   | **Engine Type** | **Local AI CLI** (the default), **Manual** or **Stoneforge** (see below). |
   | **Base Branch** | The branch work starts from and merges back into. The form uses `main` when you leave it empty. |
   | **Engine URL (Optional)** | Required for Stoneforge, for example `http://127.0.0.1:3457`. Leave empty for Manual. |
   | **Contract Path (Optional)** | A file in the repository that describes its API, for example `api/openapi.yaml`. When a ticket to this project is finished, the waiting agent is told where to read it. |
   | **Test Command (Optional)** | A shell command the merge gate runs before anything is pushed, for example `npm ci && npm test`. |
   | **Build Command (Optional)** | A shell command AI QA runs to check that the project builds, for example `npm ci && npm run build`. |
   | **Lint Command (Optional)** | A shell command AI QA runs to check the code style, for example `npm ci && npm run lint`. |

4. Click **Save Project**.

### What happens next

The project appears as a card. A toast says `Project <name> registered`. You can now pick it under
**Affected Repositories / Engines** when you write a requirement.

### Branches and the base branch

- The bridge creates a branch per task (`<REQ-ID>`; a ticket: `<REQ-ID>-ticket-<id>`) only when **Repository Path**
  is the root of a git work tree. Otherwise the project works without branches, and the merge
  gate does not apply (see [Confirm merged](06-review-qa-and-merge.md#work-without-task-branches)).
- The branch starts from the project's base branch. If there is no local branch of that name,
  the bridge uses `origin/<base>`. If neither exists, the task fails with
  `Base branch "<base>" was not found in <repo>`.
- The project's **Base Branch** wins. The default in Settings → **Git & Branch Rules** is used
  only when a project has no base branch.

### The test command

The merge gate runs the test command with `/bin/sh` in a fresh temporary checkout of the merge
result. That checkout has no installed dependencies, so include the install step
(`npm ci && npm test`). The command must finish within 15 minutes. A non-zero exit code stops
the merge and nothing is pushed. See [Review, QA and merge](06-review-qa-and-merge.md).

AI QA runs the test, build and lint commands (each only when set) in its own temporary copy of the
merged commit, which also has no installed dependencies; the agent installs them when a command needs
them. A failing command becomes a **blocker** finding. See [AI QA](06-review-qa-and-merge.md#ai-qa).

### Fields the form does not show

`projects.yaml` and the API (`POST /api/projects`) also accept:

- `high_risk_paths`: a list of paths. It is stored, but nothing in the bridge acts on it yet.
- `enabled`: `true` by default. Fan-out, tickets and the outbox scan skip a disabled project.
- `done_means`: `merged` (default) or `pr_opened`. Stored; nothing in the bridge acts on it yet.

## Engine types

Three engine types work: **Manual**, **Local AI CLI** and **Stoneforge**.

- `clinekanban` is accepted when saving, but any work sent to it fails with
  `clinekanban adapter is not yet implemented`.

### Manual

People (or your own tools) do the work. The bridge does not poll anything for Manual projects.

- Fan-out still creates a goal and, for git projects, its branch. Work on that branch.
- When the work is finished, press **Mark Done** on the task (see
  [Requirements and fan-out](03-requirements-and-fan-out.md#mark-a-task-done)).
- A **Note** to a Manual task is accepted but goes nowhere: there is no agent to read it.
- A model or effort you choose has no effect: no agent runs, so the bridge records none for the
  task and its card shows no model (see
  [Model and effort sent to the engine](#model-and-effort-sent-to-the-engine)).
- Optional: a GitHub webhook can move tasks for you (see below).

### Local AI CLI

An AI CLI on this PC does the work: Claude Code, AGY or Codex, whichever **Settings → AI & Local
Engines → Local AI CLI engine** picks (by default the same CLI as your AI default). No engine URL is
needed.

After **Start Fan-Out**, each task of the repository moves by itself:

1. **QUEUED**: waiting for a free slot. At most 2 agents run at once (change it in Settings).
2. **IN PROGRESS**: the agent works in its own copy of the repository, a git worktree on the task
   branch (`<REQ-ID>`; a ticket: `<REQ-ID>-ticket-<id>`) in the `agent-worktrees` folder of the server workspace, or in
   `~/.sp-kickstack/agent-worktrees` when that workspace lies inside a git repository (as with
   `npm run dev`). Your own checkout is never touched. Open **Logs** on the task to watch it: its messages, the commands it
   runs (`→ Bash: npm test`) and the files it edits.
3. **IN REVIEW**: the agent finished and the branch has commits. Your merge policy takes over.

Other endings:

| The agent… | The task shows | What to do |
|---|---|---|
| finished without committing | NEEDS HUMAN, `Finished without committing anything` | Read **Logs**, then **Retry** or **Request changes** with more detail. |
| failed | FAILED, with the last lines of its output | Read **Logs**, then **Retry**. |
| ran longer than the time limit (60 minutes) | FAILED, `Stopped after the 60 minute time limit …` | Raise the limit in Settings or split the work, then **Retry**. |
| reached its CLI's usage limit | RATE LIMITED until the reset | Nothing: it continues by itself at the reset time. |
| asked you a question (`xticket ask`) | WAITING / HELD | Answer it; the agent continues with your answer. |

- **Notes** are saved and given to the agent when its next run starts (after an answer, a usage
  limit, **Retry** or **Request changes**). An agent that is running does not see them.
- **Model and effort** are passed to the CLI. Without a choice, the CLI's model and effort from
  Settings are used. A Claude model name such as `opus` may not exist in AGY or Codex; the run then
  fails with the CLI's own message.
- **CLI per requirement:** a requirement can choose its own CLI in **Run settings** (see
  [03](03-requirements-and-fan-out.md#run-settings)); the Settings choice applies to the others.
- **Restarts**: if the server stops while agents run (for example `npm run dev` restarting after a
  code change), the agents are stopped and continue from their branch when the server is back.
- **Safety**: the agent's commands run as your user account. Codex is limited to the worktree;
  Claude Code and AGY are told to stay in it but are not blocked from leaving it.
- The worktree is removed once the task is COMPLETE or CANCELLED (kept while it has uncommitted
  changes).

### Switch a Manual repository to Local AI CLI

Tasks fanned out to a Manual repository wait until someone does the work. To let agents do it, edit
the repository (see [Edit or delete a project](#edit-or-delete-a-project)), set **Engine Type** to
**Local AI CLI** and save:

- Every QUEUED task of that repository goes to the local engine and starts within a few seconds.
- Tasks in other states (WAITING / HELD, IN REVIEW, COMPLETE, …) are left as they are.
- The other way round: once a repository is switched to another engine or disabled, no new agent
  starts there. Its waiting runs start again if you switch it back to **Local AI CLI**.

Example: REQ-008 has tasks #8 (`backend`) and #9 (`frontend`) QUEUED on Manual. Switch `backend` and
`frontend` to **Local AI CLI**: both tasks move to IN PROGRESS (2 agents at once), and **Logs** shows
their work.

### Stoneforge

The bridge talks to a Stoneforge engine over HTTP at the **Engine URL**. It calls:

| Call | Used for |
|---|---|
| `GET /health` | Engine health |
| `POST /api/goals` | Start a goal (fan-out) |
| `POST /api/tasks` | Start a ticket |
| `GET /api/tasks/<id>` | Read a task's status (every tick) |
| `POST /api/tasks/<id>/hold` | Pause a task (blocking ticket, question) |
| `POST /api/tasks/<id>/release` | Resume a paused task with context |
| `POST /api/tasks/<id>/note` | Send a note (answers, review notes, merge notes, **Note**) |
| `POST /api/tasks/<id>/cancel` | Stop a task (Cancel, Retry, Request changes) |

These calls were tested against the bridge's built-in fake engine. Check that your Stoneforge
version offers each of them; the bridge sends no auth token. Each call times out after
`ENGINE_TIMEOUT_MS` (10 seconds by default). An HTTP 429 answer is treated as a rate limit (see
[Rate limits and Retry](08-rate-limits-and-retry.md)).

The engine's status names are mapped to bridge statuses:

| Engine status | Bridge status |
|---|---|
| `ready`, `queued`, `pending` | QUEUED |
| `in_progress`, `running`, `active` | IN PROGRESS |
| `deferred`, `held`, `waiting` | WAITING / HELD |
| `needs_review`, `review`, `steward_review`, `in_review`, `qa` | IN REVIEW |
| `done`, `merged`, `completed`, `closed_done` | COMPLETE |
| `failed`, `error`, `abandoned` | FAILED |
| `cancelled`, `canceled`, `closed_cancelled` | CLOSED |
| `rate_limited`, `rate-limited`, `ratelimited`, `quota_exceeded`, `usage_limited`, `throttled` | RATE LIMITED |
| `needs_human`, `blocked`, and **any status not listed here** | NEEDS HUMAN |

An unknown status shows as NEEDS HUMAN, so an unexpected engine status gets a person's attention.

### Model and effort sent to the engine

You can choose a model and an effort for the agents (see
[Choose the agent model and effort](03-requirements-and-fan-out.md#choose-the-agent-model-and-effort)).
The bridge decides what applies to a task each time it starts the task:

1. It looks for a value in this order: the task's pin, the requirement, the workspace.
   Model and effort are looked up separately.
2. It adds `model` and `effort` to the JSON body of the create request (`POST /api/goals` for a
   goal, `POST /api/tasks` for a ticket), next to the title and the prompt (`bodyMd`). A part that
   has no value is left out, so an engine that knows nothing about them gets the same request as
   before.
3. It records what it sent on the task, and the task card shows it (for example `opus · high`).

| Engine | What it does with `model` and `effort` |
|---|---|
| **Local AI CLI** | **Directly Supported.** The bridge passes `--model <model>` and reasoning effort/thinking parameters to the chosen local CLI binary (`claude`, `agy`, `codex`, `ollama`). |
| **Stoneforge** | **Passed in payload.** The bridge sends them in the JSON body (`model`, `effort`); whether your Stoneforge server reads and honours them depends on the remote version. |
| **Manual** | Ignored. No agent runs, so the task records no model and its card shows none. |

Because of this, the model on a task card is what the bridge **sent**, not proof of what the agent
used. If it matters to you, run one small requirement first and check in the engine which model
the agent used.

## Engine health

Each project card shows a badge: **Online**, **Down**, or the engine type when the status is
not known yet.

- The bridge checks an engine's health on every tick **while that project has active engine
  work** (tasks that reached the engine and are not finished).
- When the health check fails, the project shows **Down**, an "engine is down" notification is
  sent once, and the bridge checks again less often (the wait doubles each time, up to
  5 minutes).
- While a project is Down, automatic retries of work for it wait.
- When the engine answers again, the project shows **Online** and the bell says the engine is
  back.

The **Test** button on a project card does not contact the engine. It shows the status the
bridge last recorded, and the toast says "verified" even when the engine is not reachable.
Watch the **Online** / **Down** badge instead.

## Edit or delete a project

- Click **Edit** (or the pencil icon), change fields, then **Save Changes**.
- **Delete Project** removes the project from the bridge. Files on disk are not touched, but the
  bridge also deletes **every task and dependency link of that project**, in every requirement.
  Do not delete a project that still has work you care about; set `enabled: false` instead
  (through `projects.yaml` or `PUT /api/projects/<name>`).

## Seed projects from projects.yaml

If `<WORKSPACE_DIR>/projects.yaml` exists, the server registers every project in it **at every
start**. A project with the same name is updated from the file, so changes you made in the web
app to those projects are replaced on the next restart. Edit the file instead.

```yaml
projects:
  - name: backend
    workspace_id: default
    kind: backend
    repo_path: /Users/you/dev/backend
    engine_type: stoneforge
    engine_url: http://127.0.0.1:3457
    base_branch: develop
    contract_path: api/openapi.yaml
    test_command: npm ci && npm test
    high_risk_paths: [migrations/]
    enabled: true

  - name: mobile
    kind: mobile
    repo_path: /Users/you/dev/mobile
    engine_type: manual
    base_branch: main
```

The file may also be a plain list without the `projects:` key. Fields you leave out get their
defaults: `workspace_id: default`, `kind: other`, `base_branch: develop`, `enabled: true`.

## Workspaces

The header has a workspace selector (**All Workspaces** or one workspace). Projects and
requirements belong to one workspace. The **Add New Workspace** button (the plus sign) next to it adds a workspace.
**Shared Rules & Context** (it only appears when one workspace is selected, and on a narrow window
only its book icon shows) opens the selected workspace's shared rules and architecture notes. The
new-requirement form mentions these rules, but the fan-out prompt does not include them
today. To give agents shared context, put it in the requirement text, in the repository's own
`AGENTS.md` / `CLAUDE.md`, or in **Attachments Hub** (the names and notes of shared files are
added to every goal prompt of the workspace).

### Set the default agent model and effort for a workspace

The same dialog holds the workspace's default model and effort for its agents. A requirement or
a task can choose its own (see
[Which setting wins](03-requirements-and-fan-out.md#which-setting-wins)).

1. In the header, pick one workspace in the selector (not **All Workspaces**).
2. Click **Shared Rules & Context**. The dialog **Shared Rules & Architecture Context** opens.
3. Under **Default agent model & effort**, click the button. It reads `Engine default` while
   nothing is set.
4. Under **Model**, click **Default** (no choice) or a model (`opus`, `sonnet`, `haiku`, `fable`),
   or type another id into **Other model id** and press Enter. Under **Effort**, click **Default**
   or one of `low`, `medium`, `high`, `xhigh`, `max`.
5. Click **Save Rules & Context**.

Unlike the requirement's **Agent:** control, nothing here is saved until you click
**Save Rules & Context**. A toast says `Workspace shared rules & context updated`.

#### What happens next

The default applies to tasks the bridge **starts after you save**, in every requirement of this
workspace that has no choice of its own. Running agents are not changed. **Default** in the
dialog clears the setting, and the engine decides again.

## Optional: GitHub webhook

For projects whose pull requests live on GitHub, point a repository webhook at
`POST /api/webhooks/github` (content type `application/json`, event: pull requests).

- A pull request **opened** or **reopened** moves the matching task to IN REVIEW.
- A pull request **merged** moves it to COMPLETE and releases tasks waiting on it.
- The GitHub repository name must equal the project name or the last folder of its
  **Repository Path**.
- The pull request's branch or title must name the requirement (`REQ-007`). When several tasks
  match, a `task-<id>` in the branch or title picks one. Bridge branches
  (`REQ-007`) contain both.
- Set `GITHUB_WEBHOOK_SECRET` to the webhook's secret so the bridge checks the signature. Without
  it, unsigned deliveries are accepted.

## If something goes wrong

- **Saving fails with a validation error that names `engine_type`**: you picked **Command**.
  Use **Manual** or **Stoneforge**.
- **`Engine URL is required for project <name>`**: a Stoneforge project has no Engine URL.
- **Tasks fail with `Base branch "<base>" was not found in <repo>`**: create the branch, or fix
  **Base Branch**, then press **Retry** on the task.
- **Your edits to a project disappear after a restart**: the project is in `projects.yaml`.
- **The workspace's default model is not used by a task**: the requirement or the task has its own
  choice, which wins (see [Which setting wins](03-requirements-and-fan-out.md#which-setting-wins)),
  or the task was already running when you saved.
- **A project stays Down and its failed tasks are not retried**: see
  [Troubleshooting](10-troubleshooting.md#an-engine-stays-down).
