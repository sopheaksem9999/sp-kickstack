import {
  Project,
  Requirement,
  BridgeTask,
  Link,
  BridgeEvent,
  CreateRequirementInput,
} from '@sp-kickstack/shared';

const BASE = '/api';

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${BASE}/projects`);
  return res.json();
}

export async function testProjectConnection(name: string): Promise<{ ok: boolean; status: string }> {
  const res = await fetch(`${BASE}/projects/${name}/test`, { method: 'POST' });
  return res.json();
}

export async function fetchRequirements(): Promise<Requirement[]> {
  const res = await fetch(`${BASE}/requirements`);
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
