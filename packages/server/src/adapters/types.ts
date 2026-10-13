import { EngineTask, EngineType, NormStatus, ReasoningEffort } from '@sp-kickstack/shared';

export interface CreateEngineTaskInput {
  title: string;
  bodyMd: string;
  priority?: string;
  labels?: string[];
  /** Agent model id for this task; omitted when none is set so engines without support see no change. */
  model?: string;
  /** Agent reasoning effort for this task; omitted when none is set. */
  effort?: ReasoningEffort;
  /** The bridge task this belongs to (the Local AI CLI engine needs it; HTTP engines never receive it). */
  bridgeTaskId?: number;
}

export interface EngineAdapter {
  type: EngineType;
  health(): Promise<{ ok: boolean; version?: string; error?: string }>;
  createGoal(input: CreateEngineTaskInput): Promise<EngineTask>;
  createTask(input: CreateEngineTaskInput): Promise<EngineTask>;
  getTask(id: string): Promise<EngineTask | null>;
  listTasks(ids: string[]): Promise<EngineTask[]>;
  holdTask(id: string, reason: string): Promise<void>;
  releaseTask(id: string, context: string): Promise<void>;
  appendNote(id: string, bodyMd: string): Promise<void>;
  cancelTask(id: string): Promise<void>;
  subscribe?(onChange: (t: EngineTask) => void): () => void;
}
