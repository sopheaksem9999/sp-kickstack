import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRequirement,
  fetchRequirementGraph,
  startRequirementFanOut,
  cancelRequirement,
  markTaskDone,
  releaseLink,
} from '../lib/api.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { BridgeTask } from '@sp-kickstack/shared';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Play,
  XCircle,
  ExternalLink,
  GitPullRequest,
  CheckCircle2,
  Unlock,
  BookOpen,
  GitFork,
} from 'lucide-react';

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: req, isLoading: reqLoading } = useQuery({
    queryKey: ['requirement', id],
    queryFn: () => fetchRequirement(id!),
    enabled: Boolean(id),
  });

  const { data: graph, isLoading: graphLoading } = useQuery({
    queryKey: ['requirement-graph', id],
    queryFn: () => fetchRequirementGraph(id!),
    enabled: Boolean(id),
    refetchInterval: 3000,
  });

  const fanOutMutation = useMutation({
    mutationFn: () => startRequirementFanOut(id!),
    onSuccess: () => {
      toast.success('Fan-out dispatched to affected engines');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Fan-out failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRequirement(id!),
    onSuccess: () => {
      toast.info('Requirement cancelled');
      queryClient.invalidateQueries();
    },
  });

  const doneMutation = useMutation({
    mutationFn: (taskId: number) => markTaskDone(taskId),
    onSuccess: () => {
      toast.success('Task marked done');
      queryClient.invalidateQueries();
    },
  });

  const releaseMutation = useMutation({
    mutationFn: (linkId: number) => releaseLink(linkId),
    onSuccess: () => {
      toast.success('Link released and task unblocked');
      queryClient.invalidateQueries();
    },
  });

  if (reqLoading || graphLoading) {
    return <div className="p-16 text-center text-slate-400 text-sm">Loading requirement board...</div>;
  }

  if (!req) {
    return <div className="p-16 text-center text-rose-500 font-bold">Requirement not found</div>;
  }

  const tasksByProject = new Map<string, BridgeTask[]>();
  for (const proj of req.affected_projects || []) {
    tasksByProject.set(proj, []);
  }
  for (const task of graph?.tasks || []) {
    const list = tasksByProject.get(task.project) || [];
    list.push(task);
    tasksByProject.set(task.project, list);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ClickUp Header & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div className="flex items-start gap-3">
          <Link
            to="/requirements"
            className="p-2 mt-1 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#20212c] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-[#7b68ee] font-black">{req.id}</span>
              <span className="text-[11px] text-purple-700 dark:text-purple-300 font-mono bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/40 px-2 py-0.5 rounded font-semibold">
                📁 {req.workspace_id || 'default'}
              </span>
              <StatusBadge status={req.status} />
              <span className="text-xs text-slate-400 font-mono">rev.{req.revision}</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
              {req.title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {req.status === 'draft' && (
            <button
              onClick={() => fanOutMutation.mutate()}
              disabled={fanOutMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Fan-Out</span>
            </button>
          )}

          {req.status !== 'cancelled' && req.status !== 'done' && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-[#20212c] hover:bg-slate-200 dark:hover:bg-[#2a2b38] text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold border border-slate-200 dark:border-[#2e303d] transition-colors"
            >
              <XCircle className="w-3.5 h-3.5 text-rose-500" />
              <span>Cancel</span>
            </button>
          )}
        </div>
      </div>

      {/* ClickUp Doc Spec Preview Card */}
      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
          <BookOpen className="w-4 h-4" />
          <span>Requirement Document & Spec</span>
        </div>
        <div className="bg-slate-50 dark:bg-[#14151b] p-4 rounded-xl border border-slate-200 dark:border-[#22232e] text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
          {req.body_md}
        </div>
      </div>

      {/* Multi-Project Columns (ClickUp Task Board Per Repo) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Per-Repo Agent Engine Runtimes
          </h3>
          <span className="text-xs font-mono text-slate-400">
            {req.affected_projects.length} connected repos
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from(tasksByProject.entries()).map(([projectName, tasks]) => (
            <div
              key={projectName}
              className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl flex flex-col shadow-sm overflow-hidden"
            >
              <div className="p-3.5 border-b border-slate-200 dark:border-[#262732] bg-slate-50/70 dark:bg-[#1c1d27] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300 flex items-center justify-center font-bold text-xs">
                    📁
                  </div>
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white capitalize">
                    {projectName}
                  </span>
                </div>
                <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full font-mono font-bold">
                  {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>

              <div className="p-3 space-y-3 flex-1 overflow-y-auto min-h-[220px]">
                {tasks.length === 0 ? (
                  <div className="text-center py-12 text-xs text-slate-400 italic">
                    Awaiting fan-out dispatch...
                  </div>
                ) : (
                  tasks.map((task: BridgeTask) => (
                    <div
                      key={task.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-[#2e303d] bg-slate-50 dark:bg-[#1f202b] shadow-sm space-y-2.5 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {task.role}
                        </span>
                        <StatusBadge status={task.status} size="xs" />
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {task.title}
                      </h4>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-200 dark:border-[#2a2b38]">
                        <span className="font-mono text-[10px] text-slate-400">
                          engine: {task.engine_status_raw || 'pending'}
                        </span>
                        {task.engine_url && (
                          <a
                            href={task.engine_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-[#7b68ee] hover:underline font-semibold"
                          >
                            Engine <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      {task.pr_url && (
                        <a
                          href={task.pr_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:underline pt-0.5"
                        >
                          <GitPullRequest className="w-3.5 h-3.5" />
                          <span>Pull Request</span>
                        </a>
                      )}

                      {task.status !== 'done' && task.status !== 'cancelled' && (
                        <button
                          onClick={() => doneMutation.mutate(task.id)}
                          className="w-full mt-2 py-1.5 px-2 text-xs font-bold rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 text-slate-700 dark:text-slate-300 transition-all flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Mark Complete</span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cross-Repo Dependencies / Links Panel */}
      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitFork className="w-4 h-4 text-[#7b68ee]" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              Cross-Repo Dependency Links (xticket)
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {graph?.links?.length || 0} links active
          </span>
        </div>

        {graph?.links?.length === 0 ? (
          <p className="text-xs text-slate-400 py-3 italic">
            No cross-repo dependency tickets filed for this requirement yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-[#262732]">
            {graph?.links?.map((link: any) => {
              const waitingTask = graph.tasks.find((t: any) => t.id === link.task_id);
              const depTask = graph.tasks.find((t: any) => t.id === link.depends_on_id);

              return (
                <div key={link.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-[#7b68ee] font-bold">
                        [{waitingTask?.project}] #{waitingTask?.id}
                      </span>
                      <span className="text-slate-400 text-[11px] font-medium">waits on</span>
                      <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">
                        [{depTask?.project}] #{depTask?.id} ({depTask?.title})
                      </span>
                    </div>
                    {link.context_md && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono bg-slate-50 dark:bg-[#14151b] p-2.5 rounded-lg border border-slate-200 dark:border-[#262732] max-w-2xl whitespace-pre-wrap">
                        {link.context_md}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <StatusBadge status={link.state} size="xs" />
                    {link.state === 'waiting' && (
                      <button
                        onClick={() => releaseMutation.mutate(link.id)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 flex items-center gap-1.5 transition-all shadow-sm"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Release Hold</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
