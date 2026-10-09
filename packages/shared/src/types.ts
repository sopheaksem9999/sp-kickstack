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
  | 'cancelled';

export type RequirementStatus =
  | 'draft'
  | 'ready'
  | 'in_progress'
  | 'qa'
  | 'in_review'
  | 'done'
  | 'cancelled';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type EngineType = 'stoneforge' | 'clinekanban' | 'manual';

export type DoneMeans = 'merged' | 'pr_opened';

export type TaskRole = 'goal' | 'ticket' | 'waiting';

export type LinkState = 'waiting' | 'ready' | 'released' | 'error' | 'cancelled';

export type TicketType = 'api_request' | 'bug' | 'question';

export type EventType =
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
  | 'merge_confirmed';

export interface HealthResponse {
  ok: boolean;
  version: string;
  /** DEMO_MODE=1 on the server: simulated CLI runner, seeded logs, demo merge. */
  demo_mode: boolean;
}

export type BranchMergePolicy = 'manual_review_merge' | 'auto_merge_main';

export interface BranchMergeSettings {
  default_base_branch: string;
  merge_policy: BranchMergePolicy;
  auto_delete_branch?: boolean;
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
  created_at: string;
  updated_at: string;
}

export interface Project {
  name: string;
  workspace_id?: string;
  kind: 'backend' | 'frontend' | 'mobile' | 'other';
  repo_path: string;
  engine_type: EngineType;
  engine_url?: string | null;
  engine_meta?: Record<string, unknown>;
  base_branch: string;
  contract_path?: string | null;
  done_means: DoneMeans;
  high_risk_paths: string[];
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
  created_at: string;
  updated_at: string;
}

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

export interface AiCliSettings {
  defaultProvider: 'auto' | 'claude-cli' | 'agy-cli' | 'codex-cli' | 'ollama' | 'heuristic';
  claude: SingleCliConfig;
  agy: SingleCliConfig;
  codex?: SingleCliConfig;
  ollama: SingleCliConfig & { url: string };
}

export type AiChatRole = 'user' | 'assistant' | 'system';

export interface DraftRequirementResult {
  title: string;
  goal: string;
  user_story: string;
  acceptance_criteria: string[];
  affected_projects: string[];
  api_hints?: string;
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

export interface IdeSettings {
  enabled: boolean;
  binaryPath?: string;
  port: number;
  host: string;
  externalUrl?: string;
  autoStart?: boolean;
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


