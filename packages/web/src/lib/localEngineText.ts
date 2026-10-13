import type { EngineType, LocalEngineCliStatus, LocalEngineSettings, LocalEngineStatus } from '@sp-kickstack/shared';

/** A new repository runs its tasks with an AI CLI on this PC unless the person picks another engine. */
export const DEFAULT_ENGINE_TYPE: EngineType = 'local';

/** Engine choices for a repository, the default first (Command is gone: the server never accepted it). */
export const ENGINE_TYPE_OPTIONS: Array<{ value: EngineType; label: string }> = [
  { value: 'local', label: 'Local AI CLI' },
  { value: 'manual', label: 'Manual' },
  { value: 'stoneforge', label: 'Stoneforge' },
];

export const AGENT_CLI_CHOICES: Array<{ value: LocalEngineSettings['agentCli']; label: string }> = [
  { value: 'default', label: 'Use AI default' },
  { value: 'claude-cli', label: 'Claude Code' },
  { value: 'agy-cli', label: 'AGY' },
  { value: 'codex-cli', label: 'Codex' },
];

/** What is wrong with a draft before saving (the server checks the same), or null. */
export function localEngineDraftProblem(draft: LocalEngineSettings): string | null {
  if (!Number.isInteger(draft.maxParallel) || draft.maxParallel < 1 || draft.maxParallel > 8) return 'Parallel agents must be a whole number from 1 to 8.';
  if (!Number.isInteger(draft.runTimeoutMinutes) || draft.runTimeoutMinutes < 5 || draft.runTimeoutMinutes > 480) {
    return 'Time limit must be a whole number of minutes from 5 to 480.';
  }
  const root = draft.worktreeRoot.trim();
  if (root && !(root.startsWith('/') || /^[A-Za-z]:[\\/]/.test(root))) return 'Worktree folder must be an absolute path, or empty for the default.';
  return null;
}

export function installBadge(cli: LocalEngineCliStatus): string {
  return cli.installed ? 'Installed on PC' : 'Not Detected';
}

/** HEALTHY, or PAUSED until hh:mm while a usage limit lasts. */
export function limitBadge(cli: LocalEngineCliStatus, now: number = Date.now()): string {
  if (!cli.pausedUntil || Date.parse(cli.pausedUntil) <= now) return 'HEALTHY';
  return `PAUSED until ${new Date(cli.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function runCountsText(counts: LocalEngineStatus['counts']): string {
  return `${counts.running} running · ${counts.queued} queued · ${counts.held} waiting for a person · ${counts.rate_limited} rate limited`;
}

/** Which CLI the next run uses, in words. */
export function nextCliText(status: LocalEngineStatus): string {
  if (!status.enabled) return 'Turned off: tasks wait in QUEUED.';
  if (!status.cli) return status.problem ?? 'No AI CLI can run.';
  const label = status.clis.find((c) => c.id === status.cli)?.label ?? status.cli;
  return `Agents run with ${label}, at most ${status.maxParallel} at a time.`;
}
