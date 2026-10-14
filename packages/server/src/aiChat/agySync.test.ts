import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiChatMcpServer } from '@sp-kickstack/shared';
import { agyInfo, parseAgyList, syncAgy } from './agySync.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../testing/fakeAgyCli.mjs');
let dir: string;
const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as Array<{ name: string; target: string }>;
const calls = () => fs.readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const server = (name: string, over: Partial<AiChatMcpServer> = {}): AiChatMcpServer => ({
  name, enabled: true, transport: 'stdio', command: 'npx', args: ['-y', `${name}-mcp`], env: {}, headers: {}, ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-agy-'));
  process.env.FAKE_AGY_STATE = path.join(dir, 'state.json');
  process.env.FAKE_AGY_LOG = path.join(dir, 'log');
  delete process.env.FAKE_AGY_FAIL;
  fs.writeFileSync(process.env.FAKE_AGY_STATE, JSON.stringify([
    { name: 'jira', type: 'stdio', target: 'my-own-jira' },
    { name: 'sp-old', type: 'stdio', target: 'gone' },
  ]));
});

describe("AGY's MCP list", () => {
  it('reads the list AGY prints', async () => {
    expect(parseAgyList('NAME   TYPE   STATUS   COMMAND/URL\ngoogle-developer-knowledge  http   enabled  https://x/mcp\n')).toEqual([
      { name: 'google-developer-knowledge', type: 'http', status: 'enabled', target: 'https://x/mcp' },
    ]);
    expect(await agyInfo(FAKE, true)).toMatchObject({ detected: true, usesMcp: true, servers: [{ name: 'jira' }, { name: 'sp-old' }] });
    expect(await agyInfo(null, true)).toEqual({ detected: false, usesMcp: true, servers: [] });
  });

  it('adds enabled servers as sp-<name>, removes stale sp- entries and never touches the rest', async () => {
    const result = await syncAgy(FAKE, [
      server('jira', { env: { TOKEN: 't-1' } }),
      server('figma', { transport: 'http', command: undefined, args: [], url: 'https://mcp.figma.com/mcp', headers: { Authorization: 'Bearer x' } }),
      server('sentry', { enabled: false }),
    ], true, () => 'T');
    expect(result).toEqual({ ok: true, message: "AGY's list updated: 2 added or updated, 1 removed", at: 'T' });
    expect(state().map((s) => s.name)).toEqual(['jira', 'sp-jira', 'sp-figma']);
    expect(state()[0].target).toBe('my-own-jira');
    expect(calls()).toEqual(expect.arrayContaining([
      ['mcp', 'add', '--env', 'TOKEN=t-1', 'sp-jira', '--', 'npx', '-y', 'jira-mcp'],
      ['mcp', 'add', '--header', 'Authorization: Bearer x', 'sp-figma', 'https://mcp.figma.com/mcp'],
      ['mcp', 'remove', 'sp-old'],
    ]));
  });

  it("leaves AGY's list alone when AGY chats do not use MCP tools", async () => {
    const result = await syncAgy(FAKE, [server('jira')], false, () => 'T');
    expect(result).toEqual({ ok: true, message: "AGY chats do not use MCP tools on this PC; AGY's list was not changed", at: 'T' });
    expect(state().map((s) => s.name)).toEqual(['jira', 'sp-old']);
    expect(fs.existsSync(path.join(dir, 'log'))).toBe(false);
  });

  it('reports AGY missing or failing', async () => {
    expect(await syncAgy(null, [server('jira')], true, () => 'T')).toEqual({ ok: false, message: 'AGY not detected', at: 'T' });
    process.env.FAKE_AGY_FAIL = 'boom';
    expect(await syncAgy(FAKE, [server('jira')], true, () => 'T')).toEqual({ ok: false, message: "Could not update AGY's list: boom", at: 'T' });
  });
});
