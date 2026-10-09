# Design Specification: Per-Ticket Merge Policy, Central Attachments Hub & Form UX Upgrades

**Date:** 2026-10-09  
**Status:** Approved  
**Author:** Antigravity & User  

---

## 1. Overview & Goals

This specification covers three interconnected improvements to the SP-Kickstack cross-repository orchestration bridge:
1. **Per-Ticket "Merge into Main" Policy**: Allow individual requirements/tickets to override the workspace default merge policy (e.g., enable Automatic Merge for low-risk chore tickets while requiring Manual Review for breaking/critical specs).
2. **Requirement Form UX & shadcn Sheet Animation**:
   - Smooth slide-in/slide-out animations using shadcn Sheet primitives (`@radix-ui/react-dialog` + `tailwindcss-animate`).
   - Clean `<select>` inputs for Requirement State and Priority.
   - Per-ticket Merge Policy `<select>`.
   - Editing affected projects both on the creation form and on existing requirements in the detail view.
3. **Central Attachments & Shared Assets Hub**:
   - A dedicated ClickUp-style `/attachments` page with two tabs:
     - **All Ticket Attachments**: Aggregated, searchable table of files uploaded across all requirements with direct links back to their parent specs.
     - **Shared Workspace Assets**: Workspace-wide contracts, schemas, and specs (`openapi.yaml`, diagrams) that can be uploaded once and automatically referenced by agent engines across all repos.

---

## 2. Architecture & Data Model

### 2.1 Shared Schemas (`packages/shared/src/schemas.ts` & `types.ts`)
- Add `merge_policy` (`z.enum(['manual_review_merge', 'auto_merge_main']).optional()`) to `RequirementSchema` and `CreateRequirementInputSchema`.
- Add `SharedAssetSchema`:
  ```ts
  export const SharedAssetSchema = z.object({
    id: z.string(),
    workspace_id: z.string(),
    name: z.string(),
    type: z.string(),
    size: z.number(),
    data_url: z.string(),
    notes: z.string().optional(),
    created_at: z.string(),
  });
  ```
- Add `UpdateRequirementProjectsInputSchema` and `UpdateRequirementMergePolicyInputSchema`.

### 2.2 SQLite Database Engine (`packages/server/src/db/`)
- `requirements` table migration:
  - Add column `merge_policy TEXT DEFAULT NULL`.
- `shared_assets` table:
  ```sql
  CREATE TABLE IF NOT EXISTS shared_assets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data_url TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shared_assets_workspace ON shared_assets(workspace_id);
  ```

### 2.3 Server API Endpoints (`packages/server/src/api/app.ts`)
- `PUT /api/requirements/:id/projects`: Updates the list of affected projects in `requirement_projects` table and re-renders requirement body markdown.
- `PUT /api/requirements/:id/merge-policy`: Updates the `merge_policy` column for a specific requirement.
- `GET /api/assets?workspace_id=...`: Returns:
  - `ticket_attachments`: Aggregated attachments from all requirements in the workspace.
  - `shared_assets`: Records from `shared_assets` table for the workspace.
- `POST /api/assets/shared`: Inserts a new record into `shared_assets`.
- `DELETE /api/assets/shared/:id`: Deletes a shared asset.

### 2.4 Agent Prompt Injection (`FanOutService`)
- Evaluate effective merge policy:
  ```ts
  const effectiveMergePolicy = req.merge_policy || defaultWorkspacePolicy;
  ```
- If shared assets exist in the workspace, append a `## Shared Workspace Assets` list to the prompt so agents know where to find shared contracts.

---

## 3. Frontend UX & shadcn Sheet Animation

### 3.1 Dependencies
- Install `@radix-ui/react-dialog` and `tailwindcss-animate` in `packages/web`.
- Add `tailwindcss-animate` to `plugins: [require('tailwindcss-animate')]` in `tailwind.config.js`.

### 3.2 shadcn Sheet Component (`packages/web/src/components/ui/sheet.tsx`)
- Provides `Sheet`, `SheetOverlay`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`.
- Smooth slide enter animation: `slide-in-from-right duration-300 ease-out`.
- Smooth slide exit animation: `data-[state=closed]:slide-out-to-right duration-300 ease-in`.

### 3.3 CreateRequirementSheet Updates
- Refactor State and Priority to compact styled `<select>` dropdowns.
- Add Merge Policy `<select>` (`Workspace Default`, `Automatic Merge to Main`, `Manual Review & Merge`).
- Ensure project selection supports multi-select tag chips with easy toggling.

### 3.4 Requirement Detail Page Updates (`RequirementDetailPage.tsx`)
- Add "Edit Projects" button with a modal or dropdown to add/remove affected repositories.
- Show and allow updating the ticket's specific merge policy.

---

## 4. Central Attachments Hub (`packages/web/src/pages/AttachmentsPage.tsx`)

- Add route `/attachments` and sidebar link in `AppLayout.tsx`.
- Tab 1: **Ticket Attachments**:
  - Filterable by file type (Images, Sheets, Docs, PDFs) and search.
  - Shows file name, size, type, requirement link (`REQ-001`), and download action.
- Tab 2: **Shared Workspace Assets**:
  - Drag-and-drop / file upload for workspace-wide specs (e.g. `openapi.yaml`, shared models).
  - List of shared assets with deletion and download options.

---

## 5. Phased Delivery

1. **Phase 1**: Backend & Schema Foundations (DB migrations, API endpoints, fan-out logic).
2. **Phase 2**: shadcn Sheet Animation & Form UX (Radix primitives, `<select>` inputs, project editing).
3. **Phase 3**: Central Attachments & Shared Assets Hub (Frontend views, API integrations).
4. **Phase 4**: Verification & Monorepo Build (Testing, linting, building, and git push).
