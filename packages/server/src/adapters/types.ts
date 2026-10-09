import { EngineTask, EngineType, NormStatus } from '@sp-kickstack/shared';

export interface CreateEngineTaskInput {
  title: string;
  bodyMd: string;
  priority?: string;
  labels?: string[];
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
