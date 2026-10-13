import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ListTodo,
  ExternalLink,
  ChevronRight,
  FolderGit2,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { fetchTasks } from '../lib/api.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { tabCounts, sortQueue } from '../lib/queueTasks.js';
import { StatusBadge } from './StatusBadge.js';
import { formatDistanceToNow } from 'date-fns';

export function QueueQuickViewPopover() {
  const navigate = useNavigate();
  const { activeWorkspaceId, wsPath } = useWorkspace();
  const [open, setOpen] = useState(false);

  // Poll tasks every 10 seconds
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['queue-tasks', activeWorkspaceId],
    queryFn: () => fetchTasks({ workspace: activeWorkspaceId, role: 'goal,ticket' }),
    refetchInterval: 10_000,
  });

  const counts = useMemo(
    () => tabCounts(tasks, { project: null, search: '' }),
    [tasks]
  );

  const activeOrRecentTasks = useMemo(() => {
    // Show in-progress, queued, or recently failed tasks first
    const running = tasks.filter((t) => t.status === 'running');
    const failed = tasks.filter((t) => ['failed', 'needs_human', 'rate_limited'].includes(t.status));
    const queued = tasks.filter((t) => ['queued', 'pending'].includes(t.status));
    const done = tasks.filter((t) => t.status === 'done');

    const prioritized = [...running, ...failed, ...queued, ...done];
    return sortQueue(prioritized).slice(0, 5);
  }, [tasks]);

  const runningCount = counts.running || 0;
  const failedCount = counts.failed || 0;
  const queuedCount = counts.queued || 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1f2028] hover:bg-slate-50 dark:hover:bg-[#282a36] text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-2xs transition-all cursor-pointer"
          title="Agent Tasks Queue Quick View"
        >
          <ListTodo className="w-3.5 h-3.5 text-[#7b68ee] shrink-0" />
          <span className="hidden sm:inline">Queue</span>

          {runningCount > 0 ? (
            <span className="flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
              {runningCount}
            </span>
          ) : failedCount > 0 ? (
            <span className="flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              {failedCount}
            </span>
          ) : tasks.length > 0 ? (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {tasks.length}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-84 sm:w-96 p-0 rounded-2xl bg-white dark:bg-[#1a1b24] border border-slate-200 dark:border-[#272936] text-slate-800 dark:text-slate-200 shadow-2xl overflow-hidden z-50"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-[#262835] bg-slate-50/70 dark:bg-[#15161e] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] flex items-center justify-center font-bold">
              <ListTodo className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                Live Agent Queue
              </h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {tasks.length} total tasks across repositories
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate(wsPath('/queue'));
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors cursor-pointer"
          >
            <span>Full Queue</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {/* Status Metrics Strip */}
        <div className="grid grid-cols-4 divide-x divide-slate-100 dark:divide-[#262835] border-b border-slate-100 dark:border-[#262835] bg-white dark:bg-[#1a1b24] text-center text-xs">
          <div
            onClick={() => {
              setOpen(false);
              navigate(wsPath('/queue?tab=running'));
            }}
            className="p-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#20222e] transition-colors"
            title="Filter by In Progress"
          >
            <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Running</div>
            <div className="text-xs font-bold text-purple-600 dark:text-purple-400 mt-0.5">
              {runningCount}
            </div>
          </div>
          <div
            onClick={() => {
              setOpen(false);
              navigate(wsPath('/queue?tab=queued'));
            }}
            className="p-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#20222e] transition-colors"
            title="Filter by Queued"
          >
            <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Queued</div>
            <div className="text-xs font-bold text-cyan-600 dark:text-cyan-400 mt-0.5">
              {queuedCount}
            </div>
          </div>
          <div
            onClick={() => {
              setOpen(false);
              navigate(wsPath('/queue?tab=failed'));
            }}
            className="p-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#20222e] transition-colors"
            title="Filter by Failed / Needs Human"
          >
            <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Failed</div>
            <div className={`text-xs font-bold mt-0.5 ${failedCount > 0 ? 'text-rose-500' : 'text-slate-600 dark:text-slate-400'}`}>
              {failedCount}
            </div>
          </div>
          <div
            onClick={() => {
              setOpen(false);
              navigate(wsPath('/queue?tab=done'));
            }}
            className="p-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#20222e] transition-colors"
            title="Filter by Done"
          >
            <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Done</div>
            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {counts.done || 0}
            </div>
          </div>
        </div>

        {/* Task List Feed */}
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-[#262835]">
          {isLoading ? (
            <div className="p-6 text-center text-xs text-slate-400">Loading queue...</div>
          ) : activeOrRecentTasks.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No tasks currently in the queue.
            </div>
          ) : (
            activeOrRecentTasks.map((task) => (
              <div
                key={task.id}
                onClick={() => {
                  setOpen(false);
                  navigate(wsPath(`/queue?tab=all&search=${task.id}`));
                }}
                className="p-3 hover:bg-slate-50/80 dark:hover:bg-[#20222e] transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-[#272937] text-slate-700 dark:text-slate-300 shrink-0">
                      #{task.id}
                    </span>
                    <span className="font-semibold text-xs text-slate-900 dark:text-white truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                      {task.title}
                    </span>
                  </div>
                  <div className="shrink-0 scale-90 origin-right">
                    <StatusBadge status={task.status} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-1">
                  <div className="flex items-center gap-2 truncate">
                    <span className="flex items-center gap-1 truncate text-slate-600 dark:text-slate-400">
                      <FolderGit2 className="w-3 h-3 text-slate-400" />
                      {task.project}
                    </span>
                    {task.req_id && (
                      <span className="text-purple-600 dark:text-purple-400 truncate">
                        • {task.req_id}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-sans">
                    {formatDistanceToNow(new Date(task.updated_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Popover Footer */}
        <div className="p-2.5 bg-slate-50/80 dark:bg-[#15161e] border-t border-slate-100 dark:border-[#262835] flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            Auto-refreshes every 10s
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate(wsPath('/queue'));
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <span>Open Agent Queue</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
