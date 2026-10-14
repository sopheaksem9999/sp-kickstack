// Settings → AI Chat → Test: connect like an MCP client (initialize, then tools/list) and count the tools.
import { spawn } from 'node:child_process';
import type { AiChatMcpServer } from '@sp-kickstack/shared';
import { oneLine } from '../lib/promptSafety.js';

export type ProbeResult = { ok: true; tools: number } | { ok: false; error: string };
type Target = Pick<AiChatMcpServer, 'transport' | 'command' | 'args' | 'env' | 'url' | 'headers'>;

const initialize = (id: number) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sp-kickstack', version: '1' } },
});
const listTools = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const seconds = (ms: number) => `no answer within ${Math.round(ms / 1000)} s`;

export async function probeMcpServer(server: Target, timeoutMs = 15_000): Promise<ProbeResult> {
  try {
    const tools = server.transport === 'http' ? await probeHttp(server, timeoutMs) : await probeStdio(server, timeoutMs);
    return { ok: true, tools };
  } catch (err: any) {
    return { ok: false, error: oneLine(err?.message || String(err), 300) };
  }
}

function probeStdio(server: Target, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(server.command ?? '', server.args ?? [], { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let buffer = '';
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(seconds(timeoutMs)))), timeoutMs);
    const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    child.on('error', (err) => finish(() => reject(err)));
    child.on('exit', (code) => {
      const last = stderr.trim().split('\n').pop();
      finish(() => reject(new Error(`exited with code ${code}${last ? `: ${last}` : ''}`)));
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.on('error', () => undefined);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) return finish(() => reject(new Error(msg.error.message ?? 'initialize failed')));
          send(initialized);
          send(listTools(2));
        } else if (msg.id === 2) {
          if (msg.error) return finish(() => reject(new Error(msg.error.message ?? 'tools/list failed')));
          return finish(() => resolve(Array.isArray(msg.result?.tools) ? msg.result.tools.length : 0));
        }
      }
    });
    send(initialize(1));
  });
}

async function probeHttp(server: Target, timeoutMs: number): Promise<number> {
  const signal = AbortSignal.timeout(timeoutMs);
  let session: string | null = null;
  const post = async (body: object): Promise<any> => {
    const res = await fetch(server.url ?? '', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session ? { 'Mcp-Session-Id': session } : {}),
        ...server.headers,
      },
      body: JSON.stringify(body),
    });
    session = res.headers.get('mcp-session-id') ?? session;
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (check the headers / token)' : ''}`);
    const text = await res.text();
    if (!text.trim()) return null;
    const messages = (res.headers.get('content-type') ?? '').includes('text/event-stream')
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(text)];
    return messages.find((m) => m && 'id' in m && (m.result || m.error)) ?? null;
  };
  try {
    const init = await post(initialize(1));
    if (!init || init.error) throw new Error(init?.error?.message ?? 'no answer to initialize');
    await post(initialized);
    const list = await post(listTools(2));
    if (!list || list.error) throw new Error(list?.error?.message ?? 'no answer to tools/list');
    return Array.isArray(list.result?.tools) ? list.result.tools.length : 0;
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new Error(seconds(timeoutMs));
    throw err;
  }
}
