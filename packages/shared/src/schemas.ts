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
  'rate_limited',
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

export const TaskRoleSchema = z.enum(['goal', 'ticket', 'waiting', 'question']);

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

/** 'auto_merge_main' is the pre-merge-gate name of 'auto_merge'; still accepted on input. */
const LEGACY_MERGE_POLICY: Record<string, string> = { auto_merge_main: 'auto_merge' };

export const BranchMergePolicySchema = z.preprocess(
  (value) => (typeof value === 'string' && LEGACY_MERGE_POLICY[value]) || value,
  z.enum(['manual_review_merge', 'auto_merge'])
);

/** Effective policy from any stored value (legacy names, null, unknown -> review first). */
export function normalizeMergePolicy(value: unknown): 'manual_review_merge' | 'auto_merge' {
  const parsed = BranchMergePolicySchema.safeParse(value);
  return parsed.success ? parsed.data : 'manual_review_merge';
}

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
  engine_url: z.string().url().optional().nullable().or(z.literal('')),
  engine_meta: z.record(z.unknown()).default({}),
  base_branch: z.string().default('develop'),
  contract_path: z.string().optional().nullable(),
  /** Shell command run in a fresh worktree of the merge result before the base branch advances. */
  test_command: z.string().max(2000).optional().nullable(),
  done_means: DoneMeansSchema.default('merged'),
  high_risk_paths: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  engine_status: z.enum(['ok', 'down', 'unknown']).default('unknown'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const CreateRequirementInputSchema = z.object({
  workspace_id: z.string().default('default'),
  session_id: z.string().nullable().optional(),
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

export const UpdateRequirementInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  goal: z.string().optional(),
  body_md: z.string().optional(),
  priority: PrioritySchema.optional(),
  affected_projects: z.array(z.string().min(1)).optional(),
  sprint_id: z.string().nullable().optional(),
  merge_policy: BranchMergePolicySchema.nullable().optional(),
});

export type UpdateRequirementInput = z.input<typeof UpdateRequirementInputSchema>;

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
  // Requirement to attribute the ticket to when it has no resolvable source task (UI/manual tickets).
  req_id: z.string().min(1).optional(),
});

export const TicketResponseSchema = z.object({
  ticketId: z.number(),
  target: z.string(),
  blocking: z.boolean(),
  status: z.string(),
});

// An agent asks a person; its task pauses until the answer arrives.
export const AskQuestionInputSchema = z
  .object({
    question: z.string().trim().min(3).max(500),
    options: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
    body: z.string().max(20480).default(''),
  })
  .refine((v) => new Set(v.options.map((o) => o.toLowerCase())).size === v.options.length, {
    message: 'Options must be different from each other',
    path: ['options'],
  });

export const AnswerQuestionInputSchema = z
  .object({
    option: z.string().trim().min(1).max(120).optional(),
    answer: z.string().trim().max(4000).default(''),
  })
  .refine((v) => Boolean(v.option) || v.answer.length > 0, {
    message: 'Pick an option or write an answer',
    path: ['answer'],
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
export type AskQuestionInput = z.input<typeof AskQuestionInputSchema>;
export type AnswerQuestionInput = z.input<typeof AnswerQuestionInputSchema>;

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

export const SingleCliConfigSchema = z.object({
  enabled: z.boolean().default(true),
  model: z.string().default(''),
  effort: ReasoningEffortSchema.default('medium'),
  customPath: z.string().optional(),
  ultracode: z.boolean().optional().default(false),
});

export const AiCliSettingsSchema = z.object({
  defaultProvider: z
    .enum(['auto', 'claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic'])
    .default('auto'),
  claude: SingleCliConfigSchema.default({
    enabled: true,
    model: 'claude-3-7-sonnet',
    effort: 'medium',
  }),
  agy: SingleCliConfigSchema.default({
    enabled: true,
    model: 'gemini-3.8-flash',
    effort: 'medium',
  }),
  codex: SingleCliConfigSchema.default({
    enabled: true,
    model: 'default',
    effort: 'medium',
  }),
  ollama: SingleCliConfigSchema.extend({
    url: z.string().default('http://127.0.0.1:11434'),
  }).default({
    enabled: true,
    model: 'llama3.2',
    effort: 'medium',
    url: 'http://127.0.0.1:11434',
  }),
});

export type UpdateAiCliSettingsInput = z.input<typeof AiCliSettingsSchema>;

export const DraftRequirementResultSchema = z.object({
  title: z.string(),
  goal: z.string(),
  user_story: z.string().default(''),
  acceptance_criteria: z.array(z.string()).default([]),
  affected_projects: z.array(z.string()).default([]),
  api_hints: z.string().optional(),
  notes: z.string().optional(),
  provider_used: z.string().default('local-ai'),
});

export const ChatAttachmentItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.string().optional(),
  size: z.number().optional(),
  data_url: z.string().optional(),
  asset_id: z.string().optional(),
});

export const AiChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string(),
  suggested_spec: DraftRequirementResultSchema.optional(),
  attachments: z.array(ChatAttachmentItemSchema).optional(),
});

export const AiChatRequestSchema = z.object({
  messages: z.array(AiChatMessageSchema),
  provider: z.enum(['auto', 'claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic']).optional(),
  model: z.string().optional(),
  effort: ReasoningEffortSchema.optional(),
  workspace_id: z.string().optional(),
  context_project: z.string().optional(),
});

export type DraftRequirementResultItem = z.infer<typeof DraftRequirementResultSchema>;
export type AiChatMessageItem = z.infer<typeof AiChatMessageSchema>;
export type AiChatRequestItem = z.infer<typeof AiChatRequestSchema>;

export const AiChatSessionSchema = z.object({
  id: z.string(),
  workspace_id: z.string().default('default'),
  title: z.string(),
  provider: z.enum(['auto', 'claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic']).default('auto'),
  model: z.string().optional(),
  effort: ReasoningEffortSchema.default('medium'),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(AiChatMessageSchema).optional(),
});

export const CreateAiChatSessionInputSchema = z.object({
  workspace_id: z.string().default('default'),
  title: z.string().optional(),
  provider: z.enum(['auto', 'claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic']).optional(),
  model: z.string().optional(),
  effort: ReasoningEffortSchema.optional(),
});

export const UpdateAiChatSessionInputSchema = z.object({
  title: z.string().optional(),
  provider: z.enum(['auto', 'claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic']).optional(),
  model: z.string().optional(),
  effort: ReasoningEffortSchema.optional(),
});

export const SendAiChatMessageInputSchema = z.object({
  content: z.string().min(1, 'Message cannot be empty'),
  provider: z.enum(['auto', 'claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic']).optional(),
  model: z.string().optional(),
  effort: ReasoningEffortSchema.optional(),
  attachments: z.array(ChatAttachmentItemSchema).optional(),
});

export type CreateAiChatSessionInput = z.infer<typeof CreateAiChatSessionInputSchema>;
export type UpdateAiChatSessionInput = z.infer<typeof UpdateAiChatSessionInputSchema>;
export type SendAiChatMessageInput = z.infer<typeof SendAiChatMessageInputSchema>;

export const IdeSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  binaryPath: z.string().optional(),
  port: z.number().int().positive().default(8443),
  host: z.string().default('127.0.0.1'),
  externalUrl: z.string().optional(),
  autoStart: z.boolean().default(false),
});

export const IdeServerStatusSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  binaryPath: z.string().optional(),
  port: z.number(),
  host: z.string(),
  url: z.string().optional(),
  pid: z.number().optional(),
  error: z.string().optional(),
});

export const StartIdeInputSchema = z.object({
  project_name: z.string().optional(),
  folder_path: z.string().optional(),
  port: z.number().int().positive().optional(),
});


