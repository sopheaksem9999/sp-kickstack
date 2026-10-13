import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { GitCompare } from 'lucide-react';
import type { BridgeTask, Requirement, TaskChangedFile } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.js';
import { ChangedFileRow, DiffView } from './DiffView.js';
import { fetchTaskChanges, fetchTaskFileDiff } from '../lib/humanLoopApi.js';
import { changeStatusLabel, changeSummary, gitReviewHeadline, gitReviewTasks } from '../lib/reviewActions.js';

const DEFAULT_BUTTON =
  'flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-xs active:scale-[0.98] transition-all';

/** "Git Review": what the requirement's branches change, per repository, with each file's diff. */
export function RequirementGitReviewButton({ req, tasks, className }: { req: Requirement; tasks: BridgeTask[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const branched = gitReviewTasks(tasks);
  if (branched.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? DEFAULT_BUTTON} title="See what this requirement's branches change, file by file">
        <GitCompare className="w-3.5 h-3.5" />
        <span>Git Review</span>
      </button>
      {open && <RequirementGitReviewDialog req={req} tasks={branched} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequirementGitReviewDialog({ req, tasks, onClose }: { req: Requirement; tasks: BridgeTask[]; onClose: () => void }) {
  const changes = useQueries({ queries: tasks.map((t) => ({ queryKey: ['task-changes', t.id], queryFn: () => fetchTaskChanges(t.id) })) });
  const [picked, setPicked] = useState<{ task: BridgeTask; file: TaskChangedFile } | null>(null);
  const firstIndex = changes.findIndex((c) => (c.data?.files.length ?? 0) > 0);
  const current = picked ?? (firstIndex >= 0 ? { task: tasks[firstIndex], file: changes[firstIndex].data!.files[0] } : null);
  const diff = useQuery({
    queryKey: ['task-file-diff', current?.task.id, current?.file.path],
    queryFn: () => fetchTaskFileDiff(current!.task.id, current!.file.path),
    enabled: Boolean(current),
  });
  const headline = gitReviewHeadline(
    req.id,
    tasks.map((t, i) => ({ merged: Boolean(t.merged_at), base: changes[i].data?.base ?? null }))
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Git Review · {req.id}</DialogTitle>
          <DialogDescription>{headline}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(260px,1fr)_2fr] gap-3">
          <div className="min-h-0 overflow-auto space-y-4 pr-1">
            {tasks.map((t, i) => {
              const result = changes[i];
              return (
                <section key={t.id} className="space-y-1">
                  <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                    <span className="uppercase">{t.project}</span>
                    <span className="font-normal text-slate-500">
                      {' · '}
                      <span className="font-mono">{t.branch}</span> → <span className="font-mono">{result.data?.base ?? '…'}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        t.merged_at
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                      }`}
                    >
                      {t.merged_at ? 'merged ✓' : 'to merge'}
                    </span>
                    {result.data && <span className="text-slate-500">{changeSummary(result.data)}</span>}
                    {t.role === 'ticket' && <span className="text-slate-400">ticket #{t.id}</span>}
                  </div>
                  {result.isLoading && <p className="text-[11px] text-slate-500">Loading…</p>}
                  {Boolean(result.error) && <p className="text-[11px] text-rose-600">{(result.error as Error).message}</p>}
                  {result.data && result.data.files.length === 0 && <p className="text-[11px] text-slate-500">No committed changes.</p>}
                  <ul className="space-y-0.5">
                    {result.data?.files.map((f) => (
                      <li key={f.path}>
                        <ChangedFileRow
                          file={f}
                          active={current?.task.id === t.id && current.file.path === f.path}
                          onClick={() => setPicked({ task: t, file: f })}
                        />
                      </li>
                    ))}
                  </ul>
                  {result.data?.truncated && <p className="text-[10px] text-slate-400">More files changed than are listed.</p>}
                </section>
              );
            })}
          </div>
          <div className="min-h-0 flex flex-col rounded-lg border border-slate-200 dark:border-[#2e303d]">
            {current ? (
              <>
                <div className="px-3 py-1.5 border-b border-slate-200 dark:border-[#2e303d] text-[11px]">
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 break-all">{current.file.path}</span>
                  <span className="text-slate-500">
                    {' · '}
                    {current.task.project} · {changeStatusLabel(current.file.status)}
                    {current.file.oldPath ? ` from ${current.file.oldPath}` : ''}
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  <DiffView diff={diff.data} error={diff.error} isLoading={diff.isLoading} renamedOnly={current.file.status === 'R'} />
                </div>
              </>
            ) : (
              <p className="p-3 text-xs text-slate-500">{changes.some((c) => c.isLoading) ? 'Loading…' : 'No committed changes to show.'}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
