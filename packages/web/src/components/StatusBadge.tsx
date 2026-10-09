import { NormStatus, RequirementStatus } from '@sp-kickstack/shared';

const statusConfig: Record<
  string,
  { label: string; dot: string; className: string }
> = {
  draft: {
    label: 'TO DO',
    dot: 'bg-slate-400',
    className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/80',
  },
  pending: {
    label: 'PENDING',
    dot: 'bg-slate-400',
    className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/80',
  },
  ready: {
    label: 'READY',
    dot: 'bg-sky-500',
    className: 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/60',
  },
  queued: {
    label: 'QUEUED',
    dot: 'bg-cyan-500',
    className: 'bg-cyan-50 text-cyan-700 border-cyan-300 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/60',
  },
  running: {
    label: 'IN PROGRESS',
    dot: 'bg-purple-500 animate-pulse',
    className: 'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800/70',
  },
  in_progress: {
    label: 'IN PROGRESS',
    dot: 'bg-purple-500 animate-pulse',
    className: 'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800/70',
  },
  held: {
    label: 'WAITING / HELD',
    dot: 'bg-amber-500',
    className: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/70',
  },
  needs_human: {
    label: 'NEEDS HUMAN',
    dot: 'bg-orange-500',
    className: 'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800/70',
  },
  in_review: {
    label: 'IN REVIEW',
    dot: 'bg-blue-500',
    className: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800/70',
  },
  done: {
    label: 'COMPLETE',
    dot: 'bg-emerald-500',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/70',
  },
  failed: {
    label: 'FAILED',
    dot: 'bg-rose-500',
    className: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800/70',
  },
  cancelled: {
    label: 'CLOSED',
    dot: 'bg-slate-400',
    className: 'bg-slate-100 text-slate-400 border-slate-200 line-through dark:bg-slate-900 dark:text-slate-500 dark:border-slate-800',
  },
};

export function StatusBadge({
  status,
  size = 'sm',
}: {
  status: NormStatus | RequirementStatus | string;
  size?: 'xs' | 'sm' | 'md';
}) {
  const cfg = statusConfig[status] || {
    label: String(status).toUpperCase(),
    dot: 'bg-slate-400',
    className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  };

  const sizeClasses =
    size === 'xs'
      ? 'px-1.5 py-0.2 text-[9px]'
      : size === 'md'
      ? 'px-2.5 py-1 text-xs'
      : 'px-2 py-0.5 text-[10px]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-bold uppercase tracking-wider rounded border shadow-sm transition-colors ${cfg.className} ${sizeClasses}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      <span>{cfg.label}</span>
    </span>
  );
}
