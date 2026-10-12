# Desktop Module & Settings Governance Rule

## Standard
When building, modifying, or refactoring features across the `@sp-kickstack` codebase, agents and developers **MUST ALWAYS** check and maintain compatibility with both the **Desktop Module** and the **Settings Module**.

---

## 1. Desktop Module Verification (`packages/desktop`)

SP-Kickstack runs as both a web client and a native desktop application powered by Tauri (`packages/desktop`). All features must be tested and verified against the desktop runtime:

### A. Origin & IPC Compatibility
- **Request Guard & Host Protection**: Backend middleware (`packages/server/src/api/requestGuard.ts`) must allow Tauri origins (`tauri://localhost`, `http://tauri.localhost`, `http://127.0.0.1:4100`).
- **Web API Client**: The web frontend (`packages/web/src/lib/api.ts`) detects desktop mode via `isTauri`. Any new API route or WebSocket/SSE stream must use `API_BASE` or `BASE` to ensure requests route to `http://127.0.0.1:4100` under Tauri.
- **Cross-Platform Paths**: File paths must be normalized and resilient across macOS, Linux, and Windows. Do not assume POSIX-only directory layouts without fallbacks.

### B. Server Sidecar Bundling
- The desktop application launches the server as an embedded child process via Node.js (`packages/desktop/src-tauri/resources/server/index.mjs`).
- If you modify server dependencies or native modules (e.g. `better-sqlite3`), verify that `npm run desktop:bundle-server` bundles cleanly and that native bindings resolve inside the desktop resource directory.

### C. Desktop Verification Checklist:
- [ ] `packages/desktop` builds cleanly (`npm run desktop:bundle-server`).
- [ ] Backend routes and SSE event streams permit `tauri://localhost` and `tauri.localhost`.
- [ ] Frontend API calls correctly prepend `API_BASE` when `isTauri` is true.
- [ ] File dialogs, terminals, and binary executions handle OS-specific path separators.

---

## 2. Settings Module Integration (`packages/web/src/pages/SettingsPage.tsx`)

Every configurable behavior, engine parameter, policy flag, or external tool must be exposed and manageable in the **Settings Module**:

### A. Shared Schema & Types Synchronization
- Any new setting must be declared in `@sp-kickstack/shared`:
  - Defined in Zod schema (`packages/shared/src/schemas.ts`).
  - Typed in TypeScript interfaces (`packages/shared/src/types.ts`).
  - Persisted in the SQLite `settings` table via `packages/server/src/services/settingsService.ts`.

### B. UI Controls in Settings Screen
- Add corresponding controls in `packages/web/src/pages/SettingsPage.tsx`:
  - **AI & Local Engines (`ai` tab)**: For new AI CLIs, models, reasoning efforts, custom binary paths, or rate-limit configurations.
  - **Git & Branch Rules (`git` tab)**: For new branch naming templates, merge policies, or test validation rules.
  - **Embedded IDE (`ide` tab)**: For IDE port, binary paths, or external URLs.
  - **Appearance (`appearance` tab)**: For UI theme or display preferences.
  - **Safety Limits (`safety` tab)**: For depth caps, payload limits, and watchdog poll intervals.

### C. Live Detection & Validation Badges
- Settings UI must provide live status detection:
  - Binary existence detection (`✓ Installed on PC` vs `✕ Not Detected`).
  - Active rate limit quota health (`HEALTHY`, `PAUSED / RATE LIMITED`, `UNLIMITED`).
  - Clear user alerts and validation warnings if a required external binary is missing.

### D. Zero Hardcoded Consts
- Services must read configurations dynamically from `SettingsService` (or `db`) rather than hardcoding static constants. User changes in the Settings UI must take effect immediately.
