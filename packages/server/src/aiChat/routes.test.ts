import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { FanOutService } from '../services/fanOutService.js';
import { LinkService } from '../services/linkService.js';
import { TicketService } from '../services/ticketService.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { SettingsService } from '../services/settingsService.js';
import { ManualAdapter } from '../adapters/manualAdapter.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { AiChatToolsService } from './toolsService.js';

function app() {
  const db = initDatabase(':memory:');
  const settings = new SettingsService(db);
  const syncs: string[][] = [];
  const aiChatTools = new AiChatToolsService(settings, {
    now: () => 'T',
    probe: async () => ({ ok: false as const, error: 'spawn x ENOENT' }),
    agyInfo: async () => ({ detected: true, usesMcp: true, servers: [{ name: 'chrome-devtools-mcp', type: 'stdio', status: 'enabled', target: 'npx' }] }),
    syncAgy: async (servers) => { syncs.push(servers.map((s) => s.name)); return { ok: true, message: 'synced', at: 'T' }; },
  });
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db);
  const getAdapter = () => new ManualAdapter() as any;
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
  const express = createApp({
    db, workspaceService: new WorkspaceService(db), projectService, requirementService, fanOutService, linkService, ticketService,
    broadcaster: new SseBroadcaster(), notifier: new Notifier(), settingsService: settings, aiChatTools,
  });
  return { express, syncs };
}

describe('AI Chat tools API', () => {
  it('saves servers, masks secrets, syncs AGY and tests a server', async () => {
    const { express, syncs } = app();
    const saved = await testRequest(express, 'PUT', '/api/ai-chat/tools', {
      body: { servers: [{ name: 'jira', transport: 'stdio', command: 'npx', env: { TOKEN: 'secret' } }], skills: [] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.servers[0].env).toEqual({ TOKEN: { set: true } });
    expect(saved.body.agy.servers[0].name).toBe('chrome-devtools-mcp');
    expect(syncs).toEqual([['jira']]);
    expect(JSON.stringify((await testRequest(express, 'GET', '/api/ai-chat/tools')).body)).not.toContain('secret');
    expect((await testRequest(express, 'POST', '/api/ai-chat/tools/servers/jira/test')).body).toEqual({ ok: false, tools: 0, error: 'spawn x ENOENT', checkedAt: 'T' });
    expect((await testRequest(express, 'POST', '/api/ai-chat/tools/servers/nope/test')).status).toBe(404);
  });

  it('refuses a bad server, imports a .mcp.json and explains bad JSON', async () => {
    const { express } = app();
    expect((await testRequest(express, 'PUT', '/api/ai-chat/tools', { body: { servers: [{ name: 'x', transport: 'http' }] } })).status).toBe(400);
    const imported = await testRequest(express, 'POST', '/api/ai-chat/tools/import-mcp-json', { body: { json: '{"mcpServers":{"fs":{"command":"npx"}}}' } });
    expect(imported.body).toEqual({ added: ['fs'], skipped: [] });
    const bad = await testRequest(express, 'POST', '/api/ai-chat/tools/import-mcp-json', { body: { json: 'nope' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('Not a .mcp.json file');
    expect((await testRequest(express, 'POST', '/api/ai-chat/tools/agy-sync')).body).toEqual({ ok: true, message: 'synced', at: 'T' });
  });
});
