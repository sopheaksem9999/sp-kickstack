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
      toast.success('Task marked as done');
      queryClient.invalidateQueries();
    },
  });

  const releaseMutation = useMutation({
    mutationFn: (linkId: number) => releaseLink(linkId),
    onSuccess: () => {
      toast.success('Dependency hold released');
      queryClient.invalidateQueries();
    },
  });

  if (reqLoading || graphLoading) {
    return <div className="p-12 text-center text-slate-500">Loading board...</div>;
  }

  if (!req) {
    return <div className="p-12 text-center text-rose-400">Requirement not found</div>;
  }

  const tasksByProject = new Map<string, BridgeTask[]>();
  for (const proj of req.affected_projects || []) {
    tasksByProject.set(proj, []);
  }
  for (const task of (graph?.tasks || [])) {
    const list = tasksByProject.get(task.project) || [];
    list.push(task);
    tasksByProject.set(task.project, list);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/requirements"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-blue-400 font-bold">{req.id}</span>
              <StatusBadge status={req.status} />
              <span className="text-xs text-slate-500 font-mono">rev.{req.revision}</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight mt-0.5">{req.title}</h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {req.status === 'draft' && (
            <button
              onClick={() => fanOutMutation.mutate()}
              disabled={fanOutMutation.isPending}
              className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-blue-600/20"
            >
              <Play className="w-4 h-4" /> Start Fan-Out
            </button>
          )}

          {req.status !== 'cancelled' && req.status !== 'done' && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
            >
              <XCircle className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Multi-Project Columns (One Column Per Repo) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from(tasksByProject.entries()).map(([projectName, tasks]) => (
          <div
            key={projectName}
            className="border border-slate-800 rounded-xl bg-[#0d1322]/80 flex flex-col h-full overflow-hidden"
          >
            <div className="p-3.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-slate-200 capitalize">
                  {projectName}
                </span>
                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
                  {tasks.length}
                </span>
              </div>
            </div>

            <div className="p-3 space-y-3 flex-1 overflow-y-auto min-h-[300px]">
              {tasks.length === 0 ? (
                <div className="text-center py-12 text-xs text-slate-500">
                  No tasks dispatched yet.
                </div>
              ) : (
                tasks.map((task: BridgeTask) => (
                  <div
                    key={task.id}
                    className="p-3.5 rounded-lg border border-slate-700/80 bg-slate-900/90 shadow space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {task.role}
                      </span>
                      <StatusBadge status={task.status} />
                    </div>

                    <h4 className="text-sm font-medium text-slate-100">{task.title}</h4>

                    <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/80">
                      <span className="font-mono text-[11px] text-slate-500">
                        raw: {task.engine_status_raw || 'pending'}
                      </span>
                      {task.engine_url && (
                        <a
                          href={task.engine_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-blue-400 hover:underline"
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
                        className="flex items-center gap-1 text-xs text-emerald-400 hover:underline pt-1"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" /> Pull Request
                      </a>
                    )}

                    {task.status !== 'done' && task.status !== 'cancelled' && (
                      <button
                        onClick={() => doneMutation.mutate(task.id)}
                        className="w-full mt-2 py-1 px-2 text-xs rounded bg-slate-800 hover:bg-emerald-950 hover:text-emerald-300 text-slate-300 border border-slate-700 transition flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark Done
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Cross-Repo Dependencies / Links Panel */}
      <div className="border border-slate-800 rounded-xl p-5 bg-[#0d1322]/80 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200 tracking-wide uppercase font-mono">
            Cross-Repo Dependency Links
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {graph?.links?.length || 0} active links
          </span>
        </div>

        {graph?.links?.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No cross-repo dependency links created for this requirement.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {graph?.links?.map((link: any) => {
              const waitingTask = graph.tasks.find((t: any) => t.id === link.task_id);
              const depTask = graph.tasks.find((t: any) => t.id === link.depends_on_id);

              return (
                <div key={link.id} className="py-3 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-purple-400 font-medium">
                        [{waitingTask?.project}] #{waitingTask?.id}
                      </span>
                      <span className="text-slate-500 text-xs">waits for</span>
                      <span className="font-mono text-blue-400 font-medium">
                        [{depTask?.project}] #{depTask?.id} ({depTask?.title})
                      </span>
                    </div>
                    {link.context_md && (
                      <div className="text-xs text-slate-400 font-mono bg-slate-900/80 p-2 rounded border border-slate-800 max-w-2xl whitespace-pre-wrap">
                        {link.context_md}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <StatusBadge status={link.state} />
                    {link.state === 'waiting' && (
                      <button
                        onClick={() => releaseMutation.mutate(link.id)}
                        className="px-2.5 py-1 text-xs rounded bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 flex items-center gap-1 font-medium transition"
                      >
                        <Unlock className="w-3.5 h-3.5" /> Release Hold
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
