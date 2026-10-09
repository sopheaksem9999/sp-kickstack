import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchRequirements } from '../lib/api.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { Plus, ArrowRight, Clock } from 'lucide-react';

export function RequirementsPage() {
  const { data: requirements, isLoading } = useQuery({
    queryKey: ['requirements'],
    queryFn: fetchRequirements,
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Cross-Repo Requirements</h2>
          <p className="text-sm text-slate-400">Centrally authored specs fanning out to per-repo agent engines</p>
        </div>
        <Link
          to="/requirements/new"
          className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" />
          New Requirement
        </Link>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-slate-500">Loading requirements...</div>
      ) : requirements?.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-800 rounded-xl bg-slate-900/30">
          <p className="text-slate-400 mb-3">No requirements created yet.</p>
          <Link
            to="/requirements/new"
            className="text-sm text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Create your first requirement <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#0d1322]/80">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 text-xs uppercase font-mono">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Affected Projects</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {requirements?.map((req) => (
                <tr key={req.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium text-blue-400">
                    <Link to={`/requirements/${req.id}`} className="hover:underline">
                      {req.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-200">
                    <Link to={`/requirements/${req.id}`} className="hover:text-blue-400">
                      {req.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={req.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-xs font-mono text-slate-400">
                      {req.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {req.affected_projects?.map((p) => (
                        <span
                          key={p}
                          className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 font-mono border border-slate-700/60"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3" />
                    {new Date(req.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/requirements/${req.id}`}
                      className="text-xs font-medium text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                    >
                      View Board <ArrowRight className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
