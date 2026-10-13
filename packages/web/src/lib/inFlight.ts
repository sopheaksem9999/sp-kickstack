/** Which task actions are running right now, so each card tracks its own and one task never frees another. */

export type TaskAction = 'retry' | 'markDone';

export const flightKey = (action: TaskAction, taskId: number): string => `${action}:${taskId}`;

/** A copy of `set` with `key` added or removed. */
export function setInFlight(set: ReadonlySet<string>, key: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}
