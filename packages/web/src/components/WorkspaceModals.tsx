import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../lib/api.js';
import { toast } from 'sonner';
import { X, Plus, BookOpen, Save, Trash2, AlertTriangle, Sliders, ShieldAlert } from 'lucide-react';
import { AgentProfilePicker } from './AgentProfilePicker.js';
import type { ProfileValue } from '../lib/agentProfile.js';
import { Portal } from './ui/portal.js';
import type { Workspace } from '@sp-kickstack/shared';

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
    <Portal>
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
  </Portal>
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
  const [agent, setAgent] = useState<ProfileValue>({
    model: activeWorkspace?.agent_model ?? null,
    effort: activeWorkspace?.agent_effort ?? null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (activeWorkspace) {
      setRules(activeWorkspace.rules || '');
      setContext(activeWorkspace.context || '');
      setAgent({ model: activeWorkspace.agent_model ?? null, effort: activeWorkspace.agent_effort ?? null });
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
        agent_model: agent.model,
        agent_effort: agent.effort,
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
    <Portal>
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

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Default agent model & effort
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">A requirement or a task can choose its own</span>
            </div>
            <AgentProfilePicker
              value={agent}
              onChange={setAgent}
              defaultLabel="Engine default"
              className="w-full justify-between max-w-none px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg"
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
  </Portal>
  );
}

export interface EditWorkspaceModalProps {
  workspace: Workspace | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenDelete?: (workspace: Workspace) => void;
}

export function EditWorkspaceModal({ workspace, isOpen, onClose, onOpenDelete }: EditWorkspaceModalProps) {
  const { upsertWorkspace } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [context, setContext] = useState('');
  const [agent, setAgent] = useState<ProfileValue>({ model: null, effort: null });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (workspace) {
      setName(workspace.name || '');
      setDescription(workspace.description || '');
      setRules(workspace.rules || '');
      setContext(workspace.context || '');
      setAgent({
        model: workspace.agent_model ?? null,
        effort: workspace.agent_effort ?? null,
      });
    }
  }, [workspace]);

  if (!isOpen || !workspace) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Workspace Name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateWorkspace(workspace.id, {
        name: name.trim(),
        description: description.trim(),
        rules: rules.trim(),
        context: context.trim(),
        agent_model: agent.model,
        agent_effort: agent.effort,
      });
      toast.success(`Workspace "${updated.name}" updated`);
      upsertWorkspace(updated, false);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDefault = workspace.id === 'default';

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
        <div className="bg-white dark:bg-[#1e1f26] border border-slate-200 dark:border-[#2e303d] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/70 dark:bg-[#181920]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#6c5ce7] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                <Sliders className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Edit Workspace</h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 font-semibold">
                    {workspace.id}
                  </span>
                  {isDefault && (
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">View and update workspace settings, shared rules, and model profiles</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* Slug / ID Readonly Notice */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Workspace ID (Slug)
              </label>
              <input
                type="text"
                disabled
                value={workspace.id}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-[#14151b] border border-slate-200 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-500 dark:text-slate-400 cursor-not-allowed select-all"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                Unique identifier used in URLs (/w/{workspace.id}) and foreign keys. Read-only.
              </p>
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Workspace Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mobile & Core Services"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief purpose of this workspace"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
              />
            </div>

            {/* Shared Rules */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Shared Rules
                </label>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Inherited by AI engines on all tasks in this workspace</span>
              </div>
              <textarea
                rows={4}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="e.g. 1. All PRs must follow OpenAPI v3 spec. 2. Tests must pass before review."
                className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
              />
            </div>

            {/* Shared Architecture Context */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Shared Architecture Context
                </label>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Topology, ports, base endpoints, environments</span>
              </div>
              <textarea
                rows={4}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g. Backend: Go service on :8080. Mobile: Flutter client in /mobile. DB: Postgres on :5432."
                className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee] focus:ring-1 focus:ring-[#7b68ee]"
              />
            </div>

            {/* Default Agent Profile */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Default Agent Model & Reasoning Effort
                </span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Can be overridden on individual requirements</span>
              </div>
              <AgentProfilePicker
                value={agent}
                onChange={setAgent}
                defaultLabel="Engine default"
                className="w-full justify-between max-w-none px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg"
              />
            </div>

            {/* Timestamps */}
            {(workspace.created_at || workspace.updated_at) && (
              <div className="pt-2 text-[10px] text-slate-400 dark:text-slate-500 flex flex-wrap gap-4">
                {workspace.created_at && <span>Created: {new Date(workspace.created_at).toLocaleString()}</span>}
                {workspace.updated_at && <span>Updated: {new Date(workspace.updated_at).toLocaleString()}</span>}
              </div>
            )}

            {/* Danger Zone */}
            <div className="pt-4 border-t border-slate-200 dark:border-[#262732]">
              <div className="p-3.5 rounded-xl border border-rose-200/80 dark:border-rose-950/60 bg-rose-50/50 dark:bg-rose-950/20 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Delete Workspace</span>
                  </div>
                  <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-0.5">
                    {isDefault
                      ? 'The default workspace is required by the system and cannot be deleted.'
                      : 'Permanently remove this workspace and all its configurations.'}
                  </p>
                </div>
                {!isDefault && onOpenDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenDelete(workspace);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-colors shrink-0 cursor-pointer"
                  >
                    Delete Workspace
                  </button>
                )}
              </div>
            </div>

            {/* Modal Bottom Buttons */}
            <div className="pt-3 border-t border-slate-200 dark:border-[#262732] flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white shadow-md shadow-purple-600/20 flex items-center gap-1.5 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

export interface DeleteWorkspaceModalProps {
  workspace: Workspace | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeleteWorkspaceModal({ workspace, isOpen, onClose, onDeleted }: DeleteWorkspaceModalProps) {
  const { removeWorkspace } = useWorkspace();
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !workspace) return null;

  const isDefault = workspace.id === 'default';

  const handleDelete = async () => {
    if (isDefault) {
      toast.error('Cannot delete the default workspace');
      return;
    }

    setIsDeleting(true);
    try {
      await deleteWorkspace(workspace.id);
      removeWorkspace(workspace.id);
      toast.success(`Workspace "${workspace.name}" deleted`);
      onDeleted?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete workspace');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
        <div className="bg-white dark:bg-[#1e1f26] border border-slate-200 dark:border-[#2e303d] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-rose-50/70 dark:bg-rose-950/30">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">Delete Workspace</h3>
                <p className="text-[11px] text-rose-600 dark:text-rose-400">Irreversible action</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4 text-xs">
            {isDefault ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200">
                <p className="font-semibold">The default workspace cannot be deleted.</p>
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                  It is the core anchor workspace used for general projects and default requirements.
                </p>
              </div>
            ) : (
              <>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  Are you sure you want to delete workspace{' '}
                  <span className="font-bold text-slate-900 dark:text-white">&ldquo;{workspace.name}&rdquo;</span>{' '}
                  (<code className="font-mono text-purple-600 dark:text-purple-400">{workspace.id}</code>)?
                </p>

                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg text-rose-800 dark:text-rose-300 text-[11px] space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                    <span>Warning: Data Cascade</span>
                  </div>
                  <p>
                    All repositories, requirements, sprints, and shared rules scoped strictly to this workspace will be deleted or unassigned.
                  </p>
                </div>
              </>
            )}

            {/* Actions */}
            <div className="pt-3 border-t border-slate-200 dark:border-[#262732] flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors cursor-pointer"
              >
                {isDefault ? 'Close' : 'Cancel'}
              </button>
              {!isDefault && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 flex items-center gap-1.5 disabled:opacity-50 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeleting ? 'Deleting...' : 'Delete Workspace'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

