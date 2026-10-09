import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchProjects, createRequirement, startRequirementFanOut } from '../lib/api.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowLeft, BookOpen, Sparkles } from 'lucide-react';

export function NewRequirementPage() {
  const navigate = useNavigate();
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
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (activeWorkspaceId !== 'all') {
      setWorkspaceId(activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

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

      toast.success(`Created ${created.id}`);

      if (andStart) {
        await startRequirementFanOut(created.id);
        toast.success(`Fanned out to ${selectedProjects.join(', ')}`);
      }

      navigate(`/requirements/${created.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create requirement');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ClickUp Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/requirements')}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#20212c] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
            <span>Authoring Spec</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            New Cross-Repo Requirement
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Define acceptance criteria and affected repositories
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-6 shadow-sm space-y-6 transition-colors">
        {/* Workspace Selection & Shared Rules Header */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-200 dark:border-[#262732]">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Target Workspace
            </label>
            <select
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setSelectedProjects([]);
              }}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:border-[#7b68ee] text-xs"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  📁 {ws.name} ({ws.id})
                </option>
              ))}
            </select>
          </div>

          {currentWorkspace && (currentWorkspace.rules || currentWorkspace.context) && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Workspace Shared Guidelines:</span>
              </div>
              {currentWorkspace.rules && (
                <p className="text-slate-700 dark:text-slate-300 font-mono text-[11px] line-clamp-2">
                  {currentWorkspace.rules}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            Requirement Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Rider can view nearby drivers on real-time map"
            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#7b68ee] text-sm"
          />
        </div>

        {/* Priority & Affected Repos */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] text-xs font-semibold"
            >
              <option value="low">Low Priority</option>
              <option value="normal">Normal Priority</option>
              <option value="high">High Priority</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Affected Repositories *
            </label>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {projects.length === 0 ? (
                <span className="text-xs text-slate-400 italic">No projects found in this workspace</span>
              ) : (
                projects.map((proj) => (
                  <button
                    key={proj.name}
                    type="button"
                    onClick={() => toggleProject(proj.name)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition ${
                      selectedProjects.includes(proj.name)
                        ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700 font-bold shadow-sm'
                        : 'bg-slate-50 dark:bg-[#14151b] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-[#2e303d] hover:border-slate-300'
                    }`}
                  >
                    {proj.name} ({proj.engine_type})
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Goal */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            Goal (What are we building and why?) *
          </label>
          <textarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Describe the primary outcome and business goal..."
            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#7b68ee] text-xs"
          />
        </div>

        {/* User Story */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            User Story (Optional)
          </label>
          <textarea
            rows={2}
            value={userStory}
            onChange={(e) => setUserStory(e.target.value)}
            placeholder="As a [rider], I want [to see real-time cars on map] so that [I know pickup ETA]..."
            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#7b68ee] text-xs"
          />
        </div>

        {/* Acceptance Criteria */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Acceptance Criteria (Checklist) *
            </label>
            <button
              type="button"
              onClick={addCriterion}
              className="text-xs text-[#7b68ee] hover:underline font-bold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Criterion</span>
            </button>
          </div>

          <div className="space-y-2">
            {criteria.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => updateCriterion(idx, e.target.value)}
                  placeholder={`Criterion ${idx + 1}`}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#7b68ee] text-xs"
                />
                {criteria.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCriterion(idx)}
                    className="p-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-[#20212c] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-slate-200 dark:border-[#262732] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 dark:bg-[#20212c] hover:bg-slate-200 dark:hover:bg-[#2a2b38] text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50"
          >
            Save as Draft
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Save & Fan-Out Now</span>
          </button>
        </div>
      </div>
    </div>
  );
}
