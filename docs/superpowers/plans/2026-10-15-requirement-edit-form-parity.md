# Requirement Edit Form Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide full functional and visual parity between requirement creation and editing by upgrading the slide-over sheet into a dual-mode (Create & Edit) component with full markdown parsing and server persistence.

**Architecture:** Extend `@sp-kickstack/shared` with a markdown deconstructor and updated Zod update schema; upgrade `RequirementService.updateRequirement` to persist all structured fields atomically and synchronize disk markdown files; expand `CreateRequirementContext` to support edit mode and populate all inputs (Title, Priority, State, Sprint, Merge Policy, Affected Repos, Target Branch, Goal, User Story, Criteria checklist, Attachments); integrate Edit triggers into `RequirementDetailSheet`, `RequirementDetailPage`, and `RequirementsPage`.

**Tech Stack:** React 19, TypeScript 5.6, Tailwind CSS, Radix UI Primitives, Zod, Better-SQLite3, Express, Vitest.

## Global Constraints

- Prioritize Radix UI primitives (`@radix-ui/react-*` and `RadixSelect`) over native HTML elements per `.agents/rules/ui-radix-priority.md`.
- Desktop & Settings Governance: Ensure TypeScript and bundling pass across `@sp-kickstack/shared`, `@sp-kickstack/server`, and `@sp-kickstack/web` per `.agents/rules/desktop-and-settings-governance.md`.
- All Node 22 execution commands must use Node 22 (`PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH"`).

---

### Task 1: Markdown Parser for Requirements in `@sp-kickstack/shared`

**Files:**
- Create: `packages/shared/src/requirementMarkdown.ts`
- Create: `packages/shared/src/requirementMarkdown.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `parseRequirementMarkdown(bodyMd: string): ParsedRequirementMarkdown`
- Types: `ParsedRequirementMarkdown { goal: string; userStory?: string; acceptanceCriteria: string[]; apiHints?: string; notes?: string; }`

- [ ] **Step 1: Write the failing unit test**

Create `packages/shared/src/requirementMarkdown.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseRequirementMarkdown } from './requirementMarkdown.js';

describe('parseRequirementMarkdown', () => {
  it('parses standard rendered markdown with all sections', () => {
    const md = `---
id: REQ-001
title: [Realtime] Live Map Tracking
priority: high
projects: [backend, frontend]
status: draft
revision: 1
---

## Goal
Enable real-time driver tracking on the user map.

## User story
As a rider, I want to see nearby drivers so I can book immediately.

## Acceptance criteria
- [ ] Connects to WebSocket gateway
- [ ] Updates driver coordinates at 5 Hz
- [x] Renders custom vehicle markers on map

## API hints
Use endpoint GET /api/v1/drivers/stream

## Specification & Architectural Details
Requires Redis pub/sub backplane for location fanout.
`;

    const parsed = parseRequirementMarkdown(md);
    expect(parsed.goal).toBe('Enable real-time driver tracking on the user map.');
    expect(parsed.userStory).toBe('As a rider, I want to see nearby drivers so I can book immediately.');
    expect(parsed.acceptanceCriteria).toEqual([
      'Connects to WebSocket gateway',
      'Updates driver coordinates at 5 Hz',
      'Renders custom vehicle markers on map',
    ]);
    expect(parsed.apiHints).toBe('Use endpoint GET /api/v1/drivers/stream');
    expect(parsed.notes).toBe('Requires Redis pub/sub backplane for location fanout.');
  });

  it('handles unstructured markdown without standard section headers', () => {
    const raw = `This is a simple requirement description without headers.
It has multiple lines.`;

    const parsed = parseRequirementMarkdown(raw);
    expect(parsed.goal).toBe('This is a simple requirement description without headers.\nIt has multiple lines.');
    expect(parsed.userStory).toBeUndefined();
    expect(parsed.acceptanceCriteria).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/shared/src/requirementMarkdown.test.ts
```
Expected: FAIL with module not found or function not exported.

- [ ] **Step 3: Implement `parseRequirementMarkdown`**

Create `packages/shared/src/requirementMarkdown.ts`:
```ts
export interface ParsedRequirementMarkdown {
  goal: string;
  userStory?: string;
  acceptanceCriteria: string[];
  apiHints?: string;
  notes?: string;
}

export function parseRequirementMarkdown(bodyMd: string): ParsedRequirementMarkdown {
  if (!bodyMd || typeof bodyMd !== 'string') {
    return { goal: '', acceptanceCriteria: [] };
  }

  // 1. Strip YAML frontmatter if present
  const content = bodyMd.replace(/^---\s*[\s\S]*?---\s*/, '').trim();

  // 2. Check if content has markdown headers (## )
  const sectionRegex = /^##\s+([^\n]+)\n([\s\S]*?)(?=(?:^##\s+)|$)/gm;
  const sections: Record<string, string> = {};

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    const headerTitle = match[1].trim().toLowerCase();
    const sectionBody = match[2].trim();
    sections[headerTitle] = sectionBody;
  }

  // 3. Fallback if no sections were matched
  if (Object.keys(sections).length === 0) {
    return {
      goal: content,
      acceptanceCriteria: [],
    };
  }

  // 4. Extract Goal
  const goal = sections['goal'] || '';

  // 5. Extract User Story
  const userStory = sections['user story'] || undefined;

  // 6. Extract Acceptance Criteria checklist
  const rawCriteria = sections['acceptance criteria'] || '';
  const acceptanceCriteria: string[] = [];
  if (rawCriteria) {
    for (const line of rawCriteria.split('\n')) {
      const trimmed = line.trim();
      const itemMatch = trimmed.match(/^[-*]\s*(?:\[[ xX]\]\s*)?(.*)$/);
      if (itemMatch && itemMatch[1].trim()) {
        acceptanceCriteria.push(itemMatch[1].trim());
      }
    }
  }

  // 7. Extract API hints & Notes
  const apiHints = sections['api hints'] || undefined;
  const notes =
    sections['specification & architectural details'] ||
    sections['notes'] ||
    sections['specification'] ||
    undefined;

  return {
    goal,
    userStory,
    acceptanceCriteria,
    apiHints,
    notes,
  };
}
```

Export in `packages/shared/src/index.ts`:
```ts
export * from './requirementMarkdown.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/shared/src/requirementMarkdown.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/requirementMarkdown.ts packages/shared/src/requirementMarkdown.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add parseRequirementMarkdown helper and tests"
```

---

### Task 2: Update Schema in `@sp-kickstack/shared`

**Files:**
- Modify: `packages/shared/src/schemas.ts:198-208`
- Modify: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Modifies: `UpdateRequirementInputSchema` to support all structured requirement fields.

- [ ] **Step 1: Write failing schema test**

Add to `packages/shared/src/schemas.test.ts`:
```ts
it('validates structured UpdateRequirementInput with all fields', () => {
  const updatePayload = {
    title: 'Updated Title',
    goal: 'Updated Goal',
    user_story: 'As an admin, I want reports',
    acceptance_criteria: ['Filter by date', 'Export CSV'],
    priority: 'urgent',
    status: 'in_progress',
    affected_projects: ['backend', 'frontend'],
    target_branch: 'release/2.0',
    sprint_id: 'sprint-1',
    merge_policy: 'auto_merge',
    attachments: [{ name: 'spec.pdf', size: 1024, type: 'application/pdf', data_url: 'data:...' }],
    api_hints: 'GET /reports',
    notes: 'Architectural note',
  };

  const parsed = UpdateRequirementInputSchema.safeParse(updatePayload);
  expect(parsed.success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/shared/src/schemas.test.ts
```
Expected: FAIL due to unrecognized or missing schema keys.

- [ ] **Step 3: Update `UpdateRequirementInputSchema`**

In `packages/shared/src/schemas.ts`:
```ts
export const UpdateRequirementInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  goal: z.string().optional(),
  user_story: z.string().optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  priority: PrioritySchema.optional(),
  status: RequirementStatusSchema.optional(),
  affected_projects: z.array(z.string().min(1)).optional(),
  target_branch: TargetBranchSchema.nullable().optional(),
  sprint_id: z.string().nullable().optional(),
  merge_policy: BranchMergePolicySchema.nullable().optional(),
  attachments: z.array(AttachmentItemSchema).optional(),
  api_hints: z.string().optional(),
  notes: z.string().optional(),
  body_md: z.string().optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/shared/src/schemas.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat(shared): expand UpdateRequirementInputSchema with structured fields"
```

---

### Task 3: Backend RequirementService & API Support for Structured Updates

**Files:**
- Modify: `packages/server/src/services/requirementService.ts:215-273`
- Create / Modify: `packages/server/src/services/requirementService.test.ts`

**Interfaces:**
- Updates: `RequirementService.updateRequirement(id: string, input: UpdateRequirementInput): Requirement`
- Handles: Atomically updates SQLite table columns `target_branch`, `attachments`, `status`, re-renders `body_md` if structured fields provided, writes to disk markdown file, and returns updated `Requirement`.

- [ ] **Step 1: Write test for structured `updateRequirement`**

Create or update test in `packages/server/src/services/requirementService.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { RequirementService } from './requirementService.js';
import { runMigrations } from '../db/migrations.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('RequirementService.updateRequirement with structured fields', () => {
  let db: any;
  let tmpDir: string;
  let service: RequirementService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-test-'));
    service = new RequirementService(db, tmpDir);

    db.prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('default', 'Default', datetime('now'), datetime('now'))").run();
    db.prepare("INSERT INTO projects (name, workspace_id, kind, repo_path, engine_type, base_branch, done_means, high_risk_paths, enabled, engine_status, created_at, updated_at) VALUES ('backend', 'default', 'backend', '/repo', 'local', 'main', 'merged', '[]', 1, 'ok', datetime('now'), datetime('now'))").run();
  });

  it('updates structured fields, target_branch, attachments, and re-renders body_md', () => {
    const created = service.createRequirement({
      workspace_id: 'default',
      title: 'Initial Title',
      goal: 'Initial Goal',
      affected_projects: ['backend'],
      priority: 'normal',
    });

    const updated = service.updateRequirement(created.id, {
      title: 'Updated Title',
      goal: 'New Goal Text',
      user_story: 'As a user I want parity',
      acceptance_criteria: ['Check 1', 'Check 2'],
      priority: 'urgent',
      target_branch: 'release/v1',
      attachments: [{ name: 'doc.txt', size: 100, type: 'text/plain', data_url: 'data:text/plain;base64,abc' }],
    });

    expect(updated.title).toBe('Updated Title');
    expect(updated.priority).toBe('urgent');
    expect(updated.target_branch).toBe('release/v1');
    expect(updated.attachments).toHaveLength(1);
    expect(updated.body_md).toContain('New Goal Text');
    expect(updated.body_md).toContain('As a user I want parity');
    expect(updated.body_md).toContain('- [ ] Check 1');
    expect(updated.body_md).toContain('- [ ] Check 2');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/server/src/services/requirementService.test.ts
```
Expected: FAIL because `target_branch` and `attachments` are not updated and `body_md` is not re-rendered from structured fields.

- [ ] **Step 3: Implement structured updates in `RequirementService.updateRequirement`**

In `packages/server/src/services/requirementService.ts`:
Update `updateRequirement`:
```ts
  public updateRequirement(id: string, input: UpdateRequirementInput): Requirement {
    const existing = this.getRequirement(id);
    if (!existing) throw new Error(`Requirement ${id} not found`);

    if (existing.status !== 'draft' && existing.status !== 'ready' && input.status === undefined) {
      throw new HttpError(
        400,
        `Cannot edit requirement in status "${existing.status}". Only ToDo and Ready for Dispatch stages can be edited.`
      );
    }

    const updateTx = this.db.transaction(() => {
      if (input.title !== undefined) {
        this.db
          .prepare("UPDATE requirements SET title = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.title, id);
      }
      if (input.priority !== undefined) {
        this.db
          .prepare("UPDATE requirements SET priority = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.priority, id);
      }
      if (input.status !== undefined) {
        this.db
          .prepare("UPDATE requirements SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.status, id);
      }
      if (input.sprint_id !== undefined) {
        this.db
          .prepare("UPDATE requirements SET sprint_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.sprint_id, id);
      }
      if (input.merge_policy !== undefined) {
        this.db
          .prepare("UPDATE requirements SET merge_policy = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.merge_policy, id);
      }
      if (input.target_branch !== undefined) {
        this.db
          .prepare("UPDATE requirements SET target_branch = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.target_branch ? input.target_branch.trim() : null, id);
      }
      if (input.attachments !== undefined) {
        this.db
          .prepare("UPDATE requirements SET attachments = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(input.attachments), id);
      }
      if (input.affected_projects && input.affected_projects.length > 0) {
        this.db.prepare('DELETE FROM requirement_projects WHERE req_id = ?').run(id);
        const insertProj = this.db.prepare(
          'INSERT INTO requirement_projects (req_id, project) VALUES (?, ?)'
        );
        for (const proj of input.affected_projects) {
          insertProj.run(id, proj);
        }
        this.db
          .prepare("UPDATE requirements SET updated_at = datetime('now') WHERE id = ?")
          .run(id);
      }

      // Handle body_md update
      let newBodyMd = input.body_md;
      if (newBodyMd === undefined && (input.goal !== undefined || input.user_story !== undefined || input.acceptance_criteria !== undefined || input.api_hints !== undefined || input.notes !== undefined)) {
        // Re-render markdown using updated or existing fields
        const currentParsed = parseRequirementMarkdown(existing.body_md);
        const renderInput: CreateRequirementInput = {
          workspace_id: existing.workspace_id || 'default',
          title: input.title ?? existing.title,
          goal: input.goal ?? currentParsed.goal ?? existing.title,
          user_story: input.user_story ?? currentParsed.userStory,
          acceptance_criteria: input.acceptance_criteria ?? currentParsed.acceptanceCriteria,
          affected_projects: input.affected_projects ?? existing.affected_projects,
          priority: input.priority ?? existing.priority,
          status: input.status ?? existing.status,
          sprint_id: input.sprint_id !== undefined ? input.sprint_id : existing.sprint_id,
          merge_policy: input.merge_policy !== undefined ? input.merge_policy : existing.merge_policy,
          target_branch: input.target_branch !== undefined ? input.target_branch : existing.target_branch,
          attachments: input.attachments ?? existing.attachments ?? [],
          api_hints: input.api_hints ?? currentParsed.apiHints,
          notes: input.notes ?? currentParsed.notes,
        };
        newBodyMd = this.renderMarkdown(id, renderInput, renderInput.status, existing.revision + 1);
        this.db
          .prepare("UPDATE requirements SET revision = revision + 1 WHERE id = ?")
          .run(id);
      }

      if (newBodyMd !== undefined) {
        this.db
          .prepare("UPDATE requirements SET body_md = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newBodyMd, id);

        const writeDiskCopy = (dirPath: string) => {
          try {
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
            const filePath = path.join(dirPath, `${id}.md`);
            fs.writeFileSync(filePath, newBodyMd!, 'utf-8');
          } catch {}
        };
        writeDiskCopy(path.join(this.workspaceDir, 'requirements'));
        writeDiskCopy(path.join(this.workspaceDir, '.bridge', 'requirements'));
      }
    });
    updateTx();

    return this.getRequirement(id)!;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/server/src/services/requirementService.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/requirementService.ts packages/server/src/services/requirementService.test.ts
git commit -m "feat(server): support structured updates and markdown sync in updateRequirement"
```

---

### Task 4: Context Expansion for Edit Mode in `@sp-kickstack/web`

**Files:**
- Modify: `packages/web/src/lib/CreateRequirementContext.tsx`
- Create: `packages/web/src/lib/CreateRequirementContext.test.tsx`

**Interfaces:**
- Exposes:
  - `isOpen: boolean`
  - `editingRequirement: Requirement | null`
  - `openSheet: (req?: Requirement | null) => void`
  - `openCreate: () => void`
  - `openEdit: (req: Requirement) => void`
  - `closeSheet: () => void`

- [ ] **Step 1: Write test for `CreateRequirementContext`**

Create `packages/web/src/lib/CreateRequirementContext.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { CreateRequirementProvider, useCreateRequirement } from './CreateRequirementContext.js';
import type { Requirement } from '@sp-kickstack/shared';

describe('CreateRequirementContext', () => {
  it('opens in create mode and edit mode', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CreateRequirementProvider>{children}</CreateRequirementProvider>
    );

    const { result } = renderHook(() => useCreateRequirement(), { wrapper });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.editingRequirement).toBeNull();

    act(() => {
      result.current.openCreate();
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.editingRequirement).toBeNull();

    const mockReq = { id: 'REQ-001', title: 'Test Req' } as Requirement;
    act(() => {
      result.current.openEdit(mockReq);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.editingRequirement?.id).toBe('REQ-001');

    act(() => {
      result.current.closeSheet();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.editingRequirement).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/web/src/lib/CreateRequirementContext.test.tsx
```
Expected: FAIL due to missing `editingRequirement` or `openEdit`.

- [ ] **Step 3: Update `CreateRequirementContext.tsx`**

In `packages/web/src/lib/CreateRequirementContext.tsx`:
```tsx
import { createContext, useContext, useState, ReactNode } from 'react';
import type { Requirement } from '@sp-kickstack/shared';

interface CreateRequirementContextType {
  isOpen: boolean;
  editingRequirement: Requirement | null;
  openSheet: (req?: Requirement | null) => void;
  openCreate: () => void;
  openEdit: (req: Requirement) => void;
  closeSheet: () => void;
}

const CreateRequirementContext = createContext<CreateRequirementContextType | undefined>(undefined);

export function CreateRequirementProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<Requirement | null>(null);

  const openSheet = (req?: Requirement | null) => {
    setEditingRequirement(req ?? null);
    setIsOpen(true);
  };

  const openCreate = () => {
    setEditingRequirement(null);
    setIsOpen(true);
  };

  const openEdit = (req: Requirement) => {
    setEditingRequirement(req);
    setIsOpen(true);
  };

  const closeSheet = () => {
    setIsOpen(false);
    setEditingRequirement(null);
  };

  return (
    <CreateRequirementContext.Provider
      value={{ isOpen, editingRequirement, openSheet, openCreate, openEdit, closeSheet }}
    >
      {children}
    </CreateRequirementContext.Provider>
  );
}

export function useCreateRequirement() {
  const context = useContext(CreateRequirementContext);
  if (!context) {
    throw new Error('useCreateRequirement must be used within a CreateRequirementProvider');
  }
  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run packages/web/src/lib/CreateRequirementContext.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/CreateRequirementContext.tsx packages/web/src/lib/CreateRequirementContext.test.tsx
git commit -m "feat(web): add editingRequirement and openEdit to CreateRequirementContext"
```

---

### Task 5: Dual-Mode `CreateRequirementSheet` (Create & Edit)

**Files:**
- Modify: `packages/web/src/components/CreateRequirementSheet.tsx`

**Interfaces:**
- Consumes: `editingRequirement` from `useCreateRequirement()`
- Uses: `parseRequirementMarkdown` from `@sp-kickstack/shared`
- Calls: `updateRequirement(id, ...)` when editing, `createRequirement(...)` when creating

- [ ] **Step 1: Implement form population and submission for Edit Mode**

In `packages/web/src/components/CreateRequirementSheet.tsx`:
1. Import `parseRequirementMarkdown` from `@sp-kickstack/shared` and `updateRequirement` from `../lib/api.js`.
2. Extract `{ isOpen, closeSheet, editingRequirement } = useCreateRequirement()`.
3. Compute `isEditMode = Boolean(editingRequirement)`.
4. Add `useEffect` to initialize / pre-fill form fields when `editingRequirement` is provided:
   ```tsx
   useEffect(() => {
     if (isOpen && editingRequirement) {
       setTitle(editingRequirement.title || '');
       setPriority(editingRequirement.priority || 'normal');
       setStatus(editingRequirement.status || 'draft');
       setSprintId(editingRequirement.sprint_id ?? null);
       setMergePolicy(editingRequirement.merge_policy || 'inherit');
       setSelectedProjects(editingRequirement.affected_projects || []);
       setTargetBranch(editingRequirement.target_branch || '');
       setAttachments(editingRequirement.attachments || []);

       const parsed = parseRequirementMarkdown(editingRequirement.body_md || '');
       setGoal(parsed.goal || '');
       setUserStory(parsed.userStory || '');
       setCriteria(parsed.acceptanceCriteria.length > 0 ? parsed.acceptanceCriteria : ['']);
     } else if (isOpen && !editingRequirement) {
       // Reset for fresh create
       setTitle('');
       setGoal('');
       setUserStory('');
       setPriority('normal');
       setStatus('draft');
       setSprintId(null);
       setMergePolicy('inherit');
       setSelectedProjects([]);
       setTargetBranch(defaultTargetBranch);
       setCriteria(['']);
       setAttachments([]);
     }
   }, [isOpen, editingRequirement]);
   ```
5. Update `handleSubmit`:
   ```tsx
   if (isEditMode && editingRequirement) {
     const updated = await updateRequirement(editingRequirement.id, {
       title: trimmedTitle,
       goal: effectiveGoal,
       user_story: userStory || undefined,
       acceptance_criteria: filteredCriteria,
       priority,
       status: andStart ? 'ready' : status,
       sprint_id: sprintId,
       merge_policy: mergePolicy !== 'inherit' ? mergePolicy : null,
       target_branch: createTargetBranch(targetBranch, Boolean(settingsData)),
       affected_projects: selectedProjects,
       attachments,
     });
     queryClient.invalidateQueries({ queryKey: ['requirement', editingRequirement.id] });
     queryClient.invalidateQueries({ queryKey: ['requirements'] });
     handleClose();
     toast.success(`Updated ${updated.id}: ${updated.title}`);
     if (andStart) {
       await startRequirementFanOut(updated.id);
       queryClient.invalidateQueries({ queryKey: ['requirements'] });
       toast.success(`Fanned out to ${selectedProjects.join(', ')}`);
     }
     return;
   }
   ```
6. Update Header title & badge:
   - When `isEditMode`: show "Edit Requirement", ID badge `editingRequirement.id`, and subtitle "Edit specification, repositories & attachments".
   - Submit buttons: "Save Changes" vs "Save & Fan-Out" in edit mode.

- [ ] **Step 2: Verify typechecking and build**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npm run typecheck
```
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/CreateRequirementSheet.tsx
git commit -m "feat(web): enable dual-mode Create and Edit in CreateRequirementSheet"
```

---

### Task 6: Add Edit Triggers to UI Surfaces

**Files:**
- Modify: `packages/web/src/components/RequirementDetailSheet.tsx`
- Modify: `packages/web/src/pages/RequirementDetailPage.tsx`
- Modify: `packages/web/src/pages/RequirementsPage.tsx`

**Interfaces:**
- Connects: `const { openEdit } = useCreateRequirement();` to user-facing Edit buttons.

- [ ] **Step 1: Add Edit button to `RequirementDetailSheet.tsx`**

In `packages/web/src/components/RequirementDetailSheet.tsx`:
1. Import `useCreateRequirement` from `../lib/CreateRequirementContext.js`.
2. Connect `const { openEdit } = useCreateRequirement();`.
3. In header action buttons: replace the narrow `Edit Spec` button with an `Edit Requirement` button that calls `openEdit(req)`:
```tsx
<button
  type="button"
  onClick={() => openEdit(req)}
  className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#242424] hover:bg-purple-50 dark:hover:bg-[#2e263d] text-purple-600 dark:text-purple-400 rounded-lg text-xs font-bold border border-purple-200 dark:border-purple-900/60 transition-colors cursor-pointer shadow-2xs"
  title="Edit requirement form"
>
  <Edit3 className="w-3.5 h-3.5" />
  <span>Edit Requirement</span>
</button>
```

- [ ] **Step 2: Add Edit button to `RequirementDetailPage.tsx`**

In `packages/web/src/pages/RequirementDetailPage.tsx`:
1. Import `useCreateRequirement` from `../lib/CreateRequirementContext.js`.
2. Connect `const { openEdit } = useCreateRequirement();`.
3. In the page action bar (next to "Edit Repos" / "Start Fan-Out"):
```tsx
<button
  type="button"
  onClick={() => openEdit(req)}
  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 text-xs font-bold transition-all shadow-xs cursor-pointer"
  title="Edit requirement form"
>
  <Edit3 className="w-3.5 h-3.5" />
  <span>Edit Requirement</span>
</button>
```

- [ ] **Step 3: Add Edit button to `RequirementsPage.tsx`**

In `packages/web/src/pages/RequirementsPage.tsx`:
1. Connect `openEdit` from `useCreateRequirement()`.
2. On table rows and card action menus, add an `Edit` action calling `openEdit(req)`:
```tsx
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    openEdit(req);
  }}
  className="p-1 rounded text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
  title={`Edit ${req.id}`}
>
  <Edit3 className="w-3.5 h-3.5" />
</button>
```

- [ ] **Step 4: Verify typecheck and tests**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npm run verify
```
Expected: All typechecks pass, all vitest tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RequirementDetailSheet.tsx packages/web/src/pages/RequirementDetailPage.tsx packages/web/src/pages/RequirementsPage.tsx
git commit -m "feat(web): connect Edit Requirement triggers across sheets, pages, and lists"
```

---

### Task 7: Full Verification, Desktop & Settings Governance & Clean Build

**Files:**
- Check: `packages/shared`, `packages/server`, `packages/web`, `packages/desktop`

- [ ] **Step 1: Run full verification suite**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npm run verify
```
Expected: PASS with 0 lint errors, 0 type errors, all tests passing.

- [ ] **Step 2: Run full build across all workspaces**

Run:
```bash
PATH="/Users/sopheak/.nvm/versions/node/v22.19.0/bin:$PATH" npm run build
```
Expected: Successful build of `@sp-kickstack/shared`, `@sp-kickstack/server`, `@sp-kickstack/web`, `@sp-kickstack/xticket`.

- [ ] **Step 3: Update graft graph**

Run:
```bash
graft build
```
Expected: Updated graph with new nodes and symbols.

- [ ] **Step 4: Final commit**

```bash
git commit -am "chore: update graft index and complete requirement edit form parity"
```
