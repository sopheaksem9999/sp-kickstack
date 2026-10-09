# Scrum Sprints & Product Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full Scrum (Agile) project management for SP-Kickstack, separating requirements into an Active Sprint Board with goals & progress metrics and a Product Backlog with quick sprint assignment and rollover logic on sprint completion.

**Architecture:** Extend SQLite database with `sprints` table and `requirements.sprint_id` foreign key. Implement `SprintService` with strict Scrum lifecycle governance (only 1 active sprint per workspace, unfinished tickets rollover to Backlog on sprint completion). Expose Express REST API endpoints and integrate into the ClickUp-styled frontend with Sprint Board and Backlog tabs, a Sprint creation dialog, and sprint selectors on requirement cards and detail views.

**Tech Stack:** TypeScript, SQLite (`better-sqlite3`), Express, Zod, React 18, Vite, Tailwind CSS, TanStack Query, Vitest.

## Global Constraints
- Single active sprint constraint per workspace.
- Completing a sprint automatically rolls unfinished requirements (`status != 'done'`) back to the Product Backlog (`sprint_id = NULL`).
- Preserves full zero-downtime database migration compatibility for existing data.
- Monorepo tests must pass (`vitest run` in ~400ms) with zero TypeScript build errors.

---

## File Structure

### Modified Files:
- `packages/shared/src/schemas.ts`: Add `SprintSchema`, `CreateSprintInputSchema`, `UpdateSprintInputSchema`, and update `RequirementSchema` / `CreateRequirementInputSchema` with `sprint_id`.
- `packages/shared/src/types.ts`: Export inferred TypeScript types.
- `packages/server/src/db/schema.ts`: Define `sprints` table schema and index.
- `packages/server/src/db/index.ts`: Add automated schema migration for `sprints` and `requirements.sprint_id`.
- `packages/server/src/api/app.ts`: Add Sprint REST endpoints (`/api/sprints`, `/api/sprints/:id/start`, `/api/sprints/:id/complete`, `/api/requirements/:id/sprint`).
- `packages/web/src/lib/api.ts`: Add client fetchers for sprints and requirement sprint assignment.
- `packages/web/src/components/CreateRequirementSheet.tsx`: Add Sprint dropdown selector.
- `packages/web/src/pages/RequirementDetailPage.tsx`: Add Sprint badge and interactive re-assignment selector.
- `packages/web/src/pages/RequirementsPage.tsx`: Add Sprint Board (Active Sprint) and Product Backlog tabs with Sprint banner and progress bar.

### Created Files:
- `packages/server/src/services/sprintService.ts`: Core Scrum sprint business logic, validation, lifecycle, and rollover engine.
- `packages/server/src/services/sprint.test.ts`: Integration and unit tests for sprint lifecycle, active sprint exclusivity, and backlog rollover.
- `packages/web/src/components/CreateSprintModal.tsx`: Modal dialog for creating and planning a new sprint.

---

## Phased Tasks

### Task 1: Shared Schemas & Database Migration

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/index.ts`
- Test: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Add Sprint Zod schemas and update requirement schemas**
  - Add `SprintStatusSchema` (`'planned' | 'active' | 'completed'`).
  - Add `SprintSchema`, `CreateSprintInputSchema`, `UpdateSprintInputSchema`.
  - Add `sprint_id: z.string().nullable().optional()` to `CreateRequirementInputSchema` and `RequirementSchema`.
- [ ] **Step 2: Add database migration in `initDatabase`**
  - In `schema.ts`, define `sprints` table with `id`, `workspace_id`, `name`, `goal`, `start_date`, `end_date`, `status`, timestamps.
  - In `index.ts`, check `requirements` columns and add `sprint_id TEXT DEFAULT NULL REFERENCES sprints(id) ON DELETE SET NULL;`.
- [ ] **Step 3: Run schema tests**
  - Verify `npm test` passes.

---

### Task 2: SprintService & Scrum Lifecycle Engine

**Files:**
- Create: `packages/server/src/services/sprintService.ts`
- Create: `packages/server/src/services/sprint.test.ts`

- [ ] **Step 1: Write integration tests for SprintService in `sprint.test.ts`**
  - Test creating a sprint in a workspace.
  - Test starting a sprint and ensuring only 1 sprint is active.
  - Test moving a requirement into a sprint and back to Backlog.
  - Test completing a sprint: verify finished tasks stay in sprint and unfinished tasks rollover to Backlog (`sprint_id = NULL`).
- [ ] **Step 2: Implement `SprintService`**
  - Implement `listSprints(workspaceId)`, `getActiveSprint(workspaceId)`.
  - Implement `createSprint(input)`, `updateSprint(id, input)`.
  - Implement `startSprint(id)`, `completeSprint(id)`.
  - Implement `assignRequirementSprint(reqId, sprintId)`.
- [ ] **Step 3: Run tests to verify all pass**
  - Run `npx vitest run packages/server/src/services/sprint.test.ts`.

---

### Task 3: Server API Endpoints & Registration

**Files:**
- Modify: `packages/server/src/api/app.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/api/api.test.ts`

- [ ] **Step 1: Add routes in `app.ts`**
  - `GET /api/sprints`
  - `POST /api/sprints`
  - `PUT /api/sprints/:id`
  - `POST /api/sprints/:id/start`
  - `POST /api/sprints/:id/complete`
  - `PUT /api/requirements/:id/sprint`
- [ ] **Step 2: Wire `sprintService` in `index.ts` and test helper**
- [ ] **Step 3: Add API integration tests in `api.test.ts` and run test suite**
  - Run `npm test`.

---

### Task 4: Frontend API Helpers & Modals

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/components/CreateSprintModal.tsx`
- Modify: `packages/web/src/components/CreateRequirementSheet.tsx`
- Modify: `packages/web/src/pages/RequirementDetailPage.tsx`

- [ ] **Step 1: Add sprint API client methods in `api.ts`**
  - `fetchSprints`, `createSprint`, `startSprint`, `completeSprint`, `updateRequirementSprint`.
- [ ] **Step 2: Create `CreateSprintModal.tsx`**
  - Modal with Name, Sprint Goal, Start Date, End Date, and Workspace picker.
- [ ] **Step 3: Add Sprint `<select>` to `CreateRequirementSheet.tsx`**
  - Dropdown populated with active & planned sprints + "Product Backlog (No Sprint)".
- [ ] **Step 4: Add Sprint badge & reassignment to `RequirementDetailPage.tsx`**
  - Header badge with interactive menu to reassign or remove to Backlog.

---

### Task 5: Requirements Page Scrum Tabs (Sprint Board & Product Backlog)

**Files:**
- Modify: `packages/web/src/pages/RequirementsPage.tsx`

- [ ] **Step 1: Add Top Tab Switcher (`🏃 Active Sprint` / `📋 Product Backlog` / `All Requirements`)**
- [ ] **Step 2: Build Active Sprint Header Banner**
  - Name, Goal, dates, completion progress bar (`X of Y tasks done`), and "Complete Sprint" button.
- [ ] **Step 3: Build Product Backlog View**
  - Backlog items list, "+ Create Sprint" button, and "Move to Sprint" action dropdowns.
- [ ] **Step 4: Build web workspace**
  - Run `npm run --workspace=@sp-kickstack/web build`.

---

### Task 6: Full Verification, Monorepo Build & Git Push

- [ ] **Step 1: Run full test suite (`npm test`)**
- [ ] **Step 2: Run full monorepo build (`npm run build`)**
- [ ] **Step 3: Refresh graft graph (`graft build`)**
- [ ] **Step 4: Commit and push changes to `origin main`**
