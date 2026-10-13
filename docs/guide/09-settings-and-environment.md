# 09 Settings and environment

Settings in the app change how the bridge behaves while it runs; environment variables are read
once when the server (or an agent's `xticket`) starts.

## Settings tabs

Open **Settings** in the sidebar.

| Tab | What it is for |
|---|---|
| **AI & Local Engines** | Which AI drafts requirements and answers in the AI chats (**Auto (Recommended)**, **Claude Code CLI**, **Antigravity CLI (agy)**, **Codex CLI**, **Local Ollama**, **Built-in Heuristic**), and the model for each. Save with **Save AI Configuration**. This does not affect the agents that do the work: their engines decide that, unless you choose a model and effort for a workspace, a requirement or a task (see [03](03-requirements-and-fan-out.md#choose-the-agent-model-and-effort)). The **Local AI CLI engine** card on this tab controls the agents of Local AI CLI repositories (see below). |
| **Git & Branch Rules** | The default base branch and the default merge policy. See below. |
| **Notifications** | Slack, Telegram and webhook channels, event switches and the link address. See [Notifications](07-notifications.md). |
| **Embedded IDE (VS Code)** | A local code-server or OpenVSCode server for browsing project code: **Local Port** (8443 by default), **Custom Binary Path (Optional)**, **External or Existing IDE URL (Optional)**, **Start Server** / **Stop Server**, **Save IDE Configuration**. |
| **Appearance & Theme** | Light or dark mode. The sidebar's **Light** / **Dark** button does the same. |
| **Safety & System Limits** | Shows the built-in limits: `MAX_DEPTH` 3 (ticket chain depth), `MAX_TICKETS_PER_REQ` 10, `WATCH_INTERVAL_MS` 5000 ms, `MAX_BODY_BYTES` 20 KB. Read only; this tab always shows 5000 ms even if you set `WATCH_INTERVAL_MS`. |

### Local AI CLI engine

On **AI & Local Engines**, the **Local AI CLI engine** card controls the agents of repositories whose
engine is **Local AI CLI** (see [02](02-projects-and-engines.md#local-ai-cli)).

| Setting | Default | Meaning |
|---|---|---|
| **Run agents on this PC** | on | Off: tasks wait in QUEUED and the engine shows as Down. |
| **Agent CLI** | **Use AI default** | Which CLI runs agents. **Use AI default** follows the AI default above; when that is Ollama, the heuristic or Auto, the first installed and active of Claude Code, AGY and Codex is used. |
| **Parallel agents** | 2 | 1 to 8 agents at once, all workspaces together. |
| **Time limit per run** | 60 minutes | 5 to 480. A longer run is stopped and the task FAILS; **Retry** continues it. |
| **Worktree folder** | `agent-worktrees` in the server workspace | Where task copies are made: an absolute path, or empty for the default. |

Below the settings the card shows which CLI the next run uses; how many runs are running, queued,
waiting for a person and rate limited; and for each CLI **Installed on PC** / **Not Detected** and
**HEALTHY** / **PAUSED until …** (a usage limit). Click **Save Local Engine** to save.

### Git & Branch Rules

- **Default Implementation Base Branch** (`develop` by default): used only for projects that have
  no **Base Branch** of their own.
- **Merge Policy**: **Review first** (default) or **Auto-merge (no review)**. A requirement's own
  **Merge:** setting wins. See [Merge policies](06-review-qa-and-merge.md#merge-policies).
- Click **Save Branch & Merge Rules**.

One more setting has no control in the app: `auto_delete_branch` (off by default). When on, the
merge gate deletes each task branch after merging it (a branch that is checked out somewhere is
kept). Turn it on with:

```bash
curl -X PUT http://127.0.0.1:4100/api/settings/branch-merge \
  -H 'Content-Type: application/json' \
  -d '{"auto_delete_branch": true}'
```

## Environment variables

Set them in front of the start command, for example
`AGENT_TOKEN=s3cret WORKSPACE_DIR=/Users/you/sp-data npm run dev`.

### Server

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `4100` | Port of the bridge server. The web dev server (`npm run dev:web`) always forwards `/api` to port 4100, so change this only if you serve the web app another way. |
| `HOST` | `127.0.0.1` | Address the server listens on. The bridge has no user login: anyone who can reach this address can use it. Use `0.0.0.0` only on a trusted network, together with `ALLOWED_HOSTS`. |
| `WORKSPACE_DIR` | `./workspace` (relative to the folder the server starts in; `packages/server/workspace` with `npm run dev`) | Where `bridge.db`, `requirements/`, `projects.yaml` and `backups/` live. Also read by `npm run mcp` (see [MCP server](#mcp-server)). |
| `WATCH_INTERVAL_MS` | `5000` | How often (in milliseconds) the bridge checks engines, retries failed calls, reads agent outboxes and sends notifications. |
| `AGENT_TOKEN` | not set (agent routes open) | When set, `POST /api/tickets`, `POST /api/agent/tickets` and `POST /api/agent/questions` need `Authorization: Bearer <token>`. Give agents the same value as `XTICKET_TOKEN`. |
| `ENGINE_MAX_STARTS_PER_MINUTE` | `10` | New agents (goals, tickets) the bridge starts per project per minute. `0` = no limit. See [08](08-rate-limits-and-retry.md#the-start-limit). |
| `ENGINE_TIMEOUT_MS` | `10000` | How long the bridge waits for each Stoneforge call. |
| `DEMO_MODE` | not set | `1` turns on demo-only features (simulated **Run with AI CLI**, sample logs, **Review & Merge to Main** without git). Not for real work. |
| `GITHUB_WEBHOOK_SECRET` | not set (signatures not checked) | Secret of the GitHub webhook at `POST /api/webhooks/github`; deliveries without a valid `X-Hub-Signature-256` are refused. |
| `WEB_ORIGINS` | `http://localhost:4101`, `http://127.0.0.1:4101`, `tauri://localhost`, `http://tauri.localhost` | Comma-separated browser origins allowed to call the API from another site. Setting it replaces the defaults. Requests from other sites get `Cross-site request blocked`. |
| `ALLOWED_HOSTS` | none (always allowed: `localhost`, `127.0.0.1`, `[::1]`) | Comma-separated extra host names the server accepts, for example `host.docker.internal`. Other hosts get `Host not allowed: <host>`. |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama address for AI drafting when Settings → **AI & Local Engines** has none. |
| `ANTHROPIC_API_KEY` | not set | Adds "Anthropic Claude (Cloud API)" to the providers of **Draft with AI Assistant**. |
| `OPENAI_API_KEY` | not set | Adds "OpenAI (Cloud API)" to the providers of **Draft with AI Assistant**. |
| `GIT_SSH_COMMAND` / `GIT_SSH` | not set | If neither is set, the bridge's git commands use `ssh -o BatchMode=yes`, so they fail instead of asking for a password. Git never prompts for credentials. |
| `SHELL` | `/bin/zsh` | The shell of the project **Terminal**. |
| `HOME` | your home folder | Used to find AI CLIs in `~/.local/bin`. |

### Agents (xticket)

| Variable | Default | Effect |
|---|---|---|
| `XTICKET_URL` | `http://127.0.0.1:4100` | Where `xticket` sends tickets and questions. |
| `XTICKET_TOKEN` | not set | Sent as `Authorization: Bearer <token>`; must equal `AGENT_TOKEN`. |
| `XTICKET_PROJECT` | `unknown` | The bridge project name of the agent's repository. |
| `XTICKET_TASK` | not set | The engine's id of the agent's task. Required for questions. |

See [Agents, tickets and questions](04-agents-tickets-and-questions.md).

## Example: agents in containers

Agents that run in Docker on the same machine reach the host as `host.docker.internal`:

```bash
# Server
HOST=0.0.0.0 ALLOWED_HOSTS=host.docker.internal AGENT_TOKEN=s3cret npm run dev

# Inside each agent container
export XTICKET_URL=http://host.docker.internal:4100
export XTICKET_TOKEN=s3cret
export XTICKET_PROJECT=backend
export XTICKET_TASK=<engine task id>
```

With `HOST=0.0.0.0` every machine that can reach yours can use the bridge, and only the agent
routes need the token. Use it only on a network you trust.

## MCP server

`npm run mcp` starts an MCP server on standard input and output, for AI tools that call MCP tools.
It opens the same `bridge.db` as the bridge; give it the same `WORKSPACE_DIR` (see
[01](01-getting-started.md#where-your-data-lives)).

| Tool | What it does | Arguments |
|---|---|---|
| `sp_list_projects` | Lists the projects of one workspace with their kind, engine type and engine status. | `workspace_id` (default `default`) |
| `sp_create_requirement` | Creates a requirement as a draft (To Do); it does not start the fan-out. | `title`, `goal` and `affected_projects` (required); `acceptance_criteria`, `user_story`, `priority` (`low`, `normal`, `high`, `urgent`), `workspace_id` (default `default`) |
| `sp_list_requirements` | Lists the requirements of one workspace with id, title, status and projects. | `workspace_id` (default `default`) |
| `sp_get_requirement` | Returns one requirement with its details, by id (for example `REQ-001`). | `id` (required) |

### Workspace scope

The tools stay inside one workspace. `workspace_id` is the id shown in brackets in the header's
workspace selector (for example `speedx` in `Speedx (speedx)`). When you leave it out, the tool
uses the `default` workspace, so a call without it never sees the projects of another workspace.
An example for `sp_create_requirement`:

```json
{
  "workspace_id": "speedx",
  "title": "Add password reset",
  "goal": "Users can reset a forgotten password by email.",
  "affected_projects": ["backend", "mobile"]
}
```

- `sp_list_projects` lists only that workspace's projects. An unknown workspace id does not give an
  empty list; the tool answers `No workspace "nowhere". Known workspaces: default, speedx.`
  It used to list the projects of every workspace; pass `workspace_id` for any workspace other
  than `default`.
- `sp_create_requirement` creates the requirement in that workspace. Names in `affected_projects`
  that are registered to another workspace are dropped. If none are left, it fails with a message
  such as `backend belongs to another workspace. Pick from this workspace's repositories: web.`
  (`belong` when it names several; `Register a project in this workspace first.` when the
  workspace has no projects).
- `sp_get_requirement` has no `workspace_id`: it looks a requirement up by its id.
- The tools do not set a requirement's agent model or effort. Set them on the requirement page with
  **Agent:** (see [03](03-requirements-and-fan-out.md#choose-the-agent-model-and-effort)).

## If something goes wrong

- **The web app shows "Backend bridge server is unreachable"** after you changed `PORT`: the web
  dev server only forwards to port 4100. Use the default port.
- **The data you expect is missing**: the server started in another folder and uses another
  `WORKSPACE_DIR`. Set it to an absolute path.
- **Agents get `Host not allowed`**: add their host name to `ALLOWED_HOSTS`.
- **Agents get `Invalid or missing agent token`**: `XTICKET_TOKEN` does not equal `AGENT_TOKEN`.
- **An AI tool sees no projects, or `sp_create_requirement` fails with `... belongs to another
  workspace`**: the call used the `default` workspace. Pass the `workspace_id` of the workspace the
  repositories are registered to.
