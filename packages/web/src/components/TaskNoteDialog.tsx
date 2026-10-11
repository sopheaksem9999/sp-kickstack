import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquarePlus } from 'lucide-react';
import type { BridgeTask } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog.js';
import { sendTaskNote } from '../lib/humanLoopApi.js';

/** "Note" button + dialog: send a message to a task's running agent. */
export function TaskNoteDialog({ task }: { task: Pick<BridgeTask, 'id' | 'project'> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const mutation = useMutation({
    mutationFn: () => sendTaskNote(task.id, body.trim()),
    onSuccess: () => {
      toast.success(`Note sent to the ${task.project} agent`);
      setBody('');
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-100 dark:bg-indigo-950/40 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 transition-colors"
          title="Send a message to this task's agent while it works"
        >
          <MessageSquarePlus className="w-3 h-3" />
          <span>Note</span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Note to the {task.project} agent</DialogTitle>
          <DialogDescription>The agent receives it as a note on its task. Whether it reads it right away depends on its engine.</DialogDescription>
        </DialogHeader>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={4000}
          aria-label="Note for the agent"
          placeholder="For example: use the v2 endpoint, the v1 one is being removed."
          className="w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] p-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#7b68ee]/40"
        />
        <DialogFooter>
          <button
            type="button"
            disabled={!body.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-3.5 py-2 rounded-lg bg-[#7b68ee] hover:bg-[#6a5acd] text-white text-xs font-bold disabled:opacity-40"
          >
            Send note
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
