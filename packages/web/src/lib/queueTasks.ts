import type { NormStatus, QueueTask } from '@sp-kickstack/shared';

export type QueueTab = 'all' | 'queued' | 'running' | 'failed' | 'done';
export const VALID_QUEUE_TABS: QueueTab[] = ['all', 'queued', 'running', 'failed', 'done'];

export const QUEUE_TABS: { id: QueueTab; label: string }[] = [
  { id: 'all', label: 'All Tasks' },
  { id: 'queued', label: 'Queued' },
  { id: 'running', label: 'In Progress' },
  { id: 'failed', label: 'Failed / Needs Human' },
  { id: 'done', label: 'Completed' },
];

/** The tab id from ?tab=; a missing or unknown value means "all". */
export function resolveQueueTab(param: string | null): QueueTab {
  return param && VALID_QUEUE_TABS.includes(param as QueueTab) ? (param as QueueTab) : 'all';
}

// Statuses outside these lists (held, in_review, qa, cancelled) show on "All Tasks" only.
const TAB_STATUSES: Record<Exclude<QueueTab, 'all'>, NormStatus[]> = {
  queued: ['pending', 'queued'],
  running: ['running'],
  failed: ['failed', 'needs_human', 'rate_limited'],
  done: ['done'],
};

export function matchesTab(task: Pick<QueueTask, 'status'>, tab: QueueTab): boolean {
  return tab === 'all' || TAB_STATUSES[tab].includes(task.status);
}

export interface QueueFilter {
  tab: QueueTab;
  /** A repository (project) name, or null for every repository. */
  project: string | null;
  /** Free text; matched against title, requirement, repository, branch and engine id. */
  search: string;
}

type Scope = Pick<QueueFilter, 'project' | 'search'>;

function inScope(task: QueueTask, { project, search }: Scope): boolean {
  if (project && task.project !== project) return false;
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [task.title, task.req_id, task.req_title, task.project, task.branch, task.engine_task_id].some(
    (field) => field != null && field.toLowerCase().includes(needle)
  );
}

export function filterQueue(tasks: QueueTask[], filter: QueueFilter): QueueTask[] {
  return tasks.filter((task) => matchesTab(task, filter.tab) && inScope(task, filter));
}

/** How many tasks each tab shows under the repository and search filters (the number matches the list). */
export function tabCounts(tasks: QueueTask[], scope: Scope): Record<QueueTab, number> {
  const counts: Record<QueueTab, number> = { all: 0, queued: 0, running: 0, failed: 0, done: 0 };
  for (const task of tasks) {
    if (!inScope(task, scope)) continue;
    for (const tab of VALID_QUEUE_TABS) {
      if (matchesTab(task, tab)) counts[tab] += 1;
    }
  }
  return counts;
}

/** Most recently updated first; the newer id first when two were updated at the same time. */
export function sortQueue(tasks: QueueTask[]): QueueTask[] {
  return [...tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
}
