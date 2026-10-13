import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { SettingsService } from './settingsService.js';

describe('AI QA settings', () => {
  it('starts with the defaults and saves partial updates', () => {
    const db = initDatabase(':memory:');
    const settings = new SettingsService(db);
    expect(settings.getAiQaSettings()).toEqual({
      runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
    });
    expect(settings.updateAiQaSettings({ runAutomatically: false, agentCli: 'codex-cli', timeLimitMinutes: 45 })).toMatchObject({
      runAutomatically: false, agentCli: 'codex-cli', timeLimitMinutes: 45, maxFindings: 30,
    });
    expect(new SettingsService(db).getAiQaSettings()).toMatchObject({ runAutomatically: false, agentCli: 'codex-cli' });
    db.close();
  });

  it('refuses bad values and keeps what was saved', () => {
    const db = initDatabase(':memory:');
    const settings = new SettingsService(db);
    settings.updateAiQaSettings({ maxFindings: 10 });
    expect(() => settings.updateAiQaSettings({ maxFindings: 500 })).toThrow();
    expect(settings.getAiQaSettings().maxFindings).toBe(10);
    db.close();
  });
});
