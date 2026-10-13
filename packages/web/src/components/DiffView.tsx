import type { TaskChangedFile, TaskDiffLine, TaskFileDiff } from '@sp-kickstack/shared';
import { cn } from './ui/sheet.js';
import { changeStatusLabel } from '../lib/reviewActions.js';

const STATUS_STYLE: Record<TaskChangedFile['status'], string> = {
  A: 'text-emerald-600 dark:text-emerald-400',
  M: 'text-amber-600 dark:text-amber-400',
  D: 'text-rose-600 dark:text-rose-400',
  R: 'text-sky-600 dark:text-sky-400',
};
const LINE_STYLE: Record<TaskDiffLine['type'], string> = {
  add: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200',
  del: 'bg-rose-50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200',
  hunk: 'bg-slate-100 dark:bg-[#20212b] text-slate-500',
  context: 'text-slate-700 dark:text-slate-300',
};
const SIGN: Record<TaskDiffLine['type'], string> = { add: '+', del: '−', hunk: '', context: ' ' };

/** One changed file in a list: status letter, path, added / removed lines. */
export function ChangedFileRow({ file, active, onClick }: { file: TaskChangedFile; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      title={`${changeStatusLabel(file.status)}${file.oldPath ? ` from ${file.oldPath}` : ''}`}
      className={cn(
        'w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left text-[11px] hover:bg-slate-100 dark:hover:bg-[#262732]',
        active && 'bg-[#7b68ee]/10'
      )}
    >
      <span className={`w-3 font-mono font-bold ${STATUS_STYLE[file.status]}`}>{file.status}</span>
      <span className="flex-1 min-w-0 truncate font-mono text-slate-700 dark:text-slate-300">{file.path}</span>
      {file.binary ? (
        <span className="text-slate-400">binary</span>
      ) : (
        <>
          <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
          <span className="text-rose-600 dark:text-rose-400">−{file.deletions}</span>
        </>
      )}
    </button>
  );
}

/** A file's diff on a task branch: numbered green / red lines, or why there is nothing to show. */
export function DiffView({ diff, error, isLoading, renamedOnly }: { diff?: TaskFileDiff; error?: unknown; isLoading: boolean; renamedOnly?: boolean }) {
  return (
    <div className="font-mono text-[11px]">
      {isLoading && <p className="p-3 text-slate-500">Loading the diff…</p>}
      {Boolean(error) && <p className="p-3 text-rose-600">{(error as Error).message}</p>}
      {diff?.binary && <p className="p-3 text-slate-500">Binary file: no text diff.</p>}
      {diff && !diff.binary && diff.lines.length === 0 && <p className="p-3 text-slate-500">No content changes{renamedOnly ? ' (renamed only)' : ''}.</p>}
      {diff && diff.lines.length > 0 && (
        <table className="w-full border-collapse">
          <tbody>
            {diff.lines.map((line, i) => (
              <tr key={i} className={LINE_STYLE[line.type]}>
                <td className="w-10 px-2 text-right text-slate-400 select-none align-top">{line.oldLine ?? ''}</td>
                <td className="w-10 px-2 text-right text-slate-400 select-none align-top">{line.newLine ?? ''}</td>
                <td className="px-2 whitespace-pre-wrap break-all">
                  {SIGN[line.type]}
                  {line.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {diff?.truncated && <p className="p-3 text-slate-500">The diff is long: only its first lines are shown.</p>}
    </div>
  );
}
