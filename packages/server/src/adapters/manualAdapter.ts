import { EngineTask, NormStatus } from '@sp-kickstack/shared';
import { CreateEngineTaskInput, EngineAdapter } from './types.js';

export class ManualAdapter implements EngineAdapter {
  public type = 'manual' as const;
  private tasks = new Map<string, EngineTask>();
  private nextId = 1;

  public async health(): Promise<{ ok: boolean; version?: string }> {
    return { ok: true, version: 'manual-v1' };
  }

  public async createGoal(input: CreateEngineTaskInput): Promise<EngineTask> {
    const id = `manual-${this.nextId++}`;
    const task: EngineTask = {
      id,
      title: input.title,
      status: 'queued',
      rawStatus: 'manual_pending',
    };
    this.tasks.set(id, task);
    return task;
  }

  public async createTask(input: CreateEngineTaskInput): Promise<EngineTask> {
    const id = `manual-${this.nextId++}`;
    const task: EngineTask = {
      id,
      title: input.title,
      status: 'queued',
      rawStatus: 'manual_pending',
    };
    this.tasks.set(id, task);
    return task;
  }

  public async getTask(id: string): Promise<EngineTask | null> {
    return this.tasks.get(id) || null;
  }

  public async listTasks(ids: string[]): Promise<EngineTask[]> {
    return ids.map((id) => this.tasks.get(id)).filter(Boolean) as EngineTask[];
  }

  public async holdTask(id: string, _reason: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'held';
      task.rawStatus = 'manual_held';
    }
  }

  public async releaseTask(id: string, _context: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'queued';
      task.rawStatus = 'manual_released';
    }
  }

  public async appendNote(_id: string, _bodyMd: string): Promise<void> {
    // No-op for manual
  }

  public async cancelTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'cancelled';
      task.rawStatus = 'manual_cancelled';
    }
  }

  public setStatus(id: string, status: NormStatus) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
    }
  }
}
