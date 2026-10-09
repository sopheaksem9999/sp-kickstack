import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProjects, testProjectConnection } from '../lib/api.js';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  const testMutation = useMutation({
    mutationFn: (name: string) => testProjectConnection(name),
    onSuccess: (res, name) => {
      if (res.ok) {
        toast.success(`Connection to engine for ${name} verified`);
      } else {
        toast.error(`Engine for ${name} is unreachable`);
      }
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Connection test failed'),
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Projects & Engines</h2>
        <p className="text-sm text-slate-400">Connected repositories and per-repo agent engine runtimes</p>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-slate-500">Loading projects...</div>
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
                      <span className="w-2 h-2 rounded-full bg-slate-500"></span> Unknown
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-400 space-y-1 font-mono">
                <div>Engine: <span className="text-slate-200">{proj.engine_type}</span></div>
                <div>URL: <span className="text-blue-400">{proj.engine_url || 'local/manual'}</span></div>
                <div>Repo: <span className="text-slate-300">{proj.repo_path}</span></div>
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
    </div>
  );
}
