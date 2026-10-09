import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { createWorkspace, updateWorkspace } from '../lib/api.js';
import { toast } from 'sonner';
import { X, Plus, BookOpen, Save } from 'lucide-react';

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateWorkspaceModal({ isOpen, onClose }: CreateWorkspaceModalProps) {
  const { upsertWorkspace } = useWorkspace();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [context, setContext] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    if (!idTouched) {
      setId(val.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32));
    }
  };

  const handleIdChange = (val: string) => {
    setIdTouched(true);
    setId(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const finalName = name.trim();

    if (!finalId || !finalName) {
      toast.error('Workspace ID and Name are required');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createWorkspace({
        id: finalId,
        name: finalName,
        description: description.trim() || undefined,
        rules: rules.trim() || undefined,
        context: context.trim() || undefined,
      });
      toast.success(`Workspace "${created.name}" created`);
      
      // Immediately inject into React Query cache & auto-switch active workspace
      upsertWorkspace(created, true);

      onClose();
      setId('');
      setName('');
      setIdTouched(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-[#1e1f26] border border-slate-200 dark:border-[#2e303d] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/70 dark:bg-[#181920]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ff007f] text-white flex items-center justify-center font-bold text-sm shadow-sm">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Create New Workspace</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Isolate projects and shared rules</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Workspace ID (slug) *
            </label>
            <input
              type="text"
              required
              placeholder="workspace-a"
              value={id}
              onChange={(e) => handleIdChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Workspace Name *
            </label>
            <input
              type="text"
              required
              placeholder="Workspace A (Mobile & Core API)"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Description
            </label>
            <input
              type="text"
              placeholder="Team workspace for Mobile and Backend projects"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Shared Rules (Shared across all projects in workspace)
            </label>
            <textarea
              rows={3}
              placeholder="e.g. All API PRs must follow OpenAPI v3 spec; 100% test pass required."
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Shared Context (Architecture overview, ports, endpoints)
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Backend: Go microservice on :8080. Mobile: Flutter client in /mobile."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-[#262732] flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white shadow-md shadow-purple-600/20 disabled:opacity-50 transition-all"
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
  const { activeWorkspace, upsertWorkspace } = useWorkspace();
  const [rules, setRules] = useState(activeWorkspace?.rules || '');
  const [context, setContext] = useState(activeWorkspace?.context || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
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
      const updated = await updateWorkspace(activeWorkspace.id, {
        rules,
        context,
      });
      toast.success('Workspace shared rules & context updated');
      upsertWorkspace(updated, false);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-[#1e1f26] border border-slate-200 dark:border-[#2e303d] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/70 dark:bg-[#181920]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm shadow-sm">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Shared Rules & Architecture Context</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Workspace: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{activeWorkspace.name}</span> ({activeWorkspace.id})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Shared Rules
              </label>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Inherited by all projects in this workspace</span>
            </div>
            <textarea
              rows={5}
              placeholder="e.g. 1. Tests must pass before PR. 2. API contracts in /specs. 3. Follow conventional commits."
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Shared Architecture & Topology
              </label>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Base URLs, database versions, conventions</span>
            </div>
            <textarea
              rows={5}
              placeholder="e.g. Architecture overview: Client apps interact with API gateway on :4100. Database is PostgreSQL 16."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-[#262732] flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 flex items-center gap-1.5 disabled:opacity-50 transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              {isSubmitting ? 'Saving...' : 'Save Rules & Context'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
