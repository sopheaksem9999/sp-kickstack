import { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRequirements,
  fetchProjects,
  fetchSprints,
  startSprint,
  completeSprint,
  assignRequirementSprint,
  updateRequirementStatus,
} from '../lib/api.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { CreateSprintModal } from '../components/CreateSprintModal.js';
import { RequirementDetailSheet } from '../components/RequirementDetailSheet.js';
import { toast } from 'sonner';
import {
  Plus,
  List,
  Kanban,
  Search,
  Flag,
  ChevronDown,
  ChevronRight,
  Filter,
  SlidersHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  RotateCcw,
  Zap,
  CheckCircle2,
  Calendar,
  Play,
  ExternalLink,
} from 'lucide-react';
import { Priority, RequirementStatus } from '@sp-kickstack/shared';

const priorityConfig: Record<Priority, { color: string; label: string }> = {
  urgent: { color: 'text-rose-500 fill-rose-500', label: 'Urgent' },
  high: { color: 'text-amber-500 fill-amber-500', label: 'High' },
  normal: { color: 'text-blue-500 fill-blue-500', label: 'Normal' },
  low: { color: 'text-slate-400 fill-slate-400', label: 'Low' },
};

type GroupByOption = 'none' | 'status' | 'priority' | 'project';
type SortField = 'id' | 'title' | 'priority' | 'status' | 'created_at';

export type ScrumTab = 'sprint' | 'backlog' | 'all';
export const VALID_SCRUM_TABS: ScrumTab[] = ['sprint', 'backlog', 'all'];

export function RequirementsPage() {
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const { openSheet } = useCreateRequirement();

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as ScrumTab | null;
  const initialTab: ScrumTab = rawTab && VALID_SCRUM_TABS.includes(rawTab) ? rawTab : 'sprint';

  // Scrum Tab & Sprint Modal State
  const [scrumTab, setScrumTab] = useState<ScrumTab>(initialTab);
  const [isCreateSprintOpen, setIsCreateSprintOpen] = useState(false);

  // Sync scrumTab with URL search params (supports back/forward browser history & direct links)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab') as ScrumTab | null;
    const resolvedTab = tabFromUrl && VALID_SCRUM_TABS.includes(tabFromUrl) ? tabFromUrl : 'sprint';
    if (resolvedTab !== scrumTab) {
      setScrumTab(resolvedTab);
    }
  }, [searchParams, scrumTab]);

  const handleTabChange = (newTab: ScrumTab) => {
    setScrumTab(newTab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', newTab);
        return next;
      },
      { replace: false }
    );
  };
  
  // View states - active Board by default
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board');
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const [draggedReqId, setDraggedReqId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const isDraggingJustEndedRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Filter options state
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<RequirementStatus[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [hideDone, setHideDone] = useState(false);

  // Group & Sort state
  const [groupBy, setGroupBy] = useState<GroupByOption>('none');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'created_at' || field === 'priority' ? 'desc' : 'asc');
    }
  };

  // Queries
  const { data: requirements = [], isLoading: reqsLoading } = useQuery({
    queryKey: ['requirements', activeWorkspaceId],
    queryFn: () => fetchRequirements(activeWorkspaceId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
  });

  const { data: sprints = [], isLoading: sprintsLoading } = useQuery({
    queryKey: ['sprints', activeWorkspaceId],
    queryFn: () => fetchSprints(activeWorkspaceId),
  });

  const isLoading = reqsLoading || sprintsLoading;

  const activeSprint = useMemo(
    () => sprints.find((s) => s.status === 'active'),
    [sprints]
  );
  const plannedSprints = useMemo(
    () => sprints.filter((s) => s.status === 'planned'),
    [sprints]
  );

  // Sprint Mutations
  const startSprintMutation = useMutation({
    mutationFn: (sprintId: string) => startSprint(sprintId),
    onSuccess: (s) => {
      toast.success(`Sprint "${s.name}" is now active!`);
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to start sprint'),
  });

  const completeSprintMutation = useMutation({
    mutationFn: (sprintId: string) => completeSprint(sprintId),
    onSuccess: (res) => {
      toast.success(
        `Sprint completed! ${res.rolledOverCount} unfinished item(s) rolled over to Backlog.`
      );
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to complete sprint'),
  });

  const assignSprintMutation = useMutation({
    mutationFn: ({ reqId, sprintId }: { reqId: string; sprintId: string | null }) =>
      assignRequirementSprint(reqId, sprintId),
    onSuccess: (req, vars) => {
      const targetSprint = sprints.find((s) => s.id === vars.sprintId);
      toast.success(
        targetSprint
          ? `Moved "${req.title}" to ${targetSprint.name}`
          : `Moved "${req.title}" to Product Backlog`
      );
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to move requirement'),
  });

  // Drag-and-drop state update mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RequirementStatus }) =>
      updateRequirementStatus(id, status),
    onSuccess: (updatedReq) => {
      if (updatedReq.merge_state === 'running') {
        toast.info(`Merging "${updatedReq.title}"… it moves to QA when the merge succeeds`);
      } else {
        toast.success(
          `Moved "${updatedReq.title}" to ${updatedReq.status.replace('_', ' ').toUpperCase()}`
        );
      }
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to move requirement state'),
  });

  const handleDropOnGroup = (targetGroupId: string) => {
    if (!draggedReqId) return;
    const req = requirements.find((r) => r.id === draggedReqId);
    if (!req) return;

    if (groupBy === 'status' || groupBy === 'none') {
      const targetStatus = targetGroupId as RequirementStatus;
      if (req.status !== targetStatus) {
        updateStatusMutation.mutate({ id: req.id, status: targetStatus });
      }
    }
    setDraggedReqId(null);
    setDragOverGroupId(null);
  };

  // Sprint metrics
  const activeSprintReqs = useMemo(
    () => (activeSprint ? requirements.filter((r) => r.sprint_id === activeSprint.id) : []),
    [requirements, activeSprint]
  );
  const activeSprintDoneCount = activeSprintReqs.filter((r) => r.status === 'done').length;
  const activeSprintTotalCount = activeSprintReqs.length;

  const backlogRequirements = useMemo(
    () => requirements.filter((r) => !r.sprint_id),
    [requirements]
  );

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

    // Filter by Scrum Tab first
    if (scrumTab === 'sprint') {
      list = activeSprint ? list.filter((r) => r.sprint_id === activeSprint.id) : [];
    } else if (scrumTab === 'backlog') {
      list = list.filter((r) => !r.sprint_id);
    }

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
      let cmp = 0;
      if (sortField === 'id') {
        cmp = a.id.localeCompare(b.id, undefined, { numeric: true });
      } else if (sortField === 'title') {
        cmp = a.title.localeCompare(b.title);
      } else if (sortField === 'priority') {
        const rank: Record<Priority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
        cmp = (rank[a.priority] || 0) - (rank[b.priority] || 0);
      } else if (sortField === 'status') {
        const statusRank: Record<RequirementStatus, number> = {
          draft: 1,
          ready: 2,
          in_progress: 3,
          in_review: 4,
          qa: 5,
          done: 6,
          cancelled: 7,
        };
        cmp = (statusRank[a.status] || 0) - (statusRank[b.status] || 0);
      } else if (sortField === 'created_at') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [
    requirements,
    scrumTab,
    activeSprint,
    searchQuery,
    hideDone,
    selectedStatuses,
    selectedPriorities,
    selectedProjects,
    sortField,
    sortDirection,
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
          bgLight: 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200/70 dark:border-rose-900/30',
          headerBg: 'bg-rose-100/70 dark:bg-rose-950/50 border-rose-200/80 dark:border-rose-900/40',
          headerText: 'text-rose-900 dark:text-rose-200',
          badgeBg: 'bg-rose-200/90 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300',
          match: (r: any) => r.priority === 'urgent',
        },
        {
          id: 'high',
          title: 'HIGH PRIORITY',
          color: 'bg-amber-500',
          bgLight: 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-900/30',
          headerBg: 'bg-amber-100/70 dark:bg-amber-950/50 border-amber-200/80 dark:border-amber-900/40',
          headerText: 'text-amber-900 dark:text-amber-200',
          badgeBg: 'bg-amber-200/90 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300',
          match: (r: any) => r.priority === 'high',
        },
        {
          id: 'normal',
          title: 'NORMAL PRIORITY',
          color: 'bg-blue-500',
          bgLight: 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/70 dark:border-blue-900/30',
          headerBg: 'bg-blue-100/70 dark:bg-blue-950/50 border-blue-200/80 dark:border-blue-900/40',
          headerText: 'text-blue-900 dark:text-blue-200',
          badgeBg: 'bg-blue-200/90 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300',
          match: (r: any) => r.priority === 'normal',
        },
        {
          id: 'low',
          title: 'LOW PRIORITY',
          color: 'bg-slate-400',
          bgLight: 'bg-slate-50/80 dark:bg-[#1e1e1e]/80 border-slate-200 dark:border-[#2d2d2d]',
          headerBg: 'bg-slate-100/90 dark:bg-[#242424] border-slate-200 dark:border-[#2d2d2d]',
          headerText: 'text-slate-700 dark:text-slate-300',
          badgeBg: 'bg-slate-200/90 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
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
        bgLight: 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-200/60 dark:border-purple-900/30',
        headerBg: 'bg-purple-100/70 dark:bg-purple-950/40 border-purple-200/70 dark:border-purple-900/40',
        headerText: 'text-purple-900 dark:text-purple-200',
        badgeBg: 'bg-purple-200/90 dark:bg-purple-900/60 text-purple-800 dark:text-purple-300',
        match: (r: any) => r.affected_projects.includes(proj),
      }));
    }

    // Default: group by status (Board States with light background colors)
    return [
      {
        id: 'draft',
        title: 'TO DO / DRAFT',
        color: 'bg-slate-400',
        bgLight: 'bg-slate-50/90 dark:bg-[#1e1e1e]/80 border-slate-200 dark:border-[#2d2d2d]',
        headerBg: 'bg-slate-100 dark:bg-[#242424] border-slate-200 dark:border-[#2d2d2d]',
        headerText: 'text-slate-700 dark:text-slate-300',
        badgeBg: 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
        match: (r: any) => r.status === 'draft',
      },
      {
        id: 'ready',
        title: 'READY FOR DISPATCH',
        color: 'bg-sky-500',
        bgLight: 'bg-sky-50/60 dark:bg-sky-950/25 border-sky-200/70 dark:border-sky-900/40',
        headerBg: 'bg-sky-100/80 dark:bg-sky-950/50 border-sky-200/80 dark:border-sky-900/50',
        headerText: 'text-sky-900 dark:text-sky-200',
        badgeBg: 'bg-sky-200/90 dark:bg-sky-900/70 text-sky-800 dark:text-sky-300',
        match: (r: any) => r.status === 'ready',
      },
      {
        id: 'in_progress',
        title: 'IN PROGRESS',
        color: 'bg-[#7b68ee]',
        bgLight: 'bg-purple-50/60 dark:bg-purple-950/25 border-purple-200/70 dark:border-purple-900/40',
        headerBg: 'bg-purple-100/80 dark:bg-purple-950/50 border-purple-200/80 dark:border-purple-900/50',
        headerText: 'text-purple-900 dark:text-purple-200',
        badgeBg: 'bg-purple-200/90 dark:bg-purple-900/70 text-purple-800 dark:text-purple-300',
        match: (r: any) => r.status === 'in_progress',
      },
      {
        id: 'in_review',
        title: 'IN REVIEW',
        color: 'bg-blue-500',
        bgLight: 'bg-blue-50/60 dark:bg-blue-950/25 border-blue-200/70 dark:border-blue-900/40',
        headerBg: 'bg-blue-100/80 dark:bg-blue-950/50 border-blue-200/80 dark:border-blue-900/50',
        headerText: 'text-blue-900 dark:text-blue-200',
        badgeBg: 'bg-blue-200/90 dark:bg-blue-900/70 text-blue-800 dark:text-blue-300',
        match: (r: any) => r.status === 'in_review',
      },
      {
        id: 'qa',
        title: 'QA / TESTING',
        color: 'bg-amber-500',
        bgLight: 'bg-amber-50/60 dark:bg-amber-950/25 border-amber-200/70 dark:border-amber-900/40',
        headerBg: 'bg-amber-100/80 dark:bg-amber-950/50 border-amber-200/80 dark:border-amber-900/50',
        headerText: 'text-amber-900 dark:text-amber-200',
        badgeBg: 'bg-amber-200/90 dark:bg-amber-900/70 text-amber-800 dark:text-amber-300',
        match: (r: any) => r.status === 'qa',
      },
      {
        id: 'done',
        title: 'COMPLETE',
        color: 'bg-emerald-500',
        bgLight: 'bg-emerald-50/60 dark:bg-emerald-950/25 border-emerald-200/70 dark:border-emerald-900/40',
        headerBg: 'bg-emerald-100/80 dark:bg-emerald-950/50 border-emerald-200/80 dark:border-emerald-900/50',
        headerText: 'text-emerald-900 dark:text-emerald-200',
        badgeBg: 'bg-emerald-200/90 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300',
        match: (r: any) => r.status === 'done',
      },
    ];
  }, [groupBy, allProjectNames]);

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-4">
      {/* ClickUp Title & Top Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
            <span>Agile Scrum & DevFlow</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Requirements & Sprints
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Centrally authored specs fanning out to per-repo agent engines with Scrum governance
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsCreateSprintOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#20212a] dark:hover:bg-[#2a2c38] text-slate-800 dark:text-slate-200 rounded-lg text-xs font-bold border border-slate-300 dark:border-[#2e303d] active:scale-[0.98] transition-all shadow-sm"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Plan Sprint</span>
          </button>
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

      {/* Scrum Navigation Tabs & Inline Active Sprint (Right Slot) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Scrum Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100/80 dark:bg-[#1e1e1e] rounded-xl border border-slate-200 dark:border-[#2d2d2d] w-fit shadow-inner">
          <button
            onClick={() => handleTabChange('sprint')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              scrumTab === 'sprint'
                ? 'bg-white dark:bg-[#282828] text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Active Sprint</span>
            {activeSprint ? (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            ) : (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-500 font-mono">
                idle
              </span>
            )}
          </button>

          <button
            onClick={() => handleTabChange('backlog')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              scrumTab === 'backlog'
                ? 'bg-white dark:bg-[#282828] text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <span>📋 Product Backlog</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold">
              {backlogRequirements.length}
            </span>
          </button>

          <button
            onClick={() => handleTabChange('all')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              scrumTab === 'all'
                ? 'bg-white dark:bg-[#282828] text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <span>All Requirements</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold">
              {requirements.length}
            </span>
          </button>
        </div>

        {/* Right Slot: Inline Active Sprint Details */}
        {scrumTab === 'sprint' && activeSprint && (
          <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white dark:bg-[#1e1e1e] border border-indigo-100 dark:border-indigo-950/60 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800/40 uppercase tracking-wide flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {activeSprint.name}
              </span>
            </div>

            {(activeSprint.start_date || activeSprint.end_date) && (
              <div className="hidden lg:flex items-center gap-1 text-[10px] text-slate-500 font-mono border-l border-slate-200 dark:border-[#333] pl-2.5">
                <Calendar className="w-3 h-3 text-indigo-400" />
                <span>
                  {activeSprint.start_date || 'Start'} &rarr; {activeSprint.end_date || 'Ongoing'}
                </span>
              </div>
            )}

            {/* Compact Progress */}
            <div className="flex items-center gap-2 border-l border-slate-200 dark:border-[#333] pl-2.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                {activeSprintDoneCount}/{activeSprintTotalCount} done
              </span>
              <div className="w-16 sm:w-20 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden shadow-inner">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{
                    width: `${
                      activeSprintTotalCount > 0
                        ? Math.round((activeSprintDoneCount / activeSprintTotalCount) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Complete Sprint Action Button */}
            <button
              onClick={() => {
                if (
                  confirm(
                    `Complete sprint "${activeSprint.name}"? Unfinished tasks will automatically roll over to Product Backlog.`
                  )
                ) {
                  completeSprintMutation.mutate(activeSprint.id);
                }
              }}
              disabled={completeSprintMutation.isPending}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-2xs transition-all flex items-center gap-1 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>
                {completeSprintMutation.isPending ? 'Completing...' : 'Complete Sprint'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* When on Sprint tab but no active sprint */}
      {scrumTab === 'sprint' && !activeSprint && !isLoading && (
        <div className="p-8 rounded-2xl bg-white dark:bg-[#1e1e1e] border border-dashed border-slate-300 dark:border-[#303030] text-center space-y-4 shadow-sm animate-in fade-in duration-150">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center font-bold text-xl shadow-inner">
            <Zap className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              No Active Sprint in This Workspace
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Start an existing planned sprint below, or plan a new iteration for this workspace.
            </p>
          </div>

          {plannedSprints.length > 0 && (
            <div className="max-w-xl mx-auto space-y-2 text-left pt-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Planned Sprints Ready to Start ({plannedSprints.length})
              </span>
              <div className="divide-y divide-slate-100 dark:divide-[#2d2d2d] border border-slate-200 dark:border-[#303030] rounded-xl overflow-hidden bg-slate-50/50 dark:bg-[#242424]">
                {plannedSprints.map((s) => (
                  <div key={s.id} className="p-3.5 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {s.name}
                      </h4>
                      {s.goal && <p className="text-[11px] text-slate-500 line-clamp-1">{s.goal}</p>}
                      {(s.start_date || s.end_date) && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {s.start_date || 'TBD'} &rarr; {s.end_date || 'TBD'}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => startSprintMutation.mutate(s.id)}
                      disabled={startSprintMutation.isPending}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <Play className="w-3 h-3 fill-white" />
                      <span>Start Sprint</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              onClick={() => setIsCreateSprintOpen(true)}
              className="px-4 py-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-xl transition-all"
            >
              + Plan New Sprint
            </button>
            <button
              onClick={() => setScrumTab('backlog')}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-all"
            >
              View Product Backlog &rarr;
            </button>
          </div>
        </div>
      )}

      {/* ClickUp View & Filter Bar (shown if not in empty sprint launcher) */}
      {(scrumTab !== 'sprint' || activeSprint) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-1.5 rounded-xl bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] shadow-sm">
            {/* Left: View Switchers (List / Board) */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'list'
                    ? 'bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282828]'
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
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282828]'
                }`}
              >
                <Kanban className="w-3.5 h-3.5" />
                <span>Board</span>
              </button>
            </div>

            {/* Right: Group, Filter, Sort & Search Controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Filter Drawer Toggle Button */}
              <button
                onClick={() => setIsFilterPanelOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                  activeFilterCount > 0 || isFilterPanelOpen
                    ? 'bg-purple-50 dark:bg-purple-950/50 border-[#7b68ee] text-[#7b68ee] dark:text-purple-300 font-bold'
                    : 'border-slate-200 dark:border-[#303030] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#282828]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Filter</span>
                {activeFilterCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-[#7b68ee] text-white text-[10px] font-mono flex items-center justify-center font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* Group By Selector */}
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424]">
                <span className="text-[10px] uppercase font-bold text-slate-400">Group:</span>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
                  className="bg-transparent font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer pr-1"
                >
                  <option value="none" className="bg-white dark:bg-[#242424]">None (DataTable)</option>
                  <option value="status" className="bg-white dark:bg-[#242424]">Status</option>
                  <option value="priority" className="bg-white dark:bg-[#242424]">Priority</option>
                  <option value="project" className="bg-white dark:bg-[#242424]">Project</option>
                </select>
              </div>

              {/* Sort By Selector */}
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424]">
                <ArrowUpDown className="w-3 h-3 text-slate-400" />
                <select
                  value={`${sortField}_${sortDirection}`}
                  onChange={(e) => {
                    const [field, dir] = e.target.value.split('_') as [SortField, 'asc' | 'desc'];
                    setSortField(field);
                    setSortDirection(dir);
                  }}
                  className="bg-transparent font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer pr-1"
                >
                  <option value="created_at_desc" className="bg-white dark:bg-[#242424]">Sort: Newest</option>
                  <option value="created_at_asc" className="bg-white dark:bg-[#242424]">Sort: Oldest</option>
                  <option value="title_asc" className="bg-white dark:bg-[#242424]">Sort: Name (A-Z)</option>
                  <option value="title_desc" className="bg-white dark:bg-[#242424]">Sort: Name (Z-A)</option>
                  <option value="priority_desc" className="bg-white dark:bg-[#242424]">Sort: Priority</option>
                  <option value="status_asc" className="bg-white dark:bg-[#242424]">Sort: Status</option>
                  <option value="id_asc" className="bg-white dark:bg-[#242424]">Sort: ID</option>
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
                  className="pl-8 pr-7 py-1 bg-slate-100 dark:bg-[#262626] border border-slate-200 dark:border-[#333333] rounded-lg text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-[#7b68ee] w-36 sm:w-52"
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
            <div className="p-3.5 rounded-xl bg-white dark:bg-[#1e1e1e] border border-purple-100 dark:border-[#2d2d2d] shadow-sm space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#2d2d2d] pb-2">
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
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all uppercase ${
                            active
                              ? 'bg-purple-600 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-[#282828] text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          {st}
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
                      return (
                        <button
                          key={pr}
                          onClick={() => togglePriorityFilter(pr)}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all capitalize ${
                            active
                              ? 'bg-purple-600 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-[#282828] text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          {pr}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Project Multi-Filter */}
                {allProjectNames.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Affected Projects
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {allProjectNames.map((proj) => {
                        const active = selectedProjects.includes(proj);
                        return (
                          <button
                            key={proj}
                            onClick={() => toggleProjectFilter(proj)}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all font-mono ${
                              active
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'bg-slate-100 dark:bg-[#282828] text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                            }`}
                          >
                            {proj}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Active Filter Chips Summary */}
              {activeFilterCount > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-[#2d2d2d] flex flex-wrap items-center gap-1.5 text-xs">
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
      )}

      {/* Main Content Area */}
      {isLoading ? (
        <div className="p-16 text-center text-slate-400 dark:text-slate-500 text-sm">
          Loading requirements & sprint board...
        </div>
      ) : filteredRequirements.length === 0 && (scrumTab !== 'sprint' || activeSprint) ? (
        <div className="p-12 text-center border border-dashed border-slate-300 dark:border-[#303030] rounded-2xl bg-white dark:bg-[#1e1e1e]/60 shadow-sm space-y-3">
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
            {activeFilterCount > 0
              ? 'No requirements match your active filter options.'
              : scrumTab === 'sprint'
              ? 'No tasks assigned to this active sprint yet.'
              : scrumTab === 'backlog'
              ? 'Product Backlog is clear! All items are assigned to sprints.'
              : 'No cross-repo requirements found in this workspace.'}
          </p>
          {scrumTab === 'sprint' && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setScrumTab('backlog')}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 transition-all"
              >
                Move Tasks from Product Backlog &rarr;
              </button>
            </div>
          )}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-[#262626] text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Filter Options</span>
            </button>
          )}
        </div>
      ) : (scrumTab !== 'sprint' || activeSprint) && viewMode === 'list' ? (
        /* Unified High-Density DataTable View */
        <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-slate-200 dark:border-[#2d2d2d] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/90 dark:bg-[#222222] text-slate-500 dark:text-slate-400 font-mono text-[10px] uppercase border-b border-slate-200 dark:border-[#2d2d2d] select-none sticky top-0 z-10 backdrop-blur">
                <tr>
                  <th
                    onClick={() => handleSort('id')}
                    className="px-4 py-3 font-semibold cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>ID</span>
                      {sortField === 'id' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-[#7b68ee]" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#7b68ee]" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('title')}
                    className="px-4 py-3 font-semibold cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors min-w-[220px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Requirement / Spec</span>
                      {sortField === 'title' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-[#7b68ee]" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#7b68ee]" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Workspace</th>
                  <th
                    onClick={() => handleSort('priority')}
                    className="px-4 py-3 font-semibold cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Priority</span>
                      {sortField === 'priority' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-[#7b68ee]" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#7b68ee]" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 font-semibold">Affected Projects</th>
                  <th
                    onClick={() => handleSort('status')}
                    className="px-4 py-3 font-semibold cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Status</span>
                      {sortField === 'status' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-[#7b68ee]" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#7b68ee]" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Sprint</th>
                  <th
                    onClick={() => handleSort('created_at')}
                    className="px-4 py-3 font-semibold text-right cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Created</span>
                      {sortField === 'created_at' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-[#7b68ee]" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#7b68ee]" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 font-semibold text-center whitespace-nowrap w-16">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2d2d2d]">
                {groupBy === 'none' ? (
                  filteredRequirements.map((req) => {
                    const prio = priorityConfig[req.priority] || priorityConfig.normal;
                    const reqSprint = req.sprint_id ? sprints.find((s) => s.id === req.sprint_id) : null;

                    return (
                      <tr
                        key={req.id}
                        className="hover:bg-purple-50/30 dark:hover:bg-[#262626] transition-colors group"
                      >
                        <td className="px-4 py-3 font-mono font-bold text-[#7b68ee] whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedRequirementId(req.id)}
                            className="hover:underline cursor-pointer text-left"
                          >
                            {req.id}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                          <button
                            type="button"
                            onClick={() => setSelectedRequirementId(req.id)}
                            className="hover:text-[#7b68ee] transition-colors font-semibold block text-left cursor-pointer truncate max-w-xs md:max-w-md"
                          >
                            {req.title}
                          </button>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60">
                            📁 {req.workspace_id || 'default'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5" title={`Priority: ${prio.label}`}>
                            <Flag className={`w-3.5 h-3.5 ${prio.color}`} />
                            <span className="capitalize text-slate-600 dark:text-slate-400 font-medium text-[11px]">
                              {prio.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {req.affected_projects && req.affected_projects.length > 0 ? (
                              req.affected_projects.map((proj) => (
                                <span
                                  key={proj}
                                  className="px-2 py-0.5 rounded font-mono text-[10px] font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 whitespace-nowrap"
                                >
                                  {proj}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400 text-[11px] italic">None</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge status={req.status} size="xs" />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {scrumTab === 'backlog' ? (
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  assignSprintMutation.mutate({
                                    reqId: req.id,
                                    sprintId: e.target.value,
                                  });
                                }
                              }}
                              className="bg-slate-100 dark:bg-[#262626] border border-slate-200 dark:border-[#333333] text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg px-2 py-1 focus:outline-none cursor-pointer max-w-[130px]"
                            >
                              <option value="" disabled>
                                Move to...
                              </option>
                              {activeSprint && (
                                <option value={activeSprint.id}>
                                  🏃 Active: {activeSprint.name}
                                </option>
                              )}
                              {plannedSprints.map((s) => (
                                <option key={s.id} value={s.id}>
                                  ⏳ {s.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] font-semibold border ${
                                reqSprint?.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40'
                                  : reqSprint
                                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/40'
                                  : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-[#262626] dark:text-slate-400 dark:border-[#303030]'
                              }`}
                            >
                              {reqSprint
                                ? reqSprint.status === 'active'
                                  ? `🏃 ${reqSprint.name}`
                                  : `⏳ ${reqSprint.name}`
                                : '📋 Backlog'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-400 text-right whitespace-nowrap">
                          {new Date(req.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedRequirementId(req.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#7b68ee] hover:bg-purple-50 dark:hover:bg-[#282828] inline-flex items-center justify-center transition-colors cursor-pointer"
                            title="View Details in Sheet"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  groups
                    .filter((group) => filteredRequirements.some(group.match))
                    .map((group) => {
                      const groupReqs = filteredRequirements.filter(group.match);
                      const isCollapsed = collapsedGroups[group.id];

                      return (
                        <Fragment key={group.id}>
                          <tr
                            onClick={() => toggleGroup(group.id)}
                            className="bg-slate-50/90 dark:bg-[#222222] border-y border-slate-200 dark:border-[#2d2d2d] cursor-pointer select-none hover:bg-slate-100/90 dark:hover:bg-[#262626] transition-colors"
                          >
                            <td colSpan={9} className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                {isCollapsed ? (
                                  <ChevronRight className="w-4 h-4 text-slate-400" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-slate-400" />
                                )}
                                <span className={`w-2.5 h-2.5 rounded-full ${group.color}`} />
                                <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                  {group.title}
                                </span>
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                                  {groupReqs.length}
                                </span>
                              </div>
                            </td>
                          </tr>

                          {!isCollapsed &&
                            groupReqs.map((req) => {
                              const prio = priorityConfig[req.priority] || priorityConfig.normal;
                              const reqSprint = req.sprint_id
                                ? sprints.find((s) => s.id === req.sprint_id)
                                : null;

                              return (
                                <tr
                                  key={req.id}
                                  className="hover:bg-purple-50/30 dark:hover:bg-[#262626] transition-colors group"
                                >
                                  <td className="px-4 py-3 font-mono font-bold text-[#7b68ee] whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedRequirementId(req.id)}
                                      className="hover:underline cursor-pointer text-left"
                                    >
                                      {req.id}
                                    </button>
                                  </td>
                                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedRequirementId(req.id)}
                                      className="hover:text-[#7b68ee] transition-colors font-semibold block text-left cursor-pointer truncate max-w-xs md:max-w-md"
                                    >
                                      {req.title}
                                    </button>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60">
                                      📁 {req.workspace_id || 'default'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div
                                      className="flex items-center gap-1.5"
                                      title={`Priority: ${prio.label}`}
                                    >
                                      <Flag className={`w-3.5 h-3.5 ${prio.color}`} />
                                      <span className="capitalize text-slate-600 dark:text-slate-400 font-medium text-[11px]">
                                        {prio.label}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1">
                                      {req.affected_projects && req.affected_projects.length > 0 ? (
                                        req.affected_projects.map((proj) => (
                                          <span
                                            key={proj}
                                            className="px-2 py-0.5 rounded font-mono text-[10px] font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 whitespace-nowrap"
                                          >
                                            {proj}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-slate-400 text-[11px] italic">None</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <StatusBadge status={req.status} size="xs" />
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    {scrumTab === 'backlog' ? (
                                      <select
                                        value=""
                                        onChange={(e) => {
                                          if (e.target.value) {
                                            assignSprintMutation.mutate({
                                              reqId: req.id,
                                              sprintId: e.target.value,
                                            });
                                          }
                                        }}
                                        className="bg-slate-100 dark:bg-[#262626] border border-slate-200 dark:border-[#333333] text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg px-2 py-1 focus:outline-none cursor-pointer max-w-[130px]"
                                      >
                                        <option value="" disabled>
                                          Move to...
                                        </option>
                                        {activeSprint && (
                                          <option value={activeSprint.id}>
                                            🏃 Active: {activeSprint.name}
                                          </option>
                                        )}
                                        {plannedSprints.map((s) => (
                                          <option key={s.id} value={s.id}>
                                            ⏳ {s.name}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] font-semibold border ${
                                          reqSprint?.status === 'active'
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40'
                                            : reqSprint
                                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/40'
                                            : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-[#262626] dark:text-slate-400 dark:border-[#303030]'
                                        }`}
                                      >
                                        {reqSprint
                                          ? reqSprint.status === 'active'
                                            ? `🏃 ${reqSprint.name}`
                                            : `⏳ ${reqSprint.name}`
                                          : '📋 Backlog'}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400 text-right whitespace-nowrap">
                                    {new Date(req.created_at).toLocaleDateString()}
                                  </td>
                                  <td className="px-4 py-3 text-center whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedRequirementId(req.id)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-[#7b68ee] hover:bg-purple-50 dark:hover:bg-[#282828] inline-flex items-center justify-center transition-colors cursor-pointer"
                                      title="View Details in Sheet"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Summary and Quick Action */}
          <div className="px-4 py-3 bg-slate-50/70 dark:bg-[#171717] border-t border-slate-200 dark:border-[#2d2d2d] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-3">
              <span>
                Showing <strong className="text-slate-800 dark:text-slate-200">{filteredRequirements.length}</strong> of{' '}
                <strong className="text-slate-800 dark:text-slate-200">{requirements.length}</strong> requirements
              </span>
              {activeFilterCount > 0 && (
                <span className="text-[11px] text-[#7b68ee] font-medium">
                  ({activeFilterCount} active filters)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={openSheet}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 font-bold text-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task / Requirement</span>
            </button>
          </div>
        </div>
      ) : (scrumTab !== 'sprint' || activeSprint) ? (
        /* ClickUp Kanban Board View - Inline & Scroll on Overflow */
        <div className="w-full overflow-x-auto pb-4 pt-1 scrollbar-thin">
          <div className="flex flex-row gap-4 items-start min-w-max">
            {groups.map((group) => {
              const groupReqs = filteredRequirements.filter(group.match);
              return (
                <div
                  key={group.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverGroupId !== group.id) {
                      setDragOverGroupId(group.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverGroupId(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnGroup(group.id);
                  }}
                  className={`w-[290px] sm:w-[310px] shrink-0 ${group.bgLight} border rounded-2xl flex flex-col max-h-[82vh] shadow-xs overflow-hidden transition-all duration-200 ${
                    dragOverGroupId === group.id
                      ? 'ring-2 ring-[#7b68ee] ring-offset-2 scale-[1.01] shadow-md border-[#7b68ee]'
                      : ''
                  }`}
                >
                {/* Column Header */}
                <div className={`p-3 border-b ${group.headerBg} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${group.color} ring-2 ring-white/60 dark:ring-black/30`} />
                    <span className={`text-xs font-black tracking-wider uppercase ${group.headerText}`}>
                      {group.title}
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${group.badgeBg}`}>
                    {groupReqs.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1 min-h-[120px]">
                  {dragOverGroupId === group.id && draggedReqId && (
                    <div className="border-2 border-dashed border-[#7b68ee]/70 rounded-xl p-3 bg-purple-100/60 dark:bg-purple-950/40 text-center text-xs font-bold text-[#7b68ee] dark:text-purple-300 animate-pulse">
                      Drop to move to {group.title}
                    </div>
                  )}

                  {groupReqs.length === 0 && (!dragOverGroupId || dragOverGroupId !== group.id) && (
                    <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-xs italic border border-dashed border-slate-300/60 dark:border-[#303030] rounded-xl my-2">
                      Drop cards here
                    </div>
                  )}

                  {groupReqs.map((req) => {
                    const prio = priorityConfig[req.priority] || priorityConfig.normal;
                    const reqSprint = req.sprint_id ? sprints.find((s) => s.id === req.sprint_id) : null;
                    const isBeingDragged = draggedReqId === req.id;

                    return (
                      <div
                        key={req.id}
                        draggable={true}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', req.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggedReqId(req.id);
                          isDraggingJustEndedRef.current = true;
                        }}
                        onDragEnd={() => {
                          setDraggedReqId(null);
                          setDragOverGroupId(null);
                          setTimeout(() => {
                            isDraggingJustEndedRef.current = false;
                          }, 150);
                        }}
                        onClick={() => {
                          if (isDraggingJustEndedRef.current) return;
                          setSelectedRequirementId(req.id);
                        }}
                        className={`block p-2.5 sm:p-3 rounded-xl bg-white dark:bg-[#222222] hover:bg-slate-50/90 dark:hover:bg-[#262626] border border-slate-200/90 dark:border-[#2d2d2d] shadow-sm hover:shadow-md dark:shadow-black/25 transition-all group cursor-grab active:cursor-grabbing select-none ${
                          isBeingDragged
                            ? 'opacity-40 scale-95 border-dashed border-[#7b68ee]'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
                          <span className="text-[#7b68ee] font-bold group-hover:underline">{req.id}</span>
                          <span className="flex items-center gap-1 text-[10px]">
                            <Flag className={`w-3 h-3 ${prio.color}`} />
                            <span className="capitalize text-slate-600 dark:text-slate-300 font-medium">{prio.label}</span>
                          </span>
                        </div>

                        <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 group-hover:text-[#7b68ee] transition-colors mb-1.5 line-clamp-2 leading-snug">
                          {req.title}
                        </div>

                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-[#2a2a2a]">
                          <div className="flex flex-wrap items-center gap-1">
                            {req.affected_projects.map((proj) => (
                              <span
                                key={proj}
                                className="px-1.5 py-0.5 rounded font-mono text-[9px] font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/40"
                              >
                                {proj}
                              </span>
                            ))}
                          </div>
                          <span className="text-[10px] font-bold font-mono text-indigo-600 dark:text-indigo-400">
                            {reqSprint ? reqSprint.name : 'Backlog'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Column Footer Quick Add */}
                <div className="p-2 border-t border-slate-200/60 dark:border-[#262732]/60 bg-white/40 dark:bg-black/10">
                  <button
                    type="button"
                    onClick={openSheet}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-white/80 dark:hover:bg-[#282828] font-semibold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Task</span>
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      ) : null}

      {/* Create Sprint Modal */}
      <CreateSprintModal
        isOpen={isCreateSprintOpen}
        onClose={() => setIsCreateSprintOpen(false)}
        workspaceId={activeWorkspaceId}
        onSprintCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['sprints'] });
          // If no active sprint, switch to sprint tab
          if (!activeSprint) {
            setScrumTab('sprint');
          }
        }}
      />

      {/* Requirement Detail Slide-over Sheet */}
      <RequirementDetailSheet
        requirementId={selectedRequirementId}
        isOpen={Boolean(selectedRequirementId)}
        onClose={() => setSelectedRequirementId(null)}
      />
    </div>
  );
}
