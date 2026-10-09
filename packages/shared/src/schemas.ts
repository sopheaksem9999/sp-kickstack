import { z } from 'zod';

export const NormStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'needs_human',
  'held',
  'in_review',
  'done',
  'failed',
  'cancelled',
]);

export const RequirementStatusSchema = z.enum([
  'draft',
  'ready',
  'in_progress',
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

export const ProjectSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['backend', 'frontend', 'mobile', 'other']).default('other'),
  repo_path: z.string().min(1),
  engine_type: EngineTypeSchema,
  engine_url: z.string().url().optional().or(z.literal('')),
  engine_meta: z.record(z.unknown()).default({}),
  base_branch: z.string().default('main'),
  contract_path: z.string().optional(),
  done_means: DoneMeansSchema.default('merged'),
  high_risk_paths: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  engine_status: z.enum(['ok', 'down', 'unknown']).default('unknown'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const CreateRequirementInputSchema = z.object({
  title: z.string().min(3).max(200),
  goal: z.string().min(5),
  user_story: z.string().optional(),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  affected_projects: z.array(z.string().min(1)).min(1),
  priority: PrioritySchema.default('normal'),
  api_hints: z.string().optional(),
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

export type CreateRequirementInput = z.input<typeof CreateRequirementInputSchema>;
export type CreateTicketInput = z.input<typeof CreateTicketInputSchema>;
export type TicketResponse = z.infer<typeof TicketResponseSchema>;
