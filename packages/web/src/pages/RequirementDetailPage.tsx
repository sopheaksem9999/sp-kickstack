import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRequirement,
  fetchRequirementGraph,
  fetchProjects,
  fetchSprints,
  assignRequirementSprint,
  startRequirementFanOut,
  cancelRequirement,
  markTaskDone,
  releaseLink,
  updateRequirementStatus,
  updateRequirementProjects,
  updateRequirementMergePolicy,
  mergeRequirementToMain,
} from '../lib/api.js';
import { isMergeReady as computeMergeReady, mergeCopy } from '../lib/mergeReady.js';
import { useDemoMode } from '../lib/useDemoMode.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { DependencyGraphCanvas } from '../components/DependencyGraphCanvas.js';
import { BridgeTask, RequirementStatus, BranchMergePolicy } from '@sp-kickstack/shared';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Play,
  XCircle,
  ExternalLink,
  CheckCircle2,
  Unlock,
  BookOpen,
  GitFork,
  GitBranch,
  GitMerge,
  Paperclip,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  FileText,
  Edit3,
  X,
  Terminal,
  Code2,
} from 'lucide-react';
import { LiveTaskLogsDrawer } from '../components/LiveTaskLogsDrawer.js';
import { ProjectGitReviewModal } from '../components/ProjectGitReviewModal.js';

const stateOptions: { value: RequirementStatus; label: string }[] = [
  { value: 'draft', label: 'ToDo' },
  { value: 'in_progress', label: 'In-Progress' },
  { value: 'qa', label: 'QA / Review' },
  { value: 'done', label: 'Done' },
];

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const mergeText = mergeCopy(demoMode);

  // Embedded VS Code Review Modal state
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedReviewProject, setSelectedReviewProject] = useState<string | undefined>(undefined);

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

  const statusMutation = useMutation({
    mutationFn: (newStatus: RequirementStatus) => updateRequirementStatus(id!, newStatus),
    onSuccess: () => {
      toast.success('Requirement state updated');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update status'),
  });

  const doneMutation = useMutation({
    mutationFn: (taskId: number) => markTaskDone(taskId),
    onSuccess: () => {
      toast.success('Task marked as done');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update task'),
  });

  const releaseMutation = useMutation({
    mutationFn: (linkId: number) => releaseLink(linkId),
    onSuccess: () => {
      toast.success('Dependency link released');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to release link'),
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergeRequirementToMain(id!),
    onSuccess: () => {
      toast.success(mergeText.success);
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to merge to main'),
  });

  const [isEditingProjects, setIsEditingProjects] = useState(false);
  const [editingProjectsList, setEditingProjectsList] = useState<string[]>([]);
  const [viewTab, setViewTab] = useState<'board' | 'dag'>('board');
  const [logTask, setLogTask] = useState<BridgeTask | null>(null);

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects', req?.workspace_id || 'default'],
    queryFn: () => fetchProjects(req?.workspace_id || 'default'),
    enabled: Boolean(req),
  });

  const projectsMutation = useMutation({
    mutationFn: (newProjects: string[]) => updateRequirementProjects(id!, newProjects),
    onSuccess: () => {
      toast.success('Affected projects updated');
      setIsEditingProjects(false);
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update projects'),
  });

  const policyMutation = useMutation({
    mutationFn: (newPolicy: BranchMergePolicy | null) => updateRequirementMergePolicy(id!, newPolicy),
    onSuccess: () => {
      toast.success('Merge policy updated');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update merge policy'),
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', req?.workspace_id || 'default'],
    queryFn: () => fetchSprints(req?.workspace_id || 'default'),
    enabled: Boolean(req),
  });

  const sprintMutation = useMutation({
    mutationFn: (newSprintId: string | null) => assignRequirementSprint(id!, newSprintId),
    onSuccess: (updated) => {
      toast.success(updated.sprint_id ? 'Assigned to sprint' : 'Moved to Product Backlog');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update sprint assignment'),
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

  const getAttachmentIcon = (name: string, type?: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-500" />;
    }
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.svg') || lower.endsWith('.gif') || type?.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4 text-sky-500" />;
    }
    if (lower.endsWith('.md') || lower.endsWith('.json') || lower.endsWith('.yaml')) {
      return <FileCode className="w-4 h-4 text-purple-500" />;
    }
    return <FileText className="w-4 h-4 text-slate-400" />;
  };

  const isMergeReady = computeMergeReady(req.status, graph?.tasks);

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6">
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

              {/* Sprint Badge & Interactive Switcher */}
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#1f202b] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d]">
                <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                  {req.sprint_id ? '🏃 Sprint:' : '📋'}
                </span>
                <select
                  value={req.sprint_id || ''}
                  onChange={(e) => sprintMutation.mutate(e.target.value ? e.target.value : null)}
                  className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer max-w-[150px] truncate"
                  title="Assign to Sprint or Backlog"
                >
                  <option value="" className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                    Product Backlog
                  </option>
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id} className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                      {s.status === 'active' ? '🏃 Active: ' : s.status === 'completed' ? '🏁 ' : '⏳ Planned: '}
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Badge & Interactive State Switcher */}
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#1f202b] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d]">
                <StatusBadge status={req.status} size="xs" />
                <select
                  value={req.status === 'in_review' ? 'qa' : req.status}
                  onChange={(e) => statusMutation.mutate(e.target.value as RequirementStatus)}
                  className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                  title="Change State"
                >
                  {stateOptions.map((st) => (
                    <option key={st.value} value={st.value} className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                      State: {st.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Implementation Branch Tag */}
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-[#1f202b] px-2 py-0.5 rounded-md border border-slate-200 dark:border-[#2d2f3d]">
                <GitBranch className="w-3 h-3 text-[#7b68ee]" />
                <span>develop</span>
              </span>

              {/* Merge Policy Selector */}
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#1f202b] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d]">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Merge:</span>
                <select
                  value={req.merge_policy || 'default'}
                  onChange={(e) => {
                    const val = e.target.value === 'default' ? null : (e.target.value as BranchMergePolicy);
                    policyMutation.mutate(val);
                  }}
                  className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                  title="Ticket Merge Policy"
                >
                  <option value="default" className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                    Workspace Default
                  </option>
                  <option value="manual_review_merge" className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                    Manual Review & Merge
                  </option>
                  <option value="auto_merge_main" className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                    Auto-Merge to Main
                  </option>
                </select>
              </div>

              <span className="text-xs text-slate-400 font-mono">rev.{req.revision}</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
              {req.title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Fan-Out Dispatch */}
          {(req.status === 'draft' || req.status === 'ready') && (
            <button
              onClick={() => fanOutMutation.mutate()}
              disabled={fanOutMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Fan-Out</span>
            </button>
          )}

          {/* In-App Git Review & Code Diff Button */}
          {req.affected_projects && req.affected_projects.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedReviewProject(req.affected_projects[0]);
                setReviewModalOpen(true);
              }}
              className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow-md shadow-blue-500/20 active:scale-[0.98] transition-all"
              title="Review project code and git diffs before merging to main"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Review Code & Git Changes</span>
            </button>
          )}

          {/* Human Review & Click Merge to Main Button */}
          {isMergeReady && (
            <button
              onClick={() => mergeMutation.mutate()}
              disabled={mergeMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
              title={
                demoMode
                  ? 'Operator review passed: Merge develop branch into main'
                  : 'Confirm the reviewed work was merged (the bridge runs no git command)'
              }
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>{mergeMutation.isPending ? mergeText.pending : mergeText.action}</span>
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
      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            <span>Requirement Document & Spec</span>
          </div>
          <span className="font-mono text-slate-400 text-[11px] font-normal">
            Base Branch: <strong className="text-purple-600 dark:text-purple-400">develop</strong>
          </span>
        </div>

        <div className="bg-slate-50 dark:bg-[#14151b] p-4 rounded-xl border border-slate-200 dark:border-[#22232e] text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
          {req.body_md}
        </div>

        {/* Attached Files & Spreadsheets (if any) */}
        {req.attachments && req.attachments.length > 0 && (
          <div className="pt-2 border-t border-slate-100 dark:border-[#22232e] space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400 tracking-wider">
              <Paperclip className="w-3.5 h-3.5 text-[#7b68ee]" />
              <span>Attached Files ({req.attachments.length}):</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {req.attachments.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#262732] text-xs"
                >
                  {getAttachmentIcon(file.name, file.type)}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                      {file.name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {file.size ? Math.round(file.size / 1024) + ' KB' : 'Asset'}
                    </p>
                  </div>
                  {file.data_url && (
                    <a
                      href={file.data_url}
                      download={file.name}
                      className="p-1 text-slate-400 hover:text-[#7b68ee] transition-colors"
                      title="Download Asset"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Multi-Project Columns & Visual DAG Switcher */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Execution Views
            </h3>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-[#1f202b] border border-slate-200 dark:border-[#2b2c3a]">
              <button
                type="button"
                onClick={() => setViewTab('board')}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                  viewTab === 'board'
                    ? 'bg-white dark:bg-[#282937] text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                Task Columns
              </button>
              <button
                type="button"
                onClick={() => setViewTab('dag')}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewTab === 'dag'
                    ? 'bg-white dark:bg-[#282937] text-[#7b68ee] dark:text-purple-300 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <GitFork className="w-3.5 h-3.5" />
                <span>Topology DAG</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-xs font-mono text-slate-400">
              {req.affected_projects.length} connected repos (targeted to develop branch)
            </span>
            <button
              onClick={() => {
                setEditingProjectsList([...req.affected_projects]);
                setIsEditingProjects(true);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg bg-purple-50 dark:bg-purple-950/40 text-[#7b68ee] dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-800/40 transition-all shadow-sm"
              title="Add or remove affected repositories"
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit Repos</span>
            </button>
          </div>
        </div>

        {viewTab === 'dag' ? (
          <DependencyGraphCanvas
            requirement={req}
            tasks={graph?.tasks || []}
            links={graph?.links || []}
            onReleaseLink={(linkId) => releaseMutation.mutate(linkId)}
            isReleasing={releaseMutation.isPending}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from(tasksByProject.entries()).map(([projectName, tasks]) => (
            <div
              key={projectName}
              className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-4 shadow-sm flex flex-col min-h-[300px]"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#262732] mb-3">
                <span className="font-bold text-xs uppercase text-slate-700 dark:text-slate-200 tracking-wider">
                  {projectName}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#20212b] text-slate-500 font-bold">
                  {tasks.length} tasks
                </span>
              </div>

              <div className="space-y-3 flex-1">
                {tasks.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs italic">
                    Waiting for fan-out initialization...
                  </div>
                ) : (
                  tasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#22232e] shadow-sm space-y-2 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-xs text-slate-800 dark:text-slate-100 leading-snug">
                          {task.title}
                        </span>
                        <StatusBadge status={task.status} size="xs" />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-slate-100 dark:border-[#1c1d27]">
                        <span>Role: {task.role}</span>
                        {task.engine_task_id && (
                          <span className="text-slate-500">#{task.engine_task_id}</span>
                        )}
                      </div>

                      {task.last_error && (
                        <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-[10px] font-mono break-all">
                          {task.last_error}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setLogTask(task)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/40 text-[#7b68ee] dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-[10px] font-bold border border-purple-200 dark:border-purple-800/40 transition-colors"
                            title="View real-time CLI terminal logs and progress"
                          >
                            <Terminal className="w-3 h-3" />
                            <span>CLI Logs</span>
                          </button>

                          {task.engine_url && (
                            <a
                              href={task.engine_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline"
                            >
                              <span>Open Engine</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {task.status !== 'done' && (
                          <button
                            onClick={() => doneMutation.mutate(task.id)}
                            disabled={doneMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-200 dark:bg-[#20212c] hover:bg-slate-300 dark:hover:bg-[#2a2b38] text-[10px] font-bold text-slate-700 dark:text-slate-300 transition-colors"
                          >
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            <span>Mark Done</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

      {/* Dependency Links Panel (Cross-repo Contract Locks) */}
      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            <GitFork className="w-4 h-4 text-purple-500" />
            <span>Cross-Repo Dependency Links & Contracts</span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {graph?.links?.length || 0} active links
          </span>
        </div>

        {(!graph?.links || graph.links.length === 0) ? (
          <div className="p-6 text-center text-slate-400 text-xs italic">
            No inter-repository blocking tickets created yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-[#22232e]">
            {graph.links.map((link) => (
              <div key={link.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-purple-600 dark:text-purple-400">
                      Link #{link.id}
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      Task #{link.task_id} ➔ Depends on Task #{link.depends_on_id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        link.state === 'released'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : link.state === 'ready'
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {link.state}
                    </span>
                  </div>
                  {link.context_md && (
                    <div className="mt-1 text-[11px] text-slate-500 font-mono">
                      Contract: {link.context_md}
                    </div>
                  )}
                </div>

                {link.state !== 'released' && (
                  <button
                    onClick={() => releaseMutation.mutate(link.id)}
                    disabled={releaseMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#2a2b38] hover:bg-slate-100 dark:hover:bg-[#20212c] text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    <Unlock className="w-3.5 h-3.5 text-sky-500" />
                    <span>Operator Release</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
          </>
        )}
      </div>

      {/* Edit Projects Modal */}
      {isEditingProjects && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white dark:bg-[#1a1b24] border border-slate-200 dark:border-[#2d2f3e] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-[#262734] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Edit Affected Repositories
                </h3>
                <p className="text-xs text-slate-400">Select target engines for this requirement</p>
              </div>
              <button
                onClick={() => setIsEditingProjects(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-2.5 max-h-80 overflow-y-auto">
              {allProjects.map((p) => {
                const checked = editingProjectsList.includes(p.name);
                return (
                  <label
                    key={p.name}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      checked
                        ? 'border-[#7b68ee] bg-purple-50/60 dark:bg-purple-950/30'
                        : 'border-slate-200 dark:border-[#282937] hover:bg-slate-50 dark:hover:bg-[#20212d]'
                    }`}
                  >
                    <div>
                      <p className="font-bold text-xs text-slate-800 dark:text-slate-200">{p.name}</p>
                      <p className="text-[10px] text-slate-400">{p.repo_path} · {p.engine_type}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setEditingProjectsList((prev) =>
                          prev.includes(p.name) ? prev.filter((n) => n !== p.name) : [...prev, p.name]
                        );
                      }}
                      className="w-4 h-4 text-[#7b68ee] rounded focus:ring-[#7b68ee] cursor-pointer"
                    />
                  </label>
                );
              })}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-[#15161e] border-t border-slate-100 dark:border-[#262734] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditingProjects(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#242533]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editingProjectsList.length === 0 || projectsMutation.isPending}
                onClick={() => projectsMutation.mutate(editingProjectsList)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-[#7b68ee] hover:bg-[#6c5ce7] shadow-sm disabled:opacity-50"
              >
                {projectsMutation.isPending ? 'Saving...' : 'Save Repos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live CLI Task Execution & Process Logs Drawer */}
      <LiveTaskLogsDrawer
        task={logTask}
        isOpen={Boolean(logTask)}
        onClose={() => setLogTask(null)}
      />

      {/* In-App Git Review & Code Diff Modal (100% Self-Contained) */}
      <ProjectGitReviewModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        projectName={selectedReviewProject || req.affected_projects?.[0]}
        projectNames={req.affected_projects || []}
        requirementTitle={req.title}
        baseBranch="develop"
        targetBranch="main"
        onMergeToMain={isMergeReady ? () => mergeMutation.mutate() : undefined}
        isMerging={mergeMutation.isPending}
      />
    </div>
  );
}
