import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProjects, testProjectConnection } from '../lib/api.js';
import { Project, EngineType } from '@sp-kickstack/shared';
import { toast } from 'sonner';
import { RefreshCw, Plus, X } from 'lucide-react';

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'backend' | 'frontend' | 'mobile' | 'other'>('backend');
  const [repoPath, setRepoPath] = useState('');
  const [engineType, setEngineType] = useState<EngineType>('manual');
  const [engineUrl, setEngineUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [contractPath, setContractPath] = useState('');

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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Projects & Engines</h2>
          <p className="text-sm text-slate-400">Connected repositories and per-repo agent engine runtimes</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" /> Add Project
        </button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-slate-500">Loading projects...</div>
      ) : projects?.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-800 rounded-xl bg-slate-900/30">
          <p className="text-slate-400 mb-3">No projects registered yet.</p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-sm text-blue-400 hover:underline"
          >
            Register your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects?.map((proj) => (
            <div
              key={proj.name}
              className="border border-slate-800 rounded-xl p-5 bg-[#0d1322]/80 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white capitalize">{proj.name}</span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                    {proj.kind}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  {proj.engine_status === 'ok' ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Online
                    </span>
                  ) : proj.engine_status === 'down' ? (
                    <span className="text-rose-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span> Down
                    </span>
                  ) : (
                    <span className="text-slate-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-slate-500"></span> Ready ({proj.engine_type})
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-400 space-y-1 font-mono">
                <div>Engine: <span className="text-slate-200">{proj.engine_type}</span></div>
                <div>URL: <span className="text-blue-400">{proj.engine_url || 'local/manual'}</span></div>
                <div>Repo: <span className="text-slate-300">{proj.repo_path}</span></div>
                {proj.contract_path && (
                  <div>Contract: <span className="text-purple-400">{proj.contract_path}</span></div>
                )}
                <div>Done means: <span className="text-amber-400">{proj.done_means}</span></div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => testMutation.mutate(proj.name)}
                  disabled={testMutation.isPending}
                  className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition font-medium"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Test Connection
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-6 w-full max-w-lg space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Register New Project</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. backend"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Kind</label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="backend">backend</option>
                    <option value="frontend">frontend</option>
                    <option value="mobile">mobile</option>
                    <option value="other">other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Repository Path</label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/Users/sopheak/projects/my-repo"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Engine Type</label>
                  <select
                    value={engineType}
                    onChange={(e) => setEngineType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="manual">manual (human / simulated)</option>
                    <option value="stoneforge">stoneforge</option>
                    <option value="clinekanban">clinekanban</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Engine URL</label>
                  <input
                    type="text"
                    value={engineUrl}
                    onChange={(e) => setEngineUrl(e.target.value)}
                    placeholder="http://127.0.0.1:3457"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Base Branch</label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Contract Path (Optional)</label>
                  <input
                    type="text"
                    value={contractPath}
                    onChange={(e) => setContractPath(e.target.value)}
                    placeholder="api/openapi.yaml"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-3.5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 text-xs font-medium"
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
