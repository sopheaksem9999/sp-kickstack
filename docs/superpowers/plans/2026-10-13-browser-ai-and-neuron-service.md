# Built-In Browser with AI Tool Selector, Jev/Clef Config & Neuron Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an In-App Browser (`/browser`) with a ChatGPT-style AI tool selector (Summarize, Extract Requirement, Inspect, Ask, Engine Switcher), add Settings configuration for custom Jev CLI and Cloudflare Clef engines, and implement the Neuron Service (continuous agent learning, post-run reflection, and dynamic prompt enrichment).

**Architecture:** 
1. `@sp-kickstack/shared`: Add schemas and TypeScript definitions for Jev, Clef, Browser content, and Neuron rules.
2. `@sp-kickstack/server`: SQLite Migration 9 for `neuron_rules`, `NeuronService` (reflection & prompt enrichment), safe browser page fetcher (`/api/browser/fetch-page`), Clef decision API service, and Jev CLI runner support.
3. `@sp-kickstack/web`: First-class `/browser` screen with address bar, iframe canvas/reader, sidecar AI chat with Radix-powered Tool Selector bar, Settings UI expansion, and Neuron audit telemetry manager.

**Tech Stack:** React 18, Vite, Radix UI Primitives, Tailwind CSS, Lucide icons, Express, Better-SQLite3, Zod, Vitest.

## Global Constraints
- Node version: Node 22 (`export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`).
- Prioritize Radix UI primitives for dialogs, popovers, and toolbars per `.agents/rules/ui-radix-priority.md`.
- Synchronize tab parameters (`?tab=...` and `/browser?url=...`) per `.agents/rules/ui-tab-url-governance.md`.
- Maintain desktop sidecar bundling compatibility per `.agents/rules/desktop-and-settings-governance.md`.
- Maintain test-driven development (TDD) discipline: write failing test, verify failure, implement, verify pass, commit.

---

### Task 1: Shared Schemas & Types (`@sp-kickstack/shared`)

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Test: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Produces:
  - `NeuronCategory`: `'convention' | 'architecture' | 'dependency' | 'testing' | 'triage'`
  - `NeuronRule`: `{ id: string; workspace_id: string; project: string; category: NeuronCategory; rule_text: string; confidence_score: number; trigger_count: number; is_active: boolean; source_run_id: string | null; created_at: string; updated_at: string }`
  - `JevSettings`: `{ jev_bin_path: string; jev_model: string; jev_args_template: string }`
  - `ClefSettings`: `{ clef_enabled: boolean; clef_account_id: string; clef_api_token: string; clef_model: string; clef_auto_triage: boolean }`
  - `BrowserPageContent`: `{ url: string; title: string; textContent: string; headings: string[]; error?: string }`

- [ ] **Step 1: Write the failing schema test**

In `packages/shared/src/schemas.test.ts`:
```typescript
import { neuronRuleSchema, browserPageSchema } from './schemas.js';

it('validates a valid neuron rule schema', () => {
  const parsed = neuronRuleSchema.parse({
    id: 'rule-1',
    workspace_id: 'default',
    project: 'frontend',
    category: 'convention',
    rule_text: 'Always use pnpm when installing dependencies',
    confidence_score: 0.95,
    trigger_count: 3,
    is_active: true,
    source_run_id: 'local-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  expect(parsed.id).toBe('rule-1');
  expect(parsed.category).toBe('convention');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/shared/src/schemas.test.ts`
Expected: FAIL with "neuronRuleSchema is not defined"

- [ ] **Step 3: Implement schemas and types**

Update `packages/shared/src/types.ts` and `packages/shared/src/schemas.ts` with `NeuronRule`, `NeuronCategory`, `JevSettings`, `ClefSettings`, and `browserPageSchema`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/shared/src/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/shared/
git commit -m "feat(shared): add types and schemas for Neuron rules, Jev, Clef, and browser reader"
```

---

### Task 2: Database Migration 9 & Neuron Storage (`@sp-kickstack/server`)

**Files:**
- Modify: `packages/server/src/db/migrations.ts`
- Create: `packages/server/src/services/neuronService.ts`
- Test: `packages/server/src/services/neuronService.test.ts`
- Modify: `packages/server/src/db/migrations.test.ts`

**Interfaces:**
- Produces:
  - `NeuronService`:
    - `listRules(workspaceId: string, project?: string): NeuronRule[]`
    - `createRule(input: CreateNeuronRuleInput): NeuronRule`
    - `updateRule(id: string, patch: Partial<NeuronRule>): NeuronRule | null`
    - `deleteRule(id: string): boolean`
    - `enrichPrompt(basePrompt: string, project: string): string`
    - `reflectOnRun(runId: string): Promise<NeuronRule[]>`

- [ ] **Step 1: Write failing migration and NeuronService test**

Create `packages/server/src/services/neuronService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrations.js';
import { NeuronService } from './neuronService.js';

describe('NeuronService', () => {
  let db: any;
  let service: NeuronService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    service = new NeuronService(db);
  });

  it('creates, lists, and enriches prompts with learned rules', () => {
    const rule = service.createRule({
      workspace_id: 'default',
      project: 'backend',
      category: 'testing',
      rule_text: 'Run migrations before executing integration tests',
      confidence_score: 0.9,
    });
    expect(rule.id).toBeDefined();

    const rules = service.listRules('default', 'backend');
    expect(rules).toHaveLength(1);

    const enriched = service.enrichPrompt('Implement feature', 'backend');
    expect(enriched).toContain('Learned Repository Patterns');
    expect(enriched).toContain('Run migrations before executing integration tests');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/server/src/services/neuronService.test.ts`
Expected: FAIL with missing table or service

- [ ] **Step 3: Implement Migration 9 and NeuronService**

In `packages/server/src/db/migrations.ts`, add migration 9 (`neuron_rules` table).
Implement `packages/server/src/services/neuronService.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/server/src/services/neuronService.test.ts packages/server/src/db/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/server/src/db/migrations.ts packages/server/src/services/neuronService.ts packages/server/src/services/neuronService.test.ts packages/server/src/db/migrations.test.ts
git commit -m "feat(server): add migration 9 and NeuronService for learned rules storage and prompt enrichment"
```

---

### Task 3: Browser Reader & Clef / Jev Engine Dispatcher (`@sp-kickstack/server`)

**Files:**
- Create: `packages/server/src/services/browserService.ts`
- Create: `packages/server/src/services/clefService.ts`
- Modify: `packages/server/src/localEngine/cliProfiles.ts`
- Modify: `packages/server/src/localEngine/agentRunner.ts`
- Modify: `packages/server/src/api/app.ts`
- Test: `packages/server/src/services/browserService.test.ts`
- Test: `packages/server/src/services/clefService.test.ts`

**Interfaces:**
- Produces:
  - `BrowserService.fetchPage(url: string): Promise<BrowserPageContent>`
  - `ClefService.triageError(errorText: string, settings: ClefSettings): Promise<{ severity: 'P0' | 'P1' | 'P2' | 'P3'; domain: string; rationale: string }>`
  - Routes:
    - `GET /api/browser/fetch-page?url=...`
    - `GET /api/neuron/rules`
    - `POST /api/neuron/rules`
    - `PATCH /api/neuron/rules/:id`
    - `DELETE /api/neuron/rules/:id`

- [ ] **Step 1: Write failing test for BrowserService and ClefService**

Create `packages/server/src/services/browserService.test.ts` and `packages/server/src/services/clefService.test.ts`.

- [ ] **Step 2: Run test to verify failure**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/server/src/services/browserService.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement services, Jev CLI profile, and API routes**

Implement `BrowserService` (URL validation, HTML-to-text sanitization, heading extractor).
Implement `ClefService` (Cloudflare AI API request with deterministic heuristic fallback).
Add Jev CLI profile in `cliProfiles.ts`.
Wire prompt enrichment into `agentRunner.ts` via `NeuronService.enrichPrompt(...)`.
Register routes in `packages/server/src/api/app.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/server/src/services/browserService.test.ts packages/server/src/services/clefService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/server/
git commit -m "feat(server): implement browser fetcher, Clef triage, Jev CLI profile, and Neuron API routes"
```

---

### Task 4: In-App Browser Page with ChatGPT-Style AI Tool Selector (`@sp-kickstack/web`)

**Files:**
- Create: `packages/web/src/pages/BrowserPage.tsx`
- Create: `packages/web/src/components/BrowserNavBar.tsx`
- Create: `packages/web/src/components/BrowserAiSidebar.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/lib/TabContext.tsx`
- Test: `packages/web/src/pages/BrowserPage.test.tsx`

**Interfaces:**
- Produces:
  - Route `/w/:workspaceId/browser` (or `/browser?url=...`)
  - Tool actions:
    - `summarize`: Calls AI chat with current page content.
    - `extract_requirement`: Generates requirement ticket pre-fill draft.
    - `explain_code`: Explains architecture/code snippets on page.
    - `ask_page`: Freeform chat grounded on page text.
    - `engine_select`: Switches model / engine dynamically.

- [ ] **Step 1: Write failing test for BrowserPage and Tool Selector**

Create `packages/web/src/pages/BrowserPage.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { BrowserPage } from './BrowserPage.js';

it('renders browser address bar and tool selector buttons', () => {
  render(
    <BrowserRouter>
      <BrowserPage />
    </BrowserRouter>
  );
  expect(screen.getByPlaceholderText(/enter url/i)).toBeDefined();
  expect(screen.getByText(/summarize/i)).toBeDefined();
  expect(screen.getByText(/extract requirement/i)).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/web/src/pages/BrowserPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement BrowserPage, BrowserNavBar, and BrowserAiSidebar**

Implement components with Radix popovers, URL state sync, iframe container with reader fallback, and tool selector bar.
Update `TabContext.tsx` `resolveTabInfo` for `/browser` route.
Mount route in `App.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/web/src/pages/BrowserPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/web/src/pages/BrowserPage.tsx packages/web/src/components/BrowserNavBar.tsx packages/web/src/components/BrowserAiSidebar.tsx packages/web/src/App.tsx packages/web/src/lib/TabContext.tsx packages/web/src/pages/BrowserPage.test.tsx
git commit -m "feat(web): add in-app browser with ChatGPT-style AI sidebar and tool selector"
```

---

### Task 5: Settings Integration & Neuron Audit Manager (`@sp-kickstack/web`)

**Files:**
- Modify: `packages/web/src/pages/SettingsPage.tsx`
- Modify: `packages/web/src/pages/MetricsPage.tsx`
- Create: `packages/web/src/components/NeuronAuditSection.tsx`
- Modify: `packages/web/src/lib/api.ts`
- Test: `packages/web/src/components/NeuronAuditSection.test.tsx`

**Interfaces:**
- Produces:
  - Settings cards for **Jev CLI Engine**, **Cloudflare Clef ("Cleft")**, and **Neuron Continuous Improvement**.
  - Telemetry manager for learned rules under Metrics/Audit.

- [ ] **Step 1: Write failing test for NeuronAuditSection**

Create `packages/web/src/components/NeuronAuditSection.test.tsx`.

- [ ] **Step 2: Run test to verify failure**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/web/src/components/NeuronAuditSection.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement Settings controls and NeuronAuditSection**

Add Jev CLI, Clef, and Neuron cards to `SettingsPage.tsx`.
Add `NeuronAuditSection` to `MetricsPage.tsx` with rule status toggles and delete controls.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/web/src/components/NeuronAuditSection.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/web/src/pages/SettingsPage.tsx packages/web/src/pages/MetricsPage.tsx packages/web/src/components/NeuronAuditSection.tsx packages/web/src/lib/api.ts packages/web/src/components/NeuronAuditSection.test.tsx
git commit -m "feat(web): add Settings controls for Jev, Clef, and Neuron audit manager"
```

---

### Task 6: Full Verification, Desktop Bundling & End-to-End Test

**Files:**
- Run: Full monorepo verification and desktop bundling

- [ ] **Step 1: Run TypeScript typecheck across all workspaces**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npm run typecheck
```
Expected: 0 errors across `@sp-kickstack/shared`, `@sp-kickstack/server`, and `@sp-kickstack/web`.

- [ ] **Step 2: Run all unit and integration tests**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npx vitest run packages/web/src/lib/TabContext.test.ts packages/server/src/services/neuronService.test.ts packages/server/src/services/browserService.test.ts packages/server/src/services/clefService.test.ts
```
Expected: PASS for all new and existing web/server tests.

- [ ] **Step 3: Build web package**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npm run build --workspace=@sp-kickstack/web
```
Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Bundle desktop server**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; npm run desktop:bundle-server
```
Expected: Desktop standalone server bundle completes successfully.

- [ ] **Step 5: Final Git commit**

```bash
git commit --allow-empty -m "chore: verify full browser AI, Jev/Clef config, and Neuron service implementation"
```
