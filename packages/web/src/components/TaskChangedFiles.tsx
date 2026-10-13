import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileDiff, MessageSquarePlus } from 'lucide-react';
import type { BridgeTask, TaskChangedFile } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { ChangedFileRow, DiffView } from './DiffView.js';
import { fetchTaskChanges, fetchTaskFileDiff } from '../lib/humanLoopApi.js';
import { changeStatusLabel, changeSummary } from '../lib/reviewActions.js';

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
              <ChangedFileRow file={f} onClick={() => setFile(f)} />
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
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-200 dark:border-[#2e303d]">
          <DiffView diff={data} error={error} isLoading={isLoading} renamedOnly={file.status === 'R'} />
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
