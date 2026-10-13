// Which AI CLI runs an agent, and the headless command line that lets it edit files and run
// commands (checked against Claude Code 2.1.284 and AGY 1.3.3; Codex from its documentation).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { AGENT_CLI_IDS } from '@sp-kickstack/shared';
import type { AgentCliId, AiCliSettings, LocalEngineSettings, SingleCliConfig } from '@sp-kickstack/shared';
import { findCliBinary } from '../services/aiDraftService.js';

export const CLI_LABELS: Record<AgentCliId, string> = {
  'claude-cli': 'Claude Code',
  'agy-cli': 'AGY',
  'codex-cli': 'Codex',
};
const BINARY: Record<AgentCliId, string> = {
  'claude-cli': 'claude',
  'agy-cli': 'agy',
  'codex-cli': 'codex',
};

export type FindBinary = (name: string) => string | null;

function configOf(cli: AgentCliId, ai: AiCliSettings): SingleCliConfig | undefined {
  if (cli === 'claude-cli') return ai.claude;
  if (cli === 'agy-cli') return ai.agy;
  if (cli === 'codex-cli') return ai.codex;
  return undefined;
}

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The CLI's binary: its Settings custom path when that is an executable file, else a PATH search. */
export function cliBinary(cli: AgentCliId, ai: AiCliSettings, find: FindBinary = findCliBinary): string | null {
  const custom = configOf(cli, ai)?.customPath?.trim();
  if (custom) return isExecutableFile(custom) ? custom : null;
  return find(BINARY[cli]);
}

/** Turned on in Settings: its own switch and the list of active engines. */
export function cliEnabled(cli: AgentCliId, ai: AiCliSettings): boolean {
  if (configOf(cli, ai)?.enabled === false) return false;
  return !ai.enabledEngines || ai.enabledEngines.includes(cli);
}

export interface CliChoice {
  cli: AgentCliId | null;
  bin: string | null;
  /** Why no CLI can run, in words for Settings and the engine status. */
  problem: string | null;
}

/**
 * The CLI the next run uses: the engine's own choice, else the AI default, else the first enabled
 * and installed agent CLI (Ollama and the heuristic cannot edit code).
 */
export function chooseCli(local: LocalEngineSettings, ai: AiCliSettings, find: FindBinary = findCliBinary): CliChoice {
  const usable = (cli: AgentCliId) => (cliEnabled(cli, ai) ? cliBinary(cli, ai, find) : null);
  if (local.agentCli !== 'default') {
    const bin = usable(local.agentCli);
    if (bin) return { cli: local.agentCli, bin, problem: null };
    const why = cliEnabled(local.agentCli, ai) ? 'is not installed on this PC' : 'is turned off in Settings → AI & Local Engines';
    return { cli: null, bin: null, problem: `${CLI_LABELS[local.agentCli]} is chosen for the Local AI CLI engine but ${why}` };
  }
  const preferred = (AGENT_CLI_IDS as readonly string[]).includes(ai.defaultProvider) ? [ai.defaultProvider as AgentCliId] : [];
  for (const cli of [...preferred, ...AGENT_CLI_IDS]) {
    const bin = usable(cli);
    if (bin) return { cli, bin, problem: null };
  }
  return { cli: null, bin: null, problem: 'No AI CLI that can edit code is installed and turned on (Claude Code, AGY or Codex)' };
}

const unset = (value: string | null | undefined) => !value || value === 'default';

/** Model for a run: the task's resolved choice, else the CLI's Settings model. */
export function runModel(cli: AgentCliId, chosen: string | null, ai: AiCliSettings): string | null {
  if (!unset(chosen)) return chosen!;
  const fallback = configOf(cli, ai)?.model;
  return unset(fallback) ? null : fallback!;
}

/** Effort for a run: the task's resolved choice, else the CLI's Settings effort. */
export function runEffort(cli: AgentCliId, chosen: string | null, ai: AiCliSettings): string | null {
  return chosen || configOf(cli, ai)?.effort || null;
}

export interface CliCommand {
  bin: string;
  args: string[];
  /** Written to stdin, which is then closed; null closes it at once. */
  stdin: string | null;
}

export interface CommandInput {
  prompt: string;
  model: string | null;
  effort: string | null;
  worktree: string;
  /** The repository's shared .git folder: commits made in a worktree are written there. */
  gitCommonDir: string;
}

/** Codex accepts minimal, low, medium and high. */
const CODEX_EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

/** Headless command line that lets the agent edit files and run commands. */
export function buildCommand(cli: AgentCliId, bin: string, input: CommandInput): CliCommand {
  const { prompt, model, effort } = input;
  if (cli === 'claude-cli') {
    return {
      bin,
      args: [
        '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions',
        ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
      ],
      stdin: prompt,
    };
  }
  if (cli === 'agy-cli') {
    // AGY takes the prompt only as the value of -p (it refuses stdin).
    return {
      bin,
      args: [
        '-p', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions',
        ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
      ],
      stdin: null,
    };
  }
  const codexEffort = effort ? CODEX_EFFORT[effort] : undefined;
  return {
    bin,
    args: [
      'exec', '--json', '--sandbox', 'workspace-write', '--add-dir', input.gitCommonDir, '-C', input.worktree,
      ...(model ? ['-m', model] : []), ...(codexEffort ? ['-c', `model_reasoning_effort="${codexEffort}"`] : []), '-',
    ],
    stdin: prompt,
  };
}

/** When AGY's exhausted quota resets (ISO), from `agy -p /usage --output-format json`; null if unknown. */
export function agyQuotaResetAt(bin: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['-p', '/usage', '--output-format', 'json'], { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const groups = JSON.parse(stdout)?.command?.data?.groups ?? [];
        const resets = groups
          .flatMap((g: any) => g.buckets ?? [])
          .filter((b: any) => typeof b.remaining_fraction === 'number' && b.remaining_fraction <= 0 && typeof b.reset_time === 'string')
          .map((b: any) => Date.parse(b.reset_time))
          .filter((t: number) => !Number.isNaN(t));
        resolve(resets.length ? new Date(Math.max(...resets)).toISOString() : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Reset time from the CLI's live quota when its message did not say (only AGY reports one). */
export function quotaResetAt(cli: AgentCliId, bin: string): Promise<string | null> {
  return cli === 'agy-cli' ? agyQuotaResetAt(bin) : Promise.resolve(null);
}
