import { AlertCircle, CheckCircle2, Clock, FolderGit2, GitBranch, Layers, RotateCcw, Terminal } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { QueueTask } from '@sp-kickstack/shared';
import { StatusBadge } from '../StatusBadge.js';
import { canMarkDone, canRetry, pausedLabel } from '../../lib/taskActions.js';

interface QueueTaskCardProps {
  task: QueueTask;
  /** A Retry for this task is in flight. */
  retrying: boolean;
  /** A Mark Done for this task is in flight. */
  markingDone: boolean;
  onOpenRequirement: (reqId: string) => void;
  onOpenLogs: (task: QueueTask) => void;
  onRetry: (task: QueueTask) => void;
  onMarkDone: (task: QueueTask) => void;
}

const ACTION =
  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** One agent task in the queue: what it is, where it runs, its state, and the actions that make sense now. */
export function QueueTaskCard({ task, retrying, markingDone, onOpenRequirement, onOpenLogs, onRetry, onMarkDone }: QueueTaskCardProps) {
  const updated = Date.parse(task.updated_at);
  const resumes = pausedLabel(task);
  const who = `${task.project} task ${task.id}`;
  const urgent = task.req_priority === 'urgent' || task.req_priority === 'high';

  return (
    <li className="bg-white dark:bg-[#202020] border border-slate-200 dark:border-[#2d2d2d] rounded-xl p-4 shadow-sm hover:border-slate-300 dark:hover:border-[#383838] transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-1.5 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenRequirement(task.req_id)}
            aria-label={`Open requirement ${task.req_id}`}
            title={task.req_title ? `Open ${task.req_id}: ${task.req_title}` : `Open ${task.req_id}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors cursor-pointer"
          >
            <Layers className="w-3 h-3" />
            <span>{task.req_id}</span>
          </button>
          {urgent && (
            <span
              title={`Requirement priority: ${task.req_priority}`}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                task.req_priority === 'urgent'
                  ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
                  : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
              }`}
            >
              {task.req_priority}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-[#2a2a2a] text-slate-700 dark:text-slate-300">
            <FolderGit2 className="w-3 h-3 text-slate-400" />
            {task.project}
          </span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#252525] text-slate-500 dark:text-slate-400">
            {task.role}
          </span>
          {task.branch && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 min-w-0">
              <GitBranch className="w-3 h-3 shrink-0 text-purple-400" />
              <span className="truncate">{task.branch}</span>
            </span>
          )}
          <StatusBadge status={task.status} />
        </div>

        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 break-words">{task.title}</h3>

        {task.req_title && !task.title.includes(task.req_title) && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words">Requirement: {task.req_title}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          {task.engine_task_id && <span className="font-mono text-[10px]">Engine ID: {task.engine_task_id}</span>}
          {!Number.isNaN(updated) && (
            <span className="inline-flex items-center gap-1" title={new Date(updated).toLocaleString()}>
              <Clock className="w-3 h-3" />
              Updated {formatDistanceToNow(updated, { addSuffix: true })}
            </span>
          )}
          {(task.attempts ?? 0) > 1 && <span className="font-semibold text-amber-600 dark:text-amber-400">Attempt {task.attempts}</span>}
          {resumes && <span className="font-semibold text-yellow-700 dark:text-yellow-300">{resumes}</span>}
        </div>

        {task.last_error && task.status !== 'rate_limited' && (
          <p className="flex items-start gap-1 text-[11px] text-rose-600 dark:text-rose-400 break-words line-clamp-2" title={task.last_error}>
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{task.last_error}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-[#2a2a2a]">
        <button
          type="button"
          onClick={() => onOpenLogs(task)}
          aria-label={`Logs, ${who}`}
          title="View the agent's terminal output and events"
          className={`${ACTION} border border-slate-200 dark:border-[#333333] hover:bg-slate-100 dark:hover:bg-[#2a2a2a] text-slate-700 dark:text-slate-300`}
        >
          <Terminal className="w-3.5 h-3.5 text-slate-500" />
          <span>Logs</span>
        </button>

        {canRetry(task, task.req_status ?? undefined) && (
          <button
            type="button"
            onClick={() => onRetry(task)}
            disabled={retrying}
            aria-label={`Retry, ${who}`}
            title="Send this task to its engine again on the same branch (the old engine task is cancelled)"
            className={`${ACTION} bg-amber-100 dark:bg-amber-950/50 hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{retrying ? 'Retrying...' : 'Retry'}</span>
          </button>
        )}

        {canMarkDone(task) && (
          <button
            type="button"
            onClick={() => onMarkDone(task)}
            disabled={markingDone}
            aria-label={`Mark Done, ${who}`}
            title="Mark this task done here and release the work waiting on it (the engine and its agent are not told)"
            className={`${ACTION} bg-slate-100 dark:bg-[#282828] hover:bg-slate-200 dark:hover:bg-[#323232] text-slate-700 dark:text-slate-300`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>{markingDone ? 'Saving...' : 'Mark Done'}</span>
          </button>
        )}
      </div>
    </li>
  );
}
