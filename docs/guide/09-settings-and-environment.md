# 09 Settings and environment

Settings in the app change how the bridge behaves while it runs; environment variables are read
once when the server (or an agent's `xticket`) starts.

## Settings tabs

Open **Settings** in the sidebar.

| Tab | What it is for |
|---|---|
| **AI & Local Engines** | Which AI drafts requirements and answers in the AI chats (**Auto (Recommended)**, **Claude Code CLI**, **Antigravity CLI (agy)**, **Codex CLI**, **Local Ollama**, **Built-in Heuristic**), and the model for each. Save with **Save AI Configuration**. This does not affect the agents that do the work; their engines decide that. |
| **Git & Branch Rules** | The default base branch and the default merge policy. See below. |
| **Notifications** | Slack, Telegram and webhook channels, event switches and the link address. See [Notifications](07-notifications.md). |
| **Embedded IDE (VS Code)** | A local code-server or OpenVSCode server for browsing project code: **Local Port** (8443 by default), **Custom Binary Path (Optional)**, **External or Existing IDE URL (Optional)**, **Start Server** / **Stop Server**, **Save IDE Configuration**. |
| **Appearance & Theme** | Light or dark mode. The sidebar's **Light** / **Dark** button does the same. |
| **Safety & System Limits** | Shows the built-in limits: `MAX_DEPTH` 3 (ticket chain depth), `MAX_TICKETS_PER_REQ` 10, `WATCH_INTERVAL_MS` 5000 ms, `MAX_BODY_BYTES` 20 KB. Read only; this tab always shows 5000 ms even if you set `WATCH_INTERVAL_MS`. |

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
| `WORKSPACE_DIR` | `./workspace` (relative to the folder the server starts in; `packages/server/workspace` with `npm run dev`) | Where `bridge.db`, `requirements/`, `projects.yaml` and `backups/` live. Also read by `npm run mcp`. |
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

## If something goes wrong

- **The web app shows "Backend bridge server is unreachable"** after you changed `PORT`: the web
  dev server only forwards to port 4100. Use the default port.
- **The data you expect is missing**: the server started in another folder and uses another
  `WORKSPACE_DIR`. Set it to an absolute path.
- **Agents get `Host not allowed`**: add their host name to `ALLOWED_HOSTS`.
- **Agents get `Invalid or missing agent token`**: `XTICKET_TOKEN` does not equal `AGENT_TOKEN`.
