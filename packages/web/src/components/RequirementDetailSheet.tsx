import { useState, useEffect, useRef } from 'react';
import { RunSettingsDialog } from './RunSettingsDialog.js';
import { statusChangeStartsFanOut } from '../lib/runSettings.js';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRequirement,
  fetchRequirementGraph,
  fetchProjects,
  fetchSprints,
  assignRequirementSprint,
  cancelRequirement,
  markTaskDone,
  releaseLink,
  updateRequirement,
  updateRequirementStatus,
  updateRequirementProjects,
  updateRequirementMergePolicy,
  mergeRequirementToMain,
  startMergeToQa,
  retryTask,
} from '../lib/api.js';
import { canRetry, retryOutcome } from '../lib/taskActions.js';
import { mergeCopy, mergeGateAction } from '../lib/mergeReady.js';
import { useDemoMode } from '../lib/useDemoMode.js';
import { StatusBadge } from './StatusBadge.js';
import { RequestChangesButton, TaskReviewComments } from './ReviewComments.js';
import { RequirementGitReviewButton } from './RequirementGitReview.js';
import { AiQaHeader } from './AiQaHeader.js';
import { useAskBeforeMerge } from './MergeAiQaConfirm.js';
import { BridgeTask, RequirementStatus, BranchMergePolicy, Priority, UpdateRequirementInput } from '@sp-kickstack/shared';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
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
  Bot,
  Eye,
  Code2,
  Maximize2,
  Minimize2,
  Copy,
  Lock,
  RotateCcw,
} from 'lucide-react';
import { Sheet, SheetContent, SheetClose } from './ui/sheet.js';
import { RadixSelect } from './ui/select.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog.js';
import { MarkdownMessage } from './MarkdownMessage.js';

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
  const demoMode = useDemoMode();
  const { wsPath } = useWorkspace();
  const { openEdit } = useCreateRequirement();
  const mergeText = mergeCopy(demoMode);
  const [isEditingProjects, setIsEditingProjects] = useState(false);
  const [editingProjectsList, setEditingProjectsList] = useState<string[]>([]);
  const [specViewMode, setSpecViewMode] = useState<'rich' | 'raw' | 'edit'>('rich');
  const [isSpecExpanded, setIsSpecExpanded] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBodyMd, setEditBodyMd] = useState('');

  const [fanOutOpen, setFanOutOpen] = useState(false);
  const { data: req, isLoading: reqLoading } = useQuery({
    queryKey: ['requirement', requirementId],
    queryFn: () => fetchRequirement(requirementId!),
    enabled: Boolean(requirementId && isOpen),
    refetchInterval: (query) => (query.state.data?.merge_state === 'running' ? 1000 : false),
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

  const isEditable = req?.status === 'draft' || req?.status === 'ready';

  useEffect(() => {
    if (req) {
      setEditTitle(req.title);
      setEditBodyMd(req.body_md);
    }
  }, [req]);

  useEffect(() => {
    if (!isEditable) {
      setIsEditingTitle(false);
      if (specViewMode === 'edit') {
        setSpecViewMode('rich');
      }
    }
  }, [isEditable]);

  // Mutations
  const updateMutation = useMutation({
    mutationFn: (data: UpdateRequirementInput) => updateRequirement(requirementId!, data),
    onSuccess: () => {
      toast.success('Requirement updated successfully');
      setIsEditingTitle(false);
      if (specViewMode === 'edit') setSpecViewMode('rich');
      queryClient.invalidateQueries({ queryKey: ['requirement', requirementId] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update requirement'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRequirement(requirementId!),
    onSuccess: () => {
      toast.info('Requirement cancelled');
      queryClient.invalidateQueries();
      onClose();
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
      toast.success(mergeText.success);
      queryClient.invalidateQueries();
      onClose();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to merge to main'),
  });

  // Merge gate: merges every task branch into its base branch, then moves to QA (runs in the background).
  // Every move to QA merges: ask first when AI QA is still checking or found open blockers.
  const { askBeforeMerge, mergeDialog } = useAskBeforeMerge();
  const mergeGateMutation = useMutation({
    mutationFn: () => startMergeToQa(requirementId!),
    onSuccess: () => {
      toast.info('Merging… the requirement moves to QA when the merge succeeds');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Could not start the merge'),
  });

  // Auto-close form when merge gate succeeds
  useEffect(() => {
    if (!isOpen || !requirementId) return;
    const handleMergeSucceeded = (e: Event) => {
      const custom = e as CustomEvent<{ reqId?: string }>;
      if (custom.detail?.reqId === requirementId) {
        onClose();
      }
    };
    window.addEventListener('sp:merge_succeeded', handleMergeSucceeded);
    return () => window.removeEventListener('sp:merge_succeeded', handleMergeSucceeded);
  }, [isOpen, requirementId, onClose]);

  const wasMergingRef = useRef(false);
  useEffect(() => {
    if (req?.merge_state === 'running') {
      wasMergingRef.current = true;
    } else if (wasMergingRef.current) {
      if (req?.status === 'qa' && req?.merge_state === 'idle') {
        wasMergingRef.current = false;
        onClose();
      } else if (req?.merge_state === 'failed') {
        wasMergingRef.current = false;
      }
    }
  }, [req?.merge_state, req?.status, onClose]);

  const doneMutation = useMutation({
    mutationFn: (taskId: number) => markTaskDone(taskId),
    onSuccess: () => {
      toast.success('Task marked as done');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update task'),
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: number) => retryTask(taskId),
    onSuccess: (updated) => {
      const outcome = retryOutcome(updated);
      toast[outcome.kind](outcome.message);
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Could not retry task'),
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

  const mergeAction = mergeGateAction(req, graph?.tasks);
  // Legacy "Confirm merged" only for work without task branches.
  const isMergeReady = mergeAction === 'confirm';

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
            {req?.session_id && (
              <Link
                to={wsPath(`/chat?session=${req.session_id}`)}
                className="p-1.5 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors inline-flex items-center gap-1.5 text-xs font-semibold"
                title="View original AI chat discussion"
              >
                <Bot className="w-4 h-4" />
                <span className="hidden sm:inline">AI Chat Origin</span>
              </Link>
            )}

            {requirementId && (
              <Link
                to={wsPath(`/requirements/${requirementId}`)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#7b68ee] hover:bg-purple-50 dark:hover:bg-[#282828] transition-colors inline-flex items-center gap-1 text-xs font-semibold"
                title="Open full page"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">Full Page</span>
              </Link>
            )}

            <SheetClose asChild>
              <button
                type="button"
                onClick={onClose}
                className="px-2 py-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#282828] transition-colors flex items-center gap-1 text-xs font-medium cursor-pointer"
                title="Close panel (Esc)"
              >
                <X className="w-4 h-4" />
                <span>Close</span>
              </button>
            </SheetClose>
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
            <div className="px-6 py-2.5 bg-slate-50/50 dark:bg-[#242424] border-b border-slate-100 dark:border-[#2d2d2d] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {/* Status Switcher */}
                <div className="w-36">
                  <RadixSelect
                    size="xs"
                    value={req.status === 'in_review' ? 'qa' : req.status}
                    onChange={(nextVal) => {
                      const next = nextVal as RequirementStatus;
                      if (statusChangeStartsFanOut(req.status, next)) setFanOutOpen(true);
                      else if (next === 'qa') askBeforeMerge(req, () => statusMutation.mutate(next));
                      else statusMutation.mutate(next);
                    }}
                    options={stateOptions.map((st) => ({
                      value: st.value,
                      label: st.label,
                    }))}
                  />
                </div>

                {/* Priority Display / Switcher */}
                {prio && (
                  <div className="w-28">
                    {isEditable ? (
                      <RadixSelect
                        size="xs"
                        value={req.priority}
                        onChange={(val) => updateMutation.mutate({ priority: val as Priority })}
                        options={[
                          { value: 'urgent', label: 'Urgent', icon: <Flag className="w-3 h-3 text-red-500" /> },
                          { value: 'high', label: 'High', icon: <Flag className="w-3 h-3 text-amber-500" /> },
                          { value: 'normal', label: 'Normal', icon: <Flag className="w-3 h-3 text-blue-500" /> },
                          { value: 'low', label: 'Low', icon: <Flag className="w-3 h-3 text-slate-400" /> },
                        ]}
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 bg-white dark:bg-[#2a2a2a] px-2 py-1 rounded-lg border border-slate-200 dark:border-[#333333] shadow-2xs">
                        <Flag className={`w-3.5 h-3.5 ${prio.color}`} />
                        <span className="capitalize text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                          {prio.label}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Sprint Switcher */}
                <div className="w-40">
                  <RadixSelect
                    size="xs"
                    value={req.sprint_id || ''}
                    onChange={(val) => sprintMutation.mutate(val ? val : null)}
                    options={[
                      { value: '', label: 'Product Backlog' },
                      ...sprints.map((s) => ({
                        value: s.id,
                        label: s.name,
                        badge: (
                          <span className="text-[9px] px-1 py-0.2 rounded font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {s.status}
                          </span>
                        ),
                      })),
                    ]}
                  />
                </div>

                {/* Merge Policy Selector */}
                <div className="w-36">
                  <RadixSelect
                    size="xs"
                    value={req.merge_policy || 'default'}
                    onChange={(val) => {
                      const policy = val === 'default' ? null : (val as BranchMergePolicy);
                      policyMutation.mutate(policy);
                    }}
                    options={[
                      { value: 'default', label: 'Default Policy' },
                      { value: 'manual_review_merge', label: 'Review first' },
                      { value: 'auto_merge', label: 'Auto-merge' },
                    ]}
                  />
                </div>

                {/* Implementation Branch Tag */}
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-white dark:bg-[#2a2a2a] px-2 py-1 rounded-md border border-slate-200 dark:border-[#333333]">
                  <GitBranch className="w-3 h-3 text-[#7b68ee]" />
                  <span>develop</span>
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {/* Stage Lock or Edit Trigger Button */}
                {isEditable ? (
                  specViewMode === 'edit' || isEditingTitle ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingTitle(false);
                          setSpecViewMode('rich');
                          setEditTitle(req.title);
                          setEditBodyMd(req.body_md);
                        }}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateMutation.mutate({
                            title: editTitle,
                            body_md: editBodyMd,
                          })
                        }
                        disabled={updateMutation.isPending || !editTitle.trim()}
                        className="flex items-center gap-1 px-3 py-1 bg-[#7b68ee] hover:bg-[#6c5ce7] text-white rounded-lg text-xs font-bold shadow-xs active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{updateMutation.isPending ? 'Saving...' : 'Save All'}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openEdit(req)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-[#242424] hover:bg-purple-50 dark:hover:bg-[#2e263d] text-purple-600 dark:text-purple-400 rounded-lg text-xs font-bold border border-purple-200 dark:border-purple-900/60 transition-colors cursor-pointer shadow-2xs"
                      title="Edit requirement form"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Requirement</span>
                    </button>
                  )
                ) : (
                  <span
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-[#20212b] text-slate-500 dark:text-slate-400 rounded-lg text-[11px] font-semibold border border-slate-200 dark:border-[#2d2f3d]"
                    title="Active work has begun or finished: specification is view-only"
                  >
                    <Lock className="w-3 h-3 text-slate-400" />
                    <span>View Only</span>
                  </span>
                )}

                {(req.status === 'draft' || req.status === 'ready') && (
                  <button
                    onClick={() => setFanOutOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-xs active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Start Fan-Out</span>
                  </button>
                )}
                {(req.status === 'draft' || req.status === 'ready') && (
                  <RunSettingsDialog req={req} mode="fan-out" open={fanOutOpen} onOpenChange={setFanOutOpen} />
                )}

                {/* What the requirement's branches change, per repository */}
                <RequirementGitReviewButton req={req} tasks={graph?.tasks ?? []} />

                {/* AI QA: status of each repository's QA run, and Run AI QA (in QA) */}
                <AiQaHeader req={req} />

                {/* Merge gate: merge every task branch, run the project tests, push, move to QA */}
                {mergeAction === 'merge' && (
                  <button
                    onClick={() => askBeforeMerge(req, () => mergeGateMutation.mutate())}
                    disabled={mergeGateMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
                    title="Merge every task branch into its base branch (after the project tests pass), push, and move to QA"
                  >
                    <GitMerge className="w-3 h-3" />
                    <span>Merge &amp; move to QA</span>
                  </button>
                )}
                {mergeAction === 'merging' && (
                  <span className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold">
                    <GitMerge className="w-3 h-3 animate-pulse" />
                    Merging…
                  </span>
                )}
                {req.merge_state === 'failed' && req.merge_error && (
                  <span
                    className="max-w-xs truncate px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-semibold"
                    title={req.merge_error}
                  >
                    Merge failed: {req.merge_error.split('\n')[0]}
                  </span>
                )}

                {isMergeReady && (
                  <button
                    onClick={() => mergeMutation.mutate()}
                    disabled={mergeMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-xs active:scale-[0.98] transition-all disabled:opacity-50"
                    title={
                      demoMode
                        ? 'Review passed: Merge develop branch into main'
                        : 'Confirm the reviewed work was merged (the bridge runs no git command)'
                    }
                  >
                    <GitMerge className="w-3 h-3" />
                    <span>{mergeMutation.isPending ? mergeText.pending : mergeText.action}</span>
                  </button>
                )}

                {req.status !== 'cancelled' && req.status !== 'done' && (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={cancelMutation.isPending}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-[#242424] hover:bg-slate-100 dark:hover:bg-[#2e2e2e] text-slate-600 dark:text-slate-300 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#303030] transition-colors cursor-pointer"
                    title="Cancel requirement"
                  >
                    <XCircle className="w-3.5 h-3.5 text-rose-500" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable Body Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Title Section */}
              <div>
                {isEditingTitle && isEditable ? (
                  <div className="space-y-1.5 p-3 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-purple-600 dark:text-purple-400 font-bold block">
                      Edit Requirement Title
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 text-base font-bold px-3 py-1.5 rounded-lg border border-purple-300 dark:border-purple-800 bg-white dark:bg-[#1a1b24] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                        placeholder="Requirement Title"
                      />
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ title: editTitle })}
                        disabled={updateMutation.isPending || !editTitle.trim()}
                        className="px-3 py-1.5 bg-[#7b68ee] text-white rounded-lg text-xs font-bold hover:bg-[#6c5ce7] disabled:opacity-50 transition-all cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingTitle(false);
                          setEditTitle(req.title);
                        }}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-snug">
                      {req.title}
                    </h2>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={() => setIsEditingTitle(true)}
                        className="px-2 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg border border-purple-200 dark:border-purple-800/40 flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                        title="Edit title"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit Title</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Requirement Document & Spec Preview or Editor */}
              <div className="border border-slate-200 dark:border-[#2d2d2d] rounded-xl overflow-hidden bg-white dark:bg-[#242424] shadow-2xs space-y-0">
                <div className="px-4 py-2 border-b border-slate-200 dark:border-[#2d2d2d] bg-slate-50/80 dark:bg-[#202020] flex items-center justify-between text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{specViewMode === 'edit' ? 'Editing Specification' : 'Specification & Details'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 normal-case">
                    {/* View Toggle */}
                    <div className="flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-[#2d2f3d] text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSpecViewMode('rich')}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold transition-all ${
                          specViewMode === 'rich'
                            ? 'bg-white dark:bg-[#1a1b24] text-purple-600 dark:text-purple-300 shadow-2xs'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                        title="Rich Document View"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Rich</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpecViewMode('raw')}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold transition-all ${
                          specViewMode === 'raw'
                            ? 'bg-white dark:bg-[#1a1b24] text-purple-600 dark:text-purple-300 shadow-2xs'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                        title="Raw Markdown View"
                      >
                        <Code2 className="w-3 h-3" />
                        <span>Raw</span>
                      </button>
                      {isEditable && (
                        <button
                          type="button"
                          onClick={() => setSpecViewMode('edit')}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold transition-all ${
                            specViewMode === 'edit'
                              ? 'bg-[#7b68ee] text-white shadow-2xs'
                              : 'text-purple-600 dark:text-purple-400 hover:text-purple-800'
                          }`}
                          title="Edit Markdown Specification"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}
                    </div>

                    {/* Copy Spec Button */}
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(req.body_md);
                        toast.success('Specification markdown copied to clipboard');
                      }}
                      className="p-1 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#2d2f3d] transition-colors"
                      title="Copy Specification Markdown"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    {/* Expand / Collapse Button */}
                    <button
                      type="button"
                      onClick={() => setIsSpecExpanded(!isSpecExpanded)}
                      className="p-1 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#2d2f3d] transition-colors"
                      title={isSpecExpanded ? 'Collapse View' : 'Expand View'}
                    >
                      {isSpecExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {specViewMode === 'edit' && isEditable ? (
                  <div className="p-4 bg-slate-50/50 dark:bg-[#181920] space-y-3">
                    <textarea
                      value={editBodyMd}
                      onChange={(e) => setEditBodyMd(e.target.value)}
                      rows={12}
                      className="w-full p-3.5 font-mono text-xs rounded-xl border border-slate-300 dark:border-[#333333] bg-white dark:bg-[#14151b] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] leading-relaxed resize-y"
                      placeholder="Write specification in markdown..."
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSpecViewMode('rich');
                          setEditBodyMd(req.body_md);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ body_md: editBodyMd })}
                        disabled={updateMutation.isPending}
                        className="px-3.5 py-1.5 bg-[#7b68ee] hover:bg-[#6c5ce7] text-white rounded-lg text-xs font-bold shadow-xs active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {updateMutation.isPending ? 'Saving...' : 'Save Specification'}
                      </button>
                    </div>
                  </div>
                ) : specViewMode === 'rich' ? (
                  <div
                    className={`p-4 text-xs text-slate-800 dark:text-slate-200 overflow-y-auto leading-relaxed bg-white dark:bg-[#181920] transition-all ${
                      isSpecExpanded ? 'max-h-[750px]' : 'max-h-80'
                    }`}
                  >
                    <MarkdownMessage
                      content={req.body_md.replace(/^---\s*[\s\S]*?---\s*/, '').trim() || req.body_md}
                    />
                  </div>
                ) : (
                  <div
                    className={`p-4 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap overflow-y-auto leading-relaxed bg-slate-50/60 dark:bg-[#14151b] transition-all ${
                      isSpecExpanded ? 'max-h-[750px]' : 'max-h-80'
                    }`}
                  >
                    {req.body_md}
                  </div>
                )}
              </div>

              {/* Attached Files & Assets (if any) */}
              {req.attachments && req.attachments.length > 0 && (
                <div className="border border-slate-200 dark:border-[#2d2d2d] rounded-xl p-4 bg-white dark:bg-[#242424] shadow-2xs space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400 tracking-wider">
                    <Paperclip className="w-3.5 h-3.5 text-[#7b68ee]" />
                    <span>Attached Assets ({req.attachments.length}):</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {req.attachments.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 dark:bg-[#171717] border border-slate-200 dark:border-[#2d2d2d] text-xs"
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
                  <div className="flex items-center gap-2">
                    {/* Sends the open review comments of every repository below as one round */}
                    <RequestChangesButton req={req} tasks={graph?.tasks ?? []} />
                    {isEditable && (
                      <button
                        onClick={() => {
                          setEditingProjectsList([...req.affected_projects]);
                          setIsEditingProjects(true);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-lg bg-purple-50 dark:bg-purple-950/40 text-[#7b68ee] dark:text-purple-300 hover:bg-purple-100 border border-purple-200 dark:border-purple-800/40 transition-all shadow-2xs cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit Repos</span>
                      </button>
                    )}
                  </div>
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
                                : 'bg-white dark:bg-[#242424] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
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
                      className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-xl p-3.5 shadow-2xs space-y-2.5"
                    >
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#2d2d2d]">
                        <span className="font-bold text-xs uppercase text-slate-800 dark:text-slate-200 tracking-wider">
                          📁 {projectName}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#2a2a2a] text-slate-500 font-bold">
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
                            className="p-3 rounded-lg bg-slate-50 dark:bg-[#171717] border border-slate-200 dark:border-[#2d2d2d] space-y-2"
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

                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-[#2d2d2d]">
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

                              {canRetry(task, req?.status) && (
                                <button
                                  onClick={() => retryMutation.mutate(task.id)}
                                  disabled={retryMutation.isPending}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-100 dark:bg-amber-950/40 hover:bg-amber-200 dark:hover:bg-amber-900/50 text-[10px] font-bold text-amber-700 dark:text-amber-300 transition-colors"
                                  title="Send this task to its engine again on the same branch (the old engine task is cancelled)"
                                >
                                  <RotateCcw className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                  <span>Retry</span>
                                </button>
                              )}

                              {task.status !== 'done' && (
                                <button
                                  onClick={() => doneMutation.mutate(task.id)}
                                  disabled={doneMutation.isPending}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-200 dark:bg-[#282828] hover:bg-slate-300 dark:hover:bg-[#303030] text-[10px] font-bold text-slate-700 dark:text-slate-300 transition-colors"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  <span>Mark Done</span>
                                </button>
                              )}
                            </div>

                            <TaskReviewComments req={req} task={task} />
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Cross-Repo Dependency Links (if any) */}
              {graph?.links && graph.links.length > 0 && (
                <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-xl p-4 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      <GitFork className="w-4 h-4 text-purple-500" />
                      <span>Cross-Repo Dependencies</span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {graph.links.length} active links
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-[#2d2d2d]">
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

      {mergeDialog}

      {/* Radix UI Cancel Confirmation Dialog */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="w-10 h-10 rounded-2xl bg-rose-100 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/40 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-2">
              <XCircle className="w-5 h-5" />
            </div>
            <DialogTitle>Cancel Requirement #{req?.id}?</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel <strong className="text-slate-900 dark:text-white">"{req?.title}"</strong>?
              This will stop active execution and mark the requirement as cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2 pt-3">
            <button
              type="button"
              onClick={() => setShowCancelConfirm(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937] transition-colors cursor-pointer"
            >
              Keep Requirement
            </button>
            <button
              type="button"
              disabled={cancelMutation.isPending}
              onClick={() => {
                setShowCancelConfirm(false);
                cancelMutation.mutate();
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {cancelMutation.isPending ? 'Cancelling...' : 'Yes, Cancel Requirement'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
