// Settings → AI & Local Engines → Local AI CLI engine.
import { describe, it, expect } from 'vitest';
import { EngineTypeSchema } from '@sp-kickstack/shared';
import { initDatabase } from '../db/index.js';
import { SettingsService } from './settingsService.js';

describe('Local AI CLI engine settings', () => {
  it('defaults to on, the AI default CLI, 2 parallel agents and a 60 minute limit', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(settings.getLocalEngineSettings()).toEqual({
      enabled: true, agentCli: 'default', maxParallel: 2, runTimeoutMinutes: 60, worktreeRoot: '',
    });
  });

  it('saves a partial update and keeps the other values', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    settings.updateLocalEngineSettings({ maxParallel: 3, agentCli: 'agy-cli' });
    expect(settings.getLocalEngineSettings()).toEqual({
      enabled: true, agentCli: 'agy-cli', maxParallel: 3, runTimeoutMinutes: 60, worktreeRoot: '',
    });
  });

  it('refuses values outside their ranges, relative folders and unknown fields', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(() => settings.updateLocalEngineSettings({ maxParallel: 0 })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ maxParallel: 9 })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ runTimeoutMinutes: 4 })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ worktreeRoot: 'relative/dir' })).toThrow(/absolute path/);
    expect(() => settings.updateLocalEngineSettings({ agentCli: 'ollama' })).toThrow();
    expect(() => settings.updateLocalEngineSettings({ unknown: 1 })).toThrow();
    expect(settings.getLocalEngineSettings().maxParallel).toBe(2);
  });

  it('accepts an absolute worktree folder', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(settings.updateLocalEngineSettings({ worktreeRoot: '/tmp/agents' }).worktreeRoot).toBe('/tmp/agents');
  });

  it('knows the local engine type for repositories', () => {
    expect(EngineTypeSchema.parse('local')).toBe('local');
  });
});
