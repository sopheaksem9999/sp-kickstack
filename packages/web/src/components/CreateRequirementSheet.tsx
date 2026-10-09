import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProjects, createRequirement, startRequirementFanOut } from '../lib/api.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { toast } from 'sonner';
import {
  X,
  Plus,
  Trash2,
  BookOpen,
  Sparkles,
  Flag,
  CheckCircle2,
  FolderGit2,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { Priority } from '@sp-kickstack/shared';

const priorityOptions: { value: Priority; label: string; color: string; bg: string }[] = [
  { value: 'urgent', label: 'Urgent', color: 'text-rose-500 fill-rose-500', bg: 'hover:bg-rose-500/10' },
  { value: 'high', label: 'High', color: 'text-amber-500 fill-amber-500', bg: 'hover:bg-amber-500/10' },
  { value: 'normal', label: 'Normal', color: 'text-blue-500 fill-blue-500', bg: 'hover:bg-blue-500/10' },
  { value: 'low', label: 'Low', color: 'text-slate-400 fill-slate-400', bg: 'hover:bg-slate-500/10' },
];

export function CreateRequirementSheet() {
  const { isOpen, closeSheet } = useCreateRequirement();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeWorkspaceId, workspaces } = useWorkspace();

  const [workspaceId, setWorkspaceId] = useState(
    activeWorkspaceId !== 'all' ? activeWorkspaceId : 'default'
  );

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => fetchProjects(workspaceId),
  });

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [userStory, setUserStory] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Synchronize workspace when opening or workspace changes
  useEffect(() => {
    if (activeWorkspaceId !== 'all') {
      setWorkspaceId(activeWorkspaceId);
    }
  }, [activeWorkspaceId, isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeSheet();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeSheet]);

  const resetForm = () => {
    setTitle('');
    setGoal('');
    setUserStory('');
    setPriority('normal');
    setSelectedProjects([]);
    setCriteria(['']);
  };

  const handleClose = () => {
    resetForm();
    closeSheet();
  };

  const toggleProject = (name: string) => {
    setSelectedProjects((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  };

  const addCriterion = () => setCriteria([...criteria, '']);
  const updateCriterion = (index: number, val: string) => {
    const next = [...criteria];
    next[index] = val;
    setCriteria(next);
  };
  const removeCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
  };

  const handleSubmit = async (andStart: boolean) => {
    if (!title.trim() || !goal.trim()) {
      toast.error('Title and Goal are required');
      return;
    }
    const filteredCriteria = criteria.filter((c) => c.trim().length > 0);
    if (filteredCriteria.length === 0) {
      toast.error('At least one acceptance criterion is required');
      return;
    }
    if (selectedProjects.length === 0) {
      toast.error('Please select at least one affected project');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createRequirement({
        workspace_id: workspaceId,
        title,
        goal,
        user_story: userStory || undefined,
        priority,
        affected_projects: selectedProjects,
        acceptance_criteria: filteredCriteria,
      });

      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      handleClose();

      toast.success(`Created ${created.id}: ${created.title}`, {
        action: {
          label: 'View Spec',
          onClick: () => navigate(`/requirements/${created.id}`),
        },
      });

      if (andStart) {
        await startRequirementFanOut(created.id);
        queryClient.invalidateQueries({ queryKey: ['requirements'] });
        toast.success(`Fanned out to ${selectedProjects.join(', ')}`);
        navigate(`/requirements/${created.id}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create requirement');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300"
        onClick={handleClose}
      />

      <div className="fixed inset-y-0 right-0 pl-10 max-w-full flex">
        {/* Slide-over Right Sheet */}
        <div className="w-screen max-w-2xl bg-white dark:bg-[#16171d] shadow-2xl border-l border-slate-200 dark:border-[#262732] flex flex-col transform transition-transform duration-300 ease-out animate-in slide-in-from-right">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/70 dark:bg-[#1a1b23]/70">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] flex items-center justify-center font-black text-white text-sm shadow-md shadow-purple-500/20">
                ⚡
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                  New Cross-Repo Requirement
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Slide-over specification sheet
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Workspace Picker */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-200/80 dark:bg-[#23242e] border border-slate-300 dark:border-[#2d2f3d] text-xs">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Workspace:</span>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id} className="bg-white dark:bg-[#1e1f26] text-slate-800 dark:text-slate-100">
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Close Button */}
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#262733] transition-colors"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Form Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Shared Workspace Rules & Architecture Context Notification */}
            {currentWorkspace && (currentWorkspace.rules || currentWorkspace.context) && (
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 flex items-start gap-2.5 text-xs">
                <BookOpen className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                <div className="text-slate-700 dark:text-slate-300">
                  <span className="font-bold text-purple-700 dark:text-purple-300">
                    Workspace Shared Context Active:
                  </span>{' '}
                  This requirement will automatically encapsulate {currentWorkspace.name}&apos;s architectural guidelines and shared rules during agent fan-out.
                </div>
              </div>
            )}

            {/* Title Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>Requirement Title *</span>
                <span className="text-[11px] font-normal text-slate-400">Keep it clear and actionable</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Rider can see nearby drivers on live map"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* Priority & Status Bar */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Priority
              </label>
              <div className="flex flex-wrap gap-2">
                {priorityOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                      priority === opt.value
                        ? 'bg-white dark:bg-[#23242e] border-purple-400 dark:border-purple-600 shadow-sm text-slate-900 dark:text-white ring-1 ring-purple-400'
                        : 'border-slate-200 dark:border-[#2a2b36] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#20212a]'
                    }`}
                  >
                    <Flag className={`w-3.5 h-3.5 ${opt.color}`} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Affected Projects / Repositories */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <FolderGit2 className="w-3.5 h-3.5" />
                  <span>Affected Repositories / Engines *</span>
                </label>
                <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">
                  {selectedProjects.length} selected
                </span>
              </div>

              {projects.length === 0 ? (
                <div className="p-3.5 rounded-lg border border-dashed border-slate-200 dark:border-[#2e303d] text-center text-xs text-slate-500">
                  No projects registered in this workspace yet. Add projects in the Projects tab.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {projects.map((proj) => {
                    const isSelected = selectedProjects.includes(proj.name);
                    return (
                      <button
                        key={proj.name}
                        type="button"
                        onClick={() => toggleProject(proj.name)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'bg-purple-50/70 dark:bg-purple-950/30 border-[#7b68ee] text-purple-900 dark:text-purple-200 shadow-sm'
                            : 'border-slate-200 dark:border-[#2a2b36] bg-slate-50/60 dark:bg-[#1a1b22] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-[#353745]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-bold text-xs truncate flex items-center gap-1.5">
                            <span>{proj.name}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded font-mono font-medium bg-slate-200 dark:bg-[#252632] text-slate-600 dark:text-slate-400">
                              {proj.engine_type}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                            {proj.repo_path}
                          </div>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-[#7b68ee] border-[#7b68ee] text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Goal & Problem Statement */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Goal & Problem Context *
              </label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                placeholder="What problem are we solving? Explain the business context and technical background for the autonomous agents."
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* User Story (Optional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>User Story (Optional)</span>
                <span className="text-[11px] font-normal text-slate-400">As a... I want... So that...</span>
              </label>
              <input
                type="text"
                value={userStory}
                onChange={(e) => setUserStory(e.target.value)}
                placeholder="As a rider, I want to see real-time drivers so I can book immediately."
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* Acceptance Criteria */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>Acceptance Criteria *</span>
                </label>
                <button
                  type="button"
                  onClick={addCriterion}
                  className="flex items-center gap-1 text-xs font-semibold text-[#7b68ee] hover:text-[#6c5ce7] transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Criterion</span>
                </button>
              </div>

              <div className="space-y-2">
                {criteria.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-slate-400 dark:text-slate-500 w-5 text-right">
                      {idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={item}
                      onChange={(e) => updateCriterion(idx, e.target.value)}
                      placeholder="e.g. GET /drivers/nearby returns list of lat/lng coordinates"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
                    />
                    {criteria.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCriterion(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sticky Bottom Actions */}
          <div className="p-4 border-t border-slate-200 dark:border-[#262732] bg-slate-50/80 dark:bg-[#181920]/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#20212a] transition-all"
            >
              Cancel
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-purple-200 dark:border-purple-900/50 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-xs font-bold transition-all disabled:opacity-50"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Save Draft</span>
              </button>

              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white text-xs font-bold shadow-md shadow-purple-500/25 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span>Dispatching...</span>
                ) : (
                  <>
                    <span>Create & Fan-Out</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
