// The unmerged branched work of a requirement, per repository, in the order the merge gate merges it.
import type { BridgeTask } from '@sp-kickstack/shared';
import type { AppDatabase } from '../db/index.js';

/** Unmerged branched goal/ticket tasks per project, dependencies before dependents. */
export function unmergedWorkByProject(db: AppDatabase, reqId: string): Map<string, BridgeTask[]> {
  const tasks = db
    .prepare(`
      SELECT * FROM bridge_tasks
      WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'
        AND branch IS NOT NULL AND merged_at IS NULL
      ORDER BY id
    `)
    .all(reqId) as BridgeTask[];
  const ids = new Set(tasks.map((t) => t.id));
  const links = db.prepare('SELECT task_id, depends_on_id FROM links').all() as Array<{ task_id: number; depends_on_id: number }>;
  const dependsOn = new Map<number, number[]>();
  for (const l of links) {
    if (ids.has(l.task_id) && ids.has(l.depends_on_id)) {
      dependsOn.set(l.task_id, [...(dependsOn.get(l.task_id) ?? []), l.depends_on_id]);
    }
  }

  const ordered: BridgeTask[] = [];
  const placed = new Set<number>();
  while (ordered.length < tasks.length) {
    const next =
      tasks.find((t) => !placed.has(t.id) && (dependsOn.get(t.id) ?? []).every((d) => placed.has(d))) ??
      tasks.find((t) => !placed.has(t.id))!; // cycle guard: fall back to id order
    ordered.push(next);
    placed.add(next.id);
  }

  const groups = new Map<string, BridgeTask[]>();
  for (const t of ordered) groups.set(t.project, [...(groups.get(t.project) ?? []), t]);
  return groups;
}
