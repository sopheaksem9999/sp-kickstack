# Agent Model and Effort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People choose the agent model and reasoning effort per workspace (default), per requirement, and per task on Retry / Request changes; engines receive them and every run records what it used; MCP tools stay inside one workspace.

**Architecture:** Nullable columns on workspaces, requirements and bridge_tasks (migration 7). A resolver picks task pin → requirement → workspace for model and effort independently. Goal/ticket dispatch passes them in the engine create input and records them. Retry and Request changes accept an optional `{ model, effort }` that pins the task through the existing claim-first `rerunTask`. Web: one Radix popover picker reused on the requirement page, Retry-with, the Request changes dialog and the workspace rules dialog.

**Tech Stack:** TypeScript, Express 4, better-sqlite3, zod 3, Vitest, React 18 + TanStack Query + Radix Popover + Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-12-agent-model-effort-design.md`

## Global Constraints

- Worktree `/private/tmp/claude-501/-Users-sopheak-Documents-Sopheak-dev-SP-Kickstack/077273a3-4255-46cf-a915-fb3bf1ae2f45/scratchpad/wt-human-loop`, branch `feat/agent-profile`. Never read or write `/Users/sopheak/Documents/Sopheak-dev/SP-Kickstack` (another session's checkout). Do not use the `graft` tool (it indexes that checkout). Plain `git add <paths> && git commit` in the worktree is safe.
- Node 22.19.0: `cd <worktree> && PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" …`. Rebuild shared after changes (`npm run --workspace=@sp-kickstack/shared build`). `npm run verify` passes before every commit.
- Schema only via migrations (this plan: migration 7). Claim/record in SQLite before engine calls; never hold a transaction across an await.
- Effort values: exactly `low`, `medium`, `high`, `xhigh`, `max` (existing `ReasoningEffortSchema`). Model ids match `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$`. Resolution order per field: task pin → requirement → workspace → none (engine decides). `undefined` in an input keeps the current value; `null` clears it.
- Workspace scope rule: anything listing projects or creating requirements for an AI/MCP caller is limited to one workspace.
- `packages/server/src/api/app.ts` is also edited by another session: change it only where a step says. Do not touch `packages/web/src/lib/api.ts`, `useEvents.ts`, `CreateRequirementSheet.tsx`, `ProjectGitReviewView.tsx`, `ProjectTerminal*.tsx`, `MetricsPage.tsx`, `ProjectsPage.tsx`.
- UI: Radix Popover/Dialog from `components/ui`, lucide icons, existing dark-mode classes, plain words with a next step in every error.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A pinned model must survive automatic re-dispatch (sweeper after a failed create) and must be restored when Retry/Request changes cannot stop the old engine task. (Task 2 tests)
- Clearing (null) vs keeping (undefined) must not be confused anywhere: API, services, UI "Default" choices. (Tasks 1–3 tests)
- A bad model id or effort must be refused before any claim or engine call (400, row unchanged). (Task 2 test)
- Engines that do not support model/effort (manual) must keep working unchanged; nothing is sent when nothing is set. (Task 1 test)
- MCP callers must not see or target another workspace's projects. (Task 2 test)

---

### Task 1: Server — settings, resolver, dispatch records the model

**Files:**
- Modify: `packages/shared/src/schemas.ts` (move `ReasoningEffortSchema` above `UpdateWorkspaceInputSchema`; add `AgentModelSchema`, `AgentProfileInputSchema`; workspace schema fields)
- Modify: `packages/shared/src/types.ts` (fields on `Workspace`, `Requirement`, `BridgeTask`)
- Modify: `packages/server/src/db/migrations.ts` (+ test: latest version 7, new columns)
- Create: `packages/server/src/services/agentProfile.ts`
- Modify: `packages/server/src/adapters/types.ts` (`CreateEngineTaskInput.model?`, `effort?`), `packages/server/src/adapters/fakeEngine.ts` (record them)
- Modify: `packages/server/src/services/fanOutService.ts` (`dispatchGoal`), `packages/server/src/services/ticketService.ts` (`dispatchTicket`)
- Modify: `packages/server/src/services/requirementService.ts` (`updateAgentProfile`), `packages/server/src/services/workspaceService.ts` (`updateWorkspace` handles the two fields; `getWorkspace`/`listWorkspaces` return them)
- Modify: `packages/server/src/api/humanLoopRoutes.ts` (`PUT /api/requirements/:id/agent-profile`; deps gain `requirementService`), `packages/server/src/api/app.ts` (only: pass `requirementService: deps.requirementService` in the `registerHumanLoopRoutes` call)
- Test: `packages/server/src/services/agentProfile.test.ts`

**Interfaces — produces:** `AgentModelSchema`, `AgentProfileInputSchema`, `type AgentProfileInput = z.input<…>` (shared); `Workspace.agent_model?: string | null`, `agent_effort?: ReasoningEffort | null`; same two on `Requirement`; `BridgeTask.model?`, `effort?` (used by the current run) and `model_override?`, `effort_override?` (task pin); `interface AgentProfile { model: string | null; effort: ReasoningEffort | null }`, `resolveAgentProfile(db, taskId): AgentProfile`, `engineProfile(p): { model?: string; effort?: ReasoningEffort }`; `RequirementService.updateAgentProfile(id, input): Requirement`; route `PUT /api/requirements/:id/agent-profile`.

- [ ] **Step 1: Shared**

In `schemas.ts`, move the line `export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);` up so it is defined before `UpdateWorkspaceInputSchema` (keep it exported once). Then add, right after it:

```ts
/** An agent model id the engine understands, e.g. opus, sonnet, claude-opus-5-5. */
export const AgentModelSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/, 'Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus');

/** Agent model/effort for a workspace, requirement or task: undefined keeps the current value, null clears it. */
export const AgentProfileInputSchema = z.object({
  model: AgentModelSchema.nullable().optional(),
  effort: ReasoningEffortSchema.nullable().optional(),
});
```

Add to `UpdateWorkspaceInputSchema`: `agent_model: AgentModelSchema.nullable().optional(), agent_effort: ReasoningEffortSchema.nullable().optional(),`. Add `export type AgentProfileInput = z.input<typeof AgentProfileInputSchema>;` with the other input types.

In `types.ts`: add to `Workspace` and `Requirement`:

```ts
  /** Default agent model / effort for agent runs (null = inherit; at the end the engine decides). */
  agent_model?: string | null;
  agent_effort?: ReasoningEffort | null;
```

and to `BridgeTask`:

```ts
  /** Model / effort sent with the current engine task (what this run used). */
  model?: string | null;
  effort?: ReasoningEffort | null;
  /** Model / effort pinned for this task by Retry or Request changes (null = inherit). */
  model_override?: string | null;
  effort_override?: ReasoningEffort | null;
```

Rebuild shared.

- [ ] **Step 2: Migration 7**

```ts
  {
    version: 7,
    name: 'agent model and effort per workspace, requirement and task',
    up: (db) => {
      for (const table of ['workspaces', 'requirements']) {
        addColumn(db, table, 'agent_model', 'TEXT');
        addColumn(db, table, 'agent_effort', 'TEXT');
      }
      for (const column of ['model', 'effort', 'model_override', 'effort_override']) {
        addColumn(db, 'bridge_tasks', column, 'TEXT');
      }
    },
  },
```

Update `migrations.test.ts`: `LATEST_VERSION` is 7; assert the new columns.

- [ ] **Step 3: Failing tests**

Create `packages/server/src/services/agentProfile.test.ts`:

```ts
// Agent model / effort: workspace default, requirement choice, recorded per run.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { WorkspaceService } from './workspaceService.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import { ManualAdapter } from '../adapters/manualAdapter.js';
import { resolveAgentProfile } from './agentProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-agent-profile');
let n = 0;

function makeHarness() {
  const ws = path.join(tempRoot, `case-${process.pid}-${n++}`);
  for (const p of ['backend', 'mobile']) fs.mkdirSync(path.join(ws, p), { recursive: true });
  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const workspaceService = new WorkspaceService(db);
  const engine = new FakeEngineServer('http://127.0.0.1:3457');
  const backend = new StoneforgeAdapter('http://127.0.0.1:3457', path.join(ws, 'backend'), undefined, ((u: any, i?: any) => engine.fetch(u, i)) as typeof fetch);
  const manual = new ManualAdapter();
  const getAdapter = (name: string) => (name === 'backend' ? backend : (manual as any));
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);

  db.exec(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('speedx', 'Speedx', 'x', 'x')`);
  projectService.registerProject({
    name: 'backend', kind: 'backend', repo_path: path.join(ws, 'backend'), engine_type: 'stoneforge',
    engine_url: 'http://127.0.0.1:3457', base_branch: 'develop', enabled: true, workspace_id: 'speedx',
  } as any);
  projectService.registerProject({
    name: 'mobile', kind: 'mobile', repo_path: path.join(ws, 'mobile'), engine_type: 'manual',
    base_branch: 'develop', enabled: true, workspace_id: 'speedx',
  } as any);

  const createRequirement = (projects = ['backend']) =>
    requirementService.createRequirement({
      workspace_id: 'speedx', title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects: projects, priority: 'normal',
    });
  const task = (id: number) => db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  const sent = (engineId: string) => engine.getTaskData(engineId) as any;

  return { db, projectService, requirementService, workspaceService, ticketService, fanOutService, engine, createRequirement, task, sent, getAdapter, linkService };
}

type H = ReturnType<typeof makeHarness>;

afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('Agent model and effort', () => {
  let h: H;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  it('sends nothing and records nothing when no model or effort is set', async () => {
    const [goal] = await h.fanOutService.execute(h.createRequirement().id);
    expect(h.sent(goal.engine_task_id!).model).toBeUndefined();
    expect(h.sent(goal.engine_task_id!).effort).toBeUndefined();
    expect(h.task(goal.id)).toMatchObject({ model: null, effort: null });
  });

  it('uses the requirement choice over the workspace default, field by field, and records it', async () => {
    h.workspaceService.updateWorkspace('speedx', { agent_model: 'sonnet', agent_effort: 'medium' });
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { effort: 'high' });

    const [goal] = await h.fanOutService.execute(req.id);

    expect(h.sent(goal.engine_task_id!)).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(h.task(goal.id)).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(resolveAgentProfile(h.db, goal.id)).toEqual({ model: 'sonnet', effort: 'high' });
  });

  it('a task pin wins over the requirement and the workspace', async () => {
    h.workspaceService.updateWorkspace('speedx', { agent_model: 'sonnet' });
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { model: 'haiku', effort: 'low' });
    const [goal] = await h.fanOutService.execute(req.id);
    h.db.prepare("UPDATE bridge_tasks SET model_override = 'opus' WHERE id = ?").run(goal.id);

    expect(resolveAgentProfile(h.db, goal.id)).toEqual({ model: 'opus', effort: 'low' });
  });

  it('keeps a value on undefined, clears it on null, and refuses bad values', () => {
    const req = h.createRequirement();
    h.requirementService.updateAgentProfile(req.id, { model: 'opus', effort: 'max' });
    expect(h.requirementService.updateAgentProfile(req.id, { effort: 'high' })).toMatchObject({ agent_model: 'opus', agent_effort: 'high' });
    expect(h.requirementService.updateAgentProfile(req.id, { model: null })).toMatchObject({ agent_model: null, agent_effort: 'high' });
    expect(() => h.requirementService.updateAgentProfile(req.id, { model: 'rm -rf /' })).toThrow(/Model ids use/);
    expect(() => h.requirementService.updateAgentProfile(req.id, { effort: 'huge' as any })).toThrow();
    expect(() => h.requirementService.updateAgentProfile('REQ-404', { model: 'opus' })).toThrow(/not found/);
  });

  it('workspace defaults are set and cleared without touching rules', () => {
    h.workspaceService.updateWorkspace('speedx', { rules: 'Be careful', agent_model: 'opus', agent_effort: 'high' });
    expect(h.workspaceService.updateWorkspace('speedx', { agent_effort: null })).toMatchObject({ rules: 'Be careful', agent_model: 'opus', agent_effort: null });
    expect(h.workspaceService.getWorkspace('speedx')).toMatchObject({ agent_model: 'opus' });
  });

  it('tickets use their requirement choice too, and manual engines ignore it', async () => {
    const req = h.createRequirement(['backend', 'mobile']);
    h.requirementService.updateAgentProfile(req.id, { model: 'opus', effort: 'xhigh' });
    const goals = await h.fanOutService.execute(req.id);
    const manualGoal = goals.find((g) => g.project === 'mobile')!;
    expect(manualGoal.engine_task_id).toBeTruthy();

    const ticket = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /x', body: 'Provide it please', blocking: false, req_id: req.id }, 'manual'
    );
    expect(h.sent(h.task(ticket.ticketId).engine_task_id)).toMatchObject({ model: 'opus', effort: 'xhigh' });
  });

  it('PUT /api/requirements/:id/agent-profile saves and validates', async () => {
    const { createApp } = await import('../api/app.js');
    const { testRequest } = await import('../api/testHelper.js');
    const { SseBroadcaster } = await import('../sse/broadcaster.js');
    const { Notifier } = await import('../notify/notifier.js');
    const app = createApp({
      db: h.db, workspaceService: h.workspaceService, projectService: h.projectService, requirementService: h.requirementService,
      fanOutService: h.fanOutService, linkService: h.linkService, ticketService: h.ticketService,
      broadcaster: new SseBroadcaster(), notifier: new Notifier(), getAdapter: h.getAdapter,
    });
    const req = h.createRequirement();

    const ok = await testRequest(app, 'PUT', `/api/requirements/${req.id}/agent-profile`, { body: { model: 'opus', effort: 'high' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ agent_model: 'opus', agent_effort: 'high' });
    expect((await testRequest(app, 'PUT', `/api/requirements/${req.id}/agent-profile`, { body: { effort: 'huge' } })).status).toBe(400);
    const ws = await testRequest(app, 'PUT', '/api/workspaces/speedx', { body: { agent_model: 'sonnet' } });
    expect(ws.body.agent_model).toBe('sonnet');
  });
});
```

(Use the project registration signature the codebase has — if `registerProject` does not accept `workspace_id`, insert the projects with SQL as `workspaceScope.test.ts` does.)

Run: `npx vitest run packages/server/src/services/agentProfile.test.ts` → FAIL (`./agentProfile.js` missing).

- [ ] **Step 4: Resolver and dispatch**

`packages/server/src/services/agentProfile.ts`:

```ts
import { AppDatabase } from '../db/index.js';
import type { ReasoningEffort } from '@sp-kickstack/shared';

export interface AgentProfile {
  model: string | null;
  effort: ReasoningEffort | null;
}

/**
 * Model and effort for a task's next run, each resolved on its own: the task's pin (Retry /
 * Request changes), else its requirement's choice, else its workspace's default; null = the
 * engine decides.
 */
export function resolveAgentProfile(db: AppDatabase, taskId: number): AgentProfile {
  const row = db
    .prepare(`
      SELECT t.model_override, t.effort_override,
             r.agent_model AS req_model, r.agent_effort AS req_effort,
             w.agent_model AS ws_model, w.agent_effort AS ws_effort
      FROM bridge_tasks t
      JOIN requirements r ON r.id = t.req_id
      LEFT JOIN workspaces w ON w.id = r.workspace_id
      WHERE t.id = ?
    `)
    .get(taskId) as Record<string, string | null> | undefined;
  if (!row) return { model: null, effort: null };
  return {
    model: row.model_override ?? row.req_model ?? row.ws_model ?? null,
    effort: (row.effort_override ?? row.req_effort ?? row.ws_effort ?? null) as ReasoningEffort | null,
  };
}

/** Fields for the engine create call: only what is set, so engines without support see no change. */
export function engineProfile(profile: AgentProfile): { model?: string; effort?: ReasoningEffort } {
  return { ...(profile.model ? { model: profile.model } : {}), ...(profile.effort ? { effort: profile.effort } : {}) };
}
```

`adapters/types.ts` `CreateEngineTaskInput`: add `model?: string;` and `effort?: ReasoningEffort;` (import the type from shared). The Stoneforge adapter already posts the whole input as JSON — no change there. `fakeEngine.ts`: in both create handlers store `model: body.model, effort: body.effort` on the task object (extend the task type with `model?: string; effort?: string`).

`FanOutService.dispatchGoal`: before the create call `const profile = resolveAgentProfile(this.db, taskId);`, pass `{ title: task.title, bodyMd: task.body_md || '', ...engineProfile(profile) }`, and in the success `UPDATE` also `SET model = ?, effort = ?` (values `profile.model`, `profile.effort`). Same in `TicketService.dispatchTicket` for `createTask`. Grep for other `createGoal(` / `createTask(` callers and treat them the same way.

- [ ] **Step 5: Requirement and workspace settings**

`RequirementService`:

```ts
  /** Agent model / effort for this requirement's runs: undefined keeps a value, null clears it. */
  public updateAgentProfile(id: string, input: AgentProfileInput): Requirement {
    const parsed = AgentProfileInputSchema.parse(input ?? {});
    const req = this.getRequirement(id);
    if (!req) throw new HttpError(404, `Requirement ${id} not found`);
    const model = parsed.model === undefined ? req.agent_model ?? null : parsed.model;
    const effort = parsed.effort === undefined ? req.agent_effort ?? null : parsed.effort;
    this.db
      .prepare("UPDATE requirements SET agent_model = ?, agent_effort = ?, updated_at = datetime('now') WHERE id = ?")
      .run(model, effort, id);
    return this.getRequirement(id)!;
  }
```

(`getRequirement` spreads the row, so the two columns come back; make sure they are `?? null`.)

`WorkspaceService.updateWorkspace`: after the existing COALESCE update, apply the two agent fields with keep/clear semantics:

```ts
    if (validated.agent_model !== undefined || validated.agent_effort !== undefined) {
      this.db
        .prepare(`
          UPDATE workspaces SET
            agent_model = CASE WHEN @setModel = 1 THEN @model ELSE agent_model END,
            agent_effort = CASE WHEN @setEffort = 1 THEN @effort ELSE agent_effort END
          WHERE id = @id
        `)
        .run({
          id,
          setModel: validated.agent_model !== undefined ? 1 : 0,
          model: validated.agent_model ?? null,
          setEffort: validated.agent_effort !== undefined ? 1 : 0,
          effort: validated.agent_effort ?? null,
        });
    }
```

Make `getWorkspace` / `listWorkspaces` return `agent_model` and `agent_effort` (`?? null`).

Route in `humanLoopRoutes.ts` (deps gain `requirementService: RequirementService`):

```ts
  app.put('/api/requirements/:id/agent-profile', (req, res, next) => {
    try {
      const updated = deps.requirementService.updateAgentProfile(req.params.id, req.body ?? {});
      deps.broadcaster.broadcast({ type: 'requirement_updated', payload: { id: updated.id } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
```

In `app.ts` add `requirementService: deps.requirementService` to the `registerHumanLoopRoutes(...)` object (nothing else).

- [ ] **Step 6: Verify and commit**

Tests PASS; `npm run verify` → 0.

```bash
git add packages/shared/src packages/server/src
git commit -m "feat(server): agent model and effort per workspace and requirement, sent to engines and recorded per run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server — pin on Retry and Request changes; MCP workspace scope

**Files:**
- Modify: `packages/shared/src/schemas.ts` (`RequestChangesInputSchema` gains `model`, `effort`)
- Modify: `packages/server/src/services/taskRetry.ts` (`RerunOptions.profile`, claim + restore carry the pin; `prepareRetry(…, profile?)`)
- Modify: `packages/server/src/services/fanOutService.ts` (`retryGoal(taskId, profile?)`), `ticketService.ts` (`retryTicket(taskId, profile?)`), `reviewService.ts` (`requestChanges` passes the pin)
- Modify: `packages/server/src/api/app.ts` — only the retry route: `retryGoal(taskId, req.body ?? {})` and `retryTicket(taskId, req.body ?? {})`
- Modify: `packages/server/src/mcp/server.ts` (`sp_list_projects` and `sp_create_requirement` take `workspace_id`, default `default`)
- Test: `packages/server/src/services/agentProfile.test.ts` (new describe), MCP test (extend the existing MCP test file if there is one, else add `packages/server/src/mcp/server.test.ts`)

**Interfaces — consumes:** Task 1 (`AgentProfileInputSchema`, `resolveAgentProfile`, columns). **Produces:** `prepareRetry(db, taskId, role, adapterFor, profile?: AgentProfileInput)`, `retryGoal(taskId, profile?)`, `retryTicket(taskId, profile?)`, `RequestChangesInput.model?/effort?`.

- [ ] **Step 1: Failing tests** (append to `agentProfile.test.ts`; reuse its harness; add a `clock`/sweeper only if needed)

Cover, each written first and seen failing:
1. Retry with `{ model: 'opus', effort: 'max' }` on a failed goal → the new engine task received `opus`/`max`; row `model_override='opus'`, `effort_override='max'`, `model='opus'`.
2. The pin survives automatic re-dispatch: make the next create fail (intercept `/api/goals` with a 500), retry with `{ model: 'opus' }` → row failed; restore the engine, run `RetrySweeper.sweepOnce()` with a clock past the backoff → the re-created engine task received `opus`.
3. Retry with `{ model: null }` clears the pin → resolves to the requirement's model.
4. Retry with `{ model: 'bad model!' }` → 400, row unchanged (status, engine id, pins).
5. Retry when the old engine task cannot be stopped (trip the engine with an `EngineThrottle`, or intercept `/cancel` with 409 while getTask reports running) → 503 and the previous pin is restored.
6. Request changes with `{ effort: 'xhigh' }` → every re-run task pinned `effort_override='xhigh'` and the engine received it; without the fields existing pins are kept.
7. HTTP: `POST /api/tasks/:id/retry` with body `{ "model": "opus" }` → 200 and pinned.
8. MCP: `sp_list_projects` with `workspace_id: 'speedx'` lists only speedx projects; without it lists the `default` workspace's; `sp_create_requirement` with `workspace_id` creates the requirement in that workspace (and drops other workspaces' repos — existing service rule).

- [ ] **Step 2: Implement**

`taskRetry.ts`:
- `RerunOptions` gains `profile?: AgentProfileInput` (already parsed).
- In `rerunTask`, compute the pins before the claim:

```ts
  const pick = <T>(next: T | null | undefined, current: T | null | undefined) => (next === undefined ? current ?? null : next);
  const modelOverride = pick(opts.profile?.model, task.model_override);
  const effortOverride = pick(opts.profile?.effort, task.effort_override);
```

  add `model_override = ?, effort_override = ?` to the claim `UPDATE`, and restore `task.model_override ?? null`, `task.effort_override ?? null` in the restore `UPDATE`.
- `prepareRetry(db, taskId, role, adapterFor, profile?: AgentProfileInput)`: `const parsedProfile = AgentProfileInputSchema.parse(profile ?? {});` as the first line (a bad value is refused before anything else), and pass `profile: parsedProfile` to `rerunTask`.
- `FanOutService.retryGoal(taskId, profile?)` / `TicketService.retryTicket(taskId, profile?)` pass it through.
- `ReviewService.requestChanges`: `RequestChangesInputSchema` now has `model`/`effort`; pass `profile: { model: parsed.model, effort: parsed.effort }` in the `rerunTask` options.
- `app.ts` retry route: pass `req.body ?? {}` as the profile argument (two expressions, nothing else).
- `mcp/server.ts`: add `workspace_id: { type: 'string', default: 'default', description: 'Workspace to use' }` to the input schema of `sp_list_projects` and `sp_create_requirement`; use `this.deps.projectService.listProjects(args.workspace_id || 'default')` and pass `workspace_id: args.workspace_id || 'default'` to `createRequirement`.

- [ ] **Step 3: Verify and commit**

Tests PASS (also `rateLimits.test.ts`, `review.test.ts`, `questions.test.ts` unchanged and green); `npm run verify` → 0.

```bash
git commit -am "feat(server): pin a stronger model on Retry and Request changes; MCP stays in one workspace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Use `git add` for any new test file first.)

---

### Task 3: Web — model & effort picker on the requirement, Retry, Request changes and workspace

**Files:**
- Create: `packages/web/src/lib/agentProfile.ts`, `packages/web/src/lib/agentProfile.test.ts`
- Modify: `packages/web/src/lib/humanLoopApi.ts` (+ tests): `updateRequirementAgentProfile(reqId, input)`, `retryTaskWith(taskId, input)`, `requestChanges(reqId, taskIds?, profile?)`
- Create: `packages/web/src/components/AgentProfilePicker.tsx`, `packages/web/src/components/RequirementAgentControl.tsx`, `packages/web/src/components/RetryWithProfile.tsx`
- Modify: `packages/web/src/pages/RequirementDetailPage.tsx` (control after the Merge Policy selector; task-card chip; Retry-with next to Retry), `packages/web/src/components/ReviewPanel.tsx` (picker in the confirm dialog), `packages/web/src/components/WorkspaceModals.tsx` (`WorkspaceRulesModal`: default agent section)

**Interfaces — consumes:** Tasks 1–2 routes and fields. **Produces:** `MODEL_SUGGESTIONS`, `EFFORTS`, `type ProfileValue = { model: string | null; effort: ReasoningEffort | null }`, `describeProfile(p)`, `effectiveProfile(layers)`, `isValidModel(m)`, `profilePatch(value)`; components `AgentProfilePicker({ value, onChange, inherited?, defaultLabel? })`, `RequirementAgentControl({ req })`, `RetryWithProfile({ task })`.

- [ ] **Step 1: Pure helpers + failing tests**

`packages/web/src/lib/agentProfile.ts`:

```ts
import type { ReasoningEffort } from '@sp-kickstack/shared';

export const MODEL_SUGGESTIONS = ['opus', 'sonnet', 'haiku', 'fable'];
export const EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ProfileValue {
  model: string | null;
  effort: ReasoningEffort | null;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

export function isValidModel(model: string): boolean {
  return MODEL_ID.test(model.trim());
}

/** "opus · high", "opus", "high effort", or "" when nothing is set. */
export function describeProfile(p: Partial<ProfileValue> | null | undefined): string {
  const model = p?.model || '';
  const effort = p?.effort ? (model ? p.effort : `${p.effort} effort`) : '';
  return [model, effort].filter(Boolean).join(' · ');
}

/** The value that applies and where each part comes from, first layer that sets it wins. */
export function effectiveProfile(layers: Array<{ value: Partial<ProfileValue> | null | undefined; from: string }>): {
  model: string | null;
  modelFrom: string | null;
  effort: ReasoningEffort | null;
  effortFrom: string | null;
} {
  const modelLayer = layers.find((l) => l.value?.model);
  const effortLayer = layers.find((l) => l.value?.effort);
  return {
    model: modelLayer?.value?.model ?? null,
    modelFrom: modelLayer?.from ?? null,
    effort: effortLayer?.value?.effort ?? null,
    effortFrom: effortLayer?.from ?? null,
  };
}

/** Only the parts a person chose ("Default" = keep), for Retry / Request changes. */
export function profilePatch(value: ProfileValue): { model?: string; effort?: ReasoningEffort } {
  return { ...(value.model ? { model: value.model } : {}), ...(value.effort ? { effort: value.effort } : {}) };
}
```

`agentProfile.test.ts` covers: `describeProfile` (both, model only, effort only → "high effort", none → ""); `effectiveProfile` with task/requirement/workspace layers picking model and effort from different layers; `isValidModel` (`opus`, `claude-opus-5-5`, `org/model:v1` true; `''`, `'rm -rf /'`, 81 chars false); `profilePatch` drops nulls.

Add to `humanLoopApi.test.ts` a describe asserting method, URL and JSON body of `updateRequirementAgentProfile('REQ-001', { model: 'opus' })` → `PUT /api/requirements/REQ-001/agent-profile`, `retryTaskWith(3, { effort: 'high' })` → `POST /api/tasks/3/retry`, and `requestChanges('REQ-001', undefined, { model: 'opus' })` → body `{ model: 'opus' }`.

Run → FAIL; implement the three client functions (`retryTaskWith` returns `BridgeTask`), run → PASS.

- [ ] **Step 2: Picker**

`AgentProfilePicker.tsx` — a Radix `Popover` (from `./ui/popover.js`):
- Trigger button: shows `describeProfile(value)` when set; otherwise `defaultLabel` (e.g. `Default: sonnet · high (workspace)` built by the caller from `inherited`) or `Engine default`. lucide `Cpu` icon. `aria-label="Agent model and effort"`.
- Content, two sections:
  - **Model**: a "Default" chip (sets `model: null`) + one chip per `MODEL_SUGGESTIONS` + a text input "Other model id" that applies on Enter/blur when `isValidModel`; otherwise shows `Use letters, digits and . _ : / - , e.g. opus`.
  - **Effort**: a "Default" chip + one chip per `EFFORTS` (`aria-pressed` on the selected one).
  - Footer note: `Engines that do not support a model or effort choice ignore it.`
- Calls `onChange(next)` on every choice; the caller decides when to save.

- [ ] **Step 3: Places**

- `RequirementAgentControl({ req })`: reads the workspace from `useWorkspace().workspaces.find((w) => w.id === req.workspace_id)`; value `{ model: req.agent_model ?? null, effort: req.agent_effort ?? null }`; `defaultLabel` from the workspace's values (`Default: <describe> (workspace)`) or `Engine default`; on change → `updateRequirementAgentProfile(req.id, { model: next.model, effort: next.effort })` (null clears), toast `Agent model saved; it applies to runs started from now on`, invalidate `['requirement', req.id]`. Render it in `RequirementDetailPage.tsx` right after the Merge Policy selector `div`, with a small `Agent:` label in the same style.
- Task card chip (RequirementDetailPage task card, after the engine-id line): when `task.model || task.effort`, show `describeProfile({ model: task.model, effort: task.effort })` in `text-[10px] font-mono` with `title="Model and effort this run uses"`; when `task.model_override || task.effort_override`, add a `pinned` marker with `title="Pinned for this task by Retry or Request changes"`.
- `RetryWithProfile({ task })`: a small chevron button next to **Retry** (same visibility as Retry: `canRetry(task, req.status)`) opening a Popover: `AgentProfilePicker` (value starts at `{ model: null, effort: null }` = keep; show the current pin if any), a **Clear pin** checkbox when the task has a pin (sends `null` for both), and a **Retry** button → `retryTaskWith(task.id, clear ? { model: null, effort: null } : profilePatch(value))`; toast via the existing `retryOutcome`; invalidate the requirement graph.
- `ReviewPanel.tsx` confirm dialog: add `AgentProfilePicker` labelled `Model for this round (optional)`, default label `Keep each task's setting`; pass `profilePatch(value)` as the third argument of `requestChanges`.
- `WorkspaceRulesModal`: a section `Default agent model & effort` with the picker (value from `activeWorkspace.agent_model/agent_effort`, default label `Engine default`); include `agent_model`, `agent_effort` (null when Default) in the `updateWorkspace` call.

- [ ] **Step 4: Verify and commit**

`npm run verify` → 0 (no browser: re-read the JSX for hooks order, disabled states, aria).

```bash
git add packages/web/src
git commit -m "feat(web): choose the agent model and effort per workspace, requirement, retry and review round

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs

**Files:** `docs/guide/02-projects-and-engines.md`, `03-requirements-and-fan-out.md`, `06-review-qa-and-merge.md`, `08-rate-limits-and-retry.md`, `09-settings-and-environment.md` (and wherever the guide documents MCP tools — grep `sp_list_projects`).

- [ ] **Step 1:** Document, in the guide's existing style (bold exact labels, numbered steps, "What happens next", "If something goes wrong"):
  - where the model/effort comes from (task pin → requirement → workspace → engine decides), field by field;
  - setting the workspace default (workspace rules dialog), the requirement's **Agent** control, **Retry** with a model (chevron), **Request changes** "Model for this round";
  - what the task card shows ("opus · high", pinned);
  - engines receive `model` and `effort` in the create request; whether Stoneforge honours them is **unconfirmed**; manual projects ignore them;
  - MCP `sp_list_projects` / `sp_create_requirement` take `workspace_id` (default `default`).
- [ ] **Step 2:** Grep every new label, field and default you wrote against the code; fix or remove what is not found; check links.
- [ ] **Step 3:** `git add docs/guide && git commit -m "docs: agent model and effort, MCP workspace scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
