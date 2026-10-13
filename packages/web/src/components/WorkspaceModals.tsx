import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { createWorkspace, updateWorkspace, deleteWorkspace, fetchWorkspaceSummary } from '../lib/api.js';
import { toast } from 'sonner';
import {
  X,
  Plus,
  BookOpen,
  Save,
  Trash2,
  AlertTriangle,
  Sliders,
  ShieldAlert,
  Loader2,
  FolderGit2,
  FileCode,
  CheckCircle2,
  Layers,
  Database,
  Bot,
  HardDrive,
} from 'lucide-react';
import { AgentProfilePicker } from './AgentProfilePicker.js';
import type { ProfileValue } from '../lib/agentProfile.js';
import { Portal } from './ui/portal.js';
import type { Workspace, WorkspaceDataSummary } from '@sp-kickstack/shared';

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

type DeletionStage = 'confirm' | 'deleting' | 'done';

export function DeleteWorkspaceModal({ workspace, isOpen, onClose, onDeleted }: DeleteWorkspaceModalProps) {
  const { removeWorkspace } = useWorkspace();
  const [stage, setStage] = useState<DeletionStage>('confirm');
  const [confirmInput, setConfirmInput] = useState('');
  const [summary, setSummary] = useState<WorkspaceDataSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Progress animation state
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [deletedSummary, setDeletedSummary] = useState<WorkspaceDataSummary | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state when modal opens/closes or target workspace changes
  useEffect(() => {
    if (isOpen && workspace) {
      setStage('confirm');
      setConfirmInput('');
      setProgress(0);
      setStatusMessage('');
      setDeletedSummary(null);
      setSummary(null);
      setSummaryError(null);

      if (workspace.id !== 'default') {
        setIsLoadingSummary(true);
        fetchWorkspaceSummary(workspace.id)
          .then((data) => {
            setSummary(data);
          })
          .catch((err: any) => {
            setSummaryError(err.message || 'Failed to load workspace data preview');
          })
          .finally(() => {
            setIsLoadingSummary(false);
          });
      }
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, workspace?.id]);

  if (!isOpen || !workspace) return null;

  const isDefault = workspace.id === 'default';
  const isConfirmMatch = confirmInput.trim() === workspace.id;

  const totalItems = summary
    ? summary.projectsCount +
      summary.requirementsCount +
      summary.tasksCount +
      summary.sprintsCount +
      summary.assetsCount +
      summary.chatSessionsCount +
      summary.filesCount
    : 0;

  const handleDelete = async () => {
    if (isDefault) {
      toast.error('Cannot delete the default workspace');
      return;
    }

    if (!isConfirmMatch && totalItems > 0) {
      toast.error(`Please type "${workspace.id}" to confirm deletion`);
      return;
    }

    setStage('deleting');
    setProgress(15);
    setStatusMessage('Scanning workspace entities and attached storage...');

    // Progress simulation steps while API request runs
    let currentPct = 15;
    const progressInterval = setInterval(() => {
      currentPct += Math.floor(Math.random() * 12) + 5;
      if (currentPct < 40) {
        setProgress(currentPct);
        setStatusMessage('Scanning database entities and associated files...');
      } else if (currentPct < 70) {
        setProgress(currentPct);
        setStatusMessage('Purging physical markdown files and asset attachments on disk...');
      } else if (currentPct < 90) {
        setProgress(currentPct);
        setStatusMessage('Cascading database deletion across projects, requirements, tasks, and chats...');
      } else {
        setProgress(92);
        setStatusMessage('Finalizing workspace purge...');
      }
    }, 280);
    timerRef.current = progressInterval;

    try {
      const result = await deleteWorkspace(workspace.id);
      clearInterval(progressInterval);
      setProgress(100);
      setStatusMessage('Workspace and parent data deleted successfully');
      setDeletedSummary(result.summary || summary);
      setStage('done');

      removeWorkspace(workspace.id);
      toast.success(`Workspace "${workspace.name}" deleted`);

      // Auto close or notify after brief display
      setTimeout(() => {
        onDeleted?.();
      }, 1200);
    } catch (err: any) {
      clearInterval(progressInterval);
      setStage('confirm');
      setProgress(0);
      toast.error(err.message || 'Failed to delete workspace');
    }
  };

  const handleClose = () => {
    if (stage === 'deleting') return; // prevent closing during critical cascade
    onClose();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
        <div className="bg-white dark:bg-[#1e1f26] border border-slate-200 dark:border-[#2e303d] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-rose-50/70 dark:bg-rose-950/30">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  {stage === 'done' ? 'Workspace Deleted' : 'Delete Workspace & Cascade Data'}
                </h3>
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {stage === 'done'
                    ? 'All resources were purged successfully'
                    : 'Permanent cascading removal of all parent data'}
                </p>
              </div>
            </div>
            {stage !== 'deleting' && (
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282935] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="p-5 space-y-4 text-xs overflow-y-auto">
            {isDefault ? (
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200">
                <p className="font-semibold text-sm flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  The default workspace cannot be deleted.
                </p>
                <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  It serves as the root system anchor workspace used for default projects and requirements.
                </p>
              </div>
            ) : stage === 'confirm' ? (
              <>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  You are about to permanently delete workspace{' '}
                  <span className="font-bold text-slate-900 dark:text-white">&ldquo;{workspace.name}&rdquo;</span>{' '}
                  (<code className="font-mono text-purple-600 dark:text-purple-400 px-1 py-0.5 bg-purple-50 dark:bg-purple-950/50 rounded">{workspace.id}</code>).
                </p>

                {/* Data Cascade Impact Summary Box */}
                <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-rose-900 dark:text-rose-200 flex items-center gap-1.5 text-[12px]">
                      <ShieldAlert className="w-4 h-4 text-rose-600" />
                      <span>Data Cascade Impact Preview</span>
                    </div>
                    {isLoadingSummary && (
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Scanning...
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-rose-800/90 dark:text-rose-300/90 leading-relaxed">
                    Deleting this workspace will also permanently remove all of its parent projects, requirements, tasks, sprints, assets, and delete requirement markdown specs from the filesystem.
                  </p>

                  {/* Summary Grid */}
                  {summaryError ? (
                    <div className="text-[11px] text-rose-600 dark:text-rose-400 italic">
                      {summaryError}
                    </div>
                  ) : summary ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                      <div className="p-2 rounded-lg bg-white/70 dark:bg-[#181920] border border-rose-100 dark:border-rose-900/40 flex items-center gap-2">
                        <FolderGit2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Projects</div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">{summary.projectsCount}</div>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white/70 dark:bg-[#181920] border border-rose-100 dark:border-rose-900/40 flex items-center gap-2">
                        <FileCode className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Requirements</div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">{summary.requirementsCount}</div>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white/70 dark:bg-[#181920] border border-rose-100 dark:border-rose-900/40 flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Tasks</div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">{summary.tasksCount}</div>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white/70 dark:bg-[#181920] border border-rose-100 dark:border-rose-900/40 flex items-center gap-2">
                        <Database className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Sprints & Assets</div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">
                            {summary.sprintsCount + summary.assetsCount}
                          </div>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white/70 dark:bg-[#181920] border border-rose-100 dark:border-rose-900/40 flex items-center gap-2">
                        <Bot className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">AI Chats</div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">{summary.chatSessionsCount}</div>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white/70 dark:bg-[#181920] border border-rose-100 dark:border-rose-900/40 flex items-center gap-2">
                        <HardDrive className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Disk Files</div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">{summary.filesCount}</div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Type-to-confirm input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    To confirm deletion, type <code className="font-mono text-rose-600 dark:text-rose-400 font-bold">{workspace.id}</code> below:
                  </label>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={workspace.id}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </>
            ) : stage === 'deleting' ? (
              <div className="py-6 px-2 space-y-5 text-center">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-100 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 shadow-inner">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-1">
                    Deleting Workspace & Cascading Data...
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 min-h-[16px]">
                    {statusMessage}
                  </p>
                </div>

                {/* Animated Progress Bar */}
                <div className="space-y-1.5">
                  <div className="w-full bg-slate-100 dark:bg-[#14151b] h-2.5 rounded-full overflow-hidden border border-slate-200 dark:border-[#2e303d]">
                    <div
                      className="bg-gradient-to-r from-rose-500 to-amber-500 h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>Purging parent data</span>
                    <span>{progress}%</span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-lg text-left text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Please keep this window open while Kickstack safely removes files on disk and cleans database dependencies.
                  </span>
                </div>
              </div>
            ) : (
              /* Stage: done */
              <div className="py-6 px-2 space-y-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 shadow-sm">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-1">
                    Deletion Completed
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Workspace &ldquo;{workspace.name}&rdquo; and all associated data have been permanently purged.
                  </p>
                </div>

                {deletedSummary && (
                  <div className="p-3 bg-slate-50 dark:bg-[#181920] border border-slate-200 dark:border-[#2e303d] rounded-xl text-left text-[11px] space-y-1 text-slate-600 dark:text-slate-300 font-mono">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Purged Totals</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[11px]">
                      <div>Projects: <span className="font-bold text-slate-900 dark:text-white">{deletedSummary.projectsCount}</span></div>
                      <div>Requirements: <span className="font-bold text-slate-900 dark:text-white">{deletedSummary.requirementsCount}</span></div>
                      <div>Tasks: <span className="font-bold text-slate-900 dark:text-white">{deletedSummary.tasksCount}</span></div>
                      <div>Disk Files: <span className="font-bold text-slate-900 dark:text-white">{deletedSummary.filesCount}</span></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="pt-3 border-t border-slate-200 dark:border-[#262732] flex justify-end gap-2.5">
              {stage === 'confirm' ? (
                <>
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
                      disabled={isLoadingSummary || (totalItems > 0 && !isConfirmMatch)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Workspace & All Data
                    </button>
                  )}
                </>
              ) : stage === 'done' ? (
                <button
                  type="button"
                  onClick={() => {
                    onDeleted?.();
                    onClose();
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 transition-all cursor-pointer"
                >
                  Done
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

