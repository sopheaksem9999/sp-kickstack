import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  FolderGit2,
  Check,
  Search,
  BookOpen,
  Bot,
  ArrowRight,
} from 'lucide-react';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { fetchProjects } from '../lib/api.js';
import { Workspace } from '@sp-kickstack/shared';
import {
  CreateWorkspaceModal,
  EditWorkspaceModal,
  DeleteWorkspaceModal,
} from './WorkspaceModals.js';

export function WorkspacesSettingsSection() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => fetchProjects('all'),
  });

  const filteredWorkspaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (ws) =>
        ws.name.toLowerCase().includes(q) ||
        ws.id.toLowerCase().includes(q) ||
        ws.description?.toLowerCase().includes(q)
    );
  }, [workspaces, search]);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ff007f] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                <Building2 className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Workspaces Management
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300">
                {workspaces.length} Total
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Isolate repositories, shared architectural rules, and default AI model profiles across workspaces.
            </p>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white rounded-lg text-xs font-semibold shadow-md shadow-purple-600/20 transition-all cursor-pointer w-full sm:w-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Workspace</span>
            </button>
          </div>
        </div>

        {/* Filter input */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-[#2b2b2b]">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspaces by name, slug ID, or description..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#333333] rounded-lg text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-[#7b68ee] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Workspaces Grid */}
      <div className="grid grid-cols-1 gap-4">
        {filteredWorkspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId;
          const isDefault = ws.id === 'default';
          const wsProjects = projects.filter(
            (p) => (p.workspace_id || 'default') === ws.id
          );
          const rulesLineCount = ws.rules
            ? ws.rules.split('\n').filter((l) => l.trim().length > 0).length
            : 0;

          return (
            <div
              key={ws.id}
              className={`bg-white dark:bg-[#242424] border rounded-2xl p-5 shadow-xs transition-all ${
                isActive
                  ? 'border-purple-300 dark:border-purple-800/80 ring-1 ring-purple-400/20'
                  : 'border-slate-200 dark:border-[#2d2d2d] hover:border-slate-300 dark:hover:border-[#3a3a3a]'
              }`}
            >
              {/* Top row: Title, ID badge, Status badges */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-purple-100 dark:bg-purple-950/80 text-[#7b68ee]'
                        : 'bg-slate-100 dark:bg-[#2a2a2a] text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {ws.name}
                      </h3>
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#1a1a1a] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#333333]">
                        {ws.id}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          <span>Active</span>
                        </span>
                      )}
                      {isDefault && (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">
                          System Anchor
                        </span>
                      )}
                    </div>
                    {ws.description ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                        {ws.description}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic mt-1">
                        No description provided
                      </p>
                    )}
                  </div>
                </div>

                {/* Top Action Buttons: Switch Active, Edit, Delete */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => setActiveWorkspaceId(ws.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-50 dark:bg-purple-950/50 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-[#7b68ee] dark:text-purple-300 border border-purple-200 dark:border-purple-800/50 transition cursor-pointer"
                      title={`Switch active workspace to ${ws.name}`}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Set as Active</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setEditingWorkspace(ws)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-[#2b2b2b] hover:bg-slate-200 dark:hover:bg-[#363636] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#383838] transition cursor-pointer"
                    title={`View & Edit workspace ${ws.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span>View / Edit</span>
                  </button>

                  {!isDefault ? (
                    <button
                      type="button"
                      onClick={() => setDeletingWorkspace(ws)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50 transition cursor-pointer"
                      title={`Delete workspace ${ws.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <span
                      className="p-1.5 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                      title="Default workspace is protected from deletion"
                    >
                      <Trash2 className="w-4 h-4" />
                    </span>
                  )}
                </div>
              </div>

              {/* Middle row: Metadata Tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-[#2d2d2d] text-xs">
                {/* Repositories */}
                <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#1a1a1a] border border-slate-100 dark:border-[#2b2b2b]">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                    <span className="font-semibold text-[11px] uppercase tracking-wider flex items-center gap-1">
                      <FolderGit2 className="w-3 h-3 text-[#7b68ee]" />
                      Repositories
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {wsProjects.length}
                    </span>
                  </div>
                  {wsProjects.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {wsProjects.slice(0, 3).map((p) => (
                        <span
                          key={p.name}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-[#252525] border border-slate-200 dark:border-[#333333] text-slate-700 dark:text-slate-300"
                        >
                          {p.name}
                        </span>
                      ))}
                      {wsProjects.length > 3 && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 self-center">
                          +{wsProjects.length - 3} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                      No repositories linked
                    </p>
                  )}
                </div>

                {/* Shared Rules & Context */}
                <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#1a1a1a] border border-slate-100 dark:border-[#2b2b2b]">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                    <span className="font-semibold text-[11px] uppercase tracking-wider flex items-center gap-1">
                      <BookOpen className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      Shared Rules
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {rulesLineCount > 0 ? `${rulesLineCount} rules` : 'None'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                    {ws.rules ? ws.rules : 'No custom rules configured'}
                  </p>
                </div>

                {/* AI Agent Defaults */}
                <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#1a1a1a] border border-slate-100 dark:border-[#2b2b2b]">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                    <span className="font-semibold text-[11px] uppercase tracking-wider flex items-center gap-1">
                      <Bot className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                      Agent Profile
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {ws.agent_model || 'Engine Default'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Effort:{' '}
                    <span className="font-semibold capitalize text-slate-700 dark:text-slate-300">
                      {ws.agent_effort || 'Inherited'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {filteredWorkspaces.length === 0 && (
          <div className="p-8 text-center bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl">
            <Building2 className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              No workspaces found
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              Try adjusting your search criteria or create a new workspace.
            </p>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateWorkspaceModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <EditWorkspaceModal
        workspace={editingWorkspace}
        isOpen={!!editingWorkspace}
        onClose={() => setEditingWorkspace(null)}
        onOpenDelete={(ws) => {
          setEditingWorkspace(null);
          setDeletingWorkspace(ws);
        }}
      />

      <DeleteWorkspaceModal
        workspace={deletingWorkspace}
        isOpen={!!deletingWorkspace}
        onClose={() => setDeletingWorkspace(null)}
      />
    </div>
  );
}
