import type { EngineTask, NormStatus, Project } from '@sp-kickstack/shared';
import type { CreateEngineTaskInput, EngineAdapter } from './types.js';
import type { LocalRun, RunStatus, RunStore } from '../localEngine/runStore.js';

/** What the adapter needs from the runner (AgentRunner implements it). */
export interface LocalEngine {
  readonly runs: RunStore;
  health(): { ok: boolean; version?: string; error?: string };
  nudge(): void;
  hold(runId: string, reason: string): void;
  release(runId: string, context: string): void;
  note(runId: string, body: string): void;
  cancel(runId: string): Promise<void>;
}

const STATUS: Record<RunStatus, NormStatus> = {
  queued: 'queued',
  running: 'running',
  held: 'held',
  rate_limited: 'rate_limited',
  review: 'in_review',
  no_changes: 'needs_human',
  done: 'done',
  failed: 'failed',
  timed_out: 'failed',
  cancelled: 'cancelled',
};

export function toEngineTask(run: LocalRun): EngineTask {
  return {
    id: run.id,
    title: run.title,
    status: STATUS[run.status],
    rawStatus: run.status,
    inputTokens: run.input_tokens,
    outputTokens: run.output_tokens,
    totalTokens: run.total_tokens,
    costUsd: run.cost_usd,
    ...(run.status === 'rate_limited' && run.resume_at ? { resumeAt: run.resume_at } : {}),
    ...(run.error ? { summary: run.error } : {}),
  };
}

/** Engine adapter for the Local AI CLI engine: every task is a run of the in-server AgentRunner. */
export class LocalCliAdapter implements EngineAdapter {
  public type = 'local' as const;

  constructor(private project: Project, private engine: LocalEngine) {}

  public async health() {
    return this.engine.health();
  }

  public async createGoal(input: CreateEngineTaskInput): Promise<EngineTask> {
    return this.create(input);
  }

  public async createTask(input: CreateEngineTaskInput): Promise<EngineTask> {
    return this.create(input);
  }

  public async getTask(id: string): Promise<EngineTask | null> {
    const run = this.engine.runs.get(id);
    return run ? toEngineTask(run) : null;
  }

  public async listTasks(ids: string[]): Promise<EngineTask[]> {
    return ids.map((id) => this.engine.runs.get(id)).filter((r): r is LocalRun => Boolean(r)).map(toEngineTask);
  }

  public async holdTask(id: string, reason: string): Promise<void> {
    this.engine.hold(id, reason);
  }

  public async releaseTask(id: string, context: string): Promise<void> {
    this.engine.release(id, context);
  }

  public async appendNote(id: string, bodyMd: string): Promise<void> {
    this.engine.note(id, bodyMd);
  }

  public async cancelTask(id: string): Promise<void> {
    await this.engine.cancel(id);
  }

  private create(input: CreateEngineTaskInput): EngineTask {
    if (!input.bridgeTaskId) throw new Error('The Local AI CLI engine needs the bridge task id');
    const run = this.engine.runs.create({
      bridgeTaskId: input.bridgeTaskId, project: this.project.name, title: input.title, bodyMd: input.bodyMd,
      model: input.model ?? null, effort: input.effort ?? null, preferredCli: input.cli ?? null,
    });
    this.engine.nudge();
    return toEngineTask(run);
  }
}
