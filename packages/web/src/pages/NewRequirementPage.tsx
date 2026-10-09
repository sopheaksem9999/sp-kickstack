import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchProjects, createRequirement, startRequirementFanOut } from '../lib/api.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowLeft, BookOpen } from 'lucide-react';

export function NewRequirementPage() {
  const navigate = useNavigate();
  const { activeWorkspaceId, workspaces } = useWorkspace();
  const [workspaceId, setWorkspaceId] = useState(
    activeWorkspaceId !== 'all' ? activeWorkspaceId : 'default'
  );

  const { data: projects } = useQuery({
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
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/requirements')}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">New Cross-Repo Requirement</h2>
          <p className="text-sm text-slate-400">Define acceptance criteria and affected repositories</p>
        </div>
      </div>

      <div className="border border-slate-800 rounded-xl p-6 bg-[#0d1322]/80 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-800/80">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase font-mono">
              Target Workspace
            </label>
            <select
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setSelectedProjects([]);
              }}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-blue-500 text-sm font-semibold"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  📁 {ws.name} ({ws.id})
                </option>
              ))}
            </select>
          </div>

          {currentWorkspace && (currentWorkspace.rules || currentWorkspace.context) && (
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Active Workspace Shared Rules:</span>
              </div>
              {currentWorkspace.rules && (
                <p className="text-slate-300 font-mono text-[11px] line-clamp-2">
                  {currentWorkspace.rules}
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase font-mono">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Rider can view nearby drivers"
            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase font-mono">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-blue-500 text-sm"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase font-mono">
              Affected Repositories
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              {projects?.map((proj) => (
                <button
                  key={proj.name}
                  type="button"
                  onClick={() => toggleProject(proj.name)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition ${
                    selectedProjects.includes(proj.name)
                      ? 'bg-blue-600/30 text-blue-300 border-blue-500 font-semibold'
                      : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  {proj.name} ({proj.engine_type})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase font-mono">Goal</label>
          <textarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Describe the overall feature goal..."
            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase font-mono">
            User Story (Optional)
          </label>
          <textarea
            rows={2}
            value={userStory}
            onChange={(e) => setUserStory(e.target.value)}
            placeholder="As a rider, I want to see nearby vehicles so that I can estimate arrival time..."
            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-slate-300 uppercase font-mono">
              Acceptance Criteria
            </label>
            <button
              type="button"
              onClick={addCriterion}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Criterion
            </button>
          </div>
          <div className="space-y-2">
            {criteria.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => updateCriterion(idx, e.target.value)}
                  placeholder={`Criterion #${idx + 1}`}
                  className="flex-1 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
                />
                {criteria.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCriterion(idx)}
                    className="p-2 text-slate-500 hover:text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(false)}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition"
          >
            Save Draft
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition shadow-lg shadow-blue-600/20"
          >
            Create & Start Fan-Out
          </button>
        </div>
      </div>
    </div>
  );
}
