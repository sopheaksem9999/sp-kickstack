import { z } from 'zod';
import { DEFAULT_TASK_BRANCH_PATTERN, branchNameProblem, taskBranchPatternProblem } from './branchNames.js';

/** A zod refinement from a "why not" check. */
const refineWith = (check: (value: string) => string | null) => (value: string, ctx: z.RefinementCtx) => {
  const problem = check(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
};

/** A requirement's target branch (letters, digits and . _ / -). */
export const TargetBranchSchema = z.string().trim().superRefine(refineWith(branchNameProblem));

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

export const EngineTypeSchema = z.enum(['stoneforge', 'clinekanban', 'manual', 'local']);

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
  /** Task branch names: {req}, {task}, {project}; tickets add -ticket-{task}. */
  task_branch_pattern: z.string().trim().superRefine(refineWith(taskBranchPatternProblem)).default(DEFAULT_TASK_BRANCH_PATTERN),
  /** The bridge pushes new task/target branches and agents' new commits to origin. */
  push_branches: z.boolean().default(true),
  /** New requirements start with this target branch; empty = each repository's base branch. */
  default_target_branch: z
    .string()
    .trim()
    .superRefine(refineWith((name) => (name ? branchNameProblem(name) : null)))
    .default(''),
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

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

/** An agent model id the engine understands, e.g. opus, sonnet, claude-opus-5-5. */
export const AgentModelSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/, 'Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus');

/** Agent model/effort for a workspace, requirement or task: undefined keeps the current value, null clears it. */
export const AgentProfileInputSchema = z.object({
  model: AgentModelSchema.nullable().optional(),
  effort: ReasoningEffortSchema.nullable().optional(),
});

export const UpdateWorkspaceInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  rules: z.string().optional(),
  context: z.string().optional(),
  agent_model: AgentModelSchema.nullable().optional(),
  agent_effort: ReasoningEffortSchema.nullable().optional(),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  workspace_id: z.string().default('default'),
  kind: z.enum(['backend', 'frontend', 'full-stack', 'mobile', 'other']).default('other'),
  repo_path: z.string().min(1),
  engine_type: EngineTypeSchema,
  engine_url: z.string().url().optional().nullable().or(z.literal('')),
  engine_meta: z.record(z.unknown()).default({}),
  base_branch: z.string().default('develop'),
  contract_path: z.string().optional().nullable(),
  /** Shell command run in a fresh worktree of the merge result before the base branch advances. */
  test_command: z.string().max(2000).optional().nullable(),
  /** AI QA: shell commands the QA agent runs in its checkout (optional). */
  build_command: z.string().max(2000).optional().nullable(),
  lint_command: z.string().max(2000).optional().nullable(),
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
  /** Where the tasks start and merge; empty = each repository's base branch. */
  target_branch: TargetBranchSchema.nullable().optional(),
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

/** A file attached to a review comment, sent as a data URL. */
export const ReviewAttachmentUploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().max(200).optional(),
  data_url: z.string().min(1),
});

export const CreateReviewCommentInputSchema = z.object({
  task_id: z.number().int().positive(),
  body: z.string().trim().min(1).max(4000),
  file_path: z.string().trim().min(1).max(300).optional(),
  line: z.number().int().positive().optional(),
  attachments: z.array(ReviewAttachmentUploadSchema).max(20).optional(),
});

/** A reviewer's draft (often a pasted error) for "Improve with AI"; nothing is saved. */
export const ImproveReviewCommentInputSchema = z.object({
  task_id: z.number().int().positive(),
  body: z.string().trim().min(1).max(20000),
  file_path: z.string().trim().min(1).max(300).optional(),
  line: z.number().int().positive().optional(),
  attachments: z.array(ReviewAttachmentUploadSchema).max(20).optional(),
});

export const UpdateReviewCommentInputSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    state: z.enum(['open', 'resolved']).optional(),
  })
  .refine((v) => v.body !== undefined || v.state !== undefined, { message: 'Nothing to update' });

/** Request changes may also pin a model/effort on the re-run tasks (undefined keeps their pin, null clears it). */
export const RequestChangesInputSchema = AgentProfileInputSchema.extend({
  task_ids: z.array(z.number().int().positive()).max(50).optional(),
});

export const SendTaskNoteInputSchema = z.object({
  body: z.string().trim().min(1).max(4000),
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
export type CreateReviewCommentInput = z.input<typeof CreateReviewCommentInputSchema>;
export type UpdateReviewCommentInput = z.input<typeof UpdateReviewCommentInputSchema>;
export type ImproveReviewCommentInput = z.input<typeof ImproveReviewCommentInputSchema>;
export type ReviewAttachmentUpload = z.input<typeof ReviewAttachmentUploadSchema>;
export type RequestChangesInput = z.input<typeof RequestChangesInputSchema>;
export type SendTaskNoteInput = z.input<typeof SendTaskNoteInputSchema>;
export type AgentProfileInput = z.input<typeof AgentProfileInputSchema>;

export const SingleCliConfigSchema = z.object({
  enabled: z.boolean().default(true),
  model: z.string().default(''),
  effort: ReasoningEffortSchema.default('medium'),
  customPath: z.string().optional(),
  ultracode: z.boolean().optional().default(false),
});

export const DecisionEngineIdSchema = z.enum(['clef', 'jev', 'none']);

export const ClefSettingsSchema = z.object({
  clef_enabled: z.boolean().default(true),
  clef_account_id: z.string().trim().default(''),
  clef_api_token: z.string().trim().default(''),
  clef_model: z.string().trim().default('@cf/cloudflare/clef-flash'),
  clef_auto_triage: z.boolean().default(true),
});

export const JevSettingsSchema = z.object({
  jev_enabled: z.boolean().default(true),
  jev_bin_path: z.string().trim().default('jev'),
  jev_model: z.string().trim().default('default'),
  jev_args_template: z.string().trim().default('-p --model {model}'),
});

export const SystemDecisionSettingsSchema = z.object({
  active_engine: DecisionEngineIdSchema.default('clef'),
  clef: ClefSettingsSchema.default({
    clef_enabled: true,
    clef_account_id: '',
    clef_api_token: '',
    clef_model: '@cf/cloudflare/clef-flash',
    clef_auto_triage: true,
  }),
  jev: JevSettingsSchema.default({
    jev_enabled: true,
    jev_bin_path: 'jev',
    jev_model: 'default',
    jev_args_template: '-p --model {model}',
  }),
});

export const UpdateSystemDecisionSettingsInputSchema = SystemDecisionSettingsSchema.partial().strict();

export const AiCliSettingsSchema = z.object({
  defaultProvider: z
    .enum(['claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic', 'auto'])
    .default('claude-cli'),
  enabledEngines: z
    .array(z.enum(['claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic']))
    .optional()
    .default(['claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic']),
  claude: SingleCliConfigSchema.default({
    enabled: true,
    model: 'sonnet',
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
  heuristic: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
});

export type UpdateAiCliSettingsInput = z.input<typeof AiCliSettingsSchema>;

/** AI Chat: MCP servers and skills for the chats, one list for the whole system. */
export const AI_CHAT_SERVER_NAME = /^[A-Za-z0-9_-]{1,40}$/;
export const AI_CHAT_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Chat commands a skill cannot be named after (AI Chat page and browser sidebar). */
export const AI_CHAT_RESERVED_SKILLS = ['create', 'extract', 'summarize', 'inspect', 'clear'];
/** A skill's "when to use", as long as a SKILL.md description may be. */
export const AI_CHAT_SKILL_DESCRIPTION_MAX = 1024;

const AiChatSecretSchema = z.union([z.string(), z.object({ set: z.literal(true) })]);

const AiChatServerStatusSchema = z.object({
  ok: z.boolean(),
  tools: z.number().int().min(0),
  error: z.string().optional(),
  checkedAt: z.string(),
});

const AiChatMcpServerBase = z.object({
  name: z.string().regex(AI_CHAT_SERVER_NAME, 'Server names use letters, digits, - and _ (up to 40)'),
  enabled: z.boolean().default(true),
  transport: z.enum(['stdio', 'http']),
  command: z.string().trim().min(1).optional(),
  args: z.array(z.string()).default([]),
  url: z.string().trim().optional(),
});

function checkServer(server: { transport: 'stdio' | 'http'; command?: string; url?: string }, ctx: z.RefinementCtx) {
  if (server.transport === 'stdio' && !server.command) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: 'A stdio server needs a command' });
  }
  if (server.transport === 'http' && !/^https?:\/\/\S+$/.test(server.url ?? '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'An http server needs a URL starting with http:// or https://' });
  }
}

export const AiChatMcpServerSchema = AiChatMcpServerBase.extend({
  env: z.record(z.string()).default({}),
  headers: z.record(z.string()).default({}),
  status: AiChatServerStatusSchema.optional(),
}).superRefine(checkServer);

const AiChatMcpServerUpdateSchema = AiChatMcpServerBase.extend({
  env: z.record(AiChatSecretSchema).default({}),
  headers: z.record(AiChatSecretSchema).default({}),
}).superRefine(checkServer);

export const AiChatSkillSchema = z.object({
  name: z
    .string()
    .regex(AI_CHAT_SKILL_NAME, 'Skill names use lowercase letters, digits and - (up to 40)')
    .refine(
      (name) => !AI_CHAT_RESERVED_SKILLS.includes(name),
      (name) => ({ message: `/${name} is a chat command; choose another name` })
    ),
  description: z.string().trim().max(AI_CHAT_SKILL_DESCRIPTION_MAX).default(''),
  body: z.string().max(100_000).default(''),
  mode: z.enum(['always', 'on_request']).default('on_request'),
  enabled: z.boolean().default(true),
  sourcePath: z.string().optional(),
});

const AiChatAgySyncSchema = z.object({ ok: z.boolean(), message: z.string(), at: z.string() });

function uniqueNames(value: { servers: Array<{ name: string }>; skills: Array<{ name: string }> }, ctx: z.RefinementCtx) {
  const twice = (names: string[]) => names.find((name, i) => names.indexOf(name) !== i);
  const server = twice(value.servers.map((s) => s.name));
  if (server) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['servers'], message: `Two servers are named ${server}` });
  const skill = twice(value.skills.map((s) => s.name));
  if (skill) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['skills'], message: `Two skills are named ${skill}` });
}

const timeLimitSeconds = z.number().int().min(5).max(1800).default(120);

export const AiChatToolsSettingsSchema = z
  .object({
    timeLimitSeconds,
    servers: z.array(AiChatMcpServerSchema).default([]),
    skills: z.array(AiChatSkillSchema).default([]),
    agySync: AiChatAgySyncSchema.optional(),
  })
  .superRefine(uniqueNames);

/** What the browser saves: secrets are new text, or { set: true } to keep the stored value. */
export const AiChatToolsUpdateInputSchema = z
  .object({
    timeLimitSeconds,
    servers: z.array(AiChatMcpServerUpdateSchema).default([]),
    skills: z.array(AiChatSkillSchema).default([]),
  })
  .superRefine(uniqueNames);

export type AiChatToolsUpdateInput = z.input<typeof AiChatToolsUpdateInputSchema>;

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

export const DetectedIdeSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string().optional(),
  appPath: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const IdeSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  binaryPath: z.string().optional(),
  port: z.number().int().positive().default(8443),
  host: z.string().default('127.0.0.1'),
  externalUrl: z.string().optional(),
  autoStart: z.boolean().default(false),
  preferredIde: z.string().optional(),
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



/** Events a person can be notified about outside the app (Slack, Telegram, webhook). */
export const NOTIFY_EVENT_TYPES = [
  'question_asked',
  'task_needs_human',
  'requirement_in_review',
  'merge_succeeded',
  'merge_failed',
  'task_failed',
  'task_blocked',
  'engine_down',
  'engine_rate_limited',
  'changes_requested',
  'question_answered',
] as const;
export type NotifyEventType = (typeof NOTIFY_EVENT_TYPES)[number];

export const DEFAULT_NOTIFY_EVENTS: Record<NotifyEventType, boolean> = {
  question_asked: true,
  task_needs_human: true,
  requirement_in_review: true,
  merge_succeeded: true,
  merge_failed: true,
  task_failed: true,
  task_blocked: true,
  engine_down: true,
  engine_rate_limited: true,
  changes_requested: false,
  question_answered: false,
};

export const NotificationChannelSchema = z.object({
  id: z.string().trim().min(1).max(40),
  type: z.enum(['slack', 'telegram', 'webhook']),
  name: z.string().trim().max(60).default(''),
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), { message: 'URL must start with http:// or https://' }),
  enabled: z.boolean().default(true),
});

export const UpdateNotificationSettingsInputSchema = z
  .object({
    channels: z.array(NotificationChannelSchema).max(10).optional(),
    events: z.record(z.string(), z.boolean()).optional(),
    app_url: z.union([z.literal(''), z.string().trim().url()]).optional(),
  })
  .refine((v) => !v.channels || new Set(v.channels.map((c) => c.id)).size === v.channels.length, {
    message: 'Channel ids must be unique',
    path: ['channels'],
  })
  .refine((v) => Object.keys(v.events ?? {}).every((k) => (NOTIFY_EVENT_TYPES as readonly string[]).includes(k)), {
    message: 'Unknown notification event',
    path: ['events'],
  });

export type UpdateNotificationSettingsInput = z.input<typeof UpdateNotificationSettingsInputSchema>;

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

export const NeuronCategorySchema = z.enum(['convention', 'architecture', 'dependency', 'testing', 'triage']);

export const NeuronRuleSchema = z.object({
  id: z.string().trim().min(1),
  workspace_id: z.string().trim().default('default'),
  project: z.string().trim().min(1),
  category: NeuronCategorySchema,
  rule_text: z.string().trim().min(1),
  confidence_score: z.number().min(0).max(1).default(0.9),
  trigger_count: z.number().int().min(0).default(1),
  is_active: z.boolean().default(true),
  source_run_id: z.string().nullable().optional().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateNeuronRuleInputSchema = z.object({
  workspace_id: z.string().trim().optional().default('default'),
  project: z.string().trim().min(1),
  category: NeuronCategorySchema,
  rule_text: z.string().trim().min(1),
  confidence_score: z.number().min(0).max(1).optional().default(0.9),
  source_run_id: z.string().nullable().optional().default(null),
});

export const BrowserPageSchema = z.object({
  url: z.string().trim().url(),
  title: z.string().trim().default(''),
  textContent: z.string().default(''),
  headings: z.array(z.string()).default([]),
  error: z.string().optional(),
});
