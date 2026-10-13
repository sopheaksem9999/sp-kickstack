# Requirement Run Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A requirement can choose its CLI, model, effort, target branch and merge policy. One "Run settings" dialog edits them, from the requirement page, from **Start Fan-Out** and from a Kanban drag to In Progress. Task branches are named after the requirement (`REQ-008`) and pushed to `origin`.

**Architecture:**
- **Settings on the requirement.** `requirements.agent_cli` and `requirements.target_branch` (migration 9) are saved through a new `PUT /api/requirements/:id/run-settings`. Run settings stay editable after fan-out; the target branch locks once fan-out has happened.
- **One branch module.** `BranchService` becomes the single place that:
  - resolves a requirement's base branch (target branch, else the repository's base);
  - names task branches from the Settings pattern;
  - creates a missing target branch;
  - pushes new branches and commits to `origin`.
- **Callers.** Fan-out, tickets and the merge gate call `BranchService`. The Local AI CLI runner picks each run's CLI from its requirement.
- **Web.** One `RunSettingsDialog` serves the edit card, the Start Fan-Out buttons and the Kanban drop.

**Tech Stack:** TypeScript, Node 22.19.0, Express 4, better-sqlite3, zod 3, vitest; React 18, TanStack Query, Radix (dialog, popover), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-13-requirement-run-settings-design.md` (approved 2026-10-13).

## Global Constraints

- **Node:** v22.19.0 for every command. Prefix commands with `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null &&`.
- **Shared rebuild:** after any change in `packages/shared`, run `npm run --workspace=@sp-kickstack/shared build`.
- **Shared checkout:**
  - Work happens on `main`, and another session edits it too.
  - Commit only the paths a task names, through a temporary index (`GIT_INDEX_FILE=… git read-tree HEAD`, `update-index --cacheinfo`, `write-tree`, `commit-tree`, `update-ref`). Afterwards run `git reset -q HEAD -- <paths>`.
  - If a file you must change already shows uncommitted changes from the other session (`git status --short` before you touch it), commit HEAD + only your edit. Apply the same scripted edit to `git show HEAD:<file>` in a temp file and `git hash-object -w` that.
- **Typecheck in isolation:** the shared tree may contain the other session's unfinished code. Typecheck your change in a temporary `git worktree add --detach` of HEAD plus your files, with `node_modules` symlinked. List the files explicitly; zsh does not split a `$VAR` list. Remove the worktree afterwards.
- **Processes:** never stop processes by pattern. The user's dev server runs on port 4100 from this checkout and restarts on server edits.
- **Task branch names:**
  - The pattern comes from Settings, `task_branch_pattern`, default `{req}`.
  - Tokens: `{req}` (`REQ-008`), `{task}` (task number), `{project}` (folder-safe repository name).
  - A ticket's name is the pattern plus `-ticket-{task}`. A taken name gets `-2`, `-3`, ….
  - Existing branches are never renamed.
- **Branch name rule:**
  - Allowed: letters, digits and `. _ / -`; at most 100 characters.
  - Not allowed: starting with `-` or `/`; ending with `/`, `.` or `.lock`; containing `..` or `//`; any `/`-separated part starting with `.`.
  - A target branch must not be any `bridge_tasks.branch`.
- **Push:**
  - Setting `push_branches`, default `true`. The bridge pushes a new task branch, a new target branch, and a task branch after a Local AI CLI run that committed.
  - Never forced, never blocking, 2-minute timeout.
  - Log lines: `↑ Pushed <branch> to origin` / `Could not push <branch> to origin: <reason>`.
  - Agents never push.
- **Messages, verbatim:**
  - `<REQ> was already fanned out to <branch or "each repository's base branch">; the target branch cannot change (create a new requirement for another branch)` (409)
  - `<branch> is the branch of task #<id>; choose another target branch` (400)
  - `<REQ> is <done|cancelled>; its run settings can no longer change` (409)
  - `<CLI label> is chosen for <REQ> but is not installed on this PC` / `… but is turned off in Settings → AI & Local Engines`
- **Rule C:** Radix dialog and popover only; no new native `<select>`.
- **Rule A:** web calls go through `BASE`; no new server dependency.
- **Commit message trailer:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two requirements pick the same new target branch** (the second fans out after the first created it). Expected: the second reuses `release/1.3` and does not fail. Test: Task 4, "two requirements with the same new target branch share it".
2. **The target branch exists only on `origin`**, not locally. Expected: tasks start from `origin/<target>`, and the merge gate merges into it and leaves a local copy. Test: Task 4, "a target branch that only exists on origin".
3. **`origin` is unreachable or refuses the push** (no credentials, offline). Expected: fan-out completes, and the task log says `Could not push …`. Test: Task 5, "an unreachable origin does not hold up fan-out".
4. **A branch already lives under the name** (`REQ-001/old`), so git refuses `REQ-001`. Expected: the goal gets `REQ-001-2`. Test: Task 4, "a branch under the name counts as taken".
5. **The pattern changes after tasks exist.** Expected: Retry of an old task keeps its branch, and nothing is renamed. Test: Task 4, "changing the pattern renames nothing".

---

## File Structure

| File | Change |
|---|---|
| `packages/shared/src/branchNames.ts` (new) | branch name rule, pattern rendering and pattern check (pure; used by server and web) |
| `packages/shared/src/{schemas,types,index}.ts` | `TargetBranchSchema`, branch settings fields, `UpdateRunSettingsInputSchema`, `Requirement.agent_cli/target_branch`, the `target_branch_created` event |
| `packages/server/src/db/migrations.ts` | migration 9 |
| `packages/server/src/services/requirementService.ts` | new fields on read; `updateRunSettings` |
| `packages/server/src/services/branchService.ts` | base branch per requirement, `nameTaskBranch`, target creation, push queue, `listBranches` |
| `packages/server/src/lib/gitRepo.ts` | `hasBranchesUnder`, `listBranchNames` |
| `packages/server/src/services/{fanOutService,ticketService,mergeGate,agentProfile,settingsService}.ts` | use the above |
| `packages/server/src/adapters/{types,localCliAdapter}.ts`, `localEngine/{runStore,agentRunner}.ts` | CLI per requirement; report commits for push |
| `packages/server/src/api/app.ts`, `src/index.ts` | routes and wiring |
| `packages/web/src/lib/{runSettings,runSettingsApi}.ts` (new) | helpers and API calls |
| `packages/web/src/components/{BranchPicker,RunSettingsDialog,RunSettingsCard}.tsx` (new) | UI |
| `packages/web/src/components/AgentProfilePicker.tsx` | `suggestions` prop |
| `packages/web/src/pages/{RequirementDetailPage,RequirementsPage,SettingsPage}.tsx`, `components/RequirementDetailSheet.tsx` | wiring |
| `packages/web/src/components/RequirementAgentControl.tsx` | deleted (replaced by the card) |
| `docs/guide/{02,03,06,09,10}-*.md` | user guide |

**Plan decision against the spec text:** the spec puts the new fields on `UpdateRequirementInputSchema`. The existing `PUT /api/requirements/:id` refuses every requirement that is not Draft or Ready, but the spec keeps CLI, model, effort and merge policy editable after fan-out. So they get their own schema and route, `PUT /api/requirements/:id/run-settings`. The behaviour is the same as the spec; only the endpoint differs.

---

### Task 1: Shared branch rules and schemas

**Files:**
- Create: `packages/shared/src/branchNames.ts`, `packages/shared/src/branchNames.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/schemas.ts` (top; `BranchMergeSettingsSchema` ~line 75; end of file), `packages/shared/src/types.ts` (`EventType` ~line 36, `BranchMergeSettings` ~line 79, `Requirement` ~line 138)

**Interfaces:**
- Produces:
  - `DEFAULT_TASK_BRANCH_PATTERN = '{req}'`
  - `branchNameProblem(name: string): string | null`
  - `renderTaskBranchPattern(pattern, { req: string; task: number; project: string }): string`
  - `taskBranchPatternProblem(pattern): string | null`
  - `TargetBranchSchema`
  - `BranchMergeSettingsSchema` gains `task_branch_pattern`, default `'{req}'`, and `push_branches`, default `true`
  - `UpdateRunSettingsInputSchema` (strict), with optional and nullable `agent_cli`, `agent_model`, `agent_effort`, `target_branch` and `merge_policy`; `UpdateRunSettingsInput`
  - `Requirement.agent_cli?: AgentCliId | null`, `Requirement.target_branch?: string | null`
  - `BranchMergeSettings.task_branch_pattern: string`, `BranchMergeSettings.push_branches: boolean`
  - `EventType` gains `'target_branch_created'`

- [ ] **Step 1: Write the failing test.** Create `packages/shared/src/branchNames.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { branchNameProblem, renderTaskBranchPattern, taskBranchPatternProblem } from './branchNames.js';
import { BranchMergeSettingsSchema, UpdateRunSettingsInputSchema } from './schemas.js';

describe('branch names', () => {
  it('accepts ordinary branch names', () => {
    for (const name of ['REQ-008', 'release/1.3', 'feature/rides_v2', 'REQ-008-ticket-12']) expect(branchNameProblem(name)).toBeNull();
  });

  it('refuses names git or the bridge cannot use', () => {
    expect(branchNameProblem('  ')).toBe('Enter a branch name');
    expect(branchNameProblem('-x')).toBe('A branch name cannot start with - or /');
    expect(branchNameProblem('/x')).toBe('A branch name cannot start with - or /');
    expect(branchNameProblem('a/')).toBe('A branch name cannot end with /, . or .lock');
    expect(branchNameProblem('a.lock')).toBe('A branch name cannot end with /, . or .lock');
    expect(branchNameProblem('../x')).toBe('A branch name cannot contain .. or //');
    expect(branchNameProblem('a//b')).toBe('A branch name cannot contain .. or //');
    expect(branchNameProblem('a/.b')).toBe('No part of a branch name can start with .');
    expect(branchNameProblem('feat ure')).toBe('Branch names use letters, digits and . _ / - only');
    expect(branchNameProblem('a@{1}')).toBe('Branch names use letters, digits and . _ / - only');
    expect(branchNameProblem('x'.repeat(101))).toBe('Branch names are at most 100 characters');
  });

  it('fills in a task branch pattern', () => {
    const tokens = { req: 'REQ-008', task: 12, project: 'backend' };
    expect(renderTaskBranchPattern('{req}', tokens)).toBe('REQ-008');
    expect(renderTaskBranchPattern(' {project}/{req}-{task} ', tokens)).toBe('backend/REQ-008-12');
  });

  it('checks a pattern', () => {
    expect(taskBranchPatternProblem('{req}')).toBeNull();
    expect(taskBranchPatternProblem('feature/{task}')).toBe('The pattern must contain {req}');
    expect(taskBranchPatternProblem('{req} x')).toBe('Branch names use letters, digits and . _ / - only (it gives "REQ-001 x")');
  });
});

describe('run settings schemas', () => {
  it('adds the branch name pattern and push switch to the branch settings', () => {
    expect(BranchMergeSettingsSchema.parse({})).toMatchObject({ task_branch_pattern: '{req}', push_branches: true });
    expect(() => BranchMergeSettingsSchema.parse({ task_branch_pattern: 'feature' })).toThrow(/must contain \{req\}/);
  });

  it('validates the run settings of a requirement', () => {
    expect(UpdateRunSettingsInputSchema.parse({ agent_cli: 'agy-cli', target_branch: ' release/1.3 ', merge_policy: null })).toEqual({
      agent_cli: 'agy-cli', target_branch: 'release/1.3', merge_policy: null,
    });
    expect(UpdateRunSettingsInputSchema.parse({ target_branch: null })).toEqual({ target_branch: null });
    expect(() => UpdateRunSettingsInputSchema.parse({ target_branch: '../x' })).toThrow(/cannot contain/);
    expect(() => UpdateRunSettingsInputSchema.parse({ agent_cli: 'ollama' })).toThrow();
    expect(() => UpdateRunSettingsInputSchema.parse({ title: 'x' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/shared/src/branchNames.test.ts`
Expected: FAIL (`Failed to load url ./branchNames.js`).

- [ ] **Step 3: The rules.** Create `packages/shared/src/branchNames.ts`:

```ts
/** Default pattern for task branch names: the requirement ID, e.g. REQ-008. */
export const DEFAULT_TASK_BRANCH_PATTERN = '{req}';

/**
 * Why `name` cannot be a branch the bridge creates or merges into, or null when it can. Stricter than
 * git: letters, digits and . _ / - only.
 */
export function branchNameProblem(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Enter a branch name';
  if (value.length > 100) return 'Branch names are at most 100 characters';
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return 'Branch names use letters, digits and . _ / - only';
  if (value.startsWith('-') || value.startsWith('/')) return 'A branch name cannot start with - or /';
  if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) return 'A branch name cannot end with /, . or .lock';
  if (value.includes('..') || value.includes('//')) return 'A branch name cannot contain .. or //';
  if (value.split('/').some((part) => part.startsWith('.'))) return 'No part of a branch name can start with .';
  return null;
}

export interface TaskBranchTokens {
  req: string;
  task: number;
  project: string;
}

/** The pattern with {req}, {task} and {project} filled in. */
export function renderTaskBranchPattern(pattern: string, tokens: TaskBranchTokens): string {
  return pattern.trim().split('{req}').join(tokens.req).split('{task}').join(String(tokens.task)).split('{project}').join(tokens.project);
}

/** Why a task branch name pattern cannot be used, or null. */
export function taskBranchPatternProblem(pattern: string): string | null {
  if (!pattern.includes('{req}')) return 'The pattern must contain {req}';
  const example = renderTaskBranchPattern(pattern, { req: 'REQ-001', task: 1, project: 'backend' });
  const problem = branchNameProblem(example);
  return problem ? `${problem} (it gives "${example}")` : null;
}
```

Add to `packages/shared/src/index.ts`: `export * from './branchNames.js';`

- [ ] **Step 4: Schemas.** In `packages/shared/src/schemas.ts`, add after the `import { z } from 'zod';` line:

```ts
import { DEFAULT_TASK_BRANCH_PATTERN, branchNameProblem, taskBranchPatternProblem } from './branchNames.js';

/** A zod refinement from a "why not" check. */
const refineWith = (check: (value: string) => string | null) => (value: string, ctx: z.RefinementCtx) => {
  const problem = check(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
};

/** A requirement's target branch (letters, digits and . _ / -). */
export const TargetBranchSchema = z.string().trim().superRefine(refineWith(branchNameProblem));
```

Replace `BranchMergeSettingsSchema` with:

```ts
export const BranchMergeSettingsSchema = z.object({
  default_base_branch: z.string().default('develop'),
  merge_policy: BranchMergePolicySchema.default('manual_review_merge'),
  auto_delete_branch: z.boolean().default(false),
  /** Task branch names: {req}, {task}, {project}; tickets add -ticket-{task}. */
  task_branch_pattern: z.string().trim().superRefine(refineWith(taskBranchPatternProblem)).default(DEFAULT_TASK_BRANCH_PATTERN),
  /** The bridge pushes new task/target branches and agents' new commits to origin. */
  push_branches: z.boolean().default(true),
});
```

Append at the end of the file (after `AGENT_CLI_IDS`, which it uses):

```ts
/** A requirement's run settings: undefined keeps a value, null clears it (null target = each repository's base branch). */
export const UpdateRunSettingsInputSchema = z
  .object({
    agent_cli: z.enum(AGENT_CLI_IDS).nullable().optional(),
    agent_model: AgentModelSchema.nullable().optional(),
    agent_effort: ReasoningEffortSchema.nullable().optional(),
    target_branch: TargetBranchSchema.nullable().optional(),
    merge_policy: BranchMergePolicySchema.nullable().optional(),
  })
  .strict();

export type UpdateRunSettingsInput = z.input<typeof UpdateRunSettingsInputSchema>;
```

- [ ] **Step 5: Types.** In `packages/shared/src/types.ts`:
  - Add `| 'target_branch_created'` to the `EventType` union.
  - Add to `BranchMergeSettings`:

```ts
  /** Task branch names: {req}, {task}, {project}; tickets add -ticket-{task}. */
  task_branch_pattern: string;
  /** The bridge pushes new task/target branches and agents' new commits to origin. */
  push_branches: boolean;
```

  - Add to `Requirement`, after `agent_effort`:

```ts
  /** CLI for this requirement's Local AI CLI runs (null = Settings default). */
  agent_cli?: AgentCliId | null;
  /** Branch its tasks start from and merge into (null = each repository's base branch). */
  target_branch?: string | null;
```

- [ ] **Step 6: Build shared and run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npm run --workspace=@sp-kickstack/shared build && npx vitest run packages/shared`
Expected: PASS (the 6 new tests and the existing shared tests). If the build fails because something builds a full `BranchMergeSettings` literal, add the two fields there.

- [ ] **Step 7: Commit** `packages/shared/src/branchNames.ts packages/shared/src/branchNames.test.ts packages/shared/src/index.ts packages/shared/src/schemas.ts packages/shared/src/types.ts` with the message `feat(shared): branch name rules, run settings schema, branch pattern and push settings`.

---

### Task 2: Migration 9, requirement fields, settings defaults, preferred CLI per run

**Files:**
- Modify: `packages/server/src/db/migrations.ts`, `packages/server/src/db/migrations.test.ts:52`, `packages/server/src/services/requirementService.ts` (`getRequirement` ~line 146), `packages/server/src/services/settingsService.ts` (`getBranchMergeSettings` fallback), `packages/server/src/localEngine/runStore.ts`, `packages/server/src/localEngine/runStore.test.ts`
- Test: `packages/server/src/services/runSettings.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - columns `requirements.agent_cli`, `requirements.target_branch`, `local_runs.preferred_cli`
  - `getRequirement()` returns `agent_cli` and `target_branch` (null when unset)
  - `getBranchMergeSettings()` always has `task_branch_pattern` and `push_branches`
  - `LocalRun.preferred_cli: AgentCliId | null`; `CreateRunInput.preferredCli?: AgentCliId | null`

- [ ] **Step 1: Write the failing test.** Create `packages/server/src/services/runSettings.test.ts`:

```ts
// Requirement run settings: CLI, model, effort, target branch, merge policy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, type AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { RunStore } from '../localEngine/runStore.js';

let db: AppDatabase;
let requirements: RequirementService;
let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-run-settings-'));
  db = initDatabase(':memory:');
  requirements = new RequirementService(db, ws);
  new ProjectService(db).registerProject({ name: 'backend', repo_path: '/r/b', engine_type: 'manual' });
});
afterEach(() => {
  db.close();
  fs.rmSync(ws, { recursive: true, force: true });
});

const create = () =>
  requirements.createRequirement({ title: 'Rides', goal: 'Track rides', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal' });

describe('requirement run settings: storage', () => {
  it('starts with no CLI and no target branch', () => {
    expect(create()).toMatchObject({ agent_cli: null, target_branch: null });
  });

  it('defaults the task branch pattern to the requirement ID and pushing to on', () => {
    expect(new SettingsService(db).getBranchMergeSettings()).toMatchObject({ task_branch_pattern: '{req}', push_branches: true });
  });

  it('remembers the preferred CLI of a local run', () => {
    const run = new RunStore(db).create({ bridgeTaskId: 1, project: 'backend', title: 'T', bodyMd: 'B', preferredCli: 'agy-cli' });
    expect(run.preferred_cli).toBe('agy-cli');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/runSettings.test.ts`
Expected: FAIL (`agent_cli` undefined; `preferred_cli` undefined).

- [ ] **Step 3: Migration 9.** Append to `MIGRATIONS` in `packages/server/src/db/migrations.ts`:

```ts
  {
    version: 9,
    name: 'requirement run settings: CLI and target branch; preferred CLI of a local run',
    up: (db) => {
      addColumn(db, 'requirements', 'agent_cli', 'TEXT');
      addColumn(db, 'requirements', 'target_branch', 'TEXT');
      addColumn(db, 'local_runs', 'preferred_cli', 'TEXT');
    },
  },
```

In `migrations.test.ts:52`, change `expect(LATEST_VERSION).toBe(8);` to `expect(LATEST_VERSION).toBe(9);`. In `localEngine/runStore.test.ts`, change the test `is created by migration 8` to:

```ts
  it('is created by migration 8 and kept by later ones', () => {
    const db = initDatabase(':memory:');
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'local_runs'").get()).toBeTruthy();
  });
```

- [ ] **Step 4: Read the new fields.** In `RequirementService.getRequirement`, add to the returned object after `agent_effort`:

```ts
      agent_cli: row.agent_cli ?? null,
      target_branch: row.target_branch ?? null,
```

In `SettingsService.getBranchMergeSettings`, replace the literal fallback object with `return BranchMergeSettingsSchema.parse({});`.

- [ ] **Step 5: Preferred CLI on runs.** In `packages/server/src/localEngine/runStore.ts`:
  - Add `preferred_cli: AgentCliId | null;` to `LocalRun`, after `cli`, with the doc comment `/** The requirement's CLI, when it chose one. */`.
  - Add `preferredCli?: AgentCliId | null;` to `CreateRunInput`.
  - Replace the INSERT in `create()` with:

```ts
      this.db
        .prepare(`
          INSERT INTO local_runs (id, bridge_task_id, project, title, body_md, model, effort, preferred_cli, status, notes_md, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        `)
        .run(
          id, input.bridgeTaskId, input.project, input.title, input.bodyMd, input.model ?? null, input.effort ?? null,
          input.preferredCli ?? null, pending.map((r) => r.notes_md).join('\n\n'), now, now
        );
```

- [ ] **Step 6: Run the tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/runSettings.test.ts packages/server/src/db packages/server/src/localEngine/runStore.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit** the six files with the message `feat(server): migration 9 for requirement CLI and target branch; branch settings defaults`.

---

### Task 3: Saving run settings (service and route)

**Files:**
- Modify: `packages/server/src/services/requirementService.ts` (new method after `updateAgentProfile` ~line 326; import `UpdateRunSettingsInputSchema`, `UpdateRunSettingsInput`), `packages/server/src/api/app.ts` (route after `PUT /api/requirements/:id` ~line 369)
- Test: `packages/server/src/services/runSettings.test.ts`

**Interfaces:**
- Consumes: Task 1 `UpdateRunSettingsInputSchema`; Task 2 columns.
- Produces: `RequirementService.updateRunSettings(id: string, input: UpdateRunSettingsInput): Requirement`; route `PUT /api/requirements/:id/run-settings`.

- [ ] **Step 1: Write the failing test.** Append to `runSettings.test.ts`:

```ts
describe('requirement run settings: saving', () => {
  const addTask = (reqId: string, branch: string) =>
    db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, branch, created_at, updated_at) VALUES (?, 'backend', 'goal', 'T', 'queued', ?, 'x', 'x')")
      .run(reqId, branch).lastInsertRowid;

  it('saves, keeps what is not sent and clears what is null', () => {
    const req = create();
    requirements.updateRunSettings(req.id, { agent_cli: 'agy-cli', agent_model: 'gemini-3.8-flash', agent_effort: 'high', target_branch: 'release/1.3', merge_policy: 'auto_merge' });
    expect(requirements.updateRunSettings(req.id, { agent_effort: null })).toMatchObject({
      agent_cli: 'agy-cli', agent_model: 'gemini-3.8-flash', agent_effort: null, target_branch: 'release/1.3', merge_policy: 'auto_merge',
    });
    expect(requirements.updateRunSettings(req.id, { target_branch: null }).target_branch).toBeNull();
  });

  it('refuses a bad branch name and a task branch as the target', () => {
    const req = create();
    expect(() => requirements.updateRunSettings(req.id, { target_branch: '../x' })).toThrow(/cannot contain/);
    const other = create();
    const taskId = addTask(other.id, 'REQ-OTHER');
    expect(() => requirements.updateRunSettings(req.id, { target_branch: 'REQ-OTHER' })).toThrow(`REQ-OTHER is the branch of task #${taskId}; choose another target branch`);
  });

  it('locks the target branch after fan-out but keeps the rest editable', () => {
    const req = create();
    requirements.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    addTask(req.id, req.id);
    expect(() => requirements.updateRunSettings(req.id, { target_branch: 'release/2.0' })).toThrow(
      `${req.id} was already fanned out to release/1.3; the target branch cannot change (create a new requirement for another branch)`
    );
    expect(requirements.updateRunSettings(req.id, { target_branch: 'release/1.3', agent_cli: 'claude-cli' })).toMatchObject({ target_branch: 'release/1.3', agent_cli: 'claude-cli' });
  });

  it('refuses changes once the requirement is done or cancelled', () => {
    const req = create();
    requirements.updateStatus(req.id, 'cancelled');
    expect(() => requirements.updateRunSettings(req.id, { agent_cli: 'agy-cli' })).toThrow(`${req.id} is cancelled; its run settings can no longer change`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/runSettings.test.ts`
Expected: FAIL (`requirements.updateRunSettings is not a function`).

- [ ] **Step 3: The service method.** Add to `RequirementService` after `updateAgentProfile`, and add `UpdateRunSettingsInput, UpdateRunSettingsInputSchema` to its `@sp-kickstack/shared` import:

```ts
  /**
   * CLI, model, effort, target branch and merge policy for this requirement's runs: undefined keeps a
   * value, null clears it. Editable until the requirement is done or cancelled; the target branch only
   * until fan-out, because tasks were branched from it.
   */
  public updateRunSettings(id: string, input: UpdateRunSettingsInput): Requirement {
    const parsed = UpdateRunSettingsInputSchema.parse(input ?? {});
    const req = this.getRequirement(id);
    if (!req) throw new HttpError(404, `Requirement ${id} not found`);
    if (req.status === 'done' || req.status === 'cancelled') {
      throw conflict(`${id} is ${req.status}; its run settings can no longer change`);
    }

    const current = req.target_branch ?? null;
    const target = parsed.target_branch === undefined ? current : parsed.target_branch || null;
    if (target !== current) {
      const fannedOut = this.db.prepare("SELECT 1 FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket') LIMIT 1").get(id);
      if (fannedOut) {
        throw conflict(
          `${id} was already fanned out to ${current ?? "each repository's base branch"}; the target branch cannot change (create a new requirement for another branch)`
        );
      }
      if (target) {
        const owner = this.db.prepare('SELECT id FROM bridge_tasks WHERE branch = ? LIMIT 1').get(target) as { id: number } | undefined;
        if (owner) throw badRequest(`${target} is the branch of task #${owner.id}; choose another target branch`);
      }
    }

    const keep = <T>(next: T | null | undefined, value: T | null | undefined) => (next === undefined ? value ?? null : next);
    this.db
      .prepare(`
        UPDATE requirements
        SET agent_cli = ?, agent_model = ?, agent_effort = ?, target_branch = ?, merge_policy = ?, updated_at = datetime('now')
        WHERE id = ?
      `)
      .run(
        keep(parsed.agent_cli, req.agent_cli), keep(parsed.agent_model, req.agent_model), keep(parsed.agent_effort, req.agent_effort),
        target, keep(parsed.merge_policy, req.merge_policy), id
      );
    return this.getRequirement(id)!;
  }
```

- [ ] **Step 4: The route.** In `packages/server/src/api/app.ts`, after the `app.put('/api/requirements/:id', …)` handler:

```ts
  // CLI, model, effort, target branch and merge policy; editable after fan-out (the target branch excepted).
  app.put('/api/requirements/:id/run-settings', (req, res, next) => {
    try {
      const updated = deps.requirementService.updateRunSettings(req.params.id, req.body ?? {});
      deps.broadcaster.broadcast({ type: 'requirement_updated', payload: updated });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **Step 5: Run the tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/runSettings.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit** `requirementService.ts`, `app.ts` and `runSettings.test.ts` with the message `feat(server): save a requirement's run settings; the target branch locks at fan-out`.

---

### Task 4: Task branch names and the target branch

**Files:**
- Modify: `packages/server/src/lib/gitRepo.ts` (add `hasBranchesUnder`), `packages/server/src/services/branchService.ts`, `packages/server/src/services/fanOutService.ts` (import line 11; settings block ~lines 107-119; `formatGoalBody` merge text ~line 45; the loop ~lines 157-170), `packages/server/src/services/ticketService.ts` (~line 147), `packages/server/src/services/mergeGate.ts:228`
- Test: `packages/server/src/services/branchMerge.test.ts` (update lines 93 and 114; new describes)

**Interfaces:**
- Consumes: Task 1 `renderTaskBranchPattern`, `DEFAULT_TASK_BRANCH_PATTERN`; Task 3 `updateRunSettings`; `folderName` from `localEngine/worktrees.ts`.
- Produces:
  - `BranchService.projectBaseBranch(project): string`
  - `BranchService.baseBranchFor(project, reqId?: string): string`
  - `BranchService.nameTaskBranch(project, reqId, taskId, role: 'goal' | 'ticket'): string`
  - `ensureTaskBranch` now creates a missing target branch and records `target_branch_created`
  - `hasBranchesUnder(repo, name): boolean`
  - `taskBranchName` is removed

- [ ] **Step 1: Write the failing tests.** In `branchMerge.test.ts`:
  - Line 93 becomes `expect(row.branch).toBe(req.id);`
  - Line 114 becomes `expect(ticket.branch).toBe(`${req.id}-ticket-${t.ticketId}`);`
  - Add these imports at the top if missing: `import { SettingsService } from './settingsService.js';` (already imported) and `import { prepareRetry } from './taskRetry.js';`
  - Append:

```ts
describe('Task branch names', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());

  it('adds -2 when the name is already taken in the repository', async () => {
    const req = h.createRequirement(['backend']);
    sh(h.backendRepo.repo, ['branch', req.id]);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).branch).toBe(`${req.id}-2`);
  });

  it('a branch under the name counts as taken', async () => {
    const req = h.createRequirement(['backend']);
    sh(h.backendRepo.repo, ['branch', `${req.id}/old`]);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).branch).toBe(`${req.id}-2`);
  });

  it('follows the Settings pattern', async () => {
    new SettingsService(h.db).updateBranchMergeSettings({ task_branch_pattern: '{project}/{req}' });
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).branch).toBe(`backend/${req.id}`);
  });

  it('changing the pattern renames nothing', async () => {
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    new SettingsService(h.db).updateBranchMergeSettings({ task_branch_pattern: 'feature/{req}' });
    h.db.prepare("UPDATE bridge_tasks SET status = 'failed' WHERE id = ?").run(goal.id);
    await prepareRetry(h.db, goal.id, 'goal', (name) => h.adapters[name]);
    await h.fanOutService.dispatchGoal(goal.id);
    expect(h.task(goal.id).branch).toBe(req.id);
  });
});

describe('Requirement target branch', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());
  const targetEvents = () =>
    (h.db.prepare("SELECT payload FROM events WHERE type = 'target_branch_created'").all() as Array<{ payload: string }>).map((r) => JSON.parse(r.payload));

  it('creates a missing target branch from the base and starts the task branch from it', async () => {
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    const repo = h.backendRepo.repo;
    expect(headOf(repo, 'release/1.3')).toBe(headOf(repo, 'develop'));
    expect(h.task(goal.id).base_sha).toBe(headOf(repo, 'release/1.3'));
    expect(h.engineBody('backend', goal.engine_task_id!)).toContain('release/1.3');
    expect(targetEvents()).toEqual([{ reqId: req.id, project: 'backend', branch: 'release/1.3', from: 'develop' }]);
  });

  it('uses an existing target branch as it is', async () => {
    const repo = h.backendRepo.repo;
    sh(repo, ['branch', 'release/1.3']);
    const tip = commitOnBranch(repo, 'release/1.3', 'release.txt', 'r\n');
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).base_sha).toBe(tip);
    expect(targetEvents()).toEqual([]);
  });

  it('two requirements with the same new target branch share it', async () => {
    const first = h.createRequirement(['backend']);
    const second = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(first.id, { target_branch: 'release/1.3' });
    h.requirementService.updateRunSettings(second.id, { target_branch: 'release/1.3' });
    await h.fanOutService.execute(first.id);
    const [goal] = await h.fanOutService.execute(second.id);
    expect(h.task(goal.id).base_sha).toBe(headOf(h.backendRepo.repo, 'release/1.3'));
    expect(targetEvents()).toHaveLength(1);
  });

  it('a target branch that only exists on origin', async () => {
    const { repo, origin } = h.backendRepo;
    const tip = commitOnBranch(repo, 'develop', 'next.txt', 'n\n');
    sh(repo, ['push', '-q', 'origin', `${tip}:refs/heads/release/1.3`]);
    sh(repo, ['reset', '-q', '--hard', 'HEAD~1']);
    sh(repo, ['fetch', '-q', 'origin']);
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).base_sha).toBe(tip);
    commitOnBranch(repo, h.task(goal.id).branch, 'feature.txt', 'f\n');
    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goal.id);
    h.requirementService.updateStatus(req.id, 'in_review');
    expect((await h.gate.start(req.id, 'manual').done).ok).toBe(true);
    expect(sh(origin!, ['show', 'release/1.3:feature.txt'])).toBe('f');
    expect(headOf(repo, 'release/1.3')).toBe(headOf(origin!, 'release/1.3'));
  });

  it('a ticket of the requirement branches from the target in its own repository', async () => {
    const req = h.createRequirement(['mobile']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [mobileGoal] = await h.fanOutService.execute(req.id);
    const t = await h.ticketService.createTicket(
      { to: 'backend', type: 'api_request', title: 'GET /loc', body: 'Provide location endpoint', blocking: false },
      'mobile',
      mobileGoal.engine_task_id!
    );
    const ticket = h.task(t.ticketId);
    expect(ticket.branch).toBe(`${req.id}-ticket-${t.ticketId}`);
    expect(ticket.base_sha).toBe(headOf(h.backendRepo.repo, 'release/1.3'));
  });

  it('merges into the target branch and leaves develop alone', async () => {
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    const { repo, origin } = h.backendRepo;
    const developBefore = headOf(origin!, 'develop');
    commitOnBranch(repo, h.task(goal.id).branch, 'feature.txt', 'f\n');
    h.db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = ?").run(goal.id);
    h.requirementService.updateStatus(req.id, 'in_review');
    expect((await h.gate.start(req.id, 'manual').done).ok).toBe(true);
    expect(sh(origin!, ['show', 'release/1.3:feature.txt'])).toBe('f');
    expect(headOf(origin!, 'develop')).toBe(developBefore);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/branchMerge.test.ts`
Expected: FAIL. The names are still `req/…/task-N`, no target branch is created, and the merge goes into develop.

- [ ] **Step 3: Git helper.** Add to `packages/server/src/lib/gitRepo.ts`, after `createBranch`:

```ts
/** True when a branch lives under `<name>/` locally or on origin (git then refuses a branch named `name`). */
export function hasBranchesUnder(repo: string, name: string): boolean {
  const refs = tryGit(repo, ['for-each-ref', '--count=1', '--format=%(refname)', `refs/heads/${name}/`, `refs/remotes/origin/${name}/`]);
  return (refs ?? '').trim() !== '';
}
```

- [ ] **Step 4: BranchService.** In `packages/server/src/services/branchService.ts`:
  - Delete `taskBranchName`.
  - Change the imports to:

```ts
import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { SettingsService } from './settingsService.js';
import { BridgeTask, DEFAULT_TASK_BRANCH_PATTERN, Project, normalizeMergePolicy, renderTaskBranchPattern } from '@sp-kickstack/shared';
import { createBranch, hasBranchesUnder, isGitWorkTree, resolveCommit } from '../lib/gitRepo.js';
import { folderName } from '../localEngine/worktrees.js';

export type TaskBranchRole = 'goal' | 'ticket';
```

  - Replace `baseBranchFor` with:

```ts
  /** The repository's own base branch: its setting, else Settings → default base branch. */
  public projectBaseBranch(project: Project): string {
    return project.base_branch || this.settings.getBranchMergeSettings().default_base_branch || 'develop';
  }

  /** Where a requirement's tasks start and merge: its target branch, else the repository's base branch. */
  public baseBranchFor(project: Project, reqId?: string): string {
    const row = reqId
      ? (this.db.prepare('SELECT target_branch FROM requirements WHERE id = ?').get(reqId) as { target_branch: string | null } | undefined)
      : undefined;
    return row?.target_branch || this.projectBaseBranch(project);
  }

  /**
   * A free branch name for a task: the Settings pattern (default {req}), plus -ticket-{task} for
   * tickets, plus -2, -3… when the name is taken locally, on origin, by another task or by a branch under it.
   */
  public nameTaskBranch(project: Project, reqId: string, taskId: number, role: TaskBranchRole): string {
    const pattern = this.settings.getBranchMergeSettings().task_branch_pattern || DEFAULT_TASK_BRANCH_PATTERN;
    const stem =
      renderTaskBranchPattern(pattern, { req: reqId, task: taskId, project: folderName(project.name) }) +
      (role === 'ticket' ? `-ticket-${taskId}` : '');
    for (let n = 1; ; n++) {
      const name = n === 1 ? stem : `${stem}-${n}`;
      if (!this.branchTaken(project, name, taskId)) return name;
    }
  }

  private branchTaken(project: Project, name: string, taskId: number): boolean {
    const recorded = this.db.prepare('SELECT 1 FROM bridge_tasks WHERE project = ? AND branch = ? AND id <> ? LIMIT 1').get(project.name, name, taskId);
    if (recorded) return true;
    const repo = project.repo_path;
    if (!isGitWorkTree(repo)) return false;
    return Boolean(resolveCommit(repo, `refs/heads/${name}`) || resolveCommit(repo, `refs/remotes/origin/${name}`) || hasBranchesUnder(repo, name));
  }
```

  - Replace `ensureTaskBranch` with:

```ts
  /**
   * Make sure the task's branch exists: created from the requirement's target branch (created first,
   * from the repository's base, when this repository lacks it) or from the base branch. Idempotent.
   * Returns null for tasks without a branch (non-git).
   */
  public ensureTaskBranch(taskId: number): { branch: string; baseSha: string } | null {
    const task = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as BridgeTask | undefined;
    if (!task?.branch) return null;
    const project = this.projectService.getProject(task.project);
    if (!project) throw new Error(`Project ${task.project} not found`);
    const repo = project.repo_path;

    const existing = resolveCommit(repo, `refs/heads/${task.branch}`);
    if (existing) {
      const baseSha = task.base_sha || existing;
      if (!task.base_sha) this.recordBase(taskId, baseSha);
      return { branch: task.branch, baseSha };
    }

    const created: string[] = [];
    const base = this.baseBranchFor(project, task.req_id);
    let start = resolveCommit(repo, `refs/heads/${base}`) ?? resolveCommit(repo, `refs/remotes/origin/${base}`);
    const projectBase = this.projectBaseBranch(project);
    if (!start && base !== projectBase) {
      // The requirement's target branch is new to this repository: create it from the repository's base.
      const from = resolveCommit(repo, `refs/heads/${projectBase}`) ?? resolveCommit(repo, `refs/remotes/origin/${projectBase}`);
      if (!from) throw new Error(`Base branch "${projectBase}" was not found in ${repo}`);
      createBranch(repo, base, from);
      created.push(base);
      this.recordEvent('target_branch_created', task.req_id, task.id, { reqId: task.req_id, project: project.name, branch: base, from: projectBase });
      start = from;
    }
    if (!start) {
      throw new Error(`Base branch "${base}" was not found in ${repo}`);
    }
    createBranch(repo, task.branch, start);
    created.push(task.branch);
    this.recordBase(taskId, start);
    this.afterCreate(repo, created, taskId);
    return { branch: task.branch, baseSha: start };
  }

  /** Hook for newly created branches (Task 5 pushes them). */
  private afterCreate(_repo: string, _branches: string[], _taskId: number): void {}

  private recordEvent(type: string, reqId: string, taskId: number, payload: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(reqId, taskId, type, JSON.stringify(payload), new Date().toISOString());
  }
```

- [ ] **Step 5: Fan-out.** In `packages/server/src/services/fanOutService.ts`:
  - **Import:** change it to `import { BranchService, branchInstructions } from './branchService.js';`.
  - **Settings block:** remove the `defaultBaseBranch` variable and its assignment. Keep `mergePolicy`.
  - **Base branch:** in the reserve loop, replace `const baseBranch = project.base_branch || defaultBaseBranch;` with `const baseBranch = this.branches.baseBranchFor(project, req.id);`.
  - **Branch name:** replace `const branch = taskBranchName(req.id, id);` with `const branch = this.branches.nameTaskBranch(project, req.id, id, 'goal');`.
  - **Prompt wording:** in `formatGoalBody`, replace the `mergePolicyDesc` expression so it names the real base:

```ts
    const mergePolicyDesc =
      normalizeMergePolicy(mergePolicy) === 'auto_merge'
        ? `Your work is merged into \`${baseBranch}\` automatically once all work for the requirement is in review and the tests pass.`
        : `Your work stays on its branch until a person reviews it; it is then merged into \`${baseBranch}\`.`;
```

- [ ] **Step 6: Tickets and merge gate.**
  - **Tickets:** in `ticketService.ts`, replace `const name = taskBranchName(reqId, id);` with `const name = this.branches.nameTaskBranch(targetProject, reqId, id, 'ticket');`, and `base: this.branches.baseBranchFor(targetProject),` with `base: this.branches.baseBranchFor(targetProject, reqId),`. Remove `taskBranchName` from its import.
  - **Merge gate:** in `mergeGate.ts:228`, replace `const base = this.branches.baseBranchFor(project);` with `const base = this.branches.baseBranchFor(project, reqId);`.

- [ ] **Step 7: Run the tests and the server suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/branchMerge.test.ts && npx vitest run packages/server`
Expected: PASS. If another test asserts the old prompt sentence ("merged to main", "remain on develop"), update it to the new wording. Afterwards run `git checkout -- workspace/requirements/REQ-001.md`, because the suite rewrites that file.

- [ ] **Step 8: Commit** `gitRepo.ts`, `branchService.ts`, `fanOutService.ts`, `ticketService.ts`, `mergeGate.ts` and `branchMerge.test.ts` with the message `feat(server): REQ-ID task branch names and a requirement target branch`.

---

### Task 5: Pushing branches to origin

**Files:**
- Modify: `packages/server/src/services/branchService.ts`, `packages/server/src/localEngine/agentRunner.ts` (`AgentRunnerOptions`, `finish()`), `packages/server/src/index.ts`
- Test: `packages/server/src/services/branchMerge.test.ts` (harness option and new describe), `packages/server/src/localEngine/agentRunner.test.ts`

**Interfaces:**
- Consumes: Task 4 `afterCreate` hook; `pushCommit`, `hasRemote` (`lib/gitRepo.ts`).
- Produces:
  - `BranchService.pushTaskBranch(taskId): void`
  - `pushesSettled(): Promise<void>` (exported from `branchService.ts`)
  - `AgentRunnerOptions.onCommits?: (taskId: number) => void`

- [ ] **Step 1: Harness option.** In `branchMerge.test.ts`, change `makeGitHarness` so:
  - it takes `opts: { withOrigin?: boolean; push?: boolean } = {}` and uses `withOrigin = opts.withOrigin ?? true` for both repos;
  - it creates one shared `branches = new BranchService(db, projectService)` and passes it to `TicketService` (5th arg) and `FanOutService` (5th arg);
  - it turns pushing off unless asked: after creating `db`, add `if (!opts.push) new SettingsService(db).updateBranchMergeSettings({ push_branches: false });`;
  - it returns `branches` and `logText: (taskId: number) => (db.prepare('SELECT message FROM task_logs WHERE task_id = ?').all(taskId) as Array<{ message: string }>).map((r) => r.message).join('\n')`.

Import `BranchService` and `pushesSettled` from `./branchService.js`. Existing callers `makeGitHarness({ withOrigin: false })` keep working.

- [ ] **Step 2: Write the failing tests.** Append to `branchMerge.test.ts`:

```ts
describe('Pushing branches to origin', () => {
  let h: GitHarness;
  afterEach(async () => {
    await pushesSettled();
    h.db.close();
  });
  const remoteHead = (origin: string, branch: string) => {
    try {
      return sh(origin, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    } catch {
      return null;
    }
  };

  it('pushes a new task branch and a new target branch at fan-out', async () => {
    h = makeGitHarness({ push: true });
    const req = h.createRequirement(['backend']);
    h.requirementService.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    const [goal] = await h.fanOutService.execute(req.id);
    await pushesSettled();
    const { repo, origin } = h.backendRepo;
    expect(remoteHead(origin!, req.id)).toBe(headOf(repo, req.id));
    expect(remoteHead(origin!, 'release/1.3')).toBe(headOf(repo, 'release/1.3'));
    expect(h.logText(goal.id)).toContain(`↑ Pushed ${req.id} to origin`);
  });

  it('pushes new commits of a task branch when asked (after an agent run)', async () => {
    h = makeGitHarness({ push: true });
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    await pushesSettled();
    const { repo, origin } = h.backendRepo;
    commitOnBranch(repo, req.id, 'a.txt', 'a\n');
    h.branches.pushTaskBranch(goal.id);
    await pushesSettled();
    expect(remoteHead(origin!, req.id)).toBe(headOf(repo, req.id));
  });

  it('never forces: a branch that moved on origin stays, and the task log says why', async () => {
    h = makeGitHarness({ push: true });
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    await pushesSettled();
    const { repo, origin } = h.backendRepo;
    const other = commitOnBranch(repo, 'develop', 'other.txt', 'o\n');
    sh(repo, ['push', '-q', '--force', 'origin', `${other}:refs/heads/${req.id}`]); // someone else moved it
    commitOnBranch(repo, req.id, 'mine.txt', 'm\n');
    h.branches.pushTaskBranch(goal.id);
    await pushesSettled();
    expect(remoteHead(origin!, req.id)).toBe(other);
    expect(h.logText(goal.id)).toContain(`Could not push ${req.id} to origin:`);
  });

  it('an unreachable origin does not hold up fan-out', async () => {
    h = makeGitHarness({ push: true });
    sh(h.backendRepo.repo, ['remote', 'set-url', 'origin', path.join(h.ws, 'no-such-origin.git')]);
    const req = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(req.id);
    expect(h.task(goal.id).status).toBe('queued');
    await pushesSettled();
    expect(h.logText(goal.id)).toContain(`Could not push ${req.id} to origin:`);
  });

  it('pushes nothing when turned off or without origin', async () => {
    h = makeGitHarness();
    const req = h.createRequirement(['backend']);
    await h.fanOutService.execute(req.id);
    await pushesSettled();
    expect(remoteHead(h.backendRepo.origin!, req.id)).toBeNull();
    h.db.close();
    h = makeGitHarness({ withOrigin: false, push: true });
    const other = h.createRequirement(['backend']);
    const [goal] = await h.fanOutService.execute(other.id);
    await pushesSettled();
    expect(h.logText(goal.id)).not.toContain('origin');
  });
});
```

Append to the `AgentRunner: review fixes` describe in `localEngine/agentRunner.test.ts`:

```ts
  it('reports a task whose run added commits, so its branch can be pushed', async () => {
    const pushed: number[] = [];
    const h = makeLocalHarness({ runner: { onCommits: (taskId) => pushed.push(taskId) } });
    const committed = h.queueRun('FAKE: commit a.txt');
    h.queueRun('FAKE: say nothing to do');
    await h.settle();
    expect(pushed).toEqual([committed.task.id]);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/branchMerge.test.ts packages/server/src/localEngine/agentRunner.test.ts -t "origin|commits, so its branch"`
Expected: FAIL (`pushesSettled` not exported; `pushTaskBranch` not a function; `onCommits` never called).

- [ ] **Step 4: The push queue.** In `branchService.ts`:
  - Add `hasRemote, pushCommit` to the `gitRepo` import, and `import { oneLine } from '../lib/promptSafety.js';`.
  - Add at module level:

```ts
/** Pushes in flight; tests wait for them. */
const pendingPushes = new Set<Promise<void>>();
const PUSH_TIMEOUT_MS = 120_000;

export async function pushesSettled(): Promise<void> {
  while (pendingPushes.size > 0) await Promise.all([...pendingPushes]);
}
```

  - Replace the `afterCreate` stub and add the methods:

```ts
  private afterCreate(repo: string, branches: string[], taskId: number): void {
    for (const branch of branches) this.queuePush(repo, branch, taskId);
  }

  /** Push a task's branch after it got new commits (a Local AI CLI run). */
  public pushTaskBranch(taskId: number): void {
    const task = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as BridgeTask | undefined;
    const project = task?.branch ? this.projectService.getProject(task.project) : undefined;
    if (task?.branch && project) this.queuePush(project.repo_path, task.branch, taskId);
  }

  /** Push `branch` to origin when Settings → push branches is on and origin exists. Never forced, never blocking. */
  private queuePush(repo: string, branch: string, taskId: number): void {
    if (!this.settings.getBranchMergeSettings().push_branches || !hasRemote(repo)) return;
    const sha = resolveCommit(repo, `refs/heads/${branch}`);
    if (!sha) return;
    const push: Promise<void> = pushCommit(repo, sha, branch, 'origin', PUSH_TIMEOUT_MS)
      .then(() => this.log(taskId, `↑ Pushed ${branch} to origin`))
      .catch((err) => this.log(taskId, `Could not push ${branch} to origin: ${oneLine(err?.message || String(err), 300)}`))
      .finally(() => {
        pendingPushes.delete(push);
      });
    pendingPushes.add(push);
  }

  private log(taskId: number, message: string) {
    try {
      this.db
        .prepare("INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, 'system', ?, ?)")
        .run(taskId, message, new Date().toISOString());
    } catch {
      // The database closed meanwhile (shutdown): nothing to record.
    }
  }
```

- [ ] **Step 5: Runner and wiring.**
  - **Option:** in `agentRunner.ts`, add to `AgentRunnerOptions`:

```ts
  /** A run added commits to its task branch (the bridge pushes it). */
  onCommits?: (taskId: number) => void;
```

  - **Call:** in `finish()`, right after the line computing `endSha`, add:

```ts
    if (endSha && endSha !== run.start_sha) this.opts.onCommits?.(taskId);
```

  - **Wiring:** in `packages/server/src/index.ts`, add to the `new AgentRunner({ … })` options `onCommits: (taskId) => branchService.pushTaskBranch(taskId),` (the closure runs after `branchService` exists).

- [ ] **Step 6: Run the tests and the server suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/branchMerge.test.ts packages/server/src/localEngine && npx vitest run packages/server`
Expected: PASS. Afterwards run `git checkout -- workspace/requirements/REQ-001.md`.

- [ ] **Step 7: Commit** `branchService.ts`, `agentRunner.ts`, `index.ts`, `branchMerge.test.ts` and `agentRunner.test.ts` with the message `feat(server): push task and target branches to origin, never forced`.

---

### Task 6: Branch list for the picker

**Files:**
- Modify: `packages/server/src/lib/gitRepo.ts` (add `listBranchNames`), `packages/server/src/services/branchService.ts` (`listBranches`), `packages/server/src/api/app.ts` (`AppDependencies.branchService?`, route), `packages/server/src/index.ts` (pass `branchService`)
- Test: `packages/server/src/services/branchMerge.test.ts`

**Interfaces:**
- Produces:
  - `listBranchNames(repo): string[]`
  - `BranchService.listBranches(projectNames: string[]): Array<{ name: string; projects: string[] }>`
  - `GET /api/branches?projects=a,b`

- [ ] **Step 1: Write the failing test.** Append to `branchMerge.test.ts` (import `createApp`, `testRequest`, `WorkspaceService`, `SseBroadcaster`, `Notifier` if missing):

```ts
describe('Branch list', () => {
  let h: GitHarness;
  beforeEach(() => { h = makeGitHarness(); });
  afterEach(() => h.db.close());

  it('lists the branches of the chosen repositories and where each exists, without task branches', async () => {
    const req = h.createRequirement(['backend', 'mobile']);
    await h.fanOutService.execute(req.id);
    sh(h.backendRepo.repo, ['branch', 'release/1.3']);
    sh(h.mobileRepo.repo, ['branch', 'feature/x']);
    expect(h.branches.listBranches(['backend', 'mobile'])).toEqual([
      { name: 'develop', projects: ['backend', 'mobile'] },
      { name: 'feature/x', projects: ['mobile'] },
      { name: 'release/1.3', projects: ['backend'] },
    ]);
    expect(() => h.branches.listBranches(['nope'])).toThrow('Unknown repository: nope');
  });

  it('answers GET /api/branches', async () => {
    const app = createApp({
      db: h.db, workspaceService: new WorkspaceService(h.db), projectService: h.projectService, requirementService: h.requirementService,
      fanOutService: h.fanOutService, linkService: h.linkService, ticketService: h.ticketService, broadcaster: new SseBroadcaster(),
      notifier: new Notifier(), branchService: h.branches,
    });
    expect((await testRequest(app, 'GET', '/api/branches?projects=backend')).body).toEqual([{ name: 'develop', projects: ['backend'] }]);
    expect((await testRequest(app, 'GET', '/api/branches')).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/branchMerge.test.ts -t "Branch list"`
Expected: FAIL (`h.branches.listBranches is not a function`).

- [ ] **Step 3: Implement.**
  - **Git helper:** add to `gitRepo.ts`:

```ts
/** Local and origin branch names (origin's without the prefix), each once. */
export function listBranchNames(repo: string): string[] {
  const refs = (prefix: string) =>
    (tryGit(repo, ['for-each-ref', '--format=%(refname)', prefix]) || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const local = refs('refs/heads').map((r) => r.slice('refs/heads/'.length));
  const remote = refs('refs/remotes/origin').map((r) => r.slice('refs/remotes/origin/'.length)).filter((n) => n !== 'HEAD');
  return [...new Set([...local, ...remote])];
}
```

  - **Service method:** add to `BranchService`, plus `import { badRequest } from '../lib/httpError.js';` and `listBranchNames` in the gitRepo import:

```ts
  /** Branches of the chosen repositories (one workspace) and which repositories have each; task branches excluded. */
  public listBranches(projectNames: string[]): Array<{ name: string; projects: string[] }> {
    const projects = projectNames.map((name) => {
      const project = this.projectService.getProject(name);
      if (!project) throw badRequest(`Unknown repository: ${name}`);
      return project;
    });
    if (new Set(projects.map((p) => p.workspace_id || 'default')).size > 1) throw badRequest('Choose repositories of one workspace');
    const taskBranches = new Set(
      (this.db.prepare('SELECT DISTINCT branch FROM bridge_tasks WHERE branch IS NOT NULL').all() as Array<{ branch: string }>).map((r) => r.branch)
    );
    const found = new Map<string, Set<string>>();
    for (const project of projects) {
      if (!this.usesBranches(project)) continue;
      for (const name of listBranchNames(project.repo_path)) {
        if (taskBranches.has(name)) continue;
        if (!found.has(name)) found.set(name, new Set());
        found.get(name)!.add(project.name);
      }
    }
    return [...found.entries()]
      .map(([name, where]) => ({ name, projects: [...where].sort() }))
      .sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name))
      .slice(0, 200);
  }
```

  - **App dependency:** in `app.ts`, add `branchService?: BranchService;` to `AppDependencies` (import `BranchService` from `../services/branchService.js`). In `createApp`, after `const settingsService = …`, add `const branchService = deps.branchService || new BranchService(deps.db, deps.projectService, settingsService);`.
  - **Route:** add:

```ts
  // Target branch picker: branches of the chosen repositories (?projects=backend,frontend).
  app.get('/api/branches', (req, res, next) => {
    try {
      const raw = req.query.projects;
      if (typeof raw !== 'string' || !raw.trim()) throw badRequest('projects is required, e.g. ?projects=backend,frontend');
      res.json(branchService.listBranches(raw.split(',').map((p) => p.trim()).filter(Boolean)));
    } catch (err) {
      next(err);
    }
  });
```

  Add `badRequest` to `app.ts`'s `httpError` import if it is not there.
  - **Wiring:** in `index.ts`, add `branchService,` to `createApp({ … })`.

- [ ] **Step 4: Run the tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/services/branchMerge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** `gitRepo.ts`, `branchService.ts`, `app.ts`, `index.ts` and `branchMerge.test.ts` with the message `feat(server): list a workspace's branches for the target branch picker`.

---

### Task 7: CLI per requirement for Local AI CLI runs

**Files:**
- Modify: `packages/server/src/services/agentProfile.ts`, `packages/server/src/services/agentProfile.test.ts` (2 `toEqual` lines ~118/128), `packages/server/src/adapters/types.ts`, `packages/server/src/adapters/localCliAdapter.ts`, `packages/server/src/localEngine/agentRunner.ts` (`pass`, new `cliFor`)
- Test: `packages/server/src/localEngine/agentRunner.test.ts`, `packages/server/src/localEngine/localEngine.e2e.test.ts`, `packages/server/src/adapters/adapters.test.ts`

**Interfaces:**
- Consumes: Task 2 `preferred_cli`; Task 3 `updateRunSettings`; `cliBinary`, `cliEnabled`, `CliChoice` (`localEngine/cliProfiles.ts`).
- Produces:
  - `AgentProfile.cli: AgentCliId | null`
  - `engineProfile()` includes `cli` when set
  - `CreateEngineTaskInput.cli?: AgentCliId`
  - runs choose their CLI one by one

- [ ] **Step 1: Write the failing tests.**
  - **Imports:** in `agentRunner.test.ts`, import `FAKE_AGENT_CLI` from the fixture.
  - **Runner tests:** append:

```ts
describe('AgentRunner: CLI per requirement', () => {
  const useAgyToo = (h: ReturnType<typeof makeLocalHarness>) =>
    h.settingsService.updateAiCliSettings({ agy: { enabled: true, customPath: FAKE_AGENT_CLI } } as any);

  it('runs a requirement with its own CLI while other runs use the Settings choice', async () => {
    const h = makeLocalHarness();
    useAgyToo(h);
    const task = h.addTask();
    const agyRun = h.runner.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit a.txt', preferredCli: 'agy-cli' });
    const plain = h.queueRun('FAKE: commit b.txt');
    await h.settle();
    expect(h.run(agyRun.id)).toMatchObject({ status: 'review', cli: 'agy-cli' });
    expect(h.run(plain.run.id)).toMatchObject({ status: 'review', cli: 'claude-cli' });
  });

  it('fails a run whose chosen CLI is not installed, naming the requirement', async () => {
    const h = makeLocalHarness();
    const task = h.addTask();
    const run = h.runner.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit a.txt', preferredCli: 'codex-cli' });
    await h.settle();
    const { req_id } = h.db.prepare('SELECT req_id FROM bridge_tasks WHERE id = ?').get(task.id) as { req_id: string };
    expect(h.run(run.id)).toMatchObject({ status: 'failed', error: `Codex is chosen for ${req_id} but is not installed on this PC` });
  });

  it('a paused CLI holds back only its own runs', async () => {
    let clock = Date.now();
    const h = makeLocalHarness({ runner: { now: () => clock } });
    useAgyToo(h);
    h.queueRun(`FAKE: limit ${Math.floor(clock / 1000) + 600}`); // Claude Code reaches its limit
    await h.settle();
    const task = h.addTask();
    const agyRun = h.runner.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'T', bodyMd: 'FAKE: commit a.txt', preferredCli: 'agy-cli' });
    const claudeRun = h.queueRun('FAKE: commit b.txt');
    await h.settle();
    expect(h.run(agyRun.id).status).toBe('review');
    expect(h.run(claudeRun.run.id).status).toBe('queued');
  });
});
```

  - **End-to-end test:** append to `localEngine.e2e.test.ts` (import `FAKE_AGENT_CLI`):

```ts
  it("runs a requirement's agents with the CLI it chose", async () => {
    const h = makeE2E();
    h.settingsService.updateAiCliSettings({ agy: { enabled: true, customPath: FAKE_AGENT_CLI } } as any);
    const req = h.createRequirement(['FAKE: commit cli.ts']);
    h.requirementService.updateRunSettings(req.id, { agent_cli: 'agy-cli' });
    const [goal] = await h.fanOut.execute(req.id);
    await h.settle();
    expect(h.runner.runs.get(goal.engine_task_id!)).toMatchObject({ preferred_cli: 'agy-cli', cli: 'agy-cli', status: 'review' });
  }, 15_000);
```

  - **Stoneforge test:** append to `adapters/adapters.test.ts` (import `StoneforgeAdapter` if needed):

```ts
  it('sends Stoneforge only its own create fields (no bridge task id, no CLI)', async () => {
    const bodies: unknown[] = [];
    const fetchSpy = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 'g-1', status: 'ready' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const adapter = new StoneforgeAdapter('http://engine', '/repo', undefined, fetchSpy);
    await adapter.createGoal({ title: 'T', bodyMd: 'B', model: 'opus', effort: 'high', bridgeTaskId: 7, cli: 'agy-cli' });
    await adapter.createTask({ title: 'T', bodyMd: 'B', bridgeTaskId: 8 });
    expect(bodies).toEqual([{ title: 'T', bodyMd: 'B', model: 'opus', effort: 'high' }, { title: 'T', bodyMd: 'B' }]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine packages/server/src/adapters/adapters.test.ts -t "CLI|own create fields|chose"`
Expected: FAIL. The run uses Claude Code, the unusable CLI is not reported, and `cli` is not a known input field (type error, or the e2e preferred_cli is null).

- [ ] **Step 3: Profile and dispatch.**
  - **Profile:** in `agentProfile.ts`:
    - Import `AgentCliId`.
    - Add `cli: AgentCliId | null;` to `AgentProfile`, with the comment `/** The requirement's CLI for Local AI CLI runs (null = Settings default). */`.
    - In `resolveAgentProfile`, add `r.agent_cli AS req_cli,` to the SELECT. Return `{ model: null, effort: null, cli: null }` when there is no row, and add `cli: (row.req_cli ?? null) as AgentCliId | null` otherwise.
    - `engineProfile` returns `{ ...(profile.model ? { model: profile.model } : {}), ...(profile.effort ? { effort: profile.effort } : {}), ...(profile.cli ? { cli: profile.cli } : {}) }`, typed `{ model?: string; effort?: ReasoningEffort; cli?: AgentCliId }`.
    - `recordedProfile` returns `{ model: null, effort: null, cli: null }` for manual.
  - **Profile tests:** in `agentProfile.test.ts`, add `cli: null` to the two `toEqual({ model, effort })` expectations.
  - **Engine input:** in `adapters/types.ts`, add `AgentCliId` to the shared import, and add to `CreateEngineTaskInput`:

```ts
  /** The requirement's CLI (Local AI CLI only; HTTP engines never receive it). */
  cli?: AgentCliId;
```

  - **Adapter:** in `localCliAdapter.ts` `create()`, add `preferredCli: input.cli ?? null,` to `runs.create({ … })`.

- [ ] **Step 4: Runner chooses per run.** In `agentRunner.ts`, import `type CliChoice`, `cliBinary` and `cliEnabled` from `./cliProfiles.js` (if not already), then replace `pass()` with:

```ts
  private async pass(): Promise<void> {
    if (this.stopping) return;
    this.resumeRateLimited();
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
        continue;
      }
      if (!choice.cli || !choice.bin || paused.has(choice.cli)) continue;
      if (this.start(run, choice.cli, choice.bin, ai, settings)) running++;
    }
  }

  /** The requirement's CLI when it chose one (it must be enabled and installed), else the engine's choice. */
  private cliFor(run: LocalRun, ai: AiCliSettings, fallback: CliChoice): CliChoice {
    if (!run.preferred_cli) return fallback.cli ? fallback : { cli: null, bin: null, problem: null };
    const cli = run.preferred_cli;
    const bin = cliEnabled(cli, ai) ? cliBinary(cli, ai, this.find) : null;
    if (bin) return { cli, bin, problem: null };
    const reqId = this.task(run.bridge_task_id)?.req_id ?? 'this requirement';
    const why = cliEnabled(cli, ai) ? 'is not installed on this PC' : 'is turned off in Settings → AI & Local Engines';
    return { cli: null, bin: null, problem: `${CLI_LABELS[cli]} is chosen for ${reqId} but ${why}` };
  }
```

- [ ] **Step 5: Run the tests and the server suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/server/src/localEngine packages/server/src/adapters packages/server/src/services/agentProfile.test.ts && npx vitest run packages/server`
Expected: PASS. Afterwards run `git checkout -- workspace/requirements/REQ-001.md`.

- [ ] **Step 6: Commit** `agentProfile.ts`, `agentProfile.test.ts`, `adapters/types.ts`, `localCliAdapter.ts`, `agentRunner.ts`, `agentRunner.test.ts`, `localEngine.e2e.test.ts` and `adapters.test.ts` with the message `feat(server): a requirement picks the CLI for its Local AI CLI runs`.

---

### Task 8: Web helpers and API calls

**Files:**
- Create: `packages/web/src/lib/runSettingsApi.ts`, `packages/web/src/lib/runSettings.ts`, `packages/web/src/lib/runSettings.test.ts`

**Interfaces:**
- Consumes: Task 1 `branchNameProblem`, `UpdateRunSettingsInput`; Task 3 route; Task 6 route.
- Produces:
  - `saveRunSettings(reqId, input): Promise<Requirement>`, `fetchBranches(projects): Promise<BranchEntry[]>`
  - `RunSettingsDraft`, `CLI_CHOICES`, `AGY_MODEL_SUGGESTIONS`
  - `modelSuggestionsFor(cli)`, `draftFromRequirement(req)`, `runSettingsProblem(draft, mode)`, `runSettingsPatch(draft, req)`
  - `branchOptions(entries, query, chosen): BranchOption[]`, `runSettingsSummary(req): string[]`

- [ ] **Step 1: Write the failing test.** Create `packages/web/src/lib/runSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Requirement } from '@sp-kickstack/shared';
import { branchOptions, draftFromRequirement, modelSuggestionsFor, runSettingsPatch, runSettingsProblem, runSettingsSummary } from './runSettings.js';

const req = (over: Partial<Requirement> = {}): Requirement => ({
  id: 'REQ-008', seq: 8, title: 'T', status: 'draft', priority: 'normal', body_md: '', file_path: '', revision: 1,
  affected_projects: ['backend', 'frontend'], created_at: 'x', updated_at: 'x', ...over,
});

describe('run settings helpers', () => {
  it('starts a draft from the requirement', () => {
    expect(draftFromRequirement(req({ agent_cli: 'agy-cli', target_branch: 'release/1.3' }))).toEqual({
      agent_cli: 'agy-cli', agent_model: null, agent_effort: null, target_branch: 'release/1.3', merge_policy: null, affected_projects: ['backend', 'frontend'],
    });
  });

  it('suggests the models of the chosen CLI', () => {
    expect(modelSuggestionsFor('agy-cli')).toContain('gemini-3.8-flash');
    expect(modelSuggestionsFor('claude-cli')).toContain('opus');
    expect(modelSuggestionsFor(null)).toContain('opus');
    expect(modelSuggestionsFor('codex-cli')).toEqual([]);
  });

  it('checks a draft', () => {
    const draft = draftFromRequirement(req());
    expect(runSettingsProblem(draft, 'edit')).toBeNull();
    expect(runSettingsProblem({ ...draft, affected_projects: [] }, 'fan-out')).toBe('Choose at least one repository');
    expect(runSettingsProblem({ ...draft, target_branch: '../x' }, 'edit')).toBe('A branch name cannot contain .. or //');
    expect(runSettingsProblem({ ...draft, agent_model: 'bad model' }, 'edit')).toMatch(/Model ids/);
  });

  it('sends only what changed, with an empty target as null', () => {
    const r = req({ agent_cli: 'claude-cli', target_branch: 'release/1.3' });
    const draft = { ...draftFromRequirement(r), agent_cli: 'agy-cli' as const, target_branch: '  ' };
    expect(runSettingsPatch(draft, r)).toEqual({ agent_cli: 'agy-cli', target_branch: null });
    expect(runSettingsPatch(draftFromRequirement(r), r)).toEqual({});
  });

  it('lists matching branches with where they exist, and offers to create a new valid name', () => {
    const entries = [{ name: 'develop', projects: ['backend', 'frontend'] }, { name: 'release/1.3', projects: ['backend'] }];
    expect(branchOptions(entries, '', ['backend', 'frontend'])).toEqual([
      { name: 'develop', detail: 'backend, frontend', create: false },
      { name: 'release/1.3', detail: 'backend only (created in frontend at fan-out)', create: false },
    ]);
    expect(branchOptions(entries, 'release/2', ['backend'])).toEqual([
      { name: 'release/2', detail: "new: created from each repository's base branch at fan-out", create: true },
    ]);
    expect(branchOptions(entries, '../x', ['backend'])).toEqual([]);
  });

  it('summarises the settings for the card', () => {
    expect(runSettingsSummary(req())).toEqual(['Default CLI', 'default model', '→ base branch', 'Default merge']);
    expect(runSettingsSummary(req({ agent_cli: 'agy-cli', agent_model: 'gemini-3.8-flash', agent_effort: 'high', target_branch: 'release/1.3', merge_policy: 'auto_merge' }))).toEqual([
      'AGY', 'gemini-3.8-flash · high', '→ release/1.3', 'Auto-merge',
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/web/src/lib/runSettings.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: API calls.** Create `packages/web/src/lib/runSettingsApi.ts`:

```ts
import type { Requirement, UpdateRunSettingsInput } from '@sp-kickstack/shared';
import { BASE } from './api.js';

export interface BranchEntry {
  name: string;
  projects: string[];
}

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function saveRunSettings(reqId: string, input: UpdateRunSettingsInput): Promise<Requirement> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/run-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function fetchBranches(projects: string[]): Promise<BranchEntry[]> {
  return request(`${BASE}/branches?projects=${encodeURIComponent(projects.join(','))}`);
}
```

- [ ] **Step 4: Helpers.** Create `packages/web/src/lib/runSettings.ts`:

```ts
import type { AgentCliId, BranchMergePolicy, ReasoningEffort, Requirement, UpdateRunSettingsInput } from '@sp-kickstack/shared';
import { branchNameProblem } from '@sp-kickstack/shared';
import { MODEL_SUGGESTIONS, describeProfile, isValidModel } from './agentProfile.js';
import type { BranchEntry } from './runSettingsApi.js';

export interface RunSettingsDraft {
  agent_cli: AgentCliId | null;
  agent_model: string | null;
  agent_effort: ReasoningEffort | null;
  /** '' = each repository's base branch. */
  target_branch: string;
  merge_policy: BranchMergePolicy | null;
  affected_projects: string[];
}

export const CLI_CHOICES: Array<{ value: AgentCliId | null; label: string }> = [
  { value: null, label: 'Use default' },
  { value: 'claude-cli', label: 'Claude Code' },
  { value: 'agy-cli', label: 'AGY' },
  { value: 'codex-cli', label: 'Codex' },
];

/** AGY's model presets (Settings → AI & Local Engines offers the same list). */
export const AGY_MODEL_SUGGESTIONS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro'];

/** Model suggestions for a CLI: each CLI has its own model names. */
export function modelSuggestionsFor(cli: AgentCliId | null): string[] {
  if (cli === 'agy-cli') return AGY_MODEL_SUGGESTIONS;
  if (cli === 'codex-cli') return [];
  return MODEL_SUGGESTIONS;
}

export function draftFromRequirement(req: Requirement): RunSettingsDraft {
  return {
    agent_cli: req.agent_cli ?? null,
    agent_model: req.agent_model ?? null,
    agent_effort: req.agent_effort ?? null,
    target_branch: req.target_branch ?? '',
    merge_policy: req.merge_policy ?? null,
    affected_projects: [...req.affected_projects],
  };
}

/** What is wrong with a draft before saving (the server checks the same), or null. */
export function runSettingsProblem(draft: RunSettingsDraft, mode: 'edit' | 'fan-out'): string | null {
  if (mode === 'fan-out' && draft.affected_projects.length === 0) return 'Choose at least one repository';
  if (draft.agent_model && !isValidModel(draft.agent_model)) return 'Model ids use letters, digits and . _ : / - (up to 80 characters)';
  const target = draft.target_branch.trim();
  return target ? branchNameProblem(target) : null;
}

/** The run-settings request body: only what changed (an empty target becomes null). */
export function runSettingsPatch(draft: RunSettingsDraft, req: Requirement): UpdateRunSettingsInput {
  const patch: UpdateRunSettingsInput = {};
  if (draft.agent_cli !== (req.agent_cli ?? null)) patch.agent_cli = draft.agent_cli;
  if (draft.agent_model !== (req.agent_model ?? null)) patch.agent_model = draft.agent_model;
  if (draft.agent_effort !== (req.agent_effort ?? null)) patch.agent_effort = draft.agent_effort;
  const target = draft.target_branch.trim() || null;
  if (target !== (req.target_branch ?? null)) patch.target_branch = target;
  if (draft.merge_policy !== (req.merge_policy ?? null)) patch.merge_policy = draft.merge_policy;
  return patch;
}

export interface BranchOption {
  name: string;
  detail: string;
  create: boolean;
}

/** Picker rows: branches matching `query` with where they exist, and "create" for a new valid name. */
export function branchOptions(entries: BranchEntry[], query: string, chosen: string[]): BranchOption[] {
  const q = query.trim();
  const rows: BranchOption[] = entries
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
    .map((e) => {
      const relevant = chosen.length ? chosen : e.projects;
      const missing = relevant.filter((p) => !e.projects.includes(p));
      const have = relevant.filter((p) => e.projects.includes(p));
      const detail = missing.length === 0 ? have.join(', ') : `${have.join(', ')} only (created in ${missing.join(', ')} at fan-out)`;
      return { name: e.name, detail, create: false };
    });
  if (q && !entries.some((e) => e.name === q) && !branchNameProblem(q)) {
    rows.unshift({ name: q, detail: "new: created from each repository's base branch at fan-out", create: true });
  }
  return rows;
}

/** The Run settings card's parts: CLI, model · effort, target branch, merge policy. */
export function runSettingsSummary(req: Requirement): string[] {
  const cli = CLI_CHOICES.find((c) => c.value === (req.agent_cli ?? null) && c.value !== null)?.label ?? 'Default CLI';
  const profile = describeProfile({ model: req.agent_model ?? null, effort: req.agent_effort ?? null }) || 'default model';
  const merge = req.merge_policy === 'auto_merge' ? 'Auto-merge' : req.merge_policy === 'manual_review_merge' ? 'Review first' : 'Default merge';
  return [cli, profile, `→ ${req.target_branch || 'base branch'}`, merge];
}
```

- [ ] **Step 5: Run the test**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/web/src/lib/runSettings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit** the three files with the message `feat(web): run settings helpers and API calls`.

---

### Task 9: Run settings dialog, card, and wiring

**Files:**
- Create: `packages/web/src/components/BranchPicker.tsx`, `packages/web/src/components/RunSettingsDialog.tsx`, `packages/web/src/components/RunSettingsCard.tsx`
- Modify: `packages/web/src/components/AgentProfilePicker.tsx` (`suggestions` prop), `packages/web/src/pages/RequirementDetailPage.tsx`, `packages/web/src/components/RequirementDetailSheet.tsx`, `packages/web/src/pages/RequirementsPage.tsx` (`handleDropOnGroup` ~line 201)
- Delete: `packages/web/src/components/RequirementAgentControl.tsx` (only `RequirementDetailPage` imports it)

**Interfaces:**
- Consumes: Task 8 helpers and API; `fetchProjects`, `updateRequirementProjects`, `startRequirementFanOut` (`lib/api.ts`); `Dialog*` (`components/ui/dialog.tsx`); `Popover*` (`components/ui/popover.tsx`).
- Produces:
  - `<RunSettingsDialog req mode open onOpenChange />`
  - `<RunSettingsCard req />`
  - `<BranchPicker value onChange entries chosenProjects disabled />`
  - `AgentProfileFields` accepts `suggestions?: string[]`

- [ ] **Step 1: `suggestions` prop.** In `AgentProfilePicker.tsx`:
  - Add `/** Model chips; default the Claude names. */ suggestions?: string[];` to `FieldsProps`.
  - Destructure `suggestions = MODEL_SUGGESTIONS` in `AgentProfileFields`.
  - Inside `AgentProfileFields` only, replace each `MODEL_SUGGESTIONS` with `suggestions` (the `custom` detection, `applyDraft`, and the chip `map`).

- [ ] **Step 2: BranchPicker.** Create `packages/web/src/components/BranchPicker.tsx`:

```tsx
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Check, GitBranch, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { cn } from './ui/sheet.js';
import { branchOptions, type BranchOption } from '../lib/runSettings.js';
import type { BranchEntry } from '../lib/runSettingsApi.js';

interface BranchPickerProps {
  value: string;
  onChange: (value: string) => void;
  entries: BranchEntry[];
  chosenProjects: string[];
  disabled?: boolean;
}

const BASE_ROW: BranchOption = { name: '', detail: "each repository's base branch", create: false };

/** Target branch: an existing branch of the chosen repositories, a new name, or each repository's base branch. */
export function BranchPicker({ value, onChange, entries, chosenProjects, disabled }: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rows = useMemo(() => [BASE_ROW, ...branchOptions(entries, query, chosenProjects)], [entries, query, chosenProjects]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) choose(row.name);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setActive(0);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs text-slate-700 dark:text-slate-200 disabled:opacity-60"
        >
          <GitBranch className="w-3.5 h-3.5 text-[#7b68ee]" />
          <span className="font-mono">{value || 'Base branch of each repository'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2 space-y-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Find a branch or type a new one, e.g. release/1.3"
          aria-label="Target branch"
          aria-controls="target-branch-options"
          aria-activedescendant={`target-branch-${active}`}
          className="w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2.5 py-1.5 text-xs"
        />
        <div id="target-branch-options" role="listbox" aria-label="Branches" className="max-h-60 overflow-y-auto space-y-0.5">
          {rows.map((row, i) => (
            <button
              key={`${row.create ? 'create' : 'branch'}-${row.name}`}
              id={`target-branch-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row.name)}
              className={cn('w-full text-left px-2 py-1.5 rounded-lg text-xs', i === active && 'bg-[#7b68ee]/10')}
            >
              <span className="flex items-center gap-1.5 font-mono text-slate-800 dark:text-slate-200">
                {row.create ? <Plus className="w-3 h-3" /> : value === row.name ? <Check className="w-3 h-3 text-[#7b68ee]" /> : <span className="w-3" />}
                {row.create ? `Create ${row.name}` : row.name || 'Base branch'}
              </span>
              <span className="block pl-[18px] text-[10px] text-slate-500">{row.detail}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: The dialog.** Create `packages/web/src/components/RunSettingsDialog.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BranchMergePolicy, Requirement } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.js';
import { cn } from './ui/sheet.js';
import { AgentProfileFields } from './AgentProfilePicker.js';
import { BranchPicker } from './BranchPicker.js';
import { fetchProjects, startRequirementFanOut, updateRequirementProjects } from '../lib/api.js';
import { fetchBranches, saveRunSettings } from '../lib/runSettingsApi.js';
import { CLI_CHOICES, draftFromRequirement, modelSuggestionsFor, runSettingsPatch, runSettingsProblem, type RunSettingsDraft } from '../lib/runSettings.js';

export interface RunSettingsDialogProps {
  req: Requirement;
  /** 'fan-out': also repositories, and Start Fan-Out confirms. */
  mode: 'edit' | 'fan-out';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MERGE_CHOICES: Array<{ value: BranchMergePolicy | null; label: string }> = [
  { value: null, label: 'Default' },
  { value: 'manual_review_merge', label: 'Review first' },
  { value: 'auto_merge', label: 'Auto-merge' },
];
const heading = 'text-[10px] font-bold uppercase tracking-wider text-slate-400';

function Choice({ pressed, role, onClick, children }: { pressed: boolean; role: 'radio' | 'checkbox'; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={pressed}
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
        pressed ? 'bg-[#7b68ee] border-[#7b68ee] text-white' : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#262732]'
      )}
    >
      {children}
    </button>
  );
}

const sameSet = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');

/** How a requirement's agents run; in fan-out mode the confirmation before agents start. */
export function RunSettingsDialog({ req, mode, open, onOpenChange }: RunSettingsDialogProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RunSettingsDraft>(() => draftFromRequirement(req));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(draftFromRequirement(req));
      setError(null);
    }
  }, [open, req]);

  const workspaceId = req.workspace_id || 'default';
  const { data: projects = [] } = useQuery({ queryKey: ['projects', workspaceId], queryFn: () => fetchProjects(workspaceId), enabled: open });
  const { data: branches = [] } = useQuery({
    queryKey: ['branches', [...draft.affected_projects].sort().join(',')],
    queryFn: () => fetchBranches(draft.affected_projects),
    enabled: open && draft.affected_projects.length > 0,
  });
  const enabledProjects = projects.filter((p) => p.enabled);
  const started = req.status !== 'draft' && req.status !== 'ready';
  const problem = runSettingsProblem(draft, mode);
  const set = (patch: Partial<RunSettingsDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleProject = (name: string) =>
    set({
      affected_projects: draft.affected_projects.includes(name) ? draft.affected_projects.filter((p) => p !== name) : [...draft.affected_projects, name],
    });

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'fan-out' && !sameSet(draft.affected_projects, req.affected_projects)) {
        await updateRequirementProjects(req.id, draft.affected_projects);
      }
      const patch = runSettingsPatch(draft, req);
      if (Object.keys(patch).length > 0) await saveRunSettings(req.id, patch);
      if (mode === 'fan-out') await startRequirementFanOut(req.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success(mode === 'fan-out' ? `Fan-out started for ${req.id}` : 'Run settings saved; they apply to runs started from now on');
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'fan-out' ? `Start fan-out: ${req.id}` : `Run settings: ${req.id}`}</DialogTitle>
          <DialogDescription>
            {mode === 'fan-out' ? 'Check how the agents will run. Nothing starts until you confirm.' : 'Changes apply to agent runs started from now on.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-xs">
          {mode === 'fan-out' && (
            <section className="space-y-1.5">
              <h3 className={heading}>Repositories</h3>
              <div className="flex flex-wrap gap-1.5">
                {enabledProjects.map((p) => (
                  <Choice key={p.name} role="checkbox" pressed={draft.affected_projects.includes(p.name)} onClick={() => toggleProject(p.name)}>
                    {p.name}
                  </Choice>
                ))}
              </div>
              {enabledProjects
                .filter((p) => draft.affected_projects.includes(p.name) && p.engine_type === 'manual')
                .map((p) => (
                  <p key={p.name} className="text-amber-600 dark:text-amber-400">
                    {p.name} is Manual: nobody works on it until you switch it to Local AI CLI.
                  </p>
                ))}
            </section>
          )}

          <section className="space-y-1.5">
            <h3 className={heading}>CLI</h3>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="CLI">
              {CLI_CHOICES.map((c) => (
                <Choice key={c.label} role="radio" pressed={draft.agent_cli === c.value} onClick={() => set({ agent_cli: c.value })}>
                  {c.label}
                </Choice>
              ))}
            </div>
            <p className="text-slate-500">Applies to Local AI CLI repositories. Default: Settings → AI &amp; Local Engines.</p>
          </section>

          <AgentProfileFields
            value={{ model: draft.agent_model, effort: draft.agent_effort }}
            onChange={(v) => set({ agent_model: v.model, agent_effort: v.effort })}
            suggestions={modelSuggestionsFor(draft.agent_cli)}
            defaultTitle="The CLI's model and effort from Settings"
          />

          <section className="space-y-1.5">
            <h3 className={heading}>Target branch</h3>
            <BranchPicker value={draft.target_branch} onChange={(v) => set({ target_branch: v })} entries={branches} chosenProjects={draft.affected_projects} disabled={started} />
            <p className="text-slate-500">
              {started
                ? 'Tasks were already branched from it, so it cannot change after fan-out.'
                : "Tasks start from it and are merged into it. A new name is created from each repository's base branch at fan-out."}
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className={heading}>Merge policy</h3>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Merge policy">
              {MERGE_CHOICES.map((m) => (
                <Choice key={m.label} role="radio" pressed={draft.merge_policy === m.value} onClick={() => set({ merge_policy: m.value })}>
                  {m.label}
                </Choice>
              ))}
            </div>
          </section>
        </div>

        {(error || problem) && <p className="text-xs text-rose-600 dark:text-rose-400">{error ?? problem}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#2e303d]">
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(problem) || submit.isPending}
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-[#7b68ee] to-[#ec4899] disabled:opacity-50"
          >
            {submit.isPending ? 'Working…' : mode === 'fan-out' ? 'Start Fan-Out' : 'Save'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: The card.** Create `packages/web/src/components/RunSettingsCard.tsx`:

```tsx
import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { Requirement } from '@sp-kickstack/shared';
import { RunSettingsDialog } from './RunSettingsDialog.js';
import { runSettingsSummary } from '../lib/runSettings.js';

/** Requirement page: how this requirement's agents run, with Edit. */
export function RunSettingsCard({ req }: { req: Requirement }) {
  const [open, setOpen] = useState(false);
  const closed = req.status === 'done' || req.status === 'cancelled';
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-[#1f202b] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d] text-[11px]">
        {runSettingsSummary(req).map((part, i) => (
          <span key={i} className="font-semibold text-slate-700 dark:text-slate-300">
            {part}
          </span>
        ))}
        {!closed && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 font-bold text-[#7b68ee] hover:underline">
            <Settings2 className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>
      <RunSettingsDialog req={req} mode="edit" open={open} onOpenChange={setOpen} />
    </>
  );
}
```

- [ ] **Step 5: Wire the requirement page and sheet.**
  - **Requirement page:** in `RequirementDetailPage.tsx`:
    - Replace everything from the line `{/* Implementation Branch Tag */}` through the line `<RequirementAgentControl req={req} />` with `<RunSettingsCard req={req} />`. Do it with a script that cuts between those two markers.
    - Change the Start Fan-Out button to `onClick={() => setFanOutOpen(true)}` and drop its `disabled`.
    - Add `const [fanOutOpen, setFanOutOpen] = useState(false);` beside the other `useState`s.
    - Render `<RunSettingsDialog req={req} mode="fan-out" open={fanOutOpen} onOpenChange={setFanOutOpen} />` right after the Start Fan-Out button's closing `)}`.
    - Import `RunSettingsCard` and `RunSettingsDialog`; remove the `RequirementAgentControl` import.
  - **Delete** `components/RequirementAgentControl.tsx`.
  - **Detail sheet:** in `RequirementDetailSheet.tsx`, make the same Start Fan-Out change: a `fanOutOpen` state, the button opens it, and `<RunSettingsDialog req={req} mode="fan-out" open={fanOutOpen} onOpenChange={setFanOutOpen} />`.
  - **Clean up:** remove what becomes unused (`fanOutMutation`, `policyMutation`, `updateRequirementMergePolicy`, `startRequirementFanOut`, `BranchMergePolicy`, icons). The typecheck in Step 7 lists them (`noUnusedLocals`).

- [ ] **Step 6: Kanban drop.** In `RequirementsPage.tsx`:
  - Add `const [fanOutReq, setFanOutReq] = useState<Requirement | null>(null);` (import `Requirement` and `RunSettingsDialog`).
  - Replace the inside of the status branch of `handleDropOnGroup` with:

```ts
      const targetStatus = targetGroupId as RequirementStatus;
      if (targetStatus === 'in_progress' && (req.status === 'draft' || req.status === 'ready')) {
        // Starting work is a fan-out: confirm the run settings first; the card moves once it succeeded.
        setFanOutReq(req);
      } else if (req.status !== targetStatus) {
        updateStatusMutation.mutate({ id: req.id, status: targetStatus });
      }
```

  - Render near the end of the page's JSX:

```tsx
      {fanOutReq && (
        <RunSettingsDialog
          req={fanOutReq}
          mode="fan-out"
          open
          onOpenChange={(next) => {
            if (!next) setFanOutReq(null);
          }}
        />
      )}
```

- [ ] **Step 7: Typecheck and build in isolation.** Make a temporary worktree of HEAD and copy in this task's files: the 3 new components, `AgentProfilePicker.tsx`, `RequirementDetailPage.tsx`, `RequirementDetailSheet.tsx` and `RequirementsPage.tsx`, plus the deletion. Symlink `node_modules`, run `npx tsc --noEmit -p .` in its `packages/web`, then `npx vite build`. Fix anything they flag, typically unused imports.
Expected: `tc=0` and the build succeeds. Remove the worktree.

- [ ] **Step 8: Commit** the new and changed files and the deletion (`update-index --remove` for `RequirementAgentControl.tsx`) with the message `feat(web): run settings dialog for edit, Start Fan-Out and Kanban drag to In Progress`.

---

### Task 10: Settings → Git & Branch Rules: name pattern and push switch

**Files:**
- Modify: `packages/web/src/pages/SettingsPage.tsx` (state ~line 1010; load effect ~line 1040; `updateBranchMutation` ~line 1090; Git tab before the `Save Branch & Merge Rules` button ~line 2141)
- Test: `packages/web/src/lib/runSettings.test.ts`

**Interfaces:**
- Consumes: Task 1 `renderTaskBranchPattern`, `taskBranchPatternProblem`; Task 1 settings fields.

`SettingsPage.tsx` may carry the other session's uncommitted edits. Check `git status --short` first, and if so commit HEAD + your edit only (see Global Constraints).

- [ ] **Step 1: Write the failing test.** Add to `runSettings.test.ts`:

```ts
import { branchPatternExamples } from './runSettings.js';

describe('branch name pattern examples', () => {
  it('shows a goal and a ticket name for a pattern, or the problem', () => {
    expect(branchPatternExamples('{req}')).toEqual({ goal: 'REQ-008', ticket: 'REQ-008-ticket-12', problem: null });
    expect(branchPatternExamples('{project}/{req}')).toEqual({ goal: 'backend/REQ-008', ticket: 'backend/REQ-008-ticket-12', problem: null });
    expect(branchPatternExamples('feature').problem).toBe('The pattern must contain {req}');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/web/src/lib/runSettings.test.ts`
Expected: FAIL (`branchPatternExamples` is not exported).

- [ ] **Step 3: Helper.** Add to `lib/runSettings.ts` (import `renderTaskBranchPattern, taskBranchPatternProblem` from `@sp-kickstack/shared`):

```ts
/** Example names for Settings: a goal and a ticket, or why the pattern cannot be used. */
export function branchPatternExamples(pattern: string): { goal: string; ticket: string; problem: string | null } {
  const goal = renderTaskBranchPattern(pattern, { req: 'REQ-008', task: 12, project: 'backend' });
  return { goal, ticket: `${goal}-ticket-12`, problem: taskBranchPatternProblem(pattern) };
}
```

- [ ] **Step 4: Settings page.** In `SettingsPage.tsx`:
  - **State:** add after `const [mergePolicy, …]`:

```tsx
  const [taskBranchPattern, setTaskBranchPattern] = useState('{req}');
  const [pushBranches, setPushBranches] = useState(true);
```

  - **Load:** in the effect that loads `settingsData.branch_merge`, add:

```tsx
      setTaskBranchPattern(settingsData.branch_merge.task_branch_pattern || '{req}');
      setPushBranches(settingsData.branch_merge.push_branches !== false);
```

  - **Save:** in `updateBranchMutation`'s `updateBranchMergeSettings({ … })`, add `task_branch_pattern: taskBranchPattern.trim(), push_branches: pushBranches,`.
  - **Fields:** insert directly before the `<div className="pt-2">` that wraps the `Save Branch & Merge Rules` button:

```tsx
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#2d2d2d]">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300" htmlFor="task-branch-pattern">
                  Task branch name
                </label>
                <input
                  id="task-branch-pattern"
                  value={taskBranchPattern}
                  onChange={(e) => setTaskBranchPattern(e.target.value)}
                  className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-xs font-mono"
                />
                {(() => {
                  const ex = branchPatternExamples(taskBranchPattern);
                  return ex.problem ? (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">{ex.problem}</p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      {'{req}'}, {'{task}'} and {'{project}'} are filled in. A goal gets <code>{ex.goal}</code>, a ticket <code>{ex.ticket}</code>; a taken name gets -2. Existing branches keep their names.
                    </p>
                  );
                })()}
                <div className="flex items-center justify-between max-w-sm">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Push branches to origin</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pushBranches}
                    aria-label="Push branches to origin"
                    onClick={() => setPushBranches(!pushBranches)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${pushBranches ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${pushBranches ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  New task and target branches, and agents' new commits, are pushed by the bridge. Never forced; a failed push only adds a line to the task's Logs.
                </p>
              </div>
```

  - **Save guard:** add `disabled={updateBranchMutation.isPending || Boolean(branchPatternExamples(taskBranchPattern).problem)}` to the save button.
  - **Import:** `branchPatternExamples` from `../lib/runSettings.js`.

- [ ] **Step 5: Test and typecheck in isolation.**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npx vitest run packages/web/src/lib/runSettings.test.ts`
Expected: PASS. Then typecheck `packages/web` in a temporary worktree containing only your files, with `SettingsPage.tsx` as HEAD + your edit.

- [ ] **Step 6: Commit** `runSettings.ts`, `runSettings.test.ts` and `SettingsPage.tsx` (HEAD + your edit) with the message `feat(web): task branch name pattern and push switch in Settings`.

---

### Task 11: Guide, desktop bundle, full verification

**Files:**
- Modify: `docs/guide/02-projects-and-engines.md`, `docs/guide/03-requirements-and-fan-out.md`, `docs/guide/06-review-qa-and-merge.md`, `docs/guide/09-settings-and-environment.md`, `docs/guide/10-troubleshooting.md`
- Regenerate: `packages/desktop/src-tauri/resources/server/index.mjs` (and `xticket.mjs` if changed)

- [ ] **Step 1: Branch names in the guide.** Run `grep -rn "req/<REQ-ID>/task-<id>\|req/REQ-" docs/guide`.
  - Replace each generic mention with `REQ-<n>` for goals and `REQ-<n>-ticket-<id>` for tickets, adding once per file "(tasks created before 2026-10-13 keep `req/<REQ-ID>/task-<id>`)".
  - Leave example output that quotes a real old branch as it is.

- [ ] **Step 2: Guide 03, run settings.** In `docs/guide/03-requirements-and-fan-out.md`, add a section `## Run settings` before the existing fan-out steps:

```markdown
## Run settings

Each requirement has a **Run settings** card on its page: CLI · model · effort · target branch · merge
policy. Click **Edit** to change them. They apply to agent runs started afterwards.

| Setting | Meaning |
|---|---|
| **CLI** | Claude Code, AGY or Codex for this requirement's agents, on Local AI CLI repositories. **Use default** follows Settings → AI & Local Engines. If the chosen CLI is not installed or is turned off, its runs fail with `<CLI> is chosen for <REQ> but …`. |
| **Model / effort** | The suggestions follow the CLI (`opus`, `sonnet`… for Claude Code; `gemini-3.8-flash`… for AGY). Empty = the CLI's model and effort in Settings. |
| **Target branch** | Tasks start from this branch and are merged into it, for example `release/1.3` for the next release. Pick an existing branch (the list shows which repositories have it) or type a new name: it is created from each repository's base branch at fan-out, and pushed. Empty = each repository's base branch. It cannot change after fan-out. |
| **Merge policy** | Review first or auto-merge; Default = the workspace setting. |

### Start fan-out

**Start Fan-Out** (on the requirement page or its side sheet) opens the same dialog with the
repositories as well. Check or change them, then click **Start Fan-Out** in the dialog. Nothing starts
before that.

On the board, dragging a **Draft** or **Ready** card to **In Progress** opens this dialog too. The
card moves once fan-out has started; **Cancel** leaves it where it was, and an error (for example
`No enabled projects`) shows in the dialog.
```

  Remove or adjust any older sentence in that file that says dragging to In Progress only changes the status.

- [ ] **Step 3: Other chapters.**
  - **06:** in `06-review-qa-and-merge.md`, under the merge description, add: "With a **target branch**, the merge goes into it instead of the base branch, and the target branch is pushed to `origin`. If `origin` does not have it yet, the push creates it."
  - **02:** in `02-projects-and-engines.md`, in the Local AI CLI bullets, add: "**CLI per requirement:** a requirement can choose its own CLI in **Run settings**; the Settings choice applies to the others."
  - **09:** in `09-settings-and-environment.md`, under `### Git & Branch Rules`, add:

```markdown
| Setting | Default | Meaning |
|---|---|---|
| **Task branch name** | `{req}` | Name of new task branches. `{req}`, `{task}` and `{project}` are filled in; a ticket adds `-ticket-<task>`; a taken name gets `-2`. Existing branches keep their names. |
| **Push branches to origin** | on | The bridge pushes new task and target branches, and agents' new commits, to `origin`. Never forced: a failed push only adds `Could not push <branch> to origin: <reason>` to the task's Logs. |
```

  - **10:** append these rows to the `## Messages about tasks` table in `10-troubleshooting.md`:

```markdown
| `<REQ> was already fanned out to <branch>; the target branch cannot change (create a new requirement for another branch)` | Tasks were branched from the target branch. | Keep it, or create a new requirement for the other branch. |
| `<branch> is the branch of task #<id>; choose another target branch` | A task's own branch cannot be a target. | Pick another branch. |
| `<CLI> is chosen for <REQ> but is not installed on this PC` | The requirement's CLI cannot run here. | Install it, or change the CLI in **Run settings**, then **Retry**. |
| `Could not push <branch> to origin: <reason>` (in Logs) | The push was refused or `origin` was unreachable; the task carries on. | Fix the credentials or the network; the next push tries again. |
```

- [ ] **Step 4: Desktop bundle**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 >/dev/null && npm run desktop:bundle-server`
Expected: both bundles written. Check `git diff --stat packages/desktop/src-tauri/resources/server/`. Module comment paths must stay `node_modules/…`.

- [ ] **Step 5: Full verification.** Run `npm run verify` in a temporary worktree of HEAD plus your uncommitted files, because the shared tree may hold the other session's unfinished code.
Expected: all tests pass, and typecheck is clean in that worktree. The known flaky `aiDraft.test` "lists provider status" may time out at 5 s; rerun it alone. Afterwards run `graft build`, and `git checkout -- workspace/requirements/REQ-001.md` if a suite run rewrote it.

- [ ] **Step 6: Commit** the five guide files and the bundle with the message `docs: run settings, target branches, branch names and pushing; build(desktop): regenerate bundle`.

---

## Spec coverage

| Spec section | Task |
|---|---|
| CLI / model / effort per requirement | 1, 2, 3, 7, 9 |
| Target branch: storage, lock, validation, creation, tickets, merge gate | 1, 2, 3, 4 |
| Task branch names (pattern, tickets, -2, taken, existing kept) | 1, 4, 10 |
| Pushing to origin (task, target, after runs; never forced; logs; setting) | 1, 5, 10 |
| Branch list | 6, 8, 9 |
| Dialog in three places; card replaces old controls; Kanban behaviour | 8, 9 |
| Settings (Rule B) | 1, 10 |
| Stoneforge body unchanged (now asserted) | 7 |
| Desktop (Rule A) | 8, 11 |
| Docs | 11 |
