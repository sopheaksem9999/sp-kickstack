import type { AiQaSettings, RequirementQa } from '@sp-kickstack/shared';
import { BASE } from './api.js';

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function fetchRequirementQa(reqId: string): Promise<RequirementQa> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/qa`);
}

export function runAiQa(reqId: string): Promise<RequirementQa> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/qa`, { method: 'POST' });
}

export function fetchAiQaSettings(): Promise<AiQaSettings> {
  return request(`${BASE}/settings/ai-qa`);
}

export function saveAiQaSettings(patch: Partial<AiQaSettings>): Promise<AiQaSettings> {
  return request(`${BASE}/settings/ai-qa`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
