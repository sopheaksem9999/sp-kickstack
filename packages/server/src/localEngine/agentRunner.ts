// The Local AI CLI engine: starts queued runs (at most maxParallel), each a headless AI CLI in the
// task's own worktree; logs what it does and turns its exit into the run's status.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { AGENT_CLI_IDS } from '@sp-kickstack/shared';
import type { AgentCliId, AiCliSettings, BridgeTask, LocalEngineSettings, LocalEngineStatus } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';
import type { ProjectService } from '../services/projectService.js';
import type { SettingsService } from '../services/settingsService.js';
import { commitsAhead, resolveCommit } from '../lib/gitRepo.js';
import { findCliBinary } from '../services/aiDraftService.js';
import { FINISHED_RUN_STATUSES, RunStore, type LocalRun, type RunPatch, type RunStatus } from './runStore.js';
import { AgentWorktrees, defaultWorktreeRoot, folderName } from './worktrees.js';
import { agentEnvironment } from './agentEnv.js';
import { buildCommand, chooseCli, CLI_LABELS, cliBinary, cliEnabled, quotaResetAt as defaultQuotaResetAt, runEffort, runModel, type FindBinary } from './cliProfiles.js';
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
  /** Home folder for the default worktree root (tests). */
  homeDir?: string;
  /** A run added commits to its task branch (the bridge pushes it). */
  onCommits?: (taskId: number) => void;
}

/** Log lines kept per run in task_logs; the raw output file keeps everything. */
export const MAX_LOG_LINES = 5000;
const MAX_LINE_CHARS = 2000;
const TAIL_LINES = 20;
/** Crash recoveries after which a run fails instead of starting again. */
export const MAX_INTERRUPTIONS = 3;
/** Wait when a usage limit names no reset time, and the longest wait honoured. */
const DEFAULT_LIMIT_WAIT_MS = 15 * 60 * 1000;
const MAX_LIMIT_WAIT_MS = 24 * 60 * 60 * 1000;

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
  private dirtyLogged = new Set<string>();
  private defaultRoot: string;
  private find: FindBinary;
  private now: () => number;

  constructor(private opts: AgentRunnerOptions) {
    this.runs = new RunStore(opts.db);
    this.find = opts.findBinary ?? findCliBinary;
    this.now = opts.now ?? Date.now;
    const defaultRoot = defaultWorktreeRoot(opts.workspaceDir, opts.homeDir);
    this.defaultRoot = defaultRoot;
    this.worktrees = new AgentWorktrees(() => this.settings().worktreeRoot || defaultRoot);
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

  /** The agent asked a person: the run is held at once; the agent gets holdGraceMs to commit and stop. */
  hold(runId: string, _reason: string): void {
    const held = this.runs.transition(runId, ['running', 'queued', 'rate_limited'], { status: 'held', hold_requested_at: this.iso() });
    if (!held) {
      const run = this.runs.get(runId);
      if (run?.status === 'held') return;
      throw new Error(`Run ${runId} is ${run?.status ?? 'missing'}; it cannot be paused`);
    }
    const active = this.active.get(runId);
    if (!active) return;
    this.log(active.taskId, 'system', '⏸ Waiting for a person to answer; the agent commits its work and stops');
    active.timers.push(setTimeout(() => void stopGroup(active.agent.pid, active.agent.exited, this.stopGrace()), this.opts.holdGraceMs ?? 120_000));
  }

  /** An answer or a finished dependency: the context goes into the next run, which continues the work. */
  release(runId: string, context: string): void {
    this.runs.appendNote(runId, context);
    if (this.runs.transition(runId, ['held'], { status: 'queued', continuation: 1, hold_requested_at: null })) this.nudge();
  }

  /** A note to the agent: kept and given at its next run (a headless CLI cannot read input mid-run). */
  note(runId: string, body: string): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    this.runs.appendNote(runId, body);
    if (run.status === 'running') this.log(run.bridge_task_id, 'system', '✉ Note saved; the agent gets it at its next run');
  }

  /** Server stopping: stop every agent; their runs continue (as continuations) after the restart. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    await Promise.all(
      [...this.active.values()].map(async (active) => {
        if (this.runs.transition(active.runId, ['running'], { status: 'queued', continuation: 1 })) {
          this.log(active.taskId, 'system', '⏹ Server stopping; this run continues when the server starts again');
        }
        await stopGroup(active.agent.pid, active.agent.exited, this.stopGrace());
        await active.settled.catch(() => {});
      })
    );
  }

  /**
   * After a crash, runs still marked running lost their server. Their agent is stopped only when it
   * is provably ours (pid + start time); the run is queued again, and fails at the third crash.
   */
  async recoverOnStartup(): Promise<void> {
    for (const run of this.runs.withStatus(['running', 'held'])) {
      if (this.active.has(run.id)) continue;
      if (run.pid && isSameProcess(run.pid, run.pid_started_at)) await stopGroup(run.pid, null, this.stopGrace());
      if (run.status === 'held') {
        if (run.pid) this.runs.update(run.id, { pid: null });
        continue;
      }
      const interruptions = run.interruptions + 1;
      if (interruptions >= MAX_INTERRUPTIONS) {
        const error = `Interrupted ${interruptions} times (the server stopped while the agent was running); Retry starts it again`;
        if (this.runs.transition(run.id, ['running'], { status: 'failed', pid: null, interruptions, finished_at: this.iso(), error })) {
          this.log(run.bridge_task_id, 'system', `✗ ${error}`);
        }
      } else if (this.runs.transition(run.id, ['running'], { status: 'queued', pid: null, interruptions, continuation: 1 })) {
        this.log(run.bridge_task_id, 'system', '↻ The server restarted while the agent was running; it continues from the branch');
      }
    }
  }

  /** Free a task's worktree: the merge gate deletes merged branches, which git refuses while checked out. */
  releaseWorktree(taskId: number): boolean {
    const row = this.opts.db
      .prepare('SELECT project, MAX(worktree) AS worktree FROM local_runs WHERE bridge_task_id = ? AND worktree IS NOT NULL GROUP BY project')
      .get(taskId) as { project: string; worktree: string } | undefined;
    return row ? this.removeTaskWorktree(taskId, row.project, row.worktree) : true;
  }

  status(): LocalEngineStatus {
    const settings = this.settings();
    const ai = this.ai();
    const choice = chooseCli(settings, ai, this.find);
    const paused = this.runs.pausedClis(this.now());
    return {
      enabled: settings.enabled,
      cli: choice.cli,
      problem: settings.enabled ? choice.problem : 'The Local AI CLI engine is turned off',
      clis: AGENT_CLI_IDS.map((id) => ({
        id, label: CLI_LABELS[id], installed: cliBinary(id, ai, this.find) !== null, enabled: cliEnabled(id, ai), pausedUntil: paused.get(id) ?? null,
      })),
      counts: {
        running: this.runs.count('running'), queued: this.runs.count('queued'), held: this.runs.count('held'), rate_limited: this.runs.count('rate_limited'),
      },
      maxParallel: settings.maxParallel,
      worktreeRoot: settings.worktreeRoot || this.defaultRoot,
    };
  }

  private async pass(): Promise<void> {
    if (this.stopping) return;
    this.resumeRateLimited();
    this.cleanupWorktrees();
    const settings = this.settings();
    if (!settings.enabled) return;
    const ai = this.ai();
    const choice = chooseCli(settings, ai, this.find);
    if (!choice.cli || !choice.bin) return;
    if (this.runs.pausedClis(this.now()).has(choice.cli)) return;
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
    if (run.cancel_requested_at) {
      this.runs.transition(run.id, ['queued'], { status: 'cancelled', finished_at: this.iso() });
      return false;
    }
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
    // Switched to another engine or disabled: no agent starts there; the run waits until it is back.
    if (!project.enabled || project.engine_type !== 'local') return false;
    if (!task.branch) return fail(`Local AI CLI needs a git repository: ${project.repo_path} is not the top of a git work tree`);
    // A task keeps its worktree (even after the worktree folder setting changed); new tasks use the current root.
    const dir = this.recordedWorktree(task.id) ?? this.worktrees.pathFor(project.name, task.id);
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
    const env = agentEnvironment(process.env, {
      launcherDir: this.launcherDir(),
      cliBin: bin,
      homeDir: this.opts.homeDir,
      extra: {
        XTICKET_URL: this.opts.bridgeUrl,
        XTICKET_PROJECT: project.name,
        XTICKET_TASK: run.id,
        // Queued questions/tickets land where the bridge's outbox scanner reads them, not in the worktree.
        XTICKET_OUTBOX: path.join(this.opts.workspaceDir, 'agent-outbox', folderName(project.name)),
        ...(this.opts.agentToken ? { XTICKET_TOKEN: this.opts.agentToken } : {}),
      },
    });
    const startSha = resolveCommit(project.repo_path, `refs/heads/${task.branch}`);
    let agent: SpawnedAgent;
    try {
      agent = spawnAgent(command, dir, env);
    } catch (err: any) {
      return fail(`Could not start ${CLI_LABELS[cli]} (${bin}): ${err?.message || err}`);
    }
    // A cancel requested meanwhile keeps the run from starting (cancel_requested_at is never reset).
    const claimed = !this.runs.get(run.id)?.cancel_requested_at && this.runs.transition(run.id, ['queued'], {
      status: 'running', cli, model, effort, worktree: dir, start_sha: startSha, end_sha: null, pid: agent.pid,
      pid_started_at: agent.startedAt, started_at: this.iso(), finished_at: null, notes_md: '', continuation: 0,
      hold_requested_at: null, exit_code: null, error: null, resume_at: null,
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
    raw.on('error', (err) => console.warn(`[local-engine] run ${runId} output file: ${err.message}`));
    const out: OutputState = { lines: 0, tail: [], rateLimit: null, cliError: null };
    /** Set once the run is settling: output that still arrives (a leftover process) is dropped. */
    let closed = false;
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
    const readers: readline.Interface[] = [];
    if (agent.child.stdout) {
      const reader = readline.createInterface({ input: agent.child.stdout });
      readers.push(reader);
      reader.on('line', (line) => {
        if (closed) return;
        raw.write(`${line}\n`);
        handle(parser.push(line));
      });
    }
    if (agent.child.stderr) {
      const reader = readline.createInterface({ input: agent.child.stderr });
      readers.push(reader);
      reader.on('line', (line) => {
        if (closed) return;
        raw.write(`[stderr] ${line}\n`);
        if (!line.trim()) return;
        emit('stderr', line);
        if (looksLikeRateLimit(line)) out.rateLimit ??= { resetAt: resetFromText(line) };
      });
    }
    /** Stop reading: the CLI has exited and anything still writing is a leftover. */
    const close = () => {
      closed = true;
      for (const reader of readers) reader.close();
      agent.child.stdout?.destroy();
      agent.child.stderr?.destroy();
      raw.end();
    };

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
      close();
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
    if (endSha && endSha !== run.start_sha) this.opts.onCommits?.(taskId);
    const base: RunPatch = { pid: null, exit_code: exit.code, end_sha: endSha, finished_at: this.iso() };
    const label = CLI_LABELS[cli];

    if (run.cancel_requested_at) {
      // Any state: a run released or re-queued while its agent was stopping must not start again.
      if (this.runs.transition(runId, ['running', 'held', 'queued', 'rate_limited'], { ...base, status: 'cancelled' })) {
        this.log(taskId, 'system', '■ Stopped: the task was cancelled');
      }
      return;
    }
    if (run.status === 'queued') {
      // Released while it was still stopping, or stopped by a server shutdown: it starts again.
      this.runs.update(runId, { pid: null, exit_code: exit.code, end_sha: endSha });
      return;
    }
    if (run.status === 'held') {
      this.runs.update(runId, { pid: null, exit_code: exit.code, end_sha: endSha });
      this.log(taskId, 'system', '⏸ Paused until a person answers; the next run continues from the branch');
      return;
    }
    if (timedOut) {
      const minutes = this.settings().runTimeoutMinutes;
      this.end(runId, taskId, { ...base, status: 'timed_out', error: `Stopped after the ${minutes} minute time limit (Settings → AI & Local Engines)` });
      return;
    }
    if (out.rateLimit) {
      const resumeAt = await this.resumeTime(cli, bin, out.rateLimit.resetAt);
      const patch: RunPatch = { ...base, finished_at: null, status: 'rate_limited', resume_at: resumeAt, continuation: 1, error: `${label} usage limit reached; continues at ${resumeAt}` };
      if (this.runs.transition(runId, ['running'], patch)) {
        this.log(taskId, 'system', `⏸ ${label} usage limit reached; this run continues at ${resumeAt}`);
      }
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

  /** The reset the CLI named, else its live quota's, else 15 minutes; at least 1 minute, at most 24 h ahead. */
  private async resumeTime(cli: AgentCliId, bin: string, reported: string | null): Promise<string> {
    let until = reported ? Date.parse(reported) : NaN;
    if (Number.isNaN(until)) {
      const fromQuota = await (this.opts.quotaResetAt ?? defaultQuotaResetAt)(cli, bin).catch(() => null);
      until = fromQuota ? Date.parse(fromQuota) : NaN;
    }
    if (Number.isNaN(until)) until = this.now() + DEFAULT_LIMIT_WAIT_MS;
    until = Math.min(Math.max(until, this.now() + 60_000), this.now() + MAX_LIMIT_WAIT_MS);
    return new Date(until).toISOString();
  }

  /** Worktrees of tasks that are COMPLETE or CANCELLED are removed (kept while they have uncommitted changes). */
  private cleanupWorktrees() {
    const rows = this.opts.db
      .prepare(`
        SELECT r.bridge_task_id AS taskId, r.project AS project, MAX(r.worktree) AS worktree
        FROM local_runs r JOIN bridge_tasks t ON t.id = r.bridge_task_id
        WHERE r.worktree IS NOT NULL AND t.status IN ('done', 'cancelled')
        GROUP BY r.bridge_task_id, r.project
      `)
      .all() as Array<{ taskId: number; project: string; worktree: string }>;
    for (const row of rows) this.removeTaskWorktree(row.taskId, row.project, row.worktree);
  }

  private removeTaskWorktree(taskId: number, project: string, worktree: string): boolean {
    for (const active of this.active.values()) if (active.taskId === taskId) return false;
    const repo = this.opts.projectService.getProject(project)?.repo_path;
    if (!repo) return false;
    let result: 'removed' | 'dirty' | 'missing';
    try {
      result = this.worktrees.removeIfClean(repo, worktree);
    } catch (err: any) {
      console.warn(`[local-engine] could not remove ${worktree}: ${err?.message || err}`);
      return false;
    }
    if (result === 'dirty') {
      if (!this.dirtyLogged.has(worktree)) {
        this.dirtyLogged.add(worktree);
        this.log(taskId, 'system', `Kept ${worktree}: it has uncommitted changes. Delete it yourself when you no longer need them.`);
      }
      return false;
    }
    this.opts.db.prepare('UPDATE local_runs SET worktree = NULL, updated_at = ? WHERE bridge_task_id = ?').run(new Date().toISOString(), taskId);
    return true;
  }

  private resumeRateLimited() {
    const now = this.iso();
    for (const run of this.runs.withStatus(['rate_limited'])) {
      if (run.resume_at && run.resume_at > now) continue;
      if (this.runs.transition(run.id, ['rate_limited'], { status: 'queued', resume_at: null, continuation: 1, error: null })) {
        this.log(run.bridge_task_id, 'system', '↻ Usage limit reset; continuing');
      }
    }
  }

  private end(runId: string, taskId: number, patch: RunPatch & { status: RunStatus }, message?: string) {
    if (this.runs.transition(runId, ['running'], patch)) {
      this.log(taskId, 'system', message ?? `✗ ${(patch.error ?? patch.status).split('\n')[0]}`);
    }
  }

  private recordedWorktree(taskId: number): string | null {
    const row = this.opts.db
      .prepare('SELECT worktree FROM local_runs WHERE bridge_task_id = ? AND worktree IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(taskId) as { worktree: string } | undefined;
    return row?.worktree ?? null;
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
