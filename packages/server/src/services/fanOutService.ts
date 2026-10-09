import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { EngineAdapter } from '../adapters/types.js';
import { BridgeTask } from '@sp-kickstack/shared';

export type AdapterFactory = (projectName: string) => EngineAdapter;

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
    mergePolicy: string = 'manual_review_merge'
  ): string {
    const mergePolicyDesc =
      mergePolicy === 'auto_merge_main'
        ? 'Changes on develop branch will be automatically merged to main upon task completion & green tests.'
        : 'All changes remain on develop branch and require human operator review and manual approval before merging into main.';

    return `# ${reqId} — ${title}  (project: ${project})

## Branch & Implementation Rules
- Target Branch: All changes must be developed on the \`${baseBranch}\` branch.
- Merge Strategy: ${mergePolicyDesc}

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

<untrusted_input name="requirement">
${requirementMd}
</untrusted_input>
`;
  }

  public async execute(reqId: string): Promise<BridgeTask[]> {
    const req = this.requirementService.getRequirement(reqId);
    if (!req) {
      throw new Error(`Requirement ${reqId} not found`);
    }

    this.requirementService.updateStatus(reqId, 'ready');

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

    const createdTasks: BridgeTask[] = [];

    for (const projectName of req.affected_projects) {
      const project = this.projectService.getProject(projectName);
      if (!project || !project.enabled) {
        continue;
      }

      // Idempotency check: has goal task already been created for (req_id, project, revision)?
      const existing = this.db
        .prepare(`
          SELECT * FROM bridge_tasks
          WHERE req_id = ? AND project = ? AND role = 'goal' AND revision = ?
        `)
        .get(reqId, projectName, req.revision) as any;

      if (existing) {
        createdTasks.push(existing);
        continue;
      }

      const baseBranch = project.base_branch || defaultBaseBranch;
      const title = `${req.id}: ${req.title}`;
      const bodyMd = this.formatGoalBody(req.id, req.title, projectName, req.body_md, baseBranch, mergePolicy);
      const adapter = this.getAdapter(projectName);

      let engineTaskId: string | null = null;
      let lastError: string | null = null;
      let engineUrl: string | null = null;
      let engineRawStatus: string | null = null;

      // Retry loop with backoff (3 attempts)
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const engineTask = await adapter.createGoal({ title, bodyMd });
          engineTaskId = engineTask.id;
          engineUrl = engineTask.url || null;
          engineRawStatus = engineTask.rawStatus || null;
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err.message || 'Unknown adapter error';
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 100));
          }
        }
      }

      const now = new Date().toISOString();
      const status = engineTaskId ? 'queued' : 'failed';

      const res = this.db
        .prepare(`
          INSERT INTO bridge_tasks (
            req_id, project, role, engine_task_id, title, body_md,
            depth, status, engine_status_raw, engine_url, last_error,
            revision, created_at, updated_at
          ) VALUES (
            @req_id, @project, 'goal', @engine_task_id, @title, @body_md,
            0, @status, @engine_status_raw, @engine_url, @last_error,
            @revision, @created_at, @updated_at
          )
        `)
        .run({
          req_id: reqId,
          project: projectName,
          engine_task_id: engineTaskId,
          title,
          body_md: bodyMd,
          status,
          engine_status_raw: engineRawStatus,
          engine_url: engineUrl,
          last_error: lastError,
          revision: req.revision,
          created_at: now,
          updated_at: now,
        });

      const task = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(res.lastInsertRowid) as BridgeTask;
      createdTasks.push(task);
    }

    this.requirementService.updateStatus(reqId, 'in_progress');
    return createdTasks;
  }
}
