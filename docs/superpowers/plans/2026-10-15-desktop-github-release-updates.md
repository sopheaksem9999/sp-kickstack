# Desktop GitHub Release Update Notifications Implementation Plan

**Date:** 2026-10-15
**Goal:** Notify users in the desktop app (and web app) when a new release is published to GitHub (`sopheaksem9999/sp-kickstack`), display release notes, and provide direct one-click download/installation links.
**Architecture:** Zero-secret GitHub Releases API polling + Semver comparison + Radix UI Dialog + Settings Page tab synchronization.

---

## 1. Governance & Rules Adherence
- **Desktop & Settings Governance** (`.agents/rules/desktop-and-settings-governance.md`):
  - Integrates directly with `packages/desktop` environment detection (`isTauri`).
  - Supports Settings module (`packages/web/src/pages/SettingsPage.tsx`) with an "About & Updates" tab.
- **Web UI Radix Priority** (`.agents/rules/ui-radix-priority.md`):
  - Prioritizes Radix UI primitives (`@radix-ui/react-dialog` via `packages/web/src/components/ui/dialog.tsx`).
- **Tab URL Active Governance** (`.agents/rules/ui-tab-url-governance.md`):
  - Syncs the new Settings tab (`?tab=about`) with URL query parameters for browser history, reload persistence, and deep linking.

---

## 2. Architecture & Components

### A. Core Update Logic & Hook (`packages/web/src/lib/appUpdate.ts` & `appUpdate.test.ts`)
- Semver comparator `isNewerVersion(remoteTag: string, currentVersion: string): boolean`
  - Strips leading `'v'`, splits by major, minor, patch, ignores build metadata.
  - Returns true if remote is strictly newer than current.
- Platform asset detector `getPlatformAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null`
  - Detects macOS (`.dmg`), Windows (`.msi` / `.exe`), Linux (`.deb` / `.AppImage`) based on `navigator.userAgent`.
- Hook `useAppUpdate()`:
  - Uses `@tanstack/react-query` to query `https://api.github.com/repos/sopheaksem9999/sp-kickstack/releases/latest`.
  - Caches for 15 minutes (`staleTime: 15 * 60 * 1000`).
  - Provides manual `checkForUpdates()` with toast feedback.
  - Remembers dismissed version via `localStorage.getItem('dismissed_update_version')`.

### B. Radix UI Update Modal (`packages/web/src/components/UpdateNotificationModal.tsx`)
- Triggered by clicking the update pill in the top header or "View Update" in Settings.
- Displays:
  - Current version vs New version badge.
  - Release title & formatted publish date.
  - Formatted release notes / changelog.
  - Primary button: Download platform installer (e.g. `SP-Kickstack_0.3.2_aarch64.dmg`).
  - Secondary button: Open GitHub Release page.
  - Dismiss button: "Remind Me Later".

### C. App Header & Sidebar Badges (`packages/web/src/components/AppLayout.tsx`)
- Header indicator:
  - When `hasUpdate` is true and not dismissed, show an eye-catching pill button in `AppLayout` header next to utilities.
- Sidebar indicator:
  - Subtle update badge on the Settings navigation link.

### D. Settings Page Integration (`packages/web/src/pages/SettingsPage.tsx`)
- Add `'about'` tab to `SettingsTab` and `VALID_TABS`.
- Tab icon: `Info` / `Sparkles`.
- Card 1: App Info (Version, Platform, Desktop Runtime status).
- Card 2: Updates (Status: "Up to date" or "Update Available", "Check for Updates" button, manual check trigger).
- Card 3: Repository & Quick Links (GitHub repo, changelog, documentation).

---

## 3. Verification Plan
1. Unit tests: `pnpm --filter @sp-kickstack/web test run src/lib/appUpdate.test.ts`
2. Typecheck: `pnpm --filter @sp-kickstack/web typecheck`
3. Bundle test: `pnpm --filter @sp-kickstack/web build`
4. End-to-end simulation: Verify update detection with mock/real release tags and dialog open/close.
