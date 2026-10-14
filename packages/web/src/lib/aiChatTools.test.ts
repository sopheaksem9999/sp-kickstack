import { describe, it, expect } from 'vitest';
import type { AiChatToolsView } from '@sp-kickstack/shared';
import {
  importSummary, isChatCommand, secretRows, secretsFromRows, serverBadge, serverProblem, serverSummary, skillProblem, skillSlashCommands, toUpdate, toolsUsedText,
} from './aiChatTools';

const view: AiChatToolsView = {
  timeLimitSeconds: 120,
  servers: [{ name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: ['-y', 'jira-mcp'], env: { TOKEN: { set: true } }, headers: {}, status: { ok: true, tools: 12, checkedAt: 'T' } }],
  skills: [
    { name: 'api-contract', description: 'When writing an API', body: 'x', mode: 'on_request', enabled: true },
    { name: 'house', description: '', body: 'y', mode: 'always', enabled: true },
    { name: 'off', description: '', body: 'z', mode: 'on_request', enabled: false },
  ],
  agy: { detected: false, usesMcp: true, servers: [] },
};

describe('AI Chat tools helpers', () => {
  it('shows a server as a badge and a one-line summary', () => {
    expect(serverBadge(view.servers[0])).toEqual({ tone: 'ok', text: 'Connected · 12 tools' });
    expect(serverBadge({ ...view.servers[0], status: { ok: false, tools: 0, error: 'spawn npx ENOENT', checkedAt: 'T' } })).toEqual({ tone: 'error', text: 'Failed: spawn npx ENOENT' });
    expect(serverBadge({ ...view.servers[0], status: undefined })).toEqual({ tone: 'idle', text: 'Not tested' });
    expect(serverSummary(view.servers[0])).toBe('npx -y jira-mcp');
    expect(serverSummary({ ...view.servers[0], transport: 'http', url: 'https://f/mcp' })).toBe('https://f/mcp');
  });

  it('checks a server and a skill before saving', () => {
    expect(serverProblem({ name: 'my server', transport: 'stdio', command: 'x' }, [])).toBe('Server names use letters, digits, - and _ (up to 40)');
    expect(serverProblem({ name: 'jira', transport: 'stdio', command: 'x' }, ['jira'])).toBe('A server named jira already exists');
    expect(serverProblem({ name: 'a', transport: 'stdio', command: ' ' }, [])).toBe('A stdio server needs a command');
    expect(serverProblem({ name: 'a', transport: 'http', url: 'mcp.figma.com' }, [])).toBe('An http server needs a URL starting with http:// or https://');
    expect(serverProblem({ name: 'a', transport: 'http', url: 'https://x' }, [])).toBeNull();
    expect(skillProblem('API', [])).toBe('Skill names use lowercase letters, digits and - (up to 40)');
    expect(skillProblem('create', [])).toBe('/create is a chat command; choose another name');
    expect(skillProblem('house', ['house'])).toBe('A skill named house already exists');
  });

  it('matches chat commands as whole words and keeps their names away from skills', () => {
    expect(isChatCommand('/create', 'create')).toBe(true);
    expect(isChatCommand('  /Create split by module', 'create')).toBe(true);
    expect(isChatCommand('/create-migration add a table', 'create')).toBe(false);
    expect(isChatCommand('/clear-writing tidy this', 'clear')).toBe(false);
    expect(skillProblem('clear', [])).toBe('/clear is a chat command; choose another name');
    expect(skillProblem('docx', [], 'x'.repeat(1025))).toBe('When to use is at most 1024 characters');
    expect(skillProblem('docx', [], 'x'.repeat(1024))).toBeNull();
  });

  it('turns secrets into editable rows and back, keeping untouched ones as { set: true }', () => {
    const rows = secretRows({ TOKEN: { set: true }, SITE: 'acme' });
    expect(rows).toEqual([{ key: 'TOKEN', value: '', kept: true }, { key: 'SITE', value: 'acme', kept: false }]);
    expect(secretsFromRows([...rows, { key: '', value: 'x', kept: false }])).toEqual({ TOKEN: { set: true }, SITE: 'acme' });
    expect(secretsFromRows([{ key: 'TOKEN', value: 'new', kept: false }])).toEqual({ TOKEN: 'new' });
  });

  it('builds the save body without test results', () => {
    expect(toUpdate(view)).toEqual({
      timeLimitSeconds: 120,
      servers: [{ name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: ['-y', 'jira-mcp'], env: { TOKEN: { set: true } }, url: undefined, headers: {} }],
      skills: view.skills,
    });
  });

  it('words imports, tools used and /skill commands', () => {
    expect(importSummary({ added: ['figma', 'fs'], skipped: [{ name: 'jira', reason: 'already exists' }] })).toBe('Added figma, fs. Skipped jira (already exists).');
    expect(importSummary({ added: [], skipped: [] })).toBe('Nothing to add.');
    expect(toolsUsedText([{ tool: 'jira.search_issues', count: 2 }, { tool: 'figma.get_frame', count: 1 }])).toBe('jira.search_issues ×2, figma.get_frame');
    expect(toolsUsedText(undefined)).toBeNull();
    expect(skillSlashCommands(view.skills)).toEqual([{ id: 'skill-api-contract', command: '/api-contract', title: 'api-contract', description: 'When writing an API' }]);
  });
});
