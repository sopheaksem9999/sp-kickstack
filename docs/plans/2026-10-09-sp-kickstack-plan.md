# Implementation Plan: SP Kickstack (DevFlow Bridge)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build **SP Kickstack (DevFlow Bridge)**, a thin cross-repository orchestration bridge connecting per-repo autonomous agent engines (Stoneforge / Cline Kanban / Manual), enabling central requirement fan-out, inter-repo dependency coordination via `xticket` and file outbox, and a unified status dashboard.

**Architecture:** Monorepo with npm workspaces (`packages/shared`, `packages/server`, `packages/xticket`, `packages/web`). Express + TypeScript backend with SQLite (`better-sqlite3`, WAL mode) tracking links and normalized status; adapters querying per-repo engine instances; CLI and worktree file-outbox handling cross-repo tickets; React 18 + Vite + shadcn/ui dashboard.

**Tech Stack:** Node.js 24, TypeScript 5, Express, SQLite (`better-sqlite3`), Zod, Pino, Vitest, Supertest, React 18, Vite, Tailwind CSS, Radix UI / shadcn/ui, TanStack Query.

---

## Global Constraints

- **Engine Isolation**: The bridge NEVER executes agent runs, git worktree creation, or repo file modifications directly; execution is delegated to per-repo engines via the `EngineAdapter` interface.
- **Network Safety**: Bind Bridge and local engines to `127.0.0.1` by default.
- **Untrusted Input Hygiene**: Requirement bodies, ticket content, and agent summaries are always wrapped in `<untrusted_input>` tags when passed to engines.
- **Resilience**: The Bridge must be fully recoverable after a restart by rebuilding task state from engines.
- **Deterministic Testing**: All unit and integration tests run against an in-process `FakeEngine` HTTP server with zero external dependencies.

---

## User Review Required

> [!IMPORTANT]
> **Key Refinements Incorporated from Spec Review:**
> 1. **Dual Transport for `xticket`**: The agent CLI will attempt localhost HTTP (`127.0.0.1:4100`), falling back to a `.devflow/outbox/*.json` file in the worktree if sandboxing blocks loopback network. The watcher will process both seamlessly.
> 2. **Checkpointing Before Suspension**: When filing a blocking ticket, instructions will prompt the agent to create a WIP commit (`git commit -m "wip: blocked on xticket"`) so resumption tasks have clean git diff context.
> 3. **Database Indexing & Safety**: Added missing indices on `events(req_id)` and `bridge_tasks(project, engine_task_id)` and removed `title` from the raw SQL unique constraint to prevent crashes on duplicate ticket names (handled instead at service layer).

---

## Proposed Project Layout

```
SP-Kickstack/
├── package.json                          # npm workspaces: packages/*
├── tsconfig.json                         # Base TypeScript configuration
├── workspace/
│   ├── requirements/                     # Canonical REQ-*.md requirement files
│   └── bridge.db                         # SQLite database file
├── packages/
│   ├── shared/                           # Shared schemas, DTOs, types, enums
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/{index.ts, schemas.ts, types.ts}
│   ├── server/                           # Express REST API, SQLite, Watcher, Adapters
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── config.ts                 # Port, paths, env vars
│   │       ├── db/                       # Schema, migrations, database singleton
│   │       ├── adapters/                 # EngineAdapter, Stoneforge, Manual, Fake
│   │       ├── services/                 # Project, Requirement, FanOut, Ticket, Link
│   │       ├── watcher/                  # Engine sync poller & outbox scanner
│   │       ├── notify/                   # In-app, webhooks
│   │       ├── sse/                      # Real-time event broadcasting
│   │       ├── api/                      # Express route controllers & middlewares
│   │       └── index.ts                  # Server entrypoint
│   ├── xticket/                          # CLI tool distributed to agent environments
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/{index.ts, cli.ts}
│   └── web/                              # React 18 + Vite + Tailwind + shadcn/ui
│       ├── package.json
│       ├── vite.config.ts
│       └── src/{App.tsx, components/, pages/, lib/}
└── test/
    └── e2e/                              # End-to-end integration acceptance tests
```

---

## Phased Implementation Tasks

### Phase 1: Monorepo Foundation & Shared Package

- [ ] **Task 1.1: Root Monorepo Configuration**
  - Create root `package.json` with npm workspaces (`packages/*`), base dependencies, and build scripts.
  - Create base `tsconfig.json` with strict type checking and project references.
  - Setup `.gitignore` for node_modules, build artifacts, SQLite database files, and `.devflow`.

- [ ] **Task 1.2: `@sp-kickstack/shared` Package**
  - Implement Zod schemas and TypeScript types for:
    - Project config (`Project`, `EngineType`, `DoneMeans`)
    - Normalized Statuses (`pending`, `queued`, `running`, `needs_human`, `held`, `in_review`, `done`, `failed`, `cancelled`)
    - Requirement schemas (`Requirement`, `RequirementStatus`, `Priority`)
    - Task schemas (`BridgeTask`, `TaskRole`)
    - Ticket requests (`CreateTicketInput`, `TicketResponse`)
    - Event schemas (`BridgeEvent`, `EventType`)
  - Add unit tests verifying schema validations.

---

### Phase 2: Server Database Layer & Engine Adapters

- [ ] **Task 2.1: SQLite Database Engine (`packages/server/src/db`)**
  - Setup `better-sqlite3` with WAL mode, foreign key enforcement, and automated migrations.
  - Create tables: `projects`, `requirements`, `requirement_projects`, `bridge_tasks`, `links`, `events`, `settings`.
  - Add indexes: `idx_events_req_id`, `idx_events_at`, `idx_bridge_tasks_engine`.
  - Implement repository helpers with transactional guarantees.
  - Unit test DB migrations and foreign key cascades.

- [ ] **Task 2.2: Adapter Interface & Fake Engine Test Harness**
  - Define `EngineAdapter` interface (`createGoal`, `createTask`, `getTask`, `listTasks`, `holdTask`, `releaseTask`, `cancelTask`, `health`).
  - Implement `FakeEngineServer`: an in-memory HTTP mock engine simulating Stoneforge endpoints, enabling full state manipulation in tests.
  - Implement `ManualAdapter` (human operator acts as engine for fallback or testing).
  - Implement `StoneforgeAdapter` utilizing engine HTTP endpoints (`/api/tasks`) with `execa` CLI fallback (`sf task ...`).
  - Unit test all adapters against `FakeEngineServer`.

---

### Phase 3: Core Bridge Services & Watcher

- [ ] **Task 3.1: Project & Requirement Services**
  - `ProjectService`: register, list, seed from `projects.yaml`, test engine connection.
  - `RequirementService`: create `REQ-*.md` in `workspace/requirements/`, update status, revision handling, state derivation.
  - Unit tests for sequential requirement generation and markdown formatting.

- [ ] **Task 3.2: Fan-Out Service**
  - Implement `FanOutService.execute(reqId)`:
    - Queries affected projects.
    - Idempotently creates goal tasks in target engines via adapters.
    - Encapsulates prompt template in `<untrusted_input name="requirement">`.
    - Handles retry with exponential backoff on engine failure.
  - Unit test fan-out idempotency and retry behavior.

- [ ] **Task 3.3: Watcher Engine Synchronization**
  - Implement `EngineWatcher`:
    - Periodic poll loop (`WATCH_INTERVAL_MS = 5000`) across all registered engines.
    - Normalizes raw engine task statuses to `NormStatus`.
    - Detects state transitions, writes to `events` table, and recalculates requirement status.
    - Handles engine downtime gracefully (`engine_status: 'down'`) without false state modifications.
  - Integration test watcher with `FakeEngineServer` simulating task progress from `queued` -> `running` -> `done`.

---

### Phase 4: Cross-Repo Ticketing (`xticket`) & Link Management

- [ ] **Task 4.1: Link Service & Dependency State Machine**
  - Implement `LinkService`:
    - Link lifecycle: `waiting` -> `ready` -> `released`.
    - Cycle detection using topological check.
    - `releaseTask`: releases held source tasks and formats upstream context markdown template.
    - Handling dependency failure: transition to `error`, notify operator with retry/cancel actions.
  - Unit test cycle rejection, multi-dependent releases, and error transitions.

- [ ] **Task 4.2: Ticket Service & Outbox Handler**
  - Implement `TicketService`:
    - Validates target project, depth limit (`MAX_DEPTH = 3`), ticket cap (`MAX_TICKETS_PER_REQ = 10`), payload size.
    - Creates target task (`role: ticket`) and source placeholder (`role: waiting`).
    - Creates linking dependency record in `links` table.
  - Implement Outbox Scanner: watches worktree directories for `.devflow/outbox/*.json` files and processes them identically to API calls.
  - Unit tests for limits, deduplication, and outbox file ingestion.

- [ ] **Task 4.3: `xticket` CLI Package (`packages/xticket`)**
  - Build standalone CLI:
    - Commands: `create`, `status`, `list`.
    - Checks localhost API first; if unavailable, writes `.devflow/outbox/ticket-<timestamp>.json`.
    - Outputs single-line JSON with standard exit codes (`0` ok, `2` validation error, `3` limit hit, `4` unreachable).
  - Test CLI end-to-end with mock bridge server.

---

### Phase 5: Express API, Auth & Real-Time SSE

- [ ] **Task 5.1: REST API Routes & Middlewares**
  - Implement Express server with Helmet, CORS, and Zod request validation.
  - Auth: Admin session cookie with CSRF; separate `agent` token for `/api/agent/tickets`.
  - Endpoints:
    - `/api/projects` (list, test connection)
    - `/api/requirements` (create, list, detail, ready, cancel, graph)
    - `/api/tasks` (list, mark-done for manual)
    - `/api/links` (retry, release, cancel)
    - `/api/tickets` and `/api/agent/tickets`
    - `/api/health`
  - Integration tests using Supertest covering all endpoints.

- [ ] **Task 5.2: Real-time SSE & Notification Hub**
  - SSE endpoint `/api/events` broadcasting task state updates and link changes to connected browser clients.
  - Notification Service:
    - In-app notification store in `events` table.
    - Webhook dispatcher (Telegram, Slack, generic webhook).
    - Failure safety: webhook dispatch errors never crash core business flow.

---

### Phase 6: Web Dashboard UI (`packages/web`)

- [ ] **Task 6.1: Vite + React + shadcn/ui Scaffolding**
  - Configure Tailwind CSS, Radix UI primitives, Lucide icons, and Sonner toast.
  - Setup React Router, TanStack Query, and SSE event listener hook.
  - Build App Shell (Sidebar, Header with notification bell, connection status pill).

- [ ] **Task 6.2: Requirement Authoring & Detail Views**
  - `/requirements/new`: Form with live markdown preview, acceptance criteria list, affected projects multi-select.
  - `/requirements`: List with status badges and project progress dots.
  - `/requirements/:id` (Main Dashboard):
    - Multi-column layout: one column per project showing task cards with normalized status badges.
    - Deep links ("Open in Engine") to logs and diffs.
    - Dependency links visualization ("Mobile #12 waiting for Backend #7").
    - Interactive Link actions (Release, Retry, Cancel).
    - Real-time live status updates via SSE.

- [ ] **Task 6.3: Projects & Settings Pages**
  - `/projects`: Project list with engine health status dots, Add/Edit dialog, "Test Connection" button.
  - `/settings`: Configuration for watch intervals, limits, notification webhooks with "Send Test".

---

### Phase 7: End-to-End Acceptance Verification

- [ ] **Task 7.1: Automated Acceptance Test Suite**
  - Write complete automated test simulating the MVP Acceptance Scenario:
    1. Register 2 fake engines (`backend`, `mobile`).
    2. Create `REQ-001` affecting both.
    3. Trigger fan-out; verify both receive goal tasks.
    4. Simulate mobile filing blocking ticket to backend.
    5. Verify backend receives ticket task and mobile is held.
    6. Simulate backend completing work and merging.
    7. Verify watcher detects completion, releases mobile hold, and delivers upstream context.
    8. Verify server restart causes zero state loss.

---

## Verification Plan

### Automated Tests
```bash
# Run unit & integration tests across all packages
npm run test

# Run end-to-end acceptance scenario against FakeEngine
npm run test:e2e

# Type check all packages
npm run typecheck
```

### Manual Verification
1. Launch Bridge server (`npm run dev:server`) and Web UI (`npm run dev:web`).
2. Open `http://localhost:4100` and view Project page with sample engines.
3. Create a requirement via the Web UI form, observe generated `workspace/requirements/REQ-001.md`.
4. Trigger fan-out and verify task columns render on Requirement Detail page.
5. Execute `xticket create --to backend --title "Test endpoint" --blocking` via CLI and observe real-time card updates on the dashboard.
