# SP-Kickstack — Development & Agent Instructions

Cross-repo agent orchestration bridge connecting requirements, local developer AI CLIs, and multi-repository git workflows.

---

## 1. Environment & Runtime Requirements

- **Node.js**: **v22.19.0** is required (native bindings for `better-sqlite3`).
  ```bash
  source ~/.nvm/nvm.sh && nvm use 22.19.0
  ```
- **Monorepo Workspaces**:
  - `packages/shared`: Shared Zod schemas, TypeScript interfaces, and validation rules.
  - `packages/server`: Express REST API, SQLite database (`better-sqlite3`), and bridge services.
  - `packages/web`: React 18 + Vite + Tailwind CSS + Radix UI frontend client.
  - `packages/desktop`: Tauri native desktop shell embedding the web client and bundled backend sidecar.
  - `packages/xticket`: Cross-repo ticket generation CLI tool.

---

## 2. Essential Commands

```bash
# Build all workspaces
npm run build

# Run unit and integration test suite
npm test

# Start full web development stack (server on :4100, web on :5173)
npm run dev

# Bundle backend server sidecar for desktop release
npm run desktop:bundle-server

# Run Tauri desktop app in development
npm run desktop:dev
```

---

## 3. Mandatory Engineering Rules

### Rule A: Desktop Module Compatibility (`packages/desktop`)
- **Tauri Runtime Support**: Every feature and API route must function in both web browser mode and Tauri desktop mode.
- **Request Guard & Origins**: Ensure `packages/server/src/api/requestGuard.ts` allows Tauri origins (`tauri://localhost`, `tauri.localhost`, `127.0.0.1:4100`).
- **Frontend API Base**: Use `API_BASE` or `BASE` in `packages/web/src/lib/api.ts` so requests route correctly under Tauri.
- **Sidecar Bundling**: Changes to backend dependencies must be tested with `npm run desktop:bundle-server`.

### Rule B: Settings Module Integration (`packages/web/src/pages/SettingsPage.tsx`)
- **Expose All Configurable Behaviors**: Any new AI engine, model, git rule, IDE integration, or safety limit must have corresponding UI controls in the **Settings screen**.
- **Schema Synchronization**: New settings must be declared in `packages/shared/src/schemas.ts` and `types.ts`, and saved to SQLite via `SettingsService`.
- **Live Status Badges**: Provide real-time detection (`Installed on PC` vs `Not Detected`) and rate-limit diagnostics (`HEALTHY`, `PAUSED`, `UNLIMITED`).
- **No Hardcoded Constants**: Services must read configurations dynamically from settings.

### Rule C: Web UI Radix Priority
- Always prioritize `@radix-ui/react-*` primitives over native HTML elements (`<select>`, `<dialog>`, custom unstyled popups) for dropdowns, popovers, and modals.
- Follow `.agents/rules/ui-radix-priority.md`.

### Rule D: Repo Context Graph (Graft)
- This repo is indexed in `graft/`. Consult the context graph (`graft ask "<query>" --source`) before grepping or modifying large spans of code.
- Run `graft build` after major code changes.

### Rule E: Automated Error Triage (Clef)
- Follow `.agents/rules/clef-auto-triage.md` for error diagnosis and P0–P3 triage.

### Rule F: Web UI Tab URL Active Governance
- All screens and views with tabs, sub-views, or segmented filters must synchronize the active tab state with the URL query parameter (`?tab=<id>`).
- Must support initial URL parsing, browser Back/Forward history navigation, reload persistence, and direct deep-linking.
- Follow `.agents/rules/ui-tab-url-governance.md`.

### Rule G: Git Branch Governance
- Task branch names, base/target branches and pushes go only through `BranchService` (`packages/server/src/services/branchService.ts`): `nameTaskBranch` (Settings pattern, default `{req}` → `REQ-008`; tickets `-ticket-<id>`), `baseBranchFor(project, reqId)` (requirement target branch first).
- Only the bridge pushes (never forced, failures logged to the task); agents never push; only the merge gate merges.
- Follow `.agents/rules/git-branch-governance.md`.
