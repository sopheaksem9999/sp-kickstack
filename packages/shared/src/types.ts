export type NormStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'needs_human'
  | 'held'
  | 'in_review'
  | 'qa'
  | 'done'
  | 'failed'
  | 'cancelled'
  /** The engine (or its AI provider) is rate limited; resumes on its own (see paused_until). */
  | 'rate_limited';

export type RequirementStatus =
  | 'draft'
  | 'ready'
  | 'in_progress'
  | 'qa'
  | 'in_review'
  | 'done'
  | 'cancelled';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type EngineType = 'stoneforge' | 'clinekanban' | 'manual' | 'local';

export type DoneMeans = 'merged' | 'pr_opened';

export type TaskRole = 'goal' | 'ticket' | 'waiting' | 'question';

export type LinkState = 'waiting' | 'ready' | 'released' | 'error' | 'cancelled';

export type TicketType = 'api_request' | 'bug' | 'question';

export type EventType =
  | 'target_branch_created'
  | 'plan_ready'
  | 'task_blocked'
  | 'task_unblocked'
  | 'ticket_created'
  | 'ready_for_review'
  | 'merge_ready'
  | 'task_failed'
  | 'engine_down'
  | 'engine_up'
  | 'requirement_done'
  | 'limit_hit'
  | 'task_status_changed'
  | 'task_updated'
  | 'link_released'
  | 'fanout_completed'
  | 'ticket_rejected'
  | 'webhook_ignored'
  | 'merge_confirmed'
  | 'merge_started'
  | 'merge_succeeded'
  | 'merge_failed'
  | 'engine_rate_limited'
  | 'task_rate_limited'
  | 'task_retried'
  | 'question_asked'
  | 'question_answered'
  | 'changes_requested'
  | 'task_note_sent'
  | 'requirement_in_review'
  | 'task_needs_human';

export interface HealthResponse {
  ok: boolean;
  version: string;
  /** DEMO_MODE=1 on the server: simulated CLI runner, seeded logs, demo merge. */
  demo_mode: boolean;
}

export type BranchMergePolicy = 'manual_review_merge' | 'auto_merge';

export type MergeState = 'idle' | 'running' | 'failed';

export interface BranchMergeSettings {
  default_base_branch: string;
  merge_policy: BranchMergePolicy;
  auto_delete_branch?: boolean;
  /** Task branch names: {req}, {task}, {project}; tickets add -ticket-{task}. */
  task_branch_pattern: string;
  /** The bridge pushes new task/target branches and agents' new commits to origin. */
  push_branches: boolean;
  /** New requirements start with this target branch; empty = each repository's base branch. */
  default_target_branch: string;
}

export interface AttachmentItem {
  name: string;
  size?: number;
  type?: string;
  data_url?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  rules?: string;
  context?: string;
  /** Default agent model / effort for agent runs (null = inherit; at the end the engine decides). */
  agent_model?: string | null;
  agent_effort?: ReasoningEffort | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  name: string;
  workspace_id?: string;
  kind: 'backend' | 'frontend' | 'full-stack' | 'mobile' | 'other';
  repo_path: string;
  engine_type: EngineType;
  engine_url?: string | null;
  engine_meta?: Record<string, unknown>;
  base_branch: string;
  contract_path?: string | null;
  done_means: DoneMeans;
  high_risk_paths: string[];
  test_command?: string | null;
  enabled: boolean;
  engine_status: 'ok' | 'down' | 'unknown';
  created_at: string;
  updated_at: string;
}

export type SprintStatus = 'planned' | 'active' | 'completed';

export interface Sprint {
  id: string;
  workspace_id: string;
  name: string;
  goal?: string;
  start_date?: string;
  end_date?: string;
  status: SprintStatus;
  created_at?: string;
  updated_at?: string;
}

export interface Requirement {
  id: string; // REQ-001
  workspace_id?: string;
  session_id?: string | null;
  sprint_id?: string | null;
  seq: number;
  title: string;
  status: RequirementStatus;
  priority: Priority;
  body_md: string;
  file_path: string;
  revision: number;
  affected_projects: string[];
  attachments?: AttachmentItem[];
  merge_policy?: BranchMergePolicy | null;
  merge_state?: MergeState;
  merge_error?: string | null;
  /** Default agent model / effort for agent runs (null = inherit; at the end the engine decides). */
  agent_model?: string | null;
  agent_effort?: ReasoningEffort | null;
  /** CLI for this requirement's Local AI CLI runs (null = Settings default). */
  agent_cli?: AgentCliId | null;
  /** Branch its tasks start from and merge into (null = each repository's base branch). */
  target_branch?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BridgeTask {
  id: number;
  req_id: string;
  project: string;
  role: TaskRole;
  engine_task_id: string | null;
  title: string;
  body_md?: string;
  origin_task_id?: number | null;
  depth: number;
  status: NormStatus;
  engine_status_raw?: string | null;
  engine_url?: string | null;
  pr_url?: string | null;
  last_error?: string | null;
  revision: number;
  /** Bridge-created work branch (req/<REQ-ID>/task-<id>); null for non-git projects. */
  branch?: string | null;
  base_sha?: string | null;
  /** Merge commit on the base branch; null with merged_at set = nothing to merge. */
  merge_sha?: string | null;
  merged_at?: string | null;
  /** Rate limited: nothing is retried for this task before this time (ISO). */
  paused_until?: string | null;
  /** role 'question': the choices offered (JSON array of strings). */
  options?: string | null;
  /** role 'question': the person's answer. */
  answer_md?: string | null;
  answered_at?: string | null;
  /** Model / effort sent with the current engine task (what this run used). */
  model?: string | null;
  effort?: ReasoningEffort | null;
  /** Model / effort pinned for this task by Retry or Request changes (null = inherit). */
  model_override?: string | null;
  effort_override?: ReasoningEffort | null;
  /** Engine dispatch attempts so far. The retry sweep adds one for each automatic try; only Retry and Request changes set it back to 1. */
  attempts?: number;
  created_at: string;
  updated_at: string;
}

/** A task as GET /api/tasks lists it: the task plus its requirement's title, priority and status. */
export type QueueTask = BridgeTask & {
  req_title: string | null;
  req_priority: Priority | null;
  req_status: RequirementStatus | null;
};

export interface Link {
  id: number;
  task_id: number; // waiting task
  depends_on_id: number; // dependency ticket task
  placeholder_id?: number | null;
  state: LinkState;
  context_md?: string | null;
  created_at: string;
  released_at?: string | null;
}

export interface BridgeEvent {
  id: number;
  req_id?: string | null;
  task_id?: number | null;
  type: EventType;
  payload: Record<string, unknown>;
  read: boolean;
  at: string;
}

export interface EngineTask {
  id: string;
  title: string;
  status: NormStatus;
  rawStatus: string;
  url?: string;
  prUrl?: string;
  summary?: string;
  /** When a rate-limited task is expected to resume (ISO time), if the engine says. */
  resumeAt?: string;
}

export interface SharedAsset {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  size: number;
  data_url: string;
  notes?: string;
  created_at: string;
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface SingleCliConfig {
  enabled: boolean;
  model: string;
  effort: ReasoningEffort;
  customPath?: string;
  ultracode?: boolean;
}

export type EngineId = 'claude-cli' | 'agy-cli' | 'codex-cli' | 'ollama' | 'heuristic';

export interface AiCliSettings {
  defaultProvider: EngineId | 'auto';
  enabledEngines?: EngineId[];
  claude: SingleCliConfig;
  agy: SingleCliConfig;
  codex?: SingleCliConfig;
  ollama: SingleCliConfig & { url: string };
  heuristic?: { enabled: boolean };
}

/** An AI CLI the Local AI CLI engine can run as a coding agent. */
export type AgentCliId = 'claude-cli' | 'agy-cli' | 'codex-cli';

/** Settings → AI & Local Engines → Local AI CLI engine. */
export interface LocalEngineSettings {
  /** Off: runs wait in QUEUED and the engine shows as down. */
  enabled: boolean;
  /** 'default' follows the AI default (falling back to the first usable agent CLI). */
  agentCli: 'default' | AgentCliId;
  /** Agents running at once, all workspaces together (1-8). */
  maxParallel: number;
  /** A run longer than this is stopped (5-480). */
  runTimeoutMinutes: number;
  /** Absolute folder for task worktrees; '' = <workspace>/agent-worktrees. */
  worktreeRoot: string;
}

export interface LocalEngineCliStatus {
  id: AgentCliId;
  label: string;
  installed: boolean;
  enabled: boolean;
  /** While a usage limit pauses this CLI: until when (ISO). */
  pausedUntil: string | null;
}

/** Live state for the Settings card. */
export interface LocalEngineStatus {
  enabled: boolean;
  /** The CLI the next run uses; null (with `problem`) when none can run. */
  cli: AgentCliId | null;
  problem: string | null;
  clis: LocalEngineCliStatus[];
  counts: { running: number; queued: number; held: number; rate_limited: number };
  maxParallel: number;
  /** The folder actually used (the default filled in). */
  worktreeRoot: string;
}

export interface EngineRateLimitInfo {
  supported: boolean;
  supportType: 'native' | 'bridge_monitored' | 'unlimited_offline';
  status: 'healthy' | 'rate_limited' | 'unlimited';
  pausedUntil?: string | null;
  message?: string;
  totalDispatches: number;
  completedTasks: number;
  rateLimitEvents: number;
  activeTasks: number;
  lastUsedAt?: string | null;
  // Progress & Quota limits (matching session & weekly sample):
  weeklyLimitRemainingPercent?: number; // 0 - 100
  weeklyResetsIn?: string; // e.g. "5d 16h"
  sessionLimitRemainingPercent?: number; // 0 - 100
  sessionResetsIn?: string; // e.g. "4h 26m"
  windowLabel?: string; // e.g. "Five Hour Limit Remaining"
  lastRefreshedAt?: string; // e.g. "23:30:15"
}

export interface EngineProviderStatus {
  id: EngineId;
  name: string;
  installed: boolean;
  available: boolean;
  enabled?: boolean;
  path?: string | null;
  version?: string | null;
  models?: string[];
  note?: string;
  rateLimit: EngineRateLimitInfo;
}

export type AiChatRole = 'user' | 'assistant' | 'system';

export interface DraftRequirementResult {
  title: string;
  goal: string;
  user_story: string;
  acceptance_criteria: string[];
  affected_projects: string[];
  api_hints?: string;
  notes?: string;
  provider_used: string;
}

export interface ChatAttachmentItem {
  id?: string;
  name: string;
  type?: string;
  size?: number;
  data_url?: string;
  asset_id?: string;
}

export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  timestamp: string;
  suggested_spec?: DraftRequirementResult;
  attachments?: ChatAttachmentItem[];
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  provider?: 'auto' | 'claude-cli' | 'agy-cli' | 'codex-cli' | 'ollama' | 'heuristic';
  model?: string;
  effort?: ReasoningEffort;
  workspace_id?: string;
  context_project?: string;
}

export interface AiChatResponse {
  message: AiChatMessage;
  suggested_spec?: DraftRequirementResult;
  provider_used: string;
}

export interface AiChatSession {
  id: string;
  workspace_id: string;
  title: string;
  provider: 'auto' | 'claude-cli' | 'agy-cli' | 'codex-cli' | 'ollama' | 'heuristic';
  model?: string;
  effort?: ReasoningEffort;
  created_at: string;
  updated_at: string;
  messages?: AiChatMessage[];
}

export interface DetectedIde {
  id: string;
  name: string;
  command?: string;
  appPath?: string;
  isDefault?: boolean;
}

export interface IdeSettings {
  enabled: boolean;
  binaryPath?: string;
  port: number;
  host: string;
  externalUrl?: string;
  autoStart?: boolean;
  preferredIde?: string;
}

export interface IdeServerStatus {
  installed: boolean;
  running: boolean;
  binaryPath?: string;
  port: number;
  host: string;
  url?: string;
  pid?: number;
  error?: string;
}

export interface StartIdeInput {
  project_name?: string;
  folder_path?: string;
  port?: number;
}

export interface ProjectTerminalStatus {
  projectName: string;
  repoPath: string;
  running: boolean;
  pid?: number;
  shell?: string;
  buffer: string;
  startedAt?: string;
  lastCommand?: string;
}

export type QuestionStatus = 'open' | 'answered' | 'cancelled';

/** A question an agent asked a person (a bridge task with role 'question'). */
export interface AgentQuestion {
  id: number;
  req_id: string;
  /** The goal/ticket that asked; held until the answer arrives while its run is still going. */
  task_id: number;
  /** Status of the asking task: held (paused for the answer), still running, or its run is over. */
  asker_status: NormStatus;
  project: string;
  question: string;
  details: string;
  options: string[];
  status: QuestionStatus;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

/**
 * How an answer reached the asking agent:
 * - resumed: the paused task continues with the answer;
 * - noted: sent as a note; the task stays paused for another dependency and gets the answer again when it resumes;
 * - note: the task was running (not paused), so the answer went to it as a note;
 * - review_comment: the task's run is over; the answer is an open review comment for its next run;
 * - pending: saved; it reaches the agent as soon as its engine responds (the sweeper retries).
 */
export type AnswerDelivery = 'resumed' | 'noted' | 'note' | 'review_comment' | 'pending';

export type AnswerQuestionResult = AgentQuestion & { delivered: AnswerDelivery };

export interface AskQuestionResponse {
  questionId: number;
  taskId: number;
  status: QuestionStatus;
  /** The asking task is paused in its engine. */
  held: boolean;
  answer: string | null;
  /** What the agent should do now. */
  message: string;
}

export type ReviewCommentState = 'open' | 'sent' | 'resolved';

/** A reviewer's comment on a task; sent to the agent with "Request changes". */
export interface ReviewComment {
  id: number;
  req_id: string;
  task_id: number;
  project: string;
  file_path: string | null;
  line: number | null;
  body: string;
  state: ReviewCommentState;
  /** Review round it was sent in. */
  round: number | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

/** "Improve with AI": the rewritten comment, and the file/line it names (null = keep the reviewer's). */
export interface ImproveReviewCommentResult {
  body: string;
  file_path: string | null;
  line: number | null;
  provider_used: string;
}

export interface RequestChangesResult {
  round: number;
  results: Array<{ taskId: number; ok: boolean; status?: string; error?: string }>;
}

export interface NotificationChannelConfig {
  id: string;
  type: 'slack' | 'telegram' | 'webhook';
  name: string;
  url: string;
  enabled: boolean;
}

export interface NotificationSettings {
  channels: NotificationChannelConfig[];
  /** Event type → notify (missing types use the defaults). */
  events: Record<string, boolean>;
  /** Base URL of the web app, for links in messages ('' = no links). */
  app_url: string;
}

export interface NotificationTestResult {
  channel: string;
  ok: boolean;
  error?: string;
}
