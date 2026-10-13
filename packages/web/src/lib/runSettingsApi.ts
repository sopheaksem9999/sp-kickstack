import type { Requirement, UpdateRunSettingsInput } from '@sp-kickstack/shared';
import { BASE } from './api.js';

export interface BranchEntry {
  name: string;
  projects: string[];
}

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function saveRunSettings(reqId: string, input: UpdateRunSettingsInput): Promise<Requirement> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/run-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function fetchBranches(projects: string[]): Promise<BranchEntry[]> {
  return request(`${BASE}/branches?projects=${encodeURIComponent(projects.join(','))}`);
}
