// The Local AI CLI engine: starts queued runs (at most maxParallel), each a headless AI CLI in the
// task's own worktree; logs what it does and turns its exit into the run's status.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { AgentCliId, AiCliSettings, BridgeTask, LocalEngineSettings } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';
import type { ProjectService } from '../services/projectService.js';
import type { SettingsService } from '../services/settingsService.js';
import { commitsAhead, resolveCommit } from '../lib/gitRepo.js';
import { findCliBinary } from '../services/aiDraftService.js';
import { FINISHED_RUN_STATUSES, RunStore, type LocalRun, type RunPatch, type RunStatus } from './runStore.js';
import { AgentWorktrees } from './worktrees.js';
import { buildCommand, chooseCli, CLI_LABELS, runEffort, runModel, type FindBinary } from './cliProfiles.js';
import { createParser, looksLikeRateLimit, resetFromText, type ParsedOutput } from './outputParsers.js';
import { buildRunPrompt } from './prompt.js';
import { findXticketScript, writeXticketLauncher } from './xticketLauncher.js';
import { isSameProcess, killGroupLeftovers, spawnAgent, stopGroup, type AgentExit, type SpawnedAgent } from './processes.js';

export interface AgentRunnerOptions {
  db: AppDatabase;
  projectService: ProjectService;
  settingsService: SettingsService;
  /** Server workspace: default worktree root, run folders (prompt, raw output), xticket launcher. */
  workspaceDir: string;
  /** This server's address for xticket (XTICKET_URL). */
  bridgeUrl: string;
  agentToken?: string;
  findBinary?: FindBinary;
  /** Length of one minute of the run time limit (tests shorten it). */
  minuteMs?: number;
  /** How long an agent that asked a question may take to commit and stop (default 2 min). */
  holdGraceMs?: number;
  /** SIGTERM → SIGKILL grace when stopping an agent (default 10 s). */
  stopGraceMs?: number;
  quotaResetAt?: (cli: AgentCliId, bin: string) => Promise<string | null>;
  now?: () => number;
}

/** Log lines kept per run in task_logs; the raw output file keeps everything. */
export const MAX_LOG_LINES = 5000;
const MAX_LINE_CHARS = 2000;
const TAIL_LINES = 20;
/** Crash recoveries after which a run fails instead of starting again. */
export const MAX_INTERRUPTIONS = 3;

interface ActiveRun {
  runId: string;
  taskId: number;
  agent: SpawnedAgent;
  timers: NodeJS.Timeout[];
  timedOut: boolean;
  /** Resolves once the run's result is stored. */
  settled: Promise<void>;
}

interface OutputState {
  lines: number;
  tail: string[];
  rateLimit: { resetAt: string | null } | null;
  cliError: string | null;
}

type LogStream = 'stdout' | 'stderr' | 'system';

export class AgentRunner {
  readonly runs: RunStore;
  private worktrees: AgentWorktrees;
  private active = new Map<string, ActiveRun>();
  private ticking: Promise<void> | null = null;
  private again = false;
  private stopping = false;
  private binDir: string | null = null;
  private find: FindBinary;
  private now: () => number;

  constructor(private opts: AgentRunnerOptions) {
    this.runs = new RunStore(opts.db);
    this.find = opts.findBinary ?? findCliBinary;
    this.now = opts.now ?? Date.now;
    this.worktrees = new AgentWorktrees(() => this.settings().worktreeRoot || path.join(opts.workspaceDir, 'agent-worktrees'));
  }

  health(): { ok: boolean; version?: string; error?: string } {
    const settings = this.settings();
    if (!settings.enabled) return { ok: false, error: 'The Local AI CLI engine is turned off in Settings → AI & Local Engines' };
    const choice = chooseCli(settings, this.ai(), this.find);
    return choice.cli ? { ok: true, version: `local · ${CLI_LABELS[choice.cli]}` } : { ok: false, error: choice.problem ?? 'No AI CLI can run' };
  }

  /** Start what can start now, without waiting for the next scheduler tick. */
  nudge(): void {
    setImmediate(() => {
      this.tick().catch((err) => console.warn(`[local-engine] ${err?.message || err}`));
    });
  }

  /** One pass over the queue; concurrent calls are folded into one more pass. */
  async tick(): Promise<void> {
    if (this.ticking) {
      this.again = true;
      return this.ticking;
    }
    this.ticking = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  /** Resolves once no agent is running and no pass is going (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.active.size > 0 || this.ticking) {
      await Promise.all([...this.active.values()].map((a) => a.settled));
      if (this.ticking) await this.ticking;
    }
  }

  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || FINISHED_RUN_STATUSES.includes(run.status)) return;
    this.runs.update(runId, { cancel_requested_at: this.iso() });
    const active = this.active.get(runId);
    if (active) {
      await stopGroup(active.agent.pid, active.agent.exited, this.stopGrace());
      await active.settled;
      return;
    }
    if (run.status === 'running' && run.pid && isSameProcess(run.pid, run.pid_started_at)) {
      await stopGroup(run.pid, null, this.stopGrace());
    }
    if (this.runs.transition(runId, ['queued', 'held', 'rate_limited', 'running'], { status: 'cancelled', pid: null, finished_at: this.iso() })) {
      this.log(run.bridge_task_id, 'system', '■ Cancelled');
    }
  }

  private async pass(): Promise<void> {
    if (this.stopping) return;
    const settings = this.settings();
    if (!settings.enabled) return;
    const ai = this.ai();
    const choice = chooseCli(settings, ai, this.find);
    if (!choice.cli || !choice.bin) return;
    let running = this.runs.count('running');
    for (const run of this.runs.queued()) {
      if (running >= settings.maxParallel) break;
      if (this.taskBusy(run)) continue;
      if (this.start(run, choice.cli, choice.bin, ai, settings)) running++;
    }
  }

  private taskBusy(run: LocalRun): boolean {
    if (this.active.has(run.id)) return true;
    for (const active of this.active.values()) if (active.taskId === run.bridge_task_id) return true;
    return false;
  }

  /** Start one queued run; false when it could not start (then it is failed or cancelled). */
  private start(run: LocalRun, cli: AgentCliId, bin: string, ai: AiCliSettings, settings: LocalEngineSettings): boolean {
    const task = this.task(run.bridge_task_id);
    if (!task || task.status === 'done' || task.status === 'cancelled') {
      this.runs.transition(run.id, ['queued'], { status: 'cancelled', error: 'The task is no longer active', finished_at: this.iso() });
      return false;
    }
    const fail = (message: string) => {
      if (this.runs.transition(run.id, ['queued'], { status: 'failed', error: message, finished_at: this.iso() })) this.log(task.id, 'system', `✗ ${message}`);
      return false;
    };
    const project = this.opts.projectService.getProject(run.project);
    if (!project) return fail(`Repository ${run.project} is not registered`);
    if (!task.branch) return fail(`Local AI CLI needs a git repository: ${project.repo_path} is not the top of a git work tree`);
    const dir = this.worktrees.pathFor(project.name, task.id);
    let gitCommonDir: string;
    try {
      this.worktrees.ensure(project.repo_path, task.branch, dir);
      gitCommonDir = this.worktrees.gitCommonDir(project.repo_path);
    } catch (err: any) {
      return fail(err?.message || String(err));
    }

    const model = runModel(cli, run.model, ai);
    const effort = runEffort(cli, run.effort, ai);
    const prompt = buildRunPrompt({ bodyMd: run.body_md, worktree: dir, branch: task.branch, notesMd: run.notes_md, continuation: run.continuation === 1 });
    const runDir = path.join(this.opts.workspaceDir, 'agent-runs', run.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, `prompt-${Date.now()}.md`), prompt);
    const command = buildCommand(cli, bin, { prompt, model, effort, worktree: dir, gitCommonDir });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XTICKET_URL: this.opts.bridgeUrl,
      XTICKET_PROJECT: project.name,
      XTICKET_TASK: run.id,
      ...(this.opts.agentToken ? { XTICKET_TOKEN: this.opts.agentToken } : {}),
      PATH: `${this.launcherDir()}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    const startSha = resolveCommit(project.repo_path, `refs/heads/${task.branch}`);
    let agent: SpawnedAgent;
    try {
      agent = spawnAgent(command, dir, env);
    } catch (err: any) {
      return fail(`Could not start ${CLI_LABELS[cli]} (${bin}): ${err?.message || err}`);
    }
    const claimed = this.runs.transition(run.id, ['queued'], {
      status: 'running', cli, model, effort, worktree: dir, start_sha: startSha, end_sha: null, pid: agent.pid,
      pid_started_at: agent.startedAt, started_at: this.iso(), finished_at: null, notes_md: '', continuation: 0,
      hold_requested_at: null, cancel_requested_at: null, exit_code: null, error: null, resume_at: null,
    });
    if (!claimed) {
      void stopGroup(agent.pid, agent.exited, this.stopGrace());
      return false;
    }
    this.opts.db.prepare('UPDATE bridge_tasks SET model = ?, effort = ? WHERE id = ?').run(model, effort, task.id);
    this.log(task.id, 'system', `▶ ${CLI_LABELS[cli]} started in ${dir} on ${task.branch}${model ? ` · ${model}` : ''}${effort ? ` · ${effort}` : ''}`);
    this.supervise(run.id, task, project.repo_path, cli, bin, agent, settings.runTimeoutMinutes, runDir);
    return true;
  }

  private supervise(runId: string, task: BridgeTask, repo: string, cli: AgentCliId, bin: string, agent: SpawnedAgent, minutes: number, runDir: string) {
    const parser = createParser(cli);
    const raw = fs.createWriteStream(path.join(runDir, 'output.log'), { flags: 'a' });
    const out: OutputState = { lines: 0, tail: [], rateLimit: null, cliError: null };
    const emit = (stream: LogStream, text: string) => {
      const line = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS - 1)}…` : text;
      out.tail.push(line);
      if (out.tail.length > TAIL_LINES) out.tail.shift();
      if (out.lines >= MAX_LOG_LINES) return;
      this.log(task.id, stream, line);
      out.lines++;
      if (out.lines === MAX_LOG_LINES) {
        this.log(task.id, 'system', `Log limit of ${MAX_LOG_LINES} lines reached; the full output is in ${path.join(runDir, 'output.log')}`);
      }
    };
    const handle = (parsed: ParsedOutput) => {
      for (const line of parsed.logs) emit('stdout', line);
      if (parsed.rateLimit) out.rateLimit = parsed.rateLimit;
      if (parsed.error) out.cliError = parsed.error;
    };
    if (agent.child.stdout) {
      readline.createInterface({ input: agent.child.stdout }).on('line', (line) => {
        raw.write(`${line}\n`);
        handle(parser.push(line));
      });
    }
    if (agent.child.stderr) {
      readline.createInterface({ input: agent.child.stderr }).on('line', (line) => {
        raw.write(`[stderr] ${line}\n`);
        if (!line.trim()) return;
        emit('stderr', line);
        if (looksLikeRateLimit(line)) out.rateLimit ??= { resetAt: resetFromText(line) };
      });
    }

    const active: ActiveRun = { runId, taskId: task.id, agent, timers: [], timedOut: false, settled: Promise.resolve() };
    active.timers.push(
      setTimeout(() => {
        active.timedOut = true;
        void stopGroup(agent.pid, agent.exited, this.stopGrace());
      }, minutes * this.minuteMs())
    );
    active.settled = agent.exited.then(async (exit) => {
      active.timers.forEach(clearTimeout);
      killGroupLeftovers(agent.pid);
      handle(parser.flush());
      raw.end();
      try {
        await this.finish(runId, task.id, repo, cli, bin, exit, out, active.timedOut);
      } catch (err: any) {
        console.warn(`[local-engine] run ${runId}: ${err?.message || err}`);
      } finally {
        this.active.delete(runId);
      }
      await this.tick();
    });
    this.active.set(runId, active);
  }

  /** Turn the agent's exit into the run's status. */
  private async finish(runId: string, taskId: number, repo: string, cli: AgentCliId, bin: string, exit: AgentExit, out: OutputState, timedOut: boolean) {
    const run = this.runs.get(runId);
    const task = this.task(taskId);
    if (!run || !task) return;
    const endSha = task.branch ? resolveCommit(repo, `refs/heads/${task.branch}`) : null;
    const base: RunPatch = { pid: null, exit_code: exit.code, end_sha: endSha, finished_at: this.iso() };
    const label = CLI_LABELS[cli];

    if (run.cancel_requested_at) {
      if (this.runs.transition(runId, ['running', 'held'], { ...base, status: 'cancelled' })) this.log(taskId, 'system', '■ Stopped: the task was cancelled');
      return;
    }
    if (timedOut) {
      const minutes = this.settings().runTimeoutMinutes;
      this.end(runId, taskId, { ...base, status: 'timed_out', error: `Stopped after the ${minutes} minute time limit (Settings → AI & Local Engines)` });
      return;
    }
    if (exit.spawnError) {
      this.end(runId, taskId, { ...base, status: 'failed', error: `Could not start ${label} (${bin}): ${exit.spawnError}` });
      return;
    }
    if (exit.code !== 0) {
      const reason = out.cliError ?? (exit.signal ? `stopped by ${exit.signal}` : `exit code ${exit.code}`);
      this.end(runId, taskId, { ...base, status: 'failed', error: `${label} failed: ${reason}\n${out.tail.join('\n')}`.trim() });
      return;
    }
    const worktree = run.worktree ?? '';
    const dirty = worktree ? this.worktrees.uncommitted(worktree) : [];
    if (dirty.length) {
      this.log(taskId, 'system', `⚠ Uncommitted changes left in ${worktree} (not part of the review): ${dirty.slice(0, 10).join(', ')}${dirty.length > 10 ? ', …' : ''}`);
    }
    const ahead = task.base_sha && endSha ? commitsAhead(repo, task.base_sha, endSha) : 0;
    if (ahead > 0) {
      this.end(runId, taskId, { ...base, status: 'review' }, `✓ Finished: ${ahead} commit${ahead === 1 ? '' : 's'} on ${task.branch} ready for review`);
      return;
    }
    const error = dirty.length ? `Finished without committing; the uncommitted changes are in ${worktree}` : 'Finished without committing anything';
    this.end(runId, taskId, { ...base, status: 'no_changes', error });
  }

  private end(runId: string, taskId: number, patch: RunPatch & { status: RunStatus }, message?: string) {
    if (this.runs.transition(runId, ['running'], patch)) {
      this.log(taskId, 'system', message ?? `✗ ${(patch.error ?? patch.status).split('\n')[0]}`);
    }
  }

  private task(id: number): BridgeTask | undefined {
    return this.opts.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as BridgeTask | undefined;
  }

  private log(taskId: number, stream: LogStream, message: string) {
    this.opts.db
      .prepare('INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, ?, ?, ?)')
      .run(taskId, stream, message, new Date().toISOString());
  }

  private launcherDir(): string {
    if (!this.binDir) {
      this.binDir = writeXticketLauncher(path.join(this.opts.workspaceDir, 'agent-bin'), process.execPath, findXticketScript());
    }
    return this.binDir;
  }

  private settings(): LocalEngineSettings {
    return this.opts.settingsService.getLocalEngineSettings();
  }

  private ai(): AiCliSettings {
    return this.opts.settingsService.getAiCliSettings();
  }

  private iso(offsetMs = 0): string {
    return new Date(this.now() + offsetMs).toISOString();
  }

  private minuteMs(): number {
    return this.opts.minuteMs ?? 60_000;
  }

  private stopGrace(): number {
    return this.opts.stopGraceMs ?? 10_000;
  }
}
