import { describe, it, expect } from 'vitest';
import type { LocalEngineCliStatus, LocalEngineStatus } from '@sp-kickstack/shared';
import { DEFAULT_ENGINE_TYPE, ENGINE_TYPE_OPTIONS, installBadge, limitBadge, localEngineDraftProblem, nextCliText, runCountsText } from './localEngineText.js';

const draft = { enabled: true, agentCli: 'default' as const, maxParallel: 2, runTimeoutMinutes: 60, worktreeRoot: '' };
const cli = (over: Partial<LocalEngineCliStatus> = {}): LocalEngineCliStatus => ({ id: 'agy-cli', label: 'AGY', installed: true, enabled: true, pausedUntil: null, ...over });
const status = (over: Partial<LocalEngineStatus> = {}): LocalEngineStatus => ({
  enabled: true, cli: 'agy-cli', problem: null, clis: [cli()], counts: { running: 1, queued: 3, held: 0, rate_limited: 0 }, maxParallel: 2, worktreeRoot: '/w', ...over,
});

describe('Local AI CLI engine texts', () => {
  it('offers Local AI CLI first (the default for a new repository), then Manual and Stoneforge, and no Command', () => {
    expect(ENGINE_TYPE_OPTIONS.map((o) => o.label)).toEqual(['Local AI CLI', 'Manual', 'Stoneforge']);
    expect(DEFAULT_ENGINE_TYPE).toBe('local');
  });

  it('checks a draft like the server does', () => {
    expect(localEngineDraftProblem(draft)).toBeNull();
    expect(localEngineDraftProblem({ ...draft, maxParallel: 0 })).toBe('Parallel agents must be a whole number from 1 to 8.');
    expect(localEngineDraftProblem({ ...draft, runTimeoutMinutes: 500 })).toBe('Time limit must be a whole number of minutes from 5 to 480.');
    expect(localEngineDraftProblem({ ...draft, worktreeRoot: 'agents' })).toBe('Worktree folder must be an absolute path, or empty for the default.');
    expect(localEngineDraftProblem({ ...draft, worktreeRoot: 'C:\\agents' })).toBeNull();
  });

  it('shows install and usage-limit badges', () => {
    const now = Date.parse('2026-10-13T10:00:00Z');
    expect(installBadge(cli())).toBe('Installed on PC');
    expect(installBadge(cli({ installed: false }))).toBe('Not Detected');
    expect(limitBadge(cli(), now)).toBe('HEALTHY');
    expect(limitBadge(cli({ pausedUntil: '2026-10-13T09:00:00Z' }), now)).toBe('HEALTHY');
    expect(limitBadge(cli({ pausedUntil: '2026-10-13T11:00:00Z' }), now)).toMatch(/^PAUSED until /);
  });

  it('says which CLI runs and how much is going on', () => {
    expect(nextCliText(status())).toBe('Agents run with AGY, at most 2 at a time.');
    expect(nextCliText(status({ enabled: false }))).toBe('Turned off: tasks wait in QUEUED.');
    expect(nextCliText(status({ cli: null, problem: 'No AI CLI that can edit code is installed' }))).toBe('No AI CLI that can edit code is installed');
    expect(runCountsText(status().counts)).toBe('1 running · 3 queued · 0 waiting for a person · 0 rate limited');
  });
});
