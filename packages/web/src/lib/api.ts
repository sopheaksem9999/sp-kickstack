import {
  Workspace,
  Project,
  Requirement,
  BridgeTask,
  Link,
  BridgeEvent,
  CreateRequirementInput,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  BranchMergeSettings,
  RequirementStatus,
} from '@sp-kickstack/shared';

const BASE = '/api';

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

export async function deleteWorkspace(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/workspaces/${id}`, { method: 'DELETE' });
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
  const res = await fetch(`${BASE}/projects/${name}/test`, { method: 'POST' });
  return res.json();
}

export async function fetchRequirements(workspaceId?: string): Promise<Requirement[]> {
  const url = workspaceId && workspaceId !== 'all'
    ? `${BASE}/requirements?workspace=${encodeURIComponent(workspaceId)}`
    : `${BASE}/requirements`;
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
  const res = await fetch(`${BASE}/requirements/${id}/ready`, { method: 'POST' });
  return res.json();
}

export async function cancelRequirement(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/requirements/${id}/cancel`, { method: 'POST' });
  return res.json();
}

export async function fetchRequirementGraph(id: string): Promise<{ tasks: BridgeTask[]; links: Link[] }> {
  const res = await fetch(`${BASE}/requirements/${id}/graph`);
  return res.json();
}

export async function markTaskDone(taskId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/tasks/${taskId}/mark-done`, { method: 'POST' });
  return res.json();
}

export async function releaseLink(linkId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/links/${linkId}/release`, { method: 'POST' });
  return res.json();
}

export async function fetchNotifications(): Promise<BridgeEvent[]> {
  const res = await fetch(`${BASE}/notifications`);
  return res.json();
}

export async function fetchSettings(): Promise<{ branch_merge: BranchMergeSettings }> {
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

export async function updateRequirementStatus(id: string, status: RequirementStatus): Promise<Requirement> {
  const res = await fetch(`${BASE}/requirements/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Failed to update requirement status');
  return res.json();
}

export async function mergeRequirementToMain(id: string): Promise<{ ok: boolean; status: string; merged_branch: string }> {
  const res = await fetch(`${BASE}/requirements/${id}/merge-to-main`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to merge requirement to main');
  return res.json();
}
