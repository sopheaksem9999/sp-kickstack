# AI QA in In Review and Model by Size and Risk: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI QA runs automatically when a requirement enters **In Review**, on a merge preview of its branches. It holds the automatic merge and asks before any move to QA. It picks the model and effort per repository from the size and risk of the change.

**Architecture:**
- **Merge preview.** In In Review, `QaService` builds a preview commit for each repository (`services/mergePreview.ts`) with the merge gate's merge order, then queues the unchanged phase 1 QA run on that commit.
- **Stage.** QA tasks record their stage (`review` / `qa`). Findings, results and the runner's stop sweep follow that stage.
- **Auto-merge hold.** The merge gate asks `QaService.autoMergeHold` before an automatic merge. The runner calls `onQaFinished` so the merge can proceed once AI QA has finished.
- **Model choice.** A pure classifier (`services/qaTier.ts`) chooses light / standard / deep from the changed lines, the file count and the risky paths. The tier profiles live in the AI QA settings, per CLI.
- **Web.** The header shows in In Review, every move to QA asks first, the settings card gets Model Auto / Fixed with tiers, and Projects gets a **High-risk paths** field.

**Tech Stack:** TypeScript, Express, better-sqlite3, zod 3, git CLI, React 18, TanStack Query v5, Radix Dialog / Popover, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-ai-qa-in-review-design.md` (approved 2026-10-13). It builds on `docs/superpowers/specs/2026-10-13-ai-qa-agent-design.md` and on its phase 1 code (`a1171f5..4e747b5`).

## Global Constraints

- **Node.js v22.19.0** for every command: `source ~/.nvm/nvm.sh && nvm use 22.19.0`.
- **Shared checkout.** Another session edits this checkout (lately the AI chat files).
  - Commit exactly the paths a task lists, through a temporary index, never `git add -A`.
  - When a listed file also holds someone else's uncommitted edits, commit HEAD plus this task's hunks only.
  - Verify HEAD plus the task's files in an isolated worktree.
- **Migration number** is **12** (AI QA phase 1 took 11). The AI Chat MCP plan takes the number after it.
- **Rebuild shared after every shared change.** The server, the web typecheck and the user's running dev server (`127.0.0.1:4100` / `:4101`) read `@sp-kickstack/shared` from `packages/shared/dist`.
  - Run `(cd packages/shared && npx tsc -p .)` before server or web checks.
  - After committing shared changes, check `curl -s -o /dev/null -w "%{http_code}" localhost:4100/api/health` → `200`.
- **Never stop processes by pattern, and never write to the running dev server** in checks. Tests never contact `127.0.0.1:4100`.
- **Copy, verbatim from the spec:**
  - `<REQ> is <status>; AI QA runs while a requirement is in review or in QA`
  - `A merge of <REQ> is running; wait for it to finish`
  - `<REQ> is no longer in review; this finding was not saved` (and `… this result was not saved`)
  - `<project>: merging <branch> into <base> conflicts in a.ts, b.ts (Merge & move to QA would conflict too)`
  - `<project>: branch <branch> (task #<id>) does not exist`
  - `<project>: base branch <base> was not found`
  - `AI QA is still checking`, `N open AI QA blocker(s)`; the header shows them after `Auto-merge paused: `
  - `AI QA is still checking this requirement. Merge anyway?`
  - `N open AI QA blocker(s). Merge anyway?`
  - `■ <REQ> is no longer in review; AI QA stops`
  - `AI QA before merge` (the prefix of review-round lines)
  - `AI QA · round N · merge preview into <branch>`
  - `touches <path>`, `<n> lines in <m> files`, `no change list`
- **Defaults from the spec:**
  - `runAutomatically` is `true`; it now means *entering In Review*.
  - `modelMode` is `'auto'`.
  - Tiers:

    | CLI | light | standard | deep |
    |---|---|---|---|
    | Claude Code | `haiku`/`low` | `sonnet`/`medium` | `opus`/`high` |
    | Codex | `null`/`low` | `null`/`medium` | `null`/`high` |
    | AGY | `null`/`low` | `null`/`medium` | `null`/`high` |

  - Limits: `lightMaxLines` 150, `deepMinLines` 1000. Light also needs ≤ 8 files; 40 files or more is deep.
  - Built-in risky patterns: `**/migrations/**`, `**/auth/**`, `**/security/**`, `**/payment*/**`, `**/billing/**`, `.github/workflows/**`, `.gitlab-ci.yml`, `**/Dockerfile`, `**/docker-compose*.yml`, `**/.env*`, `**/*secret*`.
- **Plan decisions on ranges:** `lightMaxLines` 10–5000, `deepMinLines` 50–100000, and `lightMaxLines` must be below `deepMinLines`.
- **Project rules:**
  - **Rule A:** regenerate the desktop bundle at the end, from HEAD in a clean worktree.
  - **Rule B:** the new settings go in `schemas.ts` / `types.ts` and are saved by `SettingsService`, with Settings UI.
  - **Rule C:** the confirmation is a Radix Dialog.
  - **Rule G:** the preview never creates or moves a branch or ref.

## Review Focus

These five cases are implied by the spec but not covered by its testing list. Each one has a test in the task named after it.

1. **Run AI QA clicked while the automatic round is still building its previews.** The second start must be refused, with no second round. Test: Task 4, `refuses a second start while the first is still building previews`.
2. **Auto-merge when the review round fails at once** (no usable CLI, or a conflict). The hold must release, so the requirement isn't stuck In Review forever. Test: Task 4, `does not hold auto-merge when the review round failed at once`.
3. **A requirement with a target branch, in review.** The preview merges into the target branch, not the repository's base branch. Test: Task 4, `previews into the requirement's target branch`.
4. **Risky patterns and paths written differently:** a leading `./`, Windows backslashes, other letter case, a folder written with a trailing `/`. They must still match. Test: Task 2, `matches paths written with ./, backslashes or other case`.
5. **Run AI QA in QA after a review round.** It must check the real merged tip, not reuse the old preview. Test: Task 4, `a QA-stage run after a review round checks the merged tip`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/schemas.ts`, `types.ts` | `modelMode`, `tiers`, line limits, the checked settings schema; `QaStage`, `QaTier`, `QaProfile`; new fields on `BridgeTask`, `QaRunView` and `RequirementQa` |
| `packages/server/src/db/migrations.ts` | Migration 12: `qa_stage`, `qa_tier`, `qa_tier_reason` (+ backfill) |
| `packages/server/src/services/settingsService.ts` | Checked update (light < deep) |
| `packages/server/src/services/qaTier.ts` (new) | `classifyQaTier`, `matchesRiskPattern`, `qaProfileFor`, `BUILTIN_RISK_PATTERNS` |
| `packages/server/src/services/unmergedWork.ts` (new) | `unmergedWorkByProject` (moved out of the merge gate) |
| `packages/server/src/services/mergePreview.ts` (new) | `buildMergePreview` |
| `packages/server/src/services/mergeGate.ts` | Uses `unmergedWorkByProject`; `autoMergeHold` option; `onEnteredQa` removed |
| `packages/server/src/services/qaService.ts` | Async `start` with stage, preview and tier; `onEnteredReview`; stage-checked reports; `autoMergeHold`; status fields |
| `packages/server/src/localEngine/qaPrompt.ts` | Stage-specific opening |
| `packages/server/src/localEngine/agentRunner.ts` | Stage-aware stop sweep; `onQaFinished` |
| `packages/server/src/testing/localEngineFixture.ts` | `queueQaRun(…, stage)` |
| `packages/server/src/api/humanLoopRoutes.ts`, `app.ts`, `index.ts` | Awaited start; hooks wiring |
| `packages/web/src/lib/aiQa.ts` | Stage-aware lines, `mergeWarning`, `runAiQaBlocked(req, qa)`, tier text, settings helpers, `riskPathsFromText` |
| `packages/web/src/components/AiQaHeader.tsx` | Shows in In Review; round title; tier; auto-merge note |
| `packages/web/src/components/MergeAiQaConfirm.tsx` (new) | `useAskBeforeMerge()`: the question before a merge |
| `packages/web/src/components/RequirementDetailSheet.tsx`, `pages/RequirementDetailPage.tsx`, `pages/RequirementsPage.tsx` | Ask before merge (buttons, State select, board drop) |
| `packages/web/src/components/AiQaSettingsSection.tsx` | Model Auto / Fixed, tiers, limits, relabelled switch |
| `packages/web/src/pages/ProjectsPage.tsx` | High-risk paths field |
| `docs/guide/02`, `06`, `09`, `10` | Docs |

---

### Task 1: Data: settings, types, migration 12

**Files:**
- Modify: `packages/shared/src/schemas.ts` (after `UpdateAiQaSettingsInputSchema`; `AiQaSettingsSchema`)
- Modify: `packages/shared/src/types.ts` (`AiQaSettings`, `BridgeTask`, `QaRunView`, `RequirementQa`)
- Modify: `packages/shared/src/aiQa.test.ts`
- Modify: `packages/server/src/db/migrations.ts`, `packages/server/src/db/migrations.test.ts`
- Modify: `packages/server/src/services/settingsService.ts` (`updateAiQaSettings`)
- Modify: `packages/server/src/services/qaService.ts` (`status()` fills the new fields with simple values; Task 4 replaces them)
- Modify: `packages/server/src/services/aiQaSettings.test.ts`
- Modify: `packages/web/src/lib/aiQa.test.ts` (the settings draft gets the new fields, so the web typecheck stays green)

**Interfaces:**
- Produces:
  - `type QaStage = 'review' | 'qa'` and `type QaTier = 'light' | 'standard' | 'deep'`.
  - `interface QaProfile { model: string | null; effort: ReasoningEffort | null }`.
  - `interface QaTierProfiles { light: QaProfile; standard: QaProfile; deep: QaProfile }`.
  - `AiQaSettings` gains `modelMode: 'auto' | 'fixed'`, `tiers: Record<AgentCliId, QaTierProfiles>`, `lightMaxLines: number` and `deepMinLines: number`.
  - `DEFAULT_QA_TIERS` (shared).
  - `CheckedAiQaSettingsSchema`, which is `AiQaSettingsSchema` plus a refine `lightMaxLines < deepMinLines` (path `lightMaxLines`).
  - `BridgeTask` gains `qa_stage?: QaStage | null`, `qa_tier?: QaTier | null` and `qa_tier_reason?: string | null`.
  - `QaRunView` gains `tier: QaTier | null` and `tierReason: string | null`.
  - `RequirementQa` gains `stage: QaStage | null`, `previewInto: string | null`, `openBlockers: number` and `autoMergeHold: string | null`.
  - DB columns `bridge_tasks.qa_stage`, `qa_tier`, `qa_tier_reason`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/aiQa.test.ts`:
- Add `DEFAULT_QA_TIERS, CheckedAiQaSettingsSchema` to the import from `./schemas.js`.
- Replace the test `defaults the AI QA settings` with:

```ts
  it('defaults the AI QA settings', () => {
    expect(AiQaSettingsSchema.parse({})).toEqual({
      runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
      modelMode: 'auto', tiers: DEFAULT_QA_TIERS, lightMaxLines: 150, deepMinLines: 1000,
    });
    expect(DEFAULT_QA_TIERS['claude-cli']).toEqual({
      light: { model: 'haiku', effort: 'low' }, standard: { model: 'sonnet', effort: 'medium' }, deep: { model: 'opus', effort: 'high' },
    });
    expect(DEFAULT_QA_TIERS['codex-cli'].deep).toEqual({ model: null, effort: 'high' });
  });

  it('reads a phase 1 value with the new defaults, and checks the line limits', () => {
    expect(AiQaSettingsSchema.parse({ runAutomatically: false, timeLimitMinutes: 45 })).toMatchObject({ runAutomatically: false, modelMode: 'auto', lightMaxLines: 150 });
    expect(() => UpdateAiQaSettingsInputSchema.parse({ lightMaxLines: 5 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ deepMinLines: 10 })).toThrow();
    expect(() => UpdateAiQaSettingsInputSchema.parse({ modelMode: 'smart' })).toThrow();
    expect(() => CheckedAiQaSettingsSchema.parse({ lightMaxLines: 900, deepMinLines: 800 })).toThrow(/lightMaxLines must be lower than deepMinLines/);
    const badTier = { ...DEFAULT_QA_TIERS, 'claude-cli': { ...DEFAULT_QA_TIERS['claude-cli'], light: { model: 'bad model', effort: 'low' } } };
    expect(() => UpdateAiQaSettingsInputSchema.parse({ tiers: badTier })).toThrow();
  });
```

In `packages/server/src/services/aiQaSettings.test.ts`:
- Add `import { DEFAULT_QA_TIERS } from '@sp-kickstack/shared';`.
- In `starts with the defaults and saves partial updates`, change the first `toEqual` object to:

```ts
    expect(settings.getAiQaSettings()).toEqual({
      runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
      modelMode: 'auto', tiers: DEFAULT_QA_TIERS, lightMaxLines: 150, deepMinLines: 1000,
    });
```

- Append this test inside the `describe`:

```ts
  it('keeps a phase 1 value and refuses a light limit at or above the deep limit', () => {
    const db = initDatabase(':memory:');
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_qa_settings', ?)").run(JSON.stringify({ runAutomatically: false, maxFindings: 12 }));
    const settings = new SettingsService(db);
    expect(settings.getAiQaSettings()).toMatchObject({ runAutomatically: false, maxFindings: 12, modelMode: 'auto', deepMinLines: 1000 });
    expect(() => settings.updateAiQaSettings({ lightMaxLines: 1000 })).toThrow(/lightMaxLines must be lower than deepMinLines/);
    expect(settings.updateAiQaSettings({ lightMaxLines: 300, modelMode: 'fixed' })).toMatchObject({ lightMaxLines: 300, modelMode: 'fixed' });
    db.close();
  });
```

In `packages/web/src/lib/aiQa.test.ts`:
- Add `import { DEFAULT_QA_TIERS } from '@sp-kickstack/shared';`.
- In `describe('AI QA settings', …)`, replace the `draft` constant with:

```ts
  const draft = {
    runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
    modelMode: 'auto', tiers: DEFAULT_QA_TIERS, lightMaxLines: 150, deepMinLines: 1000,
  } as const;
```

In `packages/server/src/db/migrations.test.ts`:
- Change `expect(LATEST_VERSION).toBe(11);` to `expect(LATEST_VERSION).toBe(12);`.
- Add this test after `adds the AI QA columns (migration 11)`:

```ts
  it('adds the AI QA stage and tier columns and marks existing QA tasks as QA stage (migration 12)', () => {
    const db = initDatabase(':memory:');
    expect(columns(db, 'bridge_tasks')).toEqual(expect.arrayContaining(['qa_stage', 'qa_tier', 'qa_tier_reason']));
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects (name, repo_path, engine_type, created_at, updated_at) VALUES ('backend', '/r', 'manual', ?, ?)").run(now, now);
    db.prepare("INSERT INTO requirements (id, seq, title, status, body_md, file_path, created_at, updated_at) VALUES ('REQ-001', 1, 'T', 'qa', 'b', 'f', ?, ?)").run(now, now);
    db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES ('REQ-001', 'backend', 'qa', 'AI QA', 'done', ?, ?)").run(now, now);
    db.pragma('user_version = 11');
    runMigrations(db);
    expect(db.prepare("SELECT qa_stage FROM bridge_tasks WHERE role = 'qa'").get()).toEqual({ qa_stage: 'qa' });
    db.close();
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/shared/src/aiQa.test.ts packages/server/src/services/aiQaSettings.test.ts packages/server/src/db/migrations.test.ts`

Expected: FAIL. `DEFAULT_QA_TIERS` is undefined, the defaults lack `modelMode`, `LATEST_VERSION` is 11, and the new columns are missing.

- [ ] **Step 3: Shared schemas** (`packages/shared/src/schemas.ts`)

Replace the `AiQaSettingsSchema` / `UpdateAiQaSettingsInputSchema` block with:

```ts
/** One AI QA tier: a model (null = the CLI's default model) and an effort. */
export const QaProfileSchema = z.object({ model: AgentModelSchema.nullable(), effort: ReasoningEffortSchema.nullable() });
const QaTierProfilesSchema = z.object({ light: QaProfileSchema, standard: QaProfileSchema, deep: QaProfileSchema });
const QaTiersByCliSchema = z.object({ 'claude-cli': QaTierProfilesSchema, 'codex-cli': QaTierProfilesSchema, 'agy-cli': QaTierProfilesSchema });

/** Model by size and risk: light / standard / deep per CLI. Codex and AGY keep their default model. */
export const DEFAULT_QA_TIERS: z.infer<typeof QaTiersByCliSchema> = {
  'claude-cli': { light: { model: 'haiku', effort: 'low' }, standard: { model: 'sonnet', effort: 'medium' }, deep: { model: 'opus', effort: 'high' } },
  'codex-cli': { light: { model: null, effort: 'low' }, standard: { model: null, effort: 'medium' }, deep: { model: null, effort: 'high' } },
  'agy-cli': { light: { model: null, effort: 'low' }, standard: { model: null, effort: 'medium' }, deep: { model: null, effort: 'high' } },
};

/** Settings → AI & Local Engines → AI QA. */
export const AiQaSettingsSchema = z.object({
  /** Start AI QA when a requirement enters In Review (before the merge). */
  runAutomatically: z.boolean().default(true),
  agentCli: z.enum(['default', 'claude-cli', 'agy-cli', 'codex-cli']).default('default'),
  /** Fixed mode's model / effort (null = the engine's). */
  model: AgentModelSchema.nullable().default(null),
  effort: ReasoningEffortSchema.nullable().default(null),
  timeLimitMinutes: z.number().int().min(5).max(240).default(30),
  maxFindings: z.number().int().min(1).max(200).default(30),
  modelMode: z.enum(['auto', 'fixed']).default('auto'),
  tiers: QaTiersByCliSchema.default(() => JSON.parse(JSON.stringify(DEFAULT_QA_TIERS))),
  lightMaxLines: z.number().int().min(10).max(5000).default(150),
  deepMinLines: z.number().int().min(50).max(100000).default(1000),
});

export const UpdateAiQaSettingsInputSchema = AiQaSettingsSchema.partial().strict();

/** The whole settings object as saved: the light limit must stay below the deep limit. */
export const CheckedAiQaSettingsSchema = AiQaSettingsSchema.refine((s) => s.lightMaxLines < s.deepMinLines, {
  message: 'lightMaxLines must be lower than deepMinLines',
  path: ['lightMaxLines'],
});
```

- [ ] **Step 4: Shared types** (`packages/shared/src/types.ts`)

Before `export interface AiQaSettings`:

```ts
export type QaStage = 'review' | 'qa';
export type QaTier = 'light' | 'standard' | 'deep';
export interface QaProfile {
  model: string | null;
  effort: ReasoningEffort | null;
}
export interface QaTierProfiles {
  light: QaProfile;
  standard: QaProfile;
  deep: QaProfile;
}
```

In `AiQaSettings`:
- Change the `runAutomatically` doc comment to `/** Start AI QA when a requirement enters In Review (before the merge). */`.
- Add after `maxFindings`:

```ts
  /** 'auto' = the model by size and risk; 'fixed' = `model` / `effort` above. */
  modelMode: 'auto' | 'fixed';
  tiers: Record<AgentCliId, QaTierProfiles>;
  /** Light tier: at most this many changed lines (and 8 files). */
  lightMaxLines: number;
  /** Deep tier: from this many changed lines (or 40 files, or a risky path). */
  deepMinLines: number;
```

In `BridgeTask`, after `qa_summary`:

```ts
  /** role 'qa': checked in In Review (a merge preview) or in QA (the merged code). */
  qa_stage?: QaStage | null;
  /** role 'qa': the model tier chosen by size and risk (null in Fixed mode), and why. */
  qa_tier?: QaTier | null;
  qa_tier_reason?: string | null;
```

In `QaRunView`, after `findings: number;`:

```ts
  tier: QaTier | null;
  tierReason: string | null;
```

In `RequirementQa`, after `findings: …;`:

```ts
  /** The latest round's stage; null when AI QA never ran. */
  stage: QaStage | null;
  /** Review rounds: the branch the preview merged into. */
  previewInto: string | null;
  /** Open AI QA blocker findings from review rounds. */
  openBlockers: number;
  /** Why an automatic merge waits (auto-merge policy, in review), or null. */
  autoMergeHold: string | null;
```

- [ ] **Step 5: Migration 12** (append to `MIGRATIONS` in `packages/server/src/db/migrations.ts`)

```ts
  {
    version: 12,
    name: 'AI QA in review: the stage and model tier of a QA task',
    up: (db) => {
      addColumn(db, 'bridge_tasks', 'qa_stage', 'TEXT');
      addColumn(db, 'bridge_tasks', 'qa_tier', 'TEXT');
      addColumn(db, 'bridge_tasks', 'qa_tier_reason', 'TEXT');
      db.exec("UPDATE bridge_tasks SET qa_stage = 'qa' WHERE role = 'qa' AND qa_stage IS NULL");
    },
  },
```

- [ ] **Step 6: Checked update** (`packages/server/src/services/settingsService.ts`)

- Add `CheckedAiQaSettingsSchema` to the shared import.
- In `updateAiQaSettings`, replace `const updated = AiQaSettingsSchema.parse({ ...this.getAiQaSettings(), ...patch });` with:

```ts
    const updated = CheckedAiQaSettingsSchema.parse({ ...this.getAiQaSettings(), ...patch });
```

- [ ] **Step 6b: Keep `QaService.status` compiling** (`packages/server/src/services/qaService.ts`)

In `status()`:
- In the object returned for each run, after `findings: mine,`, add `tier: task.qa_tier ?? null, tierReason: task.qa_tier_reason ?? null,`.
- Replace the final `return { reqId, round, running: …, runs, skipped, findings };` with:

```ts
    return {
      reqId, round, running: tasks.some((t) => ACTIVE_STATUSES.includes(t.status)), runs, skipped, findings,
      stage: tasks[0]?.qa_stage ?? (round ? 'qa' : null), previewInto: null, openBlockers: 0, autoMergeHold: null,
    };
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `(cd packages/shared && npx tsc -p .) && npx vitest run packages/shared/src packages/server/src/services/aiQaSettings.test.ts packages/server/src/db packages/server/src/api/localEngineRoutes.test.ts packages/web/src/lib/aiQa.test.ts && npx tsc --noEmit -p packages/server && (cd packages/web && npx tsc --noEmit)`

Expected: PASS, and both typechecks are clean.

- [ ] **Step 8: Commit, and keep the dev server running**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/types.ts packages/shared/src/aiQa.test.ts packages/web/src/lib/aiQa.test.ts packages/server/src/db/migrations.ts packages/server/src/db/migrations.test.ts packages/server/src/services/settingsService.ts packages/server/src/services/aiQaSettings.test.ts packages/server/src/services/qaService.ts
git commit -m "feat: AI QA stage and model tier data (settings, migration 12)"
```

Then, in the main checkout: `(cd packages/shared && npx tsc -p .) && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" localhost:4100/api/health`. Expected: `200`.

---
### Task 2: The model tier by size and risk

**Files:**
- Create: `packages/server/src/services/qaTier.ts`
- Create: `packages/server/src/services/qaTier.test.ts`

**Interfaces:**
- Consumes: `AiQaSettings`, `QaTier`, `QaProfile`, `AgentCliId` (Task 1).
- Produces:
  - `interface QaChangedFile { path: string; additions: number; deletions: number; binary?: boolean }`.
  - `interface QaTierChoice { tier: QaTier; reason: string }`.
  - `BUILTIN_RISK_PATTERNS: string[]`.
  - `matchesRiskPattern(file: string, pattern: string): boolean`.
  - `classifyQaTier(files: QaChangedFile[], riskPatterns: string[], limits: { lightMaxLines: number; deepMinLines: number }): QaTierChoice`.
  - `qaProfileFor(settings: AiQaSettings, cli: AgentCliId | null, tier: QaTier | null): QaProfile`.

- [ ] **Step 1: Write the failing tests** (`packages/server/src/services/qaTier.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { AiQaSettingsSchema } from '@sp-kickstack/shared';
import { BUILTIN_RISK_PATTERNS, classifyQaTier, matchesRiskPattern, qaProfileFor, type QaChangedFile } from './qaTier.js';

const limits = { lightMaxLines: 150, deepMinLines: 1000 };
const f = (path: string, additions: number, deletions = 0, binary = false): QaChangedFile => ({ path, additions, deletions, binary });

describe('classifyQaTier', () => {
  it('is light for a small change in few files', () => {
    expect(classifyQaTier([f('src/a.ts', 30, 12), f('src/b.ts', 0, 0)], [], limits)).toEqual({ tier: 'light', reason: '42 lines in 2 files' });
    expect(classifyQaTier([f('src/a.ts', 1)], [], limits)).toEqual({ tier: 'light', reason: '1 line in 1 file' });
  });

  it('is standard in between, and deep for many lines or many files', () => {
    expect(classifyQaTier([f('src/a.ts', 500, 62)], [], limits)).toEqual({ tier: 'standard', reason: '562 lines in 1 file' });
    expect(classifyQaTier(Array.from({ length: 9 }, (_, i) => f(`src/${i}.ts`, 1)), [], limits).tier).toBe('standard');
    expect(classifyQaTier([f('src/a.ts', 900, 100)], [], limits)).toEqual({ tier: 'deep', reason: '1000 lines in 1 file' });
    expect(classifyQaTier(Array.from({ length: 40 }, (_, i) => f(`src/${i}.ts`, 1)), [], limits)).toEqual({ tier: 'deep', reason: '40 lines in 40 files' });
  });

  it('follows the line limits from settings and ignores binary lines', () => {
    expect(classifyQaTier([f('src/a.ts', 200)], [], { lightMaxLines: 300, deepMinLines: 2000 }).tier).toBe('light');
    expect(classifyQaTier([f('logo.png', 5000, 0, true)], [], limits)).toEqual({ tier: 'light', reason: '0 lines in 1 file' });
  });

  it('is deep when a file matches a project or built-in risky pattern', () => {
    expect(classifyQaTier([f('src/a.ts', 3), f('app/Http/Middleware/CompanyMiddleware.php', 2)], ['app/Http/Middleware/'], limits))
      .toEqual({ tier: 'deep', reason: 'touches app/Http/Middleware/CompanyMiddleware.php' });
    expect(classifyQaTier([f('database/migrations/2026_10_13_add_company.php', 4)], BUILTIN_RISK_PATTERNS, limits))
      .toEqual({ tier: 'deep', reason: 'touches database/migrations/2026_10_13_add_company.php' });
  });

  it('is standard with no change list', () => {
    expect(classifyQaTier([], BUILTIN_RISK_PATTERNS, limits)).toEqual({ tier: 'standard', reason: 'no change list' });
  });
});

describe('matchesRiskPattern', () => {
  it('matches the built-in patterns', () => {
    const risky = ['db/migrations/1.sql', 'src/auth/login.ts', 'lib/security/x.ts', 'app/payments/charge.ts', 'billing/invoice.ts',
      '.github/workflows/ci.yml', '.gitlab-ci.yml', 'Dockerfile', 'deploy/Dockerfile', 'docker-compose.prod.yml', '.env.example', 'config/my-secrets.json'];
    for (const path of risky) expect(BUILTIN_RISK_PATTERNS.some((p) => matchesRiskPattern(path, p))).toBe(true);
    for (const path of ['src/authorship.ts', 'README.md', 'src/components/Payment.tsx']) {
      expect(BUILTIN_RISK_PATTERNS.some((p) => matchesRiskPattern(path, p))).toBe(false);
    }
  });

  it('matches paths written with ./, backslashes or other case', () => {
    expect(matchesRiskPattern('APP\\Http\\Middleware\\Company.php', './app/http/middleware/')).toBe(true);
    expect(matchesRiskPattern('app/Models/User.php', 'app/models/user.php')).toBe(true);
    expect(matchesRiskPattern('app/Models/User.php', 'app/*/User.php')).toBe(true);
    expect(matchesRiskPattern('app/Models/Deep/User.php', 'app/*/User.php')).toBe(false);
    expect(matchesRiskPattern('app/Models/User.php', '  ')).toBe(false);
  });
});

describe('qaProfileFor', () => {
  const settings = AiQaSettingsSchema.parse({ model: 'opus', effort: 'max' });

  it('gives the tier of the CLI in Auto mode (Codex keeps its default model)', () => {
    expect(qaProfileFor(settings, 'claude-cli', 'light')).toEqual({ model: 'haiku', effort: 'low' });
    expect(qaProfileFor(settings, 'codex-cli', 'deep')).toEqual({ model: null, effort: 'high' });
  });

  it('gives the fixed model in Fixed mode, or without a tier or CLI', () => {
    expect(qaProfileFor({ ...settings, modelMode: 'fixed' }, 'claude-cli', 'light')).toEqual({ model: 'opus', effort: 'max' });
    expect(qaProfileFor(settings, null, 'light')).toEqual({ model: 'opus', effort: 'max' });
    expect(qaProfileFor(settings, 'claude-cli', null)).toEqual({ model: 'opus', effort: 'max' });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/services/qaTier.test.ts`

Expected: FAIL with "Failed to load url ./qaTier.js".

- [ ] **Step 3: The classifier** (`packages/server/src/services/qaTier.ts`)

```ts
// AI QA's model by size and risk: a tier per repository from the change it checks.
import type { AgentCliId, AiQaSettings, QaProfile, QaTier } from '@sp-kickstack/shared';

export interface QaChangedFile {
  path: string;
  additions: number;
  deletions: number;
  binary?: boolean;
}

export interface QaTierChoice {
  tier: QaTier;
  reason: string;
}

/** Paths AI QA always treats as risky, on top of a project's High-risk paths. */
export const BUILTIN_RISK_PATTERNS = [
  '**/migrations/**', '**/auth/**', '**/security/**', '**/payment*/**', '**/billing/**',
  '.github/workflows/**', '.gitlab-ci.yml', '**/Dockerfile', '**/docker-compose*.yml', '**/.env*', '**/*secret*',
];

/** Light also needs at most this many files; this many or more is deep. */
const LIGHT_MAX_FILES = 8;
const DEEP_MIN_FILES = 40;

const normalize = (p: string) => p.trim().replace(/\\/g, '/').replace(/^\.\//, '');

/** A glob as a case-insensitive regex: `**` any number of folders, `*` within one path segment, a trailing `/` everything under it. */
function globRegex(pattern: string): RegExp {
  let p = normalize(pattern);
  if (p.endsWith('/')) p += '**';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

export function matchesRiskPattern(file: string, pattern: string): boolean {
  if (!pattern.trim()) return false;
  return globRegex(pattern).test(normalize(file));
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Deep for a risky path, many lines or many files; light for a small change in few files; else standard. */
export function classifyQaTier(files: QaChangedFile[], riskPatterns: string[], limits: { lightMaxLines: number; deepMinLines: number }): QaTierChoice {
  if (files.length === 0) return { tier: 'standard', reason: 'no change list' };
  const risky = files.find((file) => riskPatterns.some((p) => matchesRiskPattern(file.path, p)));
  if (risky) return { tier: 'deep', reason: `touches ${risky.path}` };
  const lines = files.reduce((n, file) => n + (file.binary ? 0 : file.additions + file.deletions), 0);
  const reason = `${count(lines, 'line')} in ${count(files.length, 'file')}`;
  if (lines >= limits.deepMinLines || files.length >= DEEP_MIN_FILES) return { tier: 'deep', reason };
  if (lines <= limits.lightMaxLines && files.length <= LIGHT_MAX_FILES) return { tier: 'light', reason };
  return { tier: 'standard', reason };
}

/** The model and effort of a QA run: the tier's for that CLI in Auto mode, else the fixed ones. */
export function qaProfileFor(settings: AiQaSettings, cli: AgentCliId | null, tier: QaTier | null): QaProfile {
  if (settings.modelMode === 'fixed' || !cli || !tier) return { model: settings.model, effort: settings.effort };
  return settings.tiers[cli][tier];
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/services/qaTier.test.ts && npx tsc --noEmit -p packages/server`

Expected: PASS (9 tests), with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/qaTier.ts packages/server/src/services/qaTier.test.ts
git commit -m "feat(server): AI QA model tier by size and risk"
```

---

### Task 3: The merge preview

**Files:**
- Create: `packages/server/src/services/unmergedWork.ts`
- Modify: `packages/server/src/services/mergeGate.ts` (`pendingByProject` `:186-221` delegates to it)
- Create: `packages/server/src/services/mergePreview.ts`
- Create: `packages/server/src/services/mergePreview.test.ts`

**Interfaces:**
- Produces:
  - `unmergedWorkByProject(db: AppDatabase, reqId: string): Map<string, BridgeTask[]>`: the unmerged branched goal / ticket tasks per project, dependencies first. It is the merge gate's query, unchanged.
  - `type MergePreview = { ok: true; sha: string; from: string } | { ok: false; error: string }`.
  - `buildMergePreview(repo: string, base: string, project: string, reqId: string, tasks: BridgeTask[], opts?: { tmpRoot?: string; gitTimeoutMs?: number }): Promise<MergePreview>`.

- [ ] **Step 1: Write the failing tests** (`packages/server/src/services/mergePreview.test.ts`)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BridgeTask } from '@sp-kickstack/shared';
import { commitOnBranch, makeRepo, sh } from '../testing/gitFixture.js';
import { buildMergePreview } from './mergePreview.js';

const tempRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.temp/sp-test-merge-preview');
let n = 0;
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function repoCase() {
  const root = path.join(tempRoot, `case-${process.pid}-${n++}`);
  const { repo } = makeRepo(path.join(root, 'backend'));
  const tmpRoot = path.join(root, 'tmp');
  return { repo, tmpRoot };
}
const task = (id: number, branch: string) => ({ id, branch, title: `Task ${id}` }) as BridgeTask;
const branchWith = (repo: string, name: string, file: string, content: string) => {
  sh(repo, ['branch', name, 'develop']);
  return commitOnBranch(repo, name, file, content);
};

describe('buildMergePreview', () => {
  it('merges the task branches into the base without moving any branch or ref', async () => {
    const { repo, tmpRoot } = repoCase();
    branchWith(repo, 'req/REQ-1/task-1', 'a.txt', 'a\n');
    branchWith(repo, 'req/REQ-1/task-2', 'b.txt', 'b\n');
    const refs = sh(repo, ['for-each-ref']);
    const base = sh(repo, ['rev-parse', 'develop']);

    const preview = await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(1, 'req/REQ-1/task-1'), task(2, 'req/REQ-1/task-2')], { tmpRoot });

    expect(preview).toMatchObject({ ok: true, from: base });
    const sha = (preview as { sha: string }).sha;
    expect(sh(repo, ['show', `${sha}:a.txt`])).toBe('a');
    expect(sh(repo, ['show', `${sha}:b.txt`])).toBe('b');
    expect(sh(repo, ['log', '--format=%s', '-1', sha])).toBe('Merge REQ-1 task-2: Task 2');
    expect(sh(repo, ['for-each-ref'])).toBe(refs);
    expect(sh(repo, ['rev-parse', 'develop'])).toBe(base);
    expect(sh(repo, ['worktree', 'list'])).not.toContain('sp-qa-preview');
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  it('reports a conflict with its files, and still cleans up', async () => {
    const { repo, tmpRoot } = repoCase();
    branchWith(repo, 'req/REQ-1/task-1', 'README.md', '# from the branch\n');
    commitOnBranch(repo, 'develop', 'README.md', '# from develop\n');
    const preview = await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(1, 'req/REQ-1/task-1')], { tmpRoot });
    expect(preview).toEqual({
      ok: false, error: 'backend: merging req/REQ-1/task-1 into develop conflicts in README.md (Merge & move to QA would conflict too)',
    });
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  it('reports a missing branch or base branch', async () => {
    const { repo, tmpRoot } = repoCase();
    expect(await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(7, 'req/REQ-1/gone')], { tmpRoot }))
      .toEqual({ ok: false, error: 'backend: branch req/REQ-1/gone (task #7) does not exist' });
    expect(await buildMergePreview(repo, 'release/9', 'backend', 'REQ-1', [], { tmpRoot }))
      .toEqual({ ok: false, error: 'backend: base branch release/9 was not found' });
  });

  it('returns the base tip when nothing is ahead', async () => {
    const { repo, tmpRoot } = repoCase();
    sh(repo, ['branch', 'req/REQ-1/task-1', 'develop']);
    const base = sh(repo, ['rev-parse', 'develop']);
    expect(await buildMergePreview(repo, 'develop', 'backend', 'REQ-1', [task(1, 'req/REQ-1/task-1')], { tmpRoot })).toEqual({ ok: true, sha: base, from: base });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/services/mergePreview.test.ts`

Expected: FAIL with "Failed to load url ./mergePreview.js".

- [ ] **Step 3: Move the query out of the merge gate** (`packages/server/src/services/unmergedWork.ts`)

```ts
// The unmerged branched work of a requirement, per repository, in the order the merge gate merges it.
import type { BridgeTask } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';

/** Unmerged branched goal/ticket tasks per project, dependencies before dependents. */
export function unmergedWorkByProject(db: AppDatabase, reqId: string): Map<string, BridgeTask[]> {
  const tasks = db
    .prepare(`
      SELECT * FROM bridge_tasks
      WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'
        AND branch IS NOT NULL AND merged_at IS NULL
      ORDER BY id
    `)
    .all(reqId) as BridgeTask[];
  const ids = new Set(tasks.map((t) => t.id));
  const links = db.prepare('SELECT task_id, depends_on_id FROM links').all() as Array<{ task_id: number; depends_on_id: number }>;
  const dependsOn = new Map<number, number[]>();
  for (const l of links) {
    if (ids.has(l.task_id) && ids.has(l.depends_on_id)) {
      dependsOn.set(l.task_id, [...(dependsOn.get(l.task_id) ?? []), l.depends_on_id]);
    }
  }

  const ordered: BridgeTask[] = [];
  const placed = new Set<number>();
  while (ordered.length < tasks.length) {
    const next =
      tasks.find((t) => !placed.has(t.id) && (dependsOn.get(t.id) ?? []).every((d) => placed.has(d))) ??
      tasks.find((t) => !placed.has(t.id))!; // cycle guard: fall back to id order
    ordered.push(next);
    placed.add(next.id);
  }

  const groups = new Map<string, BridgeTask[]>();
  for (const t of ordered) groups.set(t.project, [...(groups.get(t.project) ?? []), t]);
  return groups;
}
```

In `packages/server/src/services/mergeGate.ts`:
- Add `import { unmergedWorkByProject } from './unmergedWork.js';`.
- Replace the whole body of `private pendingByProject(reqId: string): Map<string, BridgeTask[]> { … }` with:

```ts
  private pendingByProject(reqId: string): Map<string, BridgeTask[]> {
    return unmergedWorkByProject(this.db, reqId);
  }
```

- [ ] **Step 4: The preview** (`packages/server/src/services/mergePreview.ts`)

```ts
// AI QA in In Review: the repository's unmerged task branches merged into its target/base branch in a
// temporary checkout, as Merge & move to QA would do. No branch or ref is created or moved; git keeps the
// unreferenced preview commit for two weeks, far longer than a QA run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BridgeTask } from '@sp-kickstack/shared';
import * as git from '../lib/gitRepo.js';

export type MergePreview = { ok: true; sha: string; from: string } | { ok: false; error: string };

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

export async function buildMergePreview(
  repo: string,
  base: string,
  project: string,
  reqId: string,
  tasks: BridgeTask[],
  opts: { tmpRoot?: string; gitTimeoutMs?: number } = {}
): Promise<MergePreview> {
  const from = git.resolveCommit(repo, `refs/heads/${base}`) ?? git.resolveCommit(repo, `refs/remotes/origin/${base}`);
  if (!from) return { ok: false, error: `${project}: base branch ${base} was not found` };
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, `sp-qa-preview-${safe(reqId)}-${safe(project)}-`));
  const worktree = path.join(tmpDir, 'wt');
  try {
    await git.addDetachedWorktree(repo, worktree, from, opts.gitTimeoutMs);
    for (const task of tasks) {
      const branch = task.branch!;
      const tip = git.resolveCommit(repo, `refs/heads/${branch}`);
      if (!tip) return { ok: false, error: `${project}: branch ${branch} (task #${task.id}) does not exist` };
      if (git.commitsAhead(worktree, 'HEAD', tip) === 0) continue;
      const merged = await git.mergeNoFf(worktree, tip, `Merge ${reqId} task-${task.id}: ${task.title}`, opts.gitTimeoutMs);
      if (!merged.ok) {
        const files = merged.conflicts.length ? ` in ${merged.conflicts.join(', ')}` : '';
        return { ok: false, error: `${project}: merging ${branch} into ${base} conflicts${files} (Merge & move to QA would conflict too)` };
      }
    }
    return { ok: true, sha: git.resolveCommit(worktree, 'HEAD')!, from };
  } catch (err: any) {
    return { ok: false, error: `${project}: the merge preview failed: ${err?.message || err}` };
  } finally {
    try {
      git.removeWorktree(repo, worktree);
    } catch {
      // Best effort: a leftover temporary folder is harmless.
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/services/mergePreview.test.ts packages/server/src/services/branchMerge.test.ts && npx tsc --noEmit -p packages/server`

Expected: PASS. That covers the 4 new tests and every merge gate test, which proves the moved query still orders the merges the same way. No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/unmergedWork.ts packages/server/src/services/mergeGate.ts packages/server/src/services/mergePreview.ts packages/server/src/services/mergePreview.test.ts
git commit -m "feat(server): merge preview for AI QA in review (shared unmerged-work order with the merge gate)"
```

---
### Task 4: QaService: rounds in review, the model tier, and stage-checked reports

**Files:**
- Modify (full replacement below): `packages/server/src/services/qaService.ts`
- Modify (full replacement below): `packages/server/src/services/qaService.test.ts`
- Modify: `packages/server/src/localEngine/qaPrompt.ts`, `packages/server/src/localEngine/qaPrompt.test.ts`
- Modify: `packages/server/src/api/humanLoopRoutes.ts` (`POST /api/requirements/:id/qa` awaits `start`)
- Modify: `packages/server/src/api/app.ts`, `packages/server/src/index.ts` (drop the `onEnteredQa` wiring; Task 6 adds the new hooks)
- Modify: `packages/server/src/api/aiQaRoutes.test.ts` (a review-stage route test)

**Interfaces:**
- Consumes:
  - Task 1: `QaStage`, `RequirementQa.stage / previewInto / openBlockers / autoMergeHold`, `QaRunView.tier / tierReason`, `BridgeTask.qa_stage / qa_tier / qa_tier_reason`, and the settings `modelMode / tiers / lightMaxLines / deepMinLines`.
  - Task 2: `classifyQaTier`, `qaProfileFor`, `BUILTIN_RISK_PATTERNS`, `QaChangedFile`.
  - Task 3: `buildMergePreview`, `unmergedWorkByProject`.
- Produces:
  - `QaService.start(reqId: string, trigger: 'auto' | 'manual'): Promise<RequirementQa>`. It is now async, and the `commits` argument is gone.
  - `QaService.onEnteredReview(reqId: string): Promise<void>`. It never rejects.
  - `QaService.autoMergeHold(reqId: string): string | null`.
  - `QaService.onEnteredQa` is removed.
  - `QaServiceOptions.tmpRoot?: string`.
  - `QaPromptInput` gains `stage?: QaStage` (default `'qa'`) and `previewInto?: string | null`.

- [ ] **Step 1: Write the failing tests**

Replace `packages/server/src/services/qaService.test.ts` with:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QaService } from './qaService.js';
import { OutboxScanner } from '../watcher/outboxScanner.js';
import { commitOnBranch, makeRepo, sh } from '../testing/gitFixture.js';
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

/** A goal of `reqId` with an unmerged branch carrying one commit. */
function unmergedGoal(h: LocalHarness, file: string, content: string, reqId = h.req.id, repo = h.repo, project = 'backend'): { id: number; branch: string } {
  const branch = `req/${reqId}/${project}-${file.replace(/[^a-z0-9]+/gi, '-')}`;
  const base = sh(repo, ['rev-parse', 'develop']);
  sh(repo, ['branch', branch, 'develop']);
  commitOnBranch(repo, branch, file, content);
  return { id: addWork(h, reqId, { branch, base_sha: base, status: 'in_review' }, 'goal', project), branch };
}

/** A goal whose branch was merged into develop (merge commit), as the merge gate leaves it. */
function mergedGoal(h: LocalHarness, file: string, content: string, reqId = h.req.id): { id: number; mergeSha: string } {
  const branch = `req/${reqId}/merged-${file.replace(/[^a-z0-9]+/gi, '-')}`;
  sh(h.repo, ['branch', branch, 'develop']);
  commitOnBranch(h.repo, branch, file, content);
  sh(h.repo, ['merge', '--no-ff', '-q', '-m', `Merge ${branch}`, branch]);
  const mergeSha = sh(h.repo, ['rev-parse', 'HEAD']);
  return { id: addWork(h, reqId, { branch, merge_sha: mergeSha, merged_at: now() }), mergeSha };
}

function setup(h: LocalHarness = makeLocalHarness()) {
  let nudges = 0;
  const qa = new QaService({
    db: h.db, projectService: h.projectService, requirementService: h.requirementService, settingsService: h.settingsService,
    engine: { status: () => h.runner.status(), nudge: () => { nudges++; } },
  });
  const setStatus = (status: string, id = h.req.id) => h.db.prepare('UPDATE requirements SET status = ? WHERE id = ?').run(status, id);
  const toQa = (id = h.req.id) => setStatus('qa', id);
  const toReview = (id = h.req.id) => setStatus('in_review', id);
  const runOf = (taskId: number) => h.db.prepare('SELECT * FROM local_runs WHERE bridge_task_id = ?').get(taskId) as any;
  const task = (id: number) => h.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  const comments = (reqId = h.req.id) => h.db.prepare('SELECT * FROM review_comments WHERE req_id = ? ORDER BY id').all(reqId) as any[];
  return { h, qa, setStatus, toQa, toReview, runOf, task, comments, nudges: () => nudges };
}

/** AI QA started for h.req (in QA) with one goal on backend. */
async function started(s: ReturnType<typeof setup>) {
  const goalId = addWork(s.h);
  s.toQa();
  const view = await s.qa.start(s.h.req.id, 'manual');
  const task = view.runs[0].task;
  return { goalId, view, task, runId: s.runOf(task.id)?.id as string };
}

describe('AI QA: starting in QA', () => {
  it('queues one QA run per git repository at the branch tip, with the QA prompt and the fixed model', async () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ agentCli: 'claude-cli', model: 'sonnet', effort: 'high', modelMode: 'fixed' });
    const { view, task, runId } = await started(s);
    expect(view).toMatchObject({ reqId: s.h.req.id, round: 1, running: true, skipped: [], findings: { total: 0 }, stage: 'qa', previewInto: null });
    expect(task).toMatchObject({
      role: 'qa', project: 'backend', status: 'queued', base_sha: sh(s.h.repo, ['rev-parse', 'develop']), revision: 1, engine_task_id: null,
      qa_stage: 'qa', qa_tier: null,
    });
    const run = s.runOf(task.id);
    expect(run).toMatchObject({ id: runId, status: 'queued', model: 'sonnet', effort: 'high', preferred_cli: 'claude-cli' });
    expect(run.body_md).toContain(`# AI QA of ${s.h.req.id} in backend`);
    expect(run.body_md).toContain('the code after the requirement was merged');
    expect(run.body_md).toContain('1. Rides tracked');
    expect(s.nudges()).toBe(1);
  });

  it("checks the tip of the requirement's target branch", async () => {
    const s = setup();
    addWork(s.h);
    s.toQa();
    sh(s.h.repo, ['branch', 'release/1', 'develop']);
    const tip = commitOnBranch(s.h.repo, 'release/1', 'release.txt', 'release\n');
    s.h.db.prepare("UPDATE requirements SET target_branch = 'release/1' WHERE id = ?").run(s.h.req.id);
    expect((await s.qa.start(s.h.req.id, 'manual')).runs[0].task.base_sha).toBe(tip);
  });

  it('lists changed files from the merge commits after the branches are deleted', async () => {
    const s = setup();
    const { mergeSha, id } = mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    sh(s.h.repo, ['branch', '-D', s.task(id).branch]);
    const parent = sh(s.h.repo, ['rev-parse', `${mergeSha}^1`]);
    s.toQa();
    const body = s.runOf((await s.qa.start(s.h.req.id, 'manual')).runs[0].task.id).body_md as string;
    expect(body).toContain('- src/rides.ts');
    expect(body).toContain(`git diff ${parent.slice(0, 12)}..${mergeSha.slice(0, 12)}`);
  });

  it('refuses outside review and QA, while QA runs, during a merge, and without a git repository', async () => {
    const s = setup();
    addWork(s.h);
    await expect(s.qa.start(s.h.req.id, 'manual')).rejects.toThrow(`${s.h.req.id} is draft; AI QA runs while a requirement is in review or in QA`);
    s.toQa();
    s.h.db.prepare("UPDATE requirements SET merge_state = 'running' WHERE id = ?").run(s.h.req.id);
    await expect(s.qa.start(s.h.req.id, 'manual')).rejects.toThrow(`A merge of ${s.h.req.id} is running; wait for it to finish`);
    s.h.db.prepare("UPDATE requirements SET merge_state = 'idle' WHERE id = ?").run(s.h.req.id);
    await s.qa.start(s.h.req.id, 'manual');
    await expect(s.qa.start(s.h.req.id, 'manual')).rejects.toThrow(`AI QA is already running for ${s.h.req.id}`);

    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    const docs = s.h.requirementService.createRequirement({ title: 'Docs', goal: 'Write docs', acceptance_criteria: [], affected_projects: ['docs'], priority: 'normal' });
    addWork(s.h, docs.id, {}, 'goal', 'docs');
    s.toQa(docs.id);
    await expect(s.qa.start(docs.id, 'manual')).rejects.toThrow(`No repository of ${docs.id} is a git repository; AI QA needs one`);
  });

  it('skips repositories that are not git repositories and says so', async () => {
    const s = setup();
    const docsDir = path.join(s.h.ws, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    s.h.projectService.registerProject({ name: 'docs', repo_path: docsDir, engine_type: 'manual', enabled: true });
    addWork(s.h);
    addWork(s.h, s.h.req.id, {}, 'goal', 'docs');
    s.toQa();
    const view = await s.qa.start(s.h.req.id, 'manual');
    expect(view.runs.map((r) => r.project)).toEqual(['backend']);
    expect(view.skipped).toEqual([{ project: 'docs', reason: 'not a git repository' }]);
  });

  it('fails at once when no AI CLI can run QA', async () => {
    const s = setup();
    s.h.settingsService.updateLocalEngineSettings({ enabled: false });
    const { task } = await started(s);
    expect(task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: the Local AI CLI engine is turned off (Settings → AI & Local Engines)' });
    expect(s.runOf(task.id)).toBeUndefined();
    expect(s.qa.status(s.h.req.id).running).toBe(false);

    const other = setup();
    other.h.settingsService.updateAiQaSettings({ agentCli: 'codex-cli' });
    expect((await started(other)).task).toMatchObject({ status: 'failed', last_error: 'No AI CLI can run QA: Codex is chosen for AI QA but is not installed on this PC' });
  });
});

describe('AI QA: in review (merge preview)', () => {
  it('in review, checks a merge preview of the unmerged branches and records the stage', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    const develop = sh(s.h.repo, ['rev-parse', 'develop']);
    const refs = sh(s.h.repo, ['for-each-ref']);
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'manual');
    const task = view.runs[0].task;
    expect(view).toMatchObject({ stage: 'review', previewInto: 'develop', running: true });
    expect(task.qa_stage).toBe('review');
    expect(task.base_sha).not.toBe(develop);
    expect(sh(s.h.repo, ['show', `${task.base_sha}:src/rides.ts`])).toBe('export const rides = [];');
    expect(sh(s.h.repo, ['rev-parse', 'develop'])).toBe(develop);
    expect(sh(s.h.repo, ['for-each-ref'])).toBe(refs);
    const body = s.runOf(task.id).body_md as string;
    expect(body).toContain("a temporary merge of the requirement's branches into `develop`, not merged yet");
    expect(body).toContain('- src/rides.ts');
    expect(body).toContain(`git diff ${develop.slice(0, 12)}..${task.base_sha!.slice(0, 12)}`);
  });

  it("previews into the requirement's target branch", async () => {
    const s = setup();
    sh(s.h.repo, ['branch', 'release/1', 'develop']);
    commitOnBranch(s.h.repo, 'release/1', 'release.txt', 'release\n');
    s.h.db.prepare("UPDATE requirements SET target_branch = 'release/1' WHERE id = ?").run(s.h.req.id);
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'manual');
    const sha = view.runs[0].task.base_sha;
    expect(view.previewInto).toBe('release/1');
    expect(sh(s.h.repo, ['show', `${sha}:release.txt`])).toBe('release');
    expect(sh(s.h.repo, ['show', `${sha}:src/rides.ts`])).toBe('export const rides = [];');
  });

  it('a conflicting branch fails only its repository', async () => {
    const s = setup();
    const { repo: mobileRepo } = makeRepo(path.join(s.h.ws, 'mobile'));
    s.h.projectService.registerProject({ name: 'mobile', kind: 'mobile', repo_path: mobileRepo, engine_type: 'local', base_branch: 'develop', enabled: true });
    const { branch } = unmergedGoal(s.h, 'README.md', '# from the branch\n');
    commitOnBranch(s.h.repo, 'develop', 'README.md', '# from develop\n');
    unmergedGoal(s.h, 'app.ts', 'export {};\n', s.h.req.id, mobileRepo, 'mobile');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'manual');
    const byProject = Object.fromEntries(view.runs.map((r) => [r.project, r]));
    expect(byProject.backend).toMatchObject({
      status: 'failed', error: `backend: merging ${branch} into develop conflicts in README.md (Merge & move to QA would conflict too)`,
    });
    expect(byProject.mobile.status).toBe('queued');
  });

  it('refuses a second start while the first is still building previews', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const first = s.qa.start(s.h.req.id, 'manual');
    await expect(s.qa.start(s.h.req.id, 'auto')).rejects.toThrow(`AI QA is already running for ${s.h.req.id}`);
    expect(s.qa.autoMergeHold(s.h.req.id)).toBe('AI QA is still checking');
    await first;
    expect(s.qa.status(s.h.req.id).round).toBe(1);
  });

  it('starts on entering review only when Run automatically is on', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    s.h.settingsService.updateAiQaSettings({ runAutomatically: false });
    await s.qa.onEnteredReview(s.h.req.id);
    expect(s.qa.status(s.h.req.id).round).toBe(0);
    s.h.settingsService.updateAiQaSettings({ runAutomatically: true });
    await s.qa.onEnteredReview(s.h.req.id);
    expect(s.qa.status(s.h.req.id)).toMatchObject({ round: 1, stage: 'review' });
    await expect(s.qa.onEnteredReview(s.h.req.id)).resolves.toBeUndefined(); // already running: logged, not thrown
  });

  it('holds auto-merge while the review round runs or blockers are open', async () => {
    const s = setup();
    s.h.requirementService.updateRequirementMergePolicy(s.h.req.id, 'auto_merge');
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'auto');
    const qaTask = view.runs[0].task;
    expect(s.qa.autoMergeHold(s.h.req.id)).toBe('AI QA is still checking');
    expect(s.qa.status(s.h.req.id).autoMergeHold).toBe('AI QA is still checking');

    s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved' }, 'backend', s.runOf(qaTask.id).id);
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(qaTask.id);
    expect(s.qa.autoMergeHold(s.h.req.id)).toBe('1 open AI QA blocker');
    expect(s.qa.status(s.h.req.id)).toMatchObject({ openBlockers: 1, autoMergeHold: '1 open AI QA blocker' });

    s.h.db.prepare("UPDATE review_comments SET state = 'resolved'").run();
    expect(s.qa.autoMergeHold(s.h.req.id)).toBeNull();
  });

  it('does not hold auto-merge when the review round failed at once', async () => {
    const s = setup();
    s.h.settingsService.updateLocalEngineSettings({ enabled: false });
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const view = await s.qa.start(s.h.req.id, 'auto');
    expect(view.runs[0].status).toBe('failed');
    expect(s.qa.autoMergeHold(s.h.req.id)).toBeNull();
  });

  it('refuses review findings once the requirement left review', async () => {
    const s = setup();
    unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const runId = s.runOf((await s.qa.start(s.h.req.id, 'manual')).runs[0].task.id).id;
    s.toQa();
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Too late' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in review; this finding was not saved`);
    expect(() => s.qa.recordResult({ passed: true, summary: 'ok' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in review; this result was not saved`);
  });

  it('a QA-stage run after a review round checks the merged tip', async () => {
    const s = setup();
    const goal = unmergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toReview();
    const review = await s.qa.start(s.h.req.id, 'manual');
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE role = 'qa'").run();
    sh(s.h.repo, ['merge', '--no-ff', '-q', '-m', 'Merge rides', goal.branch]);
    const merged = sh(s.h.repo, ['rev-parse', 'HEAD']);
    s.h.db.prepare('UPDATE bridge_tasks SET merge_sha = ?, merged_at = ? WHERE id = ?').run(merged, now(), goal.id);
    s.toQa();
    const view = await s.qa.start(s.h.req.id, 'manual');
    expect(view).toMatchObject({ round: 2, stage: 'qa' });
    expect(view.runs[0].task.base_sha).toBe(merged);
    expect(view.runs[0].task.base_sha).not.toBe(review.runs[0].task.base_sha);
  });
});

describe('AI QA: model by size and risk', () => {
  it('picks the tier from the change and records why', async () => {
    const s = setup();
    mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    expect(task).toMatchObject({ qa_tier: 'light', qa_tier_reason: '1 line in 1 file' });
    expect(s.runOf(task.id)).toMatchObject({ model: 'haiku', effort: 'low' });
    expect(s.h.logText(task.id)).toContain('· light: 1 line in 1 file → haiku · low');
    expect(s.qa.status(s.h.req.id).runs[0]).toMatchObject({ tier: 'light', tierReason: '1 line in 1 file' });
  });

  it("uses the deep tier for the project's high-risk paths", async () => {
    const s = setup();
    s.h.projectService.updateProject('backend', { high_risk_paths: ['src/'] });
    mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    expect(task).toMatchObject({ qa_tier: 'deep', qa_tier_reason: 'touches src/rides.ts' });
    expect(s.runOf(task.id)).toMatchObject({ model: 'opus', effort: 'high' });
  });

  it('keeps the fixed model in Fixed mode', async () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ modelMode: 'fixed', model: 'sonnet', effort: 'medium' });
    mergedGoal(s.h, 'src/rides.ts', 'export const rides = [];\n');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    expect(task.qa_tier).toBeNull();
    expect(s.runOf(task.id)).toMatchObject({ model: 'sonnet', effort: 'medium' });
  });
});

describe('AI QA: findings and result', () => {
  it("saves a finding as an open AI QA comment on the repository's goal card", async () => {
    const s = setup();
    const { goalId, task, runId } = await started(s);
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

  it('puts the finding on the first ticket when the repository has no goal', async () => {
    const s = setup();
    const ticketId = addWork(s.h, s.h.req.id, {}, 'ticket');
    s.toQa();
    const task = (await s.qa.start(s.h.req.id, 'manual')).runs[0].task;
    s.qa.addFinding({ severity: 'minor', title: 'Naming is unclear' }, 'backend', s.runOf(task.id).id);
    expect(s.comments()[0]).toMatchObject({ task_id: ticketId, file_path: null, line: null, body_md: '**Naming is unclear**' });
  });

  it('saves the same finding once, refuses unsafe paths, and stops at the findings limit', async () => {
    const s = setup();
    s.h.settingsService.updateAiQaSettings({ maxFindings: 2 });
    const { runId } = await started(s);
    const first = s.qa.addFinding({ severity: 'major', title: 'Missing check', file_path: 'a.ts', line: 3 }, 'backend', runId);
    expect(s.qa.addFinding({ severity: 'major', title: '  missing   CHECK ', file_path: 'a.ts', line: 3 }, 'backend', runId)).toEqual({ commentId: first.commentId, duplicate: true });
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Outside', file_path: '../etc/passwd' }, 'backend', runId)).toThrow(/relative to the repository/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'No file', line: 4 }, 'backend', runId)).toThrow('--line needs --file');
    s.qa.addFinding({ severity: 'minor', title: 'Second one' }, 'backend', runId);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Third one' }, 'backend', runId)).toThrow('The QA run reached its limit of 2 findings');
    expect(s.comments()).toHaveLength(2);
  });

  it('refuses reports from unknown runs and once the requirement left QA', async () => {
    const s = setup();
    const { runId } = await started(s);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', 'local-nope')).toThrow(/^No QA run local-nope for backend/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Who am I' }, 'backend', undefined)).toThrow(/^No QA run/);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Wrong repo' }, 'mobile', runId)).toThrow(/^No QA run/);
    s.h.db.prepare("UPDATE requirements SET status = 'in_progress' WHERE id = ?").run(s.h.req.id);
    expect(() => s.qa.addFinding({ severity: 'minor', title: 'Too late' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this finding was not saved`);
    expect(() => s.qa.recordResult({ passed: true, summary: 'ok' }, 'backend', runId)).toThrow(`${s.h.req.id} is no longer in QA; this result was not saved`);
  });

  it('records the result, reports the header status, and a new round starts fresh', async () => {
    const s = setup();
    const { task, runId } = await started(s);
    s.qa.addFinding({ severity: 'blocker', title: 'Rides are not saved' }, 'backend', runId);
    s.qa.addFinding({ severity: 'minor', title: 'Naming' }, 'backend', runId);
    expect(s.qa.recordResult({ passed: false, summary: '1 blocker, 1 minor' }, 'backend', runId)).toEqual({ ok: true, passed: false, summary: '1 blocker, 1 minor' });
    s.h.db.prepare("UPDATE bridge_tasks SET status = 'done' WHERE id = ?").run(task.id);
    expect(s.qa.status(s.h.req.id)).toMatchObject({
      round: 1, running: false, findings: { total: 2, blocker: 1, major: 0, minor: 1 }, openBlockers: 0, autoMergeHold: null,
      runs: [{ project: 'backend', status: 'done', passed: false, summary: '1 blocker, 1 minor', error: null, findings: 2 }],
    });

    const next = await s.qa.start(s.h.req.id, 'manual');
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
    const task = (await s.qa.start(req.id, 'manual')).runs[0].task;
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
    const { runId } = await started(s);
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

Add to `packages/server/src/localEngine/qaPrompt.test.ts`, inside `describe('buildQaPrompt', …)`:

```ts
  it('names the merge preview for review rounds', () => {
    const prompt = buildQaPrompt(input({ stage: 'review', previewInto: 'develop' }));
    expect(prompt).toContain("a temporary merge of the requirement's branches into `develop`, not merged yet");
    expect(prompt).not.toContain('the code after the requirement was merged');
  });
```

Add to `packages/server/src/api/aiQaRoutes.test.ts`, inside `describe('AI QA routes', …)`:

```ts
  it('Run AI QA in review starts a review round (202)', async () => {
    const h = makeE2E();
    const app = appFor(h);
    inQa(h);
    h.db.prepare("UPDATE requirements SET status = 'in_review' WHERE id = ?").run(h.req.id);
    expect(await testRequest(app, 'POST', `/api/requirements/${h.req.id}/qa`)).toMatchObject({ status: 202, body: { stage: 'review', running: true } });
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/services/qaService.test.ts packages/server/src/localEngine/qaPrompt.test.ts packages/server/src/api/aiQaRoutes.test.ts`

Expected: FAIL. The cases include:
- the review tests (`start` refuses `in_review`; the message is still "while a requirement is in QA");
- the tier tests (`qa_tier` is null);
- the merge-state refusal;
- the prompt test (no review wording);
- the review route test (409).

- [ ] **Step 3: The prompt** (`packages/server/src/localEngine/qaPrompt.ts`)

- Add `import type { QaStage } from '@sp-kickstack/shared';`.
- Add to `QaPromptInput`:

```ts
  /** 'review': the checkout is a merge preview (default 'qa': the merged code). */
  stage?: QaStage;
  /** Review rounds: the branch the preview merged into. */
  previewInto?: string | null;
```

- In `buildQaPrompt`, after `const commit = …`, add:

```ts
  const what =
    input.stage === 'review'
      ? `a temporary merge of the requirement's branches into \`${input.previewInto ?? 'its base branch'}\`, not merged yet`
      : 'the code after the requirement was merged';
```

- In the opening sentence, replace `` `Your working directory is a temporary checkout of commit \`${commit}\`: the code after the requirement was merged. ` + `` with:

```ts
      `Your working directory is a temporary checkout of commit \`${commit}\`: ${what}. ` +
```

- [ ] **Step 4: The service** (`packages/server/src/services/qaService.ts`). Replace the whole file with:

```ts
// AI QA: one QA run per git repository of a requirement in review (on a merge preview) or in QA (on the
// merged code). The agent checks the code in a temporary checkout and reports findings (open review
// comments marked AI QA) and a result; a person decides what to send back.
import type { AgentCliId, AiQaSettings, BridgeTask, LocalEngineStatus, Project, QaRunView, QaSeverity, QaStage, RequirementQa } from '@sp-kickstack/shared';
import { QaFindingInputSchema, QaResultInputSchema } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';
import type { ProjectService } from './projectService.js';
import type { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { BranchService } from './branchService.js';
import { TaskChangesService } from './taskChanges.js';
import { isSafeRelativePath } from './reviewAssist.js';
import { buildMergePreview } from './mergePreview.js';
import { unmergedWorkByProject } from './unmergedWork.js';
import { BUILTIN_RISK_PATTERNS, classifyQaTier, qaProfileFor, type QaChangedFile } from './qaTier.js';
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
  /** Where merge previews are built (default: the OS temp dir). */
  tmpRoot?: string;
}

const ACTIVE_STATUSES = ['pending', 'queued', 'running', 'rate_limited'];
/** The requirement status a round of each stage checks. */
const STAGE_STATUS: Record<QaStage, string> = { review: 'in_review', qa: 'qa' };
const STAGE_WORDS: Record<QaStage, string> = { review: 'in review', qa: 'in QA' };

/** Same finding = same QA run, file, line and title (case and spacing ignored). */
const titleKey = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();
/** A saved finding's title: the bold first line of its comment. */
const savedTitle = (body: string) => /^\*\*(.+?)\*\*/.exec(body)?.[1] ?? body.split('\n')[0];

interface CommitToCheck {
  commit: string | null;
  from: string | null;
  files: QaChangedFile[];
  error?: string;
}

export class QaService {
  private db: AppDatabase;
  private settings: SettingsService;
  private branches: BranchService;
  private taskChanges: TaskChangesService;
  private runs: RunStore;
  /** Requirements whose round is being prepared (previews are built before the QA tasks exist). */
  private starting = new Set<string>();

  constructor(private opts: QaServiceOptions) {
    this.db = opts.db;
    this.settings = opts.settingsService ?? new SettingsService(opts.db);
    this.branches = opts.branchService ?? new BranchService(opts.db, opts.projectService, this.settings);
    this.taskChanges = new TaskChangesService(opts.db);
    this.runs = new RunStore(opts.db);
  }

  /** Start AI QA for every git repository of a requirement in review (merge preview) or in QA (merged code). */
  public async start(reqId: string, trigger: 'auto' | 'manual'): Promise<RequirementQa> {
    const req = this.opts.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
    const stage: QaStage | null = req.status === 'in_review' ? 'review' : req.status === 'qa' ? 'qa' : null;
    if (!stage) throw conflict(`${reqId} is ${req.status}; AI QA runs while a requirement is in review or in QA`);
    if (req.merge_state === 'running') throw conflict(`A merge of ${reqId} is running; wait for it to finish`);
    if (!this.opts.engine) throw new HttpError(503, 'The Local AI CLI engine is not running in this server');
    if (this.starting.has(reqId) || this.activeTasks(reqId).length > 0) throw conflict(`AI QA is already running for ${reqId}`);
    const projects = this.projectsOf(reqId);
    if (projects.length === 0) throw conflict(`${reqId} has no repository work to check`);
    const repos = projects.filter((p) => isGitWorkTree(p.repo_path));
    if (repos.length === 0) throw conflict(`No repository of ${reqId} is a git repository; AI QA needs one`);

    this.starting.add(reqId);
    try {
      const settings = this.settings.getAiQaSettings();
      const engine = this.opts.engine.status();
      const cliProblem = this.cliProblem(settings, engine);
      const cli: AgentCliId | null = settings.agentCli === 'default' ? engine.cli : settings.agentCli;
      const round = this.lastRound(reqId) + 1;
      const unmerged = stage === 'review' ? unmergedWorkByProject(this.db, reqId) : new Map<string, BridgeTask[]>();
      for (const project of repos) {
        const base = this.branches.baseBranchFor(project, reqId);
        const check = await this.commitToCheck(project, reqId, stage, base, unmerged.get(project.name) ?? []);
        const taskId = this.insertTask(reqId, project.name, round, check.commit, stage);
        if (check.error) {
          this.failTask(taskId, check.error);
          continue;
        }
        if (!check.commit) {
          this.failTask(taskId, `${project.name}: branch ${base} was not found, so there is no commit to check`);
          continue;
        }
        if (cliProblem) {
          this.failTask(taskId, cliProblem);
          continue;
        }
        const choice =
          settings.modelMode === 'auto'
            ? classifyQaTier(check.files, [...(project.high_risk_paths ?? []), ...BUILTIN_RISK_PATTERNS], settings)
            : null;
        const profile = qaProfileFor(settings, cli, choice?.tier ?? null);
        this.db.prepare('UPDATE bridge_tasks SET qa_tier = ?, qa_tier_reason = ? WHERE id = ?').run(choice?.tier ?? null, choice?.reason ?? null, taskId);
        const bodyMd = buildQaPrompt({
          reqId, title: req.title, bodyMd: req.body_md, project: project.name, commit: check.commit, from: check.from,
          changedFiles: check.files.map((f) => f.path),
          commands: { test: project.test_command, build: project.build_command, lint: project.lint_command },
          maxFindings: settings.maxFindings, stage, previewInto: stage === 'review' ? base : null,
        });
        this.runs.create({
          bridgeTaskId: taskId, project: project.name, title: `AI QA · ${reqId}`, bodyMd, model: profile.model, effort: profile.effort,
          preferredCli: settings.agentCli === 'default' ? null : settings.agentCli,
        });
        const why = choice ? ` · ${choice.tier}: ${choice.reason}` : '';
        const uses = `${profile.model ?? 'the CLI default model'} · ${profile.effort ?? 'the default effort'}`;
        this.log(taskId, `AI QA queued (${trigger === 'auto' ? 'the requirement entered review' : 'Run AI QA'}) for ${check.commit.slice(0, 7)}${why} → ${uses}`);
      }
      this.opts.emit?.({ type: 'qa_started', req_id: reqId, payload: { reqId, round, stage, trigger, projects: repos.map((p) => p.name) } });
      this.opts.engine.nudge();
    } finally {
      this.starting.delete(reqId);
    }
    return this.status(reqId);
  }

  /** The requirement entered review: start AI QA when Settings → AI QA → Run automatically is on. Never throws. */
  public async onEnteredReview(reqId: string): Promise<void> {
    if (!this.settings.getAiQaSettings().runAutomatically) return;
    try {
      await this.start(reqId, 'auto');
    } catch (err: any) {
      console.warn(`[ai-qa] ${reqId}: AI QA did not start: ${err?.message || err}`);
    }
  }

  /** Why an automatic merge must wait for AI QA, or null. */
  public autoMergeHold(reqId: string): string | null {
    const marks = ACTIVE_STATUSES.map(() => '?').join(', ');
    const active = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM bridge_tasks WHERE req_id = ? AND role = 'qa' AND qa_stage = 'review' AND status IN (${marks})`)
        .get(reqId, ...ACTIVE_STATUSES) as { n: number }
    ).n;
    if (active > 0 || this.starting.has(reqId)) return 'AI QA is still checking';
    const blockers = this.openReviewBlockers(reqId);
    if (blockers > 0) return `${blockers} open AI QA blocker${blockers === 1 ? '' : 's'}`;
    return null;
  }

  /** `xticket comment`: an open review comment marked AI QA on the repository's card. */
  public addFinding(input: unknown, project: string, runId: string | undefined): { commentId: number; duplicate: boolean } {
    const finding = QaFindingInputSchema.parse(input);
    const qa = this.qaTaskOf(project, runId);
    this.requireStage(qa, 'finding');
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
    this.requireStage(qa, 'result');
    this.db
      .prepare('UPDATE bridge_tasks SET qa_passed = ?, qa_summary = ?, updated_at = ? WHERE id = ?')
      .run(result.passed ? 1 : 0, result.summary, new Date().toISOString(), qa.id);
    this.log(qa.id, `${result.passed ? '✓ AI QA passed' : '✗ AI QA found problems'}: ${oneLine(result.summary, 300)}`);
    this.opts.emit?.({ type: 'qa_result', req_id: qa.req_id, task_id: qa.id, payload: { reqId: qa.req_id, project: qa.project, passed: result.passed } });
    return { ok: true, passed: result.passed, summary: result.summary };
  }

  /** The requirement header: the latest QA round, per repository. */
  public status(reqId: string): RequirementQa {
    const req = this.opts.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
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
        tier: task.qa_tier ?? null, tierReason: task.qa_tier_reason ?? null,
      };
    });
    const skipped = round
      ? this.projectsOf(reqId).filter((p) => !isGitWorkTree(p.repo_path)).map((p) => ({ project: p.name, reason: 'not a git repository' }))
      : [];
    const stage: QaStage | null = tasks.length ? (tasks[0].qa_stage ?? 'qa') : null;
    const first = tasks.length ? this.opts.projectService.getProject(tasks[0].project) : null;
    const holds = req.status === 'in_review' && this.branches.policyFor(reqId) === 'auto_merge';
    return {
      reqId, round, running: tasks.some((t) => ACTIVE_STATUSES.includes(t.status)), runs, skipped, findings, stage,
      previewInto: stage === 'review' && first ? this.branches.baseBranchFor(first, reqId) : null,
      openBlockers: this.openReviewBlockers(reqId),
      autoMergeHold: holds ? this.autoMergeHold(reqId) : null,
    };
  }

  /** In review: the merge preview of the repository's unmerged branches; in QA (or with nothing unmerged): the branch tip. */
  private async commitToCheck(project: Project, reqId: string, stage: QaStage, base: string, unmerged: BridgeTask[]): Promise<CommitToCheck> {
    if (stage === 'review' && unmerged.length > 0) {
      const preview = await buildMergePreview(project.repo_path, base, project.name, reqId, unmerged, { tmpRoot: this.opts.tmpRoot });
      if (!preview.ok) return { commit: null, from: null, files: [], error: preview.error };
      return { commit: preview.sha, from: preview.from, files: diffSummary(project.repo_path, preview.from, preview.sha) };
    }
    const commit = resolveCommit(project.repo_path, `refs/heads/${base}`) ?? resolveCommit(project.repo_path, `refs/remotes/origin/${base}`);
    const changes = this.changesOf(project, reqId);
    return { commit, from: changes.from, files: changes.files };
  }

  /** Open AI QA blocker findings from review rounds of the requirement. */
  private openReviewBlockers(reqId: string): number {
    return (
      this.db
        .prepare(`
          SELECT COUNT(*) AS n FROM review_comments c JOIN bridge_tasks q ON q.id = c.qa_task_id
          WHERE c.req_id = ? AND c.source = 'ai-qa' AND c.severity = 'blocker' AND c.state = 'open' AND q.qa_stage = 'review'
        `)
        .get(reqId) as { n: number }
    ).n;
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

  private insertTask(reqId: string, project: string, round: number, commit: string | null, stage: QaStage): number {
    const at = new Date().toISOString();
    return Number(
      this.db
        .prepare(`
          INSERT INTO bridge_tasks (req_id, project, role, title, status, base_sha, revision, qa_stage, created_at, updated_at)
          VALUES (?, ?, 'qa', ?, 'queued', ?, ?, ?, ?, ?)
        `)
        .run(reqId, project, `AI QA · ${project}`, commit, round, stage, at, at).lastInsertRowid
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
  private changesOf(project: Project, reqId: string): { files: QaChangedFile[]; from: string | null } {
    const tasks = this.db
      .prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND project = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled' ORDER BY id")
      .all(reqId, project.name) as BridgeTask[];
    const files = new Map<string, QaChangedFile>();
    const add = (f: QaChangedFile) => {
      const known = files.get(f.path);
      files.set(f.path, known ? { ...known, additions: known.additions + f.additions, deletions: known.deletions + f.deletions } : { ...f });
    };
    let from: string | null = null;
    for (const t of tasks) {
      if (t.merge_sha) {
        const parent = resolveCommit(project.repo_path, `${t.merge_sha}^1`);
        if (!parent) continue;
        from ??= parent;
        for (const f of diffSummary(project.repo_path, parent, t.merge_sha)) add(f);
      } else if (t.branch) {
        try {
          for (const f of this.taskChanges.changes(t.id).files) add(f);
        } catch {
          // The branch is gone: nothing to list for it.
        }
        from ??= t.base_sha ?? null;
      }
    }
    return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), from };
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

  /** Reports are saved while the requirement is still in the stage its round checks. */
  private requireStage(qa: BridgeTask, what: 'finding' | 'result') {
    const stage: QaStage = qa.qa_stage ?? 'qa';
    const status = this.opts.requirementService.getRequirement(qa.req_id)?.status;
    if (status !== STAGE_STATUS[stage]) throw conflict(`${qa.req_id} is no longer ${STAGE_WORDS[stage]}; this ${what} was not saved`);
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

- [ ] **Step 5: The route and the wiring**

`packages/server/src/api/humanLoopRoutes.ts`: replace the `app.post('/api/requirements/:id/qa', …)` handler with:

```ts
  app.post('/api/requirements/:id/qa', async (req, res, next) => {
    try {
      res.status(202).json(await deps.qaService.start(req.params.id, 'manual'));
    } catch (err) {
      next(err);
    }
  });
```

`packages/server/src/api/app.ts`: delete the line `      onEnteredQa: (reqId, commits) => qaService.onEnteredQa(reqId, commits),` from the `new MergeGateService(…)` options. The options keep only `settingsService,`. AI QA no longer starts on entering QA; Task 6 wires the In Review start.

`packages/server/src/index.ts`: delete these two lines from the `new MergeGateService(…)` options:

```ts
  // Entering QA after a merge starts AI QA (Settings → AI & Local Engines → AI QA → Run automatically).
  onEnteredQa: (reqId, commits) => qaService.onEnteredQa(reqId, commits),
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/services/qaService.test.ts packages/server/src/localEngine/qaPrompt.test.ts packages/server/src/api packages/server/src/services/branchMerge.test.ts && npx tsc --noEmit -p packages/server`

Expected: PASS, with no type errors. That covers:
- the 25 `QaService` tests, the prompt test and the route tests;
- the merge gate tests (the old `onEnteredQa` test still passes, because the merge gate keeps the option until Task 6).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/qaService.ts packages/server/src/services/qaService.test.ts packages/server/src/localEngine/qaPrompt.ts packages/server/src/localEngine/qaPrompt.test.ts packages/server/src/api/humanLoopRoutes.ts packages/server/src/api/app.ts packages/server/src/index.ts packages/server/src/api/aiQaRoutes.test.ts
git commit -m "feat(server): AI QA rounds in review on a merge preview, with the model by size and risk"
```

---
### Task 5: The runner: stop by stage, and report finished QA

**Files:**
- Modify: `packages/server/src/localEngine/agentRunner.ts` (`AgentRunnerOptions`, `stopQaOutsideQa`, `followRun`)
- Modify: `packages/server/src/testing/localEngineFixture.ts` (`queueQaRun`)
- Modify: `packages/server/src/localEngine/agentRunnerQa.test.ts`

**Interfaces:**
- Consumes: `BridgeTask.qa_stage` and migration 12 (Task 1).
- Produces:
  - `AgentRunnerOptions.onQaFinished?: (reqId: string) => void`. It is called once when a QA task changes to `done`, `failed` or `cancelled`.
  - `LocalHarness.queueQaRun(bodyMd: string, sha?: string, stage?: 'review' | 'qa')`. A `review` stage puts the requirement `in_review`.
  - The stop sweep logs `■ <REQ> is no longer in review; AI QA stops` for review runs.

- [ ] **Step 1: The fixture** (`packages/server/src/testing/localEngineFixture.ts`)

- In the `LocalHarness` interface, change `queueQaRun` to:

```ts
  /** An AI QA task of `req` checking `sha` (default: develop's tip), with its run queued; the requirement moves to the stage's status. */
  queueQaRun(bodyMd: string, sha?: string, stage?: 'review' | 'qa'): { run: LocalRun; taskId: number };
```

- Replace the `queueQaRun` const with:

```ts
  const queueQaRun = (bodyMd: string, sha: string = resolveCommit(repo, 'refs/heads/develop')!, stage: 'review' | 'qa' = 'qa') => {
    db.prepare('UPDATE requirements SET status = ? WHERE id = ?').run(stage === 'review' ? 'in_review' : 'qa', req.id);
    const now = new Date().toISOString();
    const taskId = Number(
      db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, base_sha, qa_stage, created_at, updated_at) VALUES (?, 'backend', 'qa', 'AI QA · backend', 'queued', ?, ?, ?, ?)")
        .run(req.id, sha, stage, now, now).lastInsertRowid
    );
    const run = runner.runs.create({ bridgeTaskId: taskId, project: 'backend', title: `AI QA · ${req.id}`, bodyMd });
    return { run, taskId };
  };
```

- [ ] **Step 2: Write the failing tests** (append inside `describe('AgentRunner: AI QA runs', …)` in `packages/server/src/localEngine/agentRunnerQa.test.ts`)

```ts
  it('stops a review run when the requirement is merged to QA', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: sleep 5000', undefined, 'review');
    await h.runner.tick();
    await waitFor(() => qaTask(h, taskId).status === 'running');

    h.db.prepare("UPDATE requirements SET status = 'qa' WHERE id = ?").run(h.req.id);
    await h.settle();

    expect(h.run(run.id).status).toBe('cancelled');
    expect(qaTask(h, taskId).status).toBe('cancelled');
    expect(h.logText(taskId)).toContain(`■ ${h.req.id} is no longer in review; AI QA stops`);
  });

  it('keeps a review run while the requirement stays in review', async () => {
    const h = makeLocalHarness();
    const { run, taskId } = h.queueQaRun('FAKE: say checked', undefined, 'review');
    await h.settle();
    expect(h.run(run.id).status).toBe('done');
    expect(qaTask(h, taskId)).toMatchObject({ status: 'done', qa_stage: 'review' });
  });

  it('tells the merge gate once when a QA task finishes', async () => {
    const h = makeLocalHarness();
    const calls: string[] = [];
    const runner = h.newRunner({ onQaFinished: (reqId) => calls.push(reqId) });
    h.queueQaRun('FAKE: say checked', undefined, 'review');
    await h.settle(runner);
    expect(calls).toEqual([h.req.id]);
  });
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run packages/server/src/localEngine/agentRunnerQa.test.ts`

Expected: FAIL in three ways:
- the review run is cancelled while it stays in review (today's sweep wants `qa`);
- the merged-to-QA run isn't stopped;
- `calls` is empty.

- [ ] **Step 4: The runner** (`packages/server/src/localEngine/agentRunner.ts`)

- Add to `AgentRunnerOptions`, after `onCommits`:

```ts
  /** An AI QA task finished (done, failed or cancelled): the merge gate re-checks its auto-merge hold. */
  onQaFinished?: (reqId: string) => void;
```

- Replace `stopQaOutsideQa()` with:

```ts
  /** AI QA runs stop once the requirement leaves the stage they check (review: in_review, qa: qa), or their task is cancelled. */
  private stopQaOutsideQa() {
    const rows = this.opts.db
      .prepare(`
        SELECT r.id AS runId, t.id AS taskId, t.req_id AS reqId, COALESCE(t.qa_stage, 'qa') AS stage FROM local_runs r
        JOIN bridge_tasks t ON t.id = r.bridge_task_id
        JOIN requirements q ON q.id = t.req_id
        WHERE t.role = 'qa' AND r.status IN ('queued', 'running', 'rate_limited') AND r.cancel_requested_at IS NULL
          AND (q.status <> CASE COALESCE(t.qa_stage, 'qa') WHEN 'review' THEN 'in_review' ELSE 'qa' END OR t.status = 'cancelled')
      `)
      .all() as Array<{ runId: string; taskId: number; reqId: string; stage: string }>;
    for (const row of rows) {
      this.log(row.taskId, 'system', `■ ${row.reqId} is no longer ${row.stage === 'review' ? 'in review' : 'in QA'}; AI QA stops`);
      void this.cancel(row.runId).catch((err) => console.warn(`[local-engine] run ${row.runId}: ${err?.message || err}`));
    }
  }
```

- Replace `followRun()` with:

```ts
  /** A QA task has no engine to sync it: its status follows its run (a no-op for other tasks). */
  private followRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    const status = toEngineTask(run).status;
    const changed = this.opts.db
      .prepare("UPDATE bridge_tasks SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND role = 'qa' AND status <> 'cancelled' AND status <> ?")
      .run(status, status === 'failed' ? run.error : null, new Date().toISOString(), run.bridge_task_id, status).changes;
    if (changed === 1 && (status === 'done' || status === 'failed' || status === 'cancelled')) {
      const reqId = this.task(run.bridge_task_id)?.req_id;
      if (reqId) this.opts.onQaFinished?.(reqId);
    }
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/localEngine packages/server/src/adapters && npx tsc --noEmit -p packages/server`

Expected: PASS. That covers the 3 new tests and every existing runner test, including `a requirement can be marked done while AI QA runs, and the run stops` (QA stage). No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/localEngine/agentRunner.ts packages/server/src/testing/localEngineFixture.ts packages/server/src/localEngine/agentRunnerQa.test.ts
git commit -m "feat(local-engine): AI QA runs stop by stage; finished QA tasks are reported"
```

---

### Task 6: The merge gate waits for AI QA; wiring

**Files:**
- Modify: `packages/server/src/services/mergeGate.ts` (`MergeGateOptions`, `autoStart`, `finishSuccess`)
- Modify: `packages/server/src/services/branchMerge.test.ts`
- Modify: `packages/server/src/api/app.ts`, `packages/server/src/index.ts`

**Interfaces:**
- Consumes:
  - Task 4: `QaService.onEnteredReview`, `QaService.autoMergeHold`.
  - Task 5: `AgentRunnerOptions.onQaFinished`.
- Produces:
  - `MergeGateOptions.autoMergeHold?: (reqId: string) => string | null`.
  - `MergeGateOptions.onEnteredQa` is removed.
  - Entering review starts AI QA, then the auto-merge (which waits while held).
  - A finished QA task re-checks the auto-merge.

- [ ] **Step 1: Write the failing test**

In `packages/server/src/services/branchMerge.test.ts`, inside `describe('Merge gate', …)`:
- delete the test `hands each merged commit to AI QA once the requirement is in QA, and nothing when the merge fails`;
- add:

```ts
  it('auto-merge waits while AI QA holds it, then merges', async () => {
    h = makeGitHarness();
    let hold: string | null = 'AI QA is still checking';
    const gate = new MergeGateService(h.db, h.projectService, h.requirementService, h.reactor, {
      getAdapter: (name: string) => h.adapters[name] ?? h.adapters.backend,
      testTimeoutMs: 20_000,
      tmpRoot: path.join(h.ws, 'tmp'),
      autoMergeHold: () => hold,
    });
    const { req } = await readyForGate();
    h.requirementService.updateRequirementMergePolicy(req.id, 'auto_merge');

    gate.autoStart(req.id);
    expect(reqRow(req.id).status).toBe('in_review');
    expect(reqRow(req.id).merge_state ?? 'idle').toBe('idle');

    hold = null;
    gate.autoStart(req.id);
    for (let i = 0; i < 400 && !(reqRow(req.id).status === 'qa' && reqRow(req.id).merge_state === 'idle'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(reqRow(req.id)).toMatchObject({ status: 'qa', merge_state: 'idle' });
  });
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run packages/server/src/services/branchMerge.test.ts -t "waits while AI QA holds"`

Expected: FAIL. The first `autoStart` merges anyway: `merge_state` is `running`, or the status reaches `qa`.

- [ ] **Step 3: The merge gate** (`packages/server/src/services/mergeGate.ts`)

- In `MergeGateOptions`, replace the `onEnteredQa` option and its doc comment with:

```ts
  /** Why an automatic merge must wait (AI QA still checking, or open blockers); null lets it start. */
  autoMergeHold?: (reqId: string) => string | null;
```

- In `finishSuccess`, delete the whole `if (movedToQa) { try { this.options.onEnteredQa?.(…); } catch (err: any) { … } }` block.
- Replace `autoStart` with:

```ts
  /** Auto-merge policy: start as soon as all work is in review and AI QA does not hold it; "not ready" is not an error. */
  public autoStart(reqId: string): void {
    if (this.branches.policyFor(reqId) !== 'auto_merge' || !this.needsMerge(reqId)) return;
    if (this.options.autoMergeHold?.(reqId)) return; // re-checked when AI QA finishes (AgentRunner onQaFinished)
    try {
      void this.start(reqId, 'auto').done;
    } catch {
      // Not ready yet, or already merging.
    }
  }
```

- [ ] **Step 4: Wiring**

`packages/server/src/api/app.ts`:
- In the `new MergeGateService(…)` options, after `settingsService,`, add `autoMergeHold: (reqId) => qaService.autoMergeHold(reqId),`.
- Replace

```ts
    // createApp built the reactor, so it also wires the auto-merge policy to it.
    reactor.setHooks({ onRequirementInReview: (id) => mergeGate.autoStart(id) });
```

with

```ts
    // createApp built the reactor, so it also wires AI QA in review and the auto-merge policy to it.
    reactor.setHooks({ onRequirementInReview: (id) => void qaService.onEnteredReview(id).finally(() => mergeGate.autoStart(id)) });
```

`packages/server/src/index.ts`:
- In `new AgentRunner({ … })`, after `onCommits: (taskId) => branchService.pushTaskBranch(taskId),`, add:

```ts
  // A finished AI QA round may release a held auto-merge.
  onQaFinished: (reqId) => mergeGate.autoStart(reqId),
```

- In `new MergeGateService(…)`, after `releaseWorktree: …,`, add `autoMergeHold: (reqId) => qaService.autoMergeHold(reqId),`.
- Replace

```ts
// Auto-merge policy: start the merge gate when all of a requirement's work is in review.
reactor.setHooks({ onRequirementInReview: (id) => mergeGate.autoStart(id) });
```

with

```ts
// Entering review: AI QA starts (Settings → AI QA → Run automatically), then the auto-merge policy merges
// once AI QA no longer holds it (finished without open blockers).
reactor.setHooks({ onRequirementInReview: (id) => void qaService.onEnteredReview(id).finally(() => mergeGate.autoStart(id)) });
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run packages/server/src/services/branchMerge.test.ts packages/server/src/api packages/server/src/services/qaService.test.ts && npx tsc --noEmit -p packages/server`

Expected: PASS. The merge gate suite includes `auto-merge policy merges as soon as the last task reaches review`, which has no hold; the API and QA suites also pass. No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/mergeGate.ts packages/server/src/services/branchMerge.test.ts packages/server/src/api/app.ts packages/server/src/index.ts
git commit -m "feat(server): entering review starts AI QA; auto-merge waits for it"
```

---
### Task 7: Web: the header in In Review, and the question before a merge

**Files:**
- Modify: `packages/web/src/lib/aiQa.ts` (`qaStatusLine`, `runAiQaBlocked`; new `qaRoundTitle`, `qaRunTitle`, `mergeWarning`)
- Modify: `packages/web/src/lib/aiQa.test.ts`
- Modify (full replacement below): `packages/web/src/components/AiQaHeader.tsx`
- Create: `packages/web/src/components/MergeAiQaConfirm.tsx`
- Modify: `packages/web/src/components/RequirementDetailSheet.tsx`, `packages/web/src/pages/RequirementDetailPage.tsx`, `packages/web/src/pages/RequirementsPage.tsx`

**Interfaces:**
- Consumes: `RequirementQa.stage / previewInto / openBlockers / autoMergeHold` and `QaRunView.tier / tierReason` (Task 1); the `POST /qa` route in In Review (Task 4).
- Produces:
  - `runAiQaBlocked(req: { status: RequirementStatus; merge_state?: string | null }, qa: RequirementQa | undefined): string | null`. It replaces the `(status, qa)` signature.
  - `qaRoundTitle(qa: RequirementQa): string` and `qaRunTitle(run: QaRunView): string`.
  - `mergeWarning(qa: RequirementQa | null | undefined): string | null`.
  - `useAskBeforeMerge(): { askBeforeMerge(req: Pick<Requirement, 'id' | 'status'>, merge: () => void): void; mergeDialog: ReactNode }`.

- [ ] **Step 1: Write the failing tests** (`packages/web/src/lib/aiQa.test.ts`)

- Change the import to `import { aiQaDraftProblem, findingsText, mergeWarning, qaBadge, qaCliStatus, qaRoundTitle, qaRunText, qaRunTitle, qaStatusLine, runAiQaBlocked } from './aiQa';`.
- Replace the test `offers Run AI QA only in QA and while nothing runs` with:

```ts
  it('offers Run AI QA in review and in QA, while nothing runs and no merge runs', () => {
    expect(runAiQaBlocked({ status: 'in_progress' }, undefined)).toBe('AI QA runs while the requirement is in review or in QA');
    expect(runAiQaBlocked({ status: 'in_review' }, undefined)).toBeNull();
    expect(runAiQaBlocked({ status: 'qa', merge_state: 'running' }, undefined)).toBe('A merge is running');
    expect(runAiQaBlocked({ status: 'qa' }, qa([run('backend', 'running')]))).toBe('AI QA is running');
    expect(runAiQaBlocked({ status: 'qa' }, qa([run('backend', 'done')]))).toBeNull();
  });

  it('prefixes review rounds with "AI QA before merge" and names a repository once', () => {
    const review = { stage: 'review' };
    expect(qaStatusLine(qa([run('backend', 'running')], review))?.text).toBe('AI QA before merge running… (backend …)');
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true })], review))).toEqual({ text: 'AI QA before merge: passed', tone: 'passed' });
    expect(qaStatusLine(qa([run('backend', 'done', { passed: true })], { ...review, findings: { total: 2, blocker: 0, major: 0, minor: 2 } }))?.text)
      .toBe('AI QA before merge: passed · 2 minor findings');
    expect(qaStatusLine(qa([run('backend', 'done', { passed: false })], { ...review, findings: { total: 1, blocker: 1, major: 0, minor: 0 } }))?.text)
      .toBe('AI QA before merge: 1 finding (1 blocker)');
    expect(qaStatusLine(qa([run('backend', 'failed', { error: 'backend: merging x into develop conflicts in a.ts' })], review))?.text)
      .toBe('AI QA before merge failed: backend: merging x into develop conflicts in a.ts');
  });

  it("titles the round and shows each repository's tier", () => {
    expect(qaRoundTitle(qa([run('backend', 'done')], { stage: 'review', previewInto: 'develop' }))).toBe('AI QA · round 1 · merge preview into develop');
    expect(qaRoundTitle(qa([run('backend', 'done')], { stage: 'qa', round: 2 }))).toBe('AI QA · round 2');
    expect(qaRunTitle(run('backend', 'done', { tier: 'light', tierReason: '42 lines in 3 files' }))).toBe('backend · light · 42 lines in 3 files');
    expect(qaRunTitle(run('backend', 'done'))).toBe('backend');
  });

  it('asks before a merge while a review round runs or blockers are open', () => {
    expect(mergeWarning(undefined)).toBeNull();
    expect(mergeWarning(qa([run('backend', 'running')], { stage: 'review', openBlockers: 0 }))).toBe('AI QA is still checking this requirement. Merge anyway?');
    expect(mergeWarning(qa([run('backend', 'done')], { stage: 'review', openBlockers: 2 }))).toBe('2 open AI QA blockers. Merge anyway?');
    expect(mergeWarning(qa([run('backend', 'done')], { stage: 'review', openBlockers: 1 }))).toBe('1 open AI QA blocker. Merge anyway?');
    expect(mergeWarning(qa([run('backend', 'done')], { stage: 'review', openBlockers: 0 }))).toBeNull();
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/web/src/lib/aiQa.test.ts`

Expected: FAIL, because `mergeWarning`, `qaRoundTitle` and `qaRunTitle` are not functions and `runAiQaBlocked` treats `{ status }` as a status.

- [ ] **Step 3: Helpers** (`packages/web/src/lib/aiQa.ts`)

Replace `qaStatusLine` with:

```ts
/** The requirement header's AI QA line (latest round), or null before the first QA run. */
export function qaStatusLine(qa: RequirementQa | null | undefined): { text: string; tone: QaTone } | null {
  if (!qa || qa.round === 0) return null;
  const prefix = qa.stage === 'review' ? 'AI QA before merge' : 'AI QA';
  const passed = qa.stage === 'review' ? 'AI QA before merge: passed' : 'AI QA passed';
  const skipped = qa.skipped.map((s) => `skipped ${s.project}: ${s.reason}`).join(' · ');
  const line = (text: string, tone: QaTone) => ({ text: skipped ? `${text} · ${skipped}` : text, tone });
  if (qa.running) return line(`${prefix} running… (${qa.runs.map((r) => `${r.project} ${RUN_MARK[r.status] ?? '…'}`).join(', ')})`, 'running');
  const findings = findingsText(qa.findings);
  const broken = qa.runs.find((r) => r.status === 'failed' || r.status === 'cancelled');
  if (broken) {
    const reason = broken.status === 'cancelled' ? 'stopped' : (broken.error ?? 'unknown error').split('\n')[0];
    // Many reasons already start with the repository ("backend: merging … conflicts"): name it once.
    const where = reason.startsWith(`${broken.project}: `) ? reason : `${broken.project}: ${reason}`;
    return line(`${prefix} failed: ${where}${findings ? ` · ${findings}` : ''}`, 'failed');
  }
  // Every agent said "passed" and nothing is a blocker: the findings are notes, not a failed check.
  if (findings && qa.findings.blocker === 0 && qa.runs.every((r) => r.passed === true)) return line(`${passed} · ${passedFindingsText(qa.findings)}`, 'passed');
  if (findings) return line(`${prefix}: ${findings}`, 'findings');
  const notPassed = qa.runs.find((r) => r.passed === false);
  if (notPassed) return line(`${prefix}: ${notPassed.project} did not pass${notPassed.summary ? `: ${notPassed.summary}` : ''}`, 'findings');
  // "Passed" only when every agent said so: one that ended without `xticket qa-result` gave no verdict.
  const noVerdict = qa.runs.find((r) => r.passed !== true);
  if (noVerdict) return line(`${prefix}: ${noVerdict.project} finished without a result`, 'findings');
  return line(passed, 'passed');
}

/** The popover title: the round, and for review rounds what the preview merged into. */
export function qaRoundTitle(qa: RequirementQa): string {
  return `AI QA · round ${qa.round}${qa.stage === 'review' && qa.previewInto ? ` · merge preview into ${qa.previewInto}` : ''}`;
}

/** A repository's line in the popover: its name, and the model tier with why. */
export function qaRunTitle(run: QaRunView): string {
  return run.tier ? `${run.project} · ${run.tier} · ${run.tierReason ?? ''}`.trim() : run.project;
}

/** The question before a merge, or null when there is nothing to ask. */
export function mergeWarning(qa: RequirementQa | null | undefined): string | null {
  if (!qa) return null;
  if (qa.stage === 'review' && qa.running) return 'AI QA is still checking this requirement. Merge anyway?';
  if (qa.openBlockers > 0) return `${qa.openBlockers} open AI QA blocker${qa.openBlockers === 1 ? '' : 's'}. Merge anyway?`;
  return null;
}
```

Replace `runAiQaBlocked` with:

```ts
/** Why "Run AI QA" is disabled, or null when it can run. */
export function runAiQaBlocked(req: { status: RequirementStatus; merge_state?: string | null }, qa: RequirementQa | undefined): string | null {
  if (req.status !== 'in_review' && req.status !== 'qa') return 'AI QA runs while the requirement is in review or in QA';
  if (req.merge_state === 'running') return 'A merge is running';
  if (qa?.running) return 'AI QA is running';
  return null;
}
```

- [ ] **Step 4: The header** (`packages/web/src/components/AiQaHeader.tsx`). Replace the whole file with:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ScrollText, ShieldCheck } from 'lucide-react';
import type { BridgeTask, Requirement } from '@sp-kickstack/shared';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { LiveTaskLogsDrawer } from './LiveTaskLogsDrawer.js';
import { fetchRequirementQa, runAiQa } from '../lib/aiQaApi.js';
import { QA_TONE_STYLE, qaRoundTitle, qaRunText, qaRunTitle, qaStatusLine, runAiQaBlocked } from '../lib/aiQa.js';

const RUN_BUTTON =
  'flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs font-bold shadow-xs active:scale-[0.98] transition-all disabled:opacity-50';

/** Requirement header, in review and in QA: the AI QA status (each repository's run and log) and "Run AI QA". */
export function AiQaHeader({ req, buttonClassName }: { req: Requirement; buttonClassName?: string }) {
  const queryClient = useQueryClient();
  const visible = req.status === 'in_review' || req.status === 'qa';
  const { data: qa } = useQuery({
    queryKey: ['requirement-qa', req.id],
    queryFn: () => fetchRequirementQa(req.id),
    enabled: visible,
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
  if (!visible) return null;

  const line = qaStatusLine(qa);
  const blocked = runAiQaBlocked(req, qa);
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
            <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{qaRoundTitle(qa)}</p>
            {qa.runs.map((r) => (
              <div key={r.task.id} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-slate-50 dark:hover:bg-[#262732]">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{qaRunTitle(r)}</p>
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
      {qa?.autoMergeHold && (
        <span
          className="max-w-xs truncate px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
          title="The auto-merge policy waits for AI QA"
        >
          Auto-merge paused: {qa.autoMergeHold}
        </span>
      )}
      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={Boolean(blocked) || run.isPending}
        title={blocked ?? "Check every repository with an AI agent: acceptance criteria, code review, test / build / lint"}
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

- [ ] **Step 5: The question** (`packages/web/src/components/MergeAiQaConfirm.tsx`)

```tsx
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GitMerge } from 'lucide-react';
import type { Requirement, RequirementQa } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { fetchRequirementQa } from '../lib/aiQaApi.js';
import { mergeWarning } from '../lib/aiQa.js';

const button = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#2e303d]';

/**
 * Before a move to QA merges a requirement that is in review: ask when AI QA is still checking it or found
 * open blockers. Requirements in other states merge without a question.
 */
export function useAskBeforeMerge(): { askBeforeMerge: (req: Pick<Requirement, 'id' | 'status'>, merge: () => void) => void; mergeDialog: ReactNode } {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ reqId: string; text: string; merge: () => void } | null>(null);

  const askBeforeMerge = (req: Pick<Requirement, 'id' | 'status'>, merge: () => void) => {
    if (req.status !== 'in_review') return merge();
    void queryClient
      .fetchQuery<RequirementQa>({ queryKey: ['requirement-qa', req.id], queryFn: () => fetchRequirementQa(req.id), staleTime: 2000 })
      .then((qa) => mergeWarning(qa), () => null)
      .then((text) => (text ? setPending({ reqId: req.id, text, merge }) : merge()));
  };

  const mergeDialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge {pending?.reqId} and move to QA?</DialogTitle>
          <DialogDescription>{pending?.text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" className={button} onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={`${button} bg-emerald-600 border-emerald-600 text-white`}
            onClick={() => {
              const merge = pending?.merge;
              setPending(null);
              merge?.();
            }}
          >
            <GitMerge className="w-3.5 h-3.5" />
            Merge anyway
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { askBeforeMerge, mergeDialog };
}
```

- [ ] **Step 6: Ask on every move to QA**

`packages/web/src/components/RequirementDetailSheet.tsx`:
- Add `import { useAskBeforeMerge } from './MergeAiQaConfirm.js';`.
- Directly before the line `  const mergeGateMutation = useMutation({`, add:

```tsx
  // Every move to QA merges: ask first when AI QA is still checking or found open blockers.
  const { askBeforeMerge, mergeDialog } = useAskBeforeMerge();
```

- In the State select's `onChange`, replace `else statusMutation.mutate(next);` with:

```tsx
                      else if (next === 'qa') askBeforeMerge(req, () => statusMutation.mutate(next));
                      else statusMutation.mutate(next);
```

- In the **Merge & move to QA** button, replace `onClick={() => mergeGateMutation.mutate()}` with `onClick={() => askBeforeMerge(req, () => mergeGateMutation.mutate())}`.
- Directly before the line `      {/* Radix UI Cancel Confirmation Dialog */}`, add `      {mergeDialog}`.

`packages/web/src/pages/RequirementDetailPage.tsx`:
- Add `import { useAskBeforeMerge } from '../components/MergeAiQaConfirm.js';`.
- Directly before `  const mergeGateMutation = useMutation({`, add the same two lines as in the side panel.
- In the State select's `onChange`, replace `else statusMutation.mutate(next);` with:

```tsx
                    else if (next === 'qa') askBeforeMerge(req, () => statusMutation.mutate(next));
                    else statusMutation.mutate(next);
```

- In the **Merge & move to QA** button, replace `onClick={() => mergeGateMutation.mutate()}` with `onClick={() => askBeforeMerge(req, () => mergeGateMutation.mutate())}`.
- Directly before `      {/* Live CLI Task Execution & Process Logs Drawer */}`, add `      {mergeDialog}`.

`packages/web/src/pages/RequirementsPage.tsx`:
- Add `import { useAskBeforeMerge } from '../components/MergeAiQaConfirm.js';`.
- Directly before `  const handleDropOnGroup = (targetGroupId: string) => {`, add `  const { askBeforeMerge, mergeDialog } = useAskBeforeMerge();`.
- In `handleDropOnGroup`, replace

```tsx
      } else if (req.status !== targetStatus) {
        updateStatusMutation.mutate({ id: req.id, status: targetStatus });
      }
```

with

```tsx
      } else if (req.status !== targetStatus) {
        const move = () => updateStatusMutation.mutate({ id: req.id, status: targetStatus });
        // Moving to QA merges: ask first when AI QA is still checking or found open blockers (Cancel leaves the card).
        if (targetStatus === 'qa') askBeforeMerge(req, move);
        else move();
      }
```

- Directly before `      {fanOutReq && (`, add `      {mergeDialog}`.

- [ ] **Step 7: Run the tests, the typecheck and the build**

Run: `(cd packages/shared && npx tsc -p .) && npx vitest run packages/web/src && (cd packages/web && npx tsc --noEmit && npx vite build)`

Expected: the web tests PASS (4 new or replaced), the typecheck is clean, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/aiQa.ts packages/web/src/lib/aiQa.test.ts packages/web/src/components/AiQaHeader.tsx packages/web/src/components/MergeAiQaConfirm.tsx packages/web/src/components/RequirementDetailSheet.tsx packages/web/src/pages/RequirementDetailPage.tsx packages/web/src/pages/RequirementsPage.tsx
git commit -m "feat(web): AI QA in the In Review header; ask before merging while AI QA checks or found blockers"
```

---

### Task 8: Web: Model Auto / Fixed with tiers, and High-risk paths

**Files:**
- Modify: `packages/web/src/lib/aiQa.ts` (`aiQaDraftProblem`; new `qaTierCli`, `TIER_LABEL`, `tierWhen`, `riskPathsFromText`, `riskPathsToText`)
- Modify: `packages/web/src/lib/aiQa.test.ts`
- Modify: `packages/web/src/components/AiQaSettingsSection.tsx`
- Modify: `packages/web/src/pages/ProjectsPage.tsx`

**Interfaces:**
- Consumes: `AiQaSettings.modelMode / tiers / lightMaxLines / deepMinLines`, `QaTier` and `Project.high_risk_paths` (Task 1).
- Produces:
  - `qaTierCli(agentCli: AiQaSettings['agentCli'], status: LocalEngineStatus | undefined): AgentCliId | null`.
  - `TIER_LABEL: Record<QaTier, string>`.
  - `tierWhen(tier: QaTier, s: Pick<AiQaSettings, 'lightMaxLines' | 'deepMinLines'>): string`.
  - `riskPathsFromText(text: string): string[]` and `riskPathsToText(paths: string[]): string`.

- [ ] **Step 1: Write the failing tests** (append to `packages/web/src/lib/aiQa.test.ts`; add `qaTierCli, riskPathsFromText, riskPathsToText, tierWhen` to the import)

```ts
describe('AI QA model by size and risk', () => {
  const draft = {
    runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
    modelMode: 'auto', tiers: DEFAULT_QA_TIERS, lightMaxLines: 150, deepMinLines: 1000,
  } as const;

  it('checks the line limits and the tier models', () => {
    expect(aiQaDraftProblem({ ...draft, lightMaxLines: 5 })).toBe('Light: changed lines must be a whole number from 10 to 5000.');
    expect(aiQaDraftProblem({ ...draft, deepMinLines: 20 })).toBe('Deep: changed lines must be a whole number from 50 to 100000.');
    expect(aiQaDraftProblem({ ...draft, lightMaxLines: 1000 })).toBe('The light limit must be lower than the deep limit.');
    const badTier = { ...DEFAULT_QA_TIERS, 'codex-cli': { ...DEFAULT_QA_TIERS['codex-cli'], deep: { model: 'bad model', effort: 'high' as const } } };
    expect(aiQaDraftProblem({ ...draft, tiers: badTier })).toBe('Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus');
  });

  it('edits the tiers of the CLI that runs AI QA, and says when each tier applies', () => {
    const status = { cli: 'claude-cli' } as any;
    expect(qaTierCli('default', status)).toBe('claude-cli');
    expect(qaTierCli('codex-cli', status)).toBe('codex-cli');
    expect(qaTierCli('default', undefined)).toBeNull();
    expect(tierWhen('light', draft)).toBe('Up to 150 changed lines in up to 8 files');
    expect(tierWhen('standard', draft)).toBe('Anything between light and deep');
    expect(tierWhen('deep', draft)).toBe('1000+ changed lines, 40+ files, or a risky path');
  });

  it('reads High-risk paths one per line or comma-separated', () => {
    expect(riskPathsFromText(' app/Http/Middleware/\n\ndatabase/**, config/auth.php , app/Http/Middleware/ ')).toEqual([
      'app/Http/Middleware/', 'database/**', 'config/auth.php',
    ]);
    expect(riskPathsToText(['a/', 'b/**'])).toBe('a/\nb/**');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run packages/web/src/lib/aiQa.test.ts`

Expected: FAIL, because `qaTierCli` / `tierWhen` / `riskPathsFromText` are not functions and the limits are not checked.

- [ ] **Step 3: Helpers** (`packages/web/src/lib/aiQa.ts`)

- Add `AgentCliId, QaTier` to the `@sp-kickstack/shared` type import.
- Replace `aiQaDraftProblem` with:

```ts
/** What is wrong with an AI QA settings draft before saving (the server checks the same), or null. */
export function aiQaDraftProblem(draft: AiQaSettings): string | null {
  if (!Number.isInteger(draft.timeLimitMinutes) || draft.timeLimitMinutes < 5 || draft.timeLimitMinutes > 240) {
    return 'Time limit must be a whole number of minutes from 5 to 240.';
  }
  if (!Number.isInteger(draft.maxFindings) || draft.maxFindings < 1 || draft.maxFindings > 200) return 'Maximum findings must be a whole number from 1 to 200.';
  if (!Number.isInteger(draft.lightMaxLines) || draft.lightMaxLines < 10 || draft.lightMaxLines > 5000) return 'Light: changed lines must be a whole number from 10 to 5000.';
  if (!Number.isInteger(draft.deepMinLines) || draft.deepMinLines < 50 || draft.deepMinLines > 100000) return 'Deep: changed lines must be a whole number from 50 to 100000.';
  if (draft.lightMaxLines >= draft.deepMinLines) return 'The light limit must be lower than the deep limit.';
  const models = [draft.model, ...Object.values(draft.tiers).flatMap((t) => [t.light.model, t.standard.model, t.deep.model])];
  if (models.some((m) => m !== null && !isValidModel(m))) return 'Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus';
  return null;
}

/** The CLI whose tiers the card edits: the one chosen for AI QA, else the Local AI CLI engine's. */
export function qaTierCli(agentCli: AiQaSettings['agentCli'], status: LocalEngineStatus | undefined): AgentCliId | null {
  return agentCli !== 'default' ? agentCli : (status?.cli ?? null);
}

export const TIER_LABEL: Record<QaTier, string> = { light: 'Light', standard: 'Standard', deep: 'Deep' };

/** When a tier applies, in words. */
export function tierWhen(tier: QaTier, s: Pick<AiQaSettings, 'lightMaxLines' | 'deepMinLines'>): string {
  if (tier === 'light') return `Up to ${s.lightMaxLines} changed lines in up to 8 files`;
  if (tier === 'deep') return `${s.deepMinLines}+ changed lines, 40+ files, or a risky path`;
  return 'Anything between light and deep';
}

/** High-risk paths typed one per line or comma-separated; blanks and repeats dropped. */
export function riskPathsFromText(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((p) => p.trim()).filter(Boolean))];
}

export function riskPathsToText(paths: string[]): string {
  return paths.join('\n');
}
```

- [ ] **Step 4: The settings card** (`packages/web/src/components/AiQaSettingsSection.tsx`)

- Change the type import to `import type { AiQaSettings, QaTier } from '@sp-kickstack/shared';`.
- Change the `../lib/aiQa.js` import to `import { TIER_LABEL, aiQaDraftProblem, qaCliStatus, qaTierCli, tierWhen } from '../lib/aiQa.js';`.
- In the switch's text, replace the two lines `<p …>Run automatically when a requirement enters QA</p>` and `<p …>Off: AI QA runs only when you click Run AI QA in the requirement header.</p>` with:

```tsx
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Run automatically when a requirement enters In Review</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Before the merge, on a merge preview. In QA, Run AI QA re-checks the merged code by hand.
            </p>
```

- Change the switch's `aria-label` to `"Run AI QA automatically when a requirement enters In Review"`.
- After `const cli = qaCliStatus(draft.agentCli, status);`, add:

```tsx
  const tierCli = qaTierCli(draft.agentCli, status);
  const setTier = (tier: QaTier, value: { model: string | null; effort: AiQaSettings['effort'] }) =>
    tierCli && set({ tiers: { ...draft.tiers, [tierCli]: { ...draft.tiers[tierCli], [tier]: value } } });
```

- Replace the whole `<div>` that holds `<span className={fieldLabel}>Model and effort</span>` and its `<AgentProfileFields … />` with:

```tsx
        <div className="space-y-3">
          <span className={fieldLabel} id="ai-qa-model">Model</span>
          <div role="radiogroup" aria-labelledby="ai-qa-model" className="flex flex-wrap gap-1.5">
            {([
              ['auto', 'Auto (by size and risk)'],
              ['fixed', 'Fixed'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={draft.modelMode === value}
                onClick={() => set({ modelMode: value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  draft.modelMode === value
                    ? 'border-[#7b68ee] bg-[#7b68ee]/10 text-[#7b68ee]'
                    : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.modelMode === 'fixed' ? (
            <AgentProfileFields
              value={{ model: draft.model, effort: draft.effort }}
              onChange={(v) => set({ model: v.model, effort: v.effort })}
              defaultChipLabel="Engine default"
              defaultTitle="Use the Local AI CLI engine's model and effort"
            />
          ) : tierCli ? (
            <div className="space-y-3">
              {(['light', 'standard', 'deep'] as const).map((tier) => (
                <div key={tier} className="rounded-xl border border-slate-200 dark:border-[#2e303d] p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {TIER_LABEL[tier]} <span className="font-normal text-slate-500">· {tierWhen(tier, draft)}</span>
                  </p>
                  <AgentProfileFields
                    value={draft.tiers[tierCli][tier]}
                    onChange={(v) => setTier(tier, v)}
                    defaultChipLabel="CLI default"
                    defaultTitle="The CLI's own default"
                  />
                </div>
              ))}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className={fieldLabel}>Light: up to (changed lines)</span>
                  <input type="number" min={10} max={5000} className={input} value={draft.lightMaxLines} onChange={(e) => set({ lightMaxLines: Number(e.target.value) })} />
                </label>
                <label className="block">
                  <span className={fieldLabel}>Deep: from (changed lines)</span>
                  <input type="number" min={50} max={100000} className={input} value={draft.deepMinLines} onChange={(e) => set({ deepMinLines: Number(e.target.value) })} />
                </label>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Risky paths: each project's High-risk paths (Projects page), plus database migrations, auth and security code, payments,
                CI and deploy files, and env or secret files.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Choose a CLI above, or turn on the Local AI CLI engine, to edit the tiers.
            </p>
          )}
        </div>
```

- [ ] **Step 5: High-risk paths** (`packages/web/src/pages/ProjectsPage.tsx`)

1. Add `import { riskPathsFromText, riskPathsToText } from '../lib/aiQa.js';`.
2. After `const [lintCommand, setLintCommand] = useState('');`, add `const [riskPaths, setRiskPaths] = useState('');`.
3. After `const [editLintCommand, setEditLintCommand] = useState('');`, add `const [editRiskPaths, setEditRiskPaths] = useState('');`.
4. After `setEditLintCommand(proj.lint_command || '');`, add `setEditRiskPaths(riskPathsToText(proj.high_risk_paths ?? []));`.
5. After `setLintCommand('');` (the create form's reset), add `setRiskPaths('');`.
6. In the create payload, after `lint_command: lintCommand.trim() || undefined,`, add `high_risk_paths: riskPathsFromText(riskPaths),`.
7. In the update payload, after `lint_command: editLintCommand.trim() || null,`, add `high_risk_paths: riskPathsFromText(editRiskPaths),`.
8. In the edit form, after the **Lint Command (Optional)** block bound to `editLintCommand`, add:

```tsx
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  High-risk paths (Optional)
                </label>
                <textarea
                  rows={3}
                  value={editRiskPaths}
                  onChange={(e) => setEditRiskPaths(e.target.value)}
                  placeholder={'app/Http/Middleware/\ndatabase/**'}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
                <p className="mt-1 text-[11px] text-slate-500">One path or pattern per line. AI QA uses its strongest model when a change touches these paths.</p>
              </div>
```

9. In the create form, after the **Lint Command (Optional)** block bound to `lintCommand`, add the same block bound to `riskPaths` / `setRiskPaths`.
10. In the details view, after the `(['build_command', 'lint_command'] as const).map(…)` block, add:

```tsx
              {(selectedProject.high_risk_paths ?? []).length > 0 && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">High-risk paths</span>
                  {selectedProject.high_risk_paths.map((p) => (
                    <p key={p} className="font-semibold text-slate-800 dark:text-slate-200 font-mono">{p}</p>
                  ))}
                </div>
              )}
```

- [ ] **Step 6: Run the tests, the typecheck and the build**

Run: `npx vitest run packages/web/src && (cd packages/web && npx tsc --noEmit && npx vite build)`

Expected: PASS (3 new tests), the typecheck is clean, and the build succeeds.

- [ ] **Step 7: Check the compiled modules on the running dev server**

Run: `for m in components/AiQaSettingsSection.tsx components/AiQaHeader.tsx components/MergeAiQaConfirm.tsx pages/ProjectsPage.tsx pages/RequirementsPage.tsx; do curl -s -o /dev/null -w "$m %{http_code}\n" localhost:4101/src/$m; done`

Expected: `200` for each. If the dev server is not running, note that in the ledger. Do not save settings or projects on the live server.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/aiQa.ts packages/web/src/lib/aiQa.test.ts packages/web/src/components/AiQaSettingsSection.tsx packages/web/src/pages/ProjectsPage.tsx
git commit -m "feat(web): AI QA model Auto/Fixed with tiers per CLI; High-risk paths on projects"
```

---

### Task 9: Docs, desktop bundle, full check

**Files:**
- Modify: `docs/guide/06-review-qa-and-merge.md`, `docs/guide/09-settings-and-environment.md`, `docs/guide/02-projects-and-engines.md`, `docs/guide/10-troubleshooting.md`
- Modify (generated): `packages/desktop/src-tauri/resources/server/index.mjs`

**Interfaces:**
- Consumes: the wording of Tasks 1–8.
- Produces: user docs; the desktop bundle with this feature.

- [ ] **Step 1: Guide 06.** In `docs/guide/06-review-qa-and-merge.md`, replace everything from the line `## AI QA` up to (not including) `## Finish QA` with:

```markdown
## AI QA

AI QA checks a requirement's code with an AI agent **before it is merged**. When a requirement enters
**In Review**, AI QA starts by itself (Settings → AI & Local Engines → **AI QA** → **Run automatically
when a requirement enters In Review**, on by default).

### What it checks

For each repository, AI QA builds a **merge preview**: the repository's task branches merged into its
target branch (else its base branch) in a temporary copy, exactly what **Merge & move to QA** would
produce. No branch moves. The agent then checks:

1. Each acceptance criterion: is it met by the code?
2. The changed files: bugs, missing error handling and edge cases, security problems, and breaches of the
   repository's `CLAUDE.md` / `AGENTS.md`.
3. The project's **Test Command**, **Build Command** and **Lint Command**, each only when set (see
   [02](02-projects-and-engines.md#the-test-command)).

How the agent runs:

- It uses the Local AI CLI engine's CLI, or the one chosen for AI QA.
- It works in a temporary copy, for every repository that is a git repository, whatever that repository's
  engine.
- It never commits, pushes or changes a branch, and the copy is deleted when the run ends.
- QA runs count toward **Parallel agents**.
- If the branches conflict, that repository's check stops at once and names the conflicting files:
  `backend: merging … into develop conflicts in a.ts (Merge & move to QA would conflict too)`.

### Model by size and risk

With **Model: Auto** (the default), each repository's check uses a model that fits its change:

| Tier | When | Claude Code |
|---|---|---|
| **Light** | Up to 150 changed lines in up to 8 files | haiku · low effort |
| **Standard** | Anything between light and deep | sonnet · medium |
| **Deep** | 1000+ changed lines, 40+ files, or a risky path | opus · high |

The risky paths are the project's **High-risk paths** (see [02](02-projects-and-engines.md)), plus
database migrations, auth and security code, payments, CI and deploy files, and env or secret files. The
tiers and limits are editable (see [09](09-settings-and-environment.md#ai-qa)). The header popover shows
each repository's tier and why, for example `backend · light · 42 lines in 3 files`.

### The header

The requirement header shows the result, in In Review and in QA:

- `AI QA before merge running… (backend ✓, frontend …)` while it runs.
- `AI QA before merge: 3 findings (1 blocker)`, `AI QA before merge: passed`, or
  `AI QA before merge: passed · 3 minor findings` (every run passed and no finding is a blocker) when it is
  done.
- `AI QA before merge failed: <reason>` for a run that could not finish.
- `skipped <project>: not a git repository` for a repository it cannot check.

Click the status to see each repository's run and to open its **Log**. A manual check in QA (see below)
reads `AI QA …` without "before merge".

### Findings

Each finding is an **open review comment** on the repository's card. It is badged **AI QA · blocker**,
**AI QA · major** or **AI QA · minor**, with the file and line when the agent named them.

- **blocker**: an acceptance criterion is not met, tests or the build fail, data loss, security.
- **major**: a real bug or a likely failure.
- **minor**: quality, naming, small gaps.

Nothing is sent to the agents by itself. Edit, resolve or delete findings like any comment, and send the
ones you keep with **Request changes**. The requirement goes back to In Progress; when the agents finish
again, it re-enters In Review and AI QA checks it again.

### Before the merge

While AI QA is still checking, or while blocker findings are open, every move to QA asks first:
**Merge & move to QA**, the **State** select, and dragging the card to QA. The question is
"AI QA is still checking this requirement. Merge anyway?" or "2 open AI QA blockers. Merge anyway?".
**Merge anyway** merges as usual and stops the check; **Cancel** leaves the requirement In Review.

With the **auto-merge** policy, the automatic merge waits for AI QA. It merges when AI QA has finished and
no blocker is open; otherwise the requirement stays In Review and the header says why, for example
`Auto-merge paused: 1 open AI QA blocker`.

### Run AI QA

**Run AI QA** (in the header) starts a check by hand. It is disabled while AI QA or a merge runs.

- **In In Review** it checks the merge preview again, for example after you resolved findings.
- **In QA** it checks the merged code (the current tip of the branch the requirement merged into), for
  example when develop moved after the preview. Nothing runs by itself in QA.

Moving the requirement out of the stage a check is for (merge, Request changes, Done, Cancel) stops that
check.

```

- [ ] **Step 2: Guide 09.** In `docs/guide/09-settings-and-environment.md`, replace everything from `### AI QA` up to (not including) `### Git & Branch Rules` with:

```markdown
### AI QA

On **AI & Local Engines**, the **AI QA** card controls the agent that checks a requirement before it is
merged (see [AI QA](06-review-qa-and-merge.md#ai-qa)).

| Setting | Default | Meaning |
|---|---|---|
| **Run automatically when a requirement enters In Review** | on | Off: AI QA runs only when you click **Run AI QA**. |
| **CLI** | **Local engine's CLI** | Which CLI runs QA. It must be installed and turned on. |
| **Model** | **Auto (by size and risk)** | **Auto** picks a tier per repository from its change; **Fixed** uses one model and effort for every check. |
| **Tiers** (Auto) | Claude Code: haiku · low / sonnet · medium / opus · high; Codex and AGY: the CLI's default model · low / medium / high | The model and effort of each tier, for the CLI that runs QA. |
| **Light: up to** / **Deep: from** (Auto) | 150 / 1000 changed lines | Light also needs 8 files or fewer; deep also applies at 40+ files or a risky path. The light limit must be lower than the deep one. |
| **Time limit per QA run** | 30 minutes | 5 to 240. A longer QA run is stopped and shows `AI QA failed`. |
| **Maximum findings per QA run** | 30 | 1 to 200. Further findings are refused (`The QA run reached its limit of N findings`). |

The card shows which CLI runs QA, with **Installed on PC** / **Not Detected** and **HEALTHY** /
**PAUSED until …**. AI QA needs the Local AI CLI engine to be on (**Run agents on this PC**). Click
**Save AI QA** to save.

```

- [ ] **Step 3: Guide 02.** In `docs/guide/02-projects-and-engines.md`, after the **Lint Command (Optional)** row of the form table, add:

```markdown
   | **High-risk paths (Optional)** | Paths or patterns, one per line (for example `app/Http/Middleware/` or `database/**`). When a change touches one, AI QA uses its strongest model. |
```

Then, in `### Fields the form does not show`, delete the line ``- `high_risk_paths`: a list of paths. It is stored, but nothing in the bridge acts on it yet.``: the form shows it now and AI QA uses it.

- [ ] **Step 4: Guide 10.** In `docs/guide/10-troubleshooting.md`, in `## Messages about AI QA`:
- Replace the row whose message is `` `<REQ-ID> is <status>; AI QA runs while a requirement is in QA` `` with:

```markdown
| `<REQ-ID> is <status>; AI QA runs while a requirement is in review or in QA` | **Run AI QA** outside In Review and QA. | Wait until the agents finish (In Review). |
```

- Replace the row whose message is `` `<REQ-ID> is no longer in QA; this finding was not saved` `` with:

```markdown
| `<REQ-ID> is no longer in review; this finding was not saved` (or `… in QA …`) | A finding arrived after the requirement left the stage its check was for. It is shown to the agent, or kept in `agent-outbox/<project>/failed/`. | Nothing to do; the next check covers it. |
```

- Add these rows at the end of the table:

```markdown
| `AI QA before merge failed: <project>: merging <branch> into <base> conflicts in …` | The task branches conflict with the target / base branch; the merge would conflict too. | Send the conflict back with **Request changes** (rebase and resolve), then let AI QA check again. |
| `A merge of <REQ-ID> is running; wait for it to finish` | **Run AI QA** during a merge. | Wait for the merge. |
| `Auto-merge paused: AI QA is still checking` | The auto-merge policy waits for AI QA. | Wait; it merges when AI QA finishes without open blockers. |
| `Auto-merge paused: N open AI QA blocker(s)` | AI QA found blockers. | Send them back with **Request changes**, or resolve them and merge by hand. |
```

- [ ] **Step 5: Full verification** (HEAD in an isolated worktree, so the other session's uncommitted work does not count)

Run: `(cd packages/shared && npx tsc -p .) && npm run typecheck && npx vitest run 2>&1 | tail -40 && (cd packages/web && npx vite build)`

Expected: the typechecks are clean and every test passes. The `aiDraft` "lists provider status" test calls real CLIs and can time out; record it if it does. The web build succeeds.

- [ ] **Step 6: Regenerate the desktop bundle** (Rule A)

Run it from HEAD in a clean worktree with the main `node_modules` linked: `node scripts/bundle-desktop-server.mjs`. Then:
- Normalize the linked paths: `sed -E 's#(\.\./)+Users/sopheak/Documents/Sopheak-dev/SP-Kickstack/node_modules/#node_modules/#g'`.
- Check the result: `node --check …/index.mjs`.
- Commit only `index.mjs`, keeping its file mode. `xticket.mjs` does not change in this plan; if it does, keep its mode `100755`.

Expected: the bundle diff is this plan's server code only.

- [ ] **Step 7: Rebuild shared for the running dev server and check it**

Run: `(cd packages/shared && npx tsc -p .) && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" localhost:4100/api/health && curl -s localhost:4100/api/settings/ai-qa`

Expected: `200`, then settings JSON that includes `"modelMode":"auto"` and `"lightMaxLines":150`.

- [ ] **Step 8: Commit**

```bash
git add docs/guide/06-review-qa-and-merge.md docs/guide/09-settings-and-environment.md docs/guide/02-projects-and-engines.md docs/guide/10-troubleshooting.md packages/desktop/src-tauri/resources/server/index.mjs
git commit -m "docs: AI QA in In Review and the model by size and risk; build(desktop): regenerate server bundle"
```
