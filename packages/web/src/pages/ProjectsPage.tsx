import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProjects, testProjectConnection } from '../lib/api.js';
import { Project, EngineType } from '@sp-kickstack/shared';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { toast } from 'sonner';
import { RefreshCw, Plus, X, FolderGit2 } from 'lucide-react';

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { activeWorkspaceId, workspaces } = useWorkspace();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(
    activeWorkspaceId !== 'all' ? activeWorkspaceId : 'default'
  );
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'backend' | 'frontend' | 'mobile' | 'other'>('backend');
  const [repoPath, setRepoPath] = useState('');
  const [engineType, setEngineType] = useState<EngineType>('manual');
  const [engineUrl, setEngineUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [contractPath, setContractPath] = useState('');

  useEffect(() => {
    if (activeWorkspaceId !== 'all') {
      setWorkspaceId(activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  const testMutation = useMutation({
    mutationFn: (projName: string) => testProjectConnection(projName),
    onSuccess: (res, projName) => {
      if (res.ok) {
        toast.success(`Connection to engine for ${projName} verified`);
      } else {
        toast.error(`Engine for ${projName} is unreachable`);
      }
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Connection test failed'),
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Partial<Project>) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create project');
      return res.json();
    },
    onSuccess: (created) => {
      toast.success(`Project ${created.name} registered`);
      setIsModalOpen(false);
      setName('');
      setRepoPath('');
      setEngineUrl('');
      setContractPath('');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create project'),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoPath.trim()) {
      toast.error('Name and Repository Path are required');
      return;
    }

    createMutation.mutate({
      name: name.trim().toLowerCase(),
      workspace_id: workspaceId || 'default',
      kind,
      repo_path: repoPath.trim(),
      engine_type: engineType,
      engine_url: engineUrl.trim() || undefined,
      base_branch: baseBranch.trim() || 'main',
      contract_path: contractPath.trim() || undefined,
      done_means: 'merged',
      enabled: true,
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ClickUp Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
            <span>Repositories & Engines</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Connected Projects & Agent Runtimes
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Decoupled per-repo agent engines orchestrated across workspaces
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Project</span>
        </button>
      </div>

      {isLoading ? (
        <div className="p-16 text-center text-slate-400 text-sm">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-300 dark:border-[#2c2d38] rounded-2xl bg-white dark:bg-[#16171d]/60 shadow-sm">
          <p className="text-slate-500 dark:text-slate-400 mb-3 text-sm font-medium">
            No projects registered in this workspace yet.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-xs font-bold text-[#7b68ee] hover:underline inline-flex items-center gap-1"
          >
            Register your first project <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((proj) => (
            <div
              key={proj.name}
              className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300 flex items-center justify-center font-bold">
                      <FolderGit2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white capitalize">
                        {proj.name}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {proj.kind}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40">
                          📁 {proj.workspace_id || 'default'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Engine Status Pill */}
                  <div>
                    {proj.engine_status === 'ok' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online
                      </span>
                    ) : proj.engine_status === 'down' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Down
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> {proj.engine_type}
                      </span>
                    )}
                  </div>
                </div>

                {/* Metadata List */}
                <div className="space-y-1.5 text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#14151b] p-3 rounded-lg border border-slate-100 dark:border-[#22232e]">
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-slate-500">Engine:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-semibold">{proj.engine_type}</span>
                  </div>
                  <div className="flex justify-between truncate">
                    <span className="text-slate-400 dark:text-slate-500">URL:</span>
                    <span className="text-[#7b68ee] truncate max-w-[170px]">{proj.engine_url || 'local/manual'}</span>
                  </div>
                  <div className="flex justify-between truncate">
                    <span className="text-slate-400 dark:text-slate-500">Repo:</span>
                    <span className="text-slate-700 dark:text-slate-300 truncate max-w-[170px]">{proj.repo_path}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-slate-500">Branch:</span>
                    <span className="text-slate-700 dark:text-slate-300">{proj.base_branch}</span>
                  </div>
                  {proj.contract_path && (
                    <div className="flex justify-between">
                      <span className="text-slate-400 dark:text-slate-500">Contract:</span>
                      <span className="text-purple-600 dark:text-purple-300 font-semibold">{proj.contract_path}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer Action */}
              <div className="pt-2 border-t border-slate-100 dark:border-[#242531] flex justify-end">
                <button
                  onClick={() => testMutation.mutate(proj.name)}
                  disabled={testMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-[#20212c] hover:bg-slate-200 dark:hover:bg-[#292a38] transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${testMutation.isPending ? 'animate-spin' : ''}`} />
                  <span>Test Connection</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1f26] border border-slate-200 dark:border-[#2e303d] rounded-2xl p-6 w-full max-w-lg space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#262732]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] text-white flex items-center justify-center font-bold text-xs">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Register New Project</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:border-[#7b68ee]"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      📁 {ws.name} ({ws.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. backend"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Kind
                  </label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="backend">backend</option>
                    <option value="frontend">frontend</option>
                    <option value="mobile">mobile</option>
                    <option value="other">other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Repository Path
                </label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/Users/sopheak/projects/my-repo"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine Type
                  </label>
                  <select
                    value={engineType}
                    onChange={(e) => setEngineType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="manual">manual (human / simulated)</option>
                    <option value="stoneforge">stoneforge</option>
                    <option value="clinekanban">clinekanban</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine URL
                  </label>
                  <input
                    type="text"
                    value={engineUrl}
                    onChange={(e) => setEngineUrl(e.target.value)}
                    placeholder="http://127.0.0.1:3457"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Base Branch
                  </label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Contract Path (Optional)
                  </label>
                  <input
                    type="text"
                    value={contractPath}
                    onChange={(e) => setContractPath(e.target.value)}
                    placeholder="api/openapi.yaml"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#14151b] border border-slate-300 dark:border-[#2e303d] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-[#262732] flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#292a38]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white shadow-md shadow-purple-600/20 disabled:opacity-50"
                >
                  Save Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
