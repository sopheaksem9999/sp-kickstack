import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  TrendingDown,
  Clock,
  Link2,
  RefreshCw,
  FolderGit2,
  Zap,
} from 'lucide-react';
import { Project } from '@sp-kickstack/shared';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { fetchSprints, fetchSprintBurndown, fetchTelemetry, fetchProjects } from '../lib/api.js';
import { NeuronAuditSection } from '../components/NeuronAuditSection.js';
import { RadixSelect } from '../components/ui/select.js';

interface SprintBurndownData {
  sprint_id: string;
  sprint_name: string;
  total_requirements: number;
  completed_requirements: number;
  in_progress_requirements: number;
  backlog_rollover_rate: number;
  points_ideal: { day: string; remaining: number }[];
  points_actual: { day: string; remaining: number }[];
}

interface AgentTelemetryData {
  total_tasks: number;
  status_distribution: Record<string, number>;
  total_links: number;
  released_links: number;
  avg_blockage_latency_ms: number;
  engine_activity: {
    project: string;
    total: number;
    done: number;
    in_review: number;
    running?: number;
    held: number;
  }[];
}

interface Sprint {
  id: string;
  name: string;
  status: string;
  goal?: string;
  start_date?: string;
  end_date?: string;
}

export function MetricsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');

  // Sprints list
  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ['sprints', activeWorkspaceId],
    queryFn: () => fetchSprints(activeWorkspaceId),
  });

  const activeSprint = sprints.find((s) => s.status === 'active') || sprints[0];
  const currentSprintId = selectedSprintId || activeSprint?.id || '';

  // Sprint Burndown
  const {
    data: burndown,
    refetch: refetchBurndown,
  } = useQuery<SprintBurndownData>({
    queryKey: ['sprint-burndown', currentSprintId],
    queryFn: async () => {
      if (!currentSprintId) return null as any;
      return fetchSprintBurndown(currentSprintId);
    },
    enabled: Boolean(currentSprintId),
  });

  // Telemetry
  const {
    data: telemetry,
    refetch: refetchTelemetry,
  } = useQuery<AgentTelemetryData>({
    queryKey: ['telemetry', activeWorkspaceId],
    queryFn: () => fetchTelemetry(activeWorkspaceId),
  });

  // Projects in active workspace for repository metadata
  const {
    data: projects = [],
    refetch: refetchProjects,
  } = useQuery<Project[]>({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
  });

  const projectsByName = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      map.set(p.name, p);
    }
    return map;
  }, [projects]);

  const formatLatency = (ms: number) => {
    if (ms <= 0) return '0s';
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    return `${min}m`;
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-500" />
            Sprint Burndown & Agent Telemetry
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time multi-repo engine telemetry, agent blockage latency, and sprint delivery velocity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sprints.length > 0 && (
            <div className="w-56">
              <RadixSelect
                size="sm"
                value={currentSprintId}
                onChange={setSelectedSprintId}
                options={sprints.map((s) => ({
                  value: s.id,
                  label: s.name,
                  badge: (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                        s.status === 'active'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : s.status === 'completed'
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                      }`}
                    >
                      {s.status}
                    </span>
                  ),
                }))}
              />
            </div>
          )}
          <button
            onClick={() => {
              refetchBurndown();
              refetchTelemetry();
              refetchProjects();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Top Telemetry KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Bridge Tasks</div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">
              {telemetry?.total_tasks ?? 0}
            </div>
            <div className="text-[11px] text-slate-400">
              {telemetry?.status_distribution['done'] ?? 0} done · {telemetry?.status_distribution['in_review'] ?? 0} in review
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Link2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Dependency Links</div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">
              {telemetry?.released_links ?? 0} / {telemetry?.total_links ?? 0}
            </div>
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
              {telemetry?.total_links ? Math.round(((telemetry.released_links) / telemetry.total_links) * 100) : 100}% released
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Avg Blockage Latency</div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">
              {formatLatency(telemetry?.avg_blockage_latency_ms ?? 0)}
            </div>
            <div className="text-[11px] text-slate-400">
              Time held before unblocked
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <TrendingDown className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Rollover Rate</div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">
              {burndown?.backlog_rollover_rate ?? 0}%
            </div>
            <div className="text-[11px] text-slate-400">
              {burndown?.completed_requirements ?? 0} of {burndown?.total_requirements ?? 0} reqs completed
            </div>
          </div>
        </div>
      </div>

      {/* Main Charts & Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sprint Burndown Chart */}
        <div className="lg:col-span-2 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-purple-500" />
                Burndown Curve — {burndown?.sprint_name || 'Selected Sprint'}
              </h2>
              <p className="text-xs text-slate-500">
                Ideal burn trajectory vs. actual remaining requirements.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-400 inline-block" /> Ideal
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-purple-600 dark:text-purple-400">
                <span className="w-3 h-1 bg-purple-600 rounded inline-block" /> Actual
              </span>
            </div>
          </div>

          {burndown && burndown.total_requirements > 0 ? (
            <div className="w-full h-64 flex flex-col justify-between pt-4">
              {/* Visual SVG chart */}
              <svg className="w-full h-48 overflow-visible" viewBox="0 0 500 150">
                {/* Grid lines */}
                <line x1="0" y1="0" x2="500" y2="0" stroke="currentColor" strokeDasharray="3 3" className="text-slate-200 dark:text-slate-800" />
                <line x1="0" y1="50" x2="500" y2="50" stroke="currentColor" strokeDasharray="3 3" className="text-slate-200 dark:text-slate-800" />
                <line x1="0" y1="100" x2="500" y2="100" stroke="currentColor" strokeDasharray="3 3" className="text-slate-200 dark:text-slate-800" />
                <line x1="0" y1="150" x2="500" y2="150" stroke="currentColor" className="text-slate-300 dark:text-slate-700" />

                {/* Ideal Line (Dashed) */}
                <line
                  x1="20"
                  y1="20"
                  x2="480"
                  y2="140"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />

                {/* Actual Line */}
                <polyline
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={`20,20 250,${
                    20 +
                    ((burndown.total_requirements - burndown.completed_requirements) /
                      (burndown.total_requirements || 1)) *
                      120
                  }`}
                />

                {/* Data Points */}
                <circle cx="20" cy="20" r="5" fill="#8b5cf6" />
                <circle
                  cx="250"
                  cy={
                    20 +
                    ((burndown.total_requirements - burndown.completed_requirements) /
                      (burndown.total_requirements || 1)) *
                      120
                  }
                  r="6"
                  fill="#8b5cf6"
                />
              </svg>

              <div className="flex justify-between text-[11px] text-slate-400 px-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span>Day 1 (Start)</span>
                <span>Current Velocity</span>
                <span>Day 14 (Target)</span>
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-slate-400">
              No requirements assigned to this sprint yet.
            </div>
          )}
        </div>

        {/* Multi-Repo Engine Activity */}
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-indigo-500" />
                Engine Work Distribution
              </h2>
              <p className="text-xs text-slate-500">Autonomous execution by repository.</p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {telemetry?.engine_activity?.length ?? 0} {telemetry?.engine_activity?.length === 1 ? 'repo' : 'repos'}
            </span>
          </div>

          <div className="space-y-3 pt-1">
            {telemetry?.engine_activity && telemetry.engine_activity.length > 0 ? (
              telemetry.engine_activity.map((eng) => {
                const projectMeta = projectsByName.get(eng.project);
                const hasTasks = eng.total > 0;
                const runningCount = eng.running || 0;

                return (
                  <div
                    key={eng.project}
                    className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:border-slate-200 dark:hover:border-slate-700 transition-colors space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FolderGit2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                          {eng.project}
                        </span>
                        {projectMeta?.kind && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wider shrink-0">
                            {projectMeta.kind}
                          </span>
                        )}
                        {projectMeta?.engine_type && (
                          <span className="text-[10px] text-slate-400 shrink-0">
                            · {projectMeta.engine_type}
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500 font-medium shrink-0">
                        {eng.total} {eng.total === 1 ? 'task' : 'tasks'}
                      </span>
                    </div>

                    {/* Multi-segmented progress bar */}
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                      {hasTasks ? (
                        <>
                          <div
                            className="bg-emerald-500 h-full transition-all"
                            style={{ width: `${(eng.done / eng.total) * 100}%` }}
                            title={`Done: ${eng.done}`}
                          />
                          <div
                            className="bg-indigo-500 h-full transition-all"
                            style={{ width: `${(eng.in_review / eng.total) * 100}%` }}
                            title={`In Review: ${eng.in_review}`}
                          />
                          <div
                            className="bg-purple-500 h-full transition-all"
                            style={{ width: `${(runningCount / eng.total) * 100}%` }}
                            title={`Running: ${runningCount}`}
                          />
                          <div
                            className="bg-amber-500 h-full transition-all"
                            style={{ width: `${(eng.held / eng.total) * 100}%` }}
                            title={`Held: ${eng.held}`}
                          />
                        </>
                      ) : (
                        <div className="w-full h-full bg-slate-200/50 dark:bg-slate-800/50" />
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        ✓ {eng.done} done
                      </span>
                      <span className="text-purple-600 dark:text-purple-400 font-medium">
                        ⚡ {runningCount} active
                      </span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                        ⟲ {eng.in_review} review
                      </span>
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        ⏸ {eng.held} held
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-center">
                <FolderGit2 className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  No repositories registered in this workspace yet.
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Connect repositories in the Projects page to track engine execution by repo.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Neuron Learned Rules & Quality Audit Section */}
      <NeuronAuditSection workspaceId={activeWorkspaceId || 'default'} />
    </div>
  );
}
