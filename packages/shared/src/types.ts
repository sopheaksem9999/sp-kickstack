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

export type TaskRole = 'goal' | 'ticket' | 'waiting' | 'question' | 'qa';

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

export interface WorkspaceDataSummary {
  workspaceId: string;
  name: string;
  projectsCount: number;
  requirementsCount: number;
  tasksCount: number;
  sprintsCount: number;
  assetsCount: number;
  chatSessionsCount: number;
  filesCount: number;
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
  build_command?: string | null;
  lint_command?: string | null;
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
  /** role 'qa': the agent's verdict from `xticket qa-result` (1 passed, 0 found problems, null none yet). */
  qa_passed?: number | null;
  /** role 'qa': the agent's summary, or "Finished without a result". */
  qa_summary?: string | null;
  /** role 'qa': checked in In Review (a merge preview) or in QA (the merged code). */
  qa_stage?: QaStage | null;
  /** role 'qa': the model tier chosen by size and risk (null in Fixed mode), and why. */
  qa_tier?: QaTier | null;
  qa_tier_reason?: string | null;
  /** Engine dispatch attempts so far. The retry sweep adds one for each automatic try; only Retry and Request changes set it back to 1. */
  attempts?: number;
  /** LLM token usage metrics and estimated cost */
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
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
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
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

export type NeuronCategory = 'convention' | 'architecture' | 'dependency' | 'testing' | 'triage';

export interface NeuronRule {
  id: string;
  workspace_id: string;
  project: string;
  category: NeuronCategory;
  rule_text: string;
  confidence_score: number;
  trigger_count: number;
  is_active: boolean;
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNeuronRuleInput {
  workspace_id?: string;
  project: string;
  category: NeuronCategory;
  rule_text: string;
  confidence_score?: number;
  source_run_id?: string | null;
}

/** System 1 Decision Model identifier (non-conversational calibrated decision engine). 'none' disables the engine. */
export type DecisionEngineId = 'clef' | 'jev' | 'none';

export interface JevSettings {
  jev_enabled: boolean;
  jev_bin_path: string;
  jev_model: string;
  jev_args_template: string;
}

export interface ClefSettings {
  clef_enabled: boolean;
  clef_account_id: string;
  clef_api_token: string;
  clef_model: string;
  clef_auto_triage: boolean;
}

/** System Decision Engine settings: exactly 1 active decision engine by default. */
export interface SystemDecisionSettings {
  active_engine: DecisionEngineId;
  clef: ClefSettings;
  jev: JevSettings;
}

export interface BrowserPageContent {
  url: string;
  title: string;
  textContent: string;
  headings: string[];
  error?: string;
}

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

/** Settings → AI & Local Engines → AI QA. */
export interface AiQaSettings {
  /** Start AI QA when a requirement enters In Review (before the merge). */
  runAutomatically: boolean;
  /** 'default' = the Local AI CLI engine's CLI. */
  agentCli: 'default' | AgentCliId;
  /** null = the engine's model / effort. */
  model: string | null;
  effort: ReasoningEffort | null;
  /** A QA run longer than this is stopped (5-240). */
  timeLimitMinutes: number;
  /** Findings saved per QA run at most (1-200). */
  maxFindings: number;
  /** 'auto' = the model by size and risk; 'fixed' = `model` / `effort` above. */
  modelMode: 'auto' | 'fixed';
  tiers: Record<AgentCliId, QaTierProfiles>;
  /** Light tier: at most this many changed lines (and 8 files). */
  lightMaxLines: number;
  /** Deep tier: from this many changed lines (or 40 files, or a risky path). */
  deepMinLines: number;
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
/** A file kept with a review comment (served at /api/comments/:id/attachments/:name). */
export interface ReviewCommentAttachment {
  name: string;
  size: number;
  type: string;
}

export type ReviewCommentSource = 'person' | 'ai-qa';
export type QaSeverity = 'blocker' | 'major' | 'minor';

export interface ReviewComment {
  id: number;
  req_id: string;
  task_id: number;
  project: string;
  file_path: string | null;
  line: number | null;
  body: string;
  state: ReviewCommentState;
  /** Who wrote it: a person, or the AI QA agent (with a severity). */
  source: ReviewCommentSource;
  severity: QaSeverity | null;
  /** Review round it was sent in. */
  round: number | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  attachments: ReviewCommentAttachment[];
}

/** One repository's AI QA run, for the requirement header. */
export interface QaRunView {
  /** The QA task (its log opens in the task log drawer). */
  task: BridgeTask;
  project: string;
  status: NormStatus;
  passed: boolean | null;
  summary: string | null;
  error: string | null;
  findings: number;
  tier: QaTier | null;
  tierReason: string | null;
}

/** The requirement header's AI QA status: the latest QA round. */
export interface RequirementQa {
  reqId: string;
  /** 0 = AI QA never ran for this requirement. */
  round: number;
  running: boolean;
  runs: QaRunView[];
  skipped: Array<{ project: string; reason: string }>;
  findings: { total: number; blocker: number; major: number; minor: number };
  /** The latest round's stage; null when AI QA never ran. */
  stage: QaStage | null;
  /** Review rounds: the branch the preview merged into. */
  previewInto: string | null;
  /** Open AI QA blocker findings from review rounds. */
  openBlockers: number;
  /** Why an automatic merge waits (auto-merge policy, in review), or null. */
  autoMergeHold: string | null;
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

/** A file a task changed on its branch, against the branch it started from. */
export interface TaskChangedFile {
  path: string;
  /** The old path of a renamed file. */
  oldPath?: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface TaskChanges {
  branch: string | null;
  base: string | null;
  files: TaskChangedFile[];
  additions: number;
  deletions: number;
  /** More files changed than are listed. */
  truncated: boolean;
}

export interface TaskDiffLine {
  type: 'hunk' | 'add' | 'del' | 'context';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface TaskFileDiff {
  path: string;
  binary: boolean;
  lines: TaskDiffLine[];
  truncated: boolean;
}
