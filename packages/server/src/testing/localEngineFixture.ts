// Test-only: a repository on the Local AI CLI engine, run by the fake agent CLI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentCliId, Requirement } from '@sp-kickstack/shared';
import { initDatabase, type AppDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { SettingsService } from '../services/settingsService.js';
import { AgentRunner, type AgentRunnerOptions } from '../localEngine/agentRunner.js';
import type { LocalRun } from '../localEngine/runStore.js';
import { createBranch, resolveCommit } from '../lib/gitRepo.js';
import { makeRepo } from './gitFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_AGENT_CLI = path.join(here, 'fakeAgentCli.mjs');
const tempRoot = path.resolve(here, '../../.temp/sp-test-local-engine');
let counter = 0;

export async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

export interface LocalHarnessOptions {
  cli?: AgentCliId;
  runner?: Partial<AgentRunnerOptions>;
}

export interface HarnessTask {
  id: number;
  branch: string;
}

/** Spelled out so declaration emit can name the database type. */
export interface LocalHarness {
  ws: string;
  repo: string;
  db: AppDatabase;
  projectService: ProjectService;
  requirementService: RequirementService;
  settingsService: SettingsService;
  runner: AgentRunner;
  newRunner(overrides?: Partial<AgentRunnerOptions>): AgentRunner;
  req: Requirement;
  addTask(): HarnessTask;
  queueRun(bodyMd: string, task?: HarnessTask, using?: AgentRunner): { run: LocalRun; task: HarnessTask };
  logs(taskId: number): Array<{ stream: string; message: string }>;
  logText(taskId: number): string;
  prompts(runId: string): string[];
  invocations(runId: string): any[];
  settle(using?: AgentRunner): Promise<void>;
  run(id: string): LocalRun;
  promptsDir: string;
}

export function makeLocalHarness(opts: LocalHarnessOptions = {}): LocalHarness {
  fs.chmodSync(FAKE_AGENT_CLI, 0o755);
  const ws = path.join(tempRoot, `case-${process.pid}-${counter++}`);
  fs.rmSync(ws, { recursive: true, force: true });
  const { repo } = makeRepo(path.join(ws, 'backend'));
  const promptsDir = path.join(ws, 'prompts');
  process.env.FAKE_AGENT_LOG_DIR = promptsDir;

  const db: AppDatabase = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const settingsService = new SettingsService(db);
  const cli = opts.cli ?? 'claude-cli';
  const key = cli === 'claude-cli' ? 'claude' : cli === 'agy-cli' ? 'agy' : 'codex';
  settingsService.updateAiCliSettings({
    [key]: { enabled: true, customPath: FAKE_AGENT_CLI, model: 'default', effort: undefined },
    enabledEngines: ['claude-cli', 'agy-cli', 'codex-cli'],
  } as any);
  settingsService.updateLocalEngineSettings({ agentCli: cli });
  projectService.registerProject({ name: 'backend', kind: 'backend', repo_path: repo, engine_type: 'local', base_branch: 'develop', enabled: true });

  const runnerOptions: AgentRunnerOptions = {
    db, projectService, settingsService, workspaceDir: ws, bridgeUrl: 'http://127.0.0.1:4100',
    findBinary: () => null, minuteMs: 50, holdGraceMs: 300, stopGraceMs: 1000, quotaResetAt: async () => null,
    ...opts.runner,
  };
  const runner = new AgentRunner(runnerOptions);
  /** Another runner on the same database: the server after a restart. */
  const newRunner = (overrides: Partial<AgentRunnerOptions> = {}) => new AgentRunner({ ...runnerOptions, ...overrides });

  const newRequirement = () =>
    requirementService.createRequirement({
      title: 'Ride tracking', goal: 'Track rides', acceptance_criteria: ['Rides tracked'], affected_projects: ['backend'], priority: 'normal',
    });
  const req = newRequirement();

  /** A goal task on its own branch, as fan-out creates it (one goal per requirement and repository). */
  const addTask = (): { id: number; branch: string } => {
    const req = newRequirement();
    const now = new Date().toISOString();
    const id = Number(
      db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'goal', 'Ride tracking', 'queued', ?, ?)")
        .run(req.id, now, now).lastInsertRowid
    );
    const branch = `req/${req.id}/task-${id}`;
    const base = resolveCommit(repo, 'refs/heads/develop')!;
    createBranch(repo, branch, base);
    db.prepare('UPDATE bridge_tasks SET branch = ?, base_sha = ? WHERE id = ?').run(branch, base, id);
    return { id, branch };
  };

  const queueRun = (bodyMd: string, task = addTask(), using: AgentRunner = runner) => {
    const run = using.runs.create({ bridgeTaskId: task.id, project: 'backend', title: 'Ride tracking', bodyMd });
    db.prepare('UPDATE bridge_tasks SET engine_task_id = ? WHERE id = ?').run(run.id, task.id);
    return { run, task };
  };

  const logs = (taskId: number) =>
    (db.prepare('SELECT stream, message FROM task_logs WHERE task_id = ? ORDER BY id').all(taskId) as Array<{ stream: string; message: string }>);
  const logText = (taskId: number) => logs(taskId).map((l) => l.message).join('\n');
  const prompts = (runId: string) =>
    fs.existsSync(promptsDir)
      ? fs.readdirSync(promptsDir).filter((f) => f.startsWith(`${runId}-`) && f.endsWith('.md'))
          .sort((a, b) => parseInt(a.slice(runId.length + 1), 10) - parseInt(b.slice(runId.length + 1), 10))
          .map((f) => fs.readFileSync(path.join(promptsDir, f), 'utf8'))
      : [];
  const invocations = (runId: string) =>
    fs.existsSync(promptsDir)
      ? fs.readdirSync(promptsDir).filter((f) => f.startsWith(`${runId}-`) && f.endsWith('.json')).sort()
          .map((f) => JSON.parse(fs.readFileSync(path.join(promptsDir, f), 'utf8')))
      : [];
  /** Start what can start and wait until every started run has finished. */
  const settle = async (using: AgentRunner = runner) => {
    await using.tick();
    await using.idle();
  };
  const run = (id: string) => runner.runs.get(id)!;

  return { ws, repo, db, projectService, requirementService, settingsService, runner, newRunner, req, addTask, queueRun, logs, logText, prompts, invocations, settle, run, promptsDir };
}

export function cleanLocalHarnesses() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.FAKE_AGENT_LOG_DIR;
}
