# Web UI Tab URL Active Governance Rule

## Standard
When implementing or modifying any screen, modal view, or layout component that contains **tabs**, **sub-views**, or **segmented filters** in `@sp-kickstack/web`:

Agents and developers **MUST ALWAYS** synchronize the active tab state with the browser URL query parameter (`?tab=<id>`).

---

## 1. Core UX Requirements

Every tabbed interface must provide:

### A. Initial State from URL
- Parse `searchParams.get('tab')` on initial mount.
- Validate the URL value against a typed whitelist array of valid tab IDs (e.g. `const VALID_TABS: TabId[] = [...]`).
- If the URL parameter is missing or invalid, fall back smoothly to the default active tab without throwing errors.

### B. Interactive Tab Switching
- When the user clicks or activates a tab:
  - Update the component's React state immediately for responsive rendering.
  - Update the URL search parameters using `setSearchParams` from `react-router-dom`:
    ```tsx
    const handleTabChange = (newTab: TabId) => {
      setActiveTab(newTab);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', newTab);
          return next;
        },
        { replace: false }
      );
    };
    ```
  - Always preserve any other unrelated query parameters in the URL (such as filters, search terms, or workspace tokens).

### C. Full Browser History Support (Back & Forward)
- Provide a `useEffect` listening to `searchParams` changes:
  ```tsx
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab') as TabId | null;
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams, activeTab]);
  ```
- Navigating with the browser **Back** and **Forward** buttons must switch between previously visited tabs without page reload.

### D. Reload Persistence
- When a user refreshes the browser page (F5 / Cmd+R), the exact tab they were viewing must remain active rather than resetting to the screen's default tab.

### E. Direct Deep Linking
- Any screen or sub-view must be linkable directly via URL:
  - External links, notification toasts, command palette commands, and header quick-views must link directly to the target tab (e.g. `/settings?tab=ai`, `/requirements?tab=backlog`, `/requirements/REQ-001?tab=dag`, `/chat?tab=<session_id>`).

---

## 2. Monorepo Screens Checklist

All screens with tabs in SP-Kickstack must implement this pattern:

| Screen | Route | Tab Param | Supported Values | Default |
| :--- | :--- | :--- | :--- | :--- |
| **Settings** | `/settings` | `?tab=` | `ai`, `git`, `ide`, `appearance`, `safety`, `notifications` | `ai` |
| **Requirements List** | `/requirements` | `?tab=` | `sprint`, `backlog`, `all` | `sprint` |
| **Requirement Detail** | `/requirements/:id` | `?tab=` | `board`, `dag` | `board` |
| **AI Architect Chat** | `/chat` | `?tab=` (or `?session=`) | `<sessionId>` (chat session id) | First / active session |
| **Repositories** | `/projects` | `?tab=` | `review`, `terminal`, `editor` | `review` |
| **Git Review** | `/projects/:name/review` | `?tab=` | `changes`, `tree`, `commits` | `changes` |
| **Attachments Hub** | `/attachments` | `?tab=` | `ticket`, `shared` | `ticket` |
| **Agent Queue** | `/queue` | `?tab=` | `all`, `queued`, `running`, `failed`, `done` | `all` |

---

## 3. Implementation Best Practices

1. **Use Radix UI / Accessible Buttons**: Tab triggers should use Radix UI or accessible buttons styled with Tailwind CSS, supporting keyboard navigation (`Enter`, `Space`, arrow keys).
   With Radix Tabs, set `activationMode="manual"` when the tab is written to the URL. Automatic activation calls `onValueChange` on mouse down and again on focus, so one click pushes two history entries and the Back button seems to do nothing. A page that derives its tab from `searchParams` (no copy in React state) and uses manual activation has one history entry per tab change (see `QueuePage`).
2. **Never Break Breadcrumbs**: Navigation breadcrumbs and sidebar active indicators must remain highlighted regardless of active `?tab=` query parameter.
3. **Graceful Degradation**: If an unknown tab ID is supplied in the URL (e.g. `?tab=invalid`), silently fall back to the default tab without flickering or breaking queries.
