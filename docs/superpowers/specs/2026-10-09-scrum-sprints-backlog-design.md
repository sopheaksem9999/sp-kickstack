# Design Specification: Scrum Sprints & Product Backlog Management

**Date:** 2026-10-09  
**Status:** Approved  
**Author:** Antigravity & User  

---

## 1. Overview & Goals

This specification details the implementation of **Scrum (Agile) Project Management** for SP-Kickstack:
1. **Sprints & Backlog Separation**:
   - A dedicated **Active Sprint Board** for focused iterative delivery with goal and date tracking.
   - A dedicated **Product Backlog** for unassigned and future-planned requirements.
2. **Strict Scrum Lifecycle Governance**:
   - Sprint lifecycle states: `planned`, `active`, and `completed`.
   - Single-active-sprint constraint per workspace.
   - When completing an active sprint, finished requirements stay marked as done, while unfinished items automatically roll back into the Product Backlog (`sprint_id = NULL`).
3. **Seamless Ticket Assignment**:
   - Select Sprint (`Product Backlog` or active/planned sprint) on the requirement creation sheet.
   - Quick "Move to Sprint" action in the Backlog view.
   - Interactive sprint re-assignment dropdown on the requirement detail page.

---

## 2. Architecture & Data Model

### 2.1 Shared Schemas (`packages/shared/src/schemas.ts` & `types.ts`)

```typescript
export const SprintStatusSchema = z.enum(['planned', 'active', 'completed']);

export const SprintSchema = z.object({
  id: z.string(),
  workspace_id: z.string().default('default'),
  name: z.string().min(1),
  goal: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  status: SprintStatusSchema.default('planned'),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateSprintInputSchema = z.object({
  workspace_id: z.string().default('default'),
  name: z.string().min(1),
  goal: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const UpdateSprintInputSchema = z.object({
  name: z.string().min(1).optional(),
  goal: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});
```

- Add `sprint_id: z.string().nullable().optional()` to `CreateRequirementInputSchema` and `RequirementSchema`.

### 2.2 SQLite Database Engine (`packages/server/src/db/`)

```sql
CREATE TABLE IF NOT EXISTS sprints (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  goal         TEXT,
  start_date   TEXT,
  end_date     TEXT,
  status       TEXT NOT NULL DEFAULT 'planned',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sprints_workspace ON sprints(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status);
```

- Migration in `initDatabase()`:
  - Add `sprint_id TEXT DEFAULT NULL REFERENCES sprints(id) ON DELETE SET NULL` to `requirements`.

### 2.3 Server Services & REST API (`packages/server`)

#### `SprintService` (`packages/server/src/services/sprintService.ts`):
- `listSprints(workspaceId?: string)`
- `getActiveSprint(workspaceId: string)`
- `createSprint(input: CreateSprintInput)`
- `updateSprint(id: string, input: UpdateSprintInput)`
- `startSprint(id: string)`:
  - Checks if another sprint in the workspace is active; if so, rejects or auto-completes it.
  - Sets target sprint `status = 'active'`.
- `completeSprint(id: string)`:
  - Sets sprint `status = 'completed'`.
  - Finds all requirements where `sprint_id = id` and `status != 'done'`.
  - Sets `sprint_id = NULL` on these unfinished requirements (rollover to Backlog).
- `assignRequirementSprint(reqId: string, sprintId: string | null)`:
  - Updates `requirements.sprint_id` for that requirement.

#### API Endpoints (`packages/server/src/api/app.ts`):
- `GET /api/sprints?workspace=...`
- `POST /api/sprints`
- `PUT /api/sprints/:id`
- `POST /api/sprints/:id/start`
- `POST /api/sprints/:id/complete`
- `PUT /api/requirements/:id/sprint` (Body: `{ sprint_id: string | null }`)

---

## 3. Frontend Scrum UI Experience (`packages/web`)

### 3.1 Requirements Page: Sprints & Backlog Tabs
- Top Tab bar:
  - **🏃 Active Sprint (Sprint Board)**:
    - If active sprint exists:
      - Banner with sprint name, goal, dates, and completion progress (`N of Total tasks done`).
      - "Complete Sprint" button triggering confirmation dialog.
      - Kanban/grouped view of sprint requirements.
    - If no active sprint:
      - Empty state with "No active sprint. Plan one from the Backlog" and button to switch to Backlog.
  - **📋 Product Backlog**:
    - Header with "+ Create Sprint" button.
    - Backlog requirement cards with quick "Move to Sprint" selector.
    - Planned future sprint sections displaying assigned tickets with a "Start Sprint" action.

### 3.2 CreateRequirementSheet Updates
- Add a **Sprint** selector (`<select>`):
  - Option `Product Backlog (No Sprint)`
  - Active sprint (highlighted with 🏃)
  - Planned future sprints

### 3.3 RequirementDetailPage Updates
- Displays sprint badge in header next to state and priority.
- Interactive dropdown to switch sprint or return to Backlog.

---

## 4. Phased Implementation Plan

1. **Phase 1**: Shared schemas & database migration (`sprints` table, `requirements.sprint_id`).
2. **Phase 2**: `SprintService` with lifecycle rules (start, complete rollover, assignment) and unit/integration tests.
3. **Phase 3**: Server REST API endpoints and integration tests.
4. **Phase 4**: Frontend API helpers, Sprint creation modal, and Sprint dropdown in `CreateRequirementSheet` & `RequirementDetailPage`.
5. **Phase 5**: Requirements page Sprint Board & Backlog tabs with real-time updates and progress metrics.
6. **Phase 6**: Verification, test suite run, and git commit/push.
