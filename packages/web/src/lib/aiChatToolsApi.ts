import type { AiChatAgySync, AiChatImportResult, AiChatServerStatus, AiChatSkill, AiChatToolsUpdateInput, AiChatToolsView } from '@sp-kickstack/shared';
import { BASE } from './api.js';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const fetchAiChatTools = () => request<AiChatToolsView>(`${BASE}/ai-chat/tools`);
export const saveAiChatTools = (input: AiChatToolsUpdateInput) => request<AiChatToolsView>(`${BASE}/ai-chat/tools`, send('PUT', input));
export const testAiChatServer = (name: string) => request<AiChatServerStatus>(`${BASE}/ai-chat/tools/servers/${encodeURIComponent(name)}/test`, send('POST'));
export const importMcpJson = (json: string) => request<AiChatImportResult>(`${BASE}/ai-chat/tools/import-mcp-json`, send('POST', { json }));
export const importSkillsFolder = (folder: string) => request<AiChatImportResult>(`${BASE}/ai-chat/tools/import-skills`, send('POST', { folder }));
export const reimportSkill = (name: string) => request<AiChatSkill>(`${BASE}/ai-chat/tools/skills/${encodeURIComponent(name)}/reimport`, send('POST'));
export const syncAgyList = () => request<AiChatAgySync>(`${BASE}/ai-chat/tools/agy-sync`, send('POST'));
