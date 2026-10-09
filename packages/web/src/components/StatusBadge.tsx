import { NormStatus, RequirementStatus } from '@sp-kickstack/shared';

const statusStyles: Record<string, string> = {
  draft: 'bg-slate-800 text-slate-300 border-slate-700',
  ready: 'bg-sky-950/60 text-sky-300 border-sky-800',
  pending: 'bg-slate-800 text-slate-400 border-slate-700',
  queued: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  running: 'bg-blue-950 text-blue-300 border-blue-700 animate-pulse',
  in_progress: 'bg-blue-950 text-blue-300 border-blue-700',
  needs_human: 'bg-amber-950 text-amber-300 border-amber-700',
  held: 'bg-purple-950 text-purple-300 border-purple-700',
  in_review: 'bg-indigo-950 text-indigo-300 border-indigo-700',
  done: 'bg-emerald-950 text-emerald-300 border-emerald-700',
  failed: 'bg-rose-950 text-rose-300 border-rose-700',
  cancelled: 'bg-slate-900 text-slate-500 border-slate-800 line-through',
};

export function StatusBadge({ status }: { status: NormStatus | RequirementStatus | string }) {
  const style = statusStyles[status] || 'bg-slate-800 text-slate-400 border-slate-700';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {status}
    </span>
  );
}
