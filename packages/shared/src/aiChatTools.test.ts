import { describe, it, expect } from 'vitest';
import { AiChatToolsSettingsSchema, AiChatToolsUpdateInputSchema } from './schemas.js';

describe('AI Chat tools settings', () => {
  it('starts empty with a 120 s time limit', () => {
    expect(AiChatToolsSettingsSchema.parse({})).toEqual({ timeLimitSeconds: 120, servers: [], skills: [] });
  });

  it('needs a command for stdio and an http(s) URL for http', () => {
    const ok = (server: object) => AiChatToolsSettingsSchema.safeParse({ servers: [server] }).success;
    expect(ok({ name: 'jira', transport: 'stdio' })).toBe(false);
    expect(ok({ name: 'figma', transport: 'http', url: 'ftp://x' })).toBe(false);
    expect(ok({ name: 'jira', transport: 'stdio', command: 'npx', args: ['-y', 'jira-mcp'] })).toBe(true);
    expect(ok({ name: 'figma', transport: 'http', url: 'https://mcp.figma.com/mcp' })).toBe(true);
  });

  it('checks names: server and skill rules, no duplicates, /create reserved', () => {
    const ok = (value: object) => AiChatToolsSettingsSchema.safeParse(value).success;
    expect(ok({ servers: [{ name: 'my server', transport: 'stdio', command: 'x' }] })).toBe(false);
    expect(ok({ servers: [{ name: 'a', transport: 'stdio', command: 'x' }, { name: 'a', transport: 'stdio', command: 'y' }] })).toBe(false);
    expect(ok({ skills: [{ name: 'API Contract' }] })).toBe(false);
    expect(ok({ skills: [{ name: 'create' }] })).toBe(false);
    expect(ok({ skills: [{ name: 'api-contract', description: 'When writing an API', body: 'Use OpenAPI 3.1' }] })).toBe(true);
  });

  it('takes a kept secret as { set: true } in an update', () => {
    const parsed = AiChatToolsUpdateInputSchema.parse({
      servers: [{ name: 'jira', transport: 'stdio', command: 'x', env: { TOKEN: { set: true }, SITE: 'acme' } }],
    });
    expect(parsed.servers[0].env).toEqual({ TOKEN: { set: true }, SITE: 'acme' });
  });
});
