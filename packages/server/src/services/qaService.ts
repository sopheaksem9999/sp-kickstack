// AI QA: one QA run per git repository of a requirement in review (on a merge preview) or in QA (on the
// merged code). The agent checks the code in a temporary checkout and reports findings (open review
// comments marked AI QA) and a result; a person decides what to send back.
import type { AgentCliId, AiQaSettings, BridgeTask, LocalEngineStatus, Project, QaRunView, QaSeverity, QaStage, RequirementQa } from '@sp-kickstack/shared';
import { QaFindingInputSchema, QaResultInputSchema } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';
import type { ProjectService } from './projectService.js';
import type { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { BranchService } from './branchService.js';
import { TaskChangesService } from './taskChanges.js';
import { isSafeRelativePath } from './reviewAssist.js';
import { buildMergePreview } from './mergePreview.js';
import { unmergedWorkByProject } from './unmergedWork.js';
import { BUILTIN_RISK_PATTERNS, classifyQaTier, qaProfileFor, type QaChangedFile } from './qaTier.js';
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
  /** Where merge previews are built (default: the OS temp dir). */
  tmpRoot?: string;
}

const ACTIVE_STATUSES = ['pending', 'queued', 'running', 'rate_limited'];
/** The requirement status a round of each stage checks. */
const STAGE_STATUS: Record<QaStage, string> = { review: 'in_review', qa: 'qa' };
const STAGE_WORDS: Record<QaStage, string> = { review: 'in review', qa: 'in QA' };

/** Same finding = same QA run, file, line and title (case and spacing ignored). */
const titleKey = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();
/** A saved finding's title: the bold first line of its comment. */
const savedTitle = (body: string) => /^\*\*(.+?)\*\*/.exec(body)?.[1] ?? body.split('\n')[0];

interface CommitToCheck {
  commit: string | null;
  from: string | null;
  files: QaChangedFile[];
  error?: string;
}

export class QaService {
  private db: AppDatabase;
  private settings: SettingsService;
  private branches: BranchService;
  private taskChanges: TaskChangesService;
  private runs: RunStore;
  /** Rounds being prepared (previews are built before their QA tasks exist): the header already shows them as running. */
  private starting = new Map<string, { stage: QaStage; round: number }>();

  constructor(private opts: QaServiceOptions) {
    this.db = opts.db;
    this.settings = opts.settingsService ?? new SettingsService(opts.db);
    this.branches = opts.branchService ?? new BranchService(opts.db, opts.projectService, this.settings);
    this.taskChanges = new TaskChangesService(opts.db);
    this.runs = new RunStore(opts.db);
  }

  /** Start AI QA for every git repository of a requirement in review (merge preview) or in QA (merged code). */
  public async start(reqId: string, trigger: 'auto' | 'manual'): Promise<RequirementQa> {
    const req = this.opts.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
    const stage: QaStage | null = req.status === 'in_review' ? 'review' : req.status === 'qa' ? 'qa' : null;
    if (!stage) throw conflict(`${reqId} is ${req.status}; AI QA runs while a requirement is in review or in QA`);
    if (req.merge_state === 'running') throw conflict(`A merge of ${reqId} is running; wait for it to finish`);
    if (!this.opts.engine) throw new HttpError(503, 'The Local AI CLI engine is not running in this server');
    if (this.starting.has(reqId) || this.activeTasks(reqId).length > 0) throw conflict(`AI QA is already running for ${reqId}`);
    const projects = this.projectsOf(reqId);
    if (projects.length === 0) throw conflict(`${reqId} has no repository work to check`);
    const repos = projects.filter((p) => isGitWorkTree(p.repo_path));
    if (repos.length === 0) throw conflict(`No repository of ${reqId} is a git repository; AI QA needs one`);

    const round = this.lastRound(reqId) + 1;
    this.starting.set(reqId, { stage, round });
    try {
      const settings = this.settings.getAiQaSettings();
      const engine = this.opts.engine.status();
      const cliProblem = this.cliProblem(settings, engine);
      const cli: AgentCliId | null = settings.agentCli === 'default' ? engine.cli : settings.agentCli;
      const unmerged = stage === 'review' ? unmergedWorkByProject(this.db, reqId) : new Map<string, BridgeTask[]>();
      for (const project of repos) {
        const base = this.branches.baseBranchFor(project, reqId);
        const check = await this.commitToCheck(project, reqId, stage, base, unmerged.get(project.name) ?? []);
        const taskId = this.insertTask(reqId, project.name, round, check.commit, stage);
        if (check.error) {
          this.failTask(taskId, check.error);
          continue;
        }
        if (!check.commit) {
          this.failTask(taskId, `${project.name}: branch ${base} was not found, so there is no commit to check`);
          continue;
        }
        if (cliProblem) {
          this.failTask(taskId, cliProblem);
          continue;
        }
        const choice =
          settings.modelMode === 'auto'
            ? classifyQaTier(check.files, [...(project.high_risk_paths ?? []), ...BUILTIN_RISK_PATTERNS], settings)
            : null;
        const profile = qaProfileFor(settings, cli, choice?.tier ?? null);
        this.db.prepare('UPDATE bridge_tasks SET qa_tier = ?, qa_tier_reason = ? WHERE id = ?').run(choice?.tier ?? null, choice?.reason ?? null, taskId);
        const bodyMd = buildQaPrompt({
          reqId, title: req.title, bodyMd: req.body_md, project: project.name, commit: check.commit, from: check.from,
          changedFiles: check.files.map((f) => f.path),
          commands: { test: project.test_command, build: project.build_command, lint: project.lint_command },
          maxFindings: settings.maxFindings, stage, previewInto: stage === 'review' ? base : null,
        });
        this.runs.create({
          bridgeTaskId: taskId, project: project.name, title: `AI QA · ${reqId}`, bodyMd, model: profile.model, effort: profile.effort,
          preferredCli: settings.agentCli === 'default' ? null : settings.agentCli,
        });
        const why = choice ? ` · ${choice.tier}: ${choice.reason}` : '';
        const uses = `${profile.model ?? 'the CLI default model'} · ${profile.effort ?? 'the default effort'}`;
        this.log(taskId, `AI QA queued (${trigger === 'auto' ? 'the requirement entered review' : 'Run AI QA'}) for ${check.commit.slice(0, 7)}${why} → ${uses}`);
      }
      this.opts.emit?.({ type: 'qa_started', req_id: reqId, payload: { reqId, round, stage, trigger, projects: repos.map((p) => p.name) } });
      this.opts.engine.nudge();
    } finally {
      this.starting.delete(reqId);
    }
    return this.status(reqId);
  }

  /** The requirement entered review: start AI QA when Settings → AI QA → Run automatically is on. Never throws. */
  public async onEnteredReview(reqId: string): Promise<void> {
    if (!this.settings.getAiQaSettings().runAutomatically) return;
    try {
      await this.start(reqId, 'auto');
    } catch (err: any) {
      console.warn(`[ai-qa] ${reqId}: AI QA did not start: ${err?.message || err}`);
    }
  }

  /** Why an automatic merge must wait for AI QA, or null. */
  public autoMergeHold(reqId: string): string | null {
    const marks = ACTIVE_STATUSES.map(() => '?').join(', ');
    const active = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM bridge_tasks WHERE req_id = ? AND role = 'qa' AND qa_stage = 'review' AND status IN (${marks})`)
        .get(reqId, ...ACTIVE_STATUSES) as { n: number }
    ).n;
    if (active > 0 || this.starting.has(reqId)) return 'AI QA is still checking';
    const blockers = this.openReviewBlockers(reqId);
    if (blockers > 0) return `${blockers} open AI QA blocker${blockers === 1 ? '' : 's'}`;
    return null;
  }

  /** `xticket comment`: an open review comment marked AI QA on the repository's card. */
  public addFinding(input: unknown, project: string, runId: string | undefined): { commentId: number; duplicate: boolean } {
    const finding = QaFindingInputSchema.parse(input);
    const qa = this.qaTaskOf(project, runId);
    this.requireStage(qa, 'finding');
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
    this.requireStage(qa, 'result');
    this.db
      .prepare('UPDATE bridge_tasks SET qa_passed = ?, qa_summary = ?, updated_at = ? WHERE id = ?')
      .run(result.passed ? 1 : 0, result.summary, new Date().toISOString(), qa.id);
    this.log(qa.id, `${result.passed ? '✓ AI QA passed' : '✗ AI QA found problems'}: ${oneLine(result.summary, 300)}`);
    this.opts.emit?.({ type: 'qa_result', req_id: qa.req_id, task_id: qa.id, payload: { reqId: qa.req_id, project: qa.project, passed: result.passed } });
    return { ok: true, passed: result.passed, summary: result.summary };
  }

  /** The requirement header: the latest QA round, per repository. */
  public status(reqId: string): RequirementQa {
    const req = this.opts.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
    const preparing = this.starting.get(reqId);
    const round = preparing?.round ?? this.lastRound(reqId);
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
        tier: task.qa_tier ?? null, tierReason: task.qa_tier_reason ?? null,
      };
    });
    const skipped = round
      ? this.projectsOf(reqId).filter((p) => !isGitWorkTree(p.repo_path)).map((p) => ({ project: p.name, reason: 'not a git repository' }))
      : [];
    const stage: QaStage | null = preparing?.stage ?? (tasks.length ? (tasks[0].qa_stage ?? 'qa') : null);
    const first = tasks.length ? this.opts.projectService.getProject(tasks[0].project) : null;
    const holds = req.status === 'in_review' && this.branches.policyFor(reqId) === 'auto_merge';
    return {
      reqId, round, running: Boolean(preparing) || tasks.some((t) => ACTIVE_STATUSES.includes(t.status)), runs, skipped, findings, stage,
      previewInto: stage === 'review' && first ? this.branches.baseBranchFor(first, reqId) : null,
      openBlockers: this.openReviewBlockers(reqId),
      autoMergeHold: holds ? this.autoMergeHold(reqId) : null,
    };
  }

  /** In review: the merge preview of the repository's unmerged branches; in QA (or with nothing unmerged): the branch tip. */
  private async commitToCheck(project: Project, reqId: string, stage: QaStage, base: string, unmerged: BridgeTask[]): Promise<CommitToCheck> {
    if (stage === 'review' && unmerged.length > 0) {
      const preview = await buildMergePreview(project.repo_path, base, project.name, reqId, unmerged, { tmpRoot: this.opts.tmpRoot });
      if (!preview.ok) return { commit: null, from: null, files: [], error: preview.error };
      return { commit: preview.sha, from: preview.from, files: diffSummary(project.repo_path, preview.from, preview.sha) };
    }
    const commit = resolveCommit(project.repo_path, `refs/heads/${base}`) ?? resolveCommit(project.repo_path, `refs/remotes/origin/${base}`);
    const changes = this.changesOf(project, reqId);
    return { commit, from: changes.from, files: changes.files };
  }

  /** Open AI QA blocker findings from review rounds of the requirement. */
  private openReviewBlockers(reqId: string): number {
    return (
      this.db
        .prepare(`
          SELECT COUNT(*) AS n FROM review_comments c JOIN bridge_tasks q ON q.id = c.qa_task_id
          WHERE c.req_id = ? AND c.source = 'ai-qa' AND c.severity = 'blocker' AND c.state = 'open' AND q.qa_stage = 'review'
        `)
        .get(reqId) as { n: number }
    ).n;
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

  private insertTask(reqId: string, project: string, round: number, commit: string | null, stage: QaStage): number {
    const at = new Date().toISOString();
    return Number(
      this.db
        .prepare(`
          INSERT INTO bridge_tasks (req_id, project, role, title, status, base_sha, revision, qa_stage, created_at, updated_at)
          VALUES (?, ?, 'qa', ?, 'queued', ?, ?, ?, ?, ?)
        `)
        .run(reqId, project, `AI QA · ${project}`, commit, round, stage, at, at).lastInsertRowid
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
  private changesOf(project: Project, reqId: string): { files: QaChangedFile[]; from: string | null } {
    const tasks = this.db
      .prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND project = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled' ORDER BY id")
      .all(reqId, project.name) as BridgeTask[];
    const files = new Map<string, QaChangedFile>();
    const add = (f: QaChangedFile) => {
      const known = files.get(f.path);
      files.set(f.path, known ? { ...known, additions: known.additions + f.additions, deletions: known.deletions + f.deletions } : { ...f });
    };
    let from: string | null = null;
    for (const t of tasks) {
      if (t.merge_sha) {
        const parent = resolveCommit(project.repo_path, `${t.merge_sha}^1`);
        if (!parent) continue;
        from ??= parent;
        for (const f of diffSummary(project.repo_path, parent, t.merge_sha)) add(f);
      } else if (t.branch) {
        try {
          for (const f of this.taskChanges.changes(t.id).files) add(f);
        } catch {
          // The branch is gone: nothing to list for it.
        }
        from ??= t.base_sha ?? null;
      }
    }
    return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), from };
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

  /** Reports are saved while the requirement is still in the stage its round checks. */
  private requireStage(qa: BridgeTask, what: 'finding' | 'result') {
    const stage: QaStage = qa.qa_stage ?? 'qa';
    const status = this.opts.requirementService.getRequirement(qa.req_id)?.status;
    if (status !== STAGE_STATUS[stage]) throw conflict(`${qa.req_id} is no longer ${STAGE_WORDS[stage]}; this ${what} was not saved`);
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
