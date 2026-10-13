import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileDiff, MessageSquarePlus } from 'lucide-react';
import type { BridgeTask, TaskChangedFile, TaskDiffLine } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { fetchTaskChanges, fetchTaskFileDiff } from '../lib/humanLoopApi.js';
import { changeStatusLabel, changeSummary } from '../lib/reviewActions.js';

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
const button = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#2e303d]';

interface TaskChangedFilesProps {
  task: BridgeTask;
  /** The comment box is open (In Review / QA): offer "Comment on this file". */
  canComment: boolean;
  onComment: (path: string) => void;
}

/** A task card's "Changed files": what the agent committed on its branch, each with its diff. */
export function TaskChangedFiles({ task, canComment, onComment }: TaskChangedFilesProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<TaskChangedFile | null>(null);
  const { data } = useQuery({ queryKey: ['task-changes', task.id], queryFn: () => fetchTaskChanges(task.id), enabled: Boolean(task.branch) });
  if (!task.branch || !data || data.files.length === 0) return null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <FileDiff className="w-3 h-3" />
        <span>Changed files</span>
        <span className="normal-case tracking-normal font-semibold">{changeSummary(data)}</span>
      </button>
      {open && (
        <ul className="space-y-0.5">
          {data.files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => setFile(f)}
                title={`${changeStatusLabel(f.status)}${f.oldPath ? ` from ${f.oldPath}` : ''}`}
                className="w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left text-[11px] hover:bg-slate-100 dark:hover:bg-[#262732]"
              >
                <span className={`w-3 font-mono font-bold ${STATUS_STYLE[f.status]}`}>{f.status}</span>
                <span className="flex-1 min-w-0 truncate font-mono text-slate-700 dark:text-slate-300">{f.path}</span>
                {f.binary ? (
                  <span className="text-slate-400">binary</span>
                ) : (
                  <>
                    <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span>
                    <span className="text-rose-600 dark:text-rose-400">−{f.deletions}</span>
                  </>
                )}
              </button>
            </li>
          ))}
          {data.truncated && <li className="px-1.5 text-[10px] text-slate-400">More files changed than are listed.</li>}
        </ul>
      )}
      {file && (
        <FileDiffDialog
          task={task}
          base={data.base}
          file={file}
          canComment={canComment}
          onClose={() => setFile(null)}
          onComment={() => {
            onComment(file.path);
            setFile(null);
          }}
        />
      )}
    </div>
  );
}

function FileDiffDialog({ task, base, file, canComment, onClose, onComment }: {
  task: BridgeTask;
  base: string | null;
  file: TaskChangedFile;
  canComment: boolean;
  onClose: () => void;
  onComment: () => void;
}) {
  const { data, error, isLoading } = useQuery({ queryKey: ['task-file-diff', task.id, file.path], queryFn: () => fetchTaskFileDiff(task.id, file.path) });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all">{file.path}</DialogTitle>
          <DialogDescription>
            {changeStatusLabel(file.status)}
            {file.oldPath ? ` from ${file.oldPath}` : ''} on {task.branch}, compared with {base ?? 'its base branch'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-200 dark:border-[#2e303d] font-mono text-[11px]">
          {isLoading && <p className="p-3 text-slate-500">Loading the diff…</p>}
          {error && <p className="p-3 text-rose-600">{(error as Error).message}</p>}
          {data?.binary && <p className="p-3 text-slate-500">Binary file: no text diff.</p>}
          {data && !data.binary && data.lines.length === 0 && (
            <p className="p-3 text-slate-500">No content changes{file.status === 'R' ? ' (renamed only)' : ''}.</p>
          )}
          {data && data.lines.length > 0 && (
            <table className="w-full border-collapse">
              <tbody>
                {data.lines.map((line, i) => (
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
          {data?.truncated && <p className="p-3 text-slate-500">The diff is long: only its first lines are shown.</p>}
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className={button}>
            Close
          </button>
          {canComment && (
            <button type="button" onClick={onComment} className={`${button} bg-[#7b68ee] border-[#7b68ee] text-white`}>
              <MessageSquarePlus className="w-3.5 h-3.5" />
              Comment on this file
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
