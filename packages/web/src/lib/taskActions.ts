import type { BridgeTask, RequirementStatus } from '@sp-kickstack/shared';

const RETRYABLE = ['failed', 'needs_human', 'rate_limited'];

/** "Retry" is offered for stopped goals/tickets of a requirement that is still open. */
export function canRetry(task: Pick<BridgeTask, 'role' | 'status'>, reqStatus?: RequirementStatus): boolean {
  if (task.role !== 'goal' && task.role !== 'ticket') return false;
  if (reqStatus === 'cancelled' || reqStatus === 'done') return false;
  return RETRYABLE.includes(task.status);
}

/** "Mark Done" is offered until a task is finished or closed. */
export function canMarkDone(task: Pick<BridgeTask, 'status'>): boolean {
  return task.status !== 'done' && task.status !== 'cancelled';
}

const NOTE_TO = ['queued', 'running', 'needs_human', 'held', 'rate_limited'];

/** "Note" is offered for goals/tickets whose agent is still working or waiting. */
export function canSendNote(task: Pick<BridgeTask, 'role' | 'status' | 'engine_task_id'>): boolean {
  if (task.role !== 'goal' && task.role !== 'ticket') return false;
  return Boolean(task.engine_task_id) && NOTE_TO.includes(task.status);
}

/** "Rate limited · resumes 15:30" for a rate-limited task, or null. */
export function pausedLabel(task: Pick<BridgeTask, 'status'> & { paused_until?: string | null }, now = Date.now()): string | null {
  if (task.status !== 'rate_limited') return null;
  const until = task.paused_until ? Date.parse(task.paused_until) : NaN;
  if (Number.isNaN(until) || until <= now) return 'Rate limited · resumes automatically';
  return `Rate limited · resumes ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Toast for the result of a retry: the route answers with the task as it is now. */
export function retryOutcome(task: Pick<BridgeTask, 'status'> & { last_error?: string | null }): {
  kind: 'success' | 'info' | 'error';
  message: string;
} {
  if (task.status === 'failed') return { kind: 'error', message: `Retry failed: ${task.last_error || 'the engine refused the task'}` };
  if (task.status === 'rate_limited') return { kind: 'info', message: 'Retry queued: the engine is rate limited; it starts automatically' };
  return { kind: 'success', message: 'Task sent to its engine again' };
}
