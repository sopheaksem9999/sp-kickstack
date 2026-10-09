import { z } from 'zod';

export const NormStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'needs_human',
  'held',
  'in_review',
  'qa',
  'done',
  'failed',
  'cancelled',
]);

export const RequirementStatusSchema = z.enum([
  'draft',
  'ready',
  'in_progress',
  'qa',
  'in_review',
  'done',
  'cancelled',
]);

export const PrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const EngineTypeSchema = z.enum(['stoneforge', 'clinekanban', 'manual']);

export const DoneMeansSchema = z.enum(['merged', 'pr_opened']);

export const TaskRoleSchema = z.enum(['goal', 'ticket', 'waiting']);

export const LinkStateSchema = z.enum([
  'waiting',
  'ready',
  'released',
  'error',
  'cancelled',
]);

export const TicketTypeSchema = z.enum(['api_request', 'bug', 'question']);

export const EventTypeSchema = z.enum([
  'plan_ready',
  'task_blocked',
  'task_unblocked',
  'ticket_created',
  'ready_for_review',
  'merge_ready',
  'task_failed',
  'engine_down',
  'engine_up',
  'requirement_done',
  'limit_hit',
  'task_status_changed',
]);

export const BranchMergePolicySchema = z.enum([
  'manual_review_merge',
  'auto_merge_main',
]);

export const BranchMergeSettingsSchema = z.object({
  default_base_branch: z.string().default('develop'),
  merge_policy: BranchMergePolicySchema.default('manual_review_merge'),
  auto_delete_branch: z.boolean().default(false),
});

export const AttachmentItemSchema = z.object({
  name: z.string().min(1),
  size: z.number().optional(),
  type: z.string().optional(),
  data_url: z.string().optional(),
});

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  rules: z.string().optional().default(''),
  context: z.string().optional().default(''),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const CreateWorkspaceInputSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Workspace ID must be alphanumeric, hyphen, or underscore'),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  rules: z.string().optional().default(''),
  context: z.string().optional().default(''),
});

export const UpdateWorkspaceInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  rules: z.string().optional(),
  context: z.string().optional(),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  workspace_id: z.string().default('default'),
  kind: z.enum(['backend', 'frontend', 'mobile', 'other']).default('other'),
  repo_path: z.string().min(1),
  engine_type: EngineTypeSchema,
  engine_url: z.string().url().optional().or(z.literal('')),
  engine_meta: z.record(z.unknown()).default({}),
  base_branch: z.string().default('develop'),
  contract_path: z.string().optional(),
  done_means: DoneMeansSchema.default('merged'),
  high_risk_paths: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  engine_status: z.enum(['ok', 'down', 'unknown']).default('unknown'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const CreateRequirementInputSchema = z.object({
  workspace_id: z.string().default('default'),
  title: z.string().min(1).max(200),
  goal: z.string().min(1),
  user_story: z.string().optional(),
  acceptance_criteria: z.array(z.string()).optional().default([]),
  affected_projects: z.array(z.string().min(1)).min(1),
  priority: PrioritySchema.default('normal'),
  status: RequirementStatusSchema.optional().default('draft'),
  merge_policy: BranchMergePolicySchema.optional(),
  sprint_id: z.string().nullable().optional(),
  attachments: z.array(AttachmentItemSchema).optional().default([]),
  api_hints: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateRequirementProjectsInputSchema = z.object({
  affected_projects: z.array(z.string().min(1)).min(1),
});

export const UpdateRequirementMergePolicyInputSchema = z.object({
  merge_policy: BranchMergePolicySchema.nullable().optional(),
});

export const SprintStatusSchema = z.enum(['planned', 'active', 'completed']);

export const SprintSchema = z.object({
  id: z.string(),
  workspace_id: z.string().default('default'),
  name: z.string().min(1),
  goal: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  status: SprintStatusSchema.default('planned'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const CreateSprintInputSchema = z.object({
  workspace_id: z.string().default('default'),
  name: z.string().min(1),
  goal: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const UpdateSprintInputSchema = z.object({
  name: z.string().min(1).optional(),
  goal: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const AssignRequirementSprintInputSchema = z.object({
  sprint_id: z.string().nullable(),
});

export const SharedAssetSchema = z.object({
  id: z.string(),
  workspace_id: z.string().default('default'),
  name: z.string().min(1),
  type: z.string(),
  size: z.number(),
  data_url: z.string(),
  notes: z.string().optional(),
  created_at: z.string().optional(),
});

export const CreateSharedAssetInputSchema = z.object({
  workspace_id: z.string().default('default'),
  name: z.string().min(1),
  type: z.string().default('application/octet-stream'),
  size: z.number().default(0),
  data_url: z.string().min(1),
  notes: z.string().optional(),
});

export const CreateTicketInputSchema = z.object({
  to: z.string().min(1),
  type: TicketTypeSchema.default('api_request'),
  title: z.string().min(3).max(250),
  body: z.string().min(5).max(20480), // 20 KB limit as per FR-TKT-02
  blocking: z.boolean().default(false),
});

export const TicketResponseSchema = z.object({
  ticketId: z.number(),
  target: z.string(),
  blocking: z.boolean(),
  status: z.string(),
});

export type CreateWorkspaceInput = z.input<typeof CreateWorkspaceInputSchema>;
export type UpdateWorkspaceInput = z.input<typeof UpdateWorkspaceInputSchema>;
export type CreateRequirementInput = z.input<typeof CreateRequirementInputSchema>;
export type UpdateRequirementProjectsInput = z.input<typeof UpdateRequirementProjectsInputSchema>;
export type UpdateRequirementMergePolicyInput = z.input<typeof UpdateRequirementMergePolicyInputSchema>;
export type CreateSprintInput = z.input<typeof CreateSprintInputSchema>;
export type UpdateSprintInput = z.input<typeof UpdateSprintInputSchema>;
export type AssignRequirementSprintInput = z.input<typeof AssignRequirementSprintInputSchema>;
export type SprintItem = z.infer<typeof SprintSchema>;
export type CreateSharedAssetInput = z.input<typeof CreateSharedAssetInputSchema>;
export type SharedAssetItem = z.infer<typeof SharedAssetSchema>;
export type CreateTicketInput = z.input<typeof CreateTicketInputSchema>;
export type TicketResponse = z.infer<typeof TicketResponseSchema>;
