import { useState, useMemo } from 'react';
import { Requirement, BridgeTask } from '@sp-kickstack/shared';
import { StatusBadge } from './StatusBadge.js';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  GitFork,
  Unlock,
} from 'lucide-react';

interface LinkRecord {
  id: number;
  task_id: number;
  depends_on_id?: number | null;
  dep_project?: string | null;
  dep_task_id?: number | null;
  dep_engine_task_id?: string | null;
  state: string;
  reason?: string | null;
  context_md?: string | null;
  released_at?: string | null;
}

interface DependencyGraphCanvasProps {
  requirement: Requirement;
  tasks: BridgeTask[];
  links: LinkRecord[];
  onReleaseLink?: (linkId: number) => void;
  isReleasing?: boolean;
}

interface NodePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'requirement' | 'goal' | 'ticket' | 'waiting';
  task?: BridgeTask;
  title: string;
  subtitle: string;
  status?: string;
  project?: string;
}

export function DependencyGraphCanvas({
  requirement,
  tasks,
  links,
  onReleaseLink,
  isReleasing,
}: DependencyGraphCanvasProps) {
  const [zoom, setZoom] = useState(1);

  // Layout calculation
  const { nodes, edges, canvasWidth, canvasHeight } = useMemo(() => {
    const nodeMap = new Map<string, NodePosition>();
    const nodeWidth = 240;
    const nodeHeight = 88;
    const colGap = 160;
    const rowGap = 32;

    // Col 0: Central Requirement Node
    const reqNode: NodePosition = {
      id: `req-${requirement.id}`,
      x: 40,
      y: 120,
      width: 260,
      height: 96,
      type: 'requirement',
      title: `${requirement.id}: ${requirement.title}`,
      subtitle: `Workspace: ${requirement.workspace_id || 'default'}`,
      status: requirement.status,
    };
    nodeMap.set(reqNode.id, reqNode);

    // Group tasks into Goal tasks (Col 1) and Ticket/Waiting tasks (Col 2)
    const goalTasks = tasks.filter((t) => t.role === 'goal');
    const childTasks = tasks.filter((t) => t.role !== 'goal');

    // Col 1: Goal Tasks per Project
    const col1X = reqNode.x + reqNode.width + colGap;
    const goalStartY = Math.max(40, reqNode.y - (goalTasks.length * (nodeHeight + rowGap)) / 2 + 50);

    goalTasks.forEach((task, idx) => {
      const gNode: NodePosition = {
        id: `task-${task.id}`,
        x: col1X,
        y: goalStartY + idx * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
        type: 'goal',
        task,
        title: task.title,
        subtitle: `Project: ${task.project} #${task.engine_task_id || task.id}`,
        status: task.status,
        project: task.project,
      };
      nodeMap.set(gNode.id, gNode);
    });

    // Col 2: Tickets & Dependent Tasks
    const col2X = col1X + nodeWidth + colGap;
    const childStartY = Math.max(40, goalStartY);

    childTasks.forEach((task, idx) => {
      const cNode: NodePosition = {
        id: `task-${task.id}`,
        x: col2X,
        y: childStartY + idx * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
        type: task.role === 'waiting' ? 'waiting' : 'ticket',
        task,
        title: task.title,
        subtitle: `${task.role.toUpperCase()} ➔ ${task.project}`,
        status: task.status,
        project: task.project,
      };
      nodeMap.set(cNode.id, cNode);
    });

    // Compute dynamic canvas dimensions
    const allNodes = Array.from(nodeMap.values());
    const maxX = Math.max(...allNodes.map((n) => n.x + n.width), 900) + 80;
    const maxY = Math.max(...allNodes.map((n) => n.y + n.height), 450) + 80;

    // Edges:
    // 1. Requirement ➔ Goal Tasks
    const computedEdges: Array<{
      id: string;
      from: NodePosition;
      to: NodePosition;
      type: 'fanout' | 'link';
      link?: LinkRecord;
    }> = [];

    goalTasks.forEach((gt) => {
      const target = nodeMap.get(`task-${gt.id}`);
      if (target) {
        computedEdges.push({
          id: `fanout-${gt.id}`,
          from: reqNode,
          to: target,
          type: 'fanout',
        });
      }
    });

    // 2. Links between tasks
    links.forEach((link) => {
      const source = nodeMap.get(`task-${link.task_id}`);
      const depTargetId = link.depends_on_id ? `task-${link.depends_on_id}` : null;
      const target = depTargetId ? nodeMap.get(depTargetId) : null;

      if (source && target) {
        computedEdges.push({
          id: `link-${link.id}`,
          from: source,
          to: target,
          type: 'link',
          link,
        });
      }
    });

    return {
      nodes: allNodes,
      edges: computedEdges,
      canvasWidth: maxX,
      canvasHeight: maxY,
    };
  }, [requirement, tasks, links]);

  return (
    <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl shadow-sm overflow-hidden flex flex-col">
      {/* Canvas Header & Toolbar */}
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/60 dark:bg-[#15161f]">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
          <GitFork className="w-4 h-4 text-[#7b68ee]" />
          <span>Interactive Dependency DAG & Fan-Out Topology</span>
          <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300">
            {nodes.length} nodes · {edges.length} edges
          </span>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1.5 bg-white dark:bg-[#1f202b] border border-slate-200 dark:border-[#2c2d3a] rounded-lg p-0.5 shadow-2xs">
          <button
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#282936] rounded text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[11px] px-1 text-slate-500 min-w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#282936] rounded text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#282936] rounded text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
            title="Reset Zoom"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative overflow-auto max-h-[550px] p-6 bg-slate-50/30 dark:bg-[#12131a]">
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            width: canvasWidth,
            height: canvasHeight,
          }}
          className="relative transition-transform duration-150"
        >
          {/* SVG Connection Layer */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={canvasWidth}
            height={canvasHeight}
          >
            <defs>
              <marker
                id="arrow-fanout"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 8 5 L 0 9 z" fill="#7b68ee" />
              </marker>
              <marker
                id="arrow-link-waiting"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 8 5 L 0 9 z" fill="#f59e0b" />
              </marker>
              <marker
                id="arrow-link-released"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 8 5 L 0 9 z" fill="#10b981" />
              </marker>
            </defs>

            {edges.map((edge) => {
              const startX = edge.from.x + edge.from.width;
              const startY = edge.from.y + edge.from.height / 2;
              const endX = edge.to.x;
              const endY = edge.to.y + edge.to.height / 2;

              // Cubic Bezier curve
              const controlOffset = Math.abs(endX - startX) * 0.5;
              const pathD = `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;

              const isLink = edge.type === 'link';
              const linkState = edge.link?.state || 'waiting';

              const strokeColor = !isLink
                ? '#7b68ee'
                : linkState === 'released'
                ? '#10b981'
                : linkState === 'ready'
                ? '#0284c7'
                : '#f59e0b';

              const markerId = !isLink
                ? 'url(#arrow-fanout)'
                : linkState === 'released'
                ? 'url(#arrow-link-released)'
                : 'url(#arrow-link-waiting)';

              return (
                <g key={edge.id}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isLink ? 2.5 : 1.75}
                    strokeDasharray={isLink && linkState !== 'released' ? '5,5' : undefined}
                    markerEnd={markerId}
                    className="opacity-75"
                  />
                </g>
              );
            })}
          </svg>

          {/* Render Interactive Nodes */}
          {nodes.map((node) => {
            const isReq = node.type === 'requirement';
            const isWaiting = node.type === 'waiting';

            return (
              <div
                key={node.id}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                }}
                className={`absolute p-3 rounded-xl border shadow-sm transition-all select-none ${
                  isReq
                    ? 'bg-purple-50/80 dark:bg-purple-950/30 border-[#7b68ee] ring-2 ring-[#7b68ee]/20'
                    : isWaiting
                    ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-900/60'
                    : 'bg-white dark:bg-[#1b1c26] border-slate-200 dark:border-[#282936] hover:border-slate-400 dark:hover:border-slate-500'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider truncate ${
                      isReq
                        ? 'text-[#7b68ee]'
                        : isWaiting
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {isReq ? 'CENTRAL REQUIREMENT' : node.subtitle}
                  </span>
                  {node.status && <StatusBadge status={node.status as any} size="xs" />}
                </div>

                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-tight">
                  {node.title}
                </p>

                {node.project && (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>repo: {node.project}</span>
                    {node.task?.role && <span>role: {node.task.role}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* DAG Legend & Quick Link Action Footer */}
      <div className="px-5 py-3 border-t border-slate-200 dark:border-[#262732] bg-slate-50/70 dark:bg-[#15161f] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#7b68ee] rounded-full inline-block" />
            <span>Fan-Out Dispatch</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-500 border-dashed inline-block" />
            <span>Blocking xticket (Held)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-500 rounded-full inline-block" />
            <span>Released / Unblocked</span>
          </div>
        </div>

        {/* Interactive Link Release Action if any active link exists */}
        {links.some((l) => l.state !== 'released') && onReleaseLink && (
          <div className="flex items-center gap-2">
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              {links.filter((l) => l.state !== 'released').length} held link(s)
            </span>
            {links
              .filter((l) => l.state !== 'released')
              .slice(0, 1)
              .map((link) => (
                <button
                  key={link.id}
                  onClick={() => onReleaseLink(link.id)}
                  disabled={isReleasing}
                  className="flex items-center gap-1 px-3 py-1 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-300 hover:bg-sky-100 rounded-lg font-bold border border-sky-200 dark:border-sky-800 transition-colors"
                >
                  <Unlock className="w-3 h-3 text-sky-500" />
                  <span>Release Link #{link.id}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
