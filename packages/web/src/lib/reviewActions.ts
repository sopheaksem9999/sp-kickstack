import type { BridgeTask, Requirement, RequestChangesResult, ReviewComment, TaskChangedFile, TaskChanges } from '@sp-kickstack/shared';

const REVIEW_STATUSES = ['in_review', 'qa'];

/** Goals and tickets a reviewer can comment on. */
export function reviewableTasks(tasks: BridgeTask[]): BridgeTask[] {
  return tasks.filter((t) => (t.role === 'goal' || t.role === 'ticket') && t.status !== 'cancelled');
}

/**
 * One repository task card's review comments: its own, shown while the requirement is in review or
 * QA (or once it has any); new ones can be added only in review or QA.
 */
export function taskReviewView(
  req: Pick<Requirement, 'status'>,
  task: BridgeTask,
  comments: ReviewComment[]
): { show: boolean; canAdd: boolean; comments: ReviewComment[] } {
  if (reviewableTasks([task]).length === 0) return { show: false, canAdd: false, comments: [] };
  const own = comments.filter((c) => c.task_id === task.id);
  const canAdd = REVIEW_STATUSES.includes(req.status);
  return { show: canAdd || own.length > 0, canAdd, comments: own };
}

/** "9 files · +120 −30" ("300+ files" when the list was cut). */
export function changeSummary(changes: TaskChanges): string {
  const count = changes.files.length;
  const files = changes.truncated ? `${count}+ files` : `${count} ${count === 1 ? 'file' : 'files'}`;
  return `${files} · +${changes.additions} −${changes.deletions}`;
}

const STATUS_LABEL: Record<TaskChangedFile['status'], string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };

export function changeStatusLabel(status: TaskChangedFile['status']): string {
  return STATUS_LABEL[status];
}

/** Git Review: the requirement's goals and tickets that have a branch, by repository. */
export function gitReviewTasks(tasks: BridgeTask[]): BridgeTask[] {
  return reviewableTasks(tasks)
    .filter((t) => t.branch)
    .sort((a, b) => a.project.localeCompare(b.project) || a.id - b.id);
}

/** Git Review headline: what merging brings, what was merged, or both. */
export function gitReviewHeadline(reqId: string, entries: Array<{ merged: boolean; base: string | null }>): string {
  if (entries.length === 0) return `${reqId}: no branches to review`;
  const bases = [...new Set(entries.map((e) => e.base).filter((b): b is string => Boolean(b)))].join(', ') || 'the base branch';
  if (entries.every((e) => e.merged)) return `What ${reqId} merged into ${bases}`;
  if (entries.every((e) => !e.merged)) return `What merging ${reqId} brings into ${bases}`;
  return `${reqId}: some branches merged into ${bases}, some still to merge`;
}

/** "Comment on this file": `#path ` added to the comment, on its own word. */
export function appendMention(body: string, path: string): string {
  const separator = !body || /\s$/.test(body) ? '' : ' ';
  return `${body}${separator}#${path} `;
}

/** "900 B", "2 KB", "3.5 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** "src/a.ts:4", "src/a.ts" or "General". */
export function commentLocation(c: Pick<ReviewComment, 'file_path' | 'line'>): string {
  if (!c.file_path) return 'General';
  return c.line ? `${c.file_path}:${c.line}` : c.file_path;
}

/** Whether "Request changes" can run now; when not, why. */
export function requestChangesState(
  req: Pick<Requirement, 'status' | 'merge_state'>,
  comments: Array<Pick<ReviewComment, 'task_id' | 'state'>>
): { ok: boolean; reason?: string; open: number; tasks: number } {
  const open = comments.filter((c) => c.state === 'open');
  const tasks = new Set(open.map((c) => c.task_id)).size;
  if (!REVIEW_STATUSES.includes(req.status)) return { ok: false, reason: 'Available once the requirement is in review or QA', open: open.length, tasks };
  if (req.merge_state === 'running') return { ok: false, reason: 'A merge is running; wait for it to finish', open: open.length, tasks };
  if (open.length === 0) return { ok: false, reason: 'Add a comment first', open: 0, tasks: 0 };
  return { ok: true, open: open.length, tasks };
}

/** One toast for a Request changes result. */
export function requestChangesOutcome(result: RequestChangesResult): { kind: 'success' | 'warning'; message: string } {
  const sent = result.results.filter((r) => r.ok).length;
  const failed = result.results.filter((r) => !r.ok);
  if (failed.length === 0) {
    return { kind: 'success', message: `Round ${result.round} sent: ${sent} ${sent === 1 ? 'task' : 'tasks'} started a new run` };
  }
  const reasons = failed
    .map((r) => `Task #${r.taskId}: ${r.error}`)
    .join('; ')
    .replace(/[.\s]+$/, '');
  const retry = `${failed.length === 1 ? 'Its comments stay' : 'Their comments stay'} open; press Request changes again to retry.`;
  return { kind: 'warning', message: `Round ${result.round} sent to ${sent} of ${result.results.length} tasks. ${reasons}. ${retry}` };
}
