# Implementation Plan: SP Kickstack (DevFlow Bridge)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build **SP Kickstack (DevFlow Bridge)**, a thin cross-repository orchestration bridge connecting per-repo autonomous agent engines (Stoneforge / Cline Kanban / Manual), enabling central requirement fan-out, inter-repo dependency coordination via `xticket` and file outbox, Agile Scrum sprint governance, shared workspace asset contracts, and a unified status dashboard.

**Architecture:** Monorepo with npm workspaces (`packages/shared`, `packages/server`, `packages/xticket`, `packages/web`). Express + TypeScript backend with SQLite (`better-sqlite3`, WAL mode) tracking links, requirement lifecycles, and normalized task status; engine adapters querying per-repo engine instances; CLI and worktree file-outbox handling cross-repo tickets; React 18 + Vite + shadcn/ui + Radix UI dashboard with live Server-Sent Events (SSE) updates, Kanban boards, and Agile Sprint governance.

**Tech Stack:** Node.js 24, TypeScript 5, Express, SQLite (`better-sqlite3`), Zod, Pino, Vitest, Supertest, React 18, Vite, Tailwind CSS, Radix UI / shadcn/ui, TanStack Query, date-fns, react-day-picker.

---

## Global Constraints

- **Engine Isolation**: The bridge NEVER executes agent runs, git worktree creation, or repo file modifications directly; execution is delegated to per-repo engines via the `EngineAdapter` interface.
- **Network Safety**: Bind Bridge and local engines to `127.0.0.1` by default.
- **Untrusted Input Hygiene**: Requirement bodies, ticket content, and agent summaries are always wrapped in `<untrusted_input>` tags when passed to engines.
- **Resilience**: The Bridge must be fully recoverable after a restart by rebuilding task state from engines.
- **Deterministic Testing**: All unit and integration tests run against an in-process `FakeEngine` HTTP server with zero external dependencies.
- **Scrum Invariants**: Single active sprint constraint per workspace; uncompleted tasks automatically roll over to the Product Backlog on sprint completion.

---

## Key Refinements & Architecture Updates

> [!IMPORTANT]
> **Key Architecture Additions Implemented in Recent Updates:**
> 1. **Dual Transport for `xticket`**: The agent CLI attempts localhost HTTP (`127.0.0.1:4100`), falling back to `.devflow/outbox/*.json` file in the worktree if sandboxing blocks loopback network. The watcher processes both seamlessly.
> 2. **Checkpointing Before Suspension**: When filing a blocking ticket, instructions prompt the agent to create a WIP commit (`git commit -m "wip: blocked on xticket"`) so resumption tasks have clean git diff context.
> 3. **Per-Ticket Merge Policy**: Individual requirements can override the workspace default merge policy (`manual_review_merge` vs `auto_merge_main`), enabling low-risk chores to auto-merge while locking critical specs behind human review.
> 4. **Central Attachments & Shared Assets Hub**: ClickUp-style `/attachments` page with ticket attachments and workspace-level shared contracts (`openapi.yaml`, shared models) injected into prompt contexts.
> 5. **Scrum Sprints & Backlog Governance**: Full sprint lifecycle management (`sprints` table, `SprintService`, active sprint exclusivity, backlog rollover, and Radix UI date picker).
> 6. **Interactive DataTable & Kanban Board UI**: Unified requirement views with quick grouping, status transitions, search, and slide-out detail sheet drawers.

---

## Current Project Layout

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
│   │       ├── services/                 # Project, Requirement, FanOut, Ticket, Link, Sprint
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
├── docs/
│   ├── devflow-bridge-spec.md            # Primary specification document
│   ├── plans/                            # Core implementation plans
│   └── superpowers/                      # Feature specifications & execution plans
└── test/
    └── e2e/                              # End-to-end integration acceptance tests
```

---

## Phased Implementation Roadmap

### Phase 1: Monorepo Foundation & Shared Package (Completed)

- [x] **Task 1.1: Root Monorepo Configuration**
  - Created root `package.json` with npm workspaces (`packages/*`), base dependencies, and build scripts.
  - Configured base `tsconfig.json` with strict type checking and project references.
  - Setup `.gitignore` for node_modules, build artifacts, SQLite database files, and `.devflow`.
- [x] **Task 1.2: `@sp-kickstack/shared` Package**
  - Implemented Zod schemas and TypeScript types for Project config, Normalized Statuses, Requirements, Tasks, Tickets, and Bridge Events.
  - Unit tests verifying schema validations in `packages/shared/src/schemas.test.ts`.

---

### Phase 2: Server Database Layer & Engine Adapters (Completed)

- [x] **Task 2.1: SQLite Database Engine (`packages/server/src/db`)**
  - Setup `better-sqlite3` with WAL mode, foreign key enforcement, and automated migrations.
  - Created tables: `projects`, `requirements`, `requirement_projects`, `bridge_tasks`, `links`, `events`, `settings`.
  - Added indexes: `idx_events_req_id`, `idx_events_at`, `idx_bridge_tasks_engine`.
  - Verified migrations and cascades in `packages/server/src/db/db.test.ts`.
- [x] **Task 2.2: Adapter Interface & Fake Engine Test Harness**
  - Defined `EngineAdapter` interface (`createGoal`, `createTask`, `getTask`, `listTasks`, `holdTask`, `releaseTask`, `cancelTask`, `health`).
  - Implemented `FakeEngineServer`: in-memory HTTP mock engine simulating Stoneforge endpoints.
  - Implemented `ManualAdapter` (human operator acts as engine for fallback or testing).
  - Implemented `StoneforgeAdapter` utilizing engine HTTP endpoints (`/api/tasks`) with `execa` CLI fallback (`sf task ...`).

---

### Phase 3: Core Bridge Services & Watcher (Completed)

- [x] **Task 3.1: Project & Requirement Services**
  - `ProjectService`: register, list, seed from `projects.yaml`, test engine connection.
  - `RequirementService`: create `REQ-*.md` in `workspace/requirements/`, update status, revision handling, state derivation.
- [x] **Task 3.2: Fan-Out Service**
  - Implemented `FanOutService.execute(reqId)`: queries affected projects, idempotently creates goal tasks in target engines, encapsulates prompts in `<untrusted_input>`, and handles retries.
- [x] **Task 3.3: Watcher Engine Synchronization**
  - Implemented `EngineWatcher`: periodic poll loop across registered engines, normalizes raw engine statuses, writes to `events` table, and recalculates requirement status.

---

### Phase 4: Cross-Repo Ticketing (`xticket`) & Link Management (Completed)

- [x] **Task 4.1: Link Service & Dependency State Machine**
  - Implemented `LinkService`: link lifecycle (`waiting` -> `ready` -> `released`), topological cycle detection, releasing held source tasks with upstream context markdown.
- [x] **Task 4.2: Ticket Service & Outbox Handler**
  - Implemented `TicketService`: validation of target project, depth limit (`MAX_DEPTH = 3`), ticket cap, creating target and waiting tasks.
  - Implemented Outbox Scanner: watches worktree `.devflow/outbox/*.json` files and ingests them.
- [x] **Task 4.3: `xticket` CLI Package (`packages/xticket`)**
  - Standalone CLI commands: `create`, `status`, `list`.
  - Checks localhost API first; falls back to `.devflow/outbox/ticket-<timestamp>.json`.

---

### Phase 5: Express API, Auth & Real-Time SSE (Completed)

- [x] **Task 5.1: REST API Routes & Middlewares**
  - Express server with Helmet, CORS, and Zod request validation.
  - Endpoints: `/api/projects`, `/api/requirements`, `/api/tasks`, `/api/links`, `/api/tickets`, `/api/health`.
  - Integration tests in `packages/server/src/api/api.test.ts`.
- [x] **Task 5.2: Real-time SSE & Notification Hub**
  - SSE endpoint `/api/events` broadcasting task state updates and link changes.
  - Notification Service with in-app notifications and webhook dispatchers (Telegram, Slack).

---

### Phase 6: Web Dashboard UI (`packages/web`) (Completed)

- [x] **Task 6.1: Vite + React + shadcn/ui Scaffolding**
  - Configured Tailwind CSS, Radix UI primitives, Lucide icons, Sonner toast, and React Router.
  - Built App Shell (Sidebar, Header with notifications, connection status pill).
- [x] **Task 6.2: Requirement Authoring & Detail Views**
  - `/requirements/new` form with markdown preview and project multi-select.
  - `/requirements/:id` multi-column dashboard with task cards, deep links, dependency links, and link actions.
- [x] **Task 6.3: Projects & Settings Pages**
  - `/projects`: Project list with engine health status dots and "Test Connection".
  - `/settings`: Configuration for watch intervals, limits, and webhooks.

---

### Phase 7: End-to-End Acceptance Verification (Completed)

- [x] **Task 7.1: Automated Acceptance Test Suite**
  - Multi-engine test scenario verifying fan-out to `backend` and `mobile`, `xticket` blocking task creation, engine completion detection, mobile unblocking with upstream context, and state restoration.

---

### Phase 8: Scrum Sprints, Merge Policy & Attachments Hub (Completed / Stabilizing)

- [x] **Task 8.1: Per-Ticket Merge Policy & Shared Workspace Assets**
  - Granular merge policy (`manual_review_merge` vs `auto_merge_main`) in `RequirementSchema` and database migrations.
  - `shared_assets` table and Central Attachments Hub (`/attachments`) with Ticket Attachments and Shared Workspace Assets tabs.
  - Shared assets and merge policies injected directly into agent fan-out prompts.
- [x] **Task 8.2: Agile Scrum Sprints & Product Backlog Governance**
  - `sprints` table and `requirements.sprint_id` migration.
  - `SprintService` with single active sprint enforcement and automatic unfinished ticket rollover to Product Backlog.
  - REST endpoints: `/api/sprints`, `/api/sprints/:id/start`, `/api/sprints/:id/complete`, `/api/requirements/:id/sprint`.
  - Radix UI Date Picker (`react-day-picker` + `date-fns`) for sprint date range selection.
- [x] **Task 8.3: Unified Interactive DataTable & Board Views**
  - Dual view toggle (Kanban Board vs Interactive DataTable) on `/requirements`.
  - Top tab filters: `Active Sprint`, `Product Backlog`, `All Requirements`.
  - In-table status and sprint reassignment dropdowns.

---

### Phase 9: Real-World Engine Spikes & Live Sandbox Validation (Immediate Next Phase)

> **Objective:** Transition from mock in-memory harnesses (`FakeEngineServer`) to real running multi-repo engine instances (Stoneforge / Cline Kanban / Manual) to validate the 8 critical questions in `docs/devflow-bridge-spec.md §14`.

- [ ] **Task 9.1: Workspace Stabilization & ABI Alignment**
  - **Files:** `packages/web/src/components/RequirementDetailSheet.tsx`, `packages/web/src/pages/RequirementsPage.tsx`
  - Reconcile `RequirementDetailSheet.tsx` types (access `goal` and `acceptance_criteria` via markdown body parser helper or extend DTO response).
  - Run `npm rebuild better-sqlite3` to align Node ABI versions across test environments.
  - Verify clean monorepo build (`npm run build`) and test suite (`npm test`).

- [ ] **Task 9.2: Live Multi-Repo Engine Spike Harness**
  - **Files:** `scripts/spike-setup.sh`, `docs/spike-results.md`
  - Initialize two local scratch git repositories: `test-backend` and `test-frontend`.
  - Run local engine instances:
    - Backend: `sf serve --port 3457`
    - Frontend: `sf serve --port 3477`
  - Register both in bridge via `/api/projects` and confirm green health checks.
  - **Spike Q1 Verification:** Test whether human merge gating prevents unauthorized automatic squashes.
  - **Spike Q3 Verification:** Verify that `holdTask` (`sf task defer`) and `releaseTask` (`sf task undefer`) successfully pause/resume task workers over HTTP.

- [ ] **Task 9.3: Live Agent `xticket` Dual-Transport Sandbox Testing**
  - **Files:** `packages/xticket/src/cli.ts`, `packages/server/src/watcher/outboxScanner.ts`
  - Test Case A (Unrestricted / Permissive): Agent runs `xticket create --to test-backend --title "Add Auth"` with loopback HTTP enabled.
  - Test Case B (Restricted Sandbox): Block loopback; verify CLI automatically falls back to writing `.devflow/outbox/ticket-<timestamp>.json`.
  - Verify Outbox Scanner picks up file within 5 seconds, processes ticket, and deletes/archives the drop file.
  - Verify agent prompts instruct WIP commit: `git commit -m "wip: blocked on xticket"`.

- [ ] **Task 9.4: Engine Downtime & Bridge Crash Recovery Verification**
  - Kill one running engine (`kill -9`) during task execution; verify bridge marks project as `engine_status: 'down'` without dropping links or creating false `failed` states.
  - Restart bridge process while tasks are running; verify bridge polls engines and reconstructs accurate active status without re-triggering duplicate fan-outs.
  - Record all findings in `docs/spike-results.md`.

---

### Phase 10: Visual DAG Canvas, External VCS & Issue Sync (Milestone M5)

> **Objective:** Deliver enterprise-grade visibility and external team integration.

- [ ] **Task 10.1: Interactive Visual DAG Topology Canvas**
  - **Files:** `packages/web/src/components/DependencyGraphCanvas.tsx`, `packages/web/src/pages/RequirementDetailPage.tsx`
  - Embed an interactive node-graph canvas (using `@xyflow/react` / React Flow or SVG DAG renderer).
  - Visually depict fan-out branches from requirement to project goal tasks, `xticket` blocking link arrows, and upstream context delivery flows.
  - Allow operators to click link edges to trigger `Release`, `Retry`, or `Cancel`.

- [ ] **Task 10.2: GitHub PR & Issue Bi-Directional Webhook Sync**
  - **Files:** `packages/server/src/services/vcsSyncService.ts`, `packages/server/src/api/webhooks.ts`
  - Webhook endpoint `/api/webhooks/github` receiving PR open/merge events.
  - Automatically transition requirement tasks to `in_review` when agent opens a PR.
  - Automatically mark task `done` and trigger downstream `LinkService.checkAndReleaseDependents()` when PR merges.

- [ ] **Task 10.3: Sprint Burndown & Agent Telemetry Dashboard**
  - **Files:** `packages/web/src/components/SprintBurndownChart.tsx`, `packages/server/src/services/metricsService.ts`
  - Compute Sprint Velocity, daily burndown (estimated vs completed requirements), and agent cycle time.
  - Calculate "Blockage Latency" (average duration tasks spend in `held` waiting for cross-repo tickets).

---

## Verification Plan

### Automated Suite
```bash
# Clean build across all monorepo packages
npm run build

# Unit and integration test suite
npm test

# Type checking
npm run typecheck
```

### Live Engine Spike Verification Protocol
1. Start scratch engine instances: `sf serve --port 3457` (backend) and `sf serve --port 3477` (frontend).
2. Register projects in SP Kickstack UI: `http://localhost:4100/projects`.
3. Create sprint `Sprint 1` and requirement `REQ-001` affecting both repos.
4. Trigger Fan-Out and observe goal tasks dispatched to both engine consoles.
5. In frontend agent console, run `xticket create --to backend --title "API Model" --blocking`.
6. Confirm backend receives ticket, frontend task enters `held`, and Bridge UI displays dependency link.
7. Merge backend task; observe watcher detect completion, unblock frontend hold, and deliver upstream diff context.
