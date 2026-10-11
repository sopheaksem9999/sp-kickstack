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
   | **Kind** | Backend, Frontend, Mobile or Other. Informational. |
   | **Engine Type** | **Manual** or **Stoneforge** (see below). |
   | **Base Branch** | The branch work starts from and merges back into. The form uses `main` when you leave it empty. |
   | **Engine URL (Optional)** | Required for Stoneforge, for example `http://127.0.0.1:3457`. Leave empty for Manual. |
   | **Contract Path (Optional)** | A file in the repository that describes its API, for example `api/openapi.yaml`. When a ticket to this project is finished, the waiting agent is told where to read it. |
   | **Test Command (Optional)** | A shell command the merge gate runs before anything is pushed, for example `npm ci && npm test`. |

4. Click **Save Project**.

### What happens next

The project appears as a card. A toast says `Project <name> registered`. You can now pick it under
**Affected Repositories / Engines** when you write a requirement.

### Branches and the base branch

- The bridge creates a branch per task (`req/<REQ-ID>/task-<id>`) only when **Repository Path**
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

### Fields the form does not show

`projects.yaml` and the API (`POST /api/projects`) also accept:

- `high_risk_paths`: a list of paths. It is stored, but nothing in the bridge acts on it yet.
- `enabled`: `true` by default. Fan-out, tickets and the outbox scan skip a disabled project.
- `done_means`: `merged` (default) or `pr_opened`. Stored; nothing in the bridge acts on it yet.

## Engine types

Only **Manual** and **Stoneforge** work today.

- The **Engine Type** list also shows **Command**. The server does not accept it: saving fails
  with a validation error that names `engine_type`.
- `clinekanban` is accepted when saving, but any work sent to it fails with
  `clinekanban adapter is not yet implemented`.

### Manual

People (or your own tools) do the work. The bridge does not poll anything for Manual projects.

- Fan-out still creates a goal and, for git projects, its branch. Work on that branch.
- When the work is finished, press **Mark Done** on the task (see
  [Requirements and fan-out](03-requirements-and-fan-out.md#mark-a-task-done)).
- A **Note** to a Manual task is accepted but goes nowhere: there is no agent to read it.
- Optional: a GitHub webhook can move tasks for you (see below).

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
**Shared Rules & Context** opens the selected workspace's shared rules and architecture notes.
The new-requirement form mentions these rules, but the fan-out prompt does not include them
today. To give agents shared context, put it in the requirement text, in the repository's own
`AGENTS.md` / `CLAUDE.md`, or in **Attachments Hub** (the names and notes of shared files are
added to every goal prompt of the workspace).

## Optional: GitHub webhook

For projects whose pull requests live on GitHub, point a repository webhook at
`POST /api/webhooks/github` (content type `application/json`, event: pull requests).

- A pull request **opened** or **reopened** moves the matching task to IN REVIEW.
- A pull request **merged** moves it to COMPLETE and releases tasks waiting on it.
- The GitHub repository name must equal the project name or the last folder of its
  **Repository Path**.
- The pull request's branch or title must name the requirement (`REQ-007`). When several tasks
  match, a `task-<id>` in the branch or title picks one. Bridge branches
  (`req/REQ-007/task-12`) contain both.
- Set `GITHUB_WEBHOOK_SECRET` to the webhook's secret so the bridge checks the signature. Without
  it, unsigned deliveries are accepted.

## If something goes wrong

- **Saving fails with a validation error that names `engine_type`**: you picked **Command**.
  Use **Manual** or **Stoneforge**.
- **`Engine URL is required for project <name>`**: a Stoneforge project has no Engine URL.
- **Tasks fail with `Base branch "<base>" was not found in <repo>`**: create the branch, or fix
  **Base Branch**, then press **Retry** on the task.
- **Your edits to a project disappear after a restart**: the project is in `projects.yaml`.
- **A project stays Down and its failed tasks are not retried**: see
  [Troubleshooting](10-troubleshooting.md#an-engine-stays-down).
