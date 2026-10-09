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

  public formatGoalBody(reqId: string, title: string, project: string, requirementMd: string): string {
    return `# ${reqId} — ${title}  (project: ${project})

## What to do
1. Read the requirement below and inspect this codebase.
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

      const title = `${req.id}: ${req.title}`;
      const bodyMd = this.formatGoalBody(req.id, req.title, projectName, req.body_md);
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
          engineRawStatus = engineTask.rawStatus || 'ready';
          break;
        } catch (err: any) {
          lastError = err.message;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 50 * attempt));
          }
        }
      }

      const now = new Date().toISOString();
      const info = this.db
        .prepare(`
          INSERT INTO bridge_tasks (
            req_id, project, role, engine_task_id, title, body_md,
            depth, status, engine_status_raw, engine_url, last_error, revision, created_at, updated_at
          ) VALUES (?, ?, 'goal', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          reqId,
          projectName,
          engineTaskId,
          title,
          bodyMd,
          engineTaskId ? 'queued' : 'failed',
          engineRawStatus,
          engineUrl,
          lastError,
          req.revision,
          now,
          now
        );

      const created = this.db
        .prepare('SELECT * FROM bridge_tasks WHERE id = ?')
        .get(info.lastInsertRowid) as BridgeTask;

      createdTasks.push(created);
    }

    this.requirementService.updateStatus(reqId, 'in_progress');
    return createdTasks;
  }
}
