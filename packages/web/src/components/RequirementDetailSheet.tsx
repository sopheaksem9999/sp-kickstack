import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { StatusBadge } from './StatusBadge.js';
import { BridgeTask, RequirementStatus, BranchMergePolicy, Priority } from '@sp-kickstack/shared';
import { toast } from 'sonner';
import {
  X,
  ExternalLink,
  Play,
  GitMerge,
  XCircle,
  BookOpen,
  Paperclip,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  FileText,
  Edit3,
  CheckCircle2,
  GitFork,
  GitBranch,
  Flag,
} from 'lucide-react';
import { Sheet, SheetContent } from './ui/sheet.js';

interface RequirementDetailSheetProps {
  requirementId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const stateOptions: { value: RequirementStatus; label: string }[] = [
  { value: 'draft', label: 'ToDo' },
  { value: 'in_progress', label: 'In-Progress' },
  { value: 'qa', label: 'QA / Review' },
  { value: 'done', label: 'Done' },
];

const priorityConfig: Record<Priority, { color: string; label: string }> = {
  urgent: { color: 'text-rose-500 fill-rose-500', label: 'Urgent' },
  high: { color: 'text-amber-500 fill-amber-500', label: 'High' },
  normal: { color: 'text-blue-500 fill-blue-500', label: 'Normal' },
  low: { color: 'text-slate-400 fill-slate-400', label: 'Low' },
};

export function RequirementDetailSheet({
  requirementId,
  isOpen,
  onClose,
}: RequirementDetailSheetProps) {
  const queryClient = useQueryClient();
  const [isEditingProjects, setIsEditingProjects] = useState(false);
  const [editingProjectsList, setEditingProjectsList] = useState<string[]>([]);

  const { data: req, isLoading: reqLoading } = useQuery({
    queryKey: ['requirement', requirementId],
    queryFn: () => fetchRequirement(requirementId!),
    enabled: Boolean(requirementId && isOpen),
  });

  const { data: graph, isLoading: graphLoading } = useQuery({
    queryKey: ['requirement-graph', requirementId],
    queryFn: () => fetchRequirementGraph(requirementId!),
    enabled: Boolean(requirementId && isOpen),
    refetchInterval: 3000,
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects', req?.workspace_id || 'default'],
    queryFn: () => fetchProjects(req?.workspace_id || 'default'),
    enabled: Boolean(req && isOpen),
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', req?.workspace_id || 'default'],
    queryFn: () => fetchSprints(req?.workspace_id || 'default'),
    enabled: Boolean(req && isOpen),
  });

  // Mutations
  const fanOutMutation = useMutation({
    mutationFn: () => startRequirementFanOut(requirementId!),
    onSuccess: () => {
      toast.success('Fan-out dispatched to affected engines');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Fan-out failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRequirement(requirementId!),
    onSuccess: () => {
      toast.info('Requirement cancelled');
      queryClient.invalidateQueries();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: RequirementStatus) =>
      updateRequirementStatus(requirementId!, newStatus),
    onSuccess: () => {
      toast.success('Requirement state updated');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update status'),
  });

  const sprintMutation = useMutation({
    mutationFn: (newSprintId: string | null) =>
      assignRequirementSprint(requirementId!, newSprintId),
    onSuccess: (updated) => {
      toast.success(
        updated.sprint_id ? 'Assigned to sprint' : 'Moved to Product Backlog'
      );
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update sprint assignment'),
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergeRequirementToMain(requirementId!),
    onSuccess: () => {
      toast.success('Successfully reviewed and merged into main branch! 🎉');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to merge to main'),
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

  const projectsMutation = useMutation({
    mutationFn: (newProjects: string[]) =>
      updateRequirementProjects(requirementId!, newProjects),
    onSuccess: () => {
      toast.success('Affected projects updated');
      setIsEditingProjects(false);
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update projects'),
  });

  const policyMutation = useMutation({
    mutationFn: (newPolicy: BranchMergePolicy | null) =>
      updateRequirementMergePolicy(requirementId!, newPolicy),
    onSuccess: () => {
      toast.success('Merge policy updated');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update merge policy'),
  });

  const getAttachmentIcon = (name: string, type?: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-500" />;
    }
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.gif') ||
      type?.startsWith('image/')
    ) {
      return <ImageIcon className="w-4 h-4 text-sky-500" />;
    }
    if (lower.endsWith('.md') || lower.endsWith('.json') || lower.endsWith('.yaml')) {
      return <FileCode className="w-4 h-4 text-purple-500" />;
    }
    return <FileText className="w-4 h-4 text-slate-400" />;
  };

  const tasksByProject = new Map<string, BridgeTask[]>();
  if (req) {
    for (const proj of req.affected_projects || []) {
      tasksByProject.set(proj, []);
    }
    for (const task of graph?.tasks || []) {
      const list = tasksByProject.get(task.project) || [];
      list.push(task);
      tasksByProject.set(task.project, list);
    }
  }

  const isMergeReady =
    req && (req.status === 'qa' || req.status === 'in_review' || req.status === 'done');

  const prio = req ? priorityConfig[req.priority] || priorityConfig.normal : null;

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="p-0 overflow-hidden sm:max-w-2xl lg:max-w-3xl flex flex-col w-screen z-50 bg-white dark:bg-[#15161e] border-l border-slate-200 dark:border-[#262732] shadow-2xl"
      >
        {/* Sheet Top Header */}
        <div className="px-6 py-3.5 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/80 dark:bg-[#1a1b24] select-none">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-sm text-[#7b68ee] font-black">
              {req?.id || requirementId}
            </span>
            {req && (
              <span className="text-[11px] text-purple-700 dark:text-purple-300 font-mono bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/40 px-2 py-0.5 rounded font-semibold">
                📁 {req.workspace_id || 'default'}
              </span>
            )}
            {req && (
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                rev.{req.revision}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {requirementId && (
              <Link
                to={`/requirements/${requirementId}`}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#7b68ee] hover:bg-purple-50 dark:hover:bg-[#252636] transition-colors inline-flex items-center gap-1 text-xs font-semibold"
                title="Open full page"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">Full Page</span>
              </Link>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#20212c] transition-colors"
              title="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Loading / Error States */}
        {reqLoading || graphLoading ? (
          <div className="flex-1 flex items-center justify-center p-12 text-slate-400 text-sm">
            Loading requirement details...
          </div>
        ) : !req ? (
          <div className="flex-1 flex items-center justify-center p-12 text-rose-500 font-bold">
            Requirement not found
          </div>
        ) : (
          <>
            {/* Quick Metadata & State Bar */}
            <div className="px-6 py-2.5 bg-slate-50/50 dark:bg-[#181922] border-b border-slate-100 dark:border-[#22232e] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {/* Status Switcher */}
                <div className="flex items-center gap-1.5 bg-white dark:bg-[#1f202b] px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] shadow-2xs">
                  <StatusBadge status={req.status} size="xs" />
                  <select
                    value={req.status === 'in_review' ? 'qa' : req.status}
                    onChange={(e) =>
                      statusMutation.mutate(e.target.value as RequirementStatus)
                    }
                    className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                    title="Change State"
                  >
                    {stateOptions.map((st) => (
                      <option
                        key={st.value}
                        value={st.value}
                        className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200"
                      >
                        State: {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Priority Display */}
                {prio && (
                  <div
                    className="flex items-center gap-1.5 bg-white dark:bg-[#1f202b] px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] shadow-2xs"
                    title={`Priority: ${prio.label}`}
                  >
                    <Flag className={`w-3.5 h-3.5 ${prio.color}`} />
                    <span className="capitalize text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                      {prio.label}
                    </span>
                  </div>
                )}

                {/* Sprint Switcher */}
                <div className="flex items-center gap-1.5 bg-white dark:bg-[#1f202b] px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] shadow-2xs">
                  <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                    {req.sprint_id ? '🏃 Sprint:' : '📋'}
                  </span>
                  <select
                    value={req.sprint_id || ''}
                    onChange={(e) =>
                      sprintMutation.mutate(e.target.value ? e.target.value : null)
                    }
                    className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer max-w-[140px] truncate"
                    title="Assign to Sprint or Backlog"
                  >
                    <option
                      value=""
                      className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200"
                    >
                      Product Backlog
                    </option>
                    {sprints.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                        className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200"
                      >
                        {s.status === 'active'
                          ? '🏃 Active: '
                          : s.status === 'completed'
                          ? '🏁 '
                          : '⏳ '}
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Merge Policy Selector */}
                <div className="flex items-center gap-1.5 bg-white dark:bg-[#1f202b] px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] shadow-2xs">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Merge:</span>
                  <select
                    value={req.merge_policy || 'default'}
                    onChange={(e) => {
                      const val =
                        e.target.value === 'default'
                          ? null
                          : (e.target.value as BranchMergePolicy);
                      policyMutation.mutate(val);
                    }}
                    className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                    title="Ticket Merge Policy"
                  >
                    <option value="default" className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                      Default Policy
                    </option>
                    <option value="manual_review_merge" className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                      Manual Review & Merge
                    </option>
                    <option value="auto_merge_main" className="bg-white dark:bg-[#1a1b22] text-slate-800 dark:text-slate-200">
                      Auto-Merge to Main
                    </option>
                  </select>
                </div>

                {/* Implementation Branch Tag */}
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-white dark:bg-[#1f202b] px-2 py-1 rounded-md border border-slate-200 dark:border-[#2d2f3d]">
                  <GitBranch className="w-3 h-3 text-[#7b68ee]" />
                  <span>develop</span>
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {req.status === 'draft' && (
                  <button
                    onClick={() => fanOutMutation.mutate()}
                    disabled={fanOutMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-xs active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Start Fan-Out</span>
                  </button>
                )}

                {isMergeReady && (
                  <button
                    onClick={() => mergeMutation.mutate()}
                    disabled={mergeMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-xs active:scale-[0.98] transition-all disabled:opacity-50"
                    title="Review passed: Merge develop branch into main"
                  >
                    <GitMerge className="w-3 h-3" />
                    <span>{mergeMutation.isPending ? 'Merging...' : 'Merge to Main'}</span>
                  </button>
                )}

                {req.status !== 'cancelled' && req.status !== 'done' && (
                  <button
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-[#20212c] hover:bg-slate-100 dark:hover:bg-[#2a2b38] text-slate-600 dark:text-slate-300 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#2e303d] transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5 text-rose-500" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable Body Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Title */}
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-snug">
                  {req.title}
                </h2>
              </div>

              {/* Requirement Document & Spec Preview */}
              <div className="border border-slate-200 dark:border-[#262732] rounded-xl overflow-hidden bg-white dark:bg-[#181922] shadow-2xs space-y-2">
                <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#262732] bg-slate-50/80 dark:bg-[#1a1b24] flex items-center justify-between text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Specification & Details</span>
                  </div>
                  <span className="font-mono text-slate-400 text-[11px] font-normal lowercase">
                    base: <strong className="text-purple-600 dark:text-purple-400 font-mono">develop</strong>
                  </span>
                </div>

                <div className="p-4 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed bg-slate-50/40 dark:bg-[#14151c]">
                  {req.body_md}
                </div>
              </div>

              {/* Attached Files & Assets (if any) */}
              {req.attachments && req.attachments.length > 0 && (
                <div className="border border-slate-200 dark:border-[#262732] rounded-xl p-4 bg-white dark:bg-[#181922] shadow-2xs space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400 tracking-wider">
                    <Paperclip className="w-3.5 h-3.5 text-[#7b68ee]" />
                    <span>Attached Assets ({req.attachments.length}):</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {req.attachments.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#262732] text-xs"
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

              {/* Per-Repo Tasks & Engine Runtimes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Per-Repo Agent Engines ({req.affected_projects.length})
                  </h3>
                  <button
                    onClick={() => {
                      setEditingProjectsList([...req.affected_projects]);
                      setIsEditingProjects(true);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-lg bg-purple-50 dark:bg-purple-950/40 text-[#7b68ee] dark:text-purple-300 hover:bg-purple-100 border border-purple-200 dark:border-purple-800/40 transition-all shadow-2xs"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Edit Repos</span>
                  </button>
                </div>

                {/* Edit Projects Modal/Inline Panel */}
                {isEditingProjects && (
                  <div className="p-3.5 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/60 space-y-3 text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      Select Target Repositories:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {allProjects.map((p) => {
                        const isSelected = editingProjectsList.includes(p.name);
                        return (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setEditingProjectsList(
                                  editingProjectsList.filter((n) => n !== p.name)
                                );
                              } else {
                                setEditingProjectsList([...editingProjectsList, p.name]);
                              }
                            }}
                            className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] font-semibold transition-all ${
                              isSelected
                                ? 'bg-[#7b68ee] text-white border-[#7b68ee]'
                                : 'bg-white dark:bg-[#1a1b22] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => projectsMutation.mutate(editingProjectsList)}
                        disabled={
                          editingProjectsList.length === 0 || projectsMutation.isPending
                        }
                        className="px-3 py-1 rounded-lg bg-[#7b68ee] text-white font-bold text-xs hover:bg-[#6c5ce7] disabled:opacity-50"
                      >
                        Save Repos
                      </button>
                      <button
                        onClick={() => setIsEditingProjects(false)}
                        className="px-3 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Tasks List */}
                <div className="space-y-3">
                  {Array.from(tasksByProject.entries()).map(([projectName, tasks]) => (
                    <div
                      key={projectName}
                      className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-xl p-3.5 shadow-2xs space-y-2.5"
                    >
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#262732]">
                        <span className="font-bold text-xs uppercase text-slate-800 dark:text-slate-200 tracking-wider">
                          📁 {projectName}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#20212b] text-slate-500 font-bold">
                          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {tasks.length === 0 ? (
                        <div className="p-4 text-center text-slate-400 text-xs italic">
                          Waiting for fan-out initialization...
                        </div>
                      ) : (
                        tasks.map((task) => (
                          <div
                            key={task.id}
                            className="p-3 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#22232e] space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-xs text-slate-800 dark:text-slate-100 leading-snug">
                                {task.title}
                              </span>
                              <StatusBadge status={task.status} size="xs" />
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
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

                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-[#1c1d27]">
                              {task.engine_url ? (
                                <a
                                  href={task.engine_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline"
                                >
                                  <span>Open Engine</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <div />
                              )}

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
                  ))}
                </div>
              </div>

              {/* Cross-Repo Dependency Links (if any) */}
              {graph?.links && graph.links.length > 0 && (
                <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-xl p-4 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      <GitFork className="w-4 h-4 text-purple-500" />
                      <span>Cross-Repo Dependencies</span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {graph.links.length} active links
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-[#22232e]">
                    {graph.links.map((link) => (
                      <div
                        key={link.id}
                        className="py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-purple-600 dark:text-purple-400">
                              Link #{link.id}
                            </span>
                            <span className="text-slate-400 font-mono text-[11px]">
                              Task #{link.task_id} ➔ Depends on #{link.depends_on_id}
                            </span>
                          </div>
                        </div>

                        {link.state !== 'released' && (
                          <button
                            onClick={() => releaseMutation.mutate(link.id)}
                            disabled={releaseMutation.isPending}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300"
                          >
                            Release
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
