import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { DEFAULT_QA_TIERS } from '@sp-kickstack/shared';
import { SettingsService } from './settingsService.js';

describe('AI QA settings', () => {
  it('starts with the defaults and saves partial updates', () => {
    const db = initDatabase(':memory:');
    const settings = new SettingsService(db);
    expect(settings.getAiQaSettings()).toEqual({
      runAutomatically: true, agentCli: 'default', model: null, effort: null, timeLimitMinutes: 30, maxFindings: 30,
      modelMode: 'auto', tiers: DEFAULT_QA_TIERS, lightMaxLines: 150, deepMinLines: 1000,
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

  it('keeps a phase 1 value and refuses a light limit at or above the deep limit', () => {
    const db = initDatabase(':memory:');
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_qa_settings', ?)").run(JSON.stringify({ runAutomatically: false, maxFindings: 12 }));
    const settings = new SettingsService(db);
    expect(settings.getAiQaSettings()).toMatchObject({ runAutomatically: false, maxFindings: 12, modelMode: 'auto', deepMinLines: 1000 });
    expect(() => settings.updateAiQaSettings({ lightMaxLines: 1000 })).toThrow(/lightMaxLines must be lower than deepMinLines/);
    expect(settings.updateAiQaSettings({ lightMaxLines: 300, modelMode: 'fixed' })).toMatchObject({ lightMaxLines: 300, modelMode: 'fixed' });
    db.close();
  });
});
