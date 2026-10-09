# Embedded VS Code (code-server) Project & Git Review Implementation Plan

## Overview
Enable developers to review full project code and git changes directly inside SP-Kickstack before merging and deploying, using an embedded VS Code web environment (`code-server` / `openvscode-server`) rendered via an in-app viewer.

---

## Architectural Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SP-Kickstack Review & Merge Modal                                           │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 📁 Backend Project [develop] ➔ [main]    [● IDE Online: :8443]          │ │
│ │ [ 🚀 Merge to Main ]  [ ↗ Open Full Window ]  [ 🔄 Reload ]  [ ✕ Close ] │ │
│ ├─────────────────────────────────────────────────────────────────────────┤ │
│ │                                                                         │ │
│ │  <iframe src="http://127.0.0.1:8443/?folder=/Users/.../backend" />      │ │
│ │                                                                         │ │
│ │  (Full VS Code Webview: Source Control Git Tab, Files, Diff, Terminal)   │ │
│ │                                                                         │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Components to Create / Modify:

1. **`packages/shared`**:
   - `types.ts`: Define `IdeSettings`, `IdeServerStatus`, `StartIdeInput`.
   - `schemas.ts`: Zod schemas for IDE requests and settings.

2. **`packages/server`**:
   - `src/services/ideService.ts`: Lifecycle manager for spawning/stopping `code-server` process, detecting binaries, and computing project URLs.
   - `src/api/app.ts`: Add REST endpoints:
     - `GET /api/ide/status`: Status & connection info.
     - `POST /api/ide/start`: Start server targeting a specific project or default workspace.
     - `POST /api/ide/stop`: Stop running server.
     - `GET /api/ide/projects/:name/url`: Get authenticated/clean iframe URL for a specific project.
   - `src/services/ideService.test.ts`: Unit tests for binary detection, status reporting, and URL construction.

3. **`packages/web`**:
   - `src/lib/api.ts`: API clients (`fetchIdeStatus`, `startIdeServer`, `stopIdeServer`, `getProjectIdeUrl`).
   - `src/components/EmbeddedIdeModal.tsx`: Full-height modal/drawer with:
     - Embedded `iframe` loading VS Code for the targeted project repository.
     - Top bar with project details, Git branch status, 1-click **Merge to Main** action, reload, and external launch.
     - Empty/offline setup state with 1-click start and install guide (`brew install code-server`).
   - `src/pages/ProjectsPage.tsx`: Add **"Review Code in VS Code"** action button to project cards and details modal.
   - `src/pages/RequirementDetailPage.tsx`: Add **"Review in VS Code"** button in the Pre-Merge & Git status section.
   - `src/pages/SettingsPage.tsx`: Add **"Embedded IDE"** configuration settings (Port, Binary Path, Auto-start toggle).

---

## Step-by-Step Execution Plan

### Task 1: Shared Schema and Types
- Define `IdeSettings`, `IdeServerStatus`, and `StartIdeInput` in `packages/shared/src/types.ts` and `schemas.ts`.
- Build `@sp-kickstack/shared`.

### Task 2: Server `IdeService` & Tests
- Implement `IdeService` with child process management (`spawn`, `kill`), port check, binary location check (`code-server`, `openvscode-server`), and URL builder.
- Write unit tests in `packages/server/src/services/ideService.test.ts`.

### Task 3: Server API Routes
- Register `/api/ide/status`, `/api/ide/start`, `/api/ide/stop`, and `/api/ide/projects/:name/url` in `packages/server/src/api/app.ts`.
- Test endpoints with Vitest.

### Task 4: Frontend API & Embedded IDE Modal Component
- Add API functions in `packages/web/src/lib/api.ts`.
- Implement `EmbeddedIdeModal.tsx` with responsive iframe, header toolbar (Merge to Main, Reload, External Window, Close), and friendly offline/installation helper.

### Task 5: Integration in Projects & Requirement Review Pages
- In `ProjectsPage.tsx`, wire "Review in VS Code" button on each project.
- In `RequirementDetailPage.tsx`, wire "Review Project in VS Code" button right above the "Merge to Main" action.
- In `SettingsPage.tsx`, add an Embedded IDE card in the settings tab to configure port & custom binary path.

### Task 6: Verification & End-to-End Test
- Run `npm run --workspace=@sp-kickstack/web build`.
- Run all workspace tests (`npm test`).
- Rebuild graft context graph (`graft build`).
