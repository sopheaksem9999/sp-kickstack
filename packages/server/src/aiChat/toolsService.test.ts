import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from '../db/index.js';
import { SettingsService } from '../services/settingsService.js';
import { AiChatToolsService, type AiChatToolsOptions } from './toolsService.js';

const stdio = (name: string, env: Record<string, unknown> = {}) => ({ name, enabled: true, transport: 'stdio' as const, command: 'npx', args: ['-y', `${name}-mcp`], env: env as any, headers: {} });
const make = (options: AiChatToolsOptions = {}) => {
  const settings = new SettingsService(initDatabase(':memory:'));
  return { settings, tools: new AiChatToolsService(settings, { now: () => 'T', agyInfo: async () => ({ detected: false, usesMcp: true, servers: [] }), ...options }) };
};
const write = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

describe('AI Chat tools: secrets', () => {
  it('never shows secret values, and keeps them when sent back as { set: true }', async () => {
    const { tools } = make();
    tools.save({ servers: [stdio('jira', { TOKEN: 'secret-1', SITE: 'acme' })] });
    expect((await tools.view()).servers[0].env).toEqual({ TOKEN: { set: true }, SITE: { set: true } });
    tools.save({ servers: [stdio('jira', { TOKEN: { set: true }, SITE: 'acme2' })] });
    expect(tools.current().servers[0].env).toEqual({ TOKEN: 'secret-1', SITE: 'acme2' });
  });

  it('drops a kept secret of a renamed server instead of moving it', () => {
    const { tools } = make();
    tools.save({ servers: [stdio('jira', { TOKEN: 'secret-1' })] });
    tools.save({ servers: [stdio('jira2', { TOKEN: { set: true } })] });
    expect(tools.current().servers[0].env).toEqual({});
  });

  it('keeps the test result of an unchanged server and clears it when the connection changes', async () => {
    const { tools } = make({ probe: async () => ({ ok: true as const, tools: 4 }) });
    tools.save({ servers: [stdio('jira', { TOKEN: 'a' })] });
    expect(await tools.testServer('jira')).toEqual({ ok: true, tools: 4, checkedAt: 'T' });
    tools.save({ servers: [{ ...stdio('jira', { TOKEN: { set: true } }), enabled: false }] });
    expect(tools.current().servers[0].status).toEqual({ ok: true, tools: 4, checkedAt: 'T' });
    tools.save({ servers: [{ ...stdio('jira', { TOKEN: { set: true } }), command: 'node' }] });
    expect(tools.current().servers[0].status).toBeUndefined();
    await expect(tools.testServer('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('AI Chat tools: imports', () => {
  it('adds the servers of a pasted .mcp.json, skipping names that exist or break the rules', () => {
    const { tools } = make();
    tools.save({ servers: [stdio('jira')] });
    const result = tools.importMcpJson(JSON.stringify({
      mcpServers: {
        jira: { command: 'other' },
        figma: { type: 'http', url: 'https://mcp.figma.com/mcp', headers: { Authorization: 'Bearer ${FIGMA_TOKEN}' } },
        sentry: { type: 'sse', url: 'https://mcp.sentry.dev/sse' },
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/work'], env: { DEBUG: '1' } },
        'bad name': { command: 'x' },
      },
    }));
    expect(result).toEqual({
      added: ['figma', 'sentry', 'fs'],
      skipped: [{ name: 'jira', reason: 'already exists' }, { name: 'bad name', reason: 'Server names use letters, digits, - and _ (up to 40)' }],
    });
    const byName = (n: string) => tools.current().servers.find((s) => s.name === n);
    expect(byName('figma')).toMatchObject({ transport: 'http', headers: { Authorization: 'Bearer ${FIGMA_TOKEN}' } });
    expect(byName('sentry')).toMatchObject({ transport: 'http', url: 'https://mcp.sentry.dev/sse' });
    expect(byName('fs')).toMatchObject({ transport: 'stdio', env: { DEBUG: '1' } });
  });

  it('refuses text that is not a .mcp.json', () => {
    const { tools } = make();
    expect(() => tools.importMcpJson('nope')).toThrow('Not a .mcp.json file');
    expect(() => tools.importMcpJson('[]')).toThrow('Not a .mcp.json file');
  });

  it('imports every SKILL.md below a folder as an editable copy, and re-imports one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skill-import-'));
    write(dir, 'api-contract/SKILL.md', '---\nname: api-contract\ndescription: When writing an API contract\n---\n# API contract\nUse OpenAPI 3.1.\n');
    write(dir, 'Spec Review/SKILL.md', 'Check acceptance criteria.\n');
    write(dir, 'create/SKILL.md', 'x');
    const { tools } = make();
    expect(tools.importSkills(dir)).toEqual({
      added: ['api-contract', 'spec-review'],
      skipped: [{ name: 'create', reason: '/create is a chat command; choose another name' }],
    });
    expect(tools.current().skills.find((s) => s.name === 'api-contract')).toEqual({
      name: 'api-contract', description: 'When writing an API contract', body: '# API contract\nUse OpenAPI 3.1.',
      mode: 'on_request', enabled: true, sourcePath: path.join(dir, 'api-contract/SKILL.md'),
    });
    expect(tools.importSkills(dir).skipped.map((s) => s.name)).toEqual(['api-contract', 'create', 'spec-review']);

    write(dir, 'api-contract/SKILL.md', '---\nname: api-contract\ndescription: New wording\n---\nUse OpenAPI 3.2.\n');
    expect(tools.reimportSkill('api-contract')).toMatchObject({ description: 'New wording', body: 'Use OpenAPI 3.2.' });
  });

  it('explains a folder without SKILL.md and a skill that was not imported', () => {
    const { tools } = make();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skill-empty-'));
    expect(() => tools.importSkills(empty)).toThrow(`No SKILL.md found under ${empty}`);
    expect(() => tools.importSkills(path.join(empty, 'missing'))).toThrow('Folder not found');
    tools.save({ skills: [{ name: 'house-style', body: 'British spelling' }] });
    expect(() => tools.reimportSkill('house-style')).toThrow('house-style was not imported');
  });
});

describe('AI Chat tools: AGY', () => {
  it('syncs AGY with the current servers and remembers the result', async () => {
    const seen: string[][] = [];
    const { tools } = make({ syncAgy: async (servers) => { seen.push(servers.map((s) => s.name)); return { ok: true, message: 'done', at: 'T' }; } });
    tools.save({ servers: [stdio('jira')] });
    expect(await tools.syncAgy()).toEqual({ ok: true, message: 'done', at: 'T' });
    expect(seen).toEqual([['jira']]);
    expect(tools.current().agySync).toEqual({ ok: true, message: 'done', at: 'T' });
  });
});
