import { AppDatabase } from '../db/index.js';
import { SprintService } from './sprintService.js';

export interface SprintBurndownData {
  sprint_id: string;
  sprint_name: string;
  total_requirements: number;
  completed_requirements: number;
  in_progress_requirements: number;
  backlog_rollover_rate: number;
  points_ideal: { day: string; remaining: number }[];
  points_actual: { day: string; remaining: number }[];
}

export interface AgentTelemetryData {
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
    running: number;
    held: number;
  }[];
}

export class MetricsService {
  constructor(
    private db: AppDatabase,
    private sprintService?: SprintService
  ) {}

  public getSprintBurndown(sprintId: string): SprintBurndownData | null {
    const sprint = this.sprintService?.getSprint(sprintId);
    if (!sprint) {
      const row = this.db.prepare('SELECT * FROM sprints WHERE id = ?').get(sprintId) as any;
      if (!row) return null;
    }

    const name = sprint?.name || 'Sprint';
    const reqs = this.db
      .prepare('SELECT status, created_at, updated_at FROM requirements WHERE sprint_id = ?')
      .all(sprintId) as { status: string; created_at: string; updated_at: string }[];

    const total = reqs.length;
    const completed = reqs.filter((r) => r.status === 'done').length;
    const inProgress = reqs.filter((r) => r.status === 'in_progress' || r.status === 'qa' || r.status === 'in_review').length;

    // Generate ideal vs actual burndown points
    const pointsIdeal = [
      { day: 'Day 1', remaining: total },
      { day: 'Day 5', remaining: Math.round(total * 0.6) },
      { day: 'Day 10', remaining: Math.round(total * 0.2) },
      { day: 'Day 14', remaining: 0 },
    ];

    const pointsActual = [
      { day: 'Day 1', remaining: total },
      { day: 'Current', remaining: total - completed },
    ];

    return {
      sprint_id: sprintId,
      sprint_name: name,
      total_requirements: total,
      completed_requirements: completed,
      in_progress_requirements: inProgress,
      backlog_rollover_rate: total > 0 ? Math.round(((total - completed) / total) * 100) : 0,
      points_ideal: pointsIdeal,
      points_actual: pointsActual,
    };
  }

  public getTelemetry(workspaceId?: string): AgentTelemetryData {
    const ws = workspaceId && workspaceId !== 'all' ? workspaceId : undefined;

    // Fetch repository projects registered in this workspace (or all if ws is not set)
    const projects = ws
      ? (this.db
          .prepare('SELECT name FROM projects WHERE workspace_id = ? ORDER BY name ASC')
          .all(ws) as { name: string }[])
      : (this.db
          .prepare('SELECT name FROM projects ORDER BY name ASC')
          .all() as { name: string }[]);

    // Filter bridge tasks strictly by registered projects in this workspace
    const tasks = ws
      ? (this.db
          .prepare(`
            SELECT b.project, b.status 
            FROM bridge_tasks b 
            JOIN projects p ON b.project = p.name 
            WHERE p.workspace_id = ?
          `)
          .all(ws) as { project: string; status: string }[])
      : (this.db
          .prepare('SELECT project, status FROM bridge_tasks')
          .all() as { project: string; status: string }[]);

    const totalTasks = tasks.length;
    const statusDist: Record<string, number> = {};
    const engineMap = new Map<string, { total: number; done: number; in_review: number; running: number; held: number }>();

    // Pre-populate with all known repository projects in this workspace
    for (const p of projects) {
      engineMap.set(p.name, { total: 0, done: 0, in_review: 0, running: 0, held: 0 });
    }

    for (const t of tasks) {
      statusDist[t.status] = (statusDist[t.status] || 0) + 1;

      if (!engineMap.has(t.project)) {
        if (!ws) {
          engineMap.set(t.project, { total: 0, done: 0, in_review: 0, running: 0, held: 0 });
        } else {
          continue;
        }
      }
      const p = engineMap.get(t.project)!;
      p.total++;
      if (t.status === 'done') p.done++;
      else if (t.status === 'in_review') p.in_review++;
      else if (t.status === 'running') p.running++;
      else if (t.status === 'held') p.held++;
    }

    // Links latency scoped to workspace
    const links = ws
      ? (this.db
          .prepare(`
            SELECT l.state, l.created_at, l.released_at 
            FROM links l
            JOIN bridge_tasks b ON l.task_id = b.id
            JOIN projects p ON b.project = p.name 
            WHERE p.workspace_id = ?
          `)
          .all(ws) as { state: string; created_at: string; released_at?: string }[])
      : (this.db
          .prepare('SELECT state, created_at, released_at FROM links')
          .all() as { state: string; created_at: string; released_at?: string }[]);

    const totalLinks = links.length;
    const releasedLinks = links.filter((l) => l.state === 'released').length;

    let totalLatencyMs = 0;
    let latencyCount = 0;

    for (const l of links) {
      if (l.released_at && l.created_at) {
        const diff = new Date(l.released_at).getTime() - new Date(l.created_at).getTime();
        if (diff > 0) {
          totalLatencyMs += diff;
          latencyCount++;
        }
      }
    }

    const avgBlockageLatencyMs = latencyCount > 0 ? Math.round(totalLatencyMs / latencyCount) : 0;

    return {
      total_tasks: totalTasks,
      status_distribution: statusDist,
      total_links: totalLinks,
      released_links: releasedLinks,
      avg_blockage_latency_ms: avgBlockageLatencyMs,
      engine_activity: Array.from(engineMap.entries()).map(([project, stats]) => ({
        project,
        ...stats,
      })),
    };
  }
}
