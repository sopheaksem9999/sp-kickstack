// AGY keeps one global MCP list (`agy mcp …`). The AI Chat adds its enabled servers there as
// `sp-<name>` and removes stale `sp-` entries; other entries are never touched.
import { execFile } from 'node:child_process';
import type { AiChatAgyInfo, AiChatAgySync, AiChatMcpServer } from '@sp-kickstack/shared';
import { oneLine } from '../lib/promptSafety.js';

const PREFIX = 'sp-';

export function runAgy(bin: string, args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

/** `agy mcp list` rows: NAME, TYPE, STATUS, COMMAND/URL separated by two or more spaces. */
export function parseAgyList(text: string): AiChatAgyInfo['servers'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('NAME'))
    .map((line) => {
      const [name, type = '', status = '', ...target] = line.split(/\s{2,}/);
      return { name, type, status, target: target.join('  ') };
    });
}

export async function agyInfo(bin: string | null, usesMcp: boolean): Promise<AiChatAgyInfo> {
  if (!bin) return { detected: false, usesMcp, servers: [] };
  try {
    return { detected: true, usesMcp, servers: parseAgyList(await runAgy(bin, ['mcp', 'list'])) };
  } catch (err: any) {
    return { detected: true, usesMcp, servers: [], error: oneLine(err?.message || String(err), 300) };
  }
}

export function agyAddArgs(server: AiChatMcpServer): string[] {
  const flags = [
    ...Object.entries(server.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    ...Object.entries(server.headers).flatMap(([key, value]) => ['--header', `${key}: ${value}`]),
  ];
  const name = `${PREFIX}${server.name}`;
  return server.transport === 'http'
    ? ['mcp', 'add', ...flags, name, server.url ?? '']
    : ['mcp', 'add', ...flags, name, '--', server.command ?? '', ...server.args];
}

export async function syncAgy(
  bin: string | null,
  servers: AiChatMcpServer[],
  usesMcp: boolean,
  now: () => string = () => new Date().toISOString()
): Promise<AiChatAgySync> {
  if (!bin) return { ok: false, message: 'AGY not detected', at: now() };
  // Nothing of ours is in AGY's list then; an sp- entry there is the person's own.
  if (!usesMcp) return { ok: true, message: "AGY chats do not use MCP tools on this PC; AGY's list was not changed", at: now() };
  try {
    const ours = parseAgyList(await runAgy(bin, ['mcp', 'list'])).map((s) => s.name).filter((name) => name.startsWith(PREFIX));
    const wanted = servers.filter((s) => s.enabled);
    for (const server of wanted) await runAgy(bin, agyAddArgs(server));
    const keep = new Set(wanted.map((s) => `${PREFIX}${s.name}`));
    const stale = ours.filter((name) => !keep.has(name));
    for (const name of stale) await runAgy(bin, ['mcp', 'remove', name]);
    return { ok: true, message: `AGY's list updated: ${wanted.length} added or updated, ${stale.length} removed`, at: now() };
  } catch (err: any) {
    return { ok: false, message: `Could not update AGY's list: ${oneLine(err?.message || String(err), 300)}`, at: now() };
  }
}
