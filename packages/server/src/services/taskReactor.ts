import { AppDatabase } from '../db/index.js';
import { RequirementService } from './requirementService.js';
import { LinkService } from './linkService.js';
import { BridgeTask, Link, NormStatus } from '@sp-kickstack/shared';

export interface ReactorEvent {
  type: string;
  req_id?: string;
  task_id?: number;
  payload: Record<string, unknown>;
}

export type ReactorEmit = (event: ReactorEvent) => void;

export type StatusChangeSource = 'watcher' | 'webhook' | 'manual';

/**
 * The single reaction path for a bridge task changing status, whoever observed it
 * (engine watcher, VCS webhook, operator). Callers persist the new status first, then
 * call onTaskStatusChanged once.
 */
export class TaskReactor {
  constructor(
    private db: AppDatabase,
    private requirementService: RequirementService,
    private linkService?: LinkService,
    private emit?: ReactorEmit
  ) {}

  public recordEvent(type: string, req_id?: string, task_id?: number, payload: Record<string, unknown> = {}) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(req_id || null, task_id || null, type, JSON.stringify(payload), new Date().toISOString());
    this.emit?.({ type, req_id, task_id, payload });
  }

  public async onTaskStatusChanged(
    task: BridgeTask,
    oldStatus: NormStatus,
    newStatus: NormStatus,
    source: StatusChangeSource,
    extra: { rawStatus?: string | null; prUrl?: string | null } = {}
  ): Promise<{ releasedLinks: Link[] }> {
    this.recordEvent('task_status_changed', task.req_id, task.id, {
      taskId: task.id,
      reqId: task.req_id,
      project: task.project,
      oldStatus,
      newStatus,
      rawStatus: extra.rawStatus ?? null,
      prUrl: extra.prUrl ?? task.pr_url ?? null,
      source,
    });

    let releasedLinks: Link[] = [];
    if (newStatus === 'done' && this.linkService) {
      releasedLinks = await this.linkService.evaluateDependencyResolved(task.id);
      if (releasedLinks.length > 0) {
        this.recordEvent('link_released', task.req_id, task.id, {
          taskId: task.id,
          linkIds: releasedLinks.map((l) => l.id),
        });
      }
    } else if (newStatus === 'failed' || newStatus === 'cancelled') {
      if (newStatus === 'failed') {
        this.recordEvent('task_failed', task.req_id, task.id, { taskId: task.id, project: task.project });
      }
      // Dependents stay held; the operator decides (retry, cancel dependents, release anyway).
      const waiting = this.db
        .prepare("SELECT task_id FROM links WHERE depends_on_id = ? AND state = 'waiting'")
        .all(task.id) as Array<{ task_id: number }>;
      if (waiting.length > 0) {
        this.recordEvent('task_blocked', task.req_id, task.id, {
          dependencyTaskId: task.id,
          dependencyStatus: newStatus,
          waitingTaskIds: waiting.map((w) => w.task_id),
        });
      }
    }

    const before = this.requirementService.getRequirement(task.req_id)?.status;
    const after = this.requirementService.recalculateDerivedStatus(task.req_id);
    if (before && after !== before) {
      this.emit?.({
        type: 'requirement_status_changed',
        req_id: task.req_id,
        payload: { id: task.req_id, status: after },
      });
    }

    return { releasedLinks };
  }
}
