// AI QA: one QA run per git repository of a requirement in QA. The agent checks the merged code in a
// temporary checkout and reports findings (open review comments marked AI QA) and a result; a person
// decides what to send back.
import type { AiQaSettings, BridgeTask, LocalEngineStatus, Project, QaRunView, QaSeverity, RequirementQa } from '@sp-kickstack/shared';
import { QaFindingInputSchema, QaResultInputSchema } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';
import type { ProjectService } from './projectService.js';
import type { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { BranchService } from './branchService.js';
import { TaskChangesService } from './taskChanges.js';
import { isSafeRelativePath } from './reviewAssist.js';
import { RunStore } from '../localEngine/runStore.js';
import { buildQaPrompt } from '../localEngine/qaPrompt.js';
import { diffSummary, isGitWorkTree, resolveCommit } from '../lib/gitRepo.js';
import { HttpError, badRequest, conflict } from '../lib/httpError.js';
import { oneLine } from '../lib/promptSafety.js';

/** What AI QA needs from the Local AI CLI runner (AgentRunner implements it). */
export interface QaEngine {
  status(): LocalEngineStatus;
  nudge(): void;
}

export type QaEmit = (event: { type: string; req_id?: string; task_id?: number; payload: Record<string, unknown> }) => void;

export interface QaServiceOptions {
  db: AppDatabase;
  projectService: ProjectService;
  requirementService: RequirementService;
  settingsService?: SettingsService;
  branchService?: BranchService;
  /** Absent when this server runs no Local AI CLI engine: AI QA cannot start (503). */
  engine?: QaEngine;
  emit?: QaEmit;
}

const ACTIVE_STATUSES = ['pending', 'queued', 'running', 'rate_limited'];

/** Same finding = same QA run, file, line and title (case and spacing ignored). */
const titleKey = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();
/** A saved finding's title: the bold first line of its comment. */
const savedTitle = (body: string) => /^\*\*(.+?)\*\*/.exec(body)?.[1] ?? body.split('\n')[0];

export class QaService {
  private db: AppDatabase;
  private settings: SettingsService;
  private branches: BranchService;
  private taskChanges: TaskChangesService;
  private runs: RunStore;

  constructor(private opts: QaServiceOptions) {
    this.db = opts.db;
    this.settings = opts.settingsService ?? new SettingsService(opts.db);
    this.branches = opts.branchService ?? new BranchService(opts.db, opts.projectService, this.settings);
    this.taskChanges = new TaskChangesService(opts.db);
    this.runs = new RunStore(opts.db);
  }

  /** Start AI QA for every git repository of a requirement in QA. `commits`: the merged result per repository (else the branch tip). */
  public start(reqId: string, trigger: 'auto' | 'manual', commits: Record<string, string> = {}): RequirementQa {
    const req = this.opts.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
    if (req.status !== 'qa') throw conflict(`${reqId} is ${req.status}; AI QA runs while a requirement is in QA`);
    if (!this.opts.engine) throw new HttpError(503, 'The Local AI CLI engine is not running in this server');
    if (this.activeTasks(reqId).length > 0) throw conflict(`AI QA is already running for ${reqId}`);
    const projects = this.projectsOf(reqId);
    if (projects.length === 0) throw conflict(`${reqId} has no repository work to check`);
    const repos = projects.filter((p) => isGitWorkTree(p.repo_path));
    if (repos.length === 0) throw conflict(`No repository of ${reqId} is a git repository; AI QA needs one`);

    const settings = this.settings.getAiQaSettings();
    const cliProblem = this.cliProblem(settings, this.opts.engine.status());
    const round = this.lastRound(reqId) + 1;
    for (const project of repos) {
      const base = this.branches.baseBranchFor(project, reqId);
      const commit =
        commits[project.name] ?? resolveCommit(project.repo_path, `refs/heads/${base}`) ?? resolveCommit(project.repo_path, `refs/remotes/origin/${base}`);
      const taskId = this.insertTask(reqId, project.name, round, commit);
      if (!commit) {
        this.failTask(taskId, `${project.name}: branch ${base} was not found, so there is no commit to check`);
        continue;
      }
      if (cliProblem) {
        this.failTask(taskId, cliProblem);
        continue;
      }
      const changes = this.changesOf(project, reqId);
      const bodyMd = buildQaPrompt({
        reqId, title: req.title, bodyMd: req.body_md, project: project.name, commit, from: changes.from, changedFiles: changes.files,
        commands: { test: project.test_command, build: project.build_command, lint: project.lint_command },
        maxFindings: settings.maxFindings,
      });
      this.runs.create({
        bridgeTaskId: taskId, project: project.name, title: `AI QA · ${reqId}`, bodyMd, model: settings.model, effort: settings.effort,
        preferredCli: settings.agentCli === 'default' ? null : settings.agentCli,
      });
      this.log(taskId, `AI QA queued (${trigger === 'auto' ? 'the requirement entered QA' : 'Run AI QA'}) for ${commit.slice(0, 7)}`);
    }
    this.opts.emit?.({ type: 'qa_started', req_id: reqId, payload: { reqId, round, trigger, projects: repos.map((p) => p.name) } });
    this.opts.engine.nudge();
    return this.status(reqId);
  }

  /** The merge gate moved the requirement to QA: start AI QA when Settings → AI QA → Run automatically is on. Never throws. */
  public onEnteredQa(reqId: string, commits: Record<string, string>): void {
    if (!this.settings.getAiQaSettings().runAutomatically) return;
    try {
      this.start(reqId, 'auto', commits);
    } catch (err: any) {
      console.warn(`[ai-qa] ${reqId}: AI QA did not start: ${err?.message || err}`);
    }
  }

  /** `xticket comment`: an open review comment marked AI QA on the repository's card. */
  public addFinding(input: unknown, project: string, runId: string | undefined): { commentId: number; duplicate: boolean } {
    const finding = QaFindingInputSchema.parse(input);
    const qa = this.qaTaskOf(project, runId);
    this.requireQa(qa.req_id, 'finding');
    if (finding.line !== undefined && !finding.file_path) throw badRequest('--line needs --file');
    if (finding.file_path && !isSafeRelativePath(finding.file_path)) {
      throw badRequest('The file path must be relative to the repository (no leading / and no ..)');
    }
    const card = this.cardOf(qa.req_id, qa.project);
    if (!card) throw conflict(`${qa.req_id} has no task in ${qa.project} to put the finding on`);

    const title = oneLine(finding.title, 200);
    const file = finding.file_path ?? null;
    const line = finding.line ?? null;
    const same = (
      this.db.prepare('SELECT id, body_md FROM review_comments WHERE qa_task_id = ? AND file_path IS ? AND line IS ?').all(qa.id, file, line) as Array<{
        id: number;
        body_md: string;
      }>
    ).find((c) => titleKey(savedTitle(c.body_md)) === titleKey(title));
    if (same) return { commentId: same.id, duplicate: true };

    const max = this.settings.getAiQaSettings().maxFindings;
    const saved = (this.db.prepare('SELECT COUNT(*) AS n FROM review_comments WHERE qa_task_id = ?').get(qa.id) as { n: number }).n;
    if (saved >= max) throw conflict(`The QA run reached its limit of ${max} findings`);

    const body = finding.body.trim() ? `**${title}**\n\n${finding.body.trim()}` : `**${title}**`;
    const at = new Date().toISOString();
    const commentId = Number(
      this.db
        .prepare(`
          INSERT INTO review_comments (req_id, task_id, file_path, line, body_md, state, source, severity, qa_task_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'open', 'ai-qa', ?, ?, ?, ?)
        `)
        .run(qa.req_id, card.id, file, line, body, finding.severity, qa.id, at, at).lastInsertRowid
    );
    this.log(qa.id, `⚑ ${finding.severity}: ${title}${file ? ` (${file}${line ? `:${line}` : ''})` : ''}`);
    this.opts.emit?.({ type: 'qa_finding', req_id: qa.req_id, task_id: card.id, payload: { reqId: qa.req_id, project: qa.project, severity: finding.severity, commentId } });
    return { commentId, duplicate: false };
  }

  /** `xticket qa-result`: the run's verdict and summary. */
  public recordResult(input: unknown, project: string, runId: string | undefined): { ok: true; passed: boolean; summary: string } {
    const result = QaResultInputSchema.parse(input);
    const qa = this.qaTaskOf(project, runId);
    this.requireQa(qa.req_id, 'result');
    this.db
      .prepare('UPDATE bridge_tasks SET qa_passed = ?, qa_summary = ?, updated_at = ? WHERE id = ?')
      .run(result.passed ? 1 : 0, result.summary, new Date().toISOString(), qa.id);
    this.log(qa.id, `${result.passed ? '✓ AI QA passed' : '✗ AI QA found problems'}: ${oneLine(result.summary, 300)}`);
    this.opts.emit?.({ type: 'qa_result', req_id: qa.req_id, task_id: qa.id, payload: { reqId: qa.req_id, project: qa.project, passed: result.passed } });
    return { ok: true, passed: result.passed, summary: result.summary };
  }

  /** The requirement header: the latest QA round, per repository. */
  public status(reqId: string): RequirementQa {
    if (!this.opts.requirementService.getRequirement(reqId)) throw new HttpError(404, `Requirement ${reqId} not found`);
    const round = this.lastRound(reqId);
    const tasks = round
      ? (this.db.prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND role = 'qa' AND revision = ? ORDER BY project, id").all(reqId, round) as BridgeTask[])
      : [];
    const findings = { total: 0, blocker: 0, major: 0, minor: 0 };
    const runs: QaRunView[] = tasks.map((task) => {
      const counts = this.db
        .prepare('SELECT severity, COUNT(*) AS n FROM review_comments WHERE qa_task_id = ? GROUP BY severity')
        .all(task.id) as Array<{ severity: QaSeverity; n: number }>;
      let mine = 0;
      for (const c of counts) {
        mine += c.n;
        findings.total += c.n;
        if (c.severity in findings) findings[c.severity] += c.n;
      }
      return {
        task, project: task.project, status: task.status, passed: task.qa_passed == null ? null : task.qa_passed === 1,
        summary: task.qa_summary ?? null, error: task.last_error ?? null, findings: mine,
      };
    });
    const skipped = round
      ? this.projectsOf(reqId).filter((p) => !isGitWorkTree(p.repo_path)).map((p) => ({ project: p.name, reason: 'not a git repository' }))
      : [];
    return { reqId, round, running: tasks.some((t) => ACTIVE_STATUSES.includes(t.status)), runs, skipped, findings };
  }

  /** Enabled repositories with goal or ticket work in the requirement. */
  private projectsOf(reqId: string): Project[] {
    const rows = this.db
      .prepare("SELECT DISTINCT project FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled' ORDER BY project")
      .all(reqId) as Array<{ project: string }>;
    return rows.map((r) => this.opts.projectService.getProject(r.project)).filter((p): p is Project => Boolean(p?.enabled));
  }

  private activeTasks(reqId: string): number[] {
    const marks = ACTIVE_STATUSES.map(() => '?').join(', ');
    return (
      this.db.prepare(`SELECT id FROM bridge_tasks WHERE req_id = ? AND role = 'qa' AND status IN (${marks})`).all(reqId, ...ACTIVE_STATUSES) as Array<{ id: number }>
    ).map((r) => r.id);
  }

  private lastRound(reqId: string): number {
    return (this.db.prepare("SELECT MAX(revision) AS r FROM bridge_tasks WHERE req_id = ? AND role = 'qa'").get(reqId) as { r: number | null }).r ?? 0;
  }

  private insertTask(reqId: string, project: string, round: number, commit: string | null): number {
    const at = new Date().toISOString();
    return Number(
      this.db
        .prepare(`
          INSERT INTO bridge_tasks (req_id, project, role, title, status, base_sha, revision, created_at, updated_at)
          VALUES (?, ?, 'qa', ?, 'queued', ?, ?, ?, ?)
        `)
        .run(reqId, project, `AI QA · ${project}`, commit, round, at, at).lastInsertRowid
    );
  }

  private failTask(taskId: number, reason: string) {
    this.db.prepare("UPDATE bridge_tasks SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(reason, new Date().toISOString(), taskId);
    this.log(taskId, `✗ ${reason}`);
  }

  /** Why no AI CLI can run QA now (the engine's own wording), or null. */
  private cliProblem(settings: AiQaSettings, engine: LocalEngineStatus): string | null {
    if (!engine.enabled) return 'No AI CLI can run QA: the Local AI CLI engine is turned off (Settings → AI & Local Engines)';
    if (settings.agentCli === 'default') return engine.cli ? null : `No AI CLI can run QA: ${engine.problem ?? 'no AI CLI is installed and turned on'}`;
    const cli = engine.clis.find((c) => c.id === settings.agentCli);
    if (cli?.installed && cli.enabled) return null;
    const why = cli?.enabled === false ? 'is turned off in Settings → AI & Local Engines' : 'is not installed on this PC';
    return `No AI CLI can run QA: ${cli?.label ?? settings.agentCli} is chosen for AI QA but ${why}`;
  }

  /** Files the requirement changed in the repository: from its merge commits (branches may be deleted), else from its unmerged branches. */
  private changesOf(project: Project, reqId: string): { files: string[]; from: string | null } {
    const tasks = this.db
      .prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND project = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled' ORDER BY id")
      .all(reqId, project.name) as BridgeTask[];
    const files = new Set<string>();
    let from: string | null = null;
    for (const t of tasks) {
      if (t.merge_sha) {
        const parent = resolveCommit(project.repo_path, `${t.merge_sha}^1`);
        if (!parent) continue;
        from ??= parent;
        for (const f of diffSummary(project.repo_path, parent, t.merge_sha)) files.add(f.path);
      } else if (t.branch) {
        try {
          for (const f of this.taskChanges.changes(t.id).files) files.add(f.path);
        } catch {
          // The branch is gone: nothing to list for it.
        }
        from ??= t.base_sha ?? null;
      }
    }
    return { files: [...files].sort(), from };
  }

  /** The QA task an agent reports for: its run id (XTICKET_TASK) in its repository. */
  private qaTaskOf(project: string, runId: string | undefined): BridgeTask {
    const row = runId
      ? (this.db
          .prepare(`
            SELECT t.* FROM local_runs r JOIN bridge_tasks t ON t.id = r.bridge_task_id
            WHERE r.id = ? AND r.project = ? AND t.role = 'qa'
          `)
          .get(runId, project) as BridgeTask | undefined)
      : undefined;
    if (!row) throw new HttpError(404, `No QA run ${runId ?? '(XTICKET_TASK is not set)'} for ${project}; findings come from AI QA runs`);
    return row;
  }

  private requireQa(reqId: string, what: 'finding' | 'result') {
    const status = this.opts.requirementService.getRequirement(reqId)?.status;
    if (status !== 'qa') throw conflict(`${reqId} is no longer in QA; this ${what} was not saved`);
  }

  /** The repository's card: its goal, else its first ticket. */
  private cardOf(reqId: string, project: string): BridgeTask | undefined {
    return this.db
      .prepare(`
        SELECT * FROM bridge_tasks WHERE req_id = ? AND project = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'
        ORDER BY CASE role WHEN 'goal' THEN 0 ELSE 1 END, id LIMIT 1
      `)
      .get(reqId, project) as BridgeTask | undefined;
  }

  private log(taskId: number, message: string) {
    this.db.prepare("INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, 'system', ?, ?)").run(taskId, message, new Date().toISOString());
  }
}
