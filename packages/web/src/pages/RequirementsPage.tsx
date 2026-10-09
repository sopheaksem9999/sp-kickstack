import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchRequirements } from '../lib/api.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import {
  Plus,
  ArrowRight,
  List,
  Kanban,
  Search,
  Flag,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Priority, RequirementStatus } from '@sp-kickstack/shared';

const priorityConfig: Record<Priority, { color: string; label: string }> = {
  urgent: { color: 'text-rose-500 fill-rose-500', label: 'Urgent' },
  high: { color: 'text-amber-500 fill-amber-500', label: 'High' },
  normal: { color: 'text-blue-500 fill-blue-500', label: 'Normal' },
  low: { color: 'text-slate-400 fill-slate-400', label: 'Low' },
};

export function RequirementsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const { data: requirements = [], isLoading } = useQuery({
    queryKey: ['requirements', activeWorkspaceId],
    queryFn: () => fetchRequirements(activeWorkspaceId),
  });

  const filteredRequirements = useMemo(() => {
    if (!searchQuery.trim()) return requirements;
    const q = searchQuery.toLowerCase();
    return requirements.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.affected_projects.some((p) => p.toLowerCase().includes(q))
    );
  }, [requirements, searchQuery]);

  const toggleGroup = (status: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  const statusGroups: { status: RequirementStatus; title: string; color: string }[] = [
    { status: 'draft', title: 'TO DO / DRAFT', color: 'bg-slate-500' },
    { status: 'ready', title: 'READY FOR DISPATCH', color: 'bg-sky-500' },
    { status: 'in_progress', title: 'IN PROGRESS', color: 'bg-[#7b68ee]' },
    { status: 'in_review', title: 'IN REVIEW', color: 'bg-blue-500' },
    { status: 'done', title: 'COMPLETE', color: 'bg-emerald-500' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* ClickUp Title & Top Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
            <span>Tasks & Specs</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Cross-Repo Requirements
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Centrally authored specs fanning out to per-repo agent engines
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            to="/requirements/new"
            className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Requirement</span>
          </Link>
        </div>
      </div>

      {/* ClickUp View Bar (Tabs + Search + Filter) */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-1.5 rounded-xl bg-white dark:bg-[#16171d] border border-slate-200 dark:border-[#262732] shadow-sm">
        {/* View Switchers */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'list'
                ? 'bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#20212c]'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>List</span>
          </button>

          <button
            onClick={() => setViewMode('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'board'
                ? 'bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#20212c]'
            }`}
          >
            <Kanban className="w-3.5 h-3.5" />
            <span>Board</span>
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search requirements..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 bg-slate-100 dark:bg-[#20212c] border border-slate-200 dark:border-[#2e303d] rounded-lg text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-[#7b68ee] w-48 sm:w-60"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-16 text-center text-slate-400 dark:text-slate-500 text-sm">
          Loading requirements...
        </div>
      ) : filteredRequirements.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-300 dark:border-[#2c2d38] rounded-2xl bg-white dark:bg-[#16171d]/60 shadow-sm">
          <p className="text-slate-500 dark:text-slate-400 mb-3 text-sm font-medium">
            No requirements found for this workspace.
          </p>
          <Link
            to="/requirements/new"
            className="text-xs font-bold text-[#7b68ee] hover:underline inline-flex items-center gap-1"
          >
            Create your first requirement <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : viewMode === 'list' ? (
        /* ClickUp Grouped List View */
        <div className="space-y-6">
          {statusGroups.map((group) => {
            const groupReqs = filteredRequirements.filter((r) => r.status === group.status);
            if (groupReqs.length === 0) return null;
            const isCollapsed = collapsedGroups[group.status];

            return (
              <div
                key={group.status}
                className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-xl overflow-hidden shadow-sm transition-colors"
              >
                {/* Group Status Header */}
                <div
                  onClick={() => toggleGroup(group.status)}
                  className="px-4 py-2.5 bg-slate-50/80 dark:bg-[#1c1d27] border-b border-slate-200 dark:border-[#262732] flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                    <span className={`w-2 h-2 rounded-full ${group.color}`} />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      {group.title}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold">
                      {groupReqs.length}
                    </span>
                  </div>
                </div>

                {/* Rows Table */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/50 dark:bg-[#16171e] text-slate-400 dark:text-slate-500 font-mono text-[10px] uppercase border-b border-slate-100 dark:border-[#22232e]">
                        <tr>
                          <th className="px-4 py-2 font-semibold">ID</th>
                          <th className="px-4 py-2 font-semibold">Name / Spec</th>
                          <th className="px-4 py-2 font-semibold">Workspace</th>
                          <th className="px-4 py-2 font-semibold">Priority</th>
                          <th className="px-4 py-2 font-semibold">Affected Projects</th>
                          <th className="px-4 py-2 font-semibold">Status</th>
                          <th className="px-4 py-2 font-semibold text-right">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-[#242531]">
                        {groupReqs.map((req) => {
                          const prio = priorityConfig[req.priority] || priorityConfig.normal;
                          return (
                            <tr
                              key={req.id}
                              className="hover:bg-purple-50/40 dark:hover:bg-[#20212c] transition-colors group"
                            >
                              <td className="px-4 py-3 font-mono font-bold text-[#7b68ee]">
                                <Link
                                  to={`/requirements/${req.id}`}
                                  className="hover:underline"
                                >
                                  {req.id}
                                </Link>
                              </td>
                              <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                                <Link
                                  to={`/requirements/${req.id}`}
                                  className="hover:text-[#7b68ee] transition-colors"
                                >
                                  {req.title}
                                </Link>
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60">
                                  📁 {req.workspace_id || 'default'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5" title={`Priority: ${prio.label}`}>
                                  <Flag className={`w-3.5 h-3.5 ${prio.color}`} />
                                  <span className="capitalize text-slate-600 dark:text-slate-400 font-medium text-[11px]">
                                    {prio.label}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {req.affected_projects.map((proj) => (
                                    <span
                                      key={proj}
                                      className="px-2 py-0.5 rounded font-mono text-[10px] font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40"
                                    >
                                      {proj}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={req.status} size="xs" />
                              </td>
                              <td className="px-4 py-3 font-mono text-[11px] text-slate-400 text-right">
                                {new Date(req.created_at).toLocaleDateString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ClickUp Kanban Board View */
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start">
          {statusGroups.map((group) => {
            const groupReqs = filteredRequirements.filter((r) => r.status === group.status);
            return (
              <div
                key={group.status}
                className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-xl flex flex-col max-h-[80vh] shadow-sm overflow-hidden"
              >
                {/* Column Header */}
                <div className="p-3 border-b border-slate-200 dark:border-[#262732] bg-slate-50/70 dark:bg-[#1c1d27] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${group.color}`} />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {group.title}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {groupReqs.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="p-2 space-y-2 overflow-y-auto flex-1">
                  {groupReqs.map((req) => {
                    const prio = priorityConfig[req.priority] || priorityConfig.normal;
                    return (
                      <Link
                        key={req.id}
                        to={`/requirements/${req.id}`}
                        className="block p-3 rounded-lg bg-slate-50 dark:bg-[#1f202b] hover:bg-purple-50/50 dark:hover:bg-[#252736] border border-slate-200 dark:border-[#2e303d] shadow-sm transition-all group"
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
                          <span className="text-[#7b68ee] font-bold">{req.id}</span>
                          <span className="flex items-center gap-1 text-[10px]">
                            <Flag className={`w-3 h-3 ${prio.color}`} />
                            <span className="capitalize">{prio.label}</span>
                          </span>
                        </div>

                        <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 group-hover:text-[#7b68ee] transition-colors mb-2 line-clamp-2">
                          {req.title}
                        </div>

                        <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-200 dark:border-[#2b2c3a]">
                          {req.affected_projects.map((proj) => (
                            <span
                              key={proj}
                              className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                            >
                              {proj}
                            </span>
                          ))}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
