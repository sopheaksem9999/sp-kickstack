import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { EngineAdapter } from '../adapters/types.js';
import { BridgeTask } from '@sp-kickstack/shared';
import { oneLine, wrapUntrusted } from '../lib/promptSafety.js';
import { HttpError, conflict } from '../lib/httpError.js';
import { RequirementStatus } from '@sp-kickstack/shared';

export type AdapterFactory = (projectName: string) => EngineAdapter;

const FANOUT_FROM: RequirementStatus[] = ['draft', 'ready', 'in_progress'];

export class FanOutService {
  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private requirementService: RequirementService,
    private getAdapter: AdapterFactory
  ) {}

  public formatGoalBody(
    reqId: string,
    title: string,
    project: string,
    requirementMd: string,
    baseBranch: string = 'develop',
    mergePolicy: string = 'manual_review_merge',
    sharedAssets: Array<{ name: string; notes?: string }> = []
  ): string {
    const mergePolicyDesc =
      mergePolicy === 'auto_merge_main'
        ? 'Changes on develop branch will be automatically merged to main upon task completion & green tests.'
        : 'All changes remain on develop branch and require human operator review and manual approval before merging into main.';

    const assetsBlock =
      sharedAssets.length > 0
        ? `\n## Shared Workspace Assets & Contracts\n` +
          sharedAssets.map((a) => `- **${oneLine(a.name)}**${a.notes ? `: ${oneLine(a.notes)}` : ''}`).join('\n') +
          '\n'
        : '';

    return `# ${reqId} — ${oneLine(title)}  (project: ${project})

## Branch & Implementation Rules
- Target Branch: All changes must be developed on the \`${baseBranch}\` branch.
- Merge Strategy: ${mergePolicyDesc}
${assetsBlock}
## Execution Autonomy & Headless Protocol (Strategy A)
- **Operate headlessly & autonomously**: Do NOT halt execution to ask user confirmation for running standard builds, package installations, tests, or mechanical file refactorings.
- **Architectural Disambiguation**: If an implementation fork or design choice arises, pick the safest industry standard convention, record the rationale in \`specs/${reqId}/decision.md\`, and proceed without waiting for interactive human prompts.
- **Cross-Service Contracts**: Never pause to chat interactively with the human about other repositories; instead issue a blocking \`xticket\` so the dependency graph handles orchestration automatically.

## What to do
1. Read the requirement below and inspect this codebase on the \`${baseBranch}\` branch.
2. Write \`specs/${reqId}/spec.md\` (what THIS project must do, affected modules,
   data/API changes, edge cases, risks, test strategy) and \`specs/${reqId}/plan.md\`
   (ordered implementation steps).
3. Implement following this repository's own rules (AGENTS.md / CLAUDE.md) and add tests.
4. If you need something from another project (for example a new endpoint),
   run \`xticket create --to <project> --type api_request --title ... --body "..." --blocking\`
   with a precise contract (method, path, params, response, errors), commit WIP changes,
   then stop and report that you are blocked.
5. Never modify other repositories. Never run deployments or destructive commands.

${wrapUntrusted('requirement', requirementMd)}
`;
  }

  /**
   * Fan a requirement out to one goal task per enabled affected project.
   *
   * Goal rows are reserved synchronously (status 'pending') before any engine call, so a
   * concurrent or repeated call cannot create a second goal (ux_goal_once backs this up at
   * the DB level). Only rows this call reserved, or failed rows it re-claimed, are sent to
   * their engines, in parallel. Returns the requirement's goals in affected-project order.
   */
  public async execute(reqId: string): Promise<BridgeTask[]> {
    const req = this.requirementService.getRequirement(reqId);
    if (!req) {
      throw new HttpError(404, `Requirement ${reqId} not found`);
    }
    if (!FANOUT_FROM.includes(req.status)) {
      throw conflict(`Requirement ${reqId} is ${req.status}; fan-out is only allowed from draft, ready or in_progress`);
    }

    // Retrieve branch and merge settings
    let defaultBaseBranch = 'develop';
    let mergePolicy = 'manual_review_merge';
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = 'branch_merge_settings'").get() as any;
      if (row?.value) {
        const parsed = JSON.parse(row.value);
        if (parsed.default_base_branch) defaultBaseBranch = parsed.default_base_branch;
        if (parsed.merge_policy) mergePolicy = parsed.merge_policy;
      }
    } catch {
      // Use fallback
    }

    // Per-ticket override takes precedence if defined
    if (req.merge_policy) {
      mergePolicy = req.merge_policy;
    }

    // Retrieve shared assets for workspace
    const workspaceId = req.workspace_id || 'default';
    const sharedAssets = this.db
      .prepare('SELECT name, type, size, notes FROM shared_assets WHERE workspace_id = ?')
      .all(workspaceId) as any[];

    const projects = req.affected_projects
      .map((name) => this.projectService.getProject(name))
      .filter((p): p is NonNullable<typeof p> => Boolean(p && p.enabled));
    if (projects.length === 0) {
      throw conflict(`Requirement ${reqId} has no enabled projects to fan out to`);
    }

    // Reserve synchronously: no await between the uniqueness check and the insert.
    const toDispatch: number[] = [];
    const now = new Date().toISOString();
    const reserve = this.db.prepare(`
      INSERT INTO bridge_tasks (
        req_id, project, role, title, body_md, depth, status, revision, attempts, created_at, updated_at
      ) VALUES (?, ?, 'goal', ?, ?, 0, 'pending', ?, 1, ?, ?)
      ON CONFLICT DO NOTHING
    `);
    const reclaimFailed = this.db.prepare(`
      UPDATE bridge_tasks SET status = 'pending', attempts = attempts + 1, last_error = NULL, updated_at = ?
      WHERE req_id = ? AND project = ? AND role = 'goal' AND revision = ?
        AND status = 'failed' AND engine_task_id IS NULL
      RETURNING id
    `);
    this.db.transaction(() => {
      for (const project of projects) {
        const baseBranch = project.base_branch || defaultBaseBranch;
        const title = `${req.id}: ${req.title}`;
        const bodyMd = this.formatGoalBody(req.id, req.title, project.name, req.body_md, baseBranch, mergePolicy, sharedAssets);
        const inserted = reserve.run(req.id, project.name, title, bodyMd, req.revision, now, now);
        if (inserted.changes === 1) {
          toDispatch.push(Number(inserted.lastInsertRowid));
          continue;
        }
        const reclaimed = reclaimFailed.get(now, req.id, project.name, req.revision) as { id: number } | undefined;
        if (reclaimed) toDispatch.push(reclaimed.id);
      }
    })();

    await Promise.allSettled(toDispatch.map((id) => this.dispatchGoal(id)));

    const goals = this.goalsFor(req.id, req.revision, projects.map((p) => p.name));
    this.applyFanOutStatus(req.id, goals);
    return goals;
  }

  /** Send one reserved ('pending') goal to its engine, with 3 tries and backoff. */
  public async dispatchGoal(taskId: number): Promise<void> {
    const task = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as BridgeTask | undefined;
    if (!task || task.status !== 'pending') return;

    let lastError = 'Unknown adapter error';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const engineTask = await this.getAdapter(task.project).createGoal({ title: task.title, bodyMd: task.body_md || '' });
        this.db
          .prepare(`
            UPDATE bridge_tasks
            SET engine_task_id = ?, status = 'queued', engine_status_raw = ?, engine_url = ?, last_error = NULL, updated_at = ?
            WHERE id = ? AND status = 'pending'
          `)
          .run(engineTask.id, engineTask.rawStatus || null, engineTask.url || null, new Date().toISOString(), taskId);
        return;
      } catch (err: any) {
        lastError = err?.message || lastError;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 100));
        }
      }
    }

    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE bridge_tasks SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(lastError, now, taskId);
    this.db
      .prepare("INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, 'task_failed', ?, 0, ?)")
      .run(task.req_id, taskId, JSON.stringify({ taskId, project: task.project, error: lastError, stage: 'fan-out' }), now);
  }

  /**
   * Requirement status after a fan-out: in_progress once any goal reached its engine;
   * a draft whose goals all failed becomes ready; never moves backwards.
   */
  public applyFanOutStatus(reqId: string, goals: BridgeTask[]) {
    const current = this.requirementService.getRequirement(reqId)?.status;
    if (current !== 'draft' && current !== 'ready') return;

    if (goals.some((g) => g.engine_task_id)) {
      this.requirementService.updateStatus(reqId, 'in_progress');
    } else if (current === 'draft' && !goals.some((g) => g.status === 'pending')) {
      this.requirementService.updateStatus(reqId, 'ready');
    }
  }

  private goalsFor(reqId: string, revision: number, projectOrder: string[]): BridgeTask[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM bridge_tasks
        WHERE req_id = ? AND role = 'goal' AND revision = ? AND status <> 'cancelled'
      `)
      .all(reqId, revision) as BridgeTask[];
    return projectOrder
      .map((name) => rows.find((r) => r.project === name))
      .filter((r): r is BridgeTask => Boolean(r));
  }
}
