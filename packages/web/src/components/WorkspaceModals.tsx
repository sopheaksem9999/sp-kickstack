import React, { useState } from 'react';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { createWorkspace, updateWorkspace } from '../lib/api.js';
import { toast } from 'sonner';
import { X, Plus, BookOpen, Save } from 'lucide-react';

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateWorkspaceModal({ isOpen, onClose }: CreateWorkspaceModalProps) {
  const { refreshWorkspaces, setActiveWorkspaceId } = useWorkspace();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [context, setContext] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim()) {
      toast.error('Workspace ID and Name are required');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createWorkspace({
        id: id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        name: name.trim(),
        description: description.trim() || undefined,
        rules: rules.trim() || undefined,
        context: context.trim() || undefined,
      });
      toast.success(`Workspace "${created.name}" created`);
      refreshWorkspaces();
      setActiveWorkspaceId(created.id);
      onClose();
      setId('');
      setName('');
      setDescription('');
      setRules('');
      setContext('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-sm">
              <Plus className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-white">Create New Workspace</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1">
              Workspace ID (e.g. workspace-a) *
            </label>
            <input
              type="text"
              required
              placeholder="workspace-a"
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1">
              Workspace Name *
            </label>
            <input
              type="text"
              required
              placeholder="Workspace A (Mobile & Core API)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1">
              Description
            </label>
            <input
              type="text"
              placeholder="Team workspace for Mobile and Backend projects"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1">
              Shared Workspace Rules (Shared across all projects in workspace)
            </label>
            <textarea
              rows={3}
              placeholder="e.g. All API PRs must follow OpenAPI v3 spec; 100% test pass required."
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1">
              Shared Workspace Context (Architecture, conventions, base URLs)
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Backend: Go microservice at :8080. Mobile: Flutter client in /mobile."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface WorkspaceRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkspaceRulesModal({ isOpen, onClose }: WorkspaceRulesModalProps) {
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();
  const [rules, setRules] = useState(activeWorkspace?.rules || '');
  const [context, setContext] = useState(activeWorkspace?.context || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync state if activeWorkspace changes
  React.useEffect(() => {
    if (activeWorkspace) {
      setRules(activeWorkspace.rules || '');
      setContext(activeWorkspace.context || '');
    }
  }, [activeWorkspace]);

  if (!isOpen || !activeWorkspace) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await updateWorkspace(activeWorkspace.id, {
        rules,
        context,
      });
      toast.success('Workspace shared rules & context updated');
      refreshWorkspaces();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Shared Rules & Context</h3>
              <p className="text-xs text-slate-400">
                Workspace: <span className="font-mono text-emerald-400 font-semibold">{activeWorkspace.name}</span> ({activeWorkspace.id})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-mono text-slate-300 uppercase font-semibold">
                Shared Rules
              </label>
              <span className="text-[11px] text-slate-500">Shared across all projects in this workspace</span>
            </div>
            <textarea
              rows={5}
              placeholder="e.g. 1. Tests must pass before PR. 2. API contracts in /specs. 3. Follow conventional commits."
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-mono text-slate-300 uppercase font-semibold">
                Shared Architecture & Context
              </label>
              <span className="text-[11px] text-slate-500">System overview, ports, database schemas</span>
            </div>
            <textarea
              rows={5}
              placeholder="e.g. Architecture overview: Client apps interact with API gateway on :4100. Database is PostgreSQL 16."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSubmitting ? 'Saving...' : 'Save Workspace Rules'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
