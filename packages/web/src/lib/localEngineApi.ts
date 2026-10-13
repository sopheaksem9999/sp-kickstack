import type { LocalEngineSettings, LocalEngineStatus } from '@sp-kickstack/shared';
import { BASE } from './api.js';

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function fetchLocalEngineSettings(): Promise<LocalEngineSettings> {
  return request(`${BASE}/settings/local-engine`);
}

export function saveLocalEngineSettings(patch: Partial<LocalEngineSettings>): Promise<LocalEngineSettings> {
  return request(`${BASE}/settings/local-engine`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function fetchLocalEngineStatus(): Promise<LocalEngineStatus> {
  return request(`${BASE}/local-engine/status`);
}
