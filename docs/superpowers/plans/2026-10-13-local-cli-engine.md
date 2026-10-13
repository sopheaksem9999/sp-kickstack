# Local AI CLI Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks of a repository whose engine is **Local AI CLI** progress on their own after Start Fan-Out: an AI CLI on this PC (Claude Code, AGY or Codex) works on each task in its own git worktree, at most N at a time, with live logs, questions, notes, Retry, rate limits and restart recovery.

**Architecture:** A new engine type `local` implements the existing `EngineAdapter` over a `local_runs` table, so fan-out, the watcher, Retry, questions, cancel and the merge gate keep working unchanged. An `AgentRunner` inside the server starts queued runs (headless CLI, own process group, task worktree), streams parsed output into `task_logs`, and turns each exit into a run status that the watcher maps to bridge statuses. Settings (Rule B) live in a new `local_engine_settings` row with routes and a Settings card.

**Tech Stack:** TypeScript, Node 22.19.0, Express 4, better-sqlite3, zod 3, vitest; React 18 + TanStack Query + Tailwind (web); esbuild (desktop bundle).

**Spec:** `docs/superpowers/specs/2026-10-13-local-cli-engine-design.md` (approved 2026-10-13).

## Global Constraints

- Node **v22.19.0** for every test and build: prefix commands with `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null &&`. Node 24 breaks `better-sqlite3`.
- After any change in `packages/shared`, rebuild it: `npm run --workspace=@sp-kickstack/shared build`.
- Never stop processes by pattern (`pkill -f`, `killall`). The user's own dev server runs on port 4100; tests only stop processes they started, by pid.
- Rule A (desktop): every route works in the browser and in Tauri; the web client uses `BASE` from `packages/web/src/lib/api.ts`; the desktop bundle must contain everything the server needs at runtime (`npm run desktop:bundle-server`).
- Rule B (settings): every new behavior is configurable in **Settings → AI & Local Engines**, declared in `packages/shared/src/schemas.ts` + `types.ts`, stored via `SettingsService`, read on every runner tick (no hardcoded limits), with live `Installed on PC` / `Not Detected` and `HEALTHY` / `PAUSED` badges.
- Rule C: no new native `<select>`, `<dialog>` or hand-made popups. (The two existing engine `<select>`s on the Projects page only get new options.)
- Defaults from the spec: parallel agents **2** (1–8), time limit **60** minutes (5–480), worktree root `<workspace>/agent-worktrees`, hold grace **2 minutes**, stop grace **10 s**, crash recoveries before failing **3**, unknown usage-limit wait **15 minutes**, longest wait **24 h**, log lines per run **5,000**, characters per log line **2,000**, error tail **20** lines.
- Commit messages: `feat(server): …` / `feat(web): …` / `docs: …` / `build(desktop): …`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work in a git worktree on branch `feat/local-cli-engine` (another session edits the main checkout). Commit only the files a task names.

## Review Focus

1. **The agent leaves a background process that holds its output open** (a dev server it started). Expected: the run still finishes within seconds of the CLI exiting, and the leftover process is stopped. Test: Task 7 "finishes even when the agent leaves a background process".
2. **`npm run dev` restarts the server mid-run, more than once.** Expected: the run continues each time and never fails because of it; only crash recoveries count. Test: Task 9 "a clean restart never counts against the run".
3. **The task branch is checked out in the person's own checkout.** Expected: the run fails with "…is checked out in <path>; switch that checkout to another branch, then Retry", and the person's checkout is untouched. Test: Task 7 "fails with what to do when the task branch is checked out in your own checkout".
4. **A note sent after a run finished, then Retry.** Expected: the new run reuses the worktree, continues from the branch, and its prompt carries the note and the Retry note. Test: Task 10 "Retry after a failure continues in the same worktree".
5. **Settings change while runs are queued** (engine turned off, then on). Expected: nothing starts while off, the engine reports why, and queued runs start once it is on again. Test: Task 7 "starts nothing while turned off".

---

## File Structure

**Server, new (`packages/server/src/localEngine/`)**

| File | Responsibility |
|---|---|
| `runStore.ts` | `local_runs` access: create (carrying undelivered notes), compare-and-set transitions, notes, queries |
| `outputParsers.ts` | Per-CLI stream-json → readable log lines, CLI errors, usage-limit detection |
| `cliProfiles.ts` | Which CLI runs, its binary, model/effort, headless command line, AGY quota reset |
| `worktrees.ts` | Create/reuse/remove a task's git worktree |
| `processes.ts` | Spawn in own process group, stop a group, identify a process by pid + start time |
| `prompt.ts` | The run prompt: task prompt + "Local run" rules + continuation + notes |
| `xticketLauncher.ts` | `xticket` launcher on the agent's PATH |
| `agentRunner.ts` | The engine: tick, start, supervise, classify, hold/release/notes, cancel, rate limits, shutdown, recovery, worktree cleanup, status |
| `handover.ts` | Hand queued Manual tasks to the local engine |

**Server, new elsewhere:** `adapters/localCliAdapter.ts`, `api/localEngineRoutes.ts`, `testing/fakeAgentCli.mjs`, `testing/localEngineFixture.ts`.

**Server, modified:** `db/migrations.ts` (v8), `services/settingsService.ts`, `adapters/types.ts`, `adapters/index.ts`, `adapters/stoneforgeAdapter.ts`, `services/fanOutService.ts`, `services/ticketService.ts`, `watcher/engineWatcher.ts`, `services/mergeGate.ts`, `api/app.ts`, `index.ts`.

**Shared, modified:** `packages/shared/src/schemas.ts`, `packages/shared/src/types.ts`.

**Web:** new `lib/localEngineApi.ts`, `lib/localEngineText.ts` (+ test), `components/LocalEngineSettingsSection.tsx`; modified `pages/SettingsPage.tsx`, `pages/ProjectsPage.tsx`.

**Desktop / docs:** `scripts/bundle-desktop-server.mjs`, regenerated `packages/desktop/src-tauri/resources/server/{index.mjs,xticket.mjs}`, `docs/guide/{02,05,09,10}-*.md`, `docs/guide/settings-guide.md`.

---

### Task 1: Engine type `local` and Local AI CLI engine settings

**Files:**
- Modify: `packages/shared/src/schemas.ts` (line 29 `EngineTypeSchema`; append after `UpdateAiCliSettingsInput` ~line 367)
- Modify: `packages/shared/src/types.ts` (line 26 `EngineType`; append after `interface AiCliSettings` ~line 266-274)
- Modify: `packages/server/src/services/settingsService.ts`
- Test: `packages/server/src/services/localEngineSettings.test.ts`

**Interfaces:**
- Produces: `EngineType` includes `'local'`; `AGENT_CLI_IDS` (`readonly ['claude-cli','agy-cli','codex-cli']`); `LocalEngineSettingsSchema`, `UpdateLocalEngineSettingsInputSchema`; types `AgentCliId`, `LocalEngineSettings { enabled; agentCli: 'default'|AgentCliId; maxParallel; runTimeoutMinutes; worktreeRoot }`, `LocalEngineCliStatus { id; label; installed; enabled; pausedUntil }`, `LocalEngineStatus { enabled; cli; problem; clis; counts{running,queued,held,rate_limited}; maxParallel; worktreeRoot }`; `SettingsService.getLocalEngineSettings(): LocalEngineSettings`, `SettingsService.updateLocalEngineSettings(updates: unknown): LocalEngineSettings`.

- [ ] **Step 1: Write the failing test** — create `packages/server/src/services/localEngineSettings.test.ts`:

```ts
// Settings → AI & Local Engines → Local AI CLI engine.
import { describe, it, expect } from 'vitest';
import { EngineTypeSchema } from '@sp-kickstack/shared';
import { initDatabase } from '../db/index.js';
import { SettingsService } from './settingsService.js';

describe('Local AI CLI engine settings', () => {
  it('defaults to on, the AI default CLI, 2 parallel agents and a 60 minute limit', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(settings.getLocalEngineSettings()).toEqual({
      enabled: true, agentCli: 'default', maxParallel: 2, runTimeoutMinutes: 60, worktreeRoot: '',
    });
  });

  it('saves a partial update and keeps the other values', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    settings.updateLocalEngineSettings({ maxParallel: 3, agentCli: 'agy-cli' });
    expect(settings.getLocalEngineSettings()).toEqual({
      enabled: true, agentCli: 'agy-cli', maxParallel: 3, runTimeoutMinutes: 60, worktreeRoot: '',
    });
  });

  it('refuses values outside their ranges, relative folders and unknown fields', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(() => settings.updateLocalEngineSettings({ maxParallel: 0 })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ maxParallel: 9 })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ runTimeoutMinutes: 4 })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ worktreeRoot: 'relative/dir' })).toThrow(/absolute path/);
    expect(() => settings.updateLocalEngineSettings({ agentCli: 'ollama' })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ unknown: 1 })).toThrow();
    expect(settings.getLocalEngineSettings().maxParallel).toBe(2);
  });

  it('accepts an absolute worktree folder', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(settings.updateLocalEngineSettings({ worktreeRoot: '/tmp/agents' }).worktreeRoot).toBe('/tmp/agents');
  });

  it('knows the local engine type for repositories', () => {
    expect(EngineTypeSchema.parse('local')).toBe('local');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/localEngineSettings.test.ts`
Expected: FAIL (`getLocalEngineSettings is not a function`, `Invalid enum value … 'local'`).

- [ ] **Step 3: Shared schema and types**

In `packages/shared/src/schemas.ts` replace line 29:

```ts
export const EngineTypeSchema = z.enum(['stoneforge', 'clinekanban', 'manual', 'local']);
```

Append after `export type UpdateAiCliSettingsInput = z.input<typeof AiCliSettingsSchema>;`:

```ts
/** AI CLIs that can edit code and run commands; the Local AI CLI engine runs one of them. */
export const AGENT_CLI_IDS = ['claude-cli', 'agy-cli', 'codex-cli'] as const;

const isAbsolutePath = (value: string) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);

export const LocalEngineSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  agentCli: z.enum(['default', 'claude-cli', 'agy-cli', 'codex-cli']).default('default'),
  maxParallel: z.number().int().min(1).max(8).default(2),
  runTimeoutMinutes: z.number().int().min(5).max(480).default(60),
  worktreeRoot: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => v === '' || isAbsolutePath(v), 'must be an absolute path, or empty for the default')
    .default(''),
});

export const UpdateLocalEngineSettingsInputSchema = LocalEngineSettingsSchema.partial().strict();
```

In `packages/shared/src/types.ts` replace line 26:

```ts
export type EngineType = 'stoneforge' | 'clinekanban' | 'manual' | 'local';
```

Append right after the closing `}` of `export interface AiCliSettings { … }`:

```ts
/** An AI CLI the Local AI CLI engine can run as a coding agent. */
export type AgentCliId = 'claude-cli' | 'agy-cli' | 'codex-cli';

/** Settings → AI & Local Engines → Local AI CLI engine. */
export interface LocalEngineSettings {
  /** Off: runs wait in QUEUED and the engine shows as down. */
  enabled: boolean;
  /** 'default' follows the AI default (falling back to the first usable agent CLI). */
  agentCli: 'default' | AgentCliId;
  /** Agents running at once, all workspaces together (1-8). */
  maxParallel: number;
  /** A run longer than this is stopped (5-480). */
  runTimeoutMinutes: number;
  /** Absolute folder for task worktrees; '' = <workspace>/agent-worktrees. */
  worktreeRoot: string;
}

export interface LocalEngineCliStatus {
  id: AgentCliId;
  label: string;
  installed: boolean;
  enabled: boolean;
  /** While a usage limit pauses this CLI: until when (ISO). */
  pausedUntil: string | null;
}

/** Live state for the Settings card. */
export interface LocalEngineStatus {
  enabled: boolean;
  /** The CLI the next run uses; null (with `problem`) when none can run. */
  cli: AgentCliId | null;
  problem: string | null;
  clis: LocalEngineCliStatus[];
  counts: { running: number; queued: number; held: number; rate_limited: number };
  maxParallel: number;
  /** The folder actually used (the default filled in). */
  worktreeRoot: string;
}
```

- [ ] **Step 4: SettingsService getter and updater**

In `packages/server/src/services/settingsService.ts`, add `LocalEngineSettings, LocalEngineSettingsSchema, UpdateLocalEngineSettingsInputSchema,` to the `@sp-kickstack/shared` import, and add these methods before `getNotificationSettings()`:

```ts
  public getLocalEngineSettings(): LocalEngineSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'local_engine_settings'").get() as { value: string } | undefined;
    if (row) {
      try {
        return LocalEngineSettingsSchema.parse(JSON.parse(row.value));
      } catch {
        // Fallback to defaults
      }
    }
    return LocalEngineSettingsSchema.parse({});
  }

  /** Partial update; unknown fields and out-of-range values are refused (400 through the API). */
  public updateLocalEngineSettings(updates: unknown): LocalEngineSettings {
    const patch = UpdateLocalEngineSettingsInputSchema.parse(updates ?? {});
    const updated = LocalEngineSettingsSchema.parse({ ...this.getLocalEngineSettings(), ...patch });
    this.db
      .prepare(`
        INSERT INTO settings (key, value) VALUES ('local_engine_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(JSON.stringify(updated));
    return updated;
  }
```

- [ ] **Step 5: Rebuild shared and run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npm run --workspace=@sp-kickstack/shared build && npx vitest run packages/server/src/services/localEngineSettings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck** (a new `EngineType` member can break exhaustive maps)

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npm run typecheck`
Expected: no errors. If a `Record<EngineType, …>` complains, add a `local: 'Local AI CLI'` entry there.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/types.ts packages/server/src/services/settingsService.ts packages/server/src/services/localEngineSettings.test.ts
git commit -m "feat(server): Local AI CLI engine type and settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `local_runs` table and RunStore

**Files:**
- Modify: `packages/server/src/db/migrations.ts` (append to `MIGRATIONS`, after version 7)
- Create: `packages/server/src/localEngine/runStore.ts`
- Test: `packages/server/src/localEngine/runStore.test.ts`

**Interfaces:**
- Consumes: `AgentCliId` (Task 1).
- Produces: `type RunStatus = 'queued'|'running'|'held'|'rate_limited'|'review'|'no_changes'|'failed'|'timed_out'|'cancelled'`; `FINISHED_RUN_STATUSES: RunStatus[]`; `interface LocalRun` (columns below); `type RunPatch`; `interface CreateRunInput { bridgeTaskId; project; title; bodyMd; model?; effort? }`; `class RunStore { create(input): LocalRun; get(id): LocalRun|undefined; update(id, patch): void; transition(id, from: RunStatus[], patch): boolean; appendNote(id, note): boolean; queued(): LocalRun[]; withStatus(statuses): LocalRun[]; forTask(taskId): LocalRun[]; count(status): number; pausedClis(now?): Map<AgentCliId, string> }`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/localEngine/runStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { LATEST_VERSION, getUserVersion } from '../db/migrations.js';
import { RunStore } from './runStore.js';

const store = () => new RunStore(initDatabase(':memory:'));
const input = (bridgeTaskId = 1) => ({ bridgeTaskId, project: 'backend', title: 'T', bodyMd: 'Do it' });

describe('RunStore', () => {
  it('is created by migration 8', () => {
    const db = initDatabase(':memory:');
    expect(LATEST_VERSION).toBe(8);
    expect(getUserVersion(db)).toBe(8);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'local_runs'").get()).toBeTruthy();
  });

  it('queues a run with a local- id', () => {
    const runs = store();
    const run = runs.create({ ...input(), model: 'opus', effort: 'high' });
    expect(run).toMatchObject({ bridge_task_id: 1, project: 'backend', status: 'queued', model: 'opus', effort: 'high', notes_md: '', interruptions: 0 });
    expect(run.id).toMatch(/^local-[0-9a-f-]{36}$/);
    expect(runs.queued().map((r) => r.id)).toEqual([run.id]);
  });

  it('changes status only from the listed states', () => {
    const runs = store();
    const run = runs.create(input());
    expect(runs.transition(run.id, ['running'], { status: 'review' })).toBe(false);
    expect(runs.transition(run.id, ['queued'], { status: 'running', pid: 42 })).toBe(true);
    expect(runs.get(run.id)).toMatchObject({ status: 'running', pid: 42 });
    expect(runs.count('running')).toBe(1);
  });

  it('refuses to change a column that is not a run field', () => {
    const runs = store();
    const run = runs.create(input());
    expect(() => runs.update(run.id, { id: 'x' } as any)).toThrow(/cannot be changed/);
  });

  it('collects notes, and a new run of the same task takes the notes earlier runs never delivered', () => {
    const runs = store();
    const first = runs.create(input(7));
    runs.transition(first.id, ['queued'], { status: 'failed' });
    runs.appendNote(first.id, 'Use the v2 endpoint');
    runs.appendNote(first.id, 'Keep the old route');
    expect(runs.get(first.id)!.notes_md).toBe('Use the v2 endpoint\n\nKeep the old route');

    const other = runs.create(input(8));
    const second = runs.create(input(7));
    expect(second.notes_md).toBe('Use the v2 endpoint\n\nKeep the old route');
    expect(runs.get(first.id)!.notes_md).toBe('');
    expect(other.notes_md).toBe('');
  });

  it('reports a CLI as paused only while a rate-limited run waits for a future reset', () => {
    const runs = store();
    const now = Date.parse('2026-10-13T10:00:00Z');
    const a = runs.create(input(1));
    const b = runs.create(input(2));
    runs.update(a.id, { status: 'rate_limited', cli: 'agy-cli', resume_at: '2026-10-13T11:00:00.000Z' });
    runs.update(b.id, { status: 'rate_limited', cli: 'claude-cli', resume_at: '2026-10-13T09:00:00.000Z' });
    expect([...runs.pausedClis(now)]).toEqual([['agy-cli', '2026-10-13T11:00:00.000Z']]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/runStore.test.ts`
Expected: FAIL (`Cannot find module './runStore.js'`).

- [ ] **Step 3: Migration 8** — in `packages/server/src/db/migrations.ts`, add after the version 7 entry (before the closing `];`):

```ts
  {
    version: 8,
    name: 'Local AI CLI engine runs',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS local_runs (
          id                  TEXT PRIMARY KEY,
          bridge_task_id      INTEGER NOT NULL,
          project             TEXT NOT NULL,
          title               TEXT NOT NULL,
          body_md             TEXT NOT NULL,
          model               TEXT,
          effort              TEXT,
          cli                 TEXT,
          status              TEXT NOT NULL DEFAULT 'queued',
          notes_md            TEXT NOT NULL DEFAULT '',
          continuation        INTEGER NOT NULL DEFAULT 0,
          worktree            TEXT,
          start_sha           TEXT,
          end_sha             TEXT,
          pid                 INTEGER,
          pid_started_at      TEXT,
          exit_code           INTEGER,
          error               TEXT,
          resume_at           TEXT,
          interruptions       INTEGER NOT NULL DEFAULT 0,
          hold_requested_at   TEXT,
          cancel_requested_at TEXT,
          created_at          TEXT NOT NULL,
          started_at          TEXT,
          finished_at         TEXT,
          updated_at          TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_local_runs_status ON local_runs(status);
        CREATE INDEX IF NOT EXISTS idx_local_runs_task ON local_runs(bridge_task_id);
      `);
    },
  },
```

- [ ] **Step 4: RunStore** — create `packages/server/src/localEngine/runStore.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { AgentCliId } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';

/** Raw status of one agent run: the Local AI CLI engine's own state. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'held'
  | 'rate_limited'
  | 'review'
  | 'no_changes'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

/** A run in one of these states never starts again (Retry creates a new run). */
export const FINISHED_RUN_STATUSES: RunStatus[] = ['review', 'no_changes', 'failed', 'timed_out', 'cancelled'];

export interface LocalRun {
  id: string;
  bridge_task_id: number;
  project: string;
  title: string;
  body_md: string;
  model: string | null;
  effort: string | null;
  cli: AgentCliId | null;
  status: RunStatus;
  /** Notes and answers not yet given to the agent; delivered when its next run starts. */
  notes_md: string;
  /** 1 when the next start continues earlier work (after a question, a usage limit or a restart). */
  continuation: number;
  worktree: string | null;
  start_sha: string | null;
  end_sha: string | null;
  pid: number | null;
  /** `ps` start time of `pid`: with the pid it proves a process is ours after a restart. */
  pid_started_at: string | null;
  exit_code: number | null;
  error: string | null;
  resume_at: string | null;
  /** Crash recoveries of this run; at 3 it fails. */
  interruptions: number;
  hold_requested_at: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export type RunPatch = Partial<Omit<LocalRun, 'id' | 'bridge_task_id' | 'project' | 'created_at' | 'updated_at'>>;

const PATCHABLE = new Set<string>([
  'title', 'body_md', 'model', 'effort', 'cli', 'status', 'notes_md', 'continuation', 'worktree', 'start_sha', 'end_sha',
  'pid', 'pid_started_at', 'exit_code', 'error', 'resume_at', 'interruptions', 'hold_requested_at', 'cancel_requested_at',
  'started_at', 'finished_at',
]);

export interface CreateRunInput {
  bridgeTaskId: number;
  project: string;
  title: string;
  bodyMd: string;
  model?: string | null;
  effort?: string | null;
}

/** Storage for agent runs (table local_runs). Status changes are compare-and-set. */
export class RunStore {
  constructor(private db: AppDatabase) {}

  /**
   * Queue a new run. Notes that earlier runs of the same task never delivered (sent after they
   * finished) move to the new run, so Retry and Request changes do not lose them.
   */
  create(input: CreateRunInput): LocalRun {
    const id = `local-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const pending = this.db
        .prepare("SELECT notes_md FROM local_runs WHERE bridge_task_id = ? AND notes_md <> '' ORDER BY created_at, rowid")
        .all(input.bridgeTaskId) as Array<{ notes_md: string }>;
      if (pending.length) {
        this.db
          .prepare("UPDATE local_runs SET notes_md = '', updated_at = ? WHERE bridge_task_id = ? AND notes_md <> ''")
          .run(now, input.bridgeTaskId);
      }
      this.db
        .prepare(`
          INSERT INTO local_runs (id, bridge_task_id, project, title, body_md, model, effort, status, notes_md, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        `)
        .run(
          id, input.bridgeTaskId, input.project, input.title, input.bodyMd, input.model ?? null, input.effort ?? null,
          pending.map((r) => r.notes_md).join('\n\n'), now, now
        );
    })();
    return this.get(id)!;
  }

  get(id: string): LocalRun | undefined {
    return this.db.prepare('SELECT * FROM local_runs WHERE id = ?').get(id) as LocalRun | undefined;
  }

  /** Change fields without a status check. */
  update(id: string, patch: RunPatch): void {
    const { sql, values } = this.setClause(patch);
    this.db.prepare(`UPDATE local_runs SET ${sql} WHERE id = ?`).run(...values, id);
  }

  /** Compare-and-set: apply `patch` only while the run is in one of `from`. True when applied. */
  transition(id: string, from: RunStatus[], patch: RunPatch): boolean {
    const { sql, values } = this.setClause(patch);
    const marks = from.map(() => '?').join(', ');
    return this.db.prepare(`UPDATE local_runs SET ${sql} WHERE id = ? AND status IN (${marks})`).run(...values, id, ...from).changes === 1;
  }

  appendNote(id: string, note: string): boolean {
    const text = note.trim();
    if (!text) return false;
    return (
      this.db
        .prepare("UPDATE local_runs SET notes_md = CASE WHEN notes_md = '' THEN ? ELSE notes_md || char(10) || char(10) || ? END, updated_at = ? WHERE id = ?")
        .run(text, text, new Date().toISOString(), id).changes === 1
    );
  }

  /** Queued runs, oldest first. */
  queued(): LocalRun[] {
    return this.withStatus(['queued']);
  }

  withStatus(statuses: RunStatus[]): LocalRun[] {
    const marks = statuses.map(() => '?').join(', ');
    return this.db.prepare(`SELECT * FROM local_runs WHERE status IN (${marks}) ORDER BY created_at, rowid`).all(...statuses) as LocalRun[];
  }

  forTask(taskId: number): LocalRun[] {
    return this.db.prepare('SELECT * FROM local_runs WHERE bridge_task_id = ? ORDER BY created_at, rowid').all(taskId) as LocalRun[];
  }

  count(status: RunStatus): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM local_runs WHERE status = ?').get(status) as { n: number }).n;
  }

  /** CLIs paused by a usage limit: the latest future resume time among their rate-limited runs. */
  pausedClis(now: number = Date.now()): Map<AgentCliId, string> {
    const rows = this.db
      .prepare(`
        SELECT cli, MAX(resume_at) AS until FROM local_runs
        WHERE status = 'rate_limited' AND cli IS NOT NULL AND resume_at > ?
        GROUP BY cli
      `)
      .all(new Date(now).toISOString()) as Array<{ cli: AgentCliId; until: string }>;
    return new Map(rows.map((r) => [r.cli, r.until]));
  }

  private setClause(patch: RunPatch): { sql: string; values: unknown[] } {
    const keys = Object.keys(patch);
    for (const key of keys) {
      if (!PATCHABLE.has(key)) throw new Error(`local_runs.${key} cannot be changed`);
    }
    const values = keys.map((k) => (patch as Record<string, unknown>)[k] ?? null);
    return {
      sql: [...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', '),
      values: [...values, new Date().toISOString()],
    };
  }
}
```

- [ ] **Step 5: Run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/runStore.test.ts`
Expected: PASS (6 tests). Then update `packages/server/src/db/migrations.test.ts:52` from `expect(LATEST_VERSION).toBe(7);` to `expect(LATEST_VERSION).toBe(8);` and run `npx vitest run packages/server/src/db` — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/migrations.ts packages/server/src/localEngine/runStore.ts packages/server/src/localEngine/runStore.test.ts
git commit -m "feat(server): local_runs table and run store for the Local AI CLI engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Also `git add packages/server/src/db/migrations.test.ts`.)

---

### Task 3: Output parsers

**Files:**
- Create: `packages/server/src/localEngine/outputParsers.ts`
- Test: `packages/server/src/localEngine/outputParsers.test.ts`

**Interfaces:**
- Consumes: `AgentCliId`.
- Produces: `interface ParsedOutput { logs: string[]; rateLimit?: { resetAt: string | null }; error?: string }`; `interface OutputParser { push(line): ParsedOutput; flush(): ParsedOutput }`; `createParser(cli): OutputParser`; `claudeParser()`, `agyParser()`, `codexParser()`; `looksLikeRateLimit(text): boolean`; `resetFromText(text): string | null`; `describeTool(name, input): string`.

Formats (captured on this PC on 2026-10-13):
- **Claude Code 2.1.284** `-p --output-format stream-json --verbose`: `{"type":"system","subtype":"init","model":…,"permissionMode":…,"claude_code_version":…}`, `{"type":"system","subtype":"hook_started"|…}` (noise), `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"|"rejected","resetsAt":<epoch s>,"rateLimitType":"five_hour"}}`, `{"type":"assistant","message":{"content":[{"type":"text","text":…}|{"type":"tool_use","name":"Bash","input":{…}}|{"type":"thinking"}]}}`, `{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":…}]}}`, `{"type":"result","subtype":"success","is_error":false,"result":"OK","num_turns":1,"duration_ms":2534,"total_cost_usd":0.03,"api_error_status":null}`.
- **AGY 1.3.3** `-p <prompt> --output-format stream-json`: `{"event":"init","init":{"cwd":…,"permission_mode":…}}`, `{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE"|"DONE","step_type":"agent_response","text_delta":"OK"}}` (text arrives in deltas), `{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"…"}}}}` (same step again with `"state":"DONE"` and `output`), `{"event":"result","result":{"status":"SUCCESS","response":"OK\n","duration_seconds":3.9}}`.
- **Codex** `exec --json` (documented format; Codex is not installed here): `thread.started`, `item.started`/`item.completed` with `item.type` `command_execution` | `agent_message` | `file_change` | `error`, `turn.completed`, `turn.failed {error:{message}}`, `error {message}`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/localEngine/outputParsers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { agyParser, claudeParser, codexParser, describeTool, looksLikeRateLimit, resetFromText } from './outputParsers.js';

const j = (o: unknown) => JSON.stringify(o);
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();

describe('Claude Code stream-json', () => {
  it('turns events into readable lines and ignores noise', () => {
    const p = claudeParser();
    expect(p.push(j({ type: 'system', subtype: 'hook_started', hook_id: 'x' })).logs).toEqual([]);
    expect(p.push(j({ type: 'system', subtype: 'init', claude_code_version: '2.1.284', model: 'claude-opus-5-5', permissionMode: 'bypassPermissions' })).logs)
      .toEqual(['Agent started: Claude Code 2.1.284 · claude-opus-5-5']);
    expect(p.push(j({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1791865200 } }))).toEqual({ logs: [] });
    expect(p.push(j({ type: 'assistant', message: { content: [{ type: 'thinking' }, { type: 'text', text: 'Plan:\n\n1. tests' }] } })).logs)
      .toEqual(['Plan:', '1. tests']);
    expect(p.push(j({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })).logs)
      .toEqual(['→ Bash: npm test']);
    expect(p.push(j({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1\nmore' }] } })).logs)
      .toEqual(['  ✗ Exit code 1']);
    expect(p.push(j({ type: 'result', subtype: 'success', is_error: false, result: 'OK', num_turns: 3, duration_ms: 12400, total_cost_usd: 0.4 })))
      .toEqual({ logs: ['Finished: success · 3 turns · 12 s · $0.40'] });
    expect(p.push('plain text line').logs).toEqual(['plain text line']);
  });

  it('reports a rejected usage limit with its reset time', () => {
    const out = claudeParser().push(j({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1791865200, rateLimitType: 'five_hour' } }));
    expect(out.rateLimit).toEqual({ resetAt: iso(1791865200) });
    expect(out.logs[0]).toContain('Usage limit reached (five_hour)');
  });

  it('reports an error result, and a usage-limit error with the reset after the pipe', () => {
    const p = claudeParser();
    const failed = p.push(j({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Tool crashed' }));
    expect(failed.error).toBe('Tool crashed');
    expect(failed.rateLimit).toBeUndefined();
    const limited = p.push(j({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1791865200' }));
    expect(limited.rateLimit).toEqual({ resetAt: iso(1791865200) });
    const http429 = p.push(j({ type: 'result', is_error: true, api_error_status: 429, result: 'API Error' }));
    expect(http429.rateLimit).toEqual({ resetAt: null });
  });
});

describe('AGY stream-json', () => {
  it('joins text deltas per step and logs each tool once', () => {
    const p = agyParser();
    expect(p.push(j({ event: 'init', init: { permission_mode: 'bypass' } })).logs).toEqual(['Agent started: AGY · bypass']);
    expect(p.push(j({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hel' } })).logs).toEqual([]);
    expect(p.push(j({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'lo\n' } })).logs).toEqual(['Hello']);
    const tool = { step_index: 2, step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'git commit -m x' } } };
    expect(p.push(j({ event: 'step_update', step_update: { ...tool, state: 'ACTIVE' } })).logs).toEqual(['→ run_command: git commit -m x']);
    expect(p.push(j({ event: 'step_update', step_update: { ...tool, state: 'DONE' } })).logs).toEqual([]);
    expect(p.push(j({ event: 'result', result: { status: 'SUCCESS', response: 'DONE', duration_seconds: 16.8 } })).logs).toEqual(['Finished: success · 17 s']);
  });

  it('flushes text that never reached DONE', () => {
    const p = agyParser();
    p.push(j({ event: 'step_update', step_update: { step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'half a sentence' } }));
    expect(p.flush().logs).toEqual(['half a sentence']);
  });

  it('reports a failed result and recognises an exhausted quota', () => {
    const out = agyParser().push(j({ event: 'result', result: { status: 'ERROR', error: 'RESOURCE_EXHAUSTED: quota exceeded' } }));
    expect(out.error).toContain('RESOURCE_EXHAUSTED');
    expect(out.rateLimit).toEqual({ resetAt: null });
  });
});

describe('Codex exec --json', () => {
  it('logs commands, messages and file changes', () => {
    const p = codexParser();
    expect(p.push(j({ type: 'thread.started', thread_id: 't' })).logs).toEqual(['Agent started: Codex']);
    expect(p.push(j({ type: 'item.started', item: { type: 'command_execution', command: 'npm test' } })).logs).toEqual(['→ shell: npm test']);
    expect(p.push(j({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', exit_code: 1 } })).logs).toEqual(['  ✗ exit 1']);
    expect(p.push(j({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }] } })).logs).toEqual(['→ update: src/a.ts']);
    expect(p.push(j({ type: 'item.completed', item: { type: 'agent_message', text: 'All done' } })).logs).toEqual(['All done']);
  });

  it('reports a failed turn and a usage limit', () => {
    const out = codexParser().push(j({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }));
    expect(out.error).toContain('usage limit');
    expect(out.rateLimit).toEqual({ resetAt: null });
  });
});

describe('helpers', () => {
  it('recognises usage and rate limits but not ordinary output', () => {
    expect(looksLikeRateLimit('Error: 429 Too Many Requests')).toBe(true);
    expect(looksLikeRateLimit('Claude AI usage limit reached')).toBe(true);
    expect(looksLikeRateLimit('All 42 tests passed')).toBe(false);
    expect(resetFromText('limit reached|1791865200')).toBe(iso(1791865200));
    expect(resetFromText('no time here')).toBeNull();
  });

  it('describes a tool call by its command, file or pattern', () => {
    expect(describeTool('Edit', { file_path: '/w/src/a.ts', old_string: 'x' })).toBe('→ Edit: /w/src/a.ts');
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('→ Grep: TODO');
    expect(describeTool('TodoWrite', undefined)).toBe('→ TodoWrite');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/outputParsers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `packages/server/src/localEngine/outputParsers.ts`:

```ts
// Turns an agent CLI's streamed JSON into readable log lines for Logs, and notices the CLI's own
// errors and usage limits. Output of the commands the agent runs is never checked for limits.
import type { AgentCliId } from '@sp-kickstack/shared';

export interface ParsedOutput {
  /** Readable lines for the task log (empty for noise such as hooks or token counts). */
  logs: string[];
  /** The CLI said its usage or rate limit is reached; resetAt when it said until when (ISO). */
  rateLimit?: { resetAt: string | null };
  /** The CLI's own error (not a failing command the agent ran). */
  error?: string;
}

export interface OutputParser {
  push(line: string): ParsedOutput;
  /** Text still buffered when the process ends. */
  flush(): ParsedOutput;
}

const RATE_LIMIT_TEXT = /usage limit|rate[ _-]?limit|quota (?:exceeded|exhausted)|resource[ _]exhausted|too many requests|\b429\b/i;

export function looksLikeRateLimit(text: string): boolean {
  return RATE_LIMIT_TEXT.test(text);
}

/** "…limit reached|1791865200": epoch seconds after a pipe, as Claude Code prints it. */
export function resetFromText(text: string): string | null {
  const match = /\|(\d{10})\b/.exec(text);
  return match ? new Date(Number(match[1]) * 1000).toISOString() : null;
}

const NONE: ParsedOutput = { logs: [] };
const plain = (line: string): ParsedOutput => (line.trim() ? { logs: [line] } : { logs: [] });
const lines = (text: string) => text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
const cut = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One line describing a tool call: its command, file or pattern. */
export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = input?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  };
  const detail =
    pick('command', 'CommandLine', 'cmd') ??
    pick('file_path', 'TargetFile', 'AbsolutePath', 'path', 'notebook_path') ??
    pick('pattern', 'Query', 'query', 'url', 'Url', 'description') ??
    (input && Object.keys(input).length ? JSON.stringify(input) : '');
  return `→ ${name}${detail ? `: ${cut(detail.replace(/\s+/g, ' ').trim())}` : ''}`;
}

function parseJson(line: string): Record<string, any> | null {
  if (!line.startsWith('{')) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** The CLI's own failure; a usage-limit wording also marks a rate limit. */
function failure(text: string): ParsedOutput {
  const error = cut(text.trim(), 1000);
  return {
    logs: [`✗ ${error}`],
    error,
    ...(looksLikeRateLimit(text) ? { rateLimit: { resetAt: resetFromText(text) } } : {}),
  };
}

/** Claude Code `-p --output-format stream-json --verbose`. */
export function claudeParser(): OutputParser {
  return {
    push(line) {
      const e = parseJson(line);
      if (!e) return plain(line);
      switch (e.type) {
        case 'system': {
          if (e.subtype !== 'init') return NONE;
          const version = e.claude_code_version ? ` ${e.claude_code_version}` : '';
          return { logs: [`Agent started: Claude Code${version}${e.model ? ` · ${e.model}` : ''}`] };
        }
        case 'rate_limit_event': {
          const info = e.rate_limit_info ?? {};
          if (info.status !== 'rejected') return NONE;
          const resetAt = typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000).toISOString() : null;
          return {
            logs: [`Usage limit reached${info.rateLimitType ? ` (${info.rateLimitType})` : ''}${resetAt ? `; resets ${resetAt}` : ''}`],
            rateLimit: { resetAt },
          };
        }
        case 'assistant': {
          const out: string[] = [];
          for (const part of e.message?.content ?? []) {
            if (part?.type === 'text' && typeof part.text === 'string') out.push(...lines(part.text));
            else if (part?.type === 'tool_use') out.push(describeTool(String(part.name ?? 'tool'), part.input));
          }
          return { logs: out };
        }
        case 'user': {
          const out: string[] = [];
          for (const part of e.message?.content ?? []) {
            if (part?.type !== 'tool_result' || !part.is_error) continue;
            const text = typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? '');
            out.push(`  ✗ ${cut(lines(text)[0] ?? 'failed')}`);
          }
          return { logs: out };
        }
        case 'result': {
          const summary =
            `Finished: ${e.subtype ?? 'done'}` +
            (typeof e.num_turns === 'number' ? ` · ${e.num_turns} turns` : '') +
            (typeof e.duration_ms === 'number' ? ` · ${Math.round(e.duration_ms / 1000)} s` : '') +
            (typeof e.total_cost_usd === 'number' ? ` · $${e.total_cost_usd.toFixed(2)}` : '');
          if (!e.is_error) return { logs: [summary] };
          const text = typeof e.result === 'string' && e.result ? e.result : `Claude Code reported an error (${e.subtype ?? 'unknown'})`;
          const failed = failure(text);
          if (e.api_error_status === 429 && !failed.rateLimit) failed.rateLimit = { resetAt: resetFromText(text) };
          return { ...failed, logs: [summary, ...failed.logs] };
        }
        default:
          return NONE;
      }
    },
    flush: () => NONE,
  };
}

/** AGY `-p <prompt> --output-format stream-json`: text arrives in deltas per step, tools as steps. */
export function agyParser(): OutputParser {
  const text = new Map<number, string>();
  const seenTools = new Set<number>();
  const flushStep = (index: number): string[] => {
    const buffered = text.get(index);
    text.delete(index);
    return buffered ? lines(buffered) : [];
  };
  const flushAll = () => [...text.keys()].flatMap(flushStep);
  return {
    push(line) {
      const e = parseJson(line);
      if (!e) return plain(line);
      if (e.event === 'init') return { logs: [`Agent started: AGY${e.init?.permission_mode ? ` · ${e.init.permission_mode}` : ''}`] };
      if (e.event === 'step_update') {
        const step = e.step_update ?? {};
        const index = Number(step.step_index);
        if (step.step_type === 'agent_response') {
          if (typeof step.text_delta === 'string') text.set(index, (text.get(index) ?? '') + step.text_delta);
          return step.state === 'DONE' ? { logs: flushStep(index) } : NONE;
        }
        if (step.step_type === 'tool' && !seenTools.has(index)) {
          seenTools.add(index);
          return { logs: [describeTool(String(step.tool_name ?? step.tool_info?.name ?? 'tool'), step.tool_info?.parameters)] };
        }
        return NONE;
      }
      if (e.event === 'result') {
        const result = e.result ?? {};
        const pending = flushAll();
        const status = result.status === undefined ? 'SUCCESS' : String(result.status);
        const summary = `Finished: ${status.toLowerCase()}${typeof result.duration_seconds === 'number' ? ` · ${Math.round(result.duration_seconds)} s` : ''}`;
        if (status === 'SUCCESS') return { logs: [...pending, summary] };
        const failed = failure(String(result.error ?? result.message ?? result.response ?? `AGY finished with status ${status}`));
        return { ...failed, logs: [...pending, summary, ...failed.logs] };
      }
      if (e.event === 'error') return failure(String(e.error?.message ?? e.message ?? JSON.stringify(e)));
      return NONE;
    },
    flush: () => ({ logs: flushAll() }),
  };
}

/** Codex `exec --json`: thread, turn and item events. */
export function codexParser(): OutputParser {
  return {
    push(line) {
      const e = parseJson(line);
      if (!e) return plain(line);
      const item = e.item ?? {};
      switch (e.type) {
        case 'thread.started':
          return { logs: ['Agent started: Codex'] };
        case 'item.started':
          return item.type === 'command_execution' ? { logs: [describeTool('shell', { command: item.command })] } : NONE;
        case 'item.completed':
          if (item.type === 'agent_message' && typeof item.text === 'string') return { logs: lines(item.text) };
          if (item.type === 'file_change') return { logs: (item.changes ?? []).map((c: any) => `→ ${c.kind ?? 'edit'}: ${c.path}`) };
          if (item.type === 'command_execution' && typeof item.exit_code === 'number' && item.exit_code !== 0) return { logs: [`  ✗ exit ${item.exit_code}`] };
          if (item.type === 'error' && item.message) return { logs: [`  ✗ ${cut(String(item.message))}`] };
          return NONE;
        case 'turn.completed':
          return { logs: ['Finished'] };
        case 'turn.failed':
          return failure(String(e.error?.message ?? 'Codex turn failed'));
        case 'error':
          return failure(String(e.message ?? e.error?.message ?? 'Codex error'));
        default:
          return NONE;
      }
    },
    flush: () => NONE,
  };
}

export function createParser(cli: AgentCliId): OutputParser {
  if (cli === 'claude-cli') return claudeParser();
  if (cli === 'agy-cli') return agyParser();
  return codexParser();
}
```

- [ ] **Step 4: Run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/outputParsers.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/localEngine/outputParsers.ts packages/server/src/localEngine/outputParsers.test.ts
git commit -m "feat(server): readable logs and usage-limit detection for agent CLI output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CLI profiles

**Files:**
- Create: `packages/server/src/localEngine/cliProfiles.ts`
- Test: `packages/server/src/localEngine/cliProfiles.test.ts`

**Interfaces:**
- Consumes: `AGENT_CLI_IDS`, `AgentCliId`, `AiCliSettings`, `LocalEngineSettings`, `SingleCliConfig` (shared); `findCliBinary(name)` from `packages/server/src/services/aiDraftService.ts:34`.
- Produces: `CLI_LABELS: Record<AgentCliId,string>`; `type FindBinary = (name: string) => string | null`; `cliBinary(cli, ai, find?)`; `cliEnabled(cli, ai)`; `interface CliChoice { cli; bin; problem }`; `chooseCli(local, ai, find?)`; `runModel(cli, chosen, ai)`; `runEffort(cli, chosen, ai)`; `interface CliCommand { bin; args: string[]; stdin: string | null }`; `interface CommandInput { prompt; model; effort; worktree; gitCommonDir }`; `buildCommand(cli, bin, input): CliCommand`; `agyQuotaResetAt(bin, timeoutMs?)`; `quotaResetAt(cli, bin): Promise<string | null>`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/localEngine/cliProfiles.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiCliSettingsSchema, LocalEngineSettingsSchema } from '@sp-kickstack/shared';
import { agyQuotaResetAt, buildCommand, chooseCli, cliBinary, runEffort, runModel } from './cliProfiles.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cli-profiles-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ai = (overrides: Record<string, unknown> = {}) => AiCliSettingsSchema.parse(overrides);
const local = (overrides: Record<string, unknown> = {}) => LocalEngineSettingsSchema.parse(overrides);
const installed = (...names: string[]) => (name: string) => (names.includes(name) ? `/bin/${name}` : null);

function script(name: string, body: string): string {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

describe('choosing the CLI', () => {
  it('follows the AI default when it can edit code', () => {
    expect(chooseCli(local(), ai({ defaultProvider: 'agy-cli' }), installed('claude', 'agy'))).toEqual({ cli: 'agy-cli', bin: '/bin/agy', problem: null });
  });

  it('falls back to the first usable agent CLI when the AI default cannot run agents or is missing', () => {
    expect(chooseCli(local(), ai({ defaultProvider: 'ollama' }), installed('agy')).cli).toBe('agy-cli');
    expect(chooseCli(local(), ai({ defaultProvider: 'agy-cli' }), installed('claude')).cli).toBe('claude-cli');
  });

  it('skips CLIs that are turned off in Settings', () => {
    const settings = ai({ defaultProvider: 'claude-cli', enabledEngines: ['agy-cli'] });
    expect(chooseCli(local(), settings, installed('claude', 'agy')).cli).toBe('agy-cli');
  });

  it('says why nothing can run', () => {
    expect(chooseCli(local(), ai(), installed()).problem).toBe('No AI CLI that can edit code is installed and turned on (Claude Code, AGY or Codex)');
    expect(chooseCli(local({ agentCli: 'codex-cli' }), ai(), installed()).problem).toBe('Codex is chosen for the Local AI CLI engine but is not installed on this PC');
    expect(chooseCli(local({ agentCli: 'codex-cli' }), ai({ codex: { enabled: false } }), installed('codex')).problem)
      .toBe('Codex is chosen for the Local AI CLI engine but is turned off in Settings → AI & Local Engines');
  });

  it('uses an executable custom path and ignores a missing one', () => {
    const fake = script('fake-claude', 'exit 0');
    expect(cliBinary('claude-cli', ai({ claude: { customPath: fake } }), installed())).toBe(fake);
    expect(cliBinary('claude-cli', ai({ claude: { customPath: path.join(tmp, 'nope') } }), installed('claude'))).toBeNull();
  });
});

describe('model and effort', () => {
  it('prefers the task choice, then the CLI setting; "default" means none', () => {
    const settings = ai({ claude: { model: 'sonnet', effort: 'medium' }, codex: { model: 'default' } });
    expect(runModel('claude-cli', 'opus', settings)).toBe('opus');
    expect(runModel('claude-cli', null, settings)).toBe('sonnet');
    expect(runModel('codex-cli', null, settings)).toBeNull();
    expect(runEffort('claude-cli', 'max', settings)).toBe('max');
    expect(runEffort('claude-cli', null, settings)).toBe('medium');
  });
});

describe('headless command lines', () => {
  const input = { prompt: 'Do it', model: 'opus', effort: 'max', worktree: '/w/task-1', gitCommonDir: '/r/.git' };

  it('Claude Code reads the prompt on stdin and may edit and run commands', () => {
    expect(buildCommand('claude-cli', '/bin/claude', input)).toEqual({
      bin: '/bin/claude',
      args: ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--model', 'opus', '--effort', 'max'],
      stdin: 'Do it',
    });
  });

  it('AGY gets the prompt as the value of -p', () => {
    expect(buildCommand('agy-cli', '/bin/agy', { ...input, model: null, effort: null })).toEqual({
      bin: '/bin/agy',
      args: ['-p', 'Do it', '--output-format', 'stream-json', '--dangerously-skip-permissions'],
      stdin: null,
    });
  });

  it('Codex writes only in the worktree and the shared .git folder', () => {
    const cmd = buildCommand('codex-cli', '/bin/codex', input);
    expect(cmd.args).toEqual(['exec', '--json', '--sandbox', 'workspace-write', '--add-dir', '/r/.git', '-C', '/w/task-1', '-m', 'opus', '-c', 'model_reasoning_effort="high"', '-']);
    expect(cmd.stdin).toBe('Do it');
  });
});

describe('AGY quota reset', () => {
  it('returns the latest reset among exhausted buckets', async () => {
    const usage = JSON.stringify({ command: { data: { groups: [{ name: 'Gemini', buckets: [
      { window: '5h', remaining_fraction: 0, reset_time: '2026-10-13T08:00:00Z' },
      { window: 'weekly', remaining_fraction: 0.5, reset_time: '2026-10-19T00:00:00Z' },
    ] }] } } });
    const fake = script('fake-agy-usage', `echo '${usage}'`);
    expect(await agyQuotaResetAt(fake)).toBe('2026-10-13T08:00:00.000Z');
  });

  it('returns null when nothing is exhausted or the command fails', async () => {
    expect(await agyQuotaResetAt(script('fake-agy-fail', 'exit 1'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/cliProfiles.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `packages/server/src/localEngine/cliProfiles.ts`:

```ts
// Which AI CLI runs an agent, and the headless command line that lets it edit files and run
// commands (checked against Claude Code 2.1.284 and AGY 1.3.3; Codex from its documentation).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { AGENT_CLI_IDS } from '@sp-kickstack/shared';
import type { AgentCliId, AiCliSettings, LocalEngineSettings, SingleCliConfig } from '@sp-kickstack/shared';
import { findCliBinary } from '../services/aiDraftService.js';

export const CLI_LABELS: Record<AgentCliId, string> = { 'claude-cli': 'Claude Code', 'agy-cli': 'AGY', 'codex-cli': 'Codex' };
const BINARY: Record<AgentCliId, string> = { 'claude-cli': 'claude', 'agy-cli': 'agy', 'codex-cli': 'codex' };

export type FindBinary = (name: string) => string | null;

function configOf(cli: AgentCliId, ai: AiCliSettings): SingleCliConfig | undefined {
  if (cli === 'claude-cli') return ai.claude;
  if (cli === 'agy-cli') return ai.agy;
  return ai.codex;
}

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The CLI's binary: its Settings custom path when that is an executable file, else a PATH search. */
export function cliBinary(cli: AgentCliId, ai: AiCliSettings, find: FindBinary = findCliBinary): string | null {
  const custom = configOf(cli, ai)?.customPath?.trim();
  if (custom) return isExecutableFile(custom) ? custom : null;
  return find(BINARY[cli]);
}

/** Turned on in Settings: its own switch and the list of active engines. */
export function cliEnabled(cli: AgentCliId, ai: AiCliSettings): boolean {
  if (configOf(cli, ai)?.enabled === false) return false;
  return !ai.enabledEngines || ai.enabledEngines.includes(cli);
}

export interface CliChoice {
  cli: AgentCliId | null;
  bin: string | null;
  /** Why no CLI can run, in words for Settings and the engine status. */
  problem: string | null;
}

/**
 * The CLI the next run uses: the engine's own choice, else the AI default, else the first enabled
 * and installed agent CLI (Ollama and the heuristic cannot edit code).
 */
export function chooseCli(local: LocalEngineSettings, ai: AiCliSettings, find: FindBinary = findCliBinary): CliChoice {
  const usable = (cli: AgentCliId) => (cliEnabled(cli, ai) ? cliBinary(cli, ai, find) : null);
  if (local.agentCli !== 'default') {
    const bin = usable(local.agentCli);
    if (bin) return { cli: local.agentCli, bin, problem: null };
    const why = cliEnabled(local.agentCli, ai) ? 'is not installed on this PC' : 'is turned off in Settings → AI & Local Engines';
    return { cli: null, bin: null, problem: `${CLI_LABELS[local.agentCli]} is chosen for the Local AI CLI engine but ${why}` };
  }
  const preferred = (AGENT_CLI_IDS as readonly string[]).includes(ai.defaultProvider) ? [ai.defaultProvider as AgentCliId] : [];
  for (const cli of [...preferred, ...AGENT_CLI_IDS]) {
    const bin = usable(cli);
    if (bin) return { cli, bin, problem: null };
  }
  return { cli: null, bin: null, problem: 'No AI CLI that can edit code is installed and turned on (Claude Code, AGY or Codex)' };
}

const unset = (value: string | null | undefined) => !value || value === 'default';

/** Model for a run: the task's resolved choice, else the CLI's Settings model. */
export function runModel(cli: AgentCliId, chosen: string | null, ai: AiCliSettings): string | null {
  if (!unset(chosen)) return chosen!;
  const fallback = configOf(cli, ai)?.model;
  return unset(fallback) ? null : fallback!;
}

/** Effort for a run: the task's resolved choice, else the CLI's Settings effort. */
export function runEffort(cli: AgentCliId, chosen: string | null, ai: AiCliSettings): string | null {
  return chosen || configOf(cli, ai)?.effort || null;
}

export interface CliCommand {
  bin: string;
  args: string[];
  /** Written to stdin, which is then closed; null closes it at once. */
  stdin: string | null;
}

export interface CommandInput {
  prompt: string;
  model: string | null;
  effort: string | null;
  worktree: string;
  /** The repository's shared .git folder: commits made in a worktree are written there. */
  gitCommonDir: string;
}

/** Codex accepts minimal, low, medium and high. */
const CODEX_EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

/** Headless command line that lets the agent edit files and run commands. */
export function buildCommand(cli: AgentCliId, bin: string, input: CommandInput): CliCommand {
  const { prompt, model, effort } = input;
  if (cli === 'claude-cli') {
    return {
      bin,
      args: [
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions',
        ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
      ],
      stdin: prompt,
    };
  }
  if (cli === 'agy-cli') {
    // AGY takes the prompt only as the value of -p (it refuses stdin).
    return {
      bin,
      args: [
        '-p', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions',
        ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
      ],
      stdin: null,
    };
  }
  const codexEffort = effort ? CODEX_EFFORT[effort] : undefined;
  return {
    bin,
    args: [
      'exec', '--json', '--sandbox', 'workspace-write', '--add-dir', input.gitCommonDir, '-C', input.worktree,
      ...(model ? ['-m', model] : []), ...(codexEffort ? ['-c', `model_reasoning_effort="${codexEffort}"`] : []), '-',
    ],
    stdin: prompt,
  };
}

/** When AGY's exhausted quota resets (ISO), from `agy -p /usage --output-format json`; null if unknown. */
export function agyQuotaResetAt(bin: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['-p', '/usage', '--output-format', 'json'], { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const groups = JSON.parse(stdout)?.command?.data?.groups ?? [];
        const resets = groups
          .flatMap((g: any) => g.buckets ?? [])
          .filter((b: any) => typeof b.remaining_fraction === 'number' && b.remaining_fraction <= 0 && typeof b.reset_time === 'string')
          .map((b: any) => Date.parse(b.reset_time))
          .filter((t: number) => !Number.isNaN(t));
        resolve(resets.length ? new Date(Math.max(...resets)).toISOString() : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Reset time from the CLI's live quota when its message did not say (only AGY reports one). */
export function quotaResetAt(cli: AgentCliId, bin: string): Promise<string | null> {
  return cli === 'agy-cli' ? agyQuotaResetAt(bin) : Promise.resolve(null);
}
```

- [ ] **Step 4: Run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/cliProfiles.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/localEngine/cliProfiles.ts packages/server/src/localEngine/cliProfiles.test.ts
git commit -m "feat(server): choose the agent CLI and build its headless command line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Task worktrees and agent processes

**Files:**
- Create: `packages/server/src/localEngine/worktrees.ts`
- Create: `packages/server/src/localEngine/processes.ts`
- Test: `packages/server/src/localEngine/worktrees.test.ts`

**Interfaces:**
- Consumes: `checkoutPathOf`, `isClean`, `isGitWorkTree`, `runGit` (`packages/server/src/lib/gitRepo.ts`); `CliCommand` (Task 4); test helpers `makeRepo`, `sh` (`packages/server/src/testing/gitFixture.ts`).
- Produces: `folderName(project)`; `class AgentWorktrees { constructor(root: () => string); pathFor(project, taskId): string; ensure(repo, branch, dir): void; removeIfClean(repo, dir): 'removed'|'dirty'|'missing'; uncommitted(dir): string[]; gitCommonDir(repo): string }`; `interface AgentExit { code; signal; spawnError }`; `interface SpawnedAgent { child; pid; startedAt; exited: Promise<AgentExit> }`; `spawnAgent(cmd, cwd, env)`; `processStartTime(pid)`; `isAlive(pid)`; `isSameProcess(pid, startedAt)`; `stopGroup(pid, exited|null, graceMs)`; `killGroupLeftovers(pid)`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/localEngine/worktrees.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, sh } from '../testing/gitFixture.js';
import { checkoutPathOf, createBranch, resolveCommit } from '../lib/gitRepo.js';
import { AgentWorktrees, folderName } from './worktrees.js';
import { isAlive, isSameProcess, processStartTime, spawnAgent, stopGroup } from './processes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(here, '../../.temp/sp-test-worktrees');
let n = 0;
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function setup() {
  const ws = path.join(tempRoot, `case-${process.pid}-${n++}`);
  const { repo } = makeRepo(path.join(ws, 'backend'));
  createBranch(repo, 'req/REQ-001/task-1', resolveCommit(repo, 'refs/heads/develop')!);
  const worktrees = new AgentWorktrees(() => path.join(ws, 'agent-worktrees'));
  return { ws, repo, worktrees, dir: worktrees.pathFor('backend', 1) };
}

describe('AgentWorktrees', () => {
  it('creates one worktree per task on its branch and reuses it, leaving your checkout alone', () => {
    const { repo, worktrees, dir } = setup();
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    expect(sh(dir, ['branch', '--show-current'])).toBe('req/REQ-001/task-1');
    fs.writeFileSync(path.join(dir, 'agent.txt'), 'x');
    expect(fs.existsSync(path.join(repo, 'agent.txt'))).toBe(false);
    expect(sh(repo, ['branch', '--show-current'])).toBe('develop');
    expect(worktrees.uncommitted(dir)).toEqual(['agent.txt']);
  });

  it('refuses a branch that is checked out elsewhere, and a folder that is not a git repository', () => {
    const { ws, repo, worktrees, dir } = setup();
    sh(repo, ['checkout', '-q', 'req/REQ-001/task-1']);
    expect(() => worktrees.ensure(repo, 'req/REQ-001/task-1', dir)).toThrow(/is checked out in .*switch that checkout to another branch, then Retry/);
    const plain = path.join(ws, 'plain');
    fs.mkdirSync(plain);
    expect(() => worktrees.ensure(plain, 'main', path.join(ws, 'x'))).toThrow(/needs a git repository/);
  });

  it('recreates a worktree whose folder was deleted by hand', () => {
    const { repo, worktrees, dir } = setup();
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    fs.rmSync(dir, { recursive: true, force: true });
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    expect(sh(dir, ['branch', '--show-current'])).toBe('req/REQ-001/task-1');
  });

  it('removes only a clean worktree', () => {
    const { repo, worktrees, dir } = setup();
    worktrees.ensure(repo, 'req/REQ-001/task-1', dir);
    fs.writeFileSync(path.join(dir, 'wip.txt'), 'x');
    expect(worktrees.removeIfClean(repo, dir)).toBe('dirty');
    fs.rmSync(path.join(dir, 'wip.txt'));
    expect(worktrees.removeIfClean(repo, dir)).toBe('removed');
    expect(checkoutPathOf(repo, 'req/REQ-001/task-1')).toBeNull();
    expect(worktrees.removeIfClean(repo, dir)).toBe('missing');
  });

  it('names folders safely and finds the shared .git folder', () => {
    const { repo, worktrees } = setup();
    expect(folderName('mobile app/../x')).toBe('mobile-app-..-x');
    expect(folderName('..')).toBe('project');
    expect(folderName('.hidden')).toBe('hidden');
    expect(fs.realpathSync(worktrees.gitCommonDir(repo))).toBe(fs.realpathSync(path.join(repo, '.git')));
  });
});

describe('agent processes', () => {
  it('stops a whole process group and recognises the process only while it lives', async () => {
    const agent = spawnAgent({ bin: '/bin/sh', args: ['-c', 'sleep 30 & sleep 30'], stdin: null }, process.cwd(), process.env);
    expect(agent.startedAt).toBe(processStartTime(agent.pid));
    expect(isSameProcess(agent.pid, agent.startedAt)).toBe(true);
    expect(isSameProcess(agent.pid, 'Mon Jan  1 00:00:00 2001')).toBe(false);
    await stopGroup(agent.pid, agent.exited, 2000);
    expect((await agent.exited).signal).toBe('SIGTERM');
    expect(isAlive(agent.pid)).toBe(false);
  });

  it('reports a binary that cannot start', async () => {
    const agent = spawnAgent({ bin: '/nonexistent/agent', args: [], stdin: null }, process.cwd(), process.env);
    expect((await agent.exited).spawnError).toMatch(/ENOENT/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/worktrees.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement worktrees** — create `packages/server/src/localEngine/worktrees.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { checkoutPathOf, isClean, isGitWorkTree, runGit } from '../lib/gitRepo.js';

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** Folder-safe name for a repository (never "." or "..", which would leave the worktree root). */
export function folderName(project: string): string {
  return project.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'project';
}

/** The task copies agents work in: one git worktree per task, on the task branch. */
export class AgentWorktrees {
  constructor(private root: () => string) {}

  pathFor(project: string, taskId: number): string {
    return path.join(this.root(), folderName(project), `task-${taskId}`);
  }

  /** Create the worktree for `branch` at `dir`, or reuse it. Throws an Error a person can act on. */
  ensure(repo: string, branch: string, dir: string): void {
    if (!isGitWorkTree(repo)) throw new Error(`Local AI CLI needs a git repository: ${repo} is not the top of a git work tree`);
    runGit(repo, ['worktree', 'prune']); // forget worktrees whose folder was deleted
    const checkout = checkoutPathOf(repo, branch);
    if (checkout && real(checkout) === real(dir)) return;
    if (checkout) throw new Error(`Branch ${branch} is checked out in ${checkout}; switch that checkout to another branch, then Retry`);
    if (fs.existsSync(dir)) {
      if (fs.readdirSync(dir).length > 0) throw new Error(`Folder ${dir} already exists and is not the worktree of ${branch}; move it away, then Retry`);
      fs.rmdirSync(dir);
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    runGit(repo, ['worktree', 'add', '--quiet', dir, branch]);
  }

  /** Remove a worktree that has no uncommitted changes. */
  removeIfClean(repo: string, dir: string): 'removed' | 'dirty' | 'missing' {
    if (!fs.existsSync(dir)) {
      try {
        runGit(repo, ['worktree', 'prune']);
      } catch {
        // The repository itself is gone.
      }
      return 'missing';
    }
    if (!isClean(dir)) return 'dirty';
    runGit(repo, ['worktree', 'remove', dir]);
    return 'removed';
  }

  /** Paths with uncommitted changes, as `git status --porcelain` lists them. */
  uncommitted(dir: string): string[] {
    try {
      return runGit(dir, ['status', '--porcelain']).split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** The repository's shared .git folder (absolute). */
  gitCommonDir(repo: string): string {
    return path.resolve(repo, runGit(repo, ['rev-parse', '--git-common-dir']).trim());
  }
}
```

- [ ] **Step 4: Implement processes** — create `packages/server/src/localEngine/processes.ts`:

```ts
// Agent processes: each CLI runs in its own process group so stopping it stops everything it
// started. A process is only ever stopped when it is provably ours: a child we hold, or a pid
// whose start time matches the one recorded when we spawned it.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { CliCommand } from './cliProfiles.js';

export interface AgentExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Set when the process could not be started at all (missing binary, no permission). */
  spawnError: string | null;
}

export interface SpawnedAgent {
  child: ChildProcess;
  pid: number;
  /** Start time as `ps` prints it; with the pid it identifies this process after a restart. */
  startedAt: string | null;
  /** Resolves once the process ended and its output is read. */
  exited: Promise<AgentExit>;
}

const POSIX = process.platform !== 'win32';
/** How long to wait for the output to close after the CLI exited (a leftover process may hold it). */
const OUTPUT_DRAIN_MS = 2000;

export function spawnAgent(cmd: CliCommand, cwd: string, env: NodeJS.ProcessEnv): SpawnedAgent {
  const child = spawn(cmd.bin, cmd.args, { cwd, env, detached: POSIX, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise<AgentExit>((resolve) => {
    let spawnError: string | null = null;
    let status: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    const done = () => resolve({ code: status?.code ?? null, signal: status?.signal ?? null, spawnError });
    child.once('error', (err) => {
      spawnError = err.message;
      setTimeout(done, 100);
    });
    child.once('exit', (code, signal) => {
      status = { code, signal };
      setTimeout(done, OUTPUT_DRAIN_MS);
    });
    child.once('close', (code, signal) => {
      status = status ?? { code, signal };
      done();
    });
  });
  child.stdin?.on('error', () => {}); // the CLI may exit before reading all of stdin
  child.stdin?.end(cmd.stdin ?? undefined);
  const pid = child.pid ?? -1;
  return { child, pid, startedAt: pid > 0 ? processStartTime(pid) : null, exited };
}

export function processStartTime(pid: number): string | null {
  if (!POSIX) return null;
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/** True only for the very process we started: same pid and same start time. */
export function isSameProcess(pid: number | null, startedAt: string | null): boolean {
  return Boolean(pid && pid > 0 && startedAt && isAlive(pid) && processStartTime(pid) === startedAt);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  if (!POSIX) {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone.
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SIGTERM the process group, then SIGKILL it if it is still there after `graceMs`. */
export async function stopGroup(pid: number, exited: Promise<unknown> | null, graceMs: number): Promise<void> {
  if (pid <= 0) return;
  signalGroup(pid, 'SIGTERM');
  if (exited) {
    const done = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)]);
    if (!done) {
      signalGroup(pid, 'SIGKILL');
      await Promise.race([exited, sleep(graceMs)]);
    }
    return;
  }
  const deadline = Date.now() + graceMs;
  while (isAlive(pid) && Date.now() < deadline) await sleep(100);
  if (isAlive(pid)) signalGroup(pid, 'SIGKILL');
}

/** After the CLI exited: stop what it left running in its group (a dev server, a watcher). */
export function killGroupLeftovers(pid: number): void {
  if (!POSIX || pid <= 0) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Nothing left.
  }
}
```

- [ ] **Step 5: Run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/worktrees.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/localEngine/worktrees.ts packages/server/src/localEngine/processes.ts packages/server/src/localEngine/worktrees.test.ts
git commit -m "feat(server): task worktrees and process groups for local agents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Run prompt and xticket launcher

**Files:**
- Create: `packages/server/src/localEngine/prompt.ts`
- Create: `packages/server/src/localEngine/xticketLauncher.ts`
- Test: `packages/server/src/localEngine/prompt.test.ts`

**Interfaces:**
- Produces: `interface RunPromptInput { bodyMd; worktree; branch; notesMd; continuation: boolean }`; `buildRunPrompt(input): string`; `xticketCandidates(): string[]`; `findXticketScript(candidates?): string | null`; `writeXticketLauncher(binDir, nodePath, script | null): string`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/localEngine/prompt.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildRunPrompt } from './prompt.js';
import { findXticketScript, writeXticketLauncher } from './xticketLauncher.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-prompt-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('run prompt', () => {
  const base = { bodyMd: '# REQ-008: Rides\n\nBuild it.', worktree: '/w/backend/task-8', branch: 'req/REQ-008/task-8', notesMd: '', continuation: false };

  it('adds how an unattended local run works', () => {
    const prompt = buildRunPrompt(base);
    expect(prompt.startsWith('# REQ-008: Rides\n\nBuild it.\n\n## Local run\n')).toBe(true);
    expect(prompt).toContain('You run unattended in `/w/backend/task-8`');
    expect(prompt).toContain('Commit your work on `req/REQ-008/task-8`');
    expect(prompt).toContain('Never push');
    expect(prompt).not.toContain('## Continue');
    expect(prompt).not.toContain('## Notes since your last run');
  });

  it('asks a resumed run to continue and delivers notes', () => {
    const prompt = buildRunPrompt({ ...base, continuation: true, notesMd: 'Answer: use Postgres' });
    expect(prompt).toContain('## Continue\nThis task was started before');
    expect(prompt.trimEnd().endsWith('## Notes since your last run\nAnswer: use Postgres')).toBe(true);
  });
});

describe('xticket launcher', () => {
  it('runs the xticket script with the arguments it was given', () => {
    const script = path.join(tmp, 'cli.js');
    fs.writeFileSync(script, "console.log(process.argv.slice(2).join(' '));\n");
    const bin = writeXticketLauncher(path.join(tmp, 'bin'), process.execPath, script);
    expect(execFileSync(path.join(bin, 'xticket'), ['ask', '--question', 'Postgres?'], { encoding: 'utf8' }).trim()).toBe('ask --question Postgres?');
    expect(fs.existsSync(path.join(bin, 'xticket.cmd'))).toBe(true);
  });

  it('explains what to build when the script is missing', () => {
    const bin = writeXticketLauncher(path.join(tmp, 'bin-missing'), process.execPath, null);
    const result = spawnSync(path.join(bin, 'xticket'), ['ask'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('xticket is not available');
  });

  it('finds the first existing script', () => {
    const script = path.join(tmp, 'found.js');
    fs.writeFileSync(script, '');
    expect(findXticketScript([path.join(tmp, 'nope.js'), script])).toBe(script);
    expect(findXticketScript([path.join(tmp, 'nope.js')])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/prompt.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the prompt** — create `packages/server/src/localEngine/prompt.ts`:

```ts
export interface RunPromptInput {
  /** The task's own prompt (branch rules, xticket instructions, wrapped requirement). */
  bodyMd: string;
  worktree: string;
  branch: string;
  /** Notes and answers not yet delivered. */
  notesMd: string;
  /** The run continues earlier work (after a question, a usage limit or a restart). */
  continuation: boolean;
}

/** The prompt for one run: the task's prompt plus how this unattended local run works. */
export function buildRunPrompt(input: RunPromptInput): string {
  const parts = [
    input.bodyMd.trimEnd(),
    `## Local run
- You run unattended in \`${input.worktree}\`, a separate copy of the repository on branch \`${input.branch}\`. Nobody reads your messages until you finish, so do not wait for confirmation.
- Stay inside this folder: do not read or change files outside it.
- Commit your work on \`${input.branch}\` (git add, git commit) before you finish. Uncommitted changes are not reviewed.
- Never push, never switch or create branches, and never rewrite commits already on the branch.
- For a product decision only a person can make, use \`xticket ask\` as described above, commit your work in progress, then stop.`,
  ];
  if (input.continuation) {
    parts.push(`## Continue
This task was started before and stopped (a question, a usage limit or a server restart). Run \`git log\` and \`git status\` first, then continue from the work already on \`${input.branch}\`.`);
  }
  if (input.notesMd.trim()) parts.push(`## Notes since your last run\n${input.notesMd.trim()}`);
  return `${parts.join('\n\n')}\n`;
}
```

- [ ] **Step 4: Implement the launcher** — create `packages/server/src/localEngine/xticketLauncher.ts`:

```ts
// Agents call `xticket ask` / `xticket create` from their worktree. The runner puts this launcher
// first on their PATH; it runs the xticket CLI with the same Node that runs the server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** XTICKET_CLI, then the desktop bundle (xticket.mjs next to the server), then the workspace build. */
export function xticketCandidates(): string[] {
  return [process.env.XTICKET_CLI ?? '', path.join(here, 'xticket.mjs'), path.resolve(here, '../../../xticket/dist/cli.js')].filter(Boolean);
}

export function findXticketScript(candidates: string[] = xticketCandidates()): string | null {
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Write `xticket` (and `xticket.cmd` for Windows) into `binDir`; returns `binDir`. */
export function writeXticketLauncher(binDir: string, nodePath: string, script: string | null): string {
  fs.mkdirSync(binDir, { recursive: true });
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const missing = 'xticket is not available: run npm run build in SP-Kickstack';
  const shell = script
    ? `#!/bin/sh\nexec ${quote(nodePath)} ${quote(script)} "$@"\n`
    : `#!/bin/sh\necho "${missing}" >&2\nexit 1\n`;
  const launcher = path.join(binDir, 'xticket');
  fs.writeFileSync(launcher, shell);
  fs.chmodSync(launcher, 0o755);
  const cmd = script ? `@"${nodePath}" "${script}" %*\r\n` : `@echo ${missing} 1>&2\r\n@exit /b 1\r\n`;
  fs.writeFileSync(path.join(binDir, 'xticket.cmd'), cmd);
  return binDir;
}
```

- [ ] **Step 5: Run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/prompt.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/localEngine/prompt.ts packages/server/src/localEngine/xticketLauncher.ts packages/server/src/localEngine/prompt.test.ts
git commit -m "feat(server): run prompt and xticket launcher for local agents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: AgentRunner core (start, logs, exit, limits, cancel)

**Files:**
- Create: `packages/server/src/testing/fakeAgentCli.mjs`
- Create: `packages/server/src/testing/localEngineFixture.ts`
- Create: `packages/server/src/localEngine/agentRunner.ts`
- Test: `packages/server/src/localEngine/agentRunner.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6; `ProjectService.getProject(name)`; `SettingsService.getLocalEngineSettings()` / `getAiCliSettings()`; `commitsAhead`, `resolveCommit` (`lib/gitRepo.ts`).
- Produces: `interface AgentRunnerOptions { db; projectService; settingsService; workspaceDir; bridgeUrl; agentToken?; findBinary?; minuteMs?; holdGraceMs?; stopGraceMs?; quotaResetAt?; now? }`; `class AgentRunner { readonly runs: RunStore; health(); nudge(); tick(): Promise<void>; idle(): Promise<void>; cancel(runId): Promise<void> }` (Tasks 8–9 add `hold`, `release`, `note`, `shutdown`, `recoverOnStartup`, `releaseWorktree`, `status`); `MAX_LOG_LINES`, `MAX_INTERRUPTIONS`. Fixture: `makeLocalHarness(opts?)`, `cleanLocalHarnesses()`, `FAKE_AGENT_CLI`, `waitFor(check, ms?)`.

- [ ] **Step 1: The fake agent CLI** — create `packages/server/src/testing/fakeAgentCli.mjs`:

```js
#!/usr/bin/env node
// Test stand-in for an agent CLI. Speaks Claude Code's stream-json (prompt on stdin) or, when
// called as `-p <prompt> …`, AGY's stream-json. Lines "FAKE: <action> <arg>" in the prompt drive it:
//   say <text> · commit <file> · dirty <file> · sleep <ms> · wait-for-note <ms> · wait-once <ms>
//   exit <code> · fail-unless-retry <code> · limit <epoch s> · limit-once <epoch s>
//   stderr <text> · background <ms>
// With FAKE_AGENT_LOG_DIR set, each prompt is saved as <XTICKET_TASK>-<n>.md (and argv/env as .json).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const agy = argv[0] === '-p' && argv[1] !== undefined && !argv[1].startsWith('--');
const prompt = agy ? argv[1] : fs.readFileSync(0, 'utf8');
const task = process.env.XTICKET_TASK ?? 'unknown';
const logDir = process.env.FAKE_AGENT_LOG_DIR;
if (logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const n = fs.readdirSync(logDir).filter((f) => f.startsWith(`${task}-`) && f.endsWith('.md')).length + 1;
  fs.writeFileSync(path.join(logDir, `${task}-${n}.md`), prompt);
  const env = { XTICKET_URL: process.env.XTICKET_URL, XTICKET_PROJECT: process.env.XTICKET_PROJECT, XTICKET_TASK: task, PATH: process.env.PATH };
  fs.writeFileSync(path.join(logDir, `${task}-${n}.json`), JSON.stringify({ argv, env, cwd: process.cwd() }));
}

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
let step = 0;
const say = (text) => {
  if (!agy) return out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  step += 1;
  out({ event: 'step_update', step_update: { step_index: step, state: 'ACTIVE', step_type: 'agent_response', text_delta: text } });
  out({ event: 'step_update', step_update: { step_index: step, state: 'DONE', step_type: 'agent_response', text_delta: '\n' } });
};
const tool = (command) => {
  if (!agy) return out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  step += 1;
  out({ event: 'step_update', step_update: { step_index: step, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: command } } } });
};
const finish = (ok, text) => {
  if (agy) out({ event: 'result', result: { status: ok ? 'SUCCESS' : 'ERROR', response: text, error: ok ? undefined : text, duration_seconds: 1 } });
  else out({ type: 'result', subtype: ok ? 'success' : 'error_during_execution', is_error: !ok, result: text, num_turns: 1, duration_ms: 1000, total_cost_usd: 0 });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (agy) out({ event: 'init', init: { cwd: process.cwd(), permission_mode: 'bypass' } });
else out({ type: 'system', subtype: 'init', claude_code_version: 'fake', model: 'fake-model', permissionMode: 'bypassPermissions' });

const actions = [...prompt.matchAll(/FAKE: ([\w-]+)(?: ([^\n]*))?/g)].map((m) => [m[1], (m[2] ?? '').trim()]);
const continued = prompt.includes('## Continue');
const hasNotes = prompt.includes('## Notes since your last run');
const isRetry = prompt.includes('## Retry');

for (const [action, arg] of actions) {
  if (action === 'say') say(arg);
  else if (action === 'commit' || action === 'dirty') {
    fs.writeFileSync(path.join(process.cwd(), arg), `${arg} ${Date.now()} ${Math.random()}\n`);
    if (action === 'commit') {
      tool(`git add ${arg} && git commit -m "add ${arg}"`);
      execFileSync('git', ['add', '--', arg]);
      execFileSync('git', ['-c', 'user.name=Fake Agent', '-c', 'user.email=agent@example.com', 'commit', '-q', '-m', `add ${arg}`]);
    }
  } else if (action === 'sleep') await sleep(Number(arg));
  else if (action === 'wait-for-note') { if (!hasNotes) await sleep(Number(arg)); }
  else if (action === 'wait-once') { if (!continued) await sleep(Number(arg)); }
  else if (action === 'stderr') process.stderr.write(`${arg}\n`);
  else if (action === 'background') {
    const child = spawn('sleep', [String(Math.ceil(Number(arg) / 1000))], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (logDir) fs.writeFileSync(path.join(logDir, `${task}-bg.pid`), String(child.pid));
    child.unref();
  } else if (action === 'exit' || (action === 'fail-unless-retry' && !isRetry)) {
    finish(false, `failed on purpose (${arg})`);
    process.exit(Number(arg));
  } else if (action === 'limit' || (action === 'limit-once' && !continued)) {
    if (!agy) out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Number(arg), rateLimitType: 'five_hour' } });
    finish(false, agy ? 'RESOURCE_EXHAUSTED: quota exceeded' : `Claude AI usage limit reached|${arg}`);
    process.exit(1);
  }
}
finish(true, 'done');
```

- [ ] **Step 2: The test fixture** — create `packages/server/src/testing/localEngineFixture.ts`:

```ts
// Test-only: a repository on the Local AI CLI engine, run by the fake agent CLI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentCliId } from '@sp-kickstack/shared';
import { initDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { SettingsService } from '../services/settingsService.js';
import { AgentRunner, type AgentRunnerOptions } from '../localEngine/agentRunner.js';
import { createBranch, resolveCommit } from '../lib/gitRepo.js';
import { makeRepo } from './gitFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_AGENT_CLI = path.join(here, 'fakeAgentCli.mjs');
const tempRoot = path.resolve(here, '../../.temp/sp-test-local-engine');
let counter = 0;

export async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

export interface LocalHarnessOptions {
  cli?: AgentCliId;
  runner?: Partial<AgentRunnerOptions>;
}

export function makeLocalHarness(opts: LocalHarnessOptions = {}) {
  fs.chmodSync(FAKE_AGENT_CLI, 0o755);
  const ws = path.join(tempRoot, `case-${process.pid}-${counter++}`);
  fs.rmSync(ws, { recursive: true, force: true });
  const { repo } = makeRepo(path.join(ws, 'backend'));
  const promptsDir = path.join(ws, 'prompts');
  process.env.FAKE_AGENT_LOG_DIR = promptsDir;

  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const settingsService = new SettingsService(db);
  const cli = opts.cli ?? 'claude-cli';
  const key = cli === 'claude-cli' ? 'claude' : cli === 'agy-cli' ? 'agy' : 'codex';
  settingsService.updateAiCliSettings({
    [key]: { enabled: true, customPath: FAKE_AGENT_CLI, model: 'default', effort: undefined },
    enabledEngines: ['claude-cli', 'agy-cli', 'codex-cli'],
  } as any);
  settingsService.updateLocalEngineSettings({ agentCli: cli });
  projectService.registerProject({ name: 'backend', kind: 'backend', repo_path: repo, engine_type: 'local', base_branch: 'develop', enabled: true });

  const runnerOptions: AgentRunnerOptions = {
    db, projectService, settingsService, workspaceDir: ws, bridgeUrl: 'http://127.0.0.1:4100',
    findBinary: () => null, minuteMs: 50, holdGraceMs: 300, stopGraceMs: 1000, quotaResetAt: async () => null,
    ...opts.runner,
  };
  const runner = new AgentRunner(runnerOptions);
  /** Another runner on the same database: the server after a restart. */
  const newRunner = (overrides: Partial<AgentRunnerOptions> = {}) => new AgentRunner({ ...runnerOptions, ...overrides });

  const req = requirementService.createRequirement({
    title: 'Ride tracking', goal: 'Track rides', acceptance_criteria: ['Rides tracked'], affected_projects: ['backend'], priority: 'normal',
  });

  /** A goal task on its own branch, as fan-out creates it. */
  const addTask = (): { id: number; branch: string } => {
    const now = new Date().toISOString();
    const id = Number(
      db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'goal', 'Ride tracking', 'queued', ?, ?)")
        .run(req.id, now, now).lastInsertRowid
    );
    const branch = `req/${req.id}/task-${id}`;
    const base = resolveCommit(repo, 'refs/heads/develop')!;
    createBranch(repo, branch, base);
    db.prepare('UPDATE bridge_tasks SET branch = ?, base_sha = ? WHERE id = ?').run(branch, base, id);
    return { id, branch };
  };

  const queueRun = (bodyMd: string, task = addTask(), using: AgentRunner = runner) => {
    const run = using.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'Ride tracking', bodyMd });
    db.prepare('UPDATE bridge_tasks SET engine_task_id = ? WHERE id = ?').run(run.id, task.id);
    return { run, task };
  };

  const logs = (taskId: number) =>
    (db.prepare('SELECT stream, message FROM task_logs WHERE task_id = ? ORDER BY id').all(taskId) as Array<{ stream: string; message: string }>);
  const logText = (taskId: number) => logs(taskId).map((l) => l.message).join('\n');
  const prompts = (runId: string) =>
    fs.existsSync(promptsDir)
      ? fs.readdirSync(promptsDir).filter((f) => f.startsWith(`${runId}-`) && f.endsWith('.md'))
          .sort((a, b) => parseInt(a.slice(runId.length + 1), 10) - parseInt(b.slice(runId.length + 1), 10))
          .map((f) => fs.readFileSync(path.join(promptsDir, f), 'utf8'))
      : [];
  const invocations = (runId: string) =>
    fs.existsSync(promptsDir)
      ? fs.readdirSync(promptsDir).filter((f) => f.startsWith(`${runId}-`) && f.endsWith('.json')).sort()
          .map((f) => JSON.parse(fs.readFileSync(path.join(promptsDir, f), 'utf8')))
      : [];
  /** Start what can start and wait until every started run has finished. */
  const settle = async (using: AgentRunner = runner) => {
    await using.tick();
    await using.idle();
  };
  const run = (id: string) => runner.runs.get(id)!;

  return { ws, repo, db, projectService, requirementService, settingsService, runner, newRunner, req, addTask, queueRun, logs, logText, prompts, invocations, settle, run, promptsDir };
}

export function cleanLocalHarnesses() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.FAKE_AGENT_LOG_DIR;
}
```

- [ ] **Step 3: Write the failing test** — `packages/server/src/localEngine/agentRunner.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses, makeLocalHarness, waitFor } from '../testing/localEngineFixture.js';
import { isAlive } from './processes.js';

afterAll(() => cleanLocalHarnesses());

describe('AgentRunner: one run', () => {
  it('runs the agent in the task worktree and marks committed work for review', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: say Working on it\nFAKE: commit a.txt');
    await h.settle();

    expect(h.run(run.id)).toMatchObject({ status: 'review', cli: 'claude-cli', pid: null, exit_code: 0 });
    const text = h.logText(task.id);
    expect(text).toMatch(/▶ Claude Code started in .*task-\d+ on req\/REQ-\d+\/task-\d+/);
    expect(text).toContain('Agent started: Claude Code fake · fake-model');
    expect(text).toContain('Working on it');
    expect(text).toContain('→ Bash: git add a.txt');
    expect(text).toContain(`✓ Finished: 1 commit on ${task.branch} ready for review`);
    // The person's checkout is untouched; the commit is on the task branch.
    expect(sh(h.repo, ['branch', '--show-current'])).toBe('develop');
    expect(sh(h.repo, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(h.repo, 'a.txt'))).toBe(false);
    expect(sh(h.repo, ['log', '--format=%s', '-1', task.branch])).toBe('add a.txt');
  });

  it('gives the agent the xticket environment and launcher', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    const [call] = h.invocations(run.id);
    expect(call.env).toMatchObject({ XTICKET_URL: 'http://127.0.0.1:4100', XTICKET_PROJECT: 'backend', XTICKET_TASK: run.id });
    expect(call.env.PATH.startsWith(path.join(h.ws, 'agent-bin'))).toBe(true);
    expect(fs.existsSync(path.join(h.ws, 'agent-bin', 'xticket'))).toBe(true);
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(h.run(run.id).worktree!));
  });

  it('needs a person when the agent committed nothing, and says where uncommitted work is', async () => {
    const h = makeLocalHarness();
    const clean = h.queueRun('FAKE: say nothing to do');
    const dirty = h.queueRun('FAKE: dirty notes.txt');
    await h.settle();
    expect(h.run(clean.run.id)).toMatchObject({ status: 'no_changes', error: 'Finished without committing anything' });
    expect(h.run(dirty.run.id).status).toBe('no_changes');
    expect(h.run(dirty.run.id).error).toMatch(/^Finished without committing; the uncommitted changes are in .*task-\d+$/);
    expect(h.logText(dirty.task.id)).toContain('⚠ Uncommitted changes left in');
  });

  it('fails with the CLI error and the last output lines when the agent exits non-zero', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: say step one\nFAKE: exit 3');
    await h.settle();
    const failed = h.run(run.id);
    expect(failed).toMatchObject({ status: 'failed', exit_code: 3 });
    expect(failed.error).toMatch(/^Claude Code failed: failed on purpose \(3\)\n/);
    expect(failed.error).toContain('step one');
    expect(h.logText(task.id)).toContain('✗ Claude Code failed: failed on purpose (3)');
  });

  it('fails clearly when the CLI cannot start', async () => {
    const h = makeLocalHarness();
    const broken = path.join(h.ws, 'broken-cli');
    fs.writeFileSync(broken, '#!/nonexistent/interpreter\n', { mode: 0o755 });
    h.settingsService.updateAiCliSettings({ claude: { customPath: broken } } as any);
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(h.run(run.id).status).toBe('failed');
    expect(h.run(run.id).error).toMatch(/^Could not start Claude Code \(.*broken-cli\): .*ENOENT/);
  });

  it('records the model and effort the run used on the task', async () => {
    const h = makeLocalHarness();
    h.settingsService.updateAiCliSettings({ claude: { model: 'sonnet', effort: 'medium' } } as any);
    const first = h.queueRun('FAKE: commit a.txt');
    const task2 = h.addTask();
    const second = h.runner.runs.create({ bridgeTaskId: task2.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit b.txt', model: 'opus', effort: 'high' });
    await h.settle();
    const taskRow = (id: number) => h.db.prepare('SELECT model, effort FROM bridge_tasks WHERE id = ?').get(id);
    expect(taskRow(first.task.id)).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(taskRow(task2.id)).toEqual({ model: 'opus', effort: 'high' });
    expect(h.invocations(second.id)[0].argv).toEqual(expect.arrayContaining(['--model', 'opus', '--effort', 'high']));
  });

  it('runs AGY with the prompt as an argument and reads its output', async () => {
    const h = makeLocalHarness({ cli: 'agy-cli' });
    const { run, task } = h.queueRun('FAKE: say hello from agy\nFAKE: commit a.txt');
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'review', cli: 'agy-cli' });
    expect(h.invocations(run.id)[0].argv[0]).toBe('-p');
    const text = h.logText(task.id);
    expect(text).toContain('▶ AGY started');
    expect(text).toContain('hello from agy');
    expect(text).toContain('→ run_command: git add a.txt');
  });
});

describe('AgentRunner: limits and settings', () => {
  it('runs at most the parallel limit and starts the rest as slots free up', async () => {
    const h = makeLocalHarness();
    const runs = [1, 2, 3].map((i) => h.queueRun(`FAKE: sleep 400\nFAKE: commit f${i}.txt`).run);
    await h.runner.tick();
    expect(h.runner.runs.count('running')).toBe(2);
    expect(h.runner.runs.count('queued')).toBe(1);
    await h.runner.idle();
    expect(runs.map((r) => h.run(r.id).status)).toEqual(['review', 'review', 'review']);
  }, 15_000);

  it('runs one agent per task at a time', async () => {
    const h = makeLocalHarness();
    const { task } = h.queueRun('FAKE: sleep 300\nFAKE: commit a.txt');
    h.queueRun('FAKE: commit b.txt', task);
    await h.runner.tick();
    expect(h.runner.runs.count('running')).toBe(1);
    await h.runner.idle();
    expect(h.runner.runs.count('review')).toBe(2);
  }, 15_000);

  it('stops a run at the time limit', async () => {
    const h = makeLocalHarness(); // minuteMs 50: the 5 minute minimum lasts 250 ms
    h.settingsService.updateLocalEngineSettings({ runTimeoutMinutes: 5 });
    const { run, task } = h.queueRun('FAKE: sleep 10000');
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'timed_out', error: 'Stopped after the 5 minute time limit (Settings → AI & Local Engines)' });
    expect(h.logText(task.id)).toContain('✗ Stopped after the 5 minute time limit');
  }, 15_000);

  it('starts nothing while turned off and picks queued runs up when turned on again', async () => {
    const h = makeLocalHarness();
    h.settingsService.updateLocalEngineSettings({ enabled: false });
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(h.run(run.id).status).toBe('queued');
    expect(h.runner.health()).toEqual({ ok: false, error: 'The Local AI CLI engine is turned off in Settings → AI & Local Engines' });
    h.settingsService.updateLocalEngineSettings({ enabled: true });
    expect(h.runner.health()).toEqual({ ok: true, version: 'local · Claude Code' });
    await h.settle();
    expect(h.run(run.id).status).toBe('review');
  });

  it('fails with what to do when the task branch is checked out in your own checkout, and leaves it alone', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: commit a.txt');
    sh(h.repo, ['checkout', '-q', task.branch]);
    await h.settle();
    expect(h.run(run.id).status).toBe('failed');
    expect(h.run(run.id).error).toContain(`Branch ${task.branch} is checked out in`);
    expect(h.run(run.id).error).toContain('switch that checkout to another branch, then Retry');
    expect(sh(h.repo, ['branch', '--show-current'])).toBe(task.branch);
    expect(sh(h.repo, ['status', '--porcelain'])).toBe('');
  });

  it('finishes even when the agent leaves a background process, and stops it', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt\nFAKE: background 30000');
    await h.settle();
    expect(h.run(run.id).status).toBe('review');
    const pid = Number(fs.readFileSync(path.join(h.promptsDir, `${run.id}-bg.pid`), 'utf8'));
    await waitFor(() => !isAlive(pid));
  }, 15_000);
});

describe('AgentRunner: cancel', () => {
  it('stops a running agent and its process group', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: sleep 10000');
    await h.runner.tick();
    const pid = h.run(run.id).pid!;
    await h.runner.cancel(run.id);
    expect(h.run(run.id).status).toBe('cancelled');
    expect(isAlive(pid)).toBe(false);
    expect(h.logText(task.id)).toContain('■ Stopped: the task was cancelled');
  }, 15_000);

  it('cancels a queued run without starting it, and treats a finished run as stopped', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.runner.cancel(run.id);
    expect(h.run(run.id).status).toBe('cancelled');
    expect(h.invocations(run.id)).toHaveLength(0);
    await h.runner.cancel(run.id);
    await h.runner.cancel('local-missing');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/agentRunner.test.ts`
Expected: FAIL (`Cannot find module '../localEngine/agentRunner.js'`).

- [ ] **Step 5: Implement the runner** — create `packages/server/src/localEngine/agentRunner.ts`:

```ts
// The Local AI CLI engine: starts queued runs (at most maxParallel), each a headless AI CLI in the
// task's own worktree; logs what it does and turns its exit into the run's status.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { AgentCliId, AiCliSettings, BridgeTask, LocalEngineSettings } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';
import type { ProjectService } from '../services/projectService.js';
import type { SettingsService } from '../services/settingsService.js';
import { commitsAhead, resolveCommit } from '../lib/gitRepo.js';
import { findCliBinary } from '../services/aiDraftService.js';
import { FINISHED_RUN_STATUSES, RunStore, type LocalRun, type RunPatch, type RunStatus } from './runStore.js';
import { AgentWorktrees } from './worktrees.js';
import { buildCommand, chooseCli, CLI_LABELS, runEffort, runModel, type FindBinary } from './cliProfiles.js';
import { createParser, looksLikeRateLimit, resetFromText, type ParsedOutput } from './outputParsers.js';
import { buildRunPrompt } from './prompt.js';
import { findXticketScript, writeXticketLauncher } from './xticketLauncher.js';
import { isSameProcess, killGroupLeftovers, spawnAgent, stopGroup, type AgentExit, type SpawnedAgent } from './processes.js';

export interface AgentRunnerOptions {
  db: AppDatabase;
  projectService: ProjectService;
  settingsService: SettingsService;
  /** Server workspace: default worktree root, run folders (prompt, raw output), xticket launcher. */
  workspaceDir: string;
  /** This server's address for xticket (XTICKET_URL). */
  bridgeUrl: string;
  agentToken?: string;
  findBinary?: FindBinary;
  /** Length of one minute of the run time limit (tests shorten it). */
  minuteMs?: number;
  /** How long an agent that asked a question may take to commit and stop (default 2 min). */
  holdGraceMs?: number;
  /** SIGTERM → SIGKILL grace when stopping an agent (default 10 s). */
  stopGraceMs?: number;
  quotaResetAt?: (cli: AgentCliId, bin: string) => Promise<string | null>;
  now?: () => number;
}

/** Log lines kept per run in task_logs; the raw output file keeps everything. */
export const MAX_LOG_LINES = 5000;
const MAX_LINE_CHARS = 2000;
const TAIL_LINES = 20;
/** Crash recoveries after which a run fails instead of starting again. */
export const MAX_INTERRUPTIONS = 3;

interface ActiveRun {
  runId: string;
  taskId: number;
  agent: SpawnedAgent;
  timers: NodeJS.Timeout[];
  timedOut: boolean;
  /** Resolves once the run's result is stored. */
  settled: Promise<void>;
}

interface OutputState {
  lines: number;
  tail: string[];
  rateLimit: { resetAt: string | null } | null;
  cliError: string | null;
}

type LogStream = 'stdout' | 'stderr' | 'system';

export class AgentRunner {
  readonly runs: RunStore;
  private worktrees: AgentWorktrees;
  private active = new Map<string, ActiveRun>();
  private ticking: Promise<void> | null = null;
  private again = false;
  private stopping = false;
  private binDir: string | null = null;
  private find: FindBinary;
  private now: () => number;

  constructor(private opts: AgentRunnerOptions) {
    this.runs = new RunStore(opts.db);
    this.find = opts.findBinary ?? findCliBinary;
    this.now = opts.now ?? Date.now;
    this.worktrees = new AgentWorktrees(() => this.settings().worktreeRoot || path.join(opts.workspaceDir, 'agent-worktrees'));
  }

  health(): { ok: boolean; version?: string; error?: string } {
    const settings = this.settings();
    if (!settings.enabled) return { ok: false, error: 'The Local AI CLI engine is turned off in Settings → AI & Local Engines' };
    const choice = chooseCli(settings, this.ai(), this.find);
    return choice.cli ? { ok: true, version: `local · ${CLI_LABELS[choice.cli]}` } : { ok: false, error: choice.problem ?? 'No AI CLI can run' };
  }

  /** Start what can start now, without waiting for the next scheduler tick. */
  nudge(): void {
    setImmediate(() => {
      this.tick().catch((err) => console.warn(`[local-engine] ${err?.message || err}`));
    });
  }

  /** One pass over the queue; concurrent calls are folded into one more pass. */
  async tick(): Promise<void> {
    if (this.ticking) {
      this.again = true;
      return this.ticking;
    }
    this.ticking = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  /** Resolves once no agent is running and no pass is going (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.active.size > 0 || this.ticking) {
      await Promise.all([...this.active.values()].map((a) => a.settled));
      if (this.ticking) await this.ticking;
    }
  }

  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || FINISHED_RUN_STATUSES.includes(run.status)) return;
    this.runs.update(runId, { cancel_requested_at: this.iso() });
    const active = this.active.get(runId);
    if (active) {
      await stopGroup(active.agent.pid, active.agent.exited, this.stopGrace());
      await active.settled;
      return;
    }
    if (run.status === 'running' && run.pid && isSameProcess(run.pid, run.pid_started_at)) {
      await stopGroup(run.pid, null, this.stopGrace());
    }
    if (this.runs.transition(runId, ['queued', 'held', 'rate_limited', 'running'], { status: 'cancelled', pid: null, finished_at: this.iso() })) {
      this.log(run.bridge_task_id, 'system', '■ Cancelled');
    }
  }

  private async pass(): Promise<void> {
    if (this.stopping) return;
    const settings = this.settings();
    if (!settings.enabled) return;
    const ai = this.ai();
    const choice = chooseCli(settings, ai, this.find);
    if (!choice.cli || !choice.bin) return;
    let running = this.runs.count('running');
    for (const run of this.runs.queued()) {
      if (running >= settings.maxParallel) break;
      if (this.taskBusy(run)) continue;
      if (this.start(run, choice.cli, choice.bin, ai, settings)) running++;
    }
  }

  private taskBusy(run: LocalRun): boolean {
    if (this.active.has(run.id)) return true;
    for (const active of this.active.values()) if (active.taskId === run.bridge_task_id) return true;
    return false;
  }

  /** Start one queued run; false when it could not start (then it is failed or cancelled). */
  private start(run: LocalRun, cli: AgentCliId, bin: string, ai: AiCliSettings, settings: LocalEngineSettings): boolean {
    const task = this.task(run.bridge_task_id);
    if (!task || task.status === 'done' || task.status === 'cancelled') {
      this.runs.transition(run.id, ['queued'], { status: 'cancelled', error: 'The task is no longer active', finished_at: this.iso() });
      return false;
    }
    const fail = (message: string) => {
      if (this.runs.transition(run.id, ['queued'], { status: 'failed', error: message, finished_at: this.iso() })) this.log(task.id, 'system', `✗ ${message}`);
      return false;
    };
    const project = this.opts.projectService.getProject(run.project);
    if (!project) return fail(`Repository ${run.project} is not registered`);
    if (!task.branch) return fail(`Local AI CLI needs a git repository: ${project.repo_path} is not the top of a git work tree`);
    const dir = this.worktrees.pathFor(project.name, task.id);
    let gitCommonDir: string;
    try {
      this.worktrees.ensure(project.repo_path, task.branch, dir);
      gitCommonDir = this.worktrees.gitCommonDir(project.repo_path);
    } catch (err: any) {
      return fail(err?.message || String(err));
    }

    const model = runModel(cli, run.model, ai);
    const effort = runEffort(cli, run.effort, ai);
    const prompt = buildRunPrompt({ bodyMd: run.body_md, worktree: dir, branch: task.branch, notesMd: run.notes_md, continuation: run.continuation === 1 });
    const runDir = path.join(this.opts.workspaceDir, 'agent-runs', run.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, `prompt-${Date.now()}.md`), prompt);
    const command = buildCommand(cli, bin, { prompt, model, effort, worktree: dir, gitCommonDir });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XTICKET_URL: this.opts.bridgeUrl,
      XTICKET_PROJECT: project.name,
      XTICKET_TASK: run.id,
      ...(this.opts.agentToken ? { XTICKET_TOKEN: this.opts.agentToken } : {}),
      PATH: `${this.launcherDir()}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    const startSha = resolveCommit(project.repo_path, `refs/heads/${task.branch}`);
    let agent: SpawnedAgent;
    try {
      agent = spawnAgent(command, dir, env);
    } catch (err: any) {
      return fail(`Could not start ${CLI_LABELS[cli]} (${bin}): ${err?.message || err}`);
    }
    const claimed = this.runs.transition(run.id, ['queued'], {
      status: 'running', cli, model, effort, worktree: dir, start_sha: startSha, end_sha: null, pid: agent.pid,
      pid_started_at: agent.startedAt, started_at: this.iso(), finished_at: null, notes_md: '', continuation: 0,
      hold_requested_at: null, cancel_requested_at: null, exit_code: null, error: null, resume_at: null,
    });
    if (!claimed) {
      void stopGroup(agent.pid, agent.exited, this.stopGrace());
      return false;
    }
    this.opts.db.prepare('UPDATE bridge_tasks SET model = ?, effort = ? WHERE id = ?').run(model, effort, task.id);
    this.log(task.id, 'system', `▶ ${CLI_LABELS[cli]} started in ${dir} on ${task.branch}${model ? ` · ${model}` : ''}${effort ? ` · ${effort}` : ''}`);
    this.supervise(run.id, task, project.repo_path, cli, bin, agent, settings.runTimeoutMinutes, runDir);
    return true;
  }

  private supervise(runId: string, task: BridgeTask, repo: string, cli: AgentCliId, bin: string, agent: SpawnedAgent, minutes: number, runDir: string) {
    const parser = createParser(cli);
    const raw = fs.createWriteStream(path.join(runDir, 'output.log'), { flags: 'a' });
    const out: OutputState = { lines: 0, tail: [], rateLimit: null, cliError: null };
    const emit = (stream: LogStream, text: string) => {
      const line = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS - 1)}…` : text;
      out.tail.push(line);
      if (out.tail.length > TAIL_LINES) out.tail.shift();
      if (out.lines >= MAX_LOG_LINES) return;
      this.log(task.id, stream, line);
      out.lines++;
      if (out.lines === MAX_LOG_LINES) {
        this.log(task.id, 'system', `Log limit of ${MAX_LOG_LINES} lines reached; the full output is in ${path.join(runDir, 'output.log')}`);
      }
    };
    const handle = (parsed: ParsedOutput) => {
      for (const line of parsed.logs) emit('stdout', line);
      if (parsed.rateLimit) out.rateLimit = parsed.rateLimit;
      if (parsed.error) out.cliError = parsed.error;
    };
    if (agent.child.stdout) {
      readline.createInterface({ input: agent.child.stdout }).on('line', (line) => {
        raw.write(`${line}\n`);
        handle(parser.push(line));
      });
    }
    if (agent.child.stderr) {
      readline.createInterface({ input: agent.child.stderr }).on('line', (line) => {
        raw.write(`[stderr] ${line}\n`);
        if (!line.trim()) return;
        emit('stderr', line);
        if (looksLikeRateLimit(line)) out.rateLimit ??= { resetAt: resetFromText(line) };
      });
    }

    const active: ActiveRun = { runId, taskId: task.id, agent, timers: [], timedOut: false, settled: Promise.resolve() };
    active.timers.push(
      setTimeout(() => {
        active.timedOut = true;
        void stopGroup(agent.pid, agent.exited, this.stopGrace());
      }, minutes * this.minuteMs())
    );
    active.settled = agent.exited.then(async (exit) => {
      active.timers.forEach(clearTimeout);
      killGroupLeftovers(agent.pid);
      handle(parser.flush());
      raw.end();
      try {
        await this.finish(runId, task.id, repo, cli, bin, exit, out, active.timedOut);
      } catch (err: any) {
        console.warn(`[local-engine] run ${runId}: ${err?.message || err}`);
      } finally {
        this.active.delete(runId);
      }
      await this.tick();
    });
    this.active.set(runId, active);
  }

  /** Turn the agent's exit into the run's status. */
  private async finish(runId: string, taskId: number, repo: string, cli: AgentCliId, bin: string, exit: AgentExit, out: OutputState, timedOut: boolean) {
    const run = this.runs.get(runId);
    const task = this.task(taskId);
    if (!run || !task) return;
    const endSha = task.branch ? resolveCommit(repo, `refs/heads/${task.branch}`) : null;
    const base: RunPatch = { pid: null, exit_code: exit.code, end_sha: endSha, finished_at: this.iso() };
    const label = CLI_LABELS[cli];

    if (run.cancel_requested_at) {
      if (this.runs.transition(runId, ['running', 'held'], { ...base, status: 'cancelled' })) this.log(taskId, 'system', '■ Stopped: the task was cancelled');
      return;
    }
    if (timedOut) {
      const minutes = this.settings().runTimeoutMinutes;
      this.end(runId, taskId, { ...base, status: 'timed_out', error: `Stopped after the ${minutes} minute time limit (Settings → AI & Local Engines)` });
      return;
    }
    if (exit.spawnError) {
      this.end(runId, taskId, { ...base, status: 'failed', error: `Could not start ${label} (${bin}): ${exit.spawnError}` });
      return;
    }
    if (exit.code !== 0) {
      const reason = out.cliError ?? (exit.signal ? `stopped by ${exit.signal}` : `exit code ${exit.code}`);
      this.end(runId, taskId, { ...base, status: 'failed', error: `${label} failed: ${reason}\n${out.tail.join('\n')}`.trim() });
      return;
    }
    const worktree = run.worktree ?? '';
    const dirty = worktree ? this.worktrees.uncommitted(worktree) : [];
    if (dirty.length) {
      this.log(taskId, 'system', `⚠ Uncommitted changes left in ${worktree} (not part of the review): ${dirty.slice(0, 10).join(', ')}${dirty.length > 10 ? ', …' : ''}`);
    }
    const ahead = task.base_sha && endSha ? commitsAhead(repo, task.base_sha, endSha) : 0;
    if (ahead > 0) {
      this.end(runId, taskId, { ...base, status: 'review' }, `✓ Finished: ${ahead} commit${ahead === 1 ? '' : 's'} on ${task.branch} ready for review`);
      return;
    }
    const error = dirty.length ? `Finished without committing; the uncommitted changes are in ${worktree}` : 'Finished without committing anything';
    this.end(runId, taskId, { ...base, status: 'no_changes', error });
  }

  private end(runId: string, taskId: number, patch: RunPatch & { status: RunStatus }, message?: string) {
    if (this.runs.transition(runId, ['running'], patch)) {
      this.log(taskId, 'system', message ?? `✗ ${(patch.error ?? patch.status).split('\n')[0]}`);
    }
  }

  private task(id: number): BridgeTask | undefined {
    return this.opts.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as BridgeTask | undefined;
  }

  private log(taskId: number, stream: LogStream, message: string) {
    this.opts.db
      .prepare('INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, ?, ?, ?)')
      .run(taskId, stream, message, new Date().toISOString());
  }

  private launcherDir(): string {
    if (!this.binDir) {
      this.binDir = writeXticketLauncher(path.join(this.opts.workspaceDir, 'agent-bin'), process.execPath, findXticketScript());
    }
    return this.binDir;
  }

  private settings(): LocalEngineSettings {
    return this.opts.settingsService.getLocalEngineSettings();
  }

  private ai(): AiCliSettings {
    return this.opts.settingsService.getAiCliSettings();
  }

  private iso(offsetMs = 0): string {
    return new Date(this.now() + offsetMs).toISOString();
  }

  private minuteMs(): number {
    return this.opts.minuteMs ?? 60_000;
  }

  private stopGrace(): number {
    return this.opts.stopGraceMs ?? 10_000;
  }
}
```

- [ ] **Step 6: Run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/agentRunner.test.ts`
Expected: PASS (15 tests). If "fails clearly when the CLI cannot start" reports a different message, check `spawnError` handling: `/nonexistent/interpreter` makes `spawn` emit `error` with `ENOENT`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/testing/fakeAgentCli.mjs packages/server/src/testing/localEngineFixture.ts packages/server/src/localEngine/agentRunner.ts packages/server/src/localEngine/agentRunner.test.ts
git commit -m "feat(server): agent runner starts local AI CLI runs in task worktrees

Runs start in their own worktree on the task branch, at most maxParallel at a
time, with parsed output in the task log. A run with commits goes to review,
one without commits needs a person, a failure keeps the last output lines,
the time limit and cancel stop the whole process group.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Questions, notes and usage limits in the runner

**Files:**
- Modify: `packages/server/src/localEngine/agentRunner.ts`
- Test: `packages/server/src/localEngine/agentRunnerHumanLoop.test.ts`

**Interfaces:**
- Consumes: Task 7 runner; `quotaResetAt` (Task 4).
- Produces: `AgentRunner.hold(runId, reason): void` (throws when the run already finished), `AgentRunner.release(runId, context): void`, `AgentRunner.note(runId, body): void`; rate-limited runs resume by themselves at `resume_at`; a CLI with a rate-limited run waiting for a future reset starts nothing.

- [ ] **Step 1: Write the failing test** — `packages/server/src/localEngine/agentRunnerHumanLoop.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { cleanLocalHarnesses, makeLocalHarness } from '../testing/localEngineFixture.js';

afterAll(() => cleanLocalHarnesses());

describe('AgentRunner: questions and notes', () => {
  it('pauses an agent that asked a question and continues with the answer', async () => {
    const h = makeLocalHarness(); // holdGraceMs 300
    const { run, task } = h.queueRun('FAKE: wait-for-note 20000\nFAKE: commit answer.txt');
    await h.runner.tick();
    h.runner.hold(run.id, 'Waiting for a person to answer question #5');
    expect(h.run(run.id).status).toBe('held');
    await h.runner.idle(); // stopped after the hold grace
    expect(h.run(run.id)).toMatchObject({ status: 'held', pid: null });
    expect(h.logText(task.id)).toContain('⏸ Waiting for a person to answer');

    h.runner.release(run.id, 'Answer to your question: use Postgres');
    await h.settle();
    expect(h.run(run.id).status).toBe('review');
    const second = h.prompts(run.id)[1];
    expect(second).toContain('## Continue');
    expect(second).toContain('## Notes since your last run\nAnswer to your question: use Postgres');
  }, 15_000);

  it('refuses to pause a finished run', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(() => h.runner.hold(run.id, 'x')).toThrow(`Run ${run.id} is review; it cannot be paused`);
  });

  it('keeps a note for a running agent and gives it at the next run', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: sleep 300\nFAKE: dirty wip.txt');
    await h.runner.tick();
    h.runner.note(run.id, '## Note from a person\nUse the v2 endpoint');
    await h.runner.idle();
    expect(h.logText(task.id)).toContain('✉ Note saved; the agent gets it at its next run');
    expect(h.run(run.id)).toMatchObject({ status: 'no_changes', notes_md: '## Note from a person\nUse the v2 endpoint' });

    const next = h.runner.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit a.txt' });
    await h.settle();
    expect(h.prompts(next.id)[0]).toContain('## Notes since your last run\n## Note from a person\nUse the v2 endpoint');
  }, 15_000);
});

describe('AgentRunner: usage limits', () => {
  it('waits for the reset the CLI reported, pauses the CLI, then continues by itself', async () => {
    let clock = Date.now();
    const h = makeLocalHarness({ runner: { now: () => clock } });
    const resetsAt = Math.floor(clock / 1000) + 600;
    const limited = h.queueRun(`FAKE: limit-once ${resetsAt}\nFAKE: commit a.txt`);
    await h.settle();
    const resumeAt = new Date(resetsAt * 1000).toISOString();
    expect(h.run(limited.run.id)).toMatchObject({ status: 'rate_limited', resume_at: resumeAt, continuation: 1 });
    expect(h.logText(limited.task.id)).toContain(`⏸ Claude Code usage limit reached; this run continues at ${resumeAt}`);

    const waiting = h.queueRun('FAKE: commit b.txt');
    await h.settle();
    expect(h.run(waiting.run.id).status).toBe('queued'); // the CLI is paused

    clock = resetsAt * 1000 + 1000;
    await h.settle();
    expect(h.run(limited.run.id).status).toBe('review');
    expect(h.run(waiting.run.id).status).toBe('review');
    expect(h.logText(limited.task.id)).toContain('↻ Usage limit reset; continuing');
  }, 20_000);

  it('asks the CLI quota when the message has no reset time, else waits 15 minutes', async () => {
    const quota = new Date(Date.now() + 3_600_000).toISOString();
    const withQuota = makeLocalHarness({ cli: 'agy-cli', runner: { quotaResetAt: async () => quota } });
    const a = withQuota.queueRun('FAKE: limit 0');
    await withQuota.settle();
    expect(withQuota.run(a.run.id)).toMatchObject({ status: 'rate_limited', resume_at: quota });

    let clock = Date.now();
    const without = makeLocalHarness({ cli: 'agy-cli', runner: { now: () => clock } });
    const b = without.queueRun('FAKE: limit 0');
    await without.settle();
    expect(without.run(b.run.id).resume_at).toBe(new Date(clock + 15 * 60_000).toISOString());
  }, 15_000);

  it('treats a usage-limit message on the CLI stderr as a limit, not a failure', async () => {
    const h = makeLocalHarness();
    const { run } = h.queueRun('FAKE: stderr Error: 429 Too Many Requests\nFAKE: exit 1');
    await h.settle();
    expect(h.run(run.id).status).toBe('rate_limited');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/agentRunnerHumanLoop.test.ts`
Expected: FAIL (`h.runner.hold is not a function`).

- [ ] **Step 3: Add hold, release and note** — in `agentRunner.ts`, add these public methods after `cancel()`:

```ts
  /** The agent asked a person: the run is held at once; the agent gets holdGraceMs to commit and stop. */
  hold(runId: string, _reason: string): void {
    const held = this.runs.transition(runId, ['running', 'queued', 'rate_limited'], { status: 'held', hold_requested_at: this.iso() });
    if (!held) {
      const run = this.runs.get(runId);
      if (run?.status === 'held') return;
      throw new Error(`Run ${runId} is ${run?.status ?? 'missing'}; it cannot be paused`);
    }
    const active = this.active.get(runId);
    if (!active) return;
    this.log(active.taskId, 'system', '⏸ Waiting for a person to answer; the agent commits its work and stops');
    active.timers.push(setTimeout(() => void stopGroup(active.agent.pid, active.agent.exited, this.stopGrace()), this.opts.holdGraceMs ?? 120_000));
  }

  /** An answer or a finished dependency: the context goes into the next run, which continues the work. */
  release(runId: string, context: string): void {
    this.runs.appendNote(runId, context);
    if (this.runs.transition(runId, ['held'], { status: 'queued', continuation: 1, hold_requested_at: null })) this.nudge();
  }

  /** A note to the agent: kept and given at its next run (a headless CLI cannot read input mid-run). */
  note(runId: string, body: string): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    this.runs.appendNote(runId, body);
    if (run.status === 'running') this.log(run.bridge_task_id, 'system', '✉ Note saved; the agent gets it at its next run');
  }
```

- [ ] **Step 4: Held, re-queued and rate-limited exits** — in `finish()`, insert right after the `if (run.cancel_requested_at) { … }` block:

```ts
    if (run.status === 'queued') {
      // Released while it was still stopping, or stopped by a server shutdown: it starts again.
      this.runs.update(runId, { pid: null, exit_code: exit.code, end_sha: endSha });
      return;
    }
    if (run.status === 'held') {
      this.runs.update(runId, { pid: null, exit_code: exit.code, end_sha: endSha });
      this.log(taskId, 'system', '⏸ Paused until a person answers; the next run continues from the branch');
      return;
    }
```

and insert right after the `if (timedOut) { … }` block:

```ts
    if (out.rateLimit) {
      const resumeAt = await this.resumeTime(cli, bin, out.rateLimit.resetAt);
      const patch: RunPatch = { ...base, finished_at: null, status: 'rate_limited', resume_at: resumeAt, continuation: 1, error: `${label} usage limit reached; continues at ${resumeAt}` };
      if (this.runs.transition(runId, ['running'], patch)) {
        this.log(taskId, 'system', `⏸ ${label} usage limit reached; this run continues at ${resumeAt}`);
      }
      return;
    }
```

Add these private members (next to `end()`), the constants next to `MAX_INTERRUPTIONS`, and `quotaResetAt as defaultQuotaResetAt` to the `./cliProfiles.js` import:

```ts
/** Wait when a usage limit names no reset time, and the longest wait honoured. */
const DEFAULT_LIMIT_WAIT_MS = 15 * 60 * 1000;
const MAX_LIMIT_WAIT_MS = 24 * 60 * 60 * 1000;
```

```ts
  /** The reset the CLI named, else its live quota's, else 15 minutes; at least 1 minute, at most 24 h ahead. */
  private async resumeTime(cli: AgentCliId, bin: string, reported: string | null): Promise<string> {
    let until = reported ? Date.parse(reported) : NaN;
    if (Number.isNaN(until)) {
      const fromQuota = await (this.opts.quotaResetAt ?? defaultQuotaResetAt)(cli, bin).catch(() => null);
      until = fromQuota ? Date.parse(fromQuota) : NaN;
    }
    if (Number.isNaN(until)) until = this.now() + DEFAULT_LIMIT_WAIT_MS;
    until = Math.min(Math.max(until, this.now() + 60_000), this.now() + MAX_LIMIT_WAIT_MS);
    return new Date(until).toISOString();
  }

  private resumeRateLimited() {
    const now = this.iso();
    for (const run of this.runs.withStatus(['rate_limited'])) {
      if (run.resume_at && run.resume_at > now) continue;
      if (this.runs.transition(run.id, ['rate_limited'], { status: 'queued', resume_at: null, continuation: 1, error: null })) {
        this.log(run.bridge_task_id, 'system', '↻ Usage limit reset; continuing');
      }
    }
  }
```

- [ ] **Step 5: Wire them into `pass()`** — change `pass()` to:

```ts
  private async pass(): Promise<void> {
    if (this.stopping) return;
    this.resumeRateLimited();
    const settings = this.settings();
    if (!settings.enabled) return;
    const ai = this.ai();
    const choice = chooseCli(settings, ai, this.find);
    if (!choice.cli || !choice.bin) return;
    if (this.runs.pausedClis(this.now()).has(choice.cli)) return;
    let running = this.runs.count('running');
    for (const run of this.runs.queued()) {
      if (running >= settings.maxParallel) break;
      if (this.taskBusy(run)) continue;
      if (this.start(run, choice.cli, choice.bin, ai, settings)) running++;
    }
  }
```

- [ ] **Step 6: Run both runner tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/agentRunnerHumanLoop.test.ts packages/server/src/localEngine/agentRunner.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/localEngine/agentRunner.ts packages/server/src/localEngine/agentRunnerHumanLoop.test.ts
git commit -m "feat(server): local agents pause for questions, keep notes and wait out usage limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Restarts, worktree cleanup and live status

**Files:**
- Modify: `packages/server/src/localEngine/agentRunner.ts`
- Test: `packages/server/src/localEngine/agentRunnerLifecycle.test.ts`

**Interfaces:**
- Consumes: Tasks 7–8 runner; `isSameProcess`, `stopGroup` (Task 5); `AGENT_CLI_IDS`, `LocalEngineStatus` (Task 1); `cliBinary`, `cliEnabled` (Task 4).
- Produces: `AgentRunner.shutdown(): Promise<void>`, `AgentRunner.recoverOnStartup(): Promise<void>`, `AgentRunner.releaseWorktree(taskId): boolean`, `AgentRunner.status(): LocalEngineStatus`; worktrees of `done`/`cancelled` tasks are removed on each pass.

- [ ] **Step 1: Write the failing test** — `packages/server/src/localEngine/agentRunnerLifecycle.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { cleanLocalHarnesses, makeLocalHarness } from '../testing/localEngineFixture.js';
import { deleteMergedBranch, checkoutPathOf } from '../lib/gitRepo.js';
import { isAlive, spawnAgent } from './processes.js';

afterAll(() => cleanLocalHarnesses());

describe('AgentRunner: server restarts', () => {
  it('a clean restart never counts against the run, however often it happens', async () => {
    const h = makeLocalHarness();
    const { run, task } = h.queueRun('FAKE: sleep 1500\nFAKE: commit a.txt');
    let runner = h.runner;
    for (let restart = 0; restart < 3; restart++) {
      await runner.tick();
      const pid = h.run(run.id).pid!;
      await runner.shutdown();
      expect(h.run(run.id)).toMatchObject({ status: 'queued', continuation: 1, interruptions: 0, pid: null });
      expect(isAlive(pid)).toBe(false);
      runner = h.newRunner();
      await runner.recoverOnStartup();
    }
    await h.settle(runner);
    expect(h.run(run.id)).toMatchObject({ status: 'review', interruptions: 0 });
    expect(h.logText(task.id)).toContain('⏹ Server stopping; this run continues when the server starts again');
  }, 30_000);

  it('after a crash stops only its own leftover agent and queues the run again; the third crash fails it', async () => {
    const h = makeLocalHarness();
    const orphan = spawnAgent({ bin: '/bin/sleep', args: ['30'], stdin: null }, h.ws, process.env);
    const ours = h.queueRun('FAKE: commit a.txt');
    h.runner.runs.update(ours.run.id, { status: 'running', pid: orphan.pid, pid_started_at: orphan.startedAt });
    const stranger = h.queueRun('FAKE: commit b.txt');
    h.runner.runs.update(stranger.run.id, { status: 'running', pid: process.pid, pid_started_at: 'Mon Jan  1 00:00:00 2001' });
    const third = h.queueRun('FAKE: commit c.txt');
    h.runner.runs.update(third.run.id, { status: 'running', interruptions: 2 });

    await h.runner.recoverOnStartup();

    expect(isAlive(orphan.pid)).toBe(false);
    expect(isAlive(process.pid)).toBe(true);
    expect(h.run(ours.run.id)).toMatchObject({ status: 'queued', interruptions: 1, continuation: 1, pid: null });
    expect(h.run(stranger.run.id)).toMatchObject({ status: 'queued', interruptions: 1 });
    expect(h.run(third.run.id)).toMatchObject({ status: 'failed', interruptions: 3 });
    expect(h.run(third.run.id).error).toBe('Interrupted 3 times (the server stopped while the agent was running); Retry starts it again');
    expect(h.logText(ours.task.id)).toContain('↻ The server restarted while the agent was running; it continues from the branch');
  }, 15_000);
});

describe('AgentRunner: worktrees and status', () => {
  it('removes the worktree once the task is complete, and keeps one with uncommitted changes', async () => {
    const h = makeLocalHarness();
    const done = h.queueRun('FAKE: commit a.txt');
    const dirty = h.queueRun('FAKE: commit b.txt\nFAKE: dirty wip.txt');
    await h.settle();
    const doneDir = h.run(done.run.id).worktree!;
    const dirtyDir = h.run(dirty.run.id).worktree!;
    h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id IN (?, ?)").run(done.task.id, dirty.task.id);
    await h.runner.tick();
    await h.runner.tick();
    expect(fs.existsSync(doneDir)).toBe(false);
    expect(h.run(done.run.id).worktree).toBeNull();
    expect(fs.existsSync(dirtyDir)).toBe(true);
    expect(h.logs(dirty.task.id).filter((l) => l.message.startsWith('Kept ')).length).toBe(1);
  });

  it('frees a worktree so the merge gate can delete the merged branch', async () => {
    const h = makeLocalHarness();
    const { task } = h.queueRun('FAKE: commit a.txt');
    await h.settle();
    expect(checkoutPathOf(h.repo, task.branch)).not.toBeNull();
    expect(h.runner.releaseWorktree(task.id)).toBe(true);
    expect(checkoutPathOf(h.repo, task.branch)).toBeNull();
    expect(deleteMergedBranch(h.repo, task.branch, task.branch)).toBe(true);
  });

  it('reports the CLI that runs next, counts and pauses', async () => {
    let clock = Date.now();
    const h = makeLocalHarness({ runner: { now: () => clock } });
    const limited = h.queueRun(`FAKE: limit ${Math.floor(clock / 1000) + 600}`);
    await h.settle();
    h.queueRun('FAKE: commit a.txt');
    const status = h.runner.status();
    expect(status).toMatchObject({ enabled: true, cli: 'claude-cli', problem: null, maxParallel: 2, counts: { running: 0, queued: 1, held: 0, rate_limited: 1 } });
    expect(status.worktreeRoot.endsWith('agent-worktrees')).toBe(true);
    const claude = status.clis.find((c) => c.id === 'claude-cli')!;
    expect(claude).toMatchObject({ label: 'Claude Code', installed: true, enabled: true, pausedUntil: h.run(limited.run.id).resume_at });
    expect(status.clis.map((c) => c.id)).toEqual(['claude-cli', 'agy-cli', 'codex-cli']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/agentRunnerLifecycle.test.ts`
Expected: FAIL (`runner.shutdown is not a function`).

- [ ] **Step 3: Implement** — in `agentRunner.ts`:

Extend the imports: add `AGENT_CLI_IDS` (value import from `@sp-kickstack/shared`), `LocalEngineStatus` to the type import, and `cliBinary, cliEnabled` to the `./cliProfiles.js` import. Add a field `private dirtyLogged = new Set<string>();`. Then add these public methods after `note()`:

```ts
  /** Server stopping: stop every agent; their runs continue (as continuations) after the restart. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    await Promise.all(
      [...this.active.values()].map(async (active) => {
        if (this.runs.transition(active.runId, ['running'], { status: 'queued', continuation: 1 })) {
          this.log(active.taskId, 'system', '⏹ Server stopping; this run continues when the server starts again');
        }
        await stopGroup(active.agent.pid, active.agent.exited, this.stopGrace());
        await active.settled.catch(() => {});
      })
    );
  }

  /**
   * After a crash, runs still marked running lost their server. Their agent is stopped only when it
   * is provably ours (pid + start time); the run is queued again, and fails at the third crash.
   */
  async recoverOnStartup(): Promise<void> {
    for (const run of this.runs.withStatus(['running', 'held'])) {
      if (this.active.has(run.id)) continue;
      if (run.pid && isSameProcess(run.pid, run.pid_started_at)) await stopGroup(run.pid, null, this.stopGrace());
      if (run.status === 'held') {
        if (run.pid) this.runs.update(run.id, { pid: null });
        continue;
      }
      const interruptions = run.interruptions + 1;
      if (interruptions >= MAX_INTERRUPTIONS) {
        const error = `Interrupted ${interruptions} times (the server stopped while the agent was running); Retry starts it again`;
        if (this.runs.transition(run.id, ['running'], { status: 'failed', pid: null, interruptions, finished_at: this.iso(), error })) {
          this.log(run.bridge_task_id, 'system', `✗ ${error}`);
        }
      } else if (this.runs.transition(run.id, ['running'], { status: 'queued', pid: null, interruptions, continuation: 1 })) {
        this.log(run.bridge_task_id, 'system', '↻ The server restarted while the agent was running; it continues from the branch');
      }
    }
  }

  /** Free a task's worktree: the merge gate deletes merged branches, which git refuses while checked out. */
  releaseWorktree(taskId: number): boolean {
    const row = this.opts.db
      .prepare('SELECT project, MAX(worktree) AS worktree FROM local_runs WHERE bridge_task_id = ? AND worktree IS NOT NULL GROUP BY project')
      .get(taskId) as { project: string; worktree: string } | undefined;
    return row ? this.removeTaskWorktree(taskId, row.project, row.worktree) : true;
  }

  status(): LocalEngineStatus {
    const settings = this.settings();
    const ai = this.ai();
    const choice = chooseCli(settings, ai, this.find);
    const paused = this.runs.pausedClis(this.now());
    return {
      enabled: settings.enabled,
      cli: choice.cli,
      problem: settings.enabled ? choice.problem : 'The Local AI CLI engine is turned off',
      clis: AGENT_CLI_IDS.map((id) => ({
        id, label: CLI_LABELS[id], installed: cliBinary(id, ai, this.find) !== null, enabled: cliEnabled(id, ai), pausedUntil: paused.get(id) ?? null,
      })),
      counts: {
        running: this.runs.count('running'), queued: this.runs.count('queued'), held: this.runs.count('held'), rate_limited: this.runs.count('rate_limited'),
      },
      maxParallel: settings.maxParallel,
      worktreeRoot: settings.worktreeRoot || path.join(this.opts.workspaceDir, 'agent-worktrees'),
    };
  }
```

Add these private methods next to `resumeRateLimited()`:

```ts
  /** Worktrees of tasks that are COMPLETE or CANCELLED are removed (kept while they have uncommitted changes). */
  private cleanupWorktrees() {
    const rows = this.opts.db
      .prepare(`
        SELECT r.bridge_task_id AS taskId, r.project AS project, MAX(r.worktree) AS worktree
        FROM local_runs r JOIN bridge_tasks t ON t.id = r.bridge_task_id
        WHERE r.worktree IS NOT NULL AND t.status IN ('done', 'cancelled')
        GROUP BY r.bridge_task_id, r.project
      `)
      .all() as Array<{ taskId: number; project: string; worktree: string }>;
    for (const row of rows) this.removeTaskWorktree(row.taskId, row.project, row.worktree);
  }

  private removeTaskWorktree(taskId: number, project: string, worktree: string): boolean {
    for (const active of this.active.values()) if (active.taskId === taskId) return false;
    const repo = this.opts.projectService.getProject(project)?.repo_path;
    if (!repo) return false;
    let result: 'removed' | 'dirty' | 'missing';
    try {
      result = this.worktrees.removeIfClean(repo, worktree);
    } catch (err: any) {
      console.warn(`[local-engine] could not remove ${worktree}: ${err?.message || err}`);
      return false;
    }
    if (result === 'dirty') {
      if (!this.dirtyLogged.has(worktree)) {
        this.dirtyLogged.add(worktree);
        this.log(taskId, 'system', `Kept ${worktree}: it has uncommitted changes. Delete it yourself when you no longer need them.`);
      }
      return false;
    }
    this.opts.db.prepare('UPDATE local_runs SET worktree = NULL, updated_at = ? WHERE bridge_task_id = ?').run(new Date().toISOString(), taskId);
    return true;
  }
```

Change the first lines of `pass()` to:

```ts
    if (this.stopping) return;
    this.resumeRateLimited();
    this.cleanupWorktrees();
```

- [ ] **Step 4: Run all runner tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine`
Expected: PASS (all localEngine tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/localEngine/agentRunner.ts packages/server/src/localEngine/agentRunnerLifecycle.test.ts
git commit -m "feat(server): local agents survive restarts; finished worktrees are removed

A clean shutdown stops the agents and queues their runs as continuations
without counting it; after a crash only provably own processes are stopped
and the third crash fails the run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: LocalCliAdapter and dispatch through the bridge

**Files:**
- Create: `packages/server/src/adapters/localCliAdapter.ts`
- Modify: `packages/server/src/adapters/types.ts` (`CreateEngineTaskInput`)
- Modify: `packages/server/src/adapters/index.ts`
- Modify: `packages/server/src/adapters/stoneforgeAdapter.ts` (`createGoal` ~line 70, `createTask` ~line 92)
- Modify: `packages/server/src/services/fanOutService.ts:207`
- Modify: `packages/server/src/services/ticketService.ts:219-223`
- Modify: `packages/server/src/watcher/engineWatcher.ts` (`syncTask`)
- Create: `packages/server/src/testing/localEngineE2E.ts` (test helper; tests never import other test files, or their tests would run twice)
- Test: `packages/server/src/localEngine/localEngine.e2e.test.ts`

**Interfaces:**
- Consumes: `AgentRunner` (Tasks 7–9), `RunStore`, `LocalRun`, `RunStatus`.
- Produces: `interface LocalEngine { readonly runs: RunStore; health(); nudge(); hold(runId, reason); release(runId, context); note(runId, body); cancel(runId): Promise<void> }` (AgentRunner satisfies it); `class LocalCliAdapter implements EngineAdapter`; `toEngineTask(run): EngineTask`; `CreateEngineTaskInput.bridgeTaskId?: number`; `interface AdapterDeps { local?: LocalEngine }`; `createAdapter(project, deps?: AdapterDeps)`. The watcher copies an engine's `summary` into `last_error` when a task becomes failed or needs_human.

- [ ] **Step 1: The end-to-end helper** — create `packages/server/src/testing/localEngineE2E.ts`:

```ts
// Test-only: the Local AI CLI harness wired to the real bridge services (fan-out, watcher, questions).
import { createAdapter } from '../adapters/index.js';
import { FanOutService } from '../services/fanOutService.js';
import { LinkService } from '../services/linkService.js';
import { TicketService } from '../services/ticketService.js';
import { TaskReactor } from '../services/taskReactor.js';
import { QuestionService } from '../services/questionService.js';
import { EngineWatcher } from '../watcher/engineWatcher.js';
import { makeLocalHarness } from './localEngineFixture.js';

export function makeE2E() {
  const h = makeLocalHarness();
  const getAdapter = (name: string) => createAdapter(h.projectService.getProject(name)!, { local: h.runner });
  const linkService = new LinkService(h.db, h.projectService, getAdapter);
  const tickets = new TicketService(h.db, h.projectService, linkService, getAdapter);
  const fanOut = new FanOutService(h.db, h.projectService, h.requirementService, getAdapter);
  const reactor = new TaskReactor(h.db, h.requirementService, linkService, () => {});
  const watcher = new EngineWatcher(h.db, h.projectService, h.requirementService, getAdapter, () => {}, 5000, reactor);
  const questions = new QuestionService(h.db, linkService, getAdapter);
  const createRequirement = (criteria: string[]) =>
    h.requirementService.createRequirement({ title: 'Rides', goal: 'Track rides', acceptance_criteria: criteria, affected_projects: ['backend'], priority: 'normal' });
  const task = (id: number) => h.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  return { ...h, getAdapter, linkService, tickets, fanOut, reactor, watcher, questions, createRequirement, task };
}
```

Then write the failing test — `packages/server/src/localEngine/localEngine.e2e.test.ts`:

```ts
// Fan-out → Local AI CLI engine → watcher, with the real services.
import { describe, it, expect, afterAll } from 'vitest';
import { prepareRetry } from '../services/taskRetry.js';
import { sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses } from '../testing/localEngineFixture.js';
import { makeE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

describe('Local AI CLI engine through fan-out', () => {
  it('moves a task QUEUED → RUNNING → IN REVIEW by itself after Start Fan-Out', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: sleep 300', 'FAKE: commit rides.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    expect(goal).toMatchObject({ status: 'queued', project: 'backend' });
    expect(goal.engine_task_id).toMatch(/^local-/);

    await h.runner.tick();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('running');

    await h.runner.idle();
    await h.watcher.scanOnce();
    expect(h.task(goal.id)).toMatchObject({ status: 'in_review', engine_status_raw: 'review' });
    expect(sh(h.repo, ['log', '--format=%s', '-1', goal.branch])).toBe('add rides.ts');
    expect(h.requirementService.getRequirement(req.id)!.status).toBe('in_review');
  }, 15_000);

  it('Retry after a failure continues in the same worktree with the retry note and earlier notes', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: commit first.ts', 'FAKE: fail-unless-retry 3']);
    const [goal] = await h.fanOut.execute(req.id);
    await h.settle();
    await h.watcher.scanOnce();
    const failed = h.task(goal.id);
    expect(failed.status).toBe('failed');
    expect(failed.last_error).toContain('failed on purpose (3)');
    const firstRun = h.runner.runs.get(goal.engine_task_id)!;
    await h.getAdapter('backend').appendNote(firstRun.id, 'Use the v2 endpoint');

    await prepareRetry(h.db, goal.id, 'goal', h.getAdapter);
    await h.fanOut.dispatchGoal(goal.id);
    const retried = h.task(goal.id);
    expect(retried.engine_task_id).not.toBe(firstRun.id);
    await h.settle();
    await h.watcher.scanOnce();

    expect(h.task(goal.id).status).toBe('in_review');
    const secondRun = h.runner.runs.get(retried.engine_task_id)!;
    expect(secondRun.worktree).toBe(firstRun.worktree);
    const prompt = h.prompts(secondRun.id)[0];
    expect(prompt).toContain('## Retry');
    expect(prompt).toContain('## Notes since your last run\nUse the v2 endpoint');
    expect(sh(h.repo, ['rev-list', '--count', `develop..${goal.branch}`])).toBe('2');
  }, 20_000);

  it('pauses for a question and continues with the answer', async () => {
    const h = makeE2E();
    const req = h.createRequirement(['FAKE: wait-for-note 20000', 'FAKE: commit answer.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    await h.runner.tick();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('running');

    const asked: any = await h.questions.ask({ question: 'Postgres or Redis?', options: ['postgres', 'redis'] }, 'backend', goal.engine_task_id);
    expect(asked).toMatchObject({ held: true });
    expect(h.task(goal.id).status).toBe('held');
    await h.runner.idle();

    await h.questions.answer(asked.questionId, { option: 'postgres' });
    await h.settle();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('in_review');
    expect(h.prompts(goal.engine_task_id)[1]).toMatch(/## Notes since your last run[\s\S]*postgres/i);
  }, 20_000);

  it('shows the engine as down with the reason when no CLI can run', async () => {
    const h = makeE2E();
    h.settingsService.updateLocalEngineSettings({ enabled: false });
    expect(await h.getAdapter('backend').health()).toEqual({ ok: false, error: 'The Local AI CLI engine is turned off in Settings → AI & Local Engines' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/localEngine.e2e.test.ts`
Expected: FAIL (`Unsupported engine type: local`).

- [ ] **Step 3: The adapter** — create `packages/server/src/adapters/localCliAdapter.ts`:

```ts
import type { EngineTask, NormStatus, Project } from '@sp-kickstack/shared';
import type { CreateEngineTaskInput, EngineAdapter } from './types.js';
import type { LocalRun, RunStatus, RunStore } from '../localEngine/runStore.js';

/** What the adapter needs from the runner (AgentRunner implements it). */
export interface LocalEngine {
  readonly runs: RunStore;
  health(): { ok: boolean; version?: string; error?: string };
  nudge(): void;
  hold(runId: string, reason: string): void;
  release(runId: string, context: string): void;
  note(runId: string, body: string): void;
  cancel(runId: string): Promise<void>;
}

const STATUS: Record<RunStatus, NormStatus> = {
  queued: 'queued',
  running: 'running',
  held: 'held',
  rate_limited: 'rate_limited',
  review: 'in_review',
  no_changes: 'needs_human',
  failed: 'failed',
  timed_out: 'failed',
  cancelled: 'cancelled',
};

export function toEngineTask(run: LocalRun): EngineTask {
  return {
    id: run.id,
    title: run.title,
    status: STATUS[run.status],
    rawStatus: run.status,
    ...(run.status === 'rate_limited' && run.resume_at ? { resumeAt: run.resume_at } : {}),
    ...(run.error ? { summary: run.error } : {}),
  };
}

/** Engine adapter for the Local AI CLI engine: every task is a run of the in-server AgentRunner. */
export class LocalCliAdapter implements EngineAdapter {
  public type = 'local' as const;

  constructor(private project: Project, private engine: LocalEngine) {}

  public async health() {
    return this.engine.health();
  }

  public async createGoal(input: CreateEngineTaskInput): Promise<EngineTask> {
    return this.create(input);
  }

  public async createTask(input: CreateEngineTaskInput): Promise<EngineTask> {
    return this.create(input);
  }

  public async getTask(id: string): Promise<EngineTask | null> {
    const run = this.engine.runs.get(id);
    return run ? toEngineTask(run) : null;
  }

  public async listTasks(ids: string[]): Promise<EngineTask[]> {
    return ids.map((id) => this.engine.runs.get(id)).filter((r): r is LocalRun => Boolean(r)).map(toEngineTask);
  }

  public async holdTask(id: string, reason: string): Promise<void> {
    this.engine.hold(id, reason);
  }

  public async releaseTask(id: string, context: string): Promise<void> {
    this.engine.release(id, context);
  }

  public async appendNote(id: string, bodyMd: string): Promise<void> {
    this.engine.note(id, bodyMd);
  }

  public async cancelTask(id: string): Promise<void> {
    await this.engine.cancel(id);
  }

  private create(input: CreateEngineTaskInput): EngineTask {
    if (!input.bridgeTaskId) throw new Error('The Local AI CLI engine needs the bridge task id');
    const run = this.engine.runs.create({
      bridgeTaskId: input.bridgeTaskId, project: this.project.name, title: input.title, bodyMd: input.bodyMd,
      model: input.model ?? null, effort: input.effort ?? null,
    });
    this.engine.nudge();
    return toEngineTask(run);
  }
}
```

- [ ] **Step 4: Input field, factory, Stoneforge body**

In `packages/server/src/adapters/types.ts`, add to `CreateEngineTaskInput` after `effort?`:

```ts
  /** The bridge task this belongs to (the Local AI CLI engine needs it; HTTP engines never receive it). */
  bridgeTaskId?: number;
```

Replace `packages/server/src/adapters/index.ts` with:

```ts
import { Project } from '@sp-kickstack/shared';
import { EngineAdapter } from './types.js';
import { StoneforgeAdapter } from './stoneforgeAdapter.js';
import { ManualAdapter } from './manualAdapter.js';
import { LocalCliAdapter, type LocalEngine } from './localCliAdapter.js';

export * from './types.js';
export * from './stoneforgeAdapter.js';
export * from './manualAdapter.js';
export * from './localCliAdapter.js';
export * from './fakeEngine.js';

export interface AdapterDeps {
  /** The in-server Local AI CLI engine; absent outside the bridge server (e.g. the MCP process). */
  local?: LocalEngine;
}

export function createAdapter(project: Project, deps: AdapterDeps = {}): EngineAdapter {
  switch (project.engine_type) {
    case 'stoneforge':
      if (!project.engine_url) {
        throw new Error(`Engine URL is required for project ${project.name}`);
      }
      return new StoneforgeAdapter(project.engine_url, project.repo_path);
    case 'manual':
      return new ManualAdapter();
    case 'local':
      if (!deps.local) throw new Error('The Local AI CLI engine runs only inside the bridge server');
      return new LocalCliAdapter(project, deps.local);
    case 'clinekanban':
      throw new Error(`clinekanban adapter is not yet implemented`);
    default:
      throw new Error(`Unsupported engine type: ${project.engine_type}`);
  }
}
```

In `packages/server/src/adapters/stoneforgeAdapter.ts`, add above the class:

```ts
/** The create request body: exactly the fields Stoneforge has always received (never bridgeTaskId). */
function engineBody(input: CreateEngineTaskInput) {
  const { title, bodyMd, priority, labels, model, effort } = input;
  return { title, bodyMd, priority, labels, model, effort };
}
```

and in both `createGoal` and `createTask` replace `body: JSON.stringify(input),` with `body: JSON.stringify(engineBody(input)),`.

- [ ] **Step 5: Dispatch passes the task id** — in `packages/server/src/services/fanOutService.ts:207` change the create call to:

```ts
        const engineTask = await adapter.createGoal({ title: task.title, bodyMd: task.body_md || '', ...engineProfile(profile), bridgeTaskId: taskId });
```

In `packages/server/src/services/ticketService.ts` (the `adapter.createTask({ … })` call in `dispatchTicket`) add `bridgeTaskId: ticketId,` after `...engineProfile(profile),`.

- [ ] **Step 6: The watcher shows the engine's reason** — in `packages/server/src/watcher/engineWatcher.ts`, add `import { oneLine } from '../lib/promptSafety.js';`, and in `syncTask` replace the guarded UPDATE with:

```ts
    // A failed or stuck task shows the engine's reason (for the local engine: the run's error).
    const problem =
      (engineTask.status === 'failed' || engineTask.status === 'needs_human') && engineTask.summary ? oneLine(engineTask.summary, 500) : null;
    const updated = this.db
      .prepare(`
        UPDATE bridge_tasks
        SET status = ?, engine_status_raw = ?, pr_url = COALESCE(?, pr_url), paused_until = ?, last_error = COALESCE(?, last_error), updated_at = ?
        WHERE id = ? AND status = ?
      `)
      .run(
        engineTask.status,
        engineTask.rawStatus,
        engineTask.prUrl || null,
        pausedUntil,
        problem,
        new Date().toISOString(),
        task.id,
        oldStatus
      );
```

- [ ] **Step 7: Run the e2e test and the whole server suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine/localEngine.e2e.test.ts && npx vitest run packages/server`
Expected: PASS. Existing Stoneforge tests keep passing because the request body is unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/adapters/localCliAdapter.ts packages/server/src/adapters/types.ts packages/server/src/adapters/index.ts packages/server/src/adapters/stoneforgeAdapter.ts packages/server/src/services/fanOutService.ts packages/server/src/services/ticketService.ts packages/server/src/watcher/engineWatcher.ts packages/server/src/testing/localEngineE2E.ts packages/server/src/localEngine/localEngine.e2e.test.ts
git commit -m "feat(server): Local AI CLI engine adapter; fan-out tasks run by themselves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Server wiring, routes, Manual hand-over, merge gate

**Files:**
- Create: `packages/server/src/localEngine/handover.ts`
- Create: `packages/server/src/api/localEngineRoutes.ts`
- Modify: `packages/server/src/api/app.ts` (`AppDependencies` ~line 59; `PUT /api/projects/:name` ~line 257; route registration next to `registerHumanLoopRoutes` ~line 853)
- Modify: `packages/server/src/services/mergeGate.ts` (`MergeGateOptions` ~line 19; branch deletion ~line 393)
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/api/localEngineRoutes.test.ts`

**Interfaces:**
- Consumes: `AgentRunner` (`status()`, `nudge()`, `tick()`, `shutdown()`, `recoverOnStartup()`, `releaseWorktree()`); `FanOutService.dispatchGoal(id)`; `TicketService.dispatchTicket(id)`; `makeE2E` from `packages/server/src/testing/localEngineE2E.ts` (Task 10).
- Produces: `handOverManualTasks(db, project, dispatch): Promise<number[]>`; `registerLocalEngineRoutes(app, deps)`; routes `GET/PUT /api/settings/local-engine`, `GET /api/local-engine/status`; `AppDependencies.localEngine?: { status(): LocalEngineStatus; nudge(): void }`; `MergeGateOptions.releaseWorktree?: (taskId: number) => boolean`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/api/localEngineRoutes.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createApp } from './app.js';
import { testRequest } from './testHelper.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { cleanLocalHarnesses } from '../testing/localEngineFixture.js';
import { makeE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

function appFor(h: ReturnType<typeof makeE2E>, withEngine = true) {
  return createApp({
    db: h.db, workspaceService: new WorkspaceService(h.db), projectService: h.projectService, requirementService: h.requirementService,
    fanOutService: h.fanOut, linkService: h.linkService, ticketService: h.tickets, broadcaster: new SseBroadcaster(), notifier: new Notifier(),
    getAdapter: h.getAdapter, settingsService: h.settingsService, ...(withEngine ? { localEngine: h.runner } : {}),
  });
}

describe('Local AI CLI engine routes', () => {
  it('reads and saves the settings, refusing bad values with the field name', async () => {
    const h = makeE2E();
    const app = appFor(h);
    expect((await testRequest(app, 'GET', '/api/settings/local-engine')).body).toMatchObject({ enabled: true, agentCli: 'claude-cli', maxParallel: 2 });
    const saved = await testRequest(app, 'PUT', '/api/settings/local-engine', { body: { maxParallel: 4 } });
    expect(saved).toMatchObject({ status: 200, body: { maxParallel: 4 } });
    const refused = await testRequest(app, 'PUT', '/api/settings/local-engine', { body: { maxParallel: 20 } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('maxParallel');
  });

  it('reports live status, or 503 when the server runs no local engine', async () => {
    const h = makeE2E();
    expect((await testRequest(appFor(h), 'GET', '/api/local-engine/status')).body).toMatchObject({ enabled: true, cli: 'claude-cli', counts: { running: 0 } });
    expect((await testRequest(appFor(h, false), 'GET', '/api/local-engine/status')).status).toBe(503);
  });

  it('hands queued Manual tasks to the local engine when the repository switches to Local AI CLI', async () => {
    const h = makeE2E();
    h.projectService.updateProject('backend', { engine_type: 'manual' });
    const req = h.createRequirement(['FAKE: commit handed.ts']);
    const [goal] = await h.fanOut.execute(req.id);
    expect(goal.engine_task_id).toMatch(/^manual-/);
    const otherReq = h.createRequirement(['FAKE: commit other.ts']);
    const [heldGoal] = await h.fanOut.execute(otherReq.id);
    h.db.prepare("UPDATE bridge_tasks SET status = 'held' WHERE id = ?").run(heldGoal.id);

    const res = await testRequest(appFor(h), 'PUT', '/api/projects/backend', { body: { engine_type: 'local' } });
    expect(res.status).toBe(200);
    expect(h.task(goal.id)).toMatchObject({ status: 'queued' });
    expect(h.task(goal.id).engine_task_id).toMatch(/^local-/);
    expect(h.task(heldGoal.id).engine_task_id).toMatch(/^manual-/);

    await h.settle();
    await h.watcher.scanOnce();
    expect(h.task(goal.id).status).toBe('in_review');
  }, 15_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/api/localEngineRoutes.test.ts`
Expected: FAIL (404 on `/api/settings/local-engine`).

- [ ] **Step 3: Hand-over** — create `packages/server/src/localEngine/handover.ts`:

```ts
import type { AppDatabase } from '../db/index.js';

export interface HandoverDispatch {
  dispatchGoal(taskId: number): Promise<void>;
  dispatchTicket(taskId: number): Promise<void>;
}

/**
 * A repository moved from Manual to Local AI CLI: its QUEUED Manual tasks (nobody works on them) are
 * claimed back and dispatched to the local engine. Tasks in other states are left alone.
 */
export async function handOverManualTasks(db: AppDatabase, project: string, dispatch: HandoverDispatch): Promise<number[]> {
  const rows = db
    .prepare(`
      SELECT id, role FROM bridge_tasks
      WHERE project = ? AND status = 'queued' AND role IN ('goal', 'ticket') AND engine_task_id LIKE 'manual-%'
      ORDER BY id
    `)
    .all(project) as Array<{ id: number; role: 'goal' | 'ticket' }>;
  const claim = db.prepare(`
    UPDATE bridge_tasks
    SET status = 'pending', engine_task_id = NULL, engine_status_raw = NULL, engine_url = NULL, last_error = NULL,
        model = NULL, effort = NULL, updated_at = ?
    WHERE id = ? AND status = 'queued' AND engine_task_id LIKE 'manual-%'
  `);
  const claimed = rows.filter((row) => claim.run(new Date().toISOString(), row.id).changes === 1);
  await Promise.allSettled(claimed.map((row) => (row.role === 'goal' ? dispatch.dispatchGoal(row.id) : dispatch.dispatchTicket(row.id))));
  return claimed.map((row) => row.id);
}
```

- [ ] **Step 4: Routes** — create `packages/server/src/api/localEngineRoutes.ts`:

```ts
import type { Express } from 'express';
import type { LocalEngineStatus } from '@sp-kickstack/shared';
import type { SettingsService } from '../services/settingsService.js';
import type { SseBroadcaster } from '../sse/broadcaster.js';

export interface LocalEngineRouteDeps {
  settingsService: SettingsService;
  broadcaster: SseBroadcaster;
  localEngine?: { status(): LocalEngineStatus; nudge(): void };
}

/** Settings → AI & Local Engines: the Local AI CLI engine's settings and live status. */
export function registerLocalEngineRoutes(app: Express, deps: LocalEngineRouteDeps) {
  app.get('/api/settings/local-engine', (_req, res) => {
    res.json(deps.settingsService.getLocalEngineSettings());
  });

  app.put('/api/settings/local-engine', (req, res, next) => {
    try {
      const updated = deps.settingsService.updateLocalEngineSettings(req.body);
      deps.broadcaster.broadcast({ type: 'settings_updated', payload: { local_engine: updated } });
      deps.localEngine?.nudge();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/local-engine/status', (_req, res) => {
    if (!deps.localEngine) return res.status(503).json({ error: 'The Local AI CLI engine is not running in this server' });
    res.json(deps.localEngine.status());
  });
}
```

- [ ] **Step 5: Wire into `createApp`** — in `packages/server/src/api/app.ts`:

1. Imports: `import type { LocalEngineStatus } from '@sp-kickstack/shared';` (merge into the existing shared import), `import { registerLocalEngineRoutes } from './localEngineRoutes.js';`, `import { handOverManualTasks } from '../localEngine/handover.js';`.
2. In `AppDependencies`, after `notificationService?`:

```ts
  /** The in-server Local AI CLI engine (settings nudges it; Settings shows its status). */
  localEngine?: { status(): LocalEngineStatus; nudge(): void };
```

3. Replace the `app.put('/api/projects/:name', …)` handler with:

```ts
  app.put('/api/projects/:name', async (req, res, next) => {
    try {
      const before = deps.projectService.getProject(req.params.name);
      const updated = deps.projectService.updateProject(req.params.name, req.body);
      // Manual → Local AI CLI: tasks waiting on Manual (nobody works on them) start now.
      if (before?.engine_type === 'manual' && updated.engine_type === 'local') {
        const handedOver = await handOverManualTasks(deps.db, updated.name, {
          dispatchGoal: (id) => deps.fanOutService.dispatchGoal(id),
          dispatchTicket: (id) => deps.ticketService.dispatchTicket(id),
        });
        for (const taskId of handedOver) deps.broadcaster.broadcast({ type: 'task_updated', payload: { taskId } });
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
```

4. Right after the `registerHumanLoopRoutes(app, { … });` line:

```ts
  registerLocalEngineRoutes(app, { settingsService, broadcaster: deps.broadcaster, localEngine: deps.localEngine });
```

(`settingsService` is the local variable `createApp` already uses for `GET /api/settings`.)

- [ ] **Step 6: Merge gate frees the worktree before deleting a branch** — in `packages/server/src/services/mergeGate.ts`, add to `MergeGateOptions`:

```ts
  /** Free a task's agent worktree (Local AI CLI), so its merged branch can be deleted. */
  releaseWorktree?: (taskId: number) => boolean;
```

and replace the line `if (deleteBranches) git.deleteMergedBranch(p.repo, m.task.branch!, p.resultSha);` with:

```ts
        if (deleteBranches) {
          this.options.releaseWorktree?.(m.task.id);
          git.deleteMergedBranch(p.repo, m.task.branch!, p.resultSha);
        }
```

- [ ] **Step 7: Server entry point** — in `packages/server/src/index.ts`:

1. Add imports: `import { AgentRunner } from './localEngine/agentRunner.js';`.
2. Move `const settingsService = new SettingsService(db);` up to just after `const sprintService = new SprintService(db);` (and delete its later line).
3. After it, add:

```ts
// The Local AI CLI engine runs agents on this PC for repositories whose engine is 'local'.
const localEngine = new AgentRunner({
  db,
  projectService,
  settingsService,
  workspaceDir: WORKSPACE_DIR,
  bridgeUrl: `http://${HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST}:${PORT}`,
  agentToken: process.env.AGENT_TOKEN || undefined,
});
```

4. In `getAdapter`, change `return createAdapter(proj);` to `return createAdapter(proj, { local: localEngine });`.
5. Change the merge gate construction to `new MergeGateService(db, projectService, requirementService, reactor, { getAdapter, releaseWorktree: (taskId) => localEngine.releaseWorktree(taskId) });`.
6. In the `createApp({ … })` call add `localEngine,`.
7. In the `app.listen` callback, before `startScheduler(`, add `void localEngine.recoverOnStartup().then(() => localEngine.nudge());`, and add `['local-engine', () => localEngine.tick()],` to the scheduler job list.
8. Before `export { app, server };` add:

```ts
// Stop agents on the way out (npm run dev restarts on every server change); their runs continue
// from their branch when the server is back.
let exiting = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (exiting) return;
    exiting = true;
    void localEngine.shutdown().finally(() => process.exit(0));
  });
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/api/localEngineRoutes.test.ts && npm run typecheck && npx vitest run packages/server`
Expected: PASS, no type errors.

- [ ] **Step 9: Start-up smoke test on a spare port** (never touch the user's server on 4100)

```bash
source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null
SMOKE=$(mktemp -d)
(cd packages/server && PORT=4199 WORKSPACE_DIR="$SMOKE" npx tsx src/index.ts > "$SMOKE/server.log" 2>&1 & echo $! > "$SMOKE/pid")
sleep 6
curl -s localhost:4199/api/local-engine/status
curl -s -X PUT localhost:4199/api/settings/local-engine -H 'Content-Type: application/json' -d '{"maxParallel":3}'
kill -TERM "$(cat "$SMOKE/pid")"; sleep 2; tail -5 "$SMOKE/server.log"; rm -rf "$SMOKE"
```

Expected: the status JSON shows `"cli":"agy-cli"` or `"claude-cli"` (whatever is installed) and the counts; the PUT returns `maxParallel: 3`; the server exits on SIGTERM. Only the pid saved in `$SMOKE/pid` is signalled.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/localEngine/handover.ts packages/server/src/api/localEngineRoutes.ts packages/server/src/api/localEngineRoutes.test.ts packages/server/src/api/app.ts packages/server/src/services/mergeGate.ts packages/server/src/index.ts
git commit -m "feat(server): run the Local AI CLI engine in the server

Settings and live status routes, a scheduler job, recovery at start-up and
agent shutdown on SIGINT/SIGTERM. Switching a repository from Manual to Local
AI CLI hands its queued tasks to the engine. The merge gate frees a task's
worktree before deleting its merged branch.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Settings card and engine choice in the web app

**Files:**
- Create: `packages/web/src/lib/localEngineApi.ts`
- Create: `packages/web/src/lib/localEngineText.ts`
- Test: `packages/web/src/lib/localEngineText.test.ts`
- Create: `packages/web/src/components/LocalEngineSettingsSection.tsx`
- Modify: `packages/web/src/pages/SettingsPage.tsx` (insert before the `{/* 2. Git Branch & Merge Strategy */}` comment block, ~line 2016)
- Modify: `packages/web/src/pages/ProjectsPage.tsx` (the two engine `<select>`s, ~lines 982-990 and 1180-1188)

**Interfaces:**
- Consumes: routes from Task 11; shared types from Task 1; `BASE` from `packages/web/src/lib/api.ts`.
- Produces: `fetchLocalEngineSettings()`, `saveLocalEngineSettings(patch)`, `fetchLocalEngineStatus()`; `ENGINE_TYPE_OPTIONS`, `AGENT_CLI_CHOICES`, `localEngineDraftProblem(draft)`, `installBadge(cli)`, `limitBadge(cli, now?)`, `runCountsText(counts)`, `nextCliText(status)`; `<LocalEngineSettingsSection />`.

- [ ] **Step 1: Write the failing test** — `packages/web/src/lib/localEngineText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LocalEngineCliStatus, LocalEngineStatus } from '@sp-kickstack/shared';
import { ENGINE_TYPE_OPTIONS, installBadge, limitBadge, localEngineDraftProblem, nextCliText, runCountsText } from './localEngineText.js';

const draft = { enabled: true, agentCli: 'default' as const, maxParallel: 2, runTimeoutMinutes: 60, worktreeRoot: '' };
const cli = (over: Partial<LocalEngineCliStatus> = {}): LocalEngineCliStatus => ({ id: 'agy-cli', label: 'AGY', installed: true, enabled: true, pausedUntil: null, ...over });
const status = (over: Partial<LocalEngineStatus> = {}): LocalEngineStatus => ({
  enabled: true, cli: 'agy-cli', problem: null, clis: [cli()], counts: { running: 1, queued: 3, held: 0, rate_limited: 0 }, maxParallel: 2, worktreeRoot: '/w', ...over,
});

describe('Local AI CLI engine texts', () => {
  it('offers Manual, Stoneforge and Local AI CLI, and no Command', () => {
    expect(ENGINE_TYPE_OPTIONS.map((o) => o.label)).toEqual(['Manual', 'Stoneforge', 'Local AI CLI']);
  });

  it('checks a draft like the server does', () => {
    expect(localEngineDraftProblem(draft)).toBeNull();
    expect(localEngineDraftProblem({ ...draft, maxParallel: 0 })).toBe('Parallel agents must be a whole number from 1 to 8.');
    expect(localEngineDraftProblem({ ...draft, runTimeoutMinutes: 500 })).toBe('Time limit must be a whole number of minutes from 5 to 480.');
    expect(localEngineDraftProblem({ ...draft, worktreeRoot: 'agents' })).toBe('Worktree folder must be an absolute path, or empty for the default.');
    expect(localEngineDraftProblem({ ...draft, worktreeRoot: 'C:\\agents' })).toBeNull();
  });

  it('shows install and usage-limit badges', () => {
    const now = Date.parse('2026-10-13T10:00:00Z');
    expect(installBadge(cli())).toBe('Installed on PC');
    expect(installBadge(cli({ installed: false }))).toBe('Not Detected');
    expect(limitBadge(cli(), now)).toBe('HEALTHY');
    expect(limitBadge(cli({ pausedUntil: '2026-10-13T09:00:00Z' }), now)).toBe('HEALTHY');
    expect(limitBadge(cli({ pausedUntil: '2026-10-13T11:00:00Z' }), now)).toMatch(/^PAUSED until /);
  });

  it('says which CLI runs and how much is going on', () => {
    expect(nextCliText(status())).toBe('Agents run with AGY, at most 2 at a time.');
    expect(nextCliText(status({ enabled: false }))).toBe('Turned off: tasks wait in QUEUED.');
    expect(nextCliText(status({ cli: null, problem: 'No AI CLI that can edit code is installed' }))).toBe('No AI CLI that can edit code is installed');
    expect(runCountsText(status().counts)).toBe('1 running · 3 queued · 0 waiting for a person · 0 rate limited');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/web/src/lib/localEngineText.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Texts** — create `packages/web/src/lib/localEngineText.ts`:

```ts
import type { EngineType, LocalEngineCliStatus, LocalEngineSettings, LocalEngineStatus } from '@sp-kickstack/shared';

/** Engine choices for a repository (Command is gone: the server never accepted it). */
export const ENGINE_TYPE_OPTIONS: Array<{ value: EngineType; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'stoneforge', label: 'Stoneforge' },
  { value: 'local', label: 'Local AI CLI' },
];

export const AGENT_CLI_CHOICES: Array<{ value: LocalEngineSettings['agentCli']; label: string }> = [
  { value: 'default', label: 'Use AI default' },
  { value: 'claude-cli', label: 'Claude Code' },
  { value: 'agy-cli', label: 'AGY' },
  { value: 'codex-cli', label: 'Codex' },
];

/** What is wrong with a draft before saving (the server checks the same), or null. */
export function localEngineDraftProblem(draft: LocalEngineSettings): string | null {
  if (!Number.isInteger(draft.maxParallel) || draft.maxParallel < 1 || draft.maxParallel > 8) return 'Parallel agents must be a whole number from 1 to 8.';
  if (!Number.isInteger(draft.runTimeoutMinutes) || draft.runTimeoutMinutes < 5 || draft.runTimeoutMinutes > 480) {
    return 'Time limit must be a whole number of minutes from 5 to 480.';
  }
  const root = draft.worktreeRoot.trim();
  if (root && !(root.startsWith('/') || /^[A-Za-z]:[\\/]/.test(root))) return 'Worktree folder must be an absolute path, or empty for the default.';
  return null;
}

export function installBadge(cli: LocalEngineCliStatus): string {
  return cli.installed ? 'Installed on PC' : 'Not Detected';
}

/** HEALTHY, or PAUSED until hh:mm while a usage limit lasts. */
export function limitBadge(cli: LocalEngineCliStatus, now: number = Date.now()): string {
  if (!cli.pausedUntil || Date.parse(cli.pausedUntil) <= now) return 'HEALTHY';
  return `PAUSED until ${new Date(cli.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function runCountsText(counts: LocalEngineStatus['counts']): string {
  return `${counts.running} running · ${counts.queued} queued · ${counts.held} waiting for a person · ${counts.rate_limited} rate limited`;
}

/** Which CLI the next run uses, in words. */
export function nextCliText(status: LocalEngineStatus): string {
  if (!status.enabled) return 'Turned off: tasks wait in QUEUED.';
  if (!status.cli) return status.problem ?? 'No AI CLI can run.';
  const label = status.clis.find((c) => c.id === status.cli)?.label ?? status.cli;
  return `Agents run with ${label}, at most ${status.maxParallel} at a time.`;
}
```

- [ ] **Step 4: API calls** — create `packages/web/src/lib/localEngineApi.ts`:

```ts
import type { LocalEngineSettings, LocalEngineStatus } from '@sp-kickstack/shared';
import { BASE } from './api.js';

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function fetchLocalEngineSettings(): Promise<LocalEngineSettings> {
  return request(`${BASE}/settings/local-engine`);
}

export function saveLocalEngineSettings(patch: Partial<LocalEngineSettings>): Promise<LocalEngineSettings> {
  return request(`${BASE}/settings/local-engine`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function fetchLocalEngineStatus(): Promise<LocalEngineStatus> {
  return request(`${BASE}/local-engine/status`);
}
```

- [ ] **Step 5: The Settings card** — create `packages/web/src/components/LocalEngineSettingsSection.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import type { LocalEngineSettings } from '@sp-kickstack/shared';
import { fetchLocalEngineSettings, fetchLocalEngineStatus, saveLocalEngineSettings } from '../lib/localEngineApi.js';
import { AGENT_CLI_CHOICES, installBadge, limitBadge, localEngineDraftProblem, nextCliText, runCountsText } from '../lib/localEngineText.js';

const input =
  'w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200';
const fieldLabel = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1';
const badge = (good: boolean) =>
  `px-1.5 py-0.5 rounded text-[10px] font-bold ${good ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`;

/** Settings → AI & Local Engines: the engine that runs fan-out tasks with an AI CLI on this PC. */
export function LocalEngineSettingsSection() {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ['local-engine-settings'], queryFn: fetchLocalEngineSettings });
  const { data: status } = useQuery({ queryKey: ['local-engine-status'], queryFn: fetchLocalEngineStatus, refetchInterval: 3000 });
  const [draft, setDraft] = useState<LocalEngineSettings | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (settings: LocalEngineSettings) => saveLocalEngineSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(['local-engine-settings'], saved);
      setDraft(saved);
      void queryClient.invalidateQueries({ queryKey: ['local-engine-status'] });
      toast.success('Local AI CLI engine settings saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!draft) {
    return isError ? (
      <p className="text-xs text-rose-600 dark:text-rose-400">Could not load the Local AI CLI engine settings. Check that the server is running, then reload this page.</p>
    ) : (
      <p className="text-xs text-slate-500">Loading…</p>
    );
  }
  const problem = localEngineDraftProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const set = (patch: Partial<LocalEngineSettings>) => setDraft({ ...draft, ...patch });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Run agents on this PC</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Repositories with the Local AI CLI engine start their tasks by themselves after Start Fan-Out.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label="Run agents on this PC"
          onClick={() => set({ enabled: !draft.enabled })}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${draft.enabled ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${draft.enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div>
        <span className={fieldLabel} id="local-engine-cli">Agent CLI</span>
        <div role="radiogroup" aria-labelledby="local-engine-cli" className="flex flex-wrap gap-1.5">
          {AGENT_CLI_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={draft.agentCli === choice.value}
              onClick={() => set({ agentCli: choice.value })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                draft.agentCli === choice.value
                  ? 'border-[#7b68ee] bg-[#7b68ee]/10 text-[#7b68ee]'
                  : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className={fieldLabel}>Parallel agents (1–8)</span>
          <input type="number" min={1} max={8} className={input} value={draft.maxParallel} onChange={(e) => set({ maxParallel: Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Time limit per run (minutes)</span>
          <input type="number" min={5} max={480} className={input} value={draft.runTimeoutMinutes} onChange={(e) => set({ runTimeoutMinutes: Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Worktree folder</span>
          <input className={input} placeholder={status?.worktreeRoot ?? 'agent-worktrees in the server workspace'} value={draft.worktreeRoot} onChange={(e) => set({ worktreeRoot: e.target.value })} />
        </label>
      </div>

      {status && (
        <div className="rounded-xl border border-slate-200 dark:border-[#2e303d] p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{nextCliText(status)}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{runCountsText(status.counts)}</p>
          <ul className="space-y-1">
            {status.clis.map((c) => {
              const limit = limitBadge(c);
              return (
                <li key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    {c.label}
                    {c.enabled ? '' : ' (turned off)'}
                  </span>
                  <span className="flex gap-1.5">
                    <span className={badge(c.installed)}>{installBadge(c)}</span>
                    <span className={badge(limit === 'HEALTHY')}>{limit}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Each task runs in its own git worktree on its task branch; your own checkout is never touched. The agent's commands run as your
        user account: Codex is limited to the worktree, while Claude Code and AGY are told to stay in it but are not blocked from leaving it.
      </p>

      <div className="flex items-center justify-end gap-3">
        {problem && <span className="text-xs text-rose-600 dark:text-rose-400">{problem}</span>}
        <button
          type="button"
          disabled={!dirty || Boolean(problem) || save.isPending}
          onClick={() => save.mutate(draft)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7b68ee] hover:bg-[#6c5ce7] text-white text-xs font-bold shadow-md shadow-purple-500/20 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{save.isPending ? 'Saving...' : 'Save Local Engine'}</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Show it on the AI & Local Engines tab** — in `packages/web/src/pages/SettingsPage.tsx` add `import { LocalEngineSettingsSection } from '../components/LocalEngineSettingsSection.js';` next to the `NotificationSettingsSection` import, and insert directly before the lines

```tsx
          {/* ========================================================= */}
          {/* 2. Git Branch & Merge Strategy */}
```

this block:

```tsx
          {activeTab === 'ai' && (
            <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in-50 duration-150">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                <Bot className="w-5 h-5 text-[#7b68ee]" />
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">Local AI CLI engine</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Runs fan-out tasks with an AI CLI on this PC, each in its own copy of the repository.
                  </p>
                </div>
              </div>
              <LocalEngineSettingsSection />
            </div>
          )}

```

- [ ] **Step 7: Engine choice on the Projects page** — in `packages/web/src/pages/ProjectsPage.tsx` add `import { ENGINE_TYPE_OPTIONS } from '../lib/localEngineText.js';` and replace both occurrences (edit form and register form) of

```tsx
                    <option value="manual">Manual</option>
                    <option value="stoneforge">Stoneforge</option>
                    <option value="command">Command</option>
```

with

```tsx
                    {ENGINE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
```

- [ ] **Step 8: Test, typecheck and build the web app**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/web/src/lib/localEngineText.test.ts && npm run typecheck && npm run --workspace=@sp-kickstack/web build`
Expected: PASS, no type errors, the build succeeds.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/localEngineApi.ts packages/web/src/lib/localEngineText.ts packages/web/src/lib/localEngineText.test.ts packages/web/src/components/LocalEngineSettingsSection.tsx packages/web/src/pages/SettingsPage.tsx packages/web/src/pages/ProjectsPage.tsx
git commit -m "feat(web): Local AI CLI engine card in Settings and as a repository engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Desktop bundle and user guide

**Files:**
- Modify: `scripts/bundle-desktop-server.mjs`
- Regenerate: `packages/desktop/src-tauri/resources/server/index.mjs`, create `packages/desktop/src-tauri/resources/server/xticket.mjs`
- Modify: `docs/guide/02-projects-and-engines.md`, `docs/guide/05-answering-questions-and-notes.md`, `docs/guide/09-settings-and-environment.md`, `docs/guide/10-troubleshooting.md`, `docs/guide/settings-guide.md`

**Interfaces:**
- Consumes: `xticketCandidates()` looks for `xticket.mjs` next to the bundled server (Task 6).

- [ ] **Step 1: Bundle xticket next to the server** — in `scripts/bundle-desktop-server.mjs`, insert after `console.log('✅ Server JavaScript bundle created at resources/server/index.mjs');`:

```js
// Local AI CLI agents call xticket; the server finds it next to index.mjs (see localEngine/xticketLauncher.ts).
await esbuild.build({
  entryPoints: [path.join(rootDir, 'packages', 'xticket', 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(outDir, 'xticket.mjs'),
  sourcemap: false,
  minify: false,
});

console.log('✅ xticket CLI bundle created at resources/server/xticket.mjs');
```

- [ ] **Step 2: Regenerate and check the bundle**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npm run desktop:bundle-server && node packages/desktop/src-tauri/resources/server/xticket.mjs --help | head -3 && git diff --stat packages/desktop/src-tauri/resources/server/`
Expected: the bundle script logs both files; `xticket --help` prints `Usage: xticket <command> [options]`. In a worktree whose `node_modules` entries are symlinks, esbuild may write module comments as `../../../../Users/…/node_modules/…`; compare with `git show HEAD:packages/desktop/src-tauri/resources/server/index.mjs | grep -m3 '^// '` and rewrite such paths to the committed `node_modules/…` form (for example `sed -i '' -E 's#(\.\./)+Users/[^ ]*/node_modules/#node_modules/#g'` on both files) so the diff holds only real changes.

- [ ] **Step 3: Guide 02, engine types** — in `docs/guide/02-projects-and-engines.md` replace

```markdown
Only **Manual** and **Stoneforge** work today.

- The **Engine Type** list also shows **Command**. The server does not accept it: saving fails
  with a validation error that names `engine_type`.
- `clinekanban` is accepted when saving, but any work sent to it fails with
  `clinekanban adapter is not yet implemented`.
```

with

```markdown
Three engine types work: **Manual**, **Local AI CLI** and **Stoneforge**.

- `clinekanban` is accepted when saving, but any work sent to it fails with
  `clinekanban adapter is not yet implemented`.
```

and insert before `### Stoneforge`:

```markdown
### Local AI CLI

An AI CLI on this PC does the work: Claude Code, AGY or Codex, whichever **Settings → AI & Local
Engines → Local AI CLI engine** picks (by default the same CLI as your AI default). No engine URL is
needed.

After **Start Fan-Out**, each task of the repository moves by itself:

1. **QUEUED**: waiting for a free slot. At most 2 agents run at once (change it in Settings).
2. **IN PROGRESS**: the agent works in its own copy of the repository, a git worktree on the task
   branch (`req/<REQ-ID>/task-<id>`) in the `agent-worktrees` folder of the server workspace. Your own
   checkout is never touched. Open **Logs** on the task to watch it: its messages, the commands it
   runs (`→ Bash: npm test`) and the files it edits.
3. **IN REVIEW**: the agent finished and the branch has commits. Your merge policy takes over.

Other endings:

| The agent… | The task shows | What to do |
|---|---|---|
| finished without committing | NEEDS HUMAN, `Finished without committing anything` | Read **Logs**, then **Retry** or **Request changes** with more detail. |
| failed | FAILED, with the last lines of its output | Read **Logs**, then **Retry**. |
| ran longer than the time limit (60 minutes) | FAILED, `Stopped after the 60 minute time limit …` | Raise the limit in Settings or split the work, then **Retry**. |
| reached its CLI's usage limit | RATE LIMITED until the reset | Nothing: it continues by itself at the reset time. |
| asked you a question (`xticket ask`) | WAITING / HELD | Answer it; the agent continues with your answer. |

- **Notes** are saved and given to the agent when its next run starts (after an answer, a usage
  limit, **Retry** or **Request changes**). An agent that is running does not see them.
- **Model and effort** are passed to the CLI. Without a choice, the CLI's model and effort from
  Settings are used. A Claude model name such as `opus` may not exist in AGY or Codex; the run then
  fails with the CLI's own message.
- **Restarts**: if the server stops while agents run (for example `npm run dev` restarting after a
  code change), the agents are stopped and continue from their branch when the server is back.
- **Safety**: the agent's commands run as your user account. Codex is limited to the worktree;
  Claude Code and AGY are told to stay in it but are not blocked from leaving it.
- The worktree is removed once the task is COMPLETE or CANCELLED (kept while it has uncommitted
  changes).

### Switch a Manual repository to Local AI CLI

Tasks fanned out to a Manual repository wait until someone does the work. To let agents do it, edit
the repository (see [Edit or delete a project](#edit-or-delete-a-project)), set **Engine Type** to
**Local AI CLI** and save:

- Every QUEUED task of that repository goes to the local engine and starts within a few seconds.
- Tasks in other states (WAITING / HELD, IN REVIEW, COMPLETE, …) are left as they are.

Example: REQ-008 has tasks #8 (`backend`) and #9 (`frontend`) QUEUED on Manual. Switch `backend` and
`frontend` to **Local AI CLI**: both tasks move to IN PROGRESS (2 agents at once), and **Logs** shows
their work.
```

- [ ] **Step 4: Guide 05, notes** — in `docs/guide/05-answering-questions-and-notes.md`, under `### What happens next` of `## Send a note to a running agent`, add after the bullet that starts with `- The engine decides when the agent reads it.`:

```markdown
- **Local AI CLI** repositories: the note is saved and the agent reads it when its next run starts
  (after an answer, a usage limit, **Retry** or **Request changes**). An agent that is running now
  does not see it.
```

- [ ] **Step 5: Guide 09, settings** — in `docs/guide/09-settings-and-environment.md`, at the end of the **AI & Local Engines** row of the Settings tabs table (after `…(see [03](03-requirements-and-fan-out.md#choose-the-agent-model-and-effort)).`), append: ` The **Local AI CLI engine** card on this tab controls the agents of Local AI CLI repositories (see below).` Then insert before `### Git & Branch Rules`:

```markdown
### Local AI CLI engine

On **AI & Local Engines**, the **Local AI CLI engine** card controls the agents of repositories whose
engine is **Local AI CLI** (see [02](02-projects-and-engines.md#local-ai-cli)).

| Setting | Default | Meaning |
|---|---|---|
| **Run agents on this PC** | on | Off: tasks wait in QUEUED and the engine shows as Down. |
| **Agent CLI** | **Use AI default** | Which CLI runs agents. **Use AI default** follows the AI default above; when that is Ollama, the heuristic or Auto, the first installed and active of Claude Code, AGY and Codex is used. |
| **Parallel agents** | 2 | 1 to 8 agents at once, all workspaces together. |
| **Time limit per run** | 60 minutes | 5 to 480. A longer run is stopped and the task FAILS; **Retry** continues it. |
| **Worktree folder** | `agent-worktrees` in the server workspace | Where task copies are made: an absolute path, or empty for the default. |

Below the settings the card shows which CLI the next run uses; how many runs are running, queued,
waiting for a person and rate limited; and for each CLI **Installed on PC** / **Not Detected** and
**HEALTHY** / **PAUSED until …** (a usage limit). Click **Save Local Engine** to save.
```

- [ ] **Step 6: Guide 10, troubleshooting** — in `docs/guide/10-troubleshooting.md`, append these rows to the table under `## Messages about tasks`:

```markdown
| `Branch req/<REQ-ID>/task-<id> is checked out in <path>; switch that checkout to another branch, then Retry` | Local AI CLI: the agent needs its own worktree on the task branch, and git allows a branch in one checkout only. | Switch that checkout to another branch, then **Retry**. |
| `Local AI CLI needs a git repository: <path> is not the top of a git work tree` | The repository path is not the root of a git repository. | Fix **Repository Path**, or use the Manual engine. |
| `Finished without committing anything` | Local AI CLI: the agent ended without a commit on its branch. | Read **Logs**, then **Retry** or **Request changes** with clearer instructions. |
| `Stopped after the <n> minute time limit (Settings → AI & Local Engines)` | Local AI CLI: the run took longer than the limit. | Raise the limit or split the work, then **Retry**. |
| `Interrupted 3 times (the server stopped while the agent was running); Retry starts it again` | The server crashed three times during this run. | **Retry**. |
```

and insert before `## An engine stays Down`:

```markdown
## A Local AI CLI task stays QUEUED

Open **Settings → AI & Local Engines** and look at the **Local AI CLI engine** card:

- **Turned off: tasks wait in QUEUED.** Switch **Run agents on this PC** on and save.
- **No AI CLI that can edit code is installed and turned on**, or `<CLI> is chosen for the Local AI CLI
  engine but …`: install that CLI, turn it on in Step 1 of the tab, or pick another **Agent CLI**.
- **PAUSED until …** next to the CLI: a usage limit. Runs continue at that time.
- As many runs **running** as **Parallel agents**: the task waits for a free slot.

The repository's engine must be **Local AI CLI**. A task fanned out while the repository was Manual
starts when you switch it (see [02](02-projects-and-engines.md#switch-a-manual-repository-to-local-ai-cli)).
```

- [ ] **Step 7: settings-guide.md** — in `docs/guide/settings-guide.md` replace the sentence

```markdown
Run `claude` or `agy` in your terminal once. If it presents an interactive prompt without errors, SP-Kickstack will be able to dispatch headless tasks through it.
```

with

```markdown
Run `claude` or `agy` in your terminal once and sign in. Repositories whose engine is **Local AI CLI** then run their tasks through it headless (see the Local AI CLI Engine section above and [02 Projects and engines](02-projects-and-engines.md#local-ai-cli)).
```

and insert before `## 3. Module 2: Git & Branch Merge Strategy`:

```markdown
### 5. Local AI CLI Engine (Step 5)

The last card on this tab runs fan-out tasks with an AI CLI on this PC for repositories whose engine is
**Local AI CLI**: each task in its own git worktree on its task branch, at most **Parallel agents** (2)
at a time, stopped after **Time limit per run** (60 minutes). **Agent CLI** picks Claude Code, AGY or
Codex, or follows the default engine above. The card shows live **Installed on PC** / **Not Detected**
and **HEALTHY** / **PAUSED** badges per CLI and the number of running, queued, waiting and
rate-limited runs. Details: [09 Settings and environment](09-settings-and-environment.md#local-ai-cli-engine).
```

- [ ] **Step 8: Full verification**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npm run verify`
Expected: typecheck clean and every test passes (a known flaky test, `aiDraft.test` "lists provider status", may time out at 5 s; rerun it alone before treating it as a failure). Then run `graft build` (Rule D).

- [ ] **Step 9: Commit**

```bash
git add scripts/bundle-desktop-server.mjs packages/desktop/src-tauri/resources/server/index.mjs packages/desktop/src-tauri/resources/server/xticket.mjs docs/guide/02-projects-and-engines.md docs/guide/05-answering-questions-and-notes.md docs/guide/09-settings-and-environment.md docs/guide/10-troubleshooting.md docs/guide/settings-guide.md
git commit -m "docs: Local AI CLI engine in the user guide; build(desktop): bundle xticket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| New engine type, Repositories picker | 1, 10, 12 |
| `local_runs` table and status mapping | 2, 10 |
| `bridgeTaskId`; Stoneforge body unchanged | 10 |
| Dispatch, start (worktree, CLI choice, model/effort, prompt, environment, process group) | 4, 5, 6, 7 |
| Output → logs (2,000 chars, 5,000 lines, raw file) | 3, 7 |
| Exit order: cancel, hold, time limit, rate limit, non-zero, review, no_changes; uncommitted files listed | 7, 8 |
| Questions, answers, notes, Retry, cancel, time limit | 7, 8, 10 |
| Rate limits (reported reset, AGY quota, 15 min, ≤ 24 h, CLI paused, persists) | 2, 4, 8 |
| Restarts (clean shutdown not counted, crash recovery with pid + start time, 3 crashes) | 9, 11 |
| Worktree lifecycle and merge-gate release | 9, 11 |
| Manual hand-over | 11 |
| Settings + routes + live status (Rule B) | 1, 9, 11, 12 |
| Desktop: findCliBinary, xticket bundle, POSIX groups / taskkill | 4, 5, 6, 13 |
| Safety wording | 12, 13 |
| Testing with a fake CLI | 7–11 |
| Docs | 13 |
