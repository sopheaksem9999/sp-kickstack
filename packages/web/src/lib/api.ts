import {
  Workspace,
  WorkspaceDataSummary,
  Project,
  Requirement,
  BridgeTask,
  QueueTask,
  Link,
  BridgeEvent,
  CreateRequirementInput,
  UpdateRequirementInput,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  BranchMergeSettings,
  BranchMergePolicy,
  RequirementStatus,
  SharedAsset,
  CreateSharedAssetInput,
  Sprint,
  CreateSprintInput,
  UpdateSprintInput,
  AiCliSettings,
  AiChatRequest,
  AiChatResponse,
  AiChatSession,
  CreateAiChatSessionInput,
  UpdateAiChatSessionInput,
  SendAiChatMessageInput,
  IdeSettings,
  IdeServerStatus,
  DetectedIde,
  StartIdeInput,
  ProjectTerminalStatus,
  HealthResponse,
  EngineProviderStatus,
  EngineRateLimitInfo,
  BrowserPageContent,
  NeuronRule,
  CreateNeuronRuleInput,
  SystemDecisionSettings,
} from '@sp-kickstack/shared';

export type { EngineProviderStatus, EngineRateLimitInfo };

export const isTauri =
  typeof window !== 'undefined' &&
  Boolean(
    (window as any).__TAURI_INTERNALS__ ||
    (window as any).__TAURI__ ||
    window.location?.protocol === 'tauri:' ||
    window.location?.hostname === 'tauri.localhost'
  );

export const API_BASE = isTauri ? 'http://127.0.0.1:4100' : '';
export const BASE = `${API_BASE}/api`;

/** An error the server answered with: the message is its `error` text, `status` the HTTP status. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((body as { error?: string })?.error || `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(`${BASE}/workspaces`);
  return res.json();
}

export async function fetchWorkspace(id: string): Promise<Workspace> {
  const res = await fetch(`${BASE}/workspaces/${id}`);
  return res.json();
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const res = await fetch(`${BASE}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create workspace');
  return res.json();
}

export async function updateWorkspace(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
  const res = await fetch(`${BASE}/workspaces/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update workspace');
  return res.json();
}

export async function fetchWorkspaceSummary(id: string): Promise<WorkspaceDataSummary> {
  const res = await fetch(`${BASE}/workspaces/${encodeURIComponent(id)}/summary`);
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch workspace summary');
  return res.json();
}

export async function deleteWorkspace(id: string): Promise<{ ok: boolean; summary?: WorkspaceDataSummary }> {
  const res = await fetch(`${BASE}/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete workspace');
  return res.json();
}

export async function fetchProjects(workspaceId?: string): Promise<Project[]> {
  const url = workspaceId && workspaceId !== 'all'
    ? `${BASE}/projects?workspace=${encodeURIComponent(workspaceId)}`
    : `${BASE}/projects`;
  const res = await fetch(url);
  return res.json();
}

export async function testProjectConnection(name: string): Promise<{ ok: boolean; status: string }> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}/test`, { method: 'POST' });
  return res.json();
}

export async function updateProject(name: string, payload: Partial<Project>): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update project');
  return res.json();
}

export async function deleteProject(name: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete project');
  return res.json();
}

export async function openProjectFolder(name: string): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}/open`, {
    method: 'POST',
  });
  return res.json();
}

export async function fetchRequirements(workspaceId?: string, sessionId?: string): Promise<Requirement[]> {
  const params = new URLSearchParams();
  if (workspaceId && workspaceId !== 'all') params.set('workspace', workspaceId);
  if (sessionId) params.set('session_id', sessionId);
  const qs = params.toString();
  const url = qs ? `${BASE}/requirements?${qs}` : `${BASE}/requirements`;
  const res = await fetch(url);
  return res.json();
}

export async function fetchRequirement(id: string): Promise<Requirement> {
  const res = await fetch(`${BASE}/requirements/${id}`);
  return res.json();
}

export async function createRequirement(input: CreateRequirementInput): Promise<Requirement> {
  const res = await fetch(`${BASE}/requirements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create requirement');
  return res.json();
}

export async function startRequirementFanOut(id: string): Promise<{ ok: boolean; tasks: BridgeTask[] }> {
  return request(`${BASE}/requirements/${id}/ready`, { method: 'POST' });
}

export async function cancelRequirement(id: string): Promise<{ ok: boolean }> {
  return request(`${BASE}/requirements/${id}/cancel`, { method: 'POST' });
}

export async function fetchRequirementGraph(id: string): Promise<{ tasks: BridgeTask[]; links: Link[] }> {
  return request(`${BASE}/requirements/${id}/graph`);
}

export interface FetchTasksParams {
  req?: string;
  project?: string;
  status?: string;
  /** Only tasks of requirements in this workspace. */
  workspace?: string;
  /** Comma separated roles, for example "goal,ticket". */
  role?: string;
}

/** Tasks with their requirement's title, priority and status; every filter is optional. */
export async function fetchTasks(params: FetchTasksParams = {}): Promise<QueueTask[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return request(`${BASE}/tasks${qs ? `?${qs}` : ''}`);
}

export async function markTaskDone(taskId: number): Promise<{ ok: boolean }> {
  return request(`${BASE}/tasks/${taskId}/mark-done`, { method: 'POST' });
}

/** Retry a stopped goal/ticket on its existing branch (old engine task is cancelled). */
export async function retryTask(taskId: number): Promise<BridgeTask> {
  return request(`${BASE}/tasks/${taskId}/retry`, { method: 'POST' });
}

export interface TaskLogItem {
  id: number;
  task_id: number;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
  created_at: string;
}

export interface TaskLogsResponse {
  task: BridgeTask;
  logs: TaskLogItem[];
  events: BridgeEvent[];
}

export async function fetchTaskLogs(taskId: number): Promise<TaskLogsResponse> {
  const res = await fetch(`${BASE}/tasks/${taskId}/logs`);
  if (!res.ok) throw new Error('Failed to fetch task logs');
  return res.json();
}

export async function runTaskCli(taskId: number): Promise<{ ok: boolean; task: BridgeTask }> {
  return request(`${BASE}/tasks/${taskId}/run-cli`, { method: 'POST' });
}

export async function releaseLink(linkId: number): Promise<{ ok: boolean }> {
  return request(`${BASE}/links/${linkId}/release`, { method: 'POST' });
}

export async function fetchNotifications(): Promise<BridgeEvent[]> {
  const res = await fetch(`${BASE}/notifications`);
  return res.json();
}

export async function fetchSettings(): Promise<{
  branch_merge: BranchMergeSettings;
  ai_cli: AiCliSettings;
  decision_engine?: SystemDecisionSettings;
}> {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function updateBranchMergeSettings(settings: Partial<BranchMergeSettings>): Promise<BranchMergeSettings> {
  const res = await fetch(`${BASE}/settings/branch-merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update branch merge settings');
  return res.json();
}

export async function updateAiCliSettings(settings: Partial<AiCliSettings>): Promise<AiCliSettings> {
  const res = await fetch(`${BASE}/settings/ai-cli`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update AI CLI settings');
  return res.json();
}

export async function updateSystemDecisionSettings(settings: Partial<SystemDecisionSettings>): Promise<SystemDecisionSettings> {
  const res = await fetch(`${BASE}/settings/decision`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update system decision settings');
  return res.json();
}

export async function updateRequirement(
  id: string,
  input: UpdateRequirementInput
): Promise<Requirement> {
  return request(`${BASE}/requirements/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateRequirementStatus(id: string, status: RequirementStatus): Promise<Requirement> {
  return request(`${BASE}/requirements/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function mergeRequirementToMain(id: string): Promise<{ ok: boolean; status: string; merged_branch: string }> {
  return request(`${BASE}/requirements/${id}/merge-to-main`, { method: 'POST' });
}

/** Start the merge gate (merge task branches, test, push, move to QA). Answers with merge_state 'running'. */
export async function startMergeToQa(id: string): Promise<Requirement> {
  return request(`${BASE}/requirements/${id}/merge-to-qa`, { method: 'POST' });
}

export interface TicketAttachmentItem {
  req_id: string;
  req_title: string;
  name: string;
  size?: number;
  type?: string;
  data_url?: string;
  created_at: string;
}

export interface AssetsResponse {
  ticket_attachments: TicketAttachmentItem[];
  shared_assets: SharedAsset[];
}

export async function updateRequirementProjects(id: string, affected_projects: string[]): Promise<Requirement> {
  const res = await fetch(`${BASE}/requirements/${id}/projects`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ affected_projects }),
  });
  if (!res.ok) throw new Error('Failed to update requirement projects');
  return res.json();
}

export async function updateRequirementMergePolicy(id: string, merge_policy: BranchMergePolicy | null): Promise<Requirement> {
  const res = await fetch(`${BASE}/requirements/${id}/merge-policy`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merge_policy }),
  });
  if (!res.ok) throw new Error('Failed to update requirement merge policy');
  return res.json();
}

export async function fetchAssets(workspaceId?: string): Promise<AssetsResponse> {
  const qs = workspaceId && workspaceId !== 'all' ? `?workspace=${workspaceId}` : '';
  const res = await fetch(`${BASE}/assets${qs}`);
  if (!res.ok) throw new Error('Failed to fetch assets');
  return res.json();
}

export async function createSharedAsset(input: CreateSharedAssetInput): Promise<SharedAsset> {
  const res = await fetch(`${BASE}/assets/shared`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to upload shared asset');
  return res.json();
}

export async function deleteSharedAsset(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/assets/shared/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete shared asset');
  return res.json();
}

export async function fetchSprints(workspaceId?: string): Promise<Sprint[]> {
  const qs = workspaceId && workspaceId !== 'all' ? `?workspace=${encodeURIComponent(workspaceId)}` : '';
  const res = await fetch(`${BASE}/sprints${qs}`);
  if (!res.ok) throw new Error('Failed to fetch sprints');
  return res.json();
}

export async function createSprint(input: CreateSprintInput): Promise<Sprint> {
  const res = await fetch(`${BASE}/sprints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create sprint');
  return res.json();
}

export async function updateSprint(id: string, input: UpdateSprintInput): Promise<Sprint> {
  const res = await fetch(`${BASE}/sprints/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update sprint');
  return res.json();
}

export async function startSprint(id: string): Promise<Sprint> {
  const res = await fetch(`${BASE}/sprints/${id}/start`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to start sprint');
  return res.json();
}

export async function completeSprint(id: string): Promise<{ sprint: Sprint; rolledOverCount: number }> {
  const res = await fetch(`${BASE}/sprints/${id}/complete`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to complete sprint');
  return res.json();
}

export async function assignRequirementSprint(reqId: string, sprintId: string | null): Promise<Requirement> {
  const res = await fetch(`${BASE}/requirements/${reqId}/sprint`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sprint_id: sprintId }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to assign requirement sprint');
  return res.json();
}

export async function sendAiChatMessage(input: AiChatRequest): Promise<AiChatResponse> {
  const res = await fetch(`${BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to send AI chat message');
  }
  return res.json();
}

export async function fetchAiChatSessions(workspaceId?: string): Promise<AiChatSession[]> {
  const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  const res = await fetch(`${BASE}/ai/chat/sessions${qs}`);
  if (!res.ok) throw new Error('Failed to fetch AI chat sessions');
  return res.json();
}

export async function createAiChatSession(input: CreateAiChatSessionInput): Promise<AiChatSession> {
  const res = await fetch(`${BASE}/ai/chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create AI chat session');
  }
  return res.json();
}

export async function fetchAiChatSession(id: string): Promise<AiChatSession> {
  const res = await fetch(`${BASE}/ai/chat/sessions/${id}`);
  if (!res.ok) throw new Error('Failed to fetch AI chat session');
  return res.json();
}

export async function updateAiChatSession(
  id: string,
  input: UpdateAiChatSessionInput
): Promise<AiChatSession> {
  const res = await fetch(`${BASE}/ai/chat/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update AI chat session');
  }
  return res.json();
}

export async function deleteAiChatSession(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/ai/chat/sessions/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete AI chat session');
  return res.json();
}

export async function sendAiSessionMessage(
  sessionId: string,
  input: SendAiChatMessageInput
): Promise<{
  session: AiChatSession;
  message: any;
  suggested_spec?: any;
}> {
  const res = await fetch(`${BASE}/ai/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to send message to AI chat session');
  }
  return res.json();
}

export async function createRequirementFromSession(
  sessionId: string,
  instructions?: string
): Promise<{
  requirement: Requirement;
  session: AiChatSession;
}> {
  const res = await fetch(`${BASE}/ai/chat/sessions/${sessionId}/create-requirement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create requirement from chat discussion');
  }
  return res.json();
}

// Embedded IDE APIs (code-server / openvscode-server)
export async function fetchIdeStatus(): Promise<IdeServerStatus> {
  const res = await fetch(`${BASE}/ide/status`);
  if (!res.ok) throw new Error('Failed to fetch IDE server status');
  return res.json();
}

export async function fetchIdeSettings(): Promise<IdeSettings> {
  const res = await fetch(`${BASE}/ide/settings`);
  if (!res.ok) throw new Error('Failed to fetch IDE settings');
  return res.json();
}

export async function updateIdeSettings(settings: Partial<IdeSettings>): Promise<IdeSettings> {
  const res = await fetch(`${BASE}/ide/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update IDE settings');
  return res.json();
}

export async function startIdeServer(input?: StartIdeInput): Promise<IdeServerStatus> {
  const res = await fetch(`${BASE}/ide/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to start IDE server');
  }
  return res.json();
}

export async function stopIdeServer(): Promise<IdeServerStatus> {
  const res = await fetch(`${BASE}/ide/stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to stop IDE server');
  return res.json();
}

export async function fetchProjectIdeUrl(projectName: string): Promise<{ project: string; repo_path: string; url: string }> {
  const res = await fetch(`${BASE}/ide/projects/${encodeURIComponent(projectName)}/url`);
  if (!res.ok) throw new Error('Failed to get project IDE URL');
  return res.json();
}

export async function fetchDetectedIdes(): Promise<DetectedIde[]> {
  const res = await fetch(`${BASE}/ide/detected`);
  if (!res.ok) throw new Error('Failed to fetch detected IDEs');
  return res.json();
}

export async function openProjectInIde(
  projectName: string,
  ideId?: string
): Promise<{ ok: boolean; ide: DetectedIde; path: string }> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/open-ide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ideId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to open project in IDE');
  }
  return res.json();
}

// ========================================================
// Native In-App Git Review & Code Diff APIs
// ========================================================
export interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitReviewSummary {
  project: string;
  repoPath: string;
  currentBranch: string;
  targetBranch: string;
  totalAdditions: number;
  totalDeletions: number;
  changedFiles: ChangedFile[];
  recentCommits: GitCommitInfo[];
  clean: boolean;
  availableBranches?: string[];
  error?: string;
}

export interface DiffLine {
  type: 'add' | 'del' | 'normal' | 'header';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface FileDiffResult {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'unchanged';
  originalContent: string;
  modifiedContent: string;
  diffLines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeNode[];
}

export async function fetchGitReviewSummary(projectName: string, targetBranch = 'HEAD'): Promise<GitReviewSummary> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/git-review/summary?target=${encodeURIComponent(targetBranch)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch git review summary');
  }
  return res.json();
}

export async function fetchFileDiff(projectName: string, filePath: string, targetBranch = 'HEAD'): Promise<FileDiffResult> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/git-review/diff?file=${encodeURIComponent(filePath)}&target=${encodeURIComponent(targetBranch)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch file diff');
  }
  return res.json();
}

export async function fetchFileTree(projectName: string): Promise<FileTreeNode> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/git-review/tree`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch project file tree');
  }
  return res.json();
}

export async function fetchFileContent(projectName: string, filePath: string): Promise<{ path: string; content: string; size: number }> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/git-review/file?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch file content');
  }
  return res.json();
}

// =========================================================
// Project Persistent Terminal Client Endpoints
// =========================================================

export async function fetchProjectTerminal(projectName: string): Promise<ProjectTerminalStatus> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/terminal`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch project terminal status');
  }
  return res.json();
}

export async function sendProjectTerminalInput(projectName: string, input: string): Promise<ProjectTerminalStatus> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/terminal/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to send terminal command');
  }
  return res.json();
}

export async function interruptProjectTerminal(projectName: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/terminal/interrupt`, {
    method: 'POST',
  });
  return res.json();
}

export async function restartProjectTerminal(projectName: string): Promise<ProjectTerminalStatus> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/terminal/restart`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to restart terminal');
  }
  return res.json();
}

export async function clearProjectTerminal(projectName: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/terminal/clear`, {
    method: 'POST',
  });
  return res.json();
}

export async function fetchActiveTerminals(): Promise<string[]> {
  const res = await fetch(`${BASE}/terminals/active`);
  if (!res.ok) return [];
  return res.json();
}

export async function createProject(payload: Partial<Project>): Promise<Project> {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create project');
  return res.json();
}

export async function fetchSprintBurndown(sprintId: string): Promise<any> {
  const res = await fetch(`${BASE}/sprints/${encodeURIComponent(sprintId)}/burndown`);
  if (!res.ok) throw new Error('Failed to fetch burndown');
  return res.json();
}

export async function fetchTelemetry(workspaceId?: string): Promise<any> {
  const qs = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : '';
  const res = await fetch(`${BASE}/telemetry${qs}`);
  if (!res.ok) throw new Error('Failed to fetch telemetry');
  return res.json();
}

export async function fetchAiProviders(): Promise<EngineProviderStatus[]> {
  const res = await fetch(`${BASE}/ai/providers?_t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function refreshAiProviders(): Promise<EngineProviderStatus[]> {
  const res = await fetch(`${BASE}/ai/providers?refresh=true&_t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function draftRequirementAi(payload: { prompt: string; workspace_id?: string; provider?: string }): Promise<any> {
  const res = await fetch(`${BASE}/ai/draft-requirement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to draft requirement with AI');
  }
  return res.json();
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error('Unhealthy');
  return res.json();
}

export async function fetchBrowserPage(url: string): Promise<BrowserPageContent> {
  const res = await request<{ ok: boolean; data: BrowserPageContent }>(
    `${BASE}/browser/fetch-page?url=${encodeURIComponent(url)}`
  );
  return res.data;
}

export async function triageWithClef(errorText: string): Promise<{ severity: string; domain: string; rationale: string }> {
  const res = await request<{ ok: boolean; triage: { severity: string; domain: string; rationale: string } }>(
    `${BASE}/clef/triage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error_text: errorText }),
    }
  );
  return res.triage;
}

export async function fetchNeuronRules(workspaceId = 'default', project?: string): Promise<NeuronRule[]> {
  const query = new URLSearchParams({ workspace_id: workspaceId });
  if (project) query.set('project', project);
  const res = await request<{ ok: boolean; rules: NeuronRule[] }>(`${BASE}/neuron/rules?${query.toString()}`);
  return res.rules;
}

export async function createNeuronRule(input: CreateNeuronRuleInput): Promise<NeuronRule> {
  const res = await request<{ ok: boolean; rule: NeuronRule }>(`${BASE}/neuron/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.rule;
}

export async function updateNeuronRule(
  id: string,
  updates: { is_active?: boolean; confidence_score?: number }
): Promise<NeuronRule> {
  const res = await request<{ ok: boolean; rule: NeuronRule }>(`${BASE}/neuron/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return res.rule;
}

export async function deleteNeuronRule(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`${BASE}/neuron/rules/${id}`, {
    method: 'DELETE',
  });
}

export async function syncNeuronMarkdown(): Promise<{ ok: boolean; count: number }> {
  return request<{ ok: boolean; count: number }>(`${BASE}/neuron/sync-markdown`, {
    method: 'POST',
  });
}

