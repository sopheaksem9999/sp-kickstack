import { AppDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { AdapterFactory } from '../services/fanOutService.js';
import { BridgeTask, NormStatus } from '@sp-kickstack/shared';
import { TaskReactor } from '../services/taskReactor.js';

export type EventCallback = (event: {
  type: string;
  req_id?: string;
  task_id?: number;
  payload: Record<string, unknown>;
}) => void;

export class EngineWatcher {
  private timer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private reactor: TaskReactor;

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private requirementService: RequirementService,
    private getAdapter: AdapterFactory,
    private onEvent?: EventCallback,
    private pollIntervalMs: number = 5000,
    reactor?: TaskReactor
  ) {
    // Without an injected reactor (tests, scripts) links are not evaluated; index.ts injects one.
    this.reactor = reactor ?? new TaskReactor(db, requirementService, undefined, onEvent);
  }

  public recordEvent(
    type: string,
    req_id?: string,
    task_id?: number,
    payload: Record<string, unknown> = {}
  ) {
    this.reactor.recordEvent(type, req_id, task_id, payload);
  }

  public async scanOnce(): Promise<number> {
    if (this.isScanning) return 0;
    this.isScanning = true;
    let changesCount = 0;

    try {
      // Find all tasks that are not terminal
      const activeTasks = this.db
        .prepare(`
          SELECT * FROM bridge_tasks
          WHERE status NOT IN ('done', 'cancelled', 'failed')
          AND engine_task_id IS NOT NULL
        `)
        .all() as BridgeTask[];

      // Group active tasks by project
      const tasksByProject = new Map<string, BridgeTask[]>();
      for (const t of activeTasks) {
        const list = tasksByProject.get(t.project) || [];
        list.push(t);
        tasksByProject.set(t.project, list);
      }

      for (const [projectName, tasks] of tasksByProject.entries()) {
        const project = this.projectService.getProject(projectName);
        if (!project || !project.enabled) continue;

        const adapter = this.getAdapter(projectName);

        // Check health
        const health = await adapter.health();
        if (!health.ok) {
          if (project.engine_status !== 'down') {
            this.projectService.updateEngineStatus(projectName, 'down');
            this.recordEvent('engine_down', undefined, undefined, {
              project: projectName,
              error: health.error,
            });
          }
          continue;
        } else if (project.engine_status === 'down') {
          this.projectService.updateEngineStatus(projectName, 'ok');
          this.recordEvent('engine_up', undefined, undefined, { project: projectName });
        }

        // Query each task
        for (const task of tasks) {
          try {
            const engineTask = await adapter.getTask(task.engine_task_id!);
            if (!engineTask) continue;

            const rawChanged = engineTask.rawStatus !== task.engine_status_raw;
            const statusChanged = engineTask.status !== task.status;
            const prChanged = (engineTask.prUrl || null) !== (task.pr_url || null);

            if (statusChanged || rawChanged || prChanged) {
              const oldStatus = task.status;
              const now = new Date().toISOString();

              // Guarded on the status we read before awaiting the engine: if someone else
              // (webhook, operator, link release) changed it meanwhile, theirs wins.
              const updated = this.db
                .prepare(`
                  UPDATE bridge_tasks
                  SET status = ?, engine_status_raw = ?, pr_url = COALESCE(?, pr_url), updated_at = ?
                  WHERE id = ? AND status = ?
                `)
                .run(
                  engineTask.status,
                  engineTask.rawStatus,
                  engineTask.prUrl || null,
                  now,
                  task.id,
                  oldStatus
                );
              if (updated.changes !== 1) continue;
              changesCount++;

              if (statusChanged) {
                await this.reactor.onTaskStatusChanged(
                  { ...task, pr_url: engineTask.prUrl || task.pr_url },
                  oldStatus,
                  engineTask.status,
                  'watcher',
                  { rawStatus: engineTask.rawStatus, prUrl: engineTask.prUrl || null }
                );
              } else {
                // Raw status / PR link only: refresh clients without a notification row.
                this.onEvent?.({
                  type: 'task_updated',
                  req_id: task.req_id,
                  task_id: task.id,
                  payload: { taskId: task.id, rawStatus: engineTask.rawStatus, prUrl: engineTask.prUrl || null },
                });
              }
            }
          } catch (err: any) {
            // Task query error; keep old state
          }
        }
      }
    } finally {
      this.isScanning = false;
    }

    return changesCount;
  }

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.scanOnce().catch(() => {});
    }, this.pollIntervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
