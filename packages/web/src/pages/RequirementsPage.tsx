import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchRequirements, fetchProjects } from '../lib/api.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import {
  Plus,
  ArrowRight,
  List,
  Kanban,
  Search,
  Flag,
  ChevronDown,
  ChevronRight,
  Filter,
  SlidersHorizontal,
  ArrowUpDown,
  X,
  FolderGit2,
  Check,
  RotateCcw,
  EyeOff,
  Eye,
} from 'lucide-react';
import { Priority, RequirementStatus } from '@sp-kickstack/shared';

const priorityConfig: Record<Priority, { color: string; label: string }> = {
  urgent: { color: 'text-rose-500 fill-rose-500', label: 'Urgent' },
  high: { color: 'text-amber-500 fill-amber-500', label: 'High' },
  normal: { color: 'text-blue-500 fill-blue-500', label: 'Normal' },
  low: { color: 'text-slate-400 fill-slate-400', label: 'Low' },
};

type GroupByOption = 'status' | 'priority' | 'project';
type SortByOption = 'newest' | 'oldest' | 'title' | 'priority';

export function RequirementsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { openSheet } = useCreateRequirement();
  
  // View states
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Filter options state
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<RequirementStatus[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [hideDone, setHideDone] = useState(false);

  // Group & Sort state
  const [groupBy, setGroupBy] = useState<GroupByOption>('status');
  const [sortBy, setSortBy] = useState<SortByOption>('newest');

  // Queries
  const { data: requirements = [], isLoading } = useQuery({
    queryKey: ['requirements', activeWorkspaceId],
    queryFn: () => fetchRequirements(activeWorkspaceId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
  });

  // Available project names for filtering
  const allProjectNames = useMemo(() => {
    const fromProjects = projects.map((p) => p.name);
    const fromReqs = requirements.flatMap((r) => r.affected_projects);
    return Array.from(new Set([...fromProjects, ...fromReqs])).sort();
  }, [projects, requirements]);

  // Active filter count
  const activeFilterCount =
    selectedStatuses.length +
    selectedPriorities.length +
    selectedProjects.length +
    (hideDone ? 1 : 0);

  // Filter and Sort requirements
  const filteredRequirements = useMemo(() => {
    let list = [...requirements];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.affected_projects.some((p) => p.toLowerCase().includes(q))
      );
    }

    // Hide Done
    if (hideDone) {
      list = list.filter((r) => r.status !== 'done');
    }

    // Status multi-filter
    if (selectedStatuses.length > 0) {
      list = list.filter((r) => selectedStatuses.includes(r.status));
    }

    // Priority multi-filter
    if (selectedPriorities.length > 0) {
      list = list.filter((r) => selectedPriorities.includes(r.priority));
    }

    // Project multi-filter
    if (selectedProjects.length > 0) {
      list = list.filter((r) =>
        r.affected_projects.some((p) => selectedProjects.includes(p))
      );
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'priority') {
        const rank: Record<Priority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
        return (rank[b.priority] || 0) - (rank[a.priority] || 0);
      }
      return 0;
    });

    return list;
  }, [
    requirements,
    searchQuery,
    hideDone,
    selectedStatuses,
    selectedPriorities,
    selectedProjects,
    sortBy,
  ]);

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleStatusFilter = (st: RequirementStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]
    );
  };

  const togglePriorityFilter = (pr: Priority) => {
    setSelectedPriorities((prev) =>
      prev.includes(pr) ? prev.filter((p) => p !== pr) : [...prev, pr]
    );
  };

  const toggleProjectFilter = (proj: string) => {
    setSelectedProjects((prev) =>
      prev.includes(proj) ? prev.filter((p) => p !== proj) : [...prev, proj]
    );
  };

  const clearAllFilters = () => {
    setSelectedStatuses([]);
    setSelectedPriorities([]);
    setSelectedProjects([]);
    setHideDone(false);
    setSearchQuery('');
  };

  // Group Definitions based on `groupBy`
  const groups = useMemo(() => {
    if (groupBy === 'priority') {
      return [
        {
          id: 'urgent',
          title: 'URGENT',
          color: 'bg-rose-500',
          match: (r: any) => r.priority === 'urgent',
        },
        {
          id: 'high',
          title: 'HIGH PRIORITY',
          color: 'bg-amber-500',
          match: (r: any) => r.priority === 'high',
        },
        {
          id: 'normal',
          title: 'NORMAL PRIORITY',
          color: 'bg-blue-500',
          match: (r: any) => r.priority === 'normal',
        },
        {
          id: 'low',
          title: 'LOW PRIORITY',
          color: 'bg-slate-400',
          match: (r: any) => r.priority === 'low',
        },
      ];
    }

    if (groupBy === 'project') {
      const activeProjNames =
        allProjectNames.length > 0 ? allProjectNames : ['default-project'];
      return activeProjNames.map((proj) => ({
        id: proj,
        title: proj.toUpperCase(),
        color: 'bg-purple-500',
        match: (r: any) => r.affected_projects.includes(proj),
      }));
    }

    // Default: group by status
    return [
      {
        id: 'draft',
        title: 'TO DO / DRAFT',
        color: 'bg-slate-500',
        match: (r: any) => r.status === 'draft',
      },
      {
        id: 'ready',
        title: 'READY FOR DISPATCH',
        color: 'bg-sky-500',
        match: (r: any) => r.status === 'ready',
      },
      {
        id: 'in_progress',
        title: 'IN PROGRESS',
        color: 'bg-[#7b68ee]',
        match: (r: any) => r.status === 'in_progress',
      },
      {
        id: 'in_review',
        title: 'IN REVIEW',
        color: 'bg-blue-500',
        match: (r: any) => r.status === 'in_review',
      },
      {
        id: 'qa',
        title: 'QA / TESTING',
        color: 'bg-amber-400',
        match: (r: any) => r.status === 'qa',
      },
      {
        id: 'done',
        title: 'COMPLETE',
        color: 'bg-emerald-500',
        match: (r: any) => r.status === 'done',
      },
    ];
  }, [groupBy, allProjectNames]);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
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
          <button
            type="button"
            onClick={openSheet}
            className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Requirement</span>
          </button>
        </div>
      </div>

      {/* ClickUp View & Filter Bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2.5 p-1.5 rounded-xl bg-white dark:bg-[#16171d] border border-slate-200 dark:border-[#262732] shadow-sm">
          {/* Left: View Switchers (List / Board) */}
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

            <div className="h-4 w-[1px] bg-slate-200 dark:bg-[#2d2f3d] mx-1" />

            {/* Filter Toggle Button */}
            <button
              onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isFilterPanelOpen || activeFilterCount > 0
                  ? 'bg-purple-50 dark:bg-purple-950/40 text-[#7b68ee] dark:text-purple-300 border border-purple-200 dark:border-purple-800/60'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#20212c] border border-transparent'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-[#7b68ee] text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Hide Done Quick Toggle */}
            <button
              onClick={() => setHideDone(!hideDone)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                hideDone
                  ? 'bg-slate-100 dark:bg-[#242531] text-slate-800 dark:text-slate-200 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#20212c]'
              }`}
              title="Toggle completed requirements"
            >
              {hideDone ? (
                <EyeOff className="w-3.5 h-3.5 text-purple-500" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span>{hideDone ? 'Done Hidden' : 'Show Done'}</span>
            </button>
          </div>

          {/* Right: Group, Sort & Search */}
          <div className="flex items-center gap-2">
            {/* Group By Select */}
            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <SlidersHorizontal className="w-3 h-3 text-slate-400" />
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
                className="bg-transparent font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer pr-1"
              >
                <option value="status" className="bg-white dark:bg-[#1e1f26]">Group: Status</option>
                <option value="priority" className="bg-white dark:bg-[#1e1f26]">Group: Priority</option>
                <option value="project" className="bg-white dark:bg-[#1e1f26]">Group: Repo</option>
              </select>
            </div>

            {/* Sort By Select */}
            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <ArrowUpDown className="w-3 h-3 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortByOption)}
                className="bg-transparent font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer pr-1"
              >
                <option value="newest" className="bg-white dark:bg-[#1e1f26]">Sort: Newest</option>
                <option value="oldest" className="bg-white dark:bg-[#1e1f26]">Sort: Oldest</option>
                <option value="title" className="bg-white dark:bg-[#1e1f26]">Sort: Name (A-Z)</option>
                <option value="priority" className="bg-white dark:bg-[#1e1f26]">Sort: Priority</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-7 py-1 bg-slate-100 dark:bg-[#20212c] border border-slate-200 dark:border-[#2e303d] rounded-lg text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-[#7b68ee] w-36 sm:w-52"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ClickUp Dedicated Filter Options Drawer / Popover Panel */}
        {(isFilterPanelOpen || activeFilterCount > 0) && (
          <div className="p-3.5 rounded-xl bg-white dark:bg-[#16171d] border border-purple-100 dark:border-[#262732] shadow-sm space-y-3 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#22232e] pb-2">
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-[#7b68ee]" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                  Filter Options
                </span>
                {activeFilterCount > 0 && (
                  <span className="text-[11px] text-slate-400">
                    ({activeFilterCount} active)
                  </span>
                )}
              </div>

              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear All Filters</span>
                </button>
              )}
            </div>

            {/* Filter Criteria Rows */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Status Multi-Filter */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Status
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(['draft', 'ready', 'in_progress', 'in_review', 'qa', 'done'] as RequirementStatus[]).map((st) => {
                    const active = selectedStatuses.includes(st);
                    return (
                      <button
                        key={st}
                        onClick={() => toggleStatusFilter(st)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                          active
                            ? 'bg-[#7b68ee] text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-[#20212c] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#282937]'
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}
                        <span className="uppercase">{st.replace('_', ' ')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Priority Multi-Filter */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Priority
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(['urgent', 'high', 'normal', 'low'] as Priority[]).map((pr) => {
                    const active = selectedPriorities.includes(pr);
                    const prio = priorityConfig[pr];
                    return (
                      <button
                        key={pr}
                        onClick={() => togglePriorityFilter(pr)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                          active
                            ? 'bg-[#7b68ee] text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-[#20212c] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#282937]'
                        }`}
                      >
                        <Flag className={`w-3 h-3 ${active ? 'fill-white text-white' : prio.color}`} />
                        <span>{prio.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Affected Repositories Multi-Filter */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Affected Repositories
                </span>
                {allProjectNames.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No repos registered</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {allProjectNames.map((proj) => {
                      const active = selectedProjects.includes(proj);
                      return (
                        <button
                          key={proj}
                          onClick={() => toggleProjectFilter(proj)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-mono text-[11px] font-semibold transition-all ${
                            active
                              ? 'bg-[#7b68ee] text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-[#20212c] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#282937]'
                          }`}
                        >
                          <FolderGit2 className="w-3 h-3" />
                          <span>{proj}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Active Filter Chips Summary */}
            {activeFilterCount > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-[#22232e] flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400">Active:</span>

                {hideDone && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[11px] font-medium">
                    Hide Done
                    <X className="w-3 h-3 cursor-pointer" onClick={() => setHideDone(false)} />
                  </span>
                )}

                {selectedStatuses.map((st) => (
                  <span
                    key={st}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[11px] font-medium uppercase"
                  >
                    Status: {st}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => toggleStatusFilter(st)} />
                  </span>
                ))}

                {selectedPriorities.map((pr) => (
                  <span
                    key={pr}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[11px] font-medium capitalize"
                  >
                    Priority: {pr}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => togglePriorityFilter(pr)} />
                  </span>
                ))}

                {selectedProjects.map((proj) => (
                  <span
                    key={proj}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[11px] font-medium"
                  >
                    Repo: {proj}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => toggleProjectFilter(proj)} />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="p-16 text-center text-slate-400 dark:text-slate-500 text-sm">
          Loading requirements...
        </div>
      ) : filteredRequirements.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-300 dark:border-[#2c2d38] rounded-2xl bg-white dark:bg-[#16171d]/60 shadow-sm">
          <p className="text-slate-500 dark:text-slate-400 mb-3 text-sm font-medium">
            {activeFilterCount > 0
              ? 'No requirements match your active filter options.'
              : 'No cross-repo requirements found in this workspace.'}
          </p>
          {activeFilterCount > 0 ? (
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-[#20212a] text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Filter Options</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={openSheet}
              className="inline-flex items-center gap-2 text-xs font-bold text-[#7b68ee] hover:text-[#6c5ce7]"
            >
              <span>Create your first requirement</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : viewMode === 'list' ? (
        /* ClickUp High-Density List View */
        <div className="space-y-4">
          {groups.map((group) => {
            const groupReqs = filteredRequirements.filter(group.match);
            const isCollapsed = collapsedGroups[group.id];

            return (
              <div
                key={group.id}
                className="bg-white dark:bg-[#16171d] rounded-xl border border-slate-200 dark:border-[#262732] overflow-hidden shadow-sm transition-all"
              >
                {/* Group Header */}
                <div
                  onClick={() => toggleGroup(group.id)}
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

                    {/* Table Footer Quick Add */}
                    <div className="px-4 py-2 bg-slate-50/30 dark:bg-[#14151b] border-t border-slate-100 dark:border-[#22232e]">
                      <button
                        type="button"
                        onClick={openSheet}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#7b68ee] dark:hover:text-[#a29bfe] font-semibold transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Task / Requirement</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ClickUp Kanban Board View */
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start">
          {groups.map((group) => {
            const groupReqs = filteredRequirements.filter(group.match);
            return (
              <div
                key={group.id}
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

                {/* Column Footer Quick Add */}
                <div className="p-2 border-t border-slate-100 dark:border-[#22232e]">
                  <button
                    type="button"
                    onClick={openSheet}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#20212a] font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Task</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
