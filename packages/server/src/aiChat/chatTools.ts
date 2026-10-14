// AI Chat turns with the MCP servers and skills from Settings → AI Chat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AiChatMcpServer, AiChatSkill, AiChatToolUse } from '@sp-kickstack/shared';
import { wrapUntrusted } from '../lib/promptSafety.js';
import { agyParser, claudeParser } from '../localEngine/outputParsers.js';
import type { AgyChatMcpMode, ClaudeChatPermission } from './cliModes.js';

export const SKILLS_PROMPT_MAX = 30_000;

export const enabledServers = (servers: AiChatMcpServer[]) => servers.filter((s) => s.enabled);

export function claudeMcpConfig(servers: AiChatMcpServer[]) {
  return {
    mcpServers: Object.fromEntries(
      servers.map((s): [string, Record<string, unknown>] => [
        s.name,
        s.transport === 'http' ? { type: 'http', url: s.url, headers: s.headers } : { type: 'stdio', command: s.command, args: s.args, env: s.env },
      ])
    ),
  };
}

/** One turn's MCP config (it holds secrets): owner-only; call cleanup() in finally. */
export function writeMcpConfig(servers: AiChatMcpServer[]): { dir: string; file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-chat-mcp-'));
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify(claudeMcpConfig(servers)), { mode: 0o600 });
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A chat's own empty folder: the CLI runs there (not in the bridge's folder) and keeps its conversation. */
export function chatFolder(sessionId?: string): string {
  const dir = path.join(os.tmpdir(), 'sp-kickstack-chat', sessionId || 'once');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Claude Code (like AGY) gets the whole conversation in the prompt each turn; do not pass --session-id (requires UUID and causes history duplication). */
export function claudeChatArgs(o: {
  prompt: string;
  servers: AiChatMcpServer[];
  mcpFile?: string;
  permission: ClaudeChatPermission;
  sessionId?: string;
  model?: string | null;
  effort?: string | null;
}): string[] {
  const tools =
    o.mcpFile && o.servers.length
      ? [
          '--output-format', 'stream-json', '--verbose', '--tools', '', '--mcp-config', o.mcpFile, '--strict-mcp-config',
          ...(o.permission === 'bypass' ? ['--permission-mode', 'bypassPermissions'] : ['--allowedTools', ...o.servers.map((s) => `mcp__${s.name}`)]),
        ]
      : ['--tools', ''];
  return [
    '-p', o.prompt, ...tools,
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
  ];
}

/** AGY gets the whole conversation in the prompt each turn (a chat id is not an AGY conversation id). */
export function agyChatArgs(o: { prompt: string; mode: AgyChatMcpMode; model?: string | null; effort?: string | null }): string[] {
  const permission =
    o.mode === 'skip-permissions-sandboxed' ? ['--dangerously-skip-permissions', '--sandbox'] : o.mode === 'sandbox' ? ['--sandbox'] : [];
  return [
    '-p', o.prompt, '--output-format', 'stream-json', ...permission,
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
  ];
}

/** `/name` of enabled skills, at the start of a word and not followed by `/` (so `/api/users` is not one). */
export function requestedSkills(text: string, skills: AiChatSkill[]): string[] {
  const enabled = new Set(skills.filter((s) => s.enabled).map((s) => s.name));
  const names: string[] = [];
  for (const match of text.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]{0,39})(?=$|[\s.,;:!?)])/g)) {
    if (enabled.has(match[1]) && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** "## Skills": requested skills first, then Always ones, at most SKILLS_PROMPT_MAX characters. */
export function skillsPrompt(skills: AiChatSkill[], requested: string[]): string {
  const enabled = skills.filter((s) => s.enabled);
  const chosen = [
    ...requested.map((name) => enabled.find((s) => s.name === name)).filter((s): s is AiChatSkill => Boolean(s)),
    ...enabled.filter((s) => s.mode === 'always' && !requested.includes(s.name)),
  ];
  if (chosen.length === 0) return '';
  const parts: string[] = [];
  const left: string[] = [];
  let size = 0;
  for (const s of chosen) {
    const body = s.sourcePath ? wrapUntrusted(`skill ${s.name}`, s.body) : s.body;
    const part = `### ${s.name}${s.description ? ` — ${s.description}` : ''}\n${body}`;
    if (size + part.length > SKILLS_PROMPT_MAX) {
      left.push(s.name);
      continue;
    }
    parts.push(part);
    size += part.length;
  }
  return `## Skills\n${parts.join('\n\n')}${left.length ? `\n\n(not included: too long) ${left.join(', ')}` : ''}`;
}

const PAGE_MARKERS = ['--- Page Grounding Context ---', '[Active Webpage Context]'];

/** The browser sidebar adds the visited page's text to a message: mark that part as untrusted. */
export function untrustedPage(content: string): string {
  const at = Math.min(...PAGE_MARKERS.map((m) => content.indexOf(m)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return content;
  return `${content.slice(0, at)}${wrapUntrusted('web page', content.slice(at).trimEnd())}`;
}

/** `mcp__jira__search` → `jira.search`; `sp-jira/search` (AGY) → `jira.search`; others as they are. */
export function toolLabel(raw: string): string {
  const name = raw.trim();
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `${mcp[1].replace(/^sp-/, '')}.${mcp[2]}`;
  const split = /^([^/.:]+)[/.:](.+)$/.exec(name);
  return split ? `${split[1].replace(/^sp-/, '')}.${split[2]}` : name;
}

export function countTools(names: string[]): AiChatToolUse[] {
  const counts = new Map<string, number>();
  for (const label of names.map(toolLabel)) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([tool, count]) => ({ tool, count }));
}

/** The reply text, tool names and the CLI's own error from a stream-json run. */
export function readChatStream(cli: 'claude-cli' | 'agy-cli', stdout: string): { reply: string | null; tools: string[]; error?: string } {
  const parser = cli === 'claude-cli' ? claudeParser() : agyParser();
  const tools: string[] = [];
  let reply: string | null = null;
  let error: string | undefined;
  for (const out of [...stdout.split('\n').filter((l) => l.trim()).map((l) => parser.push(l.trim())), parser.flush()]) {
    tools.push(...(out.tools ?? []));
    if (out.reply !== undefined) reply = out.reply;
    if (out.error) error = out.error;
  }
  return { reply, tools, error };
}
