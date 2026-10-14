import { AI_CHAT_RESERVED_SKILLS, AI_CHAT_SERVER_NAME, AI_CHAT_SKILL_NAME } from '@sp-kickstack/shared';
import type { AiChatImportResult, AiChatSecret, AiChatSkill, AiChatToolUse, AiChatToolsUpdateInput, AiChatToolsView } from '@sp-kickstack/shared';

export type ViewServer = AiChatToolsView['servers'][number];
export interface SecretRow {
  key: string;
  value: string;
  /** A stored secret left as it is (sent back as { set: true }). */
  kept: boolean;
}

export function serverBadge(server: ViewServer): { tone: 'ok' | 'error' | 'idle'; text: string } {
  if (!server.status) return { tone: 'idle', text: 'Not tested' };
  if (!server.status.ok) return { tone: 'error', text: `Failed: ${server.status.error ?? 'unknown error'}` };
  return { tone: 'ok', text: `Connected · ${server.status.tools} ${server.status.tools === 1 ? 'tool' : 'tools'}` };
}

export function serverSummary(server: ViewServer): string {
  return server.transport === 'http' ? server.url ?? '' : [server.command, ...server.args].filter(Boolean).join(' ');
}

export function serverProblem(server: { name: string; transport: 'stdio' | 'http'; command?: string; url?: string }, taken: string[]): string | null {
  if (!AI_CHAT_SERVER_NAME.test(server.name)) return 'Server names use letters, digits, - and _ (up to 40)';
  if (taken.includes(server.name)) return `A server named ${server.name} already exists`;
  if (server.transport === 'stdio' && !server.command?.trim()) return 'A stdio server needs a command';
  if (server.transport === 'http' && !/^https?:\/\/\S+$/.test(server.url?.trim() ?? '')) return 'An http server needs a URL starting with http:// or https://';
  return null;
}

export function skillProblem(name: string, taken: string[]): string | null {
  if (!AI_CHAT_SKILL_NAME.test(name)) return 'Skill names use lowercase letters, digits and - (up to 40)';
  if (AI_CHAT_RESERVED_SKILLS.includes(name)) return '/create is a chat command; choose another name';
  if (taken.includes(name)) return `A skill named ${name} already exists`;
  return null;
}

export function secretRows(values: Record<string, AiChatSecret>): SecretRow[] {
  return Object.entries(values).map(([key, value]) => (typeof value === 'string' ? { key, value, kept: false } : { key, value: '', kept: true }));
}

export function secretsFromRows(rows: SecretRow[]): Record<string, AiChatSecret> {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim())
      .map((row): [string, AiChatSecret] => [row.key.trim(), row.kept && row.value === '' ? { set: true } : row.value])
  );
}

export function toUpdate(view: AiChatToolsView): AiChatToolsUpdateInput {
  return {
    timeLimitSeconds: view.timeLimitSeconds,
    servers: view.servers.map((s) => ({
      name: s.name, enabled: s.enabled, transport: s.transport, command: s.command, args: s.args, env: s.env, url: s.url, headers: s.headers,
    })),
    skills: view.skills,
  };
}

export function importSummary(result: AiChatImportResult): string {
  const added = result.added.length ? `Added ${result.added.join(', ')}.` : '';
  const skipped = result.skipped.length ? `Skipped ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.` : '';
  return [added, skipped].filter(Boolean).join(' ') || 'Nothing to add.';
}

export function toolsUsedText(tools: AiChatToolUse[] | undefined): string | null {
  if (!tools?.length) return null;
  return tools.map((t) => (t.count > 1 ? `${t.tool} ×${t.count}` : t.tool)).join(', ');
}

/** On request skills for the chat's "/" menu. */
export function skillSlashCommands(skills: AiChatSkill[]): Array<{ id: string; command: string; title: string; description: string }> {
  return skills
    .filter((s) => s.enabled && s.mode === 'on_request')
    .map((s) => ({ id: `skill-${s.name}`, command: `/${s.name}`, title: s.name, description: s.description || 'Skill' }));
}
