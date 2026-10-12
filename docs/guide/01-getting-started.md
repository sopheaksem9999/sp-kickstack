# 01 Getting started

This page gets SP Kickstack running on your machine and walks you through your first project and
your first requirement.

## What you need

- **Node.js 22.19.0.** The repository pins it in `.nvmrc` and in `package.json` (`engines`).
  With nvm, run `nvm use` in the repository folder. Other Node versions (for example Node 24)
  can fail to load the database driver (`better-sqlite3`), both for the server and for tests.
- **npm** (comes with Node) and **git**.
- For agents: an engine for each project (Stoneforge), or use **Manual** projects where people do
  the work. See [Projects and engines](02-projects-and-engines.md).

## Install and start

1. Open a terminal in the repository folder.
2. Select the Node version:

   ```bash
   nvm use
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the server and the web app together:

   ```bash
   npm run dev
   ```

   This starts two processes:

   | Process | Address | What it is |
   |---|---|---|
   | server | `http://127.0.0.1:4100` | The bridge API (`PORT` 4100 and `HOST` 127.0.0.1 by default) |
   | web | `http://localhost:4101` | The web app. It forwards `/api` calls to `http://127.0.0.1:4100` |

5. Open `http://localhost:4101` in your browser.

You can also start the parts on their own: `npm run dev:server` and `npm run dev:web`.

### What happens next

The sidebar footer shows **Bridge Engine Active** when the web app can reach the server. Every
5 seconds (the `WATCH_INTERVAL_MS` default) the server checks engines, retries failed engine
calls, reads agent outboxes and sends notifications.

### If something goes wrong

- A red banner says **Backend Bridge is offline** and the sidebar shows **Bridge Offline**: the
  server is not running or not on port 4100. Start it with `npm run dev` (or
  `npm run dev:server`) and check the terminal for errors.
- The server fails with a `better-sqlite3` error: you are on the wrong Node version. Run
  `nvm use`, then `npm install` again.

## Try it without real engines

There are two ways to look around without setting up engines.

- **`npm run demo`** runs a terminal walkthrough with two fake engines: it creates a
  requirement, fans it out, files a blocking ticket, finishes the work and shows the final status.
  It writes to `workspace/demo` and does not start the web app.
- **`DEMO_MODE=1 npm run dev`** starts the normal app with demo-only features: a simulated
  **Run with AI CLI** button in a task's **CLI Logs**, sample log lines, and a
  **Review & Merge to Main** button (for work without task branches) that marks a requirement
  done without any git command. Do not use demo mode for real work.

## Register your first project

1. In the sidebar, click **Repositories**.
2. Click **Add Project** (or **Register your first project** when the list is empty).
3. Fill in at least **Project Name** and **Repository Path (Absolute)**. For a first try, set
   **Engine Type** to **Manual**.
4. Click **Save Project**.

The project card appears. [Projects and engines](02-projects-and-engines.md) explains every field.

## Write your first requirement

1. In the sidebar, click **New Requirement**. A panel opens on the right.
2. On the **Specification Form** tab, type a **Requirement Title**.
3. Under **Affected Repositories / Engines**, click your project.
4. Optional: fill in **Goal & Problem Context (Rich Text)**, **User Story (Optional)** and
   **Acceptance Criteria (Optional)**.
5. Choose one:
   - **Save State (ToDo)** saves it as To Do. Nothing is sent to any engine yet.
   - **Create & Fan-Out** saves it and starts the work right away.

### What happens next

A toast shows the new id (for example `REQ-001`) with a **View Spec** button. Open the
requirement to follow its tasks. Continue with
[Requirements and fan-out](03-requirements-and-fan-out.md).

## Where your data lives

Everything is stored in one folder, the workspace directory:

| Path | What it holds |
|---|---|
| `bridge.db` | The SQLite database: projects, requirements, tasks, links, events, settings |
| `requirements/REQ-001.md` | A markdown copy of each requirement, written when it is created |
| `projects.yaml` | Optional. Projects to register at every start (see [02](02-projects-and-engines.md#seed-projects-from-projectsyaml)) |
| `backups/` | A copy of `bridge.db`, made automatically before the database is upgraded |

The folder is set by the `WORKSPACE_DIR` environment variable. Its default is `./workspace`
**relative to the folder the server starts in**. With `npm run dev` or `npm run dev:server` the
server starts in `packages/server`, so the default is `packages/server/workspace`.

To keep your data in one known place, set an absolute path:

```bash
WORKSPACE_DIR=/Users/you/sp-kickstack-data npm run dev
```

Backups are named `bridge-<time>-v<old version>.db`, for example
`bridge-2026-10-11T08-30-00-000Z-v5.db`. One is made only when an existing database needs an
upgrade, which happens when you start a newer version of SP Kickstack. To go back, stop the
server and copy a backup over `bridge.db`.

`npm run mcp` (the MCP server for AI tools) reads the same `WORKSPACE_DIR`. It starts in the
repository root, so without the variable it uses a different folder (`./workspace` at the root).
Set `WORKSPACE_DIR` to the same absolute path for both.

The MCP tools work inside one workspace at a time: `sp_list_projects` and `sp_create_requirement`
take a `workspace_id` and use the `default` workspace when it is missing (see
[MCP server](09-settings-and-environment.md#mcp-server)).

## Other scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds the shared types, server, web app and the `xticket` CLI |
| `npm run verify` | Type-checks everything and runs the tests (use Node 22.19.0) |
| `npm test` | Runs the tests only |

## Next steps

- [Projects and engines](02-projects-and-engines.md): connect real repositories and engines.
- [Agents, tickets and questions](04-agents-tickets-and-questions.md): set up the `xticket` CLI
  for your agents.
- [Notifications](07-notifications.md): get told on Slack, Telegram or a webhook when a person is
  needed.
