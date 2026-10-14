import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import type { AiChatMcpServer, AiChatSkill } from '@sp-kickstack/shared';
import { agyChatArgs, claudeChatArgs, countTools, requestedSkills, skillsPrompt, SKILLS_PROMPT_MAX, toolLabel, writeMcpConfig } from './chatTools.js';

const jira: AiChatMcpServer = { name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: ['jira-mcp'], env: { T: 's' }, headers: {} };
const figma: AiChatMcpServer = { name: 'figma', enabled: true, transport: 'http', url: 'https://f/mcp', args: [], env: {}, headers: { Authorization: 'Bearer x' } };
const skill = (name: string, over: Partial<AiChatSkill> = {}): AiChatSkill => ({ name, description: `when ${name}`, body: `do ${name}`, mode: 'on_request', enabled: true, ...over });

describe('chat tools', () => {
  it('writes an owner-only MCP config file and removes it', () => {
    const config = writeMcpConfig([jira, figma]);
    expect((fs.statSync(config.file).mode & 0o777).toString(8)).toBe('600');
    expect(JSON.parse(fs.readFileSync(config.file, 'utf8'))).toEqual({
      mcpServers: {
        jira: { type: 'stdio', command: 'npx', args: ['jira-mcp'], env: { T: 's' } },
        figma: { type: 'http', url: 'https://f/mcp', headers: { Authorization: 'Bearer x' } },
      },
    });
    config.cleanup();
    expect(fs.existsSync(config.file)).toBe(false);
  });

  it('builds Claude Code arguments: strict servers, or today\'s command without servers', () => {
    expect(claudeChatArgs({ prompt: 'P', servers: [jira, figma], mcpFile: '/t/mcp.json', permission: 'allowed-tools', model: 'sonnet' })).toEqual([
      '-p', 'P', '--output-format', 'stream-json', '--verbose', '--tools', '', '--mcp-config', '/t/mcp.json', '--strict-mcp-config',
      '--allowedTools', 'mcp__jira', 'mcp__figma', '--model', 'sonnet',
    ]);
    expect(claudeChatArgs({ prompt: 'P', servers: [jira], mcpFile: '/t/mcp.json', permission: 'bypass' })).toContain('bypassPermissions');
    expect(claudeChatArgs({ prompt: 'P', servers: [], permission: 'allowed-tools', sessionId: 'chat-1' })).toEqual(['-p', 'P', '--tools', '']);
  });

  it('builds AGY arguments for each mode', () => {
    expect(agyChatArgs({ prompt: 'P', mode: 'native' })).toEqual(['-p', 'P', '--output-format', 'stream-json']);
    expect(agyChatArgs({ prompt: 'P', mode: 'off', model: 'gemini-3-pro' })).toEqual(['-p', 'P', '--output-format', 'stream-json', '--model', 'gemini-3-pro']);
    expect(agyChatArgs({ prompt: 'P', mode: 'sandbox' })).toContain('--sandbox');
    expect(agyChatArgs({ prompt: 'P', mode: 'skip-permissions-sandboxed', effort: 'high' })).toEqual([
      '-p', 'P', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--sandbox', '--effort', 'high',
    ]);
  });

  it('finds /skill requests: enabled skills only, at a word start, not paths', () => {
    const skills = [skill('api-contract'), skill('old-skill', { enabled: false }), skill('api')];
    expect(requestedSkills('Draft it /api-contract please', skills)).toEqual(['api-contract']);
    expect(requestedSkills('see /api/users and /old-skill', skills)).toEqual([]);
    expect(requestedSkills('/api, then /api-contract.', skills)).toEqual(['api', 'api-contract']);
  });

  it('puts requested and Always skills into the prompt, capped, imported text marked untrusted', () => {
    const skills = [skill('house', { mode: 'always' }), skill('api-contract', { sourcePath: '/s/SKILL.md' }), skill('unused')];
    const text = skillsPrompt(skills, ['api-contract']);
    expect(text).toContain('## Skills');
    expect(text.indexOf('### api-contract')).toBeLessThan(text.indexOf('### house'));
    expect(text).toContain('<untrusted_input name="skill api-contract">\ndo api-contract\n</untrusted_input>');
    expect(text).not.toContain('unused');
    expect(skillsPrompt([skill('a', { mode: 'always' })], [])).toContain('### a — when a\ndo a');
    expect(skillsPrompt([skill('x', { mode: 'always', enabled: false })], [])).toBe('');
    const big = skillsPrompt([skill('huge', { mode: 'always', body: 'x'.repeat(SKILLS_PROMPT_MAX) }), skill('small', { mode: 'always' })], []);
    expect(big).toContain('### small');
    expect(big).toContain('(not included: too long) huge');
  });

  it('labels tools as server.tool and counts them', () => {
    expect(toolLabel('mcp__jira__search_issues')).toBe('jira.search_issues');
    expect(toolLabel('sp-jira/search')).toBe('jira.search');
    expect(toolLabel('sp-probe/echo')).toBe('probe.echo');
    expect(toolLabel('Bash')).toBe('Bash');
    expect(countTools(['mcp__jira__search', 'mcp__figma__frame', 'mcp__jira__search'])).toEqual([
      { tool: 'jira.search', count: 2 },
      { tool: 'figma.frame', count: 1 },
    ]);
  });
});
