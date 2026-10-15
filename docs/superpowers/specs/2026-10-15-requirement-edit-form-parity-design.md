# Requirement Edit Form Parity — Design

**Status:** Design approved by user in chat ("can implement"), 2026-10-15.

---

## 1. Problem & Context

Currently in SP-Kickstack:
- **Creating a Requirement** (`CreateRequirementSheet.tsx`) offers a rich, multi-section form:
  - Header with Title input
  - State (Draft/ToDo, In-Progress, QA, Done)
  - Priority (Urgent, High, Normal, Low)
  - Sprint selector (assign to sprint or Product Backlog)
  - Merge Policy (inherit, manual review, auto-merge)
  - Affected Repositories / Engines (interactive multi-select popover with chips)
  - Target Branch picker (`BranchPicker.tsx` listing repository branches)
  - Goal & Problem Context (rich text editor with Write/Preview tabs, markdown toolbar, and templates)
  - User Story ("As a... I want... So that...")
  - Acceptance Criteria (interactive dynamic checklist with Add, Edit, Delete items)
  - Attachments (drag-and-drop file upload, file sizes, type icons, removal)
  - AI Co-Architect Assistant (Draft with AI / chat assistance)

- **Editing an Existing Requirement**:
  - `RequirementDetailSheet.tsx` only offers an "Edit Spec" toggle with a basic title input and a raw markdown textarea for `req.body_md`. Users cannot visually modify Acceptance Criteria checklist items, user stories, target branch, attachments, priority, or affected repositories in this view.
  - `RequirementDetailPage.tsx` has no edit form at all, only an "Edit Repos" button.
  - Backend schema `UpdateRequirementInputSchema` only permits a few fields (`title`, `goal`, `body_md`, `priority`, `affected_projects`, `sprint_id`, `merge_policy`), completely missing `user_story`, `acceptance_criteria`, `target_branch`, `attachments`, `api_hints`, and `notes`.
  - Backend service `RequirementService.updateRequirement` does not update `target_branch` or `attachments`, nor does it re-render the requirement's markdown specification when structured fields are edited.

---

## 2. Goals & Key Decisions

1. **Full Form Parity via Unified Slide-Over Sheet:**
   Transform `CreateRequirementSheet.tsx` into a dual-mode `RequirementFormSheet` (Create & Edit) so users get the identical high-fidelity form experience whether creating a new requirement or editing an existing one.

2. **Bidirectional Markdown Parsing & Rendering:**
   - In `@sp-kickstack/shared`, provide `parseRequirementMarkdown(bodyMd: string)` to deconstruct `body_md` into `goal`, `userStory`, `acceptanceCriteria` (array of strings), `apiHints`, and `notes`.
   - On save/update, re-render `body_md` using `renderMarkdown()` so the markdown file on disk (`.bridge/requirements/${id}.md` / `requirements/${id}.md`) stays in exact sync with the database and UI state.

3. **Backend Schema & Service Parity:**
   - Update `UpdateRequirementInputSchema` in `packages/shared/src/schemas.ts` to accept all structured fields: `title`, `goal`, `user_story`, `acceptance_criteria`, `priority`, `status`, `affected_projects`, `target_branch`, `sprint_id`, `merge_policy`, `attachments`, `api_hints`, `notes`, and optional `body_md`.
   - Update `RequirementService.updateRequirement` to persist `target_branch`, `attachments`, and update `body_md` and `requirement_projects` atomically in a single transaction.

4. **Multi-Surface Access to Edit:**
   - **`RequirementDetailSheet.tsx`**: Replace the simplistic "Edit Spec" raw toggle with an "Edit Requirement" action button opening the unified sheet.
   - **`RequirementDetailPage.tsx`**: Add an "Edit Requirement" button to the header actions bar next to "Start Fan-Out" and "Edit Repos".
   - **`RequirementsPage.tsx`**: Add quick "Edit" triggers to requirement table rows and board cards.

---

## 3. Detailed Component & Service Design

### A. Shared Library (`packages/shared`)

#### 1. Markdown Parser (`packages/shared/src/requirementMarkdown.ts`)
```ts
export interface ParsedRequirementMarkdown {
  goal: string;
  userStory?: string;
  acceptanceCriteria: string[];
  apiHints?: string;
  notes?: string;
}

export function parseRequirementMarkdown(bodyMd: string): ParsedRequirementMarkdown {
  // Strip YAML frontmatter if present
  const content = bodyMd.replace(/^---\s*[\s\S]*?---\s*/, '').trim();
  
  // Extract sections by ## Header
  // ## Goal
  // ## User story
  // ## Acceptance criteria (- [ ] item, - [x] item)
  // ## API hints
  // ## Specification & Architectural Details
  ...
}
```

#### 2. Schemas (`packages/shared/src/schemas.ts`)
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

### B. Backend Server (`packages/server`)

#### 1. `RequirementService.updateRequirement`
- Update columns:
  - `title`
  - `priority`
  - `status`
  - `sprint_id`
  - `merge_policy`
  - `target_branch`
  - `attachments` (JSON stringified)
  - `body_md` (re-rendered using `renderMarkdown` if structured fields provided, or direct `body_md`)
- Update `requirement_projects` table if `affected_projects` provided.
- Write updated markdown file atomically to `.bridge/requirements/${id}.md` and `requirements/${id}.md`.
- Broadcast `requirement_updated` SSE event via `deps.broadcaster.broadcast`.

### C. Web Frontend (`packages/web`)

#### 1. Context (`packages/web/src/lib/CreateRequirementContext.tsx`)
Extend context interface:
```ts
interface CreateRequirementContextType {
  isOpen: boolean;
  editingRequirement: Requirement | null;
  openSheet: (req?: Requirement | null) => void;
  openCreate: () => void;
  openEdit: (req: Requirement) => void;
  closeSheet: () => void;
}
```

#### 2. Unified Sheet (`CreateRequirementSheet.tsx`)
- Detect mode: `isEditMode = Boolean(editingRequirement)`.
- When `editingRequirement` changes or sheet opens:
  - In Edit mode: Populate state from `editingRequirement`:
    - Title: `editingRequirement.title`
    - Priority: `editingRequirement.priority`
    - Status: `editingRequirement.status`
    - Sprint: `editingRequirement.sprint_id`
    - Merge Policy: `editingRequirement.merge_policy || 'inherit'`
    - Selected Projects: `editingRequirement.affected_projects`
    - Target Branch: `editingRequirement.target_branch || ''`
    - Attachments: `editingRequirement.attachments || []`
    - Deconstruct `editingRequirement.body_md` via `parseRequirementMarkdown`:
      - `goal`
      - `userStory`
      - `criteria` (acceptance criteria array)
      - `notes` / `apiHints`
  - Header displays: `Edit Requirement: REQ-001` vs `New Cross-Repo Requirement`.
  - Save buttons:
    - Edit mode: "Save Changes" (calls `updateRequirement(id, ...)`) and optionally "Save & Start Fan-Out".
    - Create mode: "Save State" / "Create & Fan-Out" (calls `createRequirement(...)`).

#### 3. Integration into Pages
- `RequirementDetailSheet.tsx`:
  - Click "Edit Requirement" -> opens unified sheet in edit mode.
- `RequirementDetailPage.tsx`:
  - Add "Edit Requirement" button next to "Edit Repos" -> opens unified sheet in edit mode.
- `RequirementsPage.tsx`:
  - Add "Edit" button to requirement cards and rows -> opens unified sheet in edit mode.

---

## 4. Testing Strategy

1. **Unit Tests:**
   - `parseRequirementMarkdown`: Test parsing standard rendered markdown back into structured fields (`goal`, `userStory`, `acceptanceCriteria`, `apiHints`, `notes`), as well as unstructured/legacy markdown.
   - `UpdateRequirementInputSchema`: Validate parsing of structured edit inputs.
   - `RequirementService.updateRequirement`: Test updating title, target_branch, attachments, criteria, affected projects, and file sync on disk.

2. **Integration / UI Verification:**
   - Test creating a requirement with rich fields.
   - Open that requirement in Edit mode: verify all fields (Title, Priority, Sprint, Merge Policy, Target Branch, Repositories, Goal, User Story, Criteria, Attachments) match exactly.
   - Modify fields, save, and verify instant updates across the detail sheet, detail page, and disk markdown file.
