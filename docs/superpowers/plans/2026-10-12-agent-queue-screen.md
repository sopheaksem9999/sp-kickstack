# Agent Queue Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a dedicated "Agent Queue" screen (`/queue`) in the web application with Radix tabs, URL search-parameter synchronization, live status tracking, retry/mark-done task actions, and sidebar navigation.

**Architecture:** 
Enrich the existing `GET /api/tasks` server endpoint to support optional status filtering and join parent requirement metadata. Build a new React page (`QueuePage.tsx`) using Radix UI Tabs primitives and URL synchronization (`?tab=<id>`), integrating React Query for auto-refresh via bridge WebSocket events, and exposing task actions (Retry, Mark Done, View Live Logs, Open Requirement). Wire the new screen into the sidebar navigation and router.

**Tech Stack:** 
React 18, TypeScript, Tailwind CSS, `@radix-ui/react-tabs`, TanStack React Query, Lucide icons, Vitest, Express, Better-SQLite3.

## Global Constraints

- Follow Web UI Radix Priority (`.agents/rules/ui-radix-priority.md`): Use Radix UI primitives (`@radix-ui/react-tabs`) rather than custom plain HTML buttons.
- Follow Tab URL Active Governance (`.agents/rules/ui-tab-url-governance.md`): Synchronize active queue tabs with the URL query parameter (`?tab=<id>`) with fallback to `'all'`.
- Follow Desktop & Settings Governance (`.agents/rules/desktop-and-settings-governance.md`): Ensure routes work seamlessly within the Tauri desktop container and workspace router.
- No placeholders (`TODO`, `TBD`, "implement later"). Every step provides concrete code and exact commands.

---

### Task 1: Enrich `/api/tasks` and Web API Client

**Files:**
- Modify: `packages/server/src/api/app.ts:563-579`
- Modify: `packages/web/src/lib/api.ts:168-185`
- Test: `packages/server/src/regressions.test.ts:400-430`

**Interfaces:**
- Consumes: Existing SQLite tables `bridge_tasks` and `requirements`.
- Produces: 
  - `GET /api/tasks?req=<id>&project=<name>&status=<status>` returning enriched `BridgeTask[]` with `req_title`, `req_priority`, `req_status`.
  - `fetchTasks(params?: { req?: string; project?: string; status?: string }): Promise<BridgeTask[]>` in `packages/web/src/lib/api.ts`.

- [ ] **Step 1: Write the failing regression test for `/api/tasks` with status filtering and requirement metadata**

Add a test in `packages/server/src/regressions.test.ts`:

```ts
  it('GET /api/tasks supports status filter and joins parent requirement metadata', async () => {
    const req = await testRequest(h.app, 'POST', '/api/requirements', {
      title: 'Queue Test Feature',
      goal: 'Test queue enrichment',
      affected_projects: ['backend'],
      priority: 'high',
    });
    expect(req.status).toBe(201);
    const reqId = req.body.id;

    // Fan-out to create a task
    await testRequest(h.app, 'POST', `/api/requirements/${reqId}/fan-out`);

    const resAll = await testRequest(h.app, 'GET', '/api/tasks');
    expect(resAll.status).toBe(200);
    const tasks = resAll.body as any[];
    const created = tasks.find((t) => t.req_id === reqId);
    expect(created).toBeDefined();
    expect(created.req_title).toBe('Queue Test Feature');
    expect(created.req_priority).toBe('high');

    const resQueued = await testRequest(h.app, 'GET', '/api/tasks?status=queued');
    expect(resQueued.status).toBe(200);
    expect(resQueued.body.length).toBeGreaterThan(0);

    const resDone = await testRequest(h.app, 'GET', '/api/tasks?status=done');
    expect(resDone.status).toBe(200);
    const hasCurrentInDone = resDone.body.some((t: any) => t.req_id === reqId);
    expect(hasCurrentInDone).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@sp-kickstack/server packages/server/src/regressions.test.ts`
Expected: FAIL (missing `req_title` or status filter on `GET /api/tasks`).

- [ ] **Step 3: Update `GET /api/tasks` in `packages/server/src/api/app.ts`**

Update lines 563–579 in `packages/server/src/api/app.ts`:

```ts
  // Tasks
  app.get('/api/tasks', (req, res) => {
    const { req: reqId, project, status } = req.query;
    let query = `
      SELECT t.*, r.title AS req_title, r.priority AS req_priority, r.status AS req_status
      FROM bridge_tasks t
      LEFT JOIN requirements r ON t.req_id = r.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (reqId) {
      query += ' AND t.req_id = ?';
      params.push(reqId);
    }
    if (project) {
      query += ' AND t.project = ?';
      params.push(project);
    }
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    query += ' ORDER BY t.id DESC';
    const tasks = deps.db.prepare(query).all(...params);
    res.json(tasks);
  });
```

- [ ] **Step 4: Add `fetchTasks` in `packages/web/src/lib/api.ts`**

Add in `packages/web/src/lib/api.ts`:

```ts
export interface FetchTasksParams {
  req?: string;
  project?: string;
  status?: string;
}

export async function fetchTasks(params?: FetchTasksParams): Promise<BridgeTask[]> {
  const query = new URLSearchParams();
  if (params?.req) query.set('req', params.req);
  if (params?.project) query.set('project', params.project);
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return request(`${BASE}/tasks${qs ? `?${qs}` : ''}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=@sp-kickstack/server packages/server/src/regressions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add packages/server/src/api/app.ts packages/server/src/regressions.test.ts packages/web/src/lib/api.ts
git commit -m "feat(server): enrich GET /api/tasks with status filter and requirement metadata"
```

---

### Task 2: Unit Tests for Queue Tab URL Synchronization

**Files:**
- Modify: `packages/web/src/lib/tabUrlSync.test.ts:80-101`
- Test: `packages/web/src/lib/tabUrlSync.test.ts`

**Interfaces:**
- Consumes: `QueueTab`, `VALID_QUEUE_TABS` from `../pages/QueuePage` (to be created in Task 3).
- Produces: Governance validation ensuring tab persistence and URL parameter synchronization.

- [ ] **Step 1: Write the failing tab URL sync tests for QueuePage**

Add the test block in `packages/web/src/lib/tabUrlSync.test.ts`:

```ts
import { VALID_QUEUE_TABS, QueueTab } from '../pages/QueuePage';

  describe('QueuePage tabs', () => {
    it('accepts all 5 queue tab IDs', () => {
      expect(VALID_QUEUE_TABS).toEqual(['all', 'queued', 'running', 'failed', 'done']);
    });

    it('falls back to "all" for missing or invalid tab parameters', () => {
      const resolveTab = (param: string | null): QueueTab =>
        param && VALID_QUEUE_TABS.includes(param as QueueTab) ? (param as QueueTab) : 'all';

      expect(resolveTab(null)).toBe('all');
      expect(resolveTab('')).toBe('all');
      expect(resolveTab('invalid')).toBe('all');
      expect(resolveTab('queued')).toBe('queued');
      expect(resolveTab('running')).toBe('running');
      expect(resolveTab('failed')).toBe('failed');
      expect(resolveTab('done')).toBe('done');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/tabUrlSync.test.ts`
Expected: FAIL (Cannot find module `../pages/QueuePage`).

- [ ] **Step 3: Create stub `packages/web/src/pages/QueuePage.tsx` with exported types**

Create initial `packages/web/src/pages/QueuePage.tsx`:

```tsx
export type QueueTab = 'all' | 'queued' | 'running' | 'failed' | 'done';
export const VALID_QUEUE_TABS: QueueTab[] = ['all', 'queued', 'running', 'failed', 'done'];

export function QueuePage() {
  return <div>Agent Queue</div>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/tabUrlSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/web/src/lib/tabUrlSync.test.ts packages/web/src/pages/QueuePage.tsx
git commit -m "test(web): add QueuePage tab URL synchronization governance tests"
```

---

### Task 3: Build the Full `QueuePage` UI Component

**Files:**
- Modify: `packages/web/src/pages/QueuePage.tsx`
- Consumes: Radix Tabs (`@radix-ui/react-tabs`), `fetchTasks`, `retryTask`, `markTaskDone`, `StatusBadge`, `RequirementDetailSheet`, `LiveTaskLogsDrawer`.
- Produces: Complete, responsive Queue management screen with search, repository filter, quick actions, and real-time updates.

- [ ] **Step 1: Implement `QueuePage.tsx` with Radix UI Tabs, task filters, search, and action handlers**

Implement `packages/web/src/pages/QueuePage.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ListTodo,
  Search,
  RotateCcw,
  CheckCircle2,
  Terminal,
  ExternalLink,
  GitBranch,
  FolderGit2,
  RefreshCw,
  Clock,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { BridgeTask } from '@sp-kickstack/shared';
import { fetchTasks, retryTask, markTaskDone, fetchProjects } from '../lib/api.js';
import { canRetry, retryOutcome } from '../lib/taskActions.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { LiveTaskLogsDrawer } from '../components/LiveTaskLogsDrawer.js';
import { RequirementDetailSheet } from '../components/RequirementDetailSheet.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';

export type QueueTab = 'all' | 'queued' | 'running' | 'failed' | 'done';
export const VALID_QUEUE_TABS: QueueTab[] = ['all', 'queued', 'running', 'failed', 'done'];

export function QueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();

  const currentTab = ((): QueueTab => {
    const raw = searchParams.get('tab');
    return raw && VALID_QUEUE_TABS.includes(raw as QueueTab) ? (raw as QueueTab) : 'all';
  })();

  const setTab = (tab: QueueTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'all') {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      return next;
    });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [activeLogTaskId, setActiveLogTaskId] = useState<number | null>(null);
  const [activeReqId, setActiveReqId] = useState<string | null>(null);

  const { data: tasks = [], isLoading, isFetching } = useQuery({
    queryKey: ['tasks', activeWorkspaceId],
    queryFn: () => fetchTasks(),
    refetchInterval: 5000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', activeWorkspaceId || 'default'],
    queryFn: () => fetchProjects(activeWorkspaceId || 'default'),
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: number) => retryTask(taskId),
    onSuccess: (updated) => {
      const outcome = retryOutcome(updated);
      toast[outcome.kind](outcome.message);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: any) => toast.error(err.message || 'Could not retry task'),
  });

  const doneMutation = useMutation({
    mutationFn: (taskId: number) => markTaskDone(taskId),
    onSuccess: () => {
      toast.success('Task marked as done');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update task'),
  });

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Tab filter
      if (currentTab === 'queued' && task.status !== 'queued' && task.status !== 'pending') return false;
      if (currentTab === 'running' && task.status !== 'running') return false;
      if (currentTab === 'failed' && task.status !== 'failed' && task.status !== 'needs_human' && task.status !== 'rate_limited') return false;
      if (currentTab === 'done' && task.status !== 'done') return false;

      // Project filter
      if (selectedProject !== 'all' && task.project !== selectedProject) return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(q);
        const matchesReq = task.req_id.toLowerCase().includes(q);
        const matchesEngineId = (task.engine_task_id || '').toLowerCase().includes(q);
        const matchesProject = task.project.toLowerCase().includes(q);
        if (!matchesTitle && !matchesReq && !matchesEngineId && !matchesProject) return false;
      }

      return true;
    });
  }, [tasks, currentTab, selectedProject, searchQuery]);

  // Tab counts
  const counts = useMemo(() => {
    return {
      all: tasks.length,
      queued: tasks.filter((t) => t.status === 'queued' || t.status === 'pending').length,
      running: tasks.filter((t) => t.status === 'running').length,
      failed: tasks.filter((t) => t.status === 'failed' || t.status === 'needs_human' || t.status === 'rate_limited').length,
      done: tasks.filter((t) => t.status === 'done').length,
    };
  }, [tasks]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#f7f8fa] dark:bg-[#191919] overflow-hidden">
      {/* Top Header */}
      <div className="px-6 py-5 border-b border-slate-200 dark:border-[#2d2d2d] bg-white dark:bg-[#202020] flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400">
              <ListTodo className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Agent Execution Queue
                {isFetching && <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Monitor and manage active per-repository agent tasks, execution pipelines, and retries.
              </p>
            </div>
          </div>
        </div>

        {/* Search & Project Filter Controls */}
        <div className="flex items-center gap-2.5 flex-1 max-w-md ml-auto">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by title, REQ-ID, engine ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-[#333] bg-slate-50 dark:bg-[#282828] text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-[#333] bg-slate-50 dark:bg-[#282828] text-slate-700 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-cyan-500"
          >
            <option value="all">All Repositories</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Radix Tabs Section */}
      <Tabs.Root value={currentTab} onValueChange={(val) => setTab(val as QueueTab)} className="flex-1 flex flex-col min-h-0">
        <div className="px-6 border-b border-slate-200 dark:border-[#2d2d2d] bg-white dark:bg-[#202020]">
          <Tabs.List className="flex items-center gap-2">
            {[
              { id: 'all', label: 'All Tasks', count: counts.all },
              { id: 'queued', label: 'Queued', count: counts.queued },
              { id: 'running', label: 'In Progress', count: counts.running },
              { id: 'failed', label: 'Failed / Needs Human', count: counts.failed },
              { id: 'done', label: 'Completed', count: counts.done },
            ].map((tab) => (
              <Tabs.Trigger
                key={tab.id}
                value={tab.id}
                className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  currentTab === tab.id
                    ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    currentTab === tab.id
                      ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/80 dark:text-cyan-300 font-bold'
                      : 'bg-slate-100 text-slate-600 dark:bg-[#2d2d2d] dark:text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        {/* Task List Content */}
        <div className="flex-1 p-6 overflow-y-auto space-y-3 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading tasks...
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="text-center py-20 bg-white dark:bg-[#202020] border border-dashed border-slate-200 dark:border-[#333] rounded-xl p-8">
              <ListTodo className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No tasks in this queue view</p>
              <p className="text-xs text-slate-400 mt-1">
                {searchQuery || selectedProject !== 'all'
                  ? 'Try adjusting your filters or search query.'
                  : 'Tasks will appear here once requirements are fanned out to repositories.'}
              </p>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div
                key={task.id}
                className="bg-white dark:bg-[#202020] border border-slate-200 dark:border-[#2d2d2d] rounded-xl p-4 shadow-2xs hover:border-slate-300 dark:hover:border-[#383838] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Left Task Info */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Requirement Chip */}
                    <button
                      onClick={() => setActiveReqId(task.req_id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition-colors"
                    >
                      <Layers className="w-3 h-3 text-indigo-500" />
                      <span>{task.req_id}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </button>

                    {/* Repository Chip */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-[#2a2a2a] text-slate-700 dark:text-slate-300">
                      <FolderGit2 className="w-3 h-3 text-slate-400" />
                      {task.project}
                    </span>

                    {/* Task Role */}
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-50 dark:bg-[#252525] text-slate-500 border border-slate-200 dark:border-[#333]">
                      {task.role}
                    </span>

                    {/* Branch */}
                    {task.branch && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        <GitBranch className="w-3 h-3 text-purple-400" />
                        {task.branch}
                      </span>
                    )}

                    {/* Status Badge */}
                    <div className="ml-auto md:ml-0">
                      <StatusBadge status={task.status} />
                    </div>
                  </div>

                  {/* Task Title */}
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {task.title}
                  </h3>

                  {/* Engine Details & Meta */}
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                    {task.engine_task_id && (
                      <span className="font-mono text-slate-400 text-[10px]">
                        ID: {task.engine_task_id}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      Updated {new Date(task.updated_at).toLocaleTimeString()}
                    </span>
                    {task.attempts > 1 && (
                      <span className="text-amber-500 font-semibold text-[10px]">
                        Attempt {task.attempts}
                      </span>
                    )}
                    {task.last_error && (
                      <span className="text-rose-500 flex items-center gap-1 truncate max-w-xs text-[10px]" title={task.last_error}>
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {task.last_error}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Action Buttons */}
                <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-[#2a2a2a]">
                  {/* View Live Logs */}
                  <button
                    onClick={() => setActiveLogTaskId(task.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333] hover:bg-slate-100 dark:hover:bg-[#2a2a2a] text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors"
                    title="View execution logs"
                  >
                    <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    <span>Logs</span>
                  </button>

                  {/* Retry Action */}
                  {canRetry(task) && (
                    <button
                      onClick={() => retryMutation.mutate(task.id)}
                      disabled={retryMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 dark:hover:bg-amber-900/60 text-xs font-bold text-amber-700 dark:text-amber-300 transition-colors"
                      title="Retry task on engine"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span>Retry</span>
                    </button>
                  )}

                  {/* Mark Done Action */}
                  {task.status !== 'done' && (
                    <button
                      onClick={() => doneMutation.mutate(task.id)}
                      disabled={doneMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-[#282828] hover:bg-slate-200 dark:hover:bg-[#323232] text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                      title="Mark task as complete"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Mark Done</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Tabs.Root>

      {/* Live Logs Drawer Modal */}
      {activeLogTaskId !== null && (
        <LiveTaskLogsDrawer
          taskId={activeLogTaskId}
          isOpen={true}
          onClose={() => setActiveLogTaskId(null)}
        />
      )}

      {/* Requirement Detail Sheet */}
      {activeReqId && (
        <RequirementDetailSheet
          requirementId={activeReqId}
          isOpen={true}
          onClose={() => setActiveReqId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify type check passes for `QueuePage.tsx`**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: PASS

- [ ] **Step 3: Commit changes**

```bash
git add packages/web/src/pages/QueuePage.tsx
git commit -m "feat(web): build QueuePage component with Radix tabs and task actions"
```

---

### Task 4: Integrate Queue Page into App Router and Navigation Sidebar

**Files:**
- Modify: `packages/web/src/App.tsx:44-70`
- Modify: `packages/web/src/components/AppLayout.tsx:55-84`
- Modify: `packages/desktop/src-tauri/tauri.conf.json` (verify no route restrictions)

**Interfaces:**
- Consumes: `QueuePage` from `./pages/QueuePage.js`.
- Produces: 
  - Routes `/w/:workspaceId/queue` and legacy redirect `/queue`.
  - Sidebar navigation item "Agent Queue" with badge.
  - Breadcrumb header label "Agent Queue".

- [ ] **Step 1: Add Route in `packages/web/src/App.tsx`**

Import `QueuePage` and add routes in `packages/web/src/App.tsx`:

```tsx
import { QueuePage } from './pages/QueuePage.js';
```

Inside `<Routes>`:
```tsx
        <Route path="/w/:workspaceId/queue" element={<QueuePage />} />
```
And in legacy redirects:
```tsx
        <Route path="/queue" element={<LegacyRedirect to="/queue" />} />
```

- [ ] **Step 2: Add Navigation Item in `packages/web/src/components/AppLayout.tsx`**

Import `ListTodo` from `lucide-react`:
```tsx
import {
  Layers,
  FolderGit2,
  Settings,
  Bell,
  BookOpen,
  Plus,
  Sun,
  Moon,
  Search,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  Sparkles,
  ListTodo,
} from 'lucide-react';
```

Update `navItems`:
```tsx
  const navItems = [
    { label: 'Requirements', path: '/requirements', icon: Layers, badge: 'Tasks' },
    { label: 'Agent Queue', path: '/queue', icon: ListTodo, badge: 'Live' },
    { label: 'AI Architect Chat', path: '/chat', icon: Sparkles, badge: 'AI Hub' },
    { label: 'Attachments Hub', path: '/attachments', icon: Paperclip, badge: 'Files' },
    { label: 'Repositories', path: '/projects', icon: FolderGit2, badge: 'Git' },
    { label: 'Telemetry & Sprints', path: '/metrics', icon: BarChart3, badge: 'Stats' },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];
```

Update `getBreadcrumbLabel`:
```tsx
    if (currentSubpath === '/queue') return 'Agent Queue';
```

- [ ] **Step 3: Verify build in `packages/web`**

Run: `npm run build --workspace=@sp-kickstack/web`
Expected: PASS (vite build finishes cleanly).

- [ ] **Step 4: Commit changes**

```bash
git add packages/web/src/App.tsx packages/web/src/components/AppLayout.tsx
git commit -m "feat(web): add Agent Queue route and sidebar navigation link"
```

---

### Task 5: End-to-End Governance Verification & Test Suites

**Files:**
- Test: `packages/web/src/lib/tabUrlSync.test.ts`
- Test: `packages/server/src/regressions.test.ts`

- [ ] **Step 1: Run all unit and regression tests**

Run: `npm test`
Expected: All Vitest suites pass across web, server, and shared packages.

- [ ] **Step 2: Verify Desktop module compatibility**

Verify that `packages/desktop` builds and packages without path issues:
Run: `npm run build --workspace=@sp-kickstack/desktop --if-present || npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit final plan deliverable and graph update**

```bash
git add docs/superpowers/plans/2026-10-12-agent-queue-screen.md
git commit -m "docs: add implementation plan for Agent Queue screen"
```
