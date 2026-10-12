import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import { ListTodo, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { QueueTask } from '@sp-kickstack/shared';
import { fetchProjects, fetchTasks, markTaskDone, retryTask } from '../lib/api.js';
import { retryOutcome } from '../lib/taskActions.js';
import { QUEUE_TABS, filterQueue, resolveQueueTab, sortQueue, tabCounts } from '../lib/queueTasks.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { LiveTaskLogsDrawer } from '../components/LiveTaskLogsDrawer.js';
import { RequirementDetailSheet } from '../components/RequirementDetailSheet.js';
import { QueueFilterBar } from '../components/queue/QueueFilterBar.js';
import { QueueTaskCard } from '../components/queue/QueueTaskCard.js';

export { VALID_QUEUE_TABS } from '../lib/queueTasks.js';
export type { QueueTab } from '../lib/queueTasks.js';

/** Bridge events refresh the queue at once; this is the fallback when the event stream is down. */
const REFRESH_MS = 10_000;

export function QueuePage() {
  const queryClient = useQueryClient();
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  // The URL is the only source of the active tab, so back, forward, reload and deep links all work.
  const tab = resolveQueueTab(searchParams.get('tab'));
  const changeTab = (next: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('tab', resolveQueueTab(next));
        return params;
      },
      { replace: false }
    );

  const [search, setSearch] = useState('');
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  const [logTask, setLogTask] = useState<QueueTask | null>(null);
  const [openReqId, setOpenReqId] = useState<string | null>(null);

  // Questions and "waiting" placeholders are not agent tasks (questions have their own panel).
  const tasksQuery = useQuery({
    queryKey: ['queue-tasks', activeWorkspaceId],
    queryFn: () => fetchTasks({ workspace: activeWorkspaceId, role: 'goal,ticket' }),
    refetchInterval: REFRESH_MS,
  });
  const { data: projectList = [] } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
  });

  const projectNames = useMemo(() => projectList.map((p) => p.name), [projectList]);
  // A repository chosen in another workspace is not in this list: show all repositories again.
  const project = chosenProject && projectNames.includes(chosenProject) ? chosenProject : null;

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const counts = useMemo(() => tabCounts(tasks, { project, search }), [tasks, project, search]);
  const visible = useMemo(() => sortQueue(filterQueue(tasks, { tab, project, search })), [tasks, tab, project, search]);

  const refreshAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: ['queue-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['requirements'] });
    queryClient.invalidateQueries({ queryKey: ['requirement'] });
    queryClient.invalidateQueries({ queryKey: ['requirement-graph'] });
  };

  const retry = useMutation({
    mutationFn: (task: QueueTask) => retryTask(task.id),
    onSuccess: (retried) => {
      const outcome = retryOutcome(retried);
      toast[outcome.kind](outcome.message);
      refreshAfterChange();
    },
    onError: (err: Error) => toast.error(`Could not retry the task: ${err.message}. Refresh the queue to see its current state.`),
  });

  const markDone = useMutation({
    mutationFn: (task: QueueTask) => markTaskDone(task.id),
    onSuccess: () => {
      toast.success('Task marked as done');
      refreshAfterChange();
    },
    onError: (err: Error) => toast.error(`Could not mark the task done: ${err.message}. Refresh the queue to see its current state.`),
  });

  const filtered = Boolean(search.trim()) || project !== null;
  const list = (
    <ul className="space-y-3" aria-label="Agent tasks">
      {visible.map((task) => (
        <QueueTaskCard
          key={task.id}
          task={task}
          retrying={retry.isPending && retry.variables?.id === task.id}
          markingDone={markDone.isPending && markDone.variables?.id === task.id}
          onOpenRequirement={setOpenReqId}
          onOpenLogs={setLogTask}
          onRetry={(t) => retry.mutate(t)}
          onMarkDone={(t) => markDone.mutate(t)}
        />
      ))}
    </ul>
  );

  let body = list;
  if (tasksQuery.isLoading) {
    body = (
      <p className="flex items-center justify-center gap-2 py-16 text-xs text-slate-400" role="status">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading the queue...
      </p>
    );
  } else if (tasksQuery.isError && tasks.length === 0) {
    body = (
      <div className="text-center py-14 px-6 rounded-xl border border-dashed border-rose-300 dark:border-rose-900/60 bg-white dark:bg-[#202020]" role="alert">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">The queue could not be loaded</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {(tasksQuery.error as Error).message}. Check that the bridge is running, then press Refresh.
        </p>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="text-center py-14 px-6 rounded-xl border border-dashed border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020]">
        <ListTodo className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {tasks.length === 0 ? 'No agent tasks in this workspace yet' : 'No tasks match this view'}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {tasks.length === 0
            ? 'Tasks appear here after you press Start Fan-Out on a requirement.'
            : filtered
            ? 'Clear the search or choose All repositories to see more.'
            : 'Choose another tab to see the rest.'}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
            <ListTodo className="w-3.5 h-3.5" />
            <span>Live</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Agent Queue</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Goals and tickets the agents of {activeWorkspace?.name ?? activeWorkspaceId} are working on, per repository
          </p>
        </div>
        <button
          type="button"
          onClick={() => tasksQuery.refetch()}
          disabled={tasksQuery.isFetching}
          aria-label="Refresh the queue"
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#262626] hover:bg-slate-100 dark:hover:bg-[#2e2e2e] text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${tasksQuery.isFetching ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {tasksQuery.isError && tasks.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
          Could not refresh the queue ({(tasksQuery.error as Error).message}). Showing the last result; it tries again on its own.
        </p>
      )}

      {/* Manual activation: a click would otherwise change the tab twice (mouse down, then focus) and push two history entries. */}
      <Tabs.Root value={tab} onValueChange={changeTab} activationMode="manual" className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <Tabs.List
            aria-label="Queue view"
            className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100/80 dark:bg-[#1e1e1e] rounded-xl border border-slate-200 dark:border-[#2d2d2d] w-fit max-w-full shadow-inner"
          >
            {QUEUE_TABS.map(({ id, label }) => (
              <Tabs.Trigger
                key={id}
                value={id}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#7b68ee]/50 data-[state=active]:bg-white dark:data-[state=active]:bg-[#282828] data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 data-[state=active]:shadow-sm"
              >
                <span>{label}</span>
                <span className="px-1.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold">
                  {counts[id]}
                </span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <QueueFilterBar
            search={search}
            onSearchChange={setSearch}
            projects={projectNames}
            project={project}
            onProjectChange={setChosenProject}
          />
        </div>

        {QUEUE_TABS.map(({ id }) => (
          <Tabs.Content key={id} value={id} className="outline-none">
            {body}
          </Tabs.Content>
        ))}
      </Tabs.Root>

      <LiveTaskLogsDrawer task={logTask} isOpen={Boolean(logTask)} onClose={() => setLogTask(null)} />
      <RequirementDetailSheet requirementId={openReqId} isOpen={Boolean(openReqId)} onClose={() => setOpenReqId(null)} />
    </div>
  );
}
