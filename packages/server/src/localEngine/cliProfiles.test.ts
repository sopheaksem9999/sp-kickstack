import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiCliSettingsSchema, LocalEngineSettingsSchema } from '@sp-kickstack/shared';
import { agyQuotaResetAt, buildCommand, chooseCli, cliBinary, runEffort, runModel } from './cliProfiles.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cli-profiles-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ai = (overrides: Record<string, unknown> = {}) => AiCliSettingsSchema.parse(overrides);
const local = (overrides: Record<string, unknown> = {}) => LocalEngineSettingsSchema.parse(overrides);
const installed = (...names: string[]) => (name: string) => (names.includes(name) ? `/bin/${name}` : null);

function script(name: string, body: string): string {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

describe('choosing the CLI', () => {
  it('follows the AI default when it can edit code', () => {
    expect(chooseCli(local(), ai({ defaultProvider: 'agy-cli' }), installed('claude', 'agy'))).toEqual({ cli: 'agy-cli', bin: '/bin/agy', problem: null });
  });

  it('falls back to the first usable agent CLI when the AI default cannot run agents or is missing', () => {
    expect(chooseCli(local(), ai({ defaultProvider: 'ollama' }), installed('agy')).cli).toBe('agy-cli');
    expect(chooseCli(local(), ai({ defaultProvider: 'agy-cli' }), installed('claude')).cli).toBe('claude-cli');
  });

  it('skips CLIs that are turned off in Settings', () => {
    const settings = ai({ defaultProvider: 'claude-cli', enabledEngines: ['agy-cli'] });
    expect(chooseCli(local(), settings, installed('claude', 'agy')).cli).toBe('agy-cli');
  });

  it('says why nothing can run', () => {
    expect(chooseCli(local(), ai(), installed()).problem).toBe('No AI CLI that can edit code is installed and turned on (Claude Code, AGY or Codex)');
    expect(chooseCli(local({ agentCli: 'codex-cli' }), ai(), installed()).problem).toBe('Codex is chosen for the Local AI CLI engine but is not installed on this PC');
    expect(chooseCli(local({ agentCli: 'codex-cli' }), ai({ codex: { enabled: false } }), installed('codex')).problem)
      .toBe('Codex is chosen for the Local AI CLI engine but is turned off in Settings → AI & Local Engines');
  });

  it('uses an executable custom path and ignores a missing one', () => {
    const fake = script('fake-claude', 'exit 0');
    expect(cliBinary('claude-cli', ai({ claude: { customPath: fake } }), installed())).toBe(fake);
    expect(cliBinary('claude-cli', ai({ claude: { customPath: path.join(tmp, 'nope') } }), installed('claude'))).toBeNull();
  });
});

describe('model and effort', () => {
  it('prefers the task choice, then the CLI setting; "default" means none', () => {
    const settings = ai({ claude: { model: 'sonnet', effort: 'medium' }, codex: { model: 'default' } });
    expect(runModel('claude-cli', 'opus', settings)).toBe('opus');
    expect(runModel('claude-cli', null, settings)).toBe('sonnet');
    expect(runModel('codex-cli', null, settings)).toBeNull();
    expect(runEffort('claude-cli', 'max', settings)).toBe('max');
    expect(runEffort('claude-cli', null, settings)).toBe('medium');
  });
});

describe('headless command lines', () => {
  const input = { prompt: 'Do it', model: 'opus', effort: 'max', worktree: '/w/task-1', gitCommonDir: '/r/.git' };

  it('Claude Code reads the prompt on stdin and may edit and run commands', () => {
    expect(buildCommand('claude-cli', '/bin/claude', input)).toEqual({
      bin: '/bin/claude',
      args: ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--model', 'opus', '--effort', 'max'],
      stdin: 'Do it',
    });
  });

  it('AGY gets the prompt as the value of -p', () => {
    expect(buildCommand('agy-cli', '/bin/agy', { ...input, model: null, effort: null })).toEqual({
      bin: '/bin/agy',
      args: ['-p', 'Do it', '--output-format', 'stream-json', '--dangerously-skip-permissions'],
      stdin: null,
    });
  });

  it('Codex writes only in the worktree and the shared .git folder', () => {
    const cmd = buildCommand('codex-cli', '/bin/codex', input);
    expect(cmd.args).toEqual(['exec', '--json', '--sandbox', 'workspace-write', '--add-dir', '/r/.git', '-C', '/w/task-1', '-m', 'opus', '-c', 'model_reasoning_effort="high"', '-']);
    expect(cmd.stdin).toBe('Do it');
  });
});

describe('AGY quota reset', () => {
  it('returns the latest reset among exhausted buckets', async () => {
    const usage = JSON.stringify({ command: { data: { groups: [{ name: 'Gemini', buckets: [
      { window: '5h', remaining_fraction: 0, reset_time: '2026-10-13T08:00:00Z' },
      { window: 'weekly', remaining_fraction: 0.5, reset_time: '2026-10-19T00:00:00Z' },
    ] }] } } });
    const fake = script('fake-agy-usage', `echo '${usage}'`);
    expect(await agyQuotaResetAt(fake)).toBe('2026-10-13T08:00:00.000Z');
  });

  it('returns null when nothing is exhausted or the command fails', async () => {
    expect(await agyQuotaResetAt(script('fake-agy-fail', 'exit 1'))).toBeNull();
  });
});
