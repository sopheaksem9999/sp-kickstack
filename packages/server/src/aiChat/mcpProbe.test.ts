import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { probeMcpServer } from './mcpProbe.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../testing/fakeMcpServer.mjs');
const stdio = (args: string[], env: Record<string, string> = {}) => ({ transport: 'stdio' as const, command: process.execPath, args: [FAKE, ...args], env, headers: {} });

let server: http.Server | null = null;
afterEach(() => server?.close());

/** An http MCP server answering JSON or event-stream; checks the session header after initialize. */
async function httpServer(kind: 'json' | 'sse' | '401'): Promise<string> {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (kind === '401') return res.writeHead(401).end();
      const msg = JSON.parse(body);
      if (msg.id === undefined) return res.writeHead(202).end();
      if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== 's-1') return res.writeHead(400).end();
      const answer = msg.method === 'initialize'
        ? { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'h', version: '1' } } }
        : { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } };
      if (kind === 'sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 's-1' }).end(`event: message\ndata: ${JSON.stringify(answer)}\n\n`);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's-1' }).end(JSON.stringify(answer));
      }
    });
  });
  await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;
}

describe('MCP server test', () => {
  it('counts the tools of a stdio server', async () => {
    expect(await probeMcpServer(stdio([]))).toEqual({ ok: true, tools: 2 });
    expect(await probeMcpServer(stdio(['--tools=5']))).toEqual({ ok: true, tools: 5 });
  });

  it("passes the server's environment variables", async () => {
    expect(await probeMcpServer(stdio(['--require-env=JIRA_TOKEN'], { JIRA_TOKEN: 'x' }))).toEqual({ ok: true, tools: 2 });
    expect(await probeMcpServer(stdio(['--require-env=JIRA_TOKEN']))).toEqual({ ok: false, error: 'exited with code 4: missing JIRA_TOKEN' });
  });

  it('reports a crash, a missing command and a server that never answers', async () => {
    expect(await probeMcpServer(stdio(['--crash']))).toEqual({ ok: false, error: 'exited with code 3' });
    const missing = await probeMcpServer({ transport: 'stdio', command: 'sp-no-such-command', args: [], env: {}, headers: {} });
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain('ENOENT');
    expect(await probeMcpServer(stdio(['--hang']), 1000)).toEqual({ ok: false, error: 'no answer within 1 s' });
  });

  it('talks to an http server answering JSON or an event stream', async () => {
    expect(await probeMcpServer({ transport: 'http', url: await httpServer('json'), args: [], env: {}, headers: {} })).toEqual({ ok: true, tools: 3 });
    server!.close();
    expect(await probeMcpServer({ transport: 'http', url: await httpServer('sse'), args: [], env: {}, headers: {} })).toEqual({ ok: true, tools: 3 });
    server!.close();
    expect(await probeMcpServer({ transport: 'http', url: await httpServer('401'), args: [], env: {}, headers: {} })).toEqual({
      ok: false,
      error: 'HTTP 401 (check the headers / token)',
    });
  });
});
