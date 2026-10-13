# AI QA Agent (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a requirement enters QA, an AI agent checks each repository's merged code (acceptance criteria, code review, test / build / lint) and records what it finds as open review comments marked **AI QA**; the person decides what to send back.

**Architecture:**
- **QA tasks.** Each git repository of the requirement gets a QA task: a `bridge_tasks` row with `role = 'qa'` and no engine id.
- **Running.** The existing Local AI CLI runner (`AgentRunner`) runs each QA task. It uses a temporary detached checkout of the commit to check, its own prompt (`localEngine/qaPrompt.ts`) and its own finish rules. The QA task's status follows its run.
- **`QaService`** does four things:
  - it creates QA tasks, from the merge gate's new `onEnteredQa` hook or from the **Run AI QA** button;
  - it turns the agent's `xticket comment` / `xticket qa-result` reports into review comments and a result, whether they arrive over HTTP or through the outbox;
  - it refuses reports once the requirement has left QA;
  - it reports the header status.
- **Web:**
  - the requirement header gets the status and the **Run AI QA** button;
  - findings get an **AI QA · severity** badge;
  - Settings gets an **AI QA** card;
  - Projects gets **Build Command** and **Lint Command** fields.

**Tech Stack:** TypeScript, Express, better-sqlite3, zod 3, Node child processes, React 18, TanStack Query v5, Radix Popover, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-ai-qa-agent-design.md` (approved 2026-10-13). Phase 1 = everything in the spec except "trying the app" (start command, App URL, prompt step 4).

## Global Constraints

- **Node.js v22.19.0** for every command: `source ~/.nvm/nvm.sh && nvm use 22.19.0`. Node 24 breaks `better-sqlite3`.
- **Shared checkout.** Another session edits this checkout.
  - Commit exactly the paths a task lists. Never use `git add -A`.
  - When a listed file also holds someone else's uncommitted edits, commit HEAD plus this task's hunks only (a temporary index).
  - Verify on HEAD plus this task's files in an isolated worktree.
- **Migration number.** Use the next free one.
  - It is **11**, unless the AI Chat MCP plan (`docs/superpowers/plans/2026-10-13-ai-chat-mcp-skills.md`) landed first and took 11.
  - In that case use **12**, in Task 1's migration and in its test.
- **Rebuild shared after every shared change.** The server, the web typecheck and the user's running dev server read `@sp-kickstack/shared` from `packages/shared/dist`.
  - Rebuild with `(cd packages/shared && npx tsc -p .)` before running server or web checks.
- **Tests never contact a running bridge.**
  - The user's dev server listens on `127.0.0.1:4100`, which is also the test harness's `XTICKET_URL`.
  - So the fake agent reports through the outbox file, the way `xticket` does when the bridge is unreachable.
- **Never stop processes by pattern.** The user's dev server runs from this checkout on ports 4100 and 4101.
- **Copy, verbatim from the spec:**
  - `No AI CLI can run QA: …`
  - `No QA run …` (404)
  - `<REQ> is no longer in QA; this finding was not saved` (409)
  - `The QA run reached its limit of N findings` (409)
  - `AI QA is already running for <REQ>` (409)
  - `skipped <project>: not a git repository`
  - "finished without a result", stored as `Finished without a result`
  - Header lines: `AI QA running… (backend ✓, frontend …)`, `AI QA: 3 findings (1 blocker)`, `AI QA passed`, `AI QA failed: <reason>`
  - Badge: `AI QA · blocker` / `AI QA · major` / `AI QA · minor`
- **AI QA defaults (plan decision for the ranges):**

  | Setting | Default | Range |
  |---|---|---|
  | Run automatically | on | — |
  | CLI, model, effort | the Local AI CLI engine's | — |
  | Time limit per QA run | 30 minutes | 5–240 |
  | Maximum findings per QA run | 30 | 1–200 |

- **Project rules:**
  - **Rule A:** regenerate the desktop server bundle at the end (Task 9).
  - **Rule B:** settings go in `schemas.ts` / `types.ts` and are saved by `SettingsService` under `ai_qa_settings`. The card shows live CLI badges.
  - **Rule C:** the header's per-repository list is a Radix Popover.
  - **Rule G:** AI QA never creates, pushes or deletes a branch (detached checkout only).
- **Phase 2 is out of scope:** start command, App URL and trying the app.

## Review Focus

These five cases are implied by the spec but not covered by its testing list. Each one has a test in the task named after it.

1. **Merged branches already deleted.** Settings → Git can delete merged branches. The QA prompt must still list the requirement's changed files, read from the merge commits rather than the branches.
   - Test: Task 5, `lists changed files from the merge commits after the branches are deleted`.
2. **A requirement with a target branch.** **Run AI QA** checks the tip of the target branch, not the repository's base branch.
   - Test: Task 5, `checks the tip of the requirement's target branch`.
3. **A finding that arrives late through the outbox,** after the requirement left QA (Request changes). The file goes to `failed/` with the reason and is not retried every tick.
   - Test: Task 5, `rejects a late outbox finding once the requirement left QA`.
4. **Marking a requirement Done while AI QA runs.** This is allowed, because QA tasks are not work, and the QA run stops.
   - Test: Task 4, `a requirement can be marked done while AI QA runs, and the run stops`.
5. **A requirement that changed hundreds of files.** The prompt lists at most 200 of them and says how many more there are.
   - Test: Task 3, `lists at most 200 changed files and says how many more`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/schemas.ts`, `types.ts` | AI QA settings, finding / result inputs, `TaskRole` `'qa'`, QA fields on tasks, comments and projects, `RequirementQa` |
| `packages/server/src/db/migrations.ts` | Migration 11: comment `source` / `severity` / `qa_task_id`, task `qa_passed` / `qa_summary`, project `build_command` / `lint_command` |
| `packages/server/src/services/settingsService.ts` | `getAiQaSettings` / `updateAiQaSettings` |
| `packages/server/src/services/projectService.ts` | Persist build / lint commands |
| `packages/server/src/services/reviewService.ts` | Comments carry `source` and `severity` |
| `packages/server/src/api/localEngineRoutes.ts` | `GET/PUT /api/settings/ai-qa` |
| `packages/xticket/src/qa.ts` (new), `cli.ts`, `submit.ts` | `xticket comment`, `xticket qa-result`, outbox names |
| `packages/server/src/localEngine/qaPrompt.ts` (new) | `acceptanceCriteria`, `buildQaPrompt` |
| `packages/server/src/localEngine/worktrees.ts` | `checkoutDetached` |
| `packages/server/src/localEngine/runStore.ts`, `adapters/localCliAdapter.ts` | Run status `done` |
| `packages/server/src/localEngine/agentRunner.ts` | QA runs: detached checkout, prompt, time limit, finish, task status follows the run, stop when the requirement leaves QA |
| `packages/server/src/services/qaService.ts` (new) | Start QA, findings, result, header status |
| `packages/server/src/watcher/outboxScanner.ts` | `qa-comment` / `qa-result` outbox files |
| `packages/server/src/testing/fakeAgentCli.mjs`, `localEngineFixture.ts` | `FAKE: where`, `FAKE: qa-comment`, `FAKE: qa-result`; `queueQaRun` |
| `packages/server/src/services/mergeGate.ts` | `onEnteredQa` hook with each merged commit |
| `packages/server/src/api/humanLoopRoutes.ts`, `app.ts`, `index.ts` | QA routes, graph excludes QA tasks, wiring |
| `packages/web/src/lib/aiQa.ts`, `aiQaApi.ts` (new) | Header / badge / settings helpers and API calls |
| `packages/web/src/components/AiQaHeader.tsx` (new) | Status popover, logs, **Run AI QA** |
| `packages/web/src/components/AiQaSettingsSection.tsx` (new) | Settings → AI & Local Engines → AI QA card |
| `packages/web/src/components/ReviewComments.tsx` | AI QA badge |
| `packages/web/src/components/RequirementDetailSheet.tsx`, `pages/RequirementDetailPage.tsx` | Header placement |
| `packages/web/src/pages/SettingsPage.tsx`, `pages/ProjectsPage.tsx` | Card placement; Build / Lint fields |
| `docs/guide/02`, `06`, `09`, `10` | Docs |

---

### Task 1: Data: shared types, migration, settings, project commands, comment source

**Files:**
- Modify: `packages/shared/src/schemas.ts` (ProjectSchema at `:159`; add after `UpdateLocalEngineSettingsInputSchema` at `:464`)
- Modify: `packages/shared/src/types.ts` (`TaskRole` `:30`, `Project` `:136`, `BridgeTask` `:185-224`, `LocalEngineSettings` `:361`, `ReviewComment` `:586`)
- Create: `packages/shared/src/aiQa.test.ts`
- Modify: `packages/server/src/db/migrations.ts`, `packages/server/src/db/migrations.test.ts:52`
- Modify: `packages/server/src/services/settingsService.ts`
- Create: `packages/server/src/services/aiQaSettings.test.ts`
- Modify: `packages/server/src/services/projectService.ts`, `packages/server/src/services/projectService.test.ts`
- Modify: `packages/server/src/services/reviewService.ts:40-51`, `packages/server/src/services/review.test.ts:94`
- Modify: `packages/server/src/api/localEngineRoutes.ts`, `packages/server/src/api/localEngineRoutes.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact names):
  - `AiQaSettings` = `{ runAutomatically: boolean; agentCli: 'default' | AgentCliId; model: string | null; effort: ReasoningEffort | null; timeLimitMinutes: number; maxFindings: number }`.
  - `SettingsService.getAiQaSettings(): AiQaSettings` and `SettingsService.updateAiQaSettings(updates: unknown): AiQaSettings`.
  - `QaFindingInputSchema` parses to `{ severity: QaSeverity; title: string; body: string; file_path?: string; line?: number }`.
  - `QaResultInputSchema` parses to `{ passed: boolean; summary: string }`.
  - `QaSeverity = 'blocker' | 'major' | 'minor'` and `ReviewCommentSource = 'person' | 'ai-qa'`. `ReviewComment` gains `source` and `severity: QaSeverity | null`.
  - `TaskRole` gains `'qa'`. `BridgeTask` gains `qa_passed?: number | null` and `qa_summary?: string | null`.
  - `Project` gains `build_command?` and `lint_command?` (both `string | null`).
  - `QaRunView` = `{ task: BridgeTask; project: string; status: NormStatus; passed: boolean | null; summary: string | null; error: string | null; findings: number }`.
  - `RequirementQa` = `{ reqId: string; round: number; running: boolean; runs: QaRunView[]; skipped: Array<{ project: string; reason: string }>; findings: { total: number; blocker: number; major: number; minor: number } }`.
  - DB columns: `review_comments.source` / `severity` / `qa_task_id`, `bridge_tasks.qa_passed` / `qa_summary`, `projects.build_command` / `lint_command`.
  - Routes: `GET /api/settings/ai-qa` and `PUT /api/settings/ai-qa`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/aiQa.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AiQaSettingsSchema, ProjectSchema, QaFindingInputSchema, QaResultInputSchema, UpdateAiQaSettingsInputSchema } from './schemas.js';

describe('AI QA schemas', () => {
  it('defaults the AI QA settings', () => {
    expect(AiQaSettingsSchema.parse({})).toEqual({
      runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
    });
  });

  it('refuses out-of-range limits, unknown CLIs, bad model ids and unknown fields', () => {
    expect(() => UpdateAiQaSettingsInputSchema.parse({ timeLimitMinutes: 4 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ timeLimitMinutes: 241 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ maxFindings: 0 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ agentCli: 'ollama' })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ model: 'opus; rm -rf /' })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ other: 1 })).toThrow();
    expect(UpdateAiQaSettingsInputSchema.parse({ model: 'opus', effort: 'high' })).toEqual({ model: 'opus', effort: 'high' });
  });

  it('reads a finding: severity, one-line title, optional body, file and line', () => {
    expect(
      QaFindingInputSchema.parse({ severity: 'major', title: ' Missing check ', file_path: 'src/a.ts', line: 3, project: 'backend', engineTaskId: 'local-1' })
    ).toEqual({ severity: 'major', title: 'Missing check', body: '', file_path: 'src/a.ts', line: 3 });
    expect(() => QaFindingInputSchema.parse({ severity: 'critical', title: 'Missing check' })).toThrow();
    expect(() => QaFindingInputSchema.parse({ severity: 'minor', title: 'ab' })).toThrow();
    expect(() => QaFindingInputSchema.parse({ severity: 'minor', title: 'Two\nlines' })).toThrow();
  });

  it('reads a QA result', () => {
    expect(QaResultInputSchema.parse({ passed: false, summary: ' 1 blocker ' })).toEqual({ passed: false, summary: '1 blocker' });
    expect(() => QaResultInputSchema.parse({ passed: true, summary: '' })).toThrow();
  });

  it('keeps build and lint commands on a project', () => {
    const base = { name: 'backend', repo_path: '/r', engine_type: 'manual' };
    expect(ProjectSchema.parse({ ...base, build_command: 'npm run build', lint_command: 'npm run lint' })).toMatchObject({
      build_command: 'npm run build', lint_command: 'npm run lint',
    });
  });
});
```

`packages/server/src/services/aiQaSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { SettingsService } from './settingsService.js';

describe('AI QA settings', () => {
  it('starts with the defaults and saves partial updates', () => {
    const db = initDatabase(':memory:');
    const settings = new SettingsService(db);
    expect(settings.getAiQaSettings()).toEqual({
      runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
    });
    expect(settings.updateAiQaSettings({ runAutomatically: false, agentCli: 'codex-cli', timeLimitMinutes: 45 })).toMatchObject({
      runAutomatically: false, agentCli: 'codex-cli', timeLimitMinutes: 45, maxFindings: 30,
    });
    expect(new SettingsService(db).getAiQaSettings()).toMatchObject({ runAutomatically: false, agentCli: 'codex-cli' });
    db.close();
  });

  it('refuses bad values and keeps what was saved', () => {
    const db = initDatabase(':memory:');
    const settings = new SettingsService(db);
    settings.updateAiQaSettings({ maxFindings: 10 });
    expect(() => settings.updateAiQaSettings({ maxFindings: 500 })).toThrow();
    expect(settings.getAiQaSettings().maxFindings).toBe(10);
    db.close();
  });
});
```

In `packages/server/src/db/migrations.test.ts`:
- Change line 52 to `expect(LATEST_VERSION).toBe(11);`.
- Add this test after the first `it(...)` (`brings a fresh database to the latest version…`):

```ts
  it('adds the AI QA columns (migration 11)', () => {
    const db = initDatabase(':memory:');
    expect(columns(db, 'review_comments')).toEqual(expect.arrayContaining(['source', 'severity', 'qa_task_id']));
    expect(columns(db, 'bridge_tasks')).toEqual(expect.arrayContaining(['qa_passed', 'qa_summary']));
    expect(columns(db, 'projects')).toEqual(expect.arrayContaining(['build_command', 'lint_command']));
    db.close();
  });
```

Append to `packages/server/src/services/projectService.test.ts`:

```ts
describe('ProjectService build and lint commands', () => {
  it('stores, returns and clears them', () => {
    const db = initDatabase(':memory:');
    const projects = new ProjectService(db);
    projects.registerProject({ name: 'backend', repo_path: '/r', engine_type: 'manual', build_command: 'npm run build', lint_command: 'npm run lint' });
    expect(projects.getProject('backend')).toMatchObject({ build_command: 'npm run build', lint_command: 'npm run lint' });

    projects.updateProject('backend', { lint_command: null });
    expect(projects.getProject('backend')!.lint_command ?? null).toBeNull();
    expect(projects.getProject('backend')!.build_command).toBe('npm run build');
    db.close();
  });
});
```

In `packages/server/src/services/review.test.ts`, test `adds, edits, resolves, reopens and deletes comments`, extend the first `toMatchObject` with `source: 'person', severity: null`:

```ts
    expect(c).toMatchObject({ req_id: req.id, task_id: goals[0].id, project: 'backend', file_path: 'src/a.ts', line: 3, body: 'Rename this', state: 'open', round: null, source: 'person', severity: null });
```

Add to `packages/server/src/api/localEngineRoutes.test.ts`, inside `describe('Local AI CLI engine routes', …)`:

```ts
  it('reads and saves the AI QA settings, refusing bad values with the field name', async () => {
    const h = makeE2E();
    const app = appFor(h);
    expect((await testRequest(app, 'GET', '/api/settings/ai-qa')).body).toMatchObject({ runAutomatically: true, timeLimitMinutes: 30, maxFindings: 30 });
    expect(await testRequest(app, 'PUT', '/api/settings/ai-qa', { body: { maxFindings: 12 } })).toMatchObject({ status: 200, body: { maxFindings: 12 } });
    const refused = await testRequest(app, 'PUT', '/api/settings/ai-qa', { body: { timeLimitMinutes: 1 } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('timeLimitMinutes');
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/shared/src/aiQa.test.ts packages/server/src/services/aiQaSettings.test.ts packages/server/src/db/migrations.test.ts packages/server/src/services/projectService.test.ts packages/server/src/services/review.test.ts packages/server/src/api/localEngineRoutes.test.ts`

Expected: FAIL, with these reasons:
- `AiQaSettingsSchema` is undefined;
- `settings.getAiQaSettings is not a function`;
- `LATEST_VERSION` is 10;
- the AI QA columns are missing;
- `build_command` is undefined;
- `source` is undefined;
- `GET /api/settings/ai-qa` answers 404.

- [ ] **Step 3: Shared schemas** (`packages/shared/src/schemas.ts`)

In `ProjectSchema`, after the `test_command` line (`:159`):

```ts
  /** AI QA: shell commands the QA agent runs in its checkout (optional). */
  build_command: z.string().max(2000).optional().nullable(),
  lint_command: z.string().max(2000).optional().nullable(),
```

After `export const UpdateLocalEngineSettingsInputSchema = …` (`:464`):

```ts
/** Settings → AI & Local Engines → AI QA. */
export const AiQaSettingsSchema = z.object({
  runAutomatically: z.boolean().default(true),
  agentCli: z.enum(['default', 'claude-cli', 'agy-cli', 'codex-cli']).default('default'),
  model: AgentModelSchema.nullable().default(null),
  effort: ReasoningEffortSchema.nullable().default(null),
  timeLimitMinutes: z.number().int().min(5).max(240).default(30),
  maxFindings: z.number().int().min(1).max(200).default(30),
});

export const UpdateAiQaSettingsInputSchema = AiQaSettingsSchema.partial().strict();

export const QaSeveritySchema = z.enum(['blocker', 'major', 'minor']);

/** `xticket comment` from an AI QA run; project / engineTaskId (the run) are read separately. */
export const QaFindingInputSchema = z.object({
  severity: QaSeveritySchema,
  title: z.string().trim().min(3).max(200).regex(/^[^\r\n]*$/, 'must be one line'),
  body: z.string().max(8000).default(''),
  file_path: z.string().trim().min(1).max(300).optional(),
  line: z.number().int().positive().optional(),
});

/** `xticket qa-result`: the QA run's verdict. */
export const QaResultInputSchema = z.object({
  passed: z.boolean(),
  summary: z.string().trim().min(1).max(4000),
});
```

- [ ] **Step 4: Shared types** (`packages/shared/src/types.ts`)

Change `TaskRole` (`:30`):

```ts
export type TaskRole = 'goal' | 'ticket' | 'waiting' | 'question' | 'qa';
```

In `Project`, after `test_command?: string | null;`:

```ts
  build_command?: string | null;
  lint_command?: string | null;
```

In `BridgeTask`, after `effort_override?: ReasoningEffort | null;`:

```ts
  /** role 'qa': the agent's verdict from `xticket qa-result` (1 passed, 0 found problems, null none yet). */
  qa_passed?: number | null;
  /** role 'qa': the agent's summary, or "Finished without a result". */
  qa_summary?: string | null;
```

After the `LocalEngineSettings` interface:

```ts
/** Settings → AI & Local Engines → AI QA. */
export interface AiQaSettings {
  /** Start AI QA when the merge gate moves a requirement to QA. */
  runAutomatically: boolean;
  /** 'default' = the Local AI CLI engine's CLI. */
  agentCli: 'default' | AgentCliId;
  /** null = the engine's model / effort. */
  model: string | null;
  effort: ReasoningEffort | null;
  /** A QA run longer than this is stopped (5-240). */
  timeLimitMinutes: number;
  /** Findings saved per QA run at most (1-200). */
  maxFindings: number;
}
```

Just before `export interface ReviewComment`:

```ts
export type ReviewCommentSource = 'person' | 'ai-qa';
export type QaSeverity = 'blocker' | 'major' | 'minor';
```

In `ReviewComment`, after `state: ReviewCommentState;`:

```ts
  /** Who wrote it: a person, or the AI QA agent (with a severity). */
  source: ReviewCommentSource;
  severity: QaSeverity | null;
```

After the `ReviewComment` interface:

```ts
/** One repository's AI QA run, for the requirement header. */
export interface QaRunView {
  /** The QA task (its log opens in the task log drawer). */
  task: BridgeTask;
  project: string;
  status: NormStatus;
  passed: boolean | null;
  summary: string | null;
  error: string | null;
  findings: number;
}

/** The requirement header's AI QA status: the latest QA round. */
export interface RequirementQa {
  reqId: string;
  /** 0 = AI QA never ran for this requirement. */
  round: number;
  running: boolean;
  runs: QaRunView[];
  skipped: Array<{ project: string; reason: string }>;
  findings: { total: number; blocker: number; major: number; minor: number };
}
```

- [ ] **Step 5: Migration 11**

Append to the `MIGRATIONS` array in `packages/server/src/db/migrations.ts`:

```ts
  {
    version: 11,
    name: 'AI QA: finding source and severity on review comments, QA results on tasks, build and lint commands',
    up: (db) => {
      addColumn(db, 'review_comments', 'source', "TEXT NOT NULL DEFAULT 'person'");
      addColumn(db, 'review_comments', 'severity', 'TEXT');
      addColumn(db, 'review_comments', 'qa_task_id', 'INTEGER');
      addColumn(db, 'bridge_tasks', 'qa_passed', 'INTEGER');
      addColumn(db, 'bridge_tasks', 'qa_summary', 'TEXT');
      addColumn(db, 'projects', 'build_command', 'TEXT');
      addColumn(db, 'projects', 'lint_command', 'TEXT');
    },
  },
```

`qa_task_id` is not named in the spec, but it is needed for two spec rules: "the same finding (same QA task…) is saved once" and "at most N findings per QA task".

- [ ] **Step 6: SettingsService**

In `packages/server/src/services/settingsService.ts`, add `AiQaSettings, AiQaSettingsSchema, UpdateAiQaSettingsInputSchema` to the `@sp-kickstack/shared` import. Then add these methods after `updateLocalEngineSettings`:

```ts
  public getAiQaSettings(): AiQaSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'ai_qa_settings'").get() as { value: string } | undefined;
    if (row) {
      try {
        return AiQaSettingsSchema.parse(JSON.parse(row.value));
      } catch {
        // Fallback to defaults
      }
    }
    return AiQaSettingsSchema.parse({});
  }

  /** Partial update; unknown fields and out-of-range values are refused (400 through the API). */
  public updateAiQaSettings(updates: unknown): AiQaSettings {
    const patch = UpdateAiQaSettingsInputSchema.parse(updates ?? {});
    const updated = AiQaSettingsSchema.parse({ ...this.getAiQaSettings(), ...patch });
    this.db
      .prepare(`
        INSERT INTO settings (key, value) VALUES ('ai_qa_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(JSON.stringify(updated));
    return updated;
  }
```

- [ ] **Step 7: ProjectService persists the commands**

In `packages/server/src/services/projectService.ts`, `registerProject`:
- **Column list:** `base_branch, contract_path, done_means, high_risk_paths, test_command,` → `base_branch, contract_path, done_means, high_risk_paths, test_command, build_command, lint_command,`.
- **Values:** `@base_branch, @contract_path, @done_means, @high_risk_paths, @test_command,` → `@base_branch, @contract_path, @done_means, @high_risk_paths, @test_command, @build_command, @lint_command,`.
- **`ON CONFLICT` list:** after `test_command = excluded.test_command,` add:

```sql
        build_command = excluded.build_command,
        lint_command = excluded.lint_command,
```

- **`stmt.run({...})` object:** after `test_command: validated.test_command || null,` add:

```ts
      build_command: validated.build_command || null,
      lint_command: validated.lint_command || null,
```

In `updateProject`:
- **`UPDATE` statement:** after `test_command = @test_command,` add `build_command = @build_command,` and `lint_command = @lint_command,`.
- **`.run({...})` object:** add the same two `|| null` lines as above.

- [ ] **Step 8: Comments carry their source**

In `packages/server/src/services/reviewService.ts`, replace `CommentRow` and `toComment` (`:40-51`):

```ts
type CommentRow = {
  id: number; req_id: string; task_id: number; project: string; file_path: string | null; line: number | null;
  body_md: string; state: ReviewComment['state']; round: number | null; created_at: string; updated_at: string; sent_at: string | null;
  source: ReviewComment['source'] | null; severity: ReviewComment['severity'];
};

function toComment(row: CommentRow, attachments: ReviewComment['attachments'] = []): ReviewComment {
  return {
    id: row.id, req_id: row.req_id, task_id: row.task_id, project: row.project, file_path: row.file_path, line: row.line,
    body: row.body_md, state: row.state, round: row.round, created_at: row.created_at, updated_at: row.updated_at, sent_at: row.sent_at,
    source: row.source ?? 'person', severity: row.severity ?? null, attachments,
  };
}
```

- [ ] **Step 9: Settings routes**

In `packages/server/src/api/localEngineRoutes.ts`, add inside `registerLocalEngineRoutes`, after the `PUT /api/settings/local-engine` route:

```ts
  app.get('/api/settings/ai-qa', (_req, res) => {
    res.json(deps.settingsService.getAiQaSettings());
  });

  app.put('/api/settings/ai-qa', (req, res, next) => {
    try {
      const updated = deps.settingsService.updateAiQaSettings(req.body);
      deps.broadcaster.broadcast({ type: 'settings_updated', payload: { ai_qa: updated } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **Step 10: Run the tests and watch them pass**

Run: `(cd packages/shared && npx tsc -p .) && npx vitest run packages/shared/src packages/server/src/services/aiQaSettings.test.ts packages/server/src/db packages/server/src/services/projectService.test.ts packages/server/src/services/review.test.ts packages/server/src/api/localEngineRoutes.test.ts && npx tsc --noEmit -p packages/server`

Expected: PASS, with no type errors.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/types.ts packages/shared/src/aiQa.test.ts packages/server/src/db/migrations.ts packages/server/src/db/migrations.test.ts packages/server/src/services/settingsService.ts packages/server/src/services/aiQaSettings.test.ts packages/server/src/services/projectService.ts packages/server/src/services/projectService.test.ts packages/server/src/services/reviewService.ts packages/server/src/services/review.test.ts packages/server/src/api/localEngineRoutes.ts packages/server/src/api/localEngineRoutes.test.ts
git commit -m "feat: AI QA data (settings, migration 11, finding source and severity, build and lint commands)"
```

- [ ] **Step 12: Keep the user's dev server running**

The dev server (tsx watch) restarts on the server change and imports the new shared exports from `packages/shared/dist`.

Run: `(cd packages/shared && npx tsc -p .) && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" localhost:4100/api/health`

Expected: `200`. This must run in the main checkout, which the dev server runs from. If the server is not running, note that in the ledger.

---
### Task 2: `xticket comment` and `xticket qa-result`

**Files:**
- Create: `packages/xticket/src/qa.ts`
- Create: `packages/xticket/src/qa.test.ts`
- Modify: `packages/xticket/src/cli.ts`
- Modify: `packages/xticket/src/submit.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. The bridge routes arrive in Task 6; the outbox kinds are read by Task 5.
- Produces:
  - `parseCommentArgs(argv: string[], env: NodeJS.ProcessEnv): { payload: Record<string, unknown> } | { error: string }`. The payload is `{ kind: 'qa-comment', severity, title, body, file_path?, line?, project, engineTaskId }`.
  - `parseQaResultArgs(argv, env)`, same return type. The payload is `{ kind: 'qa-result', passed, summary, project, engineTaskId }`.
  - Outbox files are named `qa-comment-<ts>-<rand>.json` and `qa-result-<ts>-<rand>.json`.
  - Endpoints: `/api/agent/qa/comments` and `/api/agent/qa/result`.

- [ ] **Step 1: Write the failing tests** (`packages/xticket/src/qa.test.ts`)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCommentArgs, parseQaResultArgs } from './qa.js';
import { submitTicket } from './submit.js';

const env = { XTICKET_PROJECT: 'backend', XTICKET_TASK: 'local-1' } as NodeJS.ProcessEnv;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xticket-qa-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('xticket comment', () => {
  it('builds a finding with the run identity', () => {
    expect(
      parseCommentArgs(['--severity', 'blocker', '--file', 'src/rides.ts', '--line', '12', '--title', 'Rides are not saved', '--body', 'POST /rides answers 500'], env)
    ).toEqual({
      payload: {
        kind: 'qa-comment', severity: 'blocker', title: 'Rides are not saved', body: 'POST /rides answers 500',
        file_path: 'src/rides.ts', line: 12, project: 'backend', engineTaskId: 'local-1',
      },
    });
  });

  it('reads the body from a file and leaves out a missing file', () => {
    const file = path.join(tmp, 'body.md');
    fs.writeFileSync(file, 'Steps:\n1. POST /rides');
    const parsed = parseCommentArgs(['--severity', 'minor', '--title', 'Naming', '--body-file', file], env);
    expect(parsed).toMatchObject({ payload: { body: 'Steps:\n1. POST /rides' } });
    expect('payload' in parsed && 'file_path' in parsed.payload).toBe(false);
  });

  it('explains what is wrong', () => {
    expect(parseCommentArgs(['--title', 'Missing check'], env)).toEqual({ error: '--severity must be blocker, major or minor' });
    expect(parseCommentArgs(['--severity', 'huge', '--title', 'Missing check'], env)).toEqual({ error: '--severity must be blocker, major or minor' });
    expect(parseCommentArgs(['--severity', 'major'], env)).toEqual({ error: '--title is required (one line, at least 3 characters)' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Two\nlines'], env)).toEqual({ error: '--title must be one line; put details in --body' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--line', '4'], env)).toEqual({ error: '--line needs --file' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--file', 'a.ts', '--line', 'x'], env)).toEqual({ error: '--line must be a whole number from 1' });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--body-file', path.join(tmp, 'nope.md')], env)).toEqual({
      error: expect.stringMatching(/^Error reading --body-file:/),
    });
    expect(parseCommentArgs(['--severity', 'major', '--title', 'Missing check', '--colour', 'red'], env)).toEqual({ error: expect.stringContaining('--colour') });
  });
});

describe('xticket qa-result', () => {
  it('builds the verdict with the run identity', () => {
    expect(parseQaResultArgs(['--failed', '--summary', '1 blocker'], env)).toEqual({
      payload: { kind: 'qa-result', passed: false, summary: '1 blocker', project: 'backend', engineTaskId: 'local-1' },
    });
    expect(parseQaResultArgs(['--passed', '--summary', 'All criteria met'], env)).toMatchObject({ payload: { passed: true } });
  });

  it('needs exactly one verdict and a summary', () => {
    expect(parseQaResultArgs(['--summary', 'x'], env)).toEqual({ error: 'Give exactly one of --passed or --failed' });
    expect(parseQaResultArgs(['--passed', '--failed', '--summary', 'x'], env)).toEqual({ error: 'Give exactly one of --passed or --failed' });
    expect(parseQaResultArgs(['--passed'], env)).toEqual({ error: '--summary is required' });
  });
});

describe('xticket QA reports through the outbox', () => {
  it('queues a finding as qa-comment-*.json when the bridge cannot be reached', async () => {
    const outboxDir = path.join(tmp, 'outbox');
    const parsed = parseCommentArgs(['--severity', 'minor', '--title', 'Naming'], env);
    if (!('payload' in parsed)) throw new Error(parsed.error);
    const r = await submitTicket(parsed.payload, {
      bridgeUrl: 'http://b', outboxDir, endpoint: '/api/agent/qa/comments',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout!)).toMatchObject({ status: 'queued_outbox' });
    const [file] = fs.readdirSync(outboxDir);
    expect(file).toMatch(/^qa-comment-\d+-\w+\.json$/);
    expect(JSON.parse(fs.readFileSync(path.join(outboxDir, file), 'utf8'))).toMatchObject({ kind: 'qa-comment', title: 'Naming' });
  });

  it('names a refused finding as a finding', async () => {
    const r = await submitTicket({ kind: 'qa-comment', title: 'Naming' }, {
      bridgeUrl: 'http://b', outboxDir: path.join(tmp, 'unused'), endpoint: '/api/agent/qa/comments',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'REQ-1 is no longer in QA; this finding was not saved' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    });
    expect(r).toMatchObject({ exitCode: 1, stderr: 'Bridge rejected the finding (409): REQ-1 is no longer in QA; this finding was not saved' });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/xticket/src`

Expected: FAIL with "Failed to load url ./qa.js" (the module does not exist).

- [ ] **Step 3: The argument parsers** (`packages/xticket/src/qa.ts`)

```ts
import fs from 'node:fs';
import { parseArgs } from 'node:util';

type Parsed = { payload: Record<string, unknown> } | { error: string };

const SEVERITIES = ['blocker', 'major', 'minor'];

function identity(env: NodeJS.ProcessEnv) {
  return { project: env.XTICKET_PROJECT || 'unknown', engineTaskId: env.XTICKET_TASK };
}

/** `xticket comment`: one AI QA finding (an open review comment marked AI QA). */
export function parseCommentArgs(argv: string[], env: NodeJS.ProcessEnv): Parsed {
  let values: { severity?: string; file?: string; line?: string; title?: string; body?: string; 'body-file'?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        severity: { type: 'string' },
        file: { type: 'string' },
        line: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        'body-file': { type: 'string' },
      },
    }));
  } catch (err: any) {
    return { error: err.message };
  }

  const severity = (values.severity || '').trim();
  if (!SEVERITIES.includes(severity)) return { error: '--severity must be blocker, major or minor' };
  const title = (values.title || '').trim();
  if (title.length < 3) return { error: '--title is required (one line, at least 3 characters)' };
  if (/[\r\n]/.test(title)) return { error: '--title must be one line; put details in --body' };
  const file = (values.file || '').trim();
  let line: number | undefined;
  if (values.line !== undefined) {
    if (!file) return { error: '--line needs --file' };
    line = Number(values.line);
    if (!Number.isInteger(line) || line < 1) return { error: '--line must be a whole number from 1' };
  }

  let body = values.body || '';
  if (values['body-file']) {
    try {
      body = fs.readFileSync(values['body-file'], 'utf-8');
    } catch (err: any) {
      return { error: `Error reading --body-file: ${err.message}` };
    }
  }

  return {
    payload: {
      kind: 'qa-comment', severity, title, body,
      ...(file ? { file_path: file } : {}),
      ...(line ? { line } : {}),
      ...identity(env),
    },
  };
}

/** `xticket qa-result`: the QA run's verdict and summary. */
export function parseQaResultArgs(argv: string[], env: NodeJS.ProcessEnv): Parsed {
  let values: { passed?: boolean; failed?: boolean; summary?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { passed: { type: 'boolean' }, failed: { type: 'boolean' }, summary: { type: 'string' } },
    }));
  } catch (err: any) {
    return { error: err.message };
  }
  if (Boolean(values.passed) === Boolean(values.failed)) return { error: 'Give exactly one of --passed or --failed' };
  const summary = (values.summary || '').trim();
  if (!summary) return { error: '--summary is required' };
  return { payload: { kind: 'qa-result', passed: Boolean(values.passed), summary, ...identity(env) } };
}
```

- [ ] **Step 4: Outbox names and wording** (`packages/xticket/src/submit.ts`)

Replace `queueInOutbox` with:

```ts
/** Outbox file prefix: the bridge reads the kind from the file, and people from its name. */
function outboxKind(payload: Record<string, unknown>): 'question' | 'qa-comment' | 'qa-result' | 'ticket' {
  const kind = payload.kind;
  return kind === 'question' || kind === 'qa-comment' || kind === 'qa-result' ? kind : 'ticket';
}

function queueInOutbox(payload: Record<string, unknown>, outboxDir: string, reason: string): SubmitResult {
  const kind = outboxKind(payload);
  try {
    fs.mkdirSync(outboxDir, { recursive: true });
    const file = path.join(outboxDir, `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    const result =
      kind === 'question'
        ? {
            questionId: 0,
            status: 'queued_outbox',
            reason,
            message: 'The bridge files your question as soon as it can. Stop working now; the answer arrives as a note when your task resumes.',
          }
        : kind === 'ticket'
          ? { ticketId: 0, target: payload.to, blocking: Boolean(payload.blocking), status: 'queued_outbox', reason }
          : { status: 'queued_outbox', reason, message: 'The bridge saves it as soon as it can; carry on with the QA run.' };
    return { exitCode: 0, stdout: JSON.stringify(result) };
  } catch (fsErr: any) {
    return { exitCode: 4, stderr: `${reason} and outbox failed: ${fsErr.message}` };
  }
}
```

In `submitTicket`, replace `const noun = payload.kind === 'question' ? 'question' : 'ticket';` with:

```ts
  const kind = outboxKind(payload);
  const noun = kind === 'qa-comment' ? 'finding' : kind === 'qa-result' ? 'QA result' : kind;
```

- [ ] **Step 5: The commands** (`packages/xticket/src/cli.ts`)

Add the import `import { parseCommentArgs, parseQaResultArgs } from './qa.js';`.

In the help text, below `ask        Ask a person a question; your task pauses until they answer`, add:

```
  comment    AI QA: report one finding (an open review comment marked AI QA)
  qa-result  AI QA: report the QA run's verdict
```

At the end of the help text (after the `ask` options), add:

```

Options for comment (AI QA runs only):
  --severity <level>       blocker | major | minor (required)
  --title <text>           One line (required)
  --file <path>            File the finding is about, relative to the repository root
  --line <n>               Line in --file
  --body <text>            Details: what you checked, what happens, key output lines
  --body-file <file>       Path to a markdown file with the details

Options for qa-result (AI QA runs only):
  --passed | --failed      The verdict (exactly one)
  --summary <text>         What you checked, or the main problems (required)
```

After the `if (command === 'ask') { … }` block, add:

```ts
  const QA_COMMANDS = new Map([
    ['comment', { parse: parseCommentArgs, endpoint: '/api/agent/qa/comments' }],
    ['qa-result', { parse: parseQaResultArgs, endpoint: '/api/agent/qa/result' }],
  ]);
  const report = QA_COMMANDS.get(command);
  if (report) {
    const parsed = report.parse(args.slice(1), process.env);
    if ('error' in parsed) {
      console.error(`Error: ${parsed.error}`);
      process.exit(2);
    }
    const result = await submitTicket(parsed.payload, { bridgeUrl, token, outboxDir, endpoint: report.endpoint });
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.exitCode);
  }
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run packages/xticket/src && npx tsc --noEmit -p packages/xticket`

Expected: PASS. The existing `submit.test.ts` and `ask.test.ts` still pass, and there are no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/xticket/src/qa.ts packages/xticket/src/qa.test.ts packages/xticket/src/cli.ts packages/xticket/src/submit.ts
git commit -m "feat(xticket): comment and qa-result commands for AI QA runs"
```

---

### Task 3: The QA prompt

**Files:**
- Create: `packages/server/src/localEngine/qaPrompt.ts`
- Create: `packages/server/src/localEngine/qaPrompt.test.ts`

**Interfaces:**
- Consumes: `wrapUntrusted(name, text)` and `oneLine(title, maxLength?)` from `packages/server/src/lib/promptSafety.ts`.
- Produces:
  - `QaPromptInput` = `{ reqId: string; title: string; bodyMd: string; project: string; commit: string; from: string | null; changedFiles: string[]; commands: { test?: string | null; build?: string | null; lint?: string | null }; maxFindings: number }`.
  - `acceptanceCriteria(bodyMd: string): string[]`.
  - `buildQaPrompt(input: QaPromptInput): string`, whose first line is `# AI QA of <REQ> in <project>`.

- [ ] **Step 1: Write the failing tests** (`packages/server/src/localEngine/qaPrompt.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { acceptanceCriteria, buildQaPrompt, type QaPromptInput } from './qaPrompt.js';

const body = [
  '# Ride tracking', '', '## Goal', 'Track rides', '', '## Acceptance criteria',
  '- [ ] Rides are saved', '- [x] Rides are listed', '* Old rides archived', '3. Admins see all rides', '',
  '## Attachments', '- 📎 banner.jpg',
].join('\n');

const input = (patch: Partial<QaPromptInput> = {}): QaPromptInput => ({
  reqId: 'REQ-008', title: 'Ride tracking', bodyMd: body, project: 'backend', commit: 'a'.repeat(40), from: 'b'.repeat(40),
  changedFiles: ['src/rides.ts', 'test/rides.test.ts'], commands: { test: 'npm test', build: 'npm run build', lint: null }, maxFindings: 30,
  ...patch,
});

describe('acceptanceCriteria', () => {
  it('reads the list under the Acceptance criteria heading', () => {
    expect(acceptanceCriteria(body)).toEqual(['Rides are saved', 'Rides are listed', 'Old rides archived', 'Admins see all rides']);
  });

  it('is empty without that heading', () => {
    expect(acceptanceCriteria('## Goal\n- not a criterion')).toEqual([]);
  });
});

describe('buildQaPrompt', () => {
  it('numbers the criteria and names the checkout, the changes and the commands', () => {
    const prompt = buildQaPrompt(input());
    expect(prompt.split('\n')[0]).toBe('# AI QA of REQ-008 in backend');
    expect(prompt).toContain(`commit \`${'a'.repeat(12)}\``);
    expect(prompt).toContain('1. Rides are saved\n2. Rides are listed\n3. Old rides archived\n4. Admins see all rides');
    expect(prompt).toContain('<untrusted_input name="requirement">');
    expect(prompt).toContain('- src/rides.ts\n- test/rides.test.ts');
    expect(prompt).toContain(`git log --oneline ${'b'.repeat(12)}..${'a'.repeat(12)}`);
    expect(prompt).toContain(`git diff ${'b'.repeat(12)}..${'a'.repeat(12)}`);
    expect(prompt).toContain('- Test command: `npm test`\n- Build command: `npm run build`');
    expect(prompt).not.toContain('Lint command');
  });

  it('states the rules and how to report', () => {
    const prompt = buildQaPrompt(input({ maxFindings: 12 }));
    expect(prompt).toContain('Do not commit, push, switch branches or edit files to fix anything.');
    expect(prompt).toContain('at most 12 findings');
    expect(prompt).toContain('xticket comment --severity blocker|major|minor');
    expect(prompt).toContain('xticket qa-result --passed --summary');
    expect(prompt).toContain('xticket qa-result --failed --summary');
    expect(prompt).toContain('Read CLAUDE.md and AGENTS.md');
  });

  it('says what to do without criteria, changed files, a range or commands', () => {
    const prompt = buildQaPrompt(input({ bodyMd: '## Goal\nTrack rides', changedFiles: [], from: null, commands: {} }));
    expect(prompt).toContain('The requirement has no acceptance criteria section');
    expect(prompt).toContain('No changed files were found for this requirement');
    expect(prompt).toContain('Inspect recent history with `git log` and `git show`.');
    expect(prompt).toContain('No test, build or lint command is set for this repository');
  });

  it('lists at most 200 changed files and says how many more', () => {
    const files = Array.from({ length: 230 }, (_, i) => `src/file-${String(i).padStart(3, '0')}.ts`);
    const prompt = buildQaPrompt(input({ changedFiles: files }));
    expect(prompt).toContain('- src/file-199.ts');
    expect(prompt).not.toContain('- src/file-200.ts');
    expect(prompt).toContain('…and 30 more (see git diff)');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/localEngine/qaPrompt.test.ts`

Expected: FAIL with "Failed to load url ./qaPrompt.js".

- [ ] **Step 3: The prompt** (`packages/server/src/localEngine/qaPrompt.ts`)

```ts
// The prompt of an AI QA run: what to check in this repository, and how to report it with xticket.
import { oneLine, wrapUntrusted } from '../lib/promptSafety.js';

export interface QaPromptInput {
  reqId: string;
  title: string;
  /** The requirement text (untrusted). */
  bodyMd: string;
  project: string;
  /** The commit checked out for QA. */
  commit: string;
  /** Where the requirement's changes start (the base before its merge), when known. */
  from: string | null;
  changedFiles: string[];
  commands: { test?: string | null; build?: string | null; lint?: string | null };
  maxFindings: number;
}

/** Changed files listed at most; the rest are counted. */
const MAX_FILES_LISTED = 200;
const COMMAND_LABEL = { test: 'Test command', build: 'Build command', lint: 'Lint command' } as const;

/** The list items under the "## Acceptance criteria" heading ("- [ ] …", "* …", "1. …"). */
export function acceptanceCriteria(bodyMd: string): string[] {
  const lines = bodyMd.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s*acceptance criteria\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (item) items.push(item[1].trim());
  }
  return items;
}

export function buildQaPrompt(input: QaPromptInput): string {
  const criteria = acceptanceCriteria(input.bodyMd);
  const commit = input.commit.slice(0, 12);
  const range = input.from ? `${input.from.slice(0, 12)}..${commit}` : null;
  const files = input.changedFiles.slice(0, MAX_FILES_LISTED);
  const more = input.changedFiles.length - files.length;
  const commands = (['test', 'build', 'lint'] as const)
    .filter((k) => input.commands[k]?.trim())
    .map((k) => `- ${COMMAND_LABEL[k]}: \`${input.commands[k]!.trim()}\``);

  return [
    `# AI QA of ${input.reqId} in ${input.project}`,
    '',
    `You are the QA reviewer of requirement ${input.reqId} ("${oneLine(input.title)}") in the repository **${input.project}**. ` +
      `Your working directory is a temporary checkout of commit \`${commit}\`: the code after the requirement was merged. ` +
      'Check it and report what you find. You do not fix anything.',
    '',
    '## The requirement',
    wrapUntrusted('requirement', input.bodyMd),
    '',
    '## Acceptance criteria',
    criteria.length
      ? criteria.map((c, i) => `${i + 1}. ${oneLine(c)}`).join('\n')
      : 'The requirement has no acceptance criteria section: judge the code against the requirement text above.',
    '',
    '## What changed in this repository',
    files.length
      ? [...files.map((f) => `- ${f}`), ...(more > 0 ? [`…and ${more} more (see git diff)`] : [])].join('\n')
      : 'No changed files were found for this requirement; look at the recent commits.',
    range ? `Inspect the changes with \`git log --oneline ${range}\` and \`git diff ${range}\`.` : 'Inspect recent history with `git log` and `git show`.',
    '',
    "## This repository's rules",
    'Read CLAUDE.md and AGENTS.md (when they exist) in the checkout, and judge the changes against them.',
    '',
    '## Checks, in this order',
    '1. For each acceptance criterion: is it met by the code? Report every gap.',
    '2. Review the changed files: bugs, missing error handling and edge cases, security problems, and breaches of the repository rules.',
    commands.length
      ? '3. Run these commands and report each failure with the key lines of its output. The checkout is fresh: install the dependencies first when a command needs them.\n' +
        commands.join('\n')
      : '3. No test, build or lint command is set for this repository: skip this step.',
    '',
    '## Rules',
    '- Do not commit, push, switch branches or edit files to fix anything. Anything you change in this checkout is thrown away.',
    `- One finding per problem; at most ${input.maxFindings} findings, the most important first.`,
    '- Severity: **blocker** (a criterion is not met, tests or the build fail, data loss, security), **major** (a real bug or a likely failure), **minor** (quality, naming, small gaps).',
    '- Do not ask a person questions: report what is unclear as a finding.',
    '',
    '## Reporting',
    'Report each finding as soon as you find it:',
    '```',
    'xticket comment --severity blocker|major|minor [--file <path> [--line <n>]] --title "<one line>" [--body "<details>" | --body-file <path>]',
    '```',
    '`--file` is relative to the repository root. Put the evidence in the body: what you checked, what happens, the key output lines.',
    '',
    'Finish with exactly one result:',
    '```',
    'xticket qa-result --passed --summary "<what you checked>"',
    'xticket qa-result --failed --summary "<the main problems>"',
    '```',
    'Use --failed when you reported any blocker or major finding.',
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/localEngine/qaPrompt.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/localEngine/qaPrompt.ts packages/server/src/localEngine/qaPrompt.test.ts
git commit -m "feat(local-engine): AI QA prompt"
```

---
### Task 4: The runner runs AI QA tasks

**Files:**
- Modify: `packages/server/src/localEngine/runStore.ts:6-18` (status `done`)
- Modify: `packages/server/src/adapters/localCliAdapter.ts:17-27` (status map)
- Modify: `packages/server/src/localEngine/worktrees.ts` (`checkoutDetached`)
- Modify: `packages/server/src/localEngine/agentRunner.ts`
- Modify: `packages/server/src/testing/localEngineFixture.ts` (`queueQaRun`)
- Modify: `packages/server/src/testing/fakeAgentCli.mjs` (`FAKE: where`)
- Create: `packages/server/src/localEngine/agentRunnerQa.test.ts`

**Interfaces:**
- Consumes:
  - `SettingsService.getAiQaSettings()` (Task 1).
  - `BridgeTask.role === 'qa'`, `qa_passed` and `qa_summary` (Task 1).
- Produces:
  - `RunStatus` includes `'done'`, which is a finished status.
  - A QA run always takes these steps:
    - it runs in `<worktree root>/<project>/task-<qaTaskId>`, checked out detached at `task.base_sha`;
    - its prompt is `run.body_md`, prefixed with `## Continue …` on a continuation;
    - it is stopped after `getAiQaSettings().timeLimitMinutes`;
    - its checkout is removed when it ends.
  - A QA run ends in one of these statuses:
    - `done`. If the agent sent no result, `qa_summary` is set to `Finished without a result`.
    - `failed` / `timed_out`, with the reason.
    - `cancelled`.
  - **The QA task follows its run** (`queued` / `running` / `rate_limited` / `done` / `failed` / `cancelled`). `last_error` holds the reason of a failed run.
  - **Stopping:** a QA run whose requirement is no longer in QA, or whose task was cancelled, is cancelled on the next runner pass. Its log says `■ <REQ> is no longer in QA; AI QA stops`.
  - Harness: `LocalHarness.queueQaRun(bodyMd: string, sha?: string): { run: LocalRun; taskId: number }`. It also moves `h.req` to `qa`.
  - Fake CLI action `FAKE: where` says `HEAD <sha> (detached)` or `HEAD <sha> on <branch>`.

- [ ] **Step 1: The fixture and the fake CLI action**

In `packages/server/src/testing/localEngineFixture.ts`, add to the `LocalHarness` interface (after `queueRun`):

```ts
  /** An AI QA task of `req` (moved to QA) checking `sha` (default: develop's tip), with its run queued. */
  queueQaRun(bodyMd: string, sha?: string): { run: LocalRun; taskId: number };
```

Add after the `queueRun` const:

```ts
  const queueQaRun = (bodyMd: string, sha: string = resolveCommit(repo, 'refs/heads/develop')!) => {
    db.prepare("UPDATE requirements SET status = 'qa' WHERE id = ?").run(req.id);
    const now = new Date().toISOString();
    const taskId = Number(
      db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, base_sha, created_at, updated_at) VALUES (?, 'backend', 'qa', 'AI QA · backend', 'queued', ?, ?, ?)")
        .run(req.id, sha, now, now).lastInsertRowid
    );
    const run = runner.runs.create({ bridgeTaskId: taskId, project: 'backend', title: `AI QA · ${req.id}`, bodyMd });
    return { run, taskId };
  };
```

Add `queueQaRun` to the returned object, after `queueRun`.

In `packages/server/src/testing/fakeAgentCli.mjs`:
- Add `where` to the action list in the header comment.
- In the `for (const [action, arg] of actions)` chain, add a branch before the `else if (action === 'sleep')` branch:

```js
  else if (action === 'where') {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
    say(`HEAD ${head} ${branch ? `on ${branch}` : '(detached)'}`);
  }
```

- [ ] **Step 2: Write the failing tests** (`packages/server/src/localEngine/agentRunnerQa.test.ts`)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses, makeLocalHarness, waitFor, type LocalHarness } from '../testing/localEngineFixture.js';

afterAll(() => cleanLocalHarnesses());

const qaTask = (h: LocalHarness, id: number) => h.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;

describe('AgentRunner: AI QA runs', () => {
  it('checks the commit out detached, ends done without touching a branch, and removes the checkout', async () => {
    const h = makeLocalHarness();
    const sha = sh(h.repo, ['rev-parse', 'develop']);
    const branches = sh(h.repo, ['branch', '--list']);
    const { run, taskId } = h.queueQaRun('FAKE: where\nFAKE: dirty scratch.txt');
    await h.settle();

    expect(h.run(run.id)).toMatchObject({ status: 'done', start_sha: sha, worktree: null, exit_code: 0 });
    expect(qaTask(h, taskId)).toMatchObject({ status: 'done', qa_summary: 'Finished without a result', branch: null });
    const text = h.logText(taskId);
    expect(text).toMatch(new RegExp(`▶ AI QA with Claude Code in .*task-${taskId} at ${sha.slice(0, 7)}`));
    expect(text).toContain(`HEAD ${sha} (detached)`);
    expect(text).toContain('✓ AI QA finished without a result');
    const [call] = h.invocations(run.id);
    expect(fs.existsSync(call.cwd)).toBe(false);
    expect(sh(h.repo, ['branch', '--list'])).toBe(branches);
    expect(sh(h.repo, ['worktree', 'list'])).not.toContain(`task-${taskId}`);
    expect(sh(h.repo, ['status', '--porcelain'])).toBe('');
  });

  it('keeps the result the agent reported', async () => {
    const h = makeLocalHarness();
    const { taskId } = h.queueQaRun('FAKE: say checked');
    h.db.prepare("UPDATE bridge_tasks SET qa_passed = 0, qa_summary = '1 blocker: rides are not saved' WHERE id = ?").run(taskId);
    await h.settle();
    expect(qaTask(h, taskId)).toMatchObject({ status: 'done', qa_passed: 0, qa_summary: '1 blocker: rides are not saved' });
    expect(h.logText(taskId)).toContain('✓ AI QA found problems: 1 blocker: rides are not saved');
  });

  it('fails with the reason when the agent exits non-zero, and still removes the checkout', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: say step one\nFAKE: exit 3');
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'failed', worktree: null });
    const task = qaTask(h, taskId);
    expect(task.status).toBe('failed');
    expect(task.last_error).toMatch(/^Claude Code failed: failed on purpose \(3\)/);
    expect(fs.existsSync(h.invocations(run.id)[0].cwd)).toBe(false);
  });

  it('stops at the AI QA time limit, not the engine run limit', async () => {
    const h = makeLocalHarness();
    h.settingsService.updateAiQaSettings({ timeLimitMinutes: 5 }); // a test minute is 50 ms
    const { run, taskId } = h.queueQaRun('FAKE: sleep 5000');
    await h.settle();
    expect(h.run(run.id).status).toBe('timed_out');
    expect(qaTask(h, taskId).status).toBe('failed');
    expect(qaTask(h, taskId).last_error).toContain('5 minute AI QA time limit (Settings → AI & Local Engines → AI QA)');
  });

  it('runs for a repository on another engine', async () => {
    const h = makeLocalHarness();
    h.projectService.updateProject('backend', { engine_type: 'manual' });
    const { run, taskId } = h.queueQaRun('FAKE: say checked');
    await h.settle();
    expect(h.run(run.id).status).toBe('done');
    expect(qaTask(h, taskId).status).toBe('done');
  });

  it('fails a QA task that has no commit to check', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: say checked');
    h.db.prepare('UPDATE bridge_tasks SET base_sha = NULL WHERE id = ?').run(taskId);
    await h.settle();
    expect(h.run(run.id)).toMatchObject({ status: 'failed', error: 'AI QA has no commit to check' });
    expect(qaTask(h, taskId)).toMatchObject({ status: 'failed', last_error: 'AI QA has no commit to check' });
  });

  it('a requirement can be marked done while AI QA runs, and the run stops', async () => {
    const h = makeLocalHarness();
    const now = new Date().toISOString();
    h.db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'goal', 'Ride tracking', 'done', ?, ?)")
      .run(h.req.id, now, now);
    const { run, taskId } = h.queueQaRun('FAKE: sleep 5000');
    void h.runner.tick();
    await waitFor(() => qaTask(h, taskId).status === 'running');

    expect(h.requirementService.updateRequirementStatus(h.req.id, 'done')?.status).toBe('done');
    await h.settle();

    expect(h.run(run.id).status).toBe('cancelled');
    expect(qaTask(h, taskId).status).toBe('cancelled');
    expect(h.logText(taskId)).toContain(`■ ${h.req.id} is no longer in QA; AI QA stops`);
    expect(h.logText(taskId)).toContain('■ AI QA stopped');
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/localEngine/agentRunnerQa.test.ts`

Expected: FAIL. With today's runner the QA runs never start: `start()` refuses a task with no branch, and a project whose engine is not `local`. They end `failed` ("Local AI CLI needs a git repository…") or stay queued.

- [ ] **Step 4: Run status `done`**

In `packages/server/src/localEngine/runStore.ts`:
- Add `| 'done'` to `RunStatus`, documented as "AI QA: the run finished (its result is on the QA task)".
- Make `FINISHED_RUN_STATUSES`:

```ts
export const FINISHED_RUN_STATUSES: RunStatus[] = ['review', 'no_changes', 'done', 'failed', 'timed_out', 'cancelled'];
```

In `packages/server/src/adapters/localCliAdapter.ts`, add `done: 'done',` to `STATUS` (after `no_changes: 'needs_human',`).

- [ ] **Step 5: Detached checkouts** (`packages/server/src/localEngine/worktrees.ts`)

Add `removeWorktree` to the `../lib/gitRepo.js` import, and add this method to `AgentWorktrees` after `ensure`:

```ts
  /** AI QA: a fresh detached checkout of `sha` at `dir`; what an earlier attempt left there is removed. */
  checkoutDetached(repo: string, sha: string, dir: string): void {
    if (!isGitWorkTree(repo)) throw new Error(`AI QA needs a git repository: ${repo} is not the top of a git work tree`);
    if (fs.existsSync(dir)) removeWorktree(repo, dir);
    runGit(repo, ['worktree', 'prune']);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    runGit(repo, ['worktree', 'add', '--quiet', '--detach', dir, sha]);
  }
```

- [ ] **Step 6: The runner** (`packages/server/src/localEngine/agentRunner.ts`)

**6a.** Imports:
- Add `AiQaSettings` to the `@sp-kickstack/shared` type import.
- Change the gitRepo import to `import { commitsAhead, removeWorktree, resolveCommit } from '../lib/gitRepo.js';`.
- Add `import { toEngineTask } from '../adapters/localCliAdapter.js';`. The adapter imports only types from `runStore`, so this adds no cycle.

**6b.** Constants, after `MAX_LIMIT_WAIT_MS`:

```ts
/** A QA task's summary when its agent ended without `xticket qa-result`. */
const QA_NO_RESULT = 'Finished without a result';
/** Prefix of a QA run that starts again (usage limit, restart): its earlier findings are kept. */
const QA_CONTINUE = '## Continue\nAn earlier attempt of this QA run was interrupted. The findings it reported are kept: report only new ones, then the result.\n\n';
```

**6c.** `cancel()`: add `this.followRun(runId);` as the last statement, after the `if (this.runs.transition(…)) { … }` block. For an active run, the `supervise` change in 6g does the same thing.

**6d.** `shutdown()`: inside the `if (this.runs.transition(active.runId, ['running'], …)) { … }` block, add `this.followRun(active.runId);` after the log line.

**6e.** `recoverOnStartup()`: add `this.followRun(run.id);` inside both transition blocks: the `failed` one and the re-queued one.

**6f.** Replace `pass()`, `cliFor()` and `start()` with:

```ts
  private async pass(): Promise<void> {
    if (this.stopping) return;
    this.resumeRateLimited();
    this.stopQaOutsideQa();
    this.cleanupWorktrees();
    const settings = this.settings();
    if (!settings.enabled) return;
    const ai = this.ai();
    const fallback = chooseCli(settings, ai, this.find);
    const paused = this.runs.pausedClis(this.now());
    let running = this.runs.count('running');
    for (const run of this.runs.queued()) {
      if (running >= settings.maxParallel) break;
      if (this.taskBusy(run)) continue;
      const choice = this.cliFor(run, ai, fallback);
      if (choice.problem) {
        if (this.runs.transition(run.id, ['queued'], { status: 'failed', error: choice.problem, finished_at: this.iso() })) {
          this.log(run.bridge_task_id, 'system', `✗ ${choice.problem}`);
        }
        this.followRun(run.id);
        continue;
      }
      if (!choice.cli || !choice.bin || paused.has(choice.cli)) continue;
      if (this.start(run, choice.cli, choice.bin, ai, settings)) running++;
    }
  }

  /** The requirement's (or AI QA's) CLI when one was chosen (it must be enabled and installed), else the engine's choice. */
  private cliFor(run: LocalRun, ai: AiCliSettings, fallback: CliChoice): CliChoice {
    if (!run.preferred_cli) return fallback.cli ? fallback : { cli: null, bin: null, problem: null };
    const cli = run.preferred_cli;
    const bin = cliEnabled(cli, ai) ? cliBinary(cli, ai, this.find) : null;
    if (bin) return { cli, bin, problem: null };
    const task = this.task(run.bridge_task_id);
    const why = cliEnabled(cli, ai) ? 'is not installed on this PC' : 'is turned off in Settings → AI & Local Engines';
    if (task?.role === 'qa') return { cli: null, bin: null, problem: `No AI CLI can run QA: ${CLI_LABELS[cli]} is chosen for AI QA but ${why}` };
    return { cli: null, bin: null, problem: `${CLI_LABELS[cli]} is chosen for ${task?.req_id ?? 'this requirement'} but ${why}` };
  }

  private taskBusy(run: LocalRun): boolean {
    if (this.active.has(run.id)) return true;
    for (const active of this.active.values()) if (active.taskId === run.bridge_task_id) return true;
    return false;
  }

  /** Start one queued run; false when it could not start (then it is failed or cancelled). */
  private start(run: LocalRun, cli: AgentCliId, bin: string, ai: AiCliSettings, settings: LocalEngineSettings): boolean {
    if (run.cancel_requested_at) {
      this.runs.transition(run.id, ['queued'], { status: 'cancelled', finished_at: this.iso() });
      this.followRun(run.id);
      return false;
    }
    const task = this.task(run.bridge_task_id);
    if (!task || task.status === 'done' || task.status === 'cancelled') {
      this.runs.transition(run.id, ['queued'], { status: 'cancelled', error: 'The task is no longer active', finished_at: this.iso() });
      return false;
    }
    const qa = task.role === 'qa';
    const fail = (message: string) => {
      if (this.runs.transition(run.id, ['queued'], { status: 'failed', error: message, finished_at: this.iso() })) this.log(task.id, 'system', `✗ ${message}`);
      this.followRun(run.id);
      return false;
    };
    const project = this.opts.projectService.getProject(run.project);
    if (!project) return fail(`Repository ${run.project} is not registered`);
    // Switched to another engine or disabled: no agent starts there; the run waits until it is back.
    // AI QA checks every git repository, whatever its engine.
    if (!project.enabled || (!qa && project.engine_type !== 'local')) return false;
    let checkout: { dir: string; ref: string; startSha: string | null; gitCommonDir: string };
    try {
      checkout = qa ? this.qaCheckout(project.name, project.repo_path, task) : this.taskCheckout(project.name, project.repo_path, task);
    } catch (err: any) {
      return fail(err?.message || String(err));
    }
    const { dir, gitCommonDir } = checkout;

    const model = runModel(cli, run.model, ai);
    const effort = runEffort(cli, run.effort, ai);
    let prompt = qa
      ? `${run.continuation === 1 ? QA_CONTINUE : ''}${run.body_md}`
      : buildRunPrompt({ bodyMd: run.body_md, worktree: dir, branch: task.branch!, notesMd: run.notes_md, continuation: run.continuation === 1 });
    if (this.opts.neuronService) {
      prompt = this.opts.neuronService.enrichPrompt(prompt, project.name);
    }
    const runDir = path.join(this.opts.workspaceDir, 'agent-runs', run.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, `prompt-${Date.now()}.md`), prompt);
    const command = buildCommand(cli, bin, { prompt, model, effort, worktree: dir, gitCommonDir });
    const env = agentEnvironment(process.env, {
      launcherDir: this.launcherDir(),
      cliBin: bin,
      homeDir: this.opts.homeDir,
      extra: {
        XTICKET_URL: this.opts.bridgeUrl,
        XTICKET_PROJECT: project.name,
        XTICKET_TASK: run.id,
        // Queued questions/tickets land where the bridge's outbox scanner reads them, not in the worktree.
        XTICKET_OUTBOX: path.join(this.opts.workspaceDir, 'agent-outbox', folderName(project.name)),
        ...(this.opts.agentToken ? { XTICKET_TOKEN: this.opts.agentToken } : {}),
      },
    });
    let agent: SpawnedAgent;
    try {
      agent = spawnAgent(command, dir, env);
    } catch (err: any) {
      if (qa) removeWorktree(project.repo_path, dir);
      return fail(`Could not start ${CLI_LABELS[cli]} (${bin}): ${err?.message || err}`);
    }
    // A cancel requested meanwhile keeps the run from starting (cancel_requested_at is never reset).
    const claimed = !this.runs.get(run.id)?.cancel_requested_at && this.runs.transition(run.id, ['queued'], {
      status: 'running', cli, model, effort, worktree: dir, start_sha: checkout.startSha, end_sha: null, pid: agent.pid,
      pid_started_at: agent.startedAt, started_at: this.iso(), finished_at: null, notes_md: '', continuation: 0,
      hold_requested_at: null, exit_code: null, error: null, resume_at: null,
    });
    if (!claimed) {
      void stopGroup(agent.pid, agent.exited, this.stopGrace());
      return false;
    }
    this.followRun(run.id);
    this.opts.db.prepare('UPDATE bridge_tasks SET model = ?, effort = ? WHERE id = ?').run(model, effort, task.id);
    const profile = `${model ? ` · ${model}` : ''}${effort ? ` · ${effort}` : ''}`;
    this.log(task.id, 'system', qa ? `▶ AI QA with ${CLI_LABELS[cli]} in ${dir} at ${checkout.ref}${profile}` : `▶ ${CLI_LABELS[cli]} started in ${dir} on ${checkout.ref}${profile}`);
    const minutes = qa ? this.qaSettings().timeLimitMinutes : settings.runTimeoutMinutes;
    this.supervise(run.id, task, project.repo_path, cli, bin, agent, minutes, runDir);
    return true;
  }

  /** The task's own worktree on its branch (kept between runs). */
  private taskCheckout(projectName: string, repo: string, task: BridgeTask) {
    if (!task.branch) throw new Error(`Local AI CLI needs a git repository: ${repo} is not the top of a git work tree`);
    // A task keeps its worktree (even after the worktree folder setting changed); new tasks use the current root.
    const dir = this.recordedWorktree(task.id) ?? this.worktrees.pathFor(projectName, task.id);
    this.worktrees.ensure(repo, task.branch, dir);
    return { dir, ref: task.branch, startSha: resolveCommit(repo, `refs/heads/${task.branch}`), gitCommonDir: this.worktrees.gitCommonDir(repo) };
  }

  /** AI QA: a fresh detached checkout of the commit to check, removed when the run ends. */
  private qaCheckout(projectName: string, repo: string, task: BridgeTask) {
    if (!task.base_sha) throw new Error('AI QA has no commit to check');
    const dir = this.worktrees.pathFor(projectName, task.id);
    this.worktrees.checkoutDetached(repo, task.base_sha, dir);
    return { dir, ref: task.base_sha.slice(0, 7), startSha: task.base_sha, gitCommonDir: this.worktrees.gitCommonDir(repo) };
  }
```

The old `start()` resolved `startSha` from the branch just before the spawn. `taskCheckout` now does it right after `ensure`, and nothing commits in between. The log line of a non-QA run is the same string as before.

**6g.** In `supervise()`, replace the `active.settled = agent.exited.then(…)` body so that the QA task follows its run after every finish:

```ts
    active.settled = agent.exited.then(async (exit) => {
      active.timers.forEach(clearTimeout);
      killGroupLeftovers(agent.pid);
      handle(parser.flush());
      close();
      try {
        await this.finish(runId, task.id, repo, cli, bin, exit, out, active.timedOut);
      } catch (err: any) {
        console.warn(`[local-engine] run ${runId}: ${err?.message || err}`);
      } finally {
        this.active.delete(runId);
      }
      this.followRun(runId);
      await this.tick();
    });
```

**6h.** Replace `finish()` with the version below. It changes three things:
- the QA checkout is dropped first;
- QA runs have no branch to read;
- QA wording is used, and a successful QA run ends in `finishQa`.

```ts
  /** Turn the agent's exit into the run's status. */
  private async finish(runId: string, taskId: number, repo: string, cli: AgentCliId, bin: string, exit: AgentExit, out: OutputState, timedOut: boolean) {
    const run = this.runs.get(runId);
    const task = this.task(taskId);
    if (!run || !task) return;
    const qa = task.role === 'qa';
    if (qa) this.dropQaCheckout(taskId, repo, run.worktree);
    const endSha = !qa && task.branch ? resolveCommit(repo, `refs/heads/${task.branch}`) : null;
    if (endSha && endSha !== run.start_sha) this.opts.onCommits?.(taskId);
    const base: RunPatch = { pid: null, exit_code: exit.code, end_sha: endSha, finished_at: this.iso() };
    const label = CLI_LABELS[cli];

    if (run.cancel_requested_at) {
      // Any state: a run released or re-queued while its agent was stopping must not start again.
      if (this.runs.transition(runId, ['running', 'held', 'queued', 'rate_limited'], { ...base, status: 'cancelled' })) {
        this.log(taskId, 'system', qa ? '■ AI QA stopped' : '■ Stopped: the task was cancelled');
      }
      return;
    }
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
    if (timedOut) {
      const error = qa
        ? `Stopped after the ${this.qaSettings().timeLimitMinutes} minute AI QA time limit (Settings → AI & Local Engines → AI QA)`
        : `Stopped after the ${this.settings().runTimeoutMinutes} minute time limit (Settings → AI & Local Engines)`;
      this.end(runId, taskId, { ...base, status: 'timed_out', error });
      return;
    }
    if (out.rateLimit) {
      const resumeAt = await this.resumeTime(cli, bin, out.rateLimit.resetAt);
      const patch: RunPatch = { ...base, finished_at: null, status: 'rate_limited', resume_at: resumeAt, continuation: 1, error: `${label} usage limit reached; continues at ${resumeAt}` };
      if (this.runs.transition(runId, ['running'], patch)) {
        this.log(taskId, 'system', `⏸ ${label} usage limit reached; this run continues at ${resumeAt}`);
      }
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
    if (qa) {
      this.finishQa(runId, taskId, base);
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

  /** AI QA ends done; its result is what the agent reported with `xticket qa-result`. */
  private finishQa(runId: string, taskId: number, base: RunPatch) {
    const row = this.task(taskId);
    if (!row || row.qa_passed == null) {
      this.opts.db.prepare('UPDATE bridge_tasks SET qa_summary = ? WHERE id = ? AND qa_passed IS NULL').run(QA_NO_RESULT, taskId);
      this.end(runId, taskId, { ...base, status: 'done' }, '✓ AI QA finished without a result (the agent did not run xticket qa-result)');
      return;
    }
    const summary = (row.qa_summary ?? '').split('\n')[0];
    this.end(runId, taskId, { ...base, status: 'done' }, `✓ AI QA ${row.qa_passed ? 'passed' : 'found problems'}: ${summary}`);
  }
```

**6i.** Replace `cleanupWorktrees()`. A QA checkout is thrown away, even when it is dirty. It is only removed when no run of its task is active:

```ts
  /** Worktrees of tasks that are COMPLETE or CANCELLED are removed (kept while they have uncommitted changes); AI QA checkouts always go. */
  private cleanupWorktrees() {
    const rows = this.opts.db
      .prepare(`
        SELECT r.bridge_task_id AS taskId, r.project AS project, MAX(r.worktree) AS worktree, t.role AS role
        FROM local_runs r JOIN bridge_tasks t ON t.id = r.bridge_task_id
        WHERE r.worktree IS NOT NULL AND (t.status IN ('done', 'cancelled') OR (t.role = 'qa' AND t.status = 'failed'))
        GROUP BY r.bridge_task_id, r.project
      `)
      .all() as Array<{ taskId: number; project: string; worktree: string; role: string }>;
    for (const row of rows) {
      if (row.role !== 'qa') {
        this.removeTaskWorktree(row.taskId, row.project, row.worktree);
        continue;
      }
      if ([...this.active.values()].some((a) => a.taskId === row.taskId)) continue;
      const repo = this.opts.projectService.getProject(row.project)?.repo_path;
      if (repo) this.dropQaCheckout(row.taskId, repo, row.worktree);
    }
  }
```

**6j.** `resumeRateLimited()`: inside its `if (this.runs.transition(…)) { … }` block, add `this.followRun(run.id);` after the log line.

**6k.** New private methods, after `resumeRateLimited()`:

```ts
  /** AI QA checks a requirement in QA: its runs stop once the requirement leaves QA (Request changes, done, cancelled) or the QA task is cancelled. */
  private stopQaOutsideQa() {
    const rows = this.opts.db
      .prepare(`
        SELECT r.id AS runId, t.id AS taskId, t.req_id AS reqId FROM local_runs r
        JOIN bridge_tasks t ON t.id = r.bridge_task_id
        JOIN requirements q ON q.id = t.req_id
        WHERE t.role = 'qa' AND r.status IN ('queued', 'running', 'rate_limited') AND r.cancel_requested_at IS NULL
          AND (q.status <> 'qa' OR t.status = 'cancelled')
      `)
      .all() as Array<{ runId: string; taskId: number; reqId: string }>;
    for (const row of rows) {
      this.log(row.taskId, 'system', `■ ${row.reqId} is no longer in QA; AI QA stops`);
      void this.cancel(row.runId).catch((err) => console.warn(`[local-engine] run ${row.runId}: ${err?.message || err}`));
    }
  }

  /** A QA task has no engine to sync it: its status follows its run (a no-op for other tasks). */
  private followRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    const status = toEngineTask(run).status;
    this.opts.db
      .prepare("UPDATE bridge_tasks SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND role = 'qa' AND status <> 'cancelled'")
      .run(status, status === 'failed' ? run.error : null, new Date().toISOString(), run.bridge_task_id);
  }

  /** Remove an AI QA checkout; whatever the agent left in it is thrown away. */
  private dropQaCheckout(taskId: number, repo: string, worktree: string | null) {
    if (!worktree) return;
    removeWorktree(repo, worktree);
    this.opts.db.prepare('UPDATE local_runs SET worktree = NULL, updated_at = ? WHERE bridge_task_id = ?').run(new Date().toISOString(), taskId);
  }

  private qaSettings(): AiQaSettings {
    return this.opts.settingsService.getAiQaSettings();
  }
```

`AND status <> 'cancelled'` in `followRun` means that a QA task cancelled with its requirement (`FanOutService.cancel`) stays cancelled.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/localEngine packages/server/src/adapters && npx tsc --noEmit -p packages/server`

Expected: PASS. That covers the 7 new tests and every existing runner, worktree and adapter test, with no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/localEngine/runStore.ts packages/server/src/adapters/localCliAdapter.ts packages/server/src/localEngine/worktrees.ts packages/server/src/localEngine/agentRunner.ts packages/server/src/localEngine/agentRunnerQa.test.ts packages/server/src/testing/localEngineFixture.ts packages/server/src/testing/fakeAgentCli.mjs
git commit -m "feat(local-engine): run AI QA tasks in a detached checkout"
```

---
### Task 5: `QaService`: start, findings, result, status; outbox reports

**Files:**
- Create: `packages/server/src/services/qaService.ts`
- Create: `packages/server/src/services/qaService.test.ts`
- Modify: `packages/server/src/watcher/outboxScanner.ts`
- Modify: `packages/server/src/testing/fakeAgentCli.mjs` (`FAKE: qa-comment`, `FAKE: qa-result`)

**Interfaces:**
- Consumes:
  - Task 1: `AiQaSettings`, `QaFindingInputSchema`, `QaResultInputSchema`, `RequirementQa`, `QaRunView`, `QaSeverity`, and the columns `review_comments.source` / `severity` / `qa_task_id` and `bridge_tasks.qa_passed` / `qa_summary`.
  - Task 3: `buildQaPrompt(input: QaPromptInput)`.
  - Task 4: `RunStore.create(...)` runs that the runner picks up; `LocalHarness.queueQaRun`.
- Produces:
  - `QaEngine` = `{ status(): LocalEngineStatus; nudge(): void }`.
  - `new QaService(opts: QaServiceOptions)`, where `QaServiceOptions` = `{ db; projectService; requirementService; settingsService?; branchService?; engine?: QaEngine; emit?: QaEmit }`.
  - `start(reqId: string, trigger: 'auto' | 'manual', commits?: Record<string, string>): RequirementQa`. It throws: 404 when the requirement is unknown; 409 when it is not in QA, already running, or has no repositories or no git repository; 503 when there is no engine.
  - `onEnteredQa(reqId: string, commits: Record<string, string>): void`. It never throws.
  - `addFinding(input: unknown, project: string, runId: string | undefined): { commentId: number; duplicate: boolean }`.
  - `recordResult(input: unknown, project: string, runId: string | undefined): { ok: true; passed: boolean; summary: string }`.
  - `status(reqId: string): RequirementQa`.
  - `OutboxScanner` takes a fifth constructor argument `qaService?: QaService`. It reads files whose `kind` is `'qa-comment'` or `'qa-result'`.

- [ ] **Step 1: The fake agent reports like xticket's outbox fallback**

In `packages/server/src/testing/fakeAgentCli.mjs`:
- Add `qa-comment <severity>|<file>|<line>|<title> · qa-result passed|failed|<summary>` to the action list in the header comment.
- Add this branch before the `else if (action === 'sleep')` branch:

```js
  else if (action === 'qa-comment' || action === 'qa-result') {
    // Queued the way xticket queues when the bridge cannot be reached: tests never post to a live bridge.
    const identity = { project: process.env.XTICKET_PROJECT, engineTaskId: task };
    let payload;
    if (action === 'qa-comment') {
      const [severity, file, line, title] = arg.split('|');
      payload = { kind: 'qa-comment', severity, title, body: '', ...(file ? { file_path: file } : {}), ...(line ? { line: Number(line) } : {}), ...identity };
    } else {
      const [verdict, summary] = arg.split('|');
      payload = { kind: 'qa-result', passed: verdict === 'passed', summary, ...identity };
    }
    tool(`xticket ${action === 'qa-comment' ? 'comment' : 'qa-result'} …`);
    fs.mkdirSync(process.env.XTICKET_OUTBOX, { recursive: true });
    fs.writeFileSync(path.join(process.env.XTICKET_OUTBOX, `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`), JSON.stringify(payload));
  }
```

- [ ] **Step 2: Write the failing tests** (`packages/server/src/services/qaService.test.ts`)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QaService } from './qaService.js';
import { OutboxScanner } from '../watcher/outboxScanner.js';
import { commitOnBranch, sh } from '../testing/gitFixture.js';
import { cleanLocalHarnesses, makeLocalHarness, type LocalHarness } from '../testing/localEngineFixture.js';
import { makeE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

const now = () => new Date().toISOString();

/** A task of `reqId` in `project` (the repository card findings go to). */
function addWork(h: LocalHarness, reqId = h.req.id, fields: Record<string, unknown> = {}, role = 'goal', project = 'backend'): number {
  const id = Number(
    h.db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, ?, ?, 'Ride tracking', 'done', ?, ?)")
      .run(reqId, project, role, now(), now()).lastInsertRowid
  );
  for (const [column, value] of Object.entries(fields)) h.db.prepare(`UPDATE bridge_tasks SET ${column} = ? WHERE id = ?`).run(value, id);
  return id;
}

function setup(h: LocalHarness = makeLocalHarness()) {
  let nudges = 0;
  const qa = new QaService({
    db: h.db, projectService: h.projectService, requirementService: h.requirementService, settingsService: h.settingsService,
    engine: { status: () => h.runner.status(), nudge: () => { nudges++; } },
  });
  const toQa = (id = h.req.id) => h.db.prepare("UPDATE requirements SET status = 'qa' WHERE id = ?").run(id);
  const runOf = (taskId: number) => h.db.prepare('SELECT * FROM local_runs WHERE bridge_task_id = ?').get(taskId) as any;
  const comments = (reqId = h.req.id) => h.db.prepare('SELECT * FROM review_comments WHERE req_id = ? ORDER BY id').all(reqId) as any[];
  return { h, qa, toQa, runOf, comments, nudges: () => nudges };
}

/** AI QA started for h.req with one goal on backend. */
function started(s: ReturnType<typeof setup>) {
  const goalId = addWork(s.h);
  s.toQa();
  const view = s.qa.start(s.h.req.id, 'manual');
  const task = view.runs[0].task;
  return { goalId, view, task, runId: s.runOf(task.id)?.id as string };
}

describe('AI QA: starting', () => {
  it('queues one QA run per git repository at the branch tip, with the QA prompt and the AI QA settings', () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ agentCli: 'claude-cli', model: 'sonnet', effort: 'high' });
    const { view, task, runId } = started(s);
    expect(view).toMatchObject({ reqId: s.h.req.id, round: 1, running: true, skipped: [], findings: { total: 0 } });
    expect(task).toMatchObject({ role: 'qa', project: 'backend', status: 'queued', base_sha: sh(s.h.repo, ['rev-parse', 'develop']), revision: 1, engine_task_id: null });
    const run = s.runOf(task.id);
    expect(run).toMatchObject({ id: runId, status: 'queued', model: 'sonnet', effort: 'high', preferred_cli: 'claude-cli' });
    expect(run.body_md).toContain(`# AI QA of ${s.h.req.id} in backend`);
    expect(run.body_md).toContain('1. Rides tracked');
    expect(s.nudges()).toBe(1);
  });

  it('uses the merged commit the merge gate gives', () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    const merged = sh(s.h.repo, ['rev-parse', 'develop']);
    commitOnBranch(s.h.repo, 'develop', 'later.txt', 'later\n');
    expect(s.qa.start(s.h.req.id, 'auto', { backend: merged }).runs[0].task.base_sha).toBe(merged);
  });

  it("checks the tip of the requirement's target branch", () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    sh(s.h.repo, ['branch', 'release/1', 'develop']);
    const tip = commitOnBranch(s.h.repo, 'release/1', 'release.txt', 'release\n');
    s.h.db.prepare("UPDATE requirements SET target_branch = 'release/1' WHERE id = ?").run(s.h.req.id);
    expect(s.qa.start(s.h.req.id, 'manual').runs[0].task.base_sha).toBe(tip);
  });

  it('lists changed files from the merge commits after the branches are deleted', () => {
    const s = setup();
    const branch = `req/${s.h.req.id}/task-99`;
    sh(s.h.repo, ['branch', branch, 'develop']);
    commitOnBranch(s.h.repo, branch, 'src/rides.ts', 'export const rides = [];\n');
    sh(s.h.repo, ['merge', '--no-ff', '-q', '-m', 'Merge rides', branch]);
    const mergeSha = sh(s.h.repo, ['rev-parse', 'HEAD']);
    const parent = sh(s.h.repo, ['rev-parse', `${mergeSha}^1`]);
    sh(s.h.repo, ['branch', '-D', branch]);
    addWork(s.h, s.h.req.id, { branch, merge_sha: mergeSha, merged_at: now() });
    s.toQa();
    const body = s.runOf(s.qa.start(s.h.req.id, 'manual').runs[0].task.id).body_md as string;
    expect(body).toContain('- src/rides.ts');
    expect(body).toContain(`git diff ${parent.slice(0, 12)}..${mergeSha.slice(0, 12)}`);
  });

  it('refuses outside QA, while QA runs, and without a git repository', () => {
    const s = setup();
    addWork(s.h);
    expect(() => s.qa.start(s.h.req.id, 'manual')).toThrow(`${s.h.req.id} is draft; AI QA runs while a requirement is in QA`);
    s.toQa();
    s.qa.start(s.h.req.id, 'manual');
    expect(() => s.qa.start(s.h.req.id, 'manual')).toThrow(`AI QA is already running for ${s.h.req.id}`);

    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    const docs = s.h.requirementService.createRequirement({ title: 'Docs', goal: 'Write docs', acceptance_criteria: [], affected_projects: ['docs'], priority: 'normal' });
    addWork(s.h, docs.id, {}, 'goal', 'docs');
    s.toQa(docs.id);
    expect(() => s.qa.start(docs.id, 'manual')).toThrow(`No repository of ${docs.id} is a git repository; AI QA needs one`);
  });

  it('skips repositories that are not git repositories and says so', () => {
    const s = setup();
    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    addWork(s.h);
    addWork(s.h, s.h.req.id, {}, 'goal', 'docs');
    s.toQa();
    const view = s.qa.start(s.h.req.id, 'manual');
    expect(view.runs.map((r) => r.project)).toEqual(['backend']);
    expect(view.skipped).toEqual([{ project: 'docs', reason: 'not a git repository' }]);
  });

  it('fails at once when no AI CLI can run QA', () => {
    const s = setup();
    s.h.settingsService.updateLocalEngineSettings({ enabled: false });
    const { task } = started(s);
    expect(task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: the Local AI CLI engine is turned off (Settings → AI & Local Engines)' });
    expect(s.runOf(task.id)).toBeUndefined();
    expect(s.qa.status(s.h.req.id).running).toBe(false);

    const other = setup();
    other.h.settingsService.updateAiQaSettings({ agentCli: 'codex-cli' });
    expect(started(other).task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: Codex is chosen for AI QA but is not installed on this PC' });
  });

  it('starts on entering QA only when Run automatically is on', () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    s.h.settingsService.updateAiQaSettings({ runAutomatically: false });
    s.qa.onEnteredQa(s.h.req.id, {});
    expect(s.qa.status(s.h.req.id).round).toBe(0);
    s.h.settingsService.updateAiQaSettings({ runAutomatically: true });
    s.qa.onEnteredQa(s.h.req.id, {});
    expect(s.qa.status(s.h.req.id).round).toBe(1);
    expect(() => s.qa.onEnteredQa(s.h.req.id, {})).not.toThrow(); // already running: logged, not thrown
  });
});

describe('AI QA: findings and result', () => {
  it("saves a finding as an open AI QA comment on the repository's goal card", () => {
    const s = setup();
    const { goalId, task, runId } = started(s);
    expect(s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved', body: 'POST /rides answers 500', file_path: 'src/rides.ts', line: 12 }, 'backend', runId))
      .toMatchObject({ duplicate: false });
    expect(s.comments()).toEqual([
      expect.objectContaining({
        task_id: goalId, state: 'open', source: 'ai-qa', severity: 'blocker', file_path: 'src/rides.ts', line: 12, qa_task_id: task.id,
        body_md: '**Rides are not saved**\n\nPOST /rides answers 500',
      }),
    ]);
    expect(s.h.logText(task.id)).toContain('⚑ blocker: Rides are not saved (src/rides.ts:12)');
  });

  it('puts the finding on the first ticket when the repository has no goal', () => {
    const s = setup();
    const ticketId = addWork(s.h, s.h.req.id, {}, 'ticket');
    s.toQa();
    const task = s.qa.start(s.h.req.id, 'manual').runs[0].task;
    s.qa.addFinding({ severity: 'minor', title: 'Naming is unclear' }, 'backend', s.runOf(task.id).id);
    expect(s.comments()[0]).toMatchObject({ task_id: ticketId, file_path: null, line: null, body_md: '**Naming is unclear**' });
  });

  it('saves the same finding once, refuses unsafe paths, and stops at the findings limit', () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ maxFindings: 2 });
    const { runId } = started(s);
    const first = s.qa.addFinding({ severity: 'major', title: 'Missing check', file_path: 'a.ts', line: 3 }, 'backend', runId);
    expect(s.qa.addFinding({ severity: 'major', title: '  missing   CHECK ', file_path: 'a.ts', line: 3 }, 'backend', runId)).toEqual({ commentId: first.commentId, duplicate: true });
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Outside', file_path: '../etc/passwd' }, 'backend', runId)).toThrow(/relative to the repository/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'No file', line: 4 }, 'backend', runId)).toThrow('--line needs --file');
    s.qa.addFinding({ severity: 'minor', title: 'Second one' }, 'backend', runId);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Third one' }, 'backend', runId)).toThrow('The QA run reached its limit of 2 findings');
    expect(s.comments()).toHaveLength(2);
  });

  it('refuses reports from unknown runs and once the requirement left QA', () => {
    const s = setup();
    const { runId } = started(s);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', 'local-nope')).toThrow(/^No QA run local-nope for backend/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', undefined)).toThrow(/^No QA run/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Wrong repo' }, 'mobile', runId)).toThrow(/^No QA run/);
    s.h.db.prepare("UPDATE requirements SET status = 'in_progress' WHERE id = ?").run(s.h.req.id);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Too late' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this finding was not saved`);
    expect(() => s.qa.recordResult({ passed: true, summary: 'ok' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this result was not saved`);
  });

  it('records the result, reports the header status, and a new round starts fresh', () => {
    const s = setup();
    const { task, runId } = started(s);
    s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved' }, 'backend', runId);
    s.qa.addFinding({ severity: 'minor', title: 'Naming' }, 'backend', runId);
    expect(s.qa.recordResult({ passed: false, summary: '1 blocker, 1 minor' }, 'backend', runId)).toEqual({ ok: true, passed: false, summary: '1 blocker, 1 minor' });
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(task.id);
    expect(s.qa.status(s.h.req.id)).toMatchObject({
      round: 1, running: false, findings: { total: 2, blocker: 1, major: 0, minor: 1 },
      runs: [{ project: 'backend', status: 'done', passed: false, summary: '1 blocker, 1 minor', error: null, findings: 2 }],
    });

    const next = s.qa.start(s.h.req.id, 'manual');
    expect(next).toMatchObject({ round: 2, running: true, findings: { total: 0 } });
    expect(next.runs).toHaveLength(1);
  });
});

describe('AI QA: reports through the outbox', () => {
  it('an AI QA run reports its findings and result through the outbox', async () => {
    const e = makeE2E();
    const s = setup(e);
    const req = e.requirementService.createRequirement({
      title: 'Rides', goal: 'Track rides\nFAKE: qa-comment major|src/rides.ts|7|Missing validation\nFAKE: qa-result failed|One major problem',
      acceptance_criteria: ['Rides tracked'], affected_projects: ['backend'], priority: 'normal',
    });
    addWork(e, req.id);
    s.toQa(req.id);
    const task = s.qa.start(req.id, 'manual').runs[0].task;
    await e.settle();

    const scanner = new OutboxScanner(e.projectService, e.tickets, e.questions, path.join(e.ws, 'agent-outbox'), s.qa);
    expect(await scanner.scanOnce()).toBe(2);
    expect(s.comments(req.id)).toEqual([
      expect.objectContaining({ source: 'ai-qa', severity: 'major', file_path: 'src/rides.ts', line: 7, body_md: '**Missing validation**' }),
    ]);
    expect(e.task(task.id)).toMatchObject({ status: 'done', qa_passed: 0, qa_summary: 'One major problem' });
  });

  it('rejects a late outbox finding once the requirement left QA', async () => {
    const e = makeE2E();
    const s = setup(e);
    const { runId } = started(s);
    e.db.prepare("UPDATE requirements SET status = 'in_progress' WHERE id = ?").run(e.req.id);
    const outbox = path.join(e.ws, 'agent-outbox', 'backend');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(path.join(outbox, 'qa-comment-1.json'), JSON.stringify({ kind: 'qa-comment', severity: 'minor', title: 'Late one', project: 'backend', engineTaskId: runId }));

    const scanner = new OutboxScanner(e.projectService, e.tickets, e.questions, path.join(e.ws, 'agent-outbox'), s.qa);
    expect(await scanner.scanOnce()).toBe(0);
    expect(fs.existsSync(path.join(outbox, 'qa-comment-1.json'))).toBe(false);
    expect(fs.readFileSync(path.join(outbox, 'failed', 'qa-comment-1.json.error.txt'), 'utf8')).toContain('is no longer in QA; this finding was not saved');
    expect(s.comments()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/services/qaService.test.ts`

Expected: FAIL with "Failed to load url ./qaService.js".

- [ ] **Step 4: The service** (`packages/server/src/services/qaService.ts`)

```ts
// AI QA: one QA run per git repository of a requirement in QA. The agent checks the merged code in a
// temporary checkout and reports findings (open review comments marked AI QA) and a result; a person
// decides what to send back.
import type { AiQaSettings, BridgeTask, LocalEngineStatus, Project, QaRunView, QaSeverity, RequirementQa } from '@sp-kickstack/shared';
import { QaFindingInputSchema, QaResultInputSchema } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';
import type { ProjectService } from './projectService.js';
import type { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { BranchService } from './branchService.js';
import { TaskChangesService } from './taskChanges.js';
import { isSafeRelativePath } from './reviewAssist.js';
import { RunStore } from '../localEngine/runStore.js';
import { buildQaPrompt } from '../localEngine/qaPrompt.js';
import { diffSummary, isGitWorkTree, resolveCommit } from '../lib/gitRepo.js';
import { HttpError, badRequest, conflict } from '../lib/httpError.js';
import { oneLine } from '../lib/promptSafety.js';

/** What AI QA needs from the Local AI CLI runner (AgentRunner implements it). */
export interface QaEngine {
  status(): LocalEngineStatus;
  nudge(): void;
}

export type QaEmit = (event: { type: string; req_id?: string; task_id?: number; payload: Record<string, unknown> }) => void;

export interface QaServiceOptions {
  db: AppDatabase;
  projectService: ProjectService;
  requirementService: RequirementService;
  settingsService?: SettingsService;
  branchService?: BranchService;
  /** Absent when this server runs no Local AI CLI engine: AI QA cannot start (503). */
  engine?: QaEngine;
  emit?: QaEmit;
}

const ACTIVE_STATUSES = ['pending', 'queued', 'running', 'rate_limited'];

/** Same finding = same QA run, file, line and title (case and spacing ignored). */
const titleKey = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();
/** A saved finding's title: the bold first line of its comment. */
const savedTitle = (body: string) => /^\*\*(.+?)\*\*/.exec(body)?.[1] ?? body.split('\n')[0];

export class QaService {
  private db: AppDatabase;
  private settings: SettingsService;
  private branches: BranchService;
  private taskChanges: TaskChangesService;
  private runs: RunStore;

  constructor(private opts: QaServiceOptions) {
    this.db = opts.db;
    this.settings = opts.settingsService ?? new SettingsService(opts.db);
    this.branches = opts.branchService ?? new BranchService(opts.db, opts.projectService, this.settings);
    this.taskChanges = new TaskChangesService(opts.db);
    this.runs = new RunStore(opts.db);
  }

  /** Start AI QA for every git repository of a requirement in QA. `commits`: the merged result per repository (else the branch tip). */
  public start(reqId: string, trigger: 'auto' | 'manual', commits: Record<string, string> = {}): RequirementQa {
    const req = this.opts.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
    if (req.status !== 'qa') throw conflict(`${reqId} is ${req.status}; AI QA runs while a requirement is in QA`);
    if (!this.opts.engine) throw new HttpError(503, 'The Local AI CLI engine is not running in this server');
    if (this.activeTasks(reqId).length > 0) throw conflict(`AI QA is already running for ${reqId}`);
    const projects = this.projectsOf(reqId);
    if (projects.length === 0) throw conflict(`${reqId} has no repository work to check`);
    const repos = projects.filter((p) => isGitWorkTree(p.repo_path));
    if (repos.length === 0) throw conflict(`No repository of ${reqId} is a git repository; AI QA needs one`);

    const settings = this.settings.getAiQaSettings();
    const cliProblem = this.cliProblem(settings, this.opts.engine.status());
    const round = this.lastRound(reqId) + 1;
    for (const project of repos) {
      const base = this.branches.baseBranchFor(project, reqId);
      const commit =
        commits[project.name] ?? resolveCommit(project.repo_path, `refs/heads/${base}`) ?? resolveCommit(project.repo_path, `refs/remotes/origin/${base}`);
      const taskId = this.insertTask(reqId, project.name, round, commit);
      if (!commit) {
        this.failTask(taskId, `${project.name}: branch ${base} was not found, so there is no commit to check`);
        continue;
      }
      if (cliProblem) {
        this.failTask(taskId, cliProblem);
        continue;
      }
      const changes = this.changesOf(project, reqId);
      const bodyMd = buildQaPrompt({
        reqId, title: req.title, bodyMd: req.body_md, project: project.name, commit, from: changes.from, changedFiles: changes.files,
        commands: { test: project.test_command, build: project.build_command, lint: project.lint_command },
        maxFindings: settings.maxFindings,
      });
      this.runs.create({
        bridgeTaskId: taskId, project: project.name, title: `AI QA · ${reqId}`, bodyMd, model: settings.model, effort: settings.effort,
        preferredCli: settings.agentCli === 'default' ? null : settings.agentCli,
      });
      this.log(taskId, `AI QA queued (${trigger === 'auto' ? 'the requirement entered QA' : 'Run AI QA'}) for ${commit.slice(0, 7)}`);
    }
    this.opts.emit?.({ type: 'qa_started', req_id: reqId, payload: { reqId, round, trigger, projects: repos.map((p) => p.name) } });
    this.opts.engine.nudge();
    return this.status(reqId);
  }

  /** The merge gate moved the requirement to QA: start AI QA when Settings → AI QA → Run automatically is on. Never throws. */
  public onEnteredQa(reqId: string, commits: Record<string, string>): void {
    if (!this.settings.getAiQaSettings().runAutomatically) return;
    try {
      this.start(reqId, 'auto', commits);
    } catch (err: any) {
      console.warn(`[ai-qa] ${reqId}: AI QA did not start: ${err?.message || err}`);
    }
  }

  /** `xticket comment`: an open review comment marked AI QA on the repository's card. */
  public addFinding(input: unknown, project: string, runId: string | undefined): { commentId: number; duplicate: boolean } {
    const finding = QaFindingInputSchema.parse(input);
    const qa = this.qaTaskOf(project, runId);
    this.requireQa(qa.req_id, 'finding');
    if (finding.line !== undefined && !finding.file_path) throw badRequest('--line needs --file');
    if (finding.file_path && !isSafeRelativePath(finding.file_path)) {
      throw badRequest('The file path must be relative to the repository (no leading / and no ..)');
    }
    const card = this.cardOf(qa.req_id, qa.project);
    if (!card) throw conflict(`${qa.req_id} has no task in ${qa.project} to put the finding on`);

    const title = oneLine(finding.title, 200);
    const file = finding.file_path ?? null;
    const line = finding.line ?? null;
    const same = (
      this.db.prepare('SELECT id, body_md FROM review_comments WHERE qa_task_id = ? AND file_path IS ? AND line IS ?').all(qa.id, file, line) as Array<{
        id: number;
        body_md: string;
      }>
    ).find((c) => titleKey(savedTitle(c.body_md)) === titleKey(title));
    if (same) return { commentId: same.id, duplicate: true };

    const max = this.settings.getAiQaSettings().maxFindings;
    const saved = (this.db.prepare('SELECT COUNT(*) AS n FROM review_comments WHERE qa_task_id = ?').get(qa.id) as { n: number }).n;
    if (saved >= max) throw conflict(`The QA run reached its limit of ${max} findings`);

    const body = finding.body.trim() ? `**${title}**\n\n${finding.body.trim()}` : `**${title}**`;
    const at = new Date().toISOString();
    const commentId = Number(
      this.db
        .prepare(`
          INSERT INTO review_comments (req_id, task_id, file_path, line, body_md, state, source, severity, qa_task_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'open', 'ai-qa', ?, ?, ?, ?)
        `)
        .run(qa.req_id, card.id, file, line, body, finding.severity, qa.id, at, at).lastInsertRowid
    );
    this.log(qa.id, `⚑ ${finding.severity}: ${title}${file ? ` (${file}${line ? `:${line}` : ''})` : ''}`);
    this.opts.emit?.({ type: 'qa_finding', req_id: qa.req_id, task_id: card.id, payload: { reqId: qa.req_id, project: qa.project, severity: finding.severity, commentId } });
    return { commentId, duplicate: false };
  }

  /** `xticket qa-result`: the run's verdict and summary. */
  public recordResult(input: unknown, project: string, runId: string | undefined): { ok: true; passed: boolean; summary: string } {
    const result = QaResultInputSchema.parse(input);
    const qa = this.qaTaskOf(project, runId);
    this.requireQa(qa.req_id, 'result');
    this.db
      .prepare('UPDATE bridge_tasks SET qa_passed = ?, qa_summary = ?, updated_at = ? WHERE id = ?')
      .run(result.passed ? 1 : 0, result.summary, new Date().toISOString(), qa.id);
    this.log(qa.id, `${result.passed ? '✓ AI QA passed' : '✗ AI QA found problems'}: ${oneLine(result.summary, 300)}`);
    this.opts.emit?.({ type: 'qa_result', req_id: qa.req_id, task_id: qa.id, payload: { reqId: qa.req_id, project: qa.project, passed: result.passed } });
    return { ok: true, passed: result.passed, summary: result.summary };
  }

  /** The requirement header: the latest QA round, per repository. */
  public status(reqId: string): RequirementQa {
    if (!this.opts.requirementService.getRequirement(reqId)) throw new HttpError(404, `Requirement ${reqId} not found`);
    const round = this.lastRound(reqId);
    const tasks = round
      ? (this.db.prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND role = 'qa' AND revision = ? ORDER BY project, id").all(reqId, round) as BridgeTask[])
      : [];
    const findings = { total: 0, blocker: 0, major: 0, minor: 0 };
    const runs: QaRunView[] = tasks.map((task) => {
      const counts = this.db
        .prepare('SELECT severity, COUNT(*) AS n FROM review_comments WHERE qa_task_id = ? GROUP BY severity')
        .all(task.id) as Array<{ severity: QaSeverity; n: number }>;
      let mine = 0;
      for (const c of counts) {
        mine += c.n;
        findings.total += c.n;
        if (c.severity in findings) findings[c.severity] += c.n;
      }
      return {
        task, project: task.project, status: task.status, passed: task.qa_passed == null ? null : task.qa_passed === 1,
        summary: task.qa_summary ?? null, error: task.last_error ?? null, findings: mine,
      };
    });
    const skipped = round
      ? this.projectsOf(reqId).filter((p) => !isGitWorkTree(p.repo_path)).map((p) => ({ project: p.name, reason: 'not a git repository' }))
      : [];
    return { reqId, round, running: tasks.some((t) => ACTIVE_STATUSES.includes(t.status)), runs, skipped, findings };
  }

  /** Enabled repositories with goal or ticket work in the requirement. */
  private projectsOf(reqId: string): Project[] {
    const rows = this.db
      .prepare("SELECT DISTINCT project FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled' ORDER BY project")
      .all(reqId) as Array<{ project: string }>;
    return rows.map((r) => this.opts.projectService.getProject(r.project)).filter((p): p is Project => Boolean(p?.enabled));
  }

  private activeTasks(reqId: string): number[] {
    const marks = ACTIVE_STATUSES.map(() => '?').join(', ');
    return (
      this.db.prepare(`SELECT id FROM bridge_tasks WHERE req_id = ? AND role = 'qa' AND status IN (${marks})`).all(reqId, ...ACTIVE_STATUSES) as Array<{ id: number }>
    ).map((r) => r.id);
  }

  private lastRound(reqId: string): number {
    return (this.db.prepare("SELECT MAX(revision) AS r FROM bridge_tasks WHERE req_id = ? AND role = 'qa'").get(reqId) as { r: number | null }).r ?? 0;
  }

  private insertTask(reqId: string, project: string, round: number, commit: string | null): number {
    const at = new Date().toISOString();
    return Number(
      this.db
        .prepare(`
          INSERT INTO bridge_tasks (req_id, project, role, title, status, base_sha, revision, created_at, updated_at)
          VALUES (?, ?, 'qa', ?, 'queued', ?, ?, ?, ?)
        `)
        .run(reqId, project, `AI QA · ${project}`, commit, round, at, at).lastInsertRowid
    );
  }

  private failTask(taskId: number, reason: string) {
    this.db.prepare("UPDATE bridge_tasks SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(reason, new Date().toISOString(), taskId);
    this.log(taskId, `✗ ${reason}`);
  }

  /** Why no AI CLI can run QA now (the engine's own wording), or null. */
  private cliProblem(settings: AiQaSettings, engine: LocalEngineStatus): string | null {
    if (!engine.enabled) return 'No AI CLI can run QA: the Local AI CLI engine is turned off (Settings → AI & Local Engines)';
    if (settings.agentCli === 'default') return engine.cli ? null : `No AI CLI can run QA: ${engine.problem ?? 'no AI CLI is installed and turned on'}`;
    const cli = engine.clis.find((c) => c.id === settings.agentCli);
    if (cli?.installed && cli.enabled) return null;
    const why = cli?.enabled === false ? 'is turned off in Settings → AI & Local Engines' : 'is not installed on this PC';
    return `No AI CLI can run QA: ${cli?.label ?? settings.agentCli} is chosen for AI QA but ${why}`;
  }

  /** Files the requirement changed in the repository: from its merge commits (branches may be deleted), else from its unmerged branches. */
  private changesOf(project: Project, reqId: string): { files: string[]; from: string | null } {
    const tasks = this.db
      .prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND project = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled' ORDER BY id")
      .all(reqId, project.name) as BridgeTask[];
    const files = new Set<string>();
    let from: string | null = null;
    for (const t of tasks) {
      if (t.merge_sha) {
        const parent = resolveCommit(project.repo_path, `${t.merge_sha}^1`);
        if (!parent) continue;
        from ??= parent;
        for (const f of diffSummary(project.repo_path, parent, t.merge_sha)) files.add(f.path);
      } else if (t.branch) {
        try {
          for (const f of this.taskChanges.changes(t.id).files) files.add(f.path);
        } catch {
          // The branch is gone: nothing to list for it.
        }
        from ??= t.base_sha ?? null;
      }
    }
    return { files: [...files].sort(), from };
  }

  /** The QA task an agent reports for: its run id (XTICKET_TASK) in its repository. */
  private qaTaskOf(project: string, runId: string | undefined): BridgeTask {
    const row = runId
      ? (this.db
          .prepare(`
            SELECT t.* FROM local_runs r JOIN bridge_tasks t ON t.id = r.bridge_task_id
            WHERE r.id = ? AND r.project = ? AND t.role = 'qa'
          `)
          .get(runId, project) as BridgeTask | undefined)
      : undefined;
    if (!row) throw new HttpError(404, `No QA run ${runId ?? '(XTICKET_TASK is not set)'} for ${project}; findings come from AI QA runs`);
    return row;
  }

  private requireQa(reqId: string, what: 'finding' | 'result') {
    const status = this.opts.requirementService.getRequirement(reqId)?.status;
    if (status !== 'qa') throw conflict(`${reqId} is no longer in QA; this ${what} was not saved`);
  }

  /** The repository's card: its goal, else its first ticket. */
  private cardOf(reqId: string, project: string): BridgeTask | undefined {
    return this.db
      .prepare(`
        SELECT * FROM bridge_tasks WHERE req_id = ? AND project = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'
        ORDER BY CASE role WHEN 'goal' THEN 0 ELSE 1 END, id LIMIT 1
      `)
      .get(reqId, project) as BridgeTask | undefined;
  }

  private log(taskId: number, message: string) {
    this.db.prepare("INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, 'system', ?, ?)").run(taskId, message, new Date().toISOString());
  }
}
```

- [ ] **Step 5: The outbox reads QA reports** (`packages/server/src/watcher/outboxScanner.ts`)

Add `import type { QaService } from '../services/qaService.js';`. Then replace `type OutboxKind = …` with:

```ts
type OutboxKind = 'question' | 'ticket' | 'qa-comment' | 'qa-result';

/** xticket names its files after the kind (question-*.json, qa-comment-*.json, …); the file's own kind wins once it parses. */
function kindFromName(file: string): OutboxKind {
  return (['question', 'qa-comment', 'qa-result'] as const).find((k) => file.startsWith(`${k}-`)) ?? 'ticket';
}

function kindFromData(data: any): OutboxKind {
  return data?.kind === 'question' || data?.kind === 'qa-comment' || data?.kind === 'qa-result' ? data.kind : 'ticket';
}
```

Add a fifth constructor parameter after `agentOutboxRoot`:

```ts
    /** AI QA findings and results queued by `xticket comment` / `xticket qa-result`. */
    private qaService?: QaService
```

In `scanAll`:
- Replace the two kind lines with `let kind: OutboxKind = kindFromName(file);` and, after `JSON.parse`, `kind = kindFromData(data);`. Delete the old comment above them.
- Replace the `if (kind === 'question') { … } else { … }` block with:

```ts
            if (kind === 'question') {
              if (!this.questionService) throw Object.assign(new Error('This bridge does not take questions'), { status: 400 });
              // Idempotent: a re-scan returns the same question.
              await this.questionService.ask(AskQuestionInputSchema.parse(data), sourceProject, sourceTaskId);
            } else if (kind === 'qa-comment' || kind === 'qa-result') {
              if (!this.qaService) throw Object.assign(new Error('This bridge does not take AI QA reports'), { status: 400 });
              // Idempotent: the same finding is saved once; a result is overwritten with itself.
              if (kind === 'qa-comment') this.qaService.addFinding(data, sourceProject, sourceTaskId);
              else this.qaService.recordResult(data, sourceProject, sourceTaskId);
            } else {
              // Idempotent: a re-scan after a partial failure returns the same ticket.
              await this.ticketService.createTicket(CreateTicketInputSchema.parse(data), sourceProject, sourceTaskId);
            }
```

`QaService` errors carry status 400/404/409, and zod errors carry `issues`, so `isPermanent` already moves those files to `failed/` with the reason.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/services/qaService.test.ts packages/server/src/services/phase4.test.ts packages/server/src/services/questions.test.ts packages/server/src/regressions.test.ts && npx tsc --noEmit -p packages/server`

Expected: PASS. That covers the 15 new tests and the existing outbox tests (tickets and questions), with no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/qaService.ts packages/server/src/services/qaService.test.ts packages/server/src/watcher/outboxScanner.ts packages/server/src/testing/fakeAgentCli.mjs
git commit -m "feat(server): AI QA service (start, findings, result, status) and outbox reports"
```

---
### Task 6: Routes, the merge gate hook, the graph, and the wiring

**Files:**
- Modify: `packages/server/src/services/mergeGate.ts` (`MergeGateOptions` `:18-31`, `finishSuccess` `:342-391`)
- Modify: `packages/server/src/services/branchMerge.test.ts` (new test in `describe('Merge gate', …)`)
- Modify: `packages/server/src/api/humanLoopRoutes.ts`
- Modify: `packages/server/src/api/app.ts` (`AppDependencies`, service setup `:127-136`, graph route `:496-505`, `registerHumanLoopRoutes` call `:932`)
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/api/aiQaRoutes.test.ts`

**Interfaces:**
- Consumes: `QaService` (Task 5): `start`, `onEnteredQa`, `addFinding`, `recordResult`, `status`. Also `OutboxScanner`'s fifth argument.
- Produces:
  - `MergeGateOptions.onEnteredQa?: (reqId: string, commits: Record<string, string>) => void`. It is called once after a successful merge has moved the requirement to QA, with `{ [project]: resultSha }`.
  - Routes:
    - `POST /api/agent/qa/comments` (agent token) → 201 `{ commentId, duplicate }`.
    - `POST /api/agent/qa/result` (agent token) → 200 `{ ok, passed, summary }`.
    - `GET /api/requirements/:id/qa` → `RequirementQa`.
    - `POST /api/requirements/:id/qa` → 202 `RequirementQa`.
  - `AppDependencies.qaService?: QaService`.
  - The graph leaves out `role = 'qa'` tasks.

- [ ] **Step 1: Write the failing tests**

`packages/server/src/api/aiQaRoutes.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createApp } from './app.js';
import { testRequest } from './testHelper.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { QaService } from '../services/qaService.js';
import { cleanLocalHarnesses } from '../testing/localEngineFixture.js';
import { makeE2E, type LocalE2E } from '../testing/localEngineE2E.js';

afterAll(() => cleanLocalHarnesses());

function appFor(h: LocalE2E, extra: { agentToken?: string; withEngine?: boolean } = {}) {
  const engine = extra.withEngine === false ? undefined : { status: () => h.runner.status(), nudge: () => {} };
  const qaService = new QaService({ db: h.db, projectService: h.projectService, requirementService: h.requirementService, settingsService: h.settingsService, engine });
  return createApp({
    db: h.db, workspaceService: new WorkspaceService(h.db), projectService: h.projectService, requirementService: h.requirementService,
    fanOutService: h.fanOut, linkService: h.linkService, ticketService: h.tickets, broadcaster: new SseBroadcaster(), notifier: new Notifier(),
    getAdapter: h.getAdapter, settingsService: h.settingsService, localEngine: h.runner, qaService, agentToken: extra.agentToken,
  });
}

/** h.req in QA with one goal on backend. */
function inQa(h: LocalE2E): number {
  const now = new Date().toISOString();
  const goalId = Number(
    h.db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'goal', 'Ride tracking', 'done', ?, ?)")
      .run(h.req.id, now, now).lastInsertRowid
  );
  h.db.prepare("UPDATE requirements SET status = 'qa' WHERE id = ?").run(h.req.id);
  return goalId;
}

const runIdOf = (h: LocalE2E, taskId: number) => (h.db.prepare('SELECT id FROM local_runs WHERE bridge_task_id = ?').get(taskId) as { id: string }).id;

describe('AI QA routes', () => {
  it('Run AI QA starts QA (202), refuses while it runs (409), and reports the status', async () => {
    const h = makeE2E();
    const app = appFor(h);
    inQa(h);
    expect(await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).toMatchObject({ status: 202, body: { round: 1, running: true } });
    expect(await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).toMatchObject({
      status: 409, body: { error: `AI QA is already running for ${h.req.id}` },
    });
    expect((await testRequest(app, 'GET', `/api/requirements/${h.req.id}/qa`)).body).toMatchObject({ round: 1, runs: [{ project: 'backend', status: 'queued' }] });
    expect((await testRequest(app, 'GET', '/api/requirements/REQ-999/qa')).status).toBe(404);
  });

  it('answers 503 when the server runs no Local AI CLI engine', async () => {
    const h = makeE2E();
    inQa(h);
    expect((await testRequest(appFor(h, { withEngine: false }), 'POST', `/api/requirements/${h.req.id}/qa`)).status).toBe(503);
  });

  it('agents report findings and the result with the agent token', async () => {
    const h = makeE2E();
    const app = appFor(h, { agentToken: 'secret' });
    const goalId = inQa(h);
    const task = (await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).body.runs[0].task;
    const runId = runIdOf(h, task.id);
    const headers = { authorization: 'Bearer secret' };
    const finding = { severity: 'major', title: 'Missing validation', file_path: 'src/a.ts', line: 2, project: 'backend', engineTaskId: runId };

    expect((await testRequest(app, 'POST', '/api/agent/qa/comments', { body: finding })).status).toBe(401);
    expect(await testRequest(app, 'POST', '/api/agent/qa/comments', { body: finding, headers })).toMatchObject({ status: 201, body: { duplicate: false } });
    expect(await testRequest(app, 'POST', '/api/agent/qa/result', { body: { passed: false, summary: 'One major', project: 'backend', engineTaskId: runId }, headers }))
      .toMatchObject({ status: 200, body: { passed: false } });
    expect((await testRequest(app, 'GET', `/api/requirements/${h.req.id}/comments`)).body).toEqual([
      expect.objectContaining({ task_id: goalId, source: 'ai-qa', severity: 'major', state: 'open', file_path: 'src/a.ts', line: 2 }),
    ]);
    expect((await testRequest(app, 'POST', '/api/agent/qa/comments', { body: { ...finding, engineTaskId: 'local-nope' }, headers })).status).toBe(404);
    expect((await testRequest(app, 'POST', '/api/agent/qa/comments', { body: { ...finding, severity: 'huge' }, headers })).status).toBe(400);
  });

  it('keeps AI QA tasks out of the requirement graph', async () => {
    const h = makeE2E();
    const app = appFor(h);
    inQa(h);
    await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`);
    const graph = (await testRequest(app, 'GET', `/api/requirements/${h.req.id}/graph`)).body;
    expect(graph.tasks.map((t: any) => t.role)).toEqual(['goal']);
  });
});
```

In `packages/server/src/services/branchMerge.test.ts`, add inside `describe('Merge gate', …)`, after the `merges every task branch…` test:

```ts
  it('hands each merged commit to AI QA once the requirement is in QA, and nothing when the merge fails', async () => {
    h = makeGitHarness();
    const calls: Array<{ reqId: string; commits: Record<string, string> }> = [];
    const gate = new MergeGateService(h.db, h.projectService, h.requirementService, h.reactor, {
      getAdapter: (name: string) => h.adapters[name] ?? h.adapters.backend,
      testTimeoutMs: 20_000,
      tmpRoot: path.join(h.ws, 'tmp'),
      onEnteredQa: (reqId, commits) => calls.push({ reqId, commits }),
    });
    const { req } = await readyForGate();
    expect((await gate.start(req.id, 'manual').done).ok).toBe(true);
    expect(calls).toEqual([
      { reqId: req.id, commits: { backend: headOf(h.backendRepo.repo, 'develop'), mobile: headOf(h.mobileRepo.repo, 'develop') } },
    ]);

    const failing = await readyForGate(['backend']);
    h.projectService.updateProject('backend', { test_command: 'exit 3' });
    expect((await gate.start(failing.req.id, 'manual').done).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/api/aiQaRoutes.test.ts packages/server/src/services/branchMerge.test.ts`

Expected: FAIL. The QA routes answer 404, the graph lists the `qa` task, and `calls` stays empty: `onEnteredQa` is not called yet, and TypeScript does not stop vitest.

- [ ] **Step 3: The merge gate hook** (`packages/server/src/services/mergeGate.ts`)

Add to `MergeGateOptions`:

```ts
  /** The requirement entered QA: each merged repository's result commit (AI QA checks it). */
  onEnteredQa?: (reqId: string, commits: Record<string, string>) => void;
```

In `finishSuccess`, between `this.reactor.recordEvent('merge_succeeded', …);` and the last `UPDATE requirements SET merge_state = 'idle' …`:

```ts
    if (movedToQa) {
      try {
        this.options.onEnteredQa?.(reqId, Object.fromEntries(prepared.map((p) => [p.project.name, p.resultSha])));
      } catch (err: any) {
        console.warn(`[merge] ${reqId}: AI QA did not start: ${err?.message || err}`);
      }
    }
```

- [ ] **Step 4: Routes** (`packages/server/src/api/humanLoopRoutes.ts`)

- Add `import type { QaService } from '../services/qaService.js';`.
- Add `qaService: QaService;` to `HumanLoopRouteDeps`.
- Add these routes after the `POST /api/agent/questions` route:

```ts
  /** An agent's identity in a report: its repository and run (XTICKET_PROJECT / XTICKET_TASK). */
  const agentOf = (body: any) => ({
    project: typeof body?.project === 'string' && body.project ? body.project : 'unknown',
    runId: typeof body?.engineTaskId === 'string' ? body.engineTaskId : undefined,
  });

  app.post('/api/agent/qa/comments', deps.requireAgentToken, (req, res, next) => {
    try {
      const { project, runId } = agentOf(req.body);
      res.status(201).json(deps.qaService.addFinding(req.body, project, runId));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/agent/qa/result', deps.requireAgentToken, (req, res, next) => {
    try {
      const { project, runId } = agentOf(req.body);
      res.json(deps.qaService.recordResult(req.body, project, runId));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/requirements/:id/qa', (req, res, next) => {
    try {
      res.json(deps.qaService.status(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  // "Run AI QA": every git repository of the requirement, at the tip of the branch it merged into.
  app.post('/api/requirements/:id/qa', (req, res, next) => {
    try {
      res.status(202).json(deps.qaService.start(req.params.id, 'manual'));
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **Step 5: App wiring** (`packages/server/src/api/app.ts`)

- Add `import { QaService } from '../services/qaService.js';`.
- In `AppDependencies`, after `reviewService?: ReviewService;`:

```ts
  /** AI QA; built from localEngine when absent (without an engine it cannot start runs). */
  qaService?: QaService;
```

- Replace the `const mergeGate = …` statement (`:132-133`) with:

```ts
  const qaService =
    deps.qaService ||
    new QaService({
      db: deps.db, projectService: deps.projectService, requirementService: deps.requirementService, settingsService, branchService,
      engine: deps.localEngine, emit: (evt) => deps.broadcaster.broadcast(evt),
    });

  const mergeGate =
    deps.mergeGate ||
    new MergeGateService(deps.db, deps.projectService, deps.requirementService, reactor, {
      settingsService,
      onEnteredQa: (reqId, commits) => qaService.onEnteredQa(reqId, commits),
    });
```

- Graph route (`GET /api/requirements/:id/graph`):
  - in the tasks query, `role <> 'question'` → `role NOT IN ('question', 'qa')`;
  - in the links query, `d.role <> 'question'` → `d.role NOT IN ('question', 'qa')`.
- Add `qaService` to the `registerHumanLoopRoutes(app, { … })` call.

- [ ] **Step 6: Server wiring** (`packages/server/src/index.ts`)

- Add `import { QaService } from './services/qaService.js';`.
- Replace the `const mergeGate = new MergeGateService(…)` statement with:

```ts
const qaService = new QaService({
  db, projectService, requirementService, settingsService, branchService, engine: localEngine, emit: (evt) => broadcaster.broadcast(evt),
});
const mergeGate = new MergeGateService(db, projectService, requirementService, reactor, {
  getAdapter,
  releaseWorktree: (taskId) => localEngine.releaseWorktree(taskId),
  // Entering QA after a merge starts AI QA (Settings → AI & Local Engines → AI QA → Run automatically).
  onEnteredQa: (reqId, commits) => qaService.onEnteredQa(reqId, commits),
});
```

- `const outboxScanner = …` → `new OutboxScanner(projectService, ticketService, questionService, path.join(WORKSPACE_DIR, 'agent-outbox'), qaService)`.
- Add `qaService,` to the `createApp({ … })` call, after `questionService,`.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/api packages/server/src/services/branchMerge.test.ts && npx tsc --noEmit -p packages/server`

Expected: PASS. That covers the 4 new route tests, the merge gate test, and every existing API and merge test, with no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/mergeGate.ts packages/server/src/services/branchMerge.test.ts packages/server/src/api/humanLoopRoutes.ts packages/server/src/api/app.ts packages/server/src/index.ts packages/server/src/api/aiQaRoutes.test.ts
git commit -m "feat(server): AI QA routes; entering QA starts AI QA; the graph leaves QA tasks out"
```

---
### Task 7: Web: AI QA in the requirement header, and the finding badge

**Files:**
- Create: `packages/web/src/lib/aiQa.ts`
- Create: `packages/web/src/lib/aiQa.test.ts`
- Create: `packages/web/src/lib/aiQaApi.ts`
- Create: `packages/web/src/components/AiQaHeader.tsx`
- Modify: `packages/web/src/components/ReviewComments.tsx:103-110` (badge)
- Modify: `packages/web/src/components/RequirementDetailSheet.tsx:571` (header)
- Modify: `packages/web/src/pages/RequirementDetailPage.tsx:357-362` (header)

**Interfaces:**
- Consumes: `RequirementQa`, `QaRunView`, `QaSeverity`, `ReviewComment.source` / `severity` (Task 1); `GET` / `POST /api/requirements/:id/qa` (Task 6); `LiveTaskLogsDrawer({ task, isOpen, onClose })`; the Radix `Popover` wrappers in `components/ui/popover.tsx`.
- Produces:
  - `qaStatusLine(qa: RequirementQa | null | undefined): { text: string; tone: QaTone } | null`.
  - `findingsText(f: RequirementQa['findings']): string`.
  - `qaRunText(run: QaRunView): string`.
  - `qaBadge(c: Pick<ReviewComment, 'source' | 'severity'>): string | null`.
  - `runAiQaBlocked(status: RequirementStatus, qa: RequirementQa | undefined): string | null`.
  - `QA_TONE_STYLE` and `SEVERITY_STYLE`.
  - `fetchRequirementQa(reqId)` and `runAiQa(reqId)`.
  - `<AiQaHeader req buttonClassName? />`.
  - React Query keys: `['requirement-qa', reqId]`, `['ai-qa-settings']`.

- [ ] **Step 1: Write the failing tests** (`packages/web/src/lib/aiQa.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { findingsText, qaBadge, qaRunText, qaStatusLine, runAiQaBlocked } from './aiQa';

const run = (project: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ task: { id: 1 }, project, status, passed: null, summary: null, error: null, findings: 0, ...extra }) as any;
const qa = (runs: any[], extra: Record<string, unknown> = {}) =>
  ({
    reqId: 'REQ-1', round: 1, running: runs.some((r) => ['pending', 'queued', 'running', 'rate_limited'].includes(r.status)), runs, skipped: [],
    findings: { total: 0, blocker: 0, major: 0, minor: 0 }, ...extra,
  }) as any;

describe('AI QA header', () => {
  it('shows nothing before the first QA run', () => {
    expect(qaStatusLine(undefined)).toBeNull();
    expect(qaStatusLine(qa([], { round: 0 }))).toBeNull();
  });

  it('shows each repository while QA runs', () => {
    expect(qaStatusLine(qa([run('backend', 'done'), run('frontend', 'running')]))).toEqual({ text: 'AI QA running… (backend ✓, frontend …)', tone: 'running' });
  });

  it('counts findings and blockers', () => {
    expect(qaStatusLine(qa([run('backend', 'done', { passed: false })], { findings: { total: 3, blocker: 1, major: 2, minor: 0 } }))).toEqual({
      text: 'AI QA: 3 findings (1 blocker)', tone: 'findings',
    });
    expect(findingsText({ total: 1, blocker: 0, major: 0, minor: 1 })).toBe('1 finding');
    expect(findingsText({ total: 4, blocker: 2, major: 0, minor: 2 })).toBe('4 findings (2 blockers)');
  });

  it('says passed when every run passed without findings', () => {
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true }), run('frontend', 'done')]))).toEqual({ text: 'AI QA passed', tone: 'passed' });
  });

  it('says why a run could not finish, and which repositories were skipped', () => {
    expect(
      qaStatusLine(qa([run('backend', 'failed', { error: 'Claude Code failed: exit code 1\nmore output' })], { skipped: [{ project: 'docs', reason: 'not a git repository' }] }))
    ).toEqual({ text: 'AI QA failed: backend: Claude Code failed: exit code 1 · skipped docs: not a git repository', tone: 'failed' });
  });

  it('describes one repository run', () => {
    expect(qaRunText(run('backend', 'done', { passed: false, summary: '1 blocker', findings: 1 }))).toBe('Found problems: 1 blocker · 1 finding');
    expect(qaRunText(run('backend', 'done'))).toBe('Done');
    expect(qaRunText(run('backend', 'queued'))).toBe('Waiting to start');
    expect(qaRunText(run('backend', 'cancelled'))).toBe('Stopped');
    expect(qaRunText(run('backend', 'failed', { error: 'No AI CLI can run QA: off' }))).toBe('Failed: No AI CLI can run QA: off');
  });

  it('badges AI QA findings with their severity', () => {
    expect(qaBadge({ source: 'ai-qa', severity: 'blocker' })).toBe('AI QA · blocker');
    expect(qaBadge({ source: 'person', severity: null })).toBeNull();
  });

  it('offers Run AI QA only in QA and while nothing runs', () => {
    expect(runAiQaBlocked('in_review', undefined)).toBe('AI QA runs while the requirement is in QA');
    expect(runAiQaBlocked('qa', qa([run('backend', 'running')]))).toBe('AI QA is running');
    expect(runAiQaBlocked('qa', qa([run('backend', 'done')]))).toBeNull();
    expect(runAiQaBlocked('qa', undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/web/src/lib/aiQa.test.ts`

Expected: FAIL with "Failed to load url ./aiQa".

- [ ] **Step 3: Helpers** (`packages/web/src/lib/aiQa.ts`)

```ts
import type { QaRunView, QaSeverity, RequirementQa, RequirementStatus, ReviewComment } from '@sp-kickstack/shared';

export type QaTone = 'running' | 'passed' | 'findings' | 'failed';

const RUN_MARK: Record<string, string> = { done: '✓', failed: '✗', cancelled: '–' };

export const QA_TONE_STYLE: Record<QaTone, string> = {
  running: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300',
  passed: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  findings: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  failed: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300',
};

export const SEVERITY_STYLE: Record<QaSeverity, string> = {
  blocker: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  major: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300',
  minor: 'bg-slate-100 dark:bg-[#262732] text-slate-600 dark:text-slate-300',
};

/** "3 findings (1 blocker)", "1 finding", or '' for none. */
export function findingsText(f: RequirementQa['findings']): string {
  if (f.total === 0) return '';
  const blockers = f.blocker ? ` (${f.blocker} blocker${f.blocker === 1 ? '' : 's'})` : '';
  return `${f.total} finding${f.total === 1 ? '' : 's'}${blockers}`;
}

/** The requirement header's AI QA line (latest round), or null before the first QA run. */
export function qaStatusLine(qa: RequirementQa | null | undefined): { text: string; tone: QaTone } | null {
  if (!qa || qa.round === 0) return null;
  const skipped = qa.skipped.map((s) => `skipped ${s.project}: ${s.reason}`).join(' · ');
  const line = (text: string, tone: QaTone) => ({ text: skipped ? `${text} · ${skipped}` : text, tone });
  if (qa.running) return line(`AI QA running… (${qa.runs.map((r) => `${r.project} ${RUN_MARK[r.status] ?? '…'}`).join(', ')})`, 'running');
  const findings = findingsText(qa.findings);
  const broken = qa.runs.find((r) => r.status === 'failed' || r.status === 'cancelled');
  if (broken) {
    const reason = broken.status === 'cancelled' ? 'stopped' : (broken.error ?? 'unknown error').split('\n')[0];
    return line(`AI QA failed: ${broken.project}: ${reason}${findings ? ` · ${findings}` : ''}`, 'failed');
  }
  if (findings) return line(`AI QA: ${findings}`, 'findings');
  const notPassed = qa.runs.find((r) => r.passed === false);
  if (notPassed) return line(`AI QA: ${notPassed.project} did not pass${notPassed.summary ? `: ${notPassed.summary}` : ''}`, 'findings');
  return line('AI QA passed', 'passed');
}

/** One repository's run, for the header popover. */
export function qaRunText(run: QaRunView): string {
  const findings = run.findings ? ` · ${run.findings} finding${run.findings === 1 ? '' : 's'}` : '';
  if (run.status === 'failed') return `Failed: ${(run.error ?? 'unknown error').split('\n')[0]}${findings}`;
  if (run.status === 'cancelled') return `Stopped${findings}`;
  if (run.status === 'done') {
    const verdict = run.passed === true ? 'Passed' : run.passed === false ? 'Found problems' : 'Done';
    return `${verdict}${run.summary && run.passed !== null ? `: ${run.summary}` : ''}${findings}`;
  }
  if (run.status === 'rate_limited') return `Paused by a usage limit${findings}`;
  return `${run.status === 'running' ? 'Running' : 'Waiting to start'}${findings}`;
}

/** "AI QA · blocker" for a finding of the AI QA agent; null for a person's comment. */
export function qaBadge(c: Pick<ReviewComment, 'source' | 'severity'>): string | null {
  if (c.source !== 'ai-qa') return null;
  return c.severity ? `AI QA · ${c.severity}` : 'AI QA';
}

/** Why "Run AI QA" is disabled, or null when it can run. */
export function runAiQaBlocked(status: RequirementStatus, qa: RequirementQa | undefined): string | null {
  if (status !== 'qa') return 'AI QA runs while the requirement is in QA';
  if (qa?.running) return 'AI QA is running';
  return null;
}
```

`qaRunText` shows a done run's summary only when the agent reported a verdict. Without one, the summary is the runner's own "Finished without a result", so the popover shows `Done`. The test expects exactly that.

- [ ] **Step 4: API calls** (`packages/web/src/lib/aiQaApi.ts`)

```ts
import type { AiQaSettings, RequirementQa } from '@sp-kickstack/shared';
import { BASE } from './api.js';

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function fetchRequirementQa(reqId: string): Promise<RequirementQa> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/qa`);
}

export function runAiQa(reqId: string): Promise<RequirementQa> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/qa`, { method: 'POST' });
}

export function fetchAiQaSettings(): Promise<AiQaSettings> {
  return request(`${BASE}/settings/ai-qa`);
}

export function saveAiQaSettings(patch: Partial<AiQaSettings>): Promise<AiQaSettings> {
  return request(`${BASE}/settings/ai-qa`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
```

- [ ] **Step 5: The header component** (`packages/web/src/components/AiQaHeader.tsx`)

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ScrollText, ShieldCheck } from 'lucide-react';
import type { BridgeTask, Requirement } from '@sp-kickstack/shared';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { LiveTaskLogsDrawer } from './LiveTaskLogsDrawer.js';
import { fetchRequirementQa, runAiQa } from '../lib/aiQaApi.js';
import { QA_TONE_STYLE, qaRunText, qaStatusLine, runAiQaBlocked } from '../lib/aiQa.js';

const RUN_BUTTON =
  'flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs font-bold shadow-xs active:scale-[0.98] transition-all disabled:opacity-50';

/** Requirement header, in QA: the AI QA status (each repository's run and log) and "Run AI QA". */
export function AiQaHeader({ req, buttonClassName }: { req: Requirement; buttonClassName?: string }) {
  const queryClient = useQueryClient();
  const inQa = req.status === 'qa';
  const { data: qa } = useQuery({
    queryKey: ['requirement-qa', req.id],
    queryFn: () => fetchRequirementQa(req.id),
    enabled: inQa,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const [logTask, setLogTask] = useState<BridgeTask | null>(null);
  const findings = qa?.findings.total ?? 0;
  useEffect(() => {
    // New findings are review comments on the repository cards.
    if (findings > 0) void queryClient.invalidateQueries({ queryKey: ['review-comments', req.id] });
  }, [findings, req.id, queryClient]);
  const run = useMutation({
    mutationFn: () => runAiQa(req.id),
    onSuccess: (next) => {
      queryClient.setQueryData(['requirement-qa', req.id], next);
      toast.success(`AI QA started for ${req.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  if (!inQa) return null;

  const line = qaStatusLine(qa);
  const blocked = runAiQaBlocked(req.status, qa);
  return (
    <>
      {line && qa && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" title={line.text} className={`max-w-xs truncate px-3 py-1.5 rounded-lg text-xs font-semibold ${QA_TONE_STYLE[line.tone]}`}>
              <ShieldCheck className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
              {line.text}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2 space-y-1">
            <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">AI QA · round {qa.round}</p>
            {qa.runs.map((r) => (
              <div key={r.task.id} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-slate-50 dark:hover:bg-[#262732]">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{r.project}</p>
                  <p className="text-[11px] text-slate-500 break-words">{qaRunText(r)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLogTask(r.task)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#7b68ee]"
                  title={`Open the AI QA log of ${r.project}`}
                >
                  <ScrollText className="w-3 h-3" />
                  Log
                </button>
              </div>
            ))}
            {qa.skipped.map((s) => (
              <p key={s.project} className="px-1.5 text-[11px] text-slate-500">
                Skipped {s.project}: {s.reason}
              </p>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={Boolean(blocked) || run.isPending}
        title={blocked ?? "Check every repository's merged code with an AI agent: acceptance criteria, code review, test / build / lint"}
        className={buttonClassName ?? RUN_BUTTON}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>{run.isPending ? 'Starting…' : 'Run AI QA'}</span>
      </button>
      <LiveTaskLogsDrawer task={logTask} isOpen={Boolean(logTask)} onClose={() => setLogTask(null)} />
    </>
  );
}
```

- [ ] **Step 6: Place it and badge the findings**

`packages/web/src/components/RequirementDetailSheet.tsx`:
- Add `import { AiQaHeader } from './AiQaHeader.js';`.
- After `<RequirementGitReviewButton req={req} tasks={graph?.tasks ?? []} />` (`:571`), add:

```tsx
                {/* AI QA: status of each repository's QA run, and Run AI QA (in QA) */}
                <AiQaHeader req={req} />
```

`packages/web/src/pages/RequirementDetailPage.tsx`:
- Add `import { AiQaHeader } from '../components/AiQaHeader.js';`.
- After the `<RequirementGitReviewButton … />` element (`:358-362`), add:

```tsx
          {/* AI QA: status of each repository's QA run, and Run AI QA (in QA) */}
          <AiQaHeader
            req={req}
            buttonClassName="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-lg text-xs font-bold shadow-md shadow-violet-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
          />
```

`packages/web/src/components/ReviewComments.tsx`:
- Add `import { SEVERITY_STYLE, qaBadge } from '../lib/aiQa.js';`.
- In the comment header, after the state badge `<span …>{c.state}{c.round ? … : ''}</span>`, add:

```tsx
            {qaBadge(c) && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERITY_STYLE[c.severity ?? 'minor']}`} title="Found by the AI QA agent">
                {qaBadge(c)}
              </span>
            )}
```

- [ ] **Step 7: Run the tests, the typecheck and the build**

Run: `(cd packages/shared && npx tsc -p .) && npx vitest run packages/web/src && (cd packages/web && npx tsc --noEmit && npx vite build)`

Expected: the web tests PASS (the 8 new ones included), typecheck is clean (`noUnusedLocals` included), and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/aiQa.ts packages/web/src/lib/aiQa.test.ts packages/web/src/lib/aiQaApi.ts packages/web/src/components/AiQaHeader.tsx packages/web/src/components/ReviewComments.tsx packages/web/src/components/RequirementDetailSheet.tsx packages/web/src/pages/RequirementDetailPage.tsx
git commit -m "feat(web): AI QA status and Run AI QA in the requirement header; AI QA badge on findings"
```

---

### Task 8: Web: the AI QA settings card, and the Build / Lint command fields

**Files:**
- Modify: `packages/web/src/lib/aiQa.ts`, `packages/web/src/lib/aiQa.test.ts`
- Create: `packages/web/src/components/AiQaSettingsSection.tsx`
- Modify: `packages/web/src/pages/SettingsPage.tsx` (import near `:55`; card after the Local AI CLI engine card, `:2400-2412`)
- Modify: `packages/web/src/pages/ProjectsPage.tsx` (state `:73`, `:89`; `openEdit` `:163`; reset `:195`; payloads `:256`, `:276`; details `:873-878`; edit form `:1101-1112`; create form `:1299-1310`)

**Interfaces:**
- Consumes:
  - From Task 7: `fetchAiQaSettings`, `saveAiQaSettings`.
  - Existing: `fetchLocalEngineStatus`, `AGENT_CLI_CHOICES`, `installBadge`, `limitBadge`, `isValidModel`, and `AgentProfileFields({ value, onChange, defaultTitle?, defaultChipLabel? })`.
- Produces:
  - `aiQaDraftProblem(draft: AiQaSettings): string | null`.
  - `qaCliStatus(agentCli: AiQaSettings['agentCli'], status: LocalEngineStatus | undefined): { text: string; good: boolean } | null`.
  - `<AiQaSettingsSection />`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/src/lib/aiQa.test.ts` (and add `aiQaDraftProblem, qaCliStatus` to its import):

```ts
describe('AI QA settings', () => {
  const draft = { runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30 } as const;

  it('checks a draft like the server', () => {
    expect(aiQaDraftProblem({ ...draft })).toBeNull();
    expect(aiQaDraftProblem({ ...draft, timeLimitMinutes: 2 })).toBe('Time limit must be a whole number of minutes from 5 to 240.');
    expect(aiQaDraftProblem({ ...draft, maxFindings: 0 })).toBe('Maximum findings must be a whole number from 1 to 200.');
    expect(aiQaDraftProblem({ ...draft, model: 'bad model' })).toBe('Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus');
  });

  it('shows which CLI runs QA, with its live badges', () => {
    const status = {
      enabled: true, cli: 'claude-cli', problem: null, maxParallel: 2, worktreeRoot: '/w',
      counts: { running: 0, queued: 0, held: 0, rate_limited: 0 },
      clis: [
        { id: 'claude-cli', label: 'Claude Code', installed: true, enabled: true, pausedUntil: null },
        { id: 'codex-cli', label: 'Codex', installed: false, enabled: true, pausedUntil: null },
      ],
    } as any;
    expect(qaCliStatus('default', status)).toEqual({ text: 'AI QA runs with Claude Code · Installed on PC · HEALTHY', good: true });
    expect(qaCliStatus('codex-cli', status)).toEqual({ text: 'AI QA runs with Codex · Not Detected · HEALTHY', good: false });
    expect(qaCliStatus('default', { ...status, enabled: false })).toEqual({ text: 'The Local AI CLI engine is turned off: AI QA cannot run', good: false });
    expect(qaCliStatus('default', { ...status, cli: null, problem: 'No AI CLI is installed' })).toEqual({ text: 'No AI CLI is installed', good: false });
    expect(qaCliStatus('default', undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/web/src/lib/aiQa.test.ts`

Expected: FAIL with "aiQaDraftProblem is not a function" (and the same for `qaCliStatus`).

- [ ] **Step 3: Settings helpers**

In `packages/web/src/lib/aiQa.ts`:
- Change the type import to `import type { AiQaSettings, LocalEngineStatus, QaRunView, QaSeverity, RequirementQa, RequirementStatus, ReviewComment } from '@sp-kickstack/shared';`.
- Add the imports `import { isValidModel } from './agentProfile.js';` and `import { installBadge, limitBadge } from './localEngineText.js';`.
- Append:

```ts
/** What is wrong with an AI QA settings draft before saving (the server checks the same), or null. */
export function aiQaDraftProblem(draft: AiQaSettings): string | null {
  if (!Number.isInteger(draft.timeLimitMinutes) || draft.timeLimitMinutes < 5 || draft.timeLimitMinutes > 240) {
    return 'Time limit must be a whole number of minutes from 5 to 240.';
  }
  if (!Number.isInteger(draft.maxFindings) || draft.maxFindings < 1 || draft.maxFindings > 200) return 'Maximum findings must be a whole number from 1 to 200.';
  if (draft.model !== null && !isValidModel(draft.model)) return 'Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus';
  return null;
}

/** Which CLI runs AI QA, with its live badges (Installed on PC / Not Detected, HEALTHY / PAUSED). */
export function qaCliStatus(agentCli: AiQaSettings['agentCli'], status: LocalEngineStatus | undefined): { text: string; good: boolean } | null {
  if (!status) return null;
  if (!status.enabled) return { text: 'The Local AI CLI engine is turned off: AI QA cannot run', good: false };
  const id = agentCli === 'default' ? status.cli : agentCli;
  const cli = id ? status.clis.find((c) => c.id === id) : undefined;
  if (!cli) return { text: status.problem ?? 'No AI CLI can run AI QA', good: false };
  const limit = limitBadge(cli);
  return {
    text: `AI QA runs with ${cli.label} · ${installBadge(cli)} · ${limit}${cli.enabled ? '' : ' · turned off'}`,
    good: cli.installed && cli.enabled && limit === 'HEALTHY',
  };
}
```

- [ ] **Step 4: The settings card** (`packages/web/src/components/AiQaSettingsSection.tsx`)

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, ShieldCheck } from 'lucide-react';
import type { AiQaSettings } from '@sp-kickstack/shared';
import { fetchAiQaSettings, saveAiQaSettings } from '../lib/aiQaApi.js';
import { fetchLocalEngineStatus } from '../lib/localEngineApi.js';
import { AGENT_CLI_CHOICES } from '../lib/localEngineText.js';
import { aiQaDraftProblem, qaCliStatus } from '../lib/aiQa.js';
import { AgentProfileFields } from './AgentProfilePicker.js';

const input =
  'w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200';
const fieldLabel = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1';
const badge = (good: boolean) =>
  `px-1.5 py-0.5 rounded text-[10px] font-bold ${good ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`;
/** For AI QA, "default" is the Local AI CLI engine's CLI. */
const CLI_CHOICES = AGENT_CLI_CHOICES.map((c) => (c.value === 'default' ? { ...c, label: "Local engine's CLI" } : c));

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in-50 duration-150">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
        <ShieldCheck className="w-5 h-5 text-[#7b68ee]" />
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">AI QA</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Checks each repository's merged code when a requirement enters QA: acceptance criteria, code review, test / build / lint. Findings
            become review comments; you decide what to send back.
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Settings → AI & Local Engines → AI QA: the agent that checks a requirement's merged code in QA. */
export function AiQaSettingsSection() {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ['ai-qa-settings'], queryFn: fetchAiQaSettings });
  const { data: status } = useQuery({ queryKey: ['local-engine-status'], queryFn: fetchLocalEngineStatus, refetchInterval: 3000 });
  const [draft, setDraft] = useState<AiQaSettings | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (settings: AiQaSettings) => saveAiQaSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(['ai-qa-settings'], saved);
      setDraft(saved);
      toast.success('AI QA settings saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!draft) {
    return (
      <Card>
        {isError ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">Could not load the AI QA settings. Check that the server is running, then reload this page.</p>
        ) : (
          <p className="text-xs text-slate-500">Loading…</p>
        )}
      </Card>
    );
  }
  const problem = aiQaDraftProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const set = (patch: Partial<AiQaSettings>) => setDraft({ ...draft, ...patch });
  const cli = qaCliStatus(draft.agentCli, status);

  return (
    <Card>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Run automatically when a requirement enters QA</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Off: AI QA runs only when you click Run AI QA in the requirement header.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.runAutomatically}
            aria-label="Run AI QA automatically when a requirement enters QA"
            onClick={() => set({ runAutomatically: !draft.runAutomatically })}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${draft.runAutomatically ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${draft.runAutomatically ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div>
          <span className={fieldLabel} id="ai-qa-cli">CLI</span>
          <div role="radiogroup" aria-labelledby="ai-qa-cli" className="flex flex-wrap gap-1.5">
            {CLI_CHOICES.map((choice) => (
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

        <div>
          <span className={fieldLabel}>Model and effort</span>
          <AgentProfileFields
            value={{ model: draft.model, effort: draft.effort }}
            onChange={(v) => set({ model: v.model, effort: v.effort })}
            defaultChipLabel="Engine default"
            defaultTitle="Use the Local AI CLI engine's model and effort"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabel}>Time limit per QA run (minutes)</span>
            <input type="number" min={5} max={240} className={input} value={draft.timeLimitMinutes} onChange={(e) => set({ timeLimitMinutes: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Maximum findings per QA run</span>
            <input type="number" min={1} max={200} className={input} value={draft.maxFindings} onChange={(e) => set({ maxFindings: Number(e.target.value) })} />
          </label>
        </div>

        {cli && (
          <p className="flex items-center gap-2 text-xs">
            <span className={badge(cli.good)}>{cli.good ? 'READY' : 'CHECK'}</span>
            <span className="text-slate-700 dark:text-slate-300">{cli.text}</span>
          </p>
        )}

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Each repository is checked in a temporary copy of the merged commit, which is deleted afterwards; AI QA never commits, pushes or changes
          a branch. QA runs share the Local AI CLI engine's parallel limit and usage-limit pauses. Set Build and Lint commands on the Projects page.
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
            <span>{save.isPending ? 'Saving...' : 'Save AI QA'}</span>
          </button>
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 5: Place the card** (`packages/web/src/pages/SettingsPage.tsx`)

- After `import { LocalEngineSettingsSection } from '../components/LocalEngineSettingsSection.js';` add `import { AiQaSettingsSection } from '../components/AiQaSettingsSection.js';`.
- After the `{activeTab === 'ai' && ( … <LocalEngineSettingsSection /> … )}` block (it ends right after `<LocalEngineSettingsSection />` and its two closing tags), add:

```tsx
          {activeTab === 'ai' && <AiQaSettingsSection />}
```

- [ ] **Step 6: Build and Lint command fields** (`packages/web/src/pages/ProjectsPage.tsx`)

1. After `const [testCommand, setTestCommand] = useState('');` add:

```tsx
  const [buildCommand, setBuildCommand] = useState('');
  const [lintCommand, setLintCommand] = useState('');
```

2. After `const [editTestCommand, setEditTestCommand] = useState('');` add:

```tsx
  const [editBuildCommand, setEditBuildCommand] = useState('');
  const [editLintCommand, setEditLintCommand] = useState('');
```

3. In the edit opener, after `setEditTestCommand(proj.test_command || '');` add:

```tsx
    setEditBuildCommand(proj.build_command || '');
    setEditLintCommand(proj.lint_command || '');
```

4. In `createMutation`'s `onSuccess` reset, after `setTestCommand('');` add `setBuildCommand('');` and `setLintCommand('');`.

5. In the create payload, after `test_command: testCommand.trim() || undefined,` add:

```tsx
      build_command: buildCommand.trim() || undefined,
      lint_command: lintCommand.trim() || undefined,
```

6. In the update payload, after `test_command: editTestCommand.trim() || undefined,` add the lines below. `null` clears a field; `undefined` would keep the old value.

```tsx
        build_command: editBuildCommand.trim() || null,
        lint_command: editLintCommand.trim() || null,
```

7. In the details view, after the `{selectedProject.test_command && ( … )}` block add:

```tsx
              {(['build_command', 'lint_command'] as const).map((field) =>
                selectedProject[field] ? (
                  <div key={field} className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">{field === 'build_command' ? 'Build Command' : 'Lint Command'}</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 font-mono">{selectedProject[field]}</p>
                  </div>
                ) : null
              )}
```

8. In the edit form, after the **Test Command (Optional)** `<div>…</div>` block (the one bound to `editTestCommand`) add:

```tsx
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Build Command (Optional)
                </label>
                <input
                  type="text"
                  value={editBuildCommand}
                  onChange={(e) => setEditBuildCommand(e.target.value)}
                  placeholder="npm ci && npm run build"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Lint Command (Optional)
                </label>
                <input
                  type="text"
                  value={editLintCommand}
                  onChange={(e) => setEditLintCommand(e.target.value)}
                  placeholder="npm ci && npm run lint"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>
```

9. In the create form, after the **Test Command (Optional)** block bound to `testCommand`, add the same two blocks bound to `buildCommand` / `setBuildCommand` and `lintCommand` / `setLintCommand`.

- [ ] **Step 7: Run the tests, the typecheck and the build**

Run: `npx vitest run packages/web/src && (cd packages/web && npx tsc --noEmit && npx vite build)`

Expected: PASS (the 2 new settings tests included). Typecheck is clean and the build succeeds.

- [ ] **Step 8: Check the screens in the running app**

With the user's dev server (web `http://localhost:4101`), check three things:
- `/w/<workspace>/settings?tab=ai` shows the **AI QA** card under the Local AI CLI engine card. Toggling **Run automatically** and saving shows "AI QA settings saved".
- `/w/<workspace>/projects`: editing a project shows **Build Command** and **Lint Command**, and saving keeps them.
- A requirement in QA shows **Run AI QA** in the side panel and on the full page.

If the dev server is not running, note that in the ledger and rely on Step 7. Never start or stop the user's dev server by pattern.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/aiQa.ts packages/web/src/lib/aiQa.test.ts packages/web/src/components/AiQaSettingsSection.tsx packages/web/src/pages/SettingsPage.tsx packages/web/src/pages/ProjectsPage.tsx
git commit -m "feat(web): AI QA settings card; Build and Lint command fields"
```

---

### Task 9: Docs, desktop bundle, dev server, full check

**Files:**
- Modify: `docs/guide/06-review-qa-and-merge.md`, `docs/guide/09-settings-and-environment.md`, `docs/guide/02-projects-and-engines.md`, `docs/guide/10-troubleshooting.md`
- Modify (generated): `packages/desktop/src-tauri/resources/server/index.mjs`, `packages/desktop/src-tauri/resources/server/xticket.mjs`

**Interfaces:**
- Consumes: everything above (wording must match the code).
- Produces: user docs; a desktop bundle that includes AI QA.

- [ ] **Step 1: Guide 06.** In `docs/guide/06-review-qa-and-merge.md`, insert this section before `## Finish QA`:

```markdown
## AI QA

When a requirement enters QA after **Merge & move to QA**, an AI agent checks each repository's merged
code. This happens automatically when Settings → AI & Local Engines → **AI QA** → **Run automatically**
is on, which is the default. For each repository, the agent checks:

1. Each acceptance criterion: is it met by the code?
2. The changed files: bugs, missing error handling and edge cases, security problems, and breaches of the
   repository's `CLAUDE.md` / `AGENTS.md`.
3. The project's **Test Command**, **Build Command** and **Lint Command**, each only when set (see
   [02](02-projects-and-engines.md#the-test-command)).

How the agent runs:

- It uses the Local AI CLI engine's CLI, or the one chosen for AI QA.
- It works in a temporary copy of the merged commit, for every repository that is a git repository,
  whatever that repository's engine.
- It never commits, pushes or changes a branch, and the copy is deleted when the run ends.
- QA runs count toward **Parallel agents**.

The requirement header shows the result:

- `AI QA running… (backend ✓, frontend …)` while it runs.
- `AI QA: 3 findings (1 blocker)` or `AI QA passed` when it is done.
- `AI QA failed: <reason>` for a run that could not finish.
- `skipped <project>: not a git repository` for a repository it cannot check.

Click the status to see each repository's run and to open its **Log**.

### Findings

Each finding is an **open review comment** on the repository's card. It is badged **AI QA · blocker**,
**AI QA · major** or **AI QA · minor**, with the file and line when the agent named them.

- **blocker**: an acceptance criterion is not met, tests or the build fail, data loss, security.
- **major**: a real bug or a likely failure.
- **minor**: quality, naming, small gaps.

Nothing is sent to the agents by itself. Edit, resolve or delete findings like any comment, and send
the ones you keep with **Request changes** (see [From QA](#from-qa)).

### Run AI QA

**Run AI QA**, in the header while the requirement is in QA, checks every repository again, for
example after fixes were merged.

- It checks the current tip of the branch the requirement merged into: its target branch, else the
  repository's base branch.
- It is disabled while AI QA runs.
- Moving the requirement out of QA (Request changes, Done, Cancel) stops its AI QA runs.
```

In `## Finish QA`, change step 1 to:

```markdown
1. Read the AI QA findings (see [AI QA](#ai-qa)) and check the merged base branch (run the app, test the
   acceptance criteria).
```

- [ ] **Step 2: Guide 09.** In `docs/guide/09-settings-and-environment.md`, add this section after the `### Local AI CLI engine` section (before `### Git & Branch Rules`):

```markdown
### AI QA

On **AI & Local Engines**, the **AI QA** card controls the agent that checks a requirement when it enters
QA (see [AI QA](06-review-qa-and-merge.md#ai-qa)).

| Setting | Default | Meaning |
|---|---|---|
| **Run automatically when a requirement enters QA** | on | Off: AI QA runs only when you click **Run AI QA**. |
| **CLI** | **Local engine's CLI** | Which CLI runs QA. It must be installed and turned on. |
| **Model and effort** | Engine default | The model and effort for QA runs. |
| **Time limit per QA run** | 30 minutes | 5 to 240. A longer QA run is stopped and shows `AI QA failed`. |
| **Maximum findings per QA run** | 30 | 1 to 200. Further findings are refused (`The QA run reached its limit of N findings`). |

The card shows which CLI runs QA, with **Installed on PC** / **Not Detected** and **HEALTHY** /
**PAUSED until …**. AI QA needs the Local AI CLI engine to be on (**Run agents on this PC**). Click
**Save AI QA** to save.
```

- [ ] **Step 3: Guide 02.** In `docs/guide/02-projects-and-engines.md`, add these rows to the form table after the **Test Command (Optional)** row:

```markdown
   | **Build Command (Optional)** | A shell command AI QA runs to check that the project builds, for example `npm ci && npm run build`. |
   | **Lint Command (Optional)** | A shell command AI QA runs to check the code style, for example `npm ci && npm run lint`. |
```

and append this paragraph to the end of `### The test command`:

```markdown
AI QA runs the test, build and lint commands (each only when set) in its own temporary copy of the
merged commit, which also has no installed dependencies; the agent installs them when a command needs
them. A failing command becomes a **blocker** finding. See [AI QA](06-review-qa-and-merge.md#ai-qa).
```

- [ ] **Step 4: Guide 10.** In `docs/guide/10-troubleshooting.md`, add this section after `## Messages about tasks`:

```markdown
## Messages about AI QA

| Message | Meaning | What to do |
|---|---|---|
| `AI QA failed: <project>: No AI CLI can run QA: …` | The Local AI CLI engine is off, or the CLI chosen for AI QA is not installed or is turned off. | Fix it in Settings → AI & Local Engines, then click **Run AI QA**. |
| `AI QA failed: <project>: Stopped after the N minute AI QA time limit …` | The QA run took longer than the AI QA time limit. | Raise **Time limit per QA run**, then click **Run AI QA**. |
| `AI QA failed: <project>: <CLI> failed: …` | The agent stopped with an error. | Open the run's **Log** from the header status. |
| `AI QA failed: <project>: stopped` | The requirement left QA while AI QA ran. | Click **Run AI QA** once it is back in QA. |
| A run shows `Finished without a result` | The agent ended without `xticket qa-result`. | Read its findings and log; run AI QA again if needed. |
| `skipped <project>: not a git repository` | AI QA checks git repositories only. | Nothing to do. |
| `AI QA is already running for <REQ-ID>` | **Run AI QA** was clicked while QA runs. | Wait for the runs to finish. |
| `<REQ-ID> is <status>; AI QA runs while a requirement is in QA` | **Run AI QA** outside QA. | Move the requirement to QA first (**Merge & move to QA**). |
| `No repository of <REQ-ID> is a git repository; AI QA needs one` | None of the requirement's repositories can be checked. | Nothing to do. |
| `<REQ-ID> is no longer in QA; this finding was not saved` | A finding arrived after the requirement left QA. It is shown to the agent, or kept in `agent-outbox/<project>/failed/`. | Nothing to do; run AI QA again once the requirement is back in QA. |
| `The QA run reached its limit of N findings` | The agent reported more findings than allowed. | Raise **Maximum findings per QA run** if you want more. |
| `No QA run …` | `xticket comment` or `xticket qa-result` was used outside an AI QA run. | These commands are for AI QA agents only. |
```

- [ ] **Step 5: Full verification**

Run: `(cd packages/shared && npx tsc -p .) && npm run typecheck && npx vitest run 2>&1 | tail -40 && (cd packages/web && npx vite build)`

Expected: typecheck is clean and every test passes. The `aiDraft` "lists provider status" test calls real CLIs and can time out; if it does, record it and re-run that file alone. The web build succeeds.

- [ ] **Step 6: Regenerate the desktop bundle** (Rule A)

Run: `npm run desktop:bundle-server`

Expected: "✅ Server JavaScript bundle created" and "✅ xticket CLI bundle created". In the shared checkout, build it from HEAD in a clean worktree, so that nobody else's uncommitted work is bundled, then copy the two files back.

- [ ] **Step 7: Rebuild the shared package for the running dev server and check it**

Run: `(cd packages/shared && npx tsc -p .) && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" localhost:4100/api/health && curl -s localhost:4100/api/settings/ai-qa`

Expected: `200`, then the AI QA settings JSON (`"runAutomatically":true`, …).

- [ ] **Step 8: Commit**

```bash
git add docs/guide/06-review-qa-and-merge.md docs/guide/09-settings-and-environment.md docs/guide/02-projects-and-engines.md docs/guide/10-troubleshooting.md packages/desktop/src-tauri/resources/server/index.mjs packages/desktop/src-tauri/resources/server/xticket.mjs
git commit -m "docs: AI QA; build(desktop): regenerate server bundle with AI QA"
```
