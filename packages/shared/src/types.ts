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
  | 'task_status_changed';

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
  engine_url?: string;
  engine_meta?: Record<string, unknown>;
  base_branch: string;
  contract_path?: string;
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
