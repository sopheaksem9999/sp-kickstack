import { AppDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { AdapterFactory } from '../services/fanOutService.js';
import { BridgeTask, NormStatus } from '@sp-kickstack/shared';
import { TaskReactor } from '../services/taskReactor.js';
import { LinkService } from '../services/linkService.js';
import { forEachLimit } from '../lib/concurrency.js';

export type EventCallback = (event: {
  type: string;
  req_id?: string;
  task_id?: number;
  payload: Record<string, unknown>;
}) => void;

const TASKS_IN_FLIGHT_PER_ENGINE = 4;
const MAX_DOWN_BACKOFF_MS = 5 * 60 * 1000;

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
    // The watcher has everything a LinkService needs, so even without an injected reactor
    // a finished dependency always releases its dependents.
    this.reactor =
      reactor ?? new TaskReactor(db, requirementService, new LinkService(db, projectService, getAdapter), onEvent);
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

      // Engines are independent: poll them in parallel.
      const results = await Promise.allSettled(
        [...tasksByProject.entries()].map(([projectName, tasks]) => this.scanProject(projectName, tasks))
      );
      return results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
    } finally {
      this.isScanning = false;
    }
  }

  private downBackoff = new Map<string, { until: number; delayMs: number }>();

  private async scanProject(projectName: string, tasks: BridgeTask[]): Promise<number> {
    const project = this.projectService.getProject(projectName);
    // Manual projects have no engine to poll: people and webhooks move their tasks.
    if (!project || !project.enabled || project.engine_type === 'manual') return 0;

    // A down engine is re-checked with exponential backoff, not on every tick.
    const backoff = this.downBackoff.get(projectName);
    if (backoff && backoff.until > Date.now()) return 0;

    let adapter: ReturnType<AdapterFactory>;
    try {
      adapter = this.getAdapter(projectName);
    } catch (err: any) {
      console.warn(`[watcher] no adapter for ${projectName}: ${err?.message || err}`);
      return 0;
    }

    const health = await adapter.health();
    if (!health.ok) {
      const delayMs = Math.min((backoff?.delayMs ?? this.pollIntervalMs / 2) * 2, MAX_DOWN_BACKOFF_MS);
      this.downBackoff.set(projectName, { until: Date.now() + delayMs, delayMs });
      if (project.engine_status !== 'down') {
        this.projectService.updateEngineStatus(projectName, 'down');
        this.recordEvent('engine_down', undefined, undefined, {
          project: projectName,
          error: health.error,
        });
      }
      return 0;
    }
    this.downBackoff.delete(projectName);
    if (project.engine_status === 'down') {
      this.projectService.updateEngineStatus(projectName, 'ok');
      this.recordEvent('engine_up', undefined, undefined, { project: projectName });
    }

    let changes = 0;
    await forEachLimit(tasks, TASKS_IN_FLIGHT_PER_ENGINE, async (task) => {
      try {
        if (await this.syncTask(adapter, task)) changes++;
      } catch (err: any) {
        console.warn(`[watcher] ${projectName} task #${task.id} (${task.engine_task_id}): ${err?.message || err}`);
      }
    });
    return changes;
  }

  /** Compare one task with its engine; persist and react to a change. Returns true if it changed. */
  private async syncTask(adapter: ReturnType<AdapterFactory>, task: BridgeTask): Promise<boolean> {
    const engineTask = await adapter.getTask(task.engine_task_id!);
    if (!engineTask) return false;

    const rawChanged = engineTask.rawStatus !== task.engine_status_raw;
    const statusChanged = engineTask.status !== task.status;
    const prChanged = (engineTask.prUrl || null) !== (task.pr_url || null);
    if (!statusChanged && !rawChanged && !prChanged) return false;

    const oldStatus = task.status;
    // Guarded on the status we read before awaiting the engine: if someone else
    // (webhook, operator, link release) changed it meanwhile, theirs wins.
    const updated = this.db
      .prepare(`
        UPDATE bridge_tasks
        SET status = ?, engine_status_raw = ?, pr_url = COALESCE(?, pr_url), updated_at = ?
        WHERE id = ? AND status = ?
      `)
      .run(engineTask.status, engineTask.rawStatus, engineTask.prUrl || null, new Date().toISOString(), task.id, oldStatus);
    if (updated.changes !== 1) return false;

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
    return true;
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
