import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { SettingsService } from '../services/settingsService.js';

describe('AI Chat tools in settings', () => {
  it('starts empty and stores what is saved', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(settings.getAiChatToolsSettings()).toEqual({ timeLimitSeconds: 120, servers: [], skills: [] });
    settings.saveAiChatToolsSettings({
      timeLimitSeconds: 60,
      servers: [{ name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: [], env: { TOKEN: 'x' }, headers: {} }],
      skills: [],
    });
    expect(settings.getAiChatToolsSettings()).toMatchObject({ timeLimitSeconds: 60, servers: [{ name: 'jira', env: { TOKEN: 'x' } }] });
  });

  it('migration 14 gives chat messages a tools_used column', () => {
    const db = initDatabase(':memory:');
    const columns = (db.pragma('table_info(ai_chat_messages)') as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain('tools_used');
  });
});
