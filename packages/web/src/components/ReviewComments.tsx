import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, MessageSquare, RotateCcw, Send, Trash2 } from 'lucide-react';
import type { BridgeTask, Requirement, ReviewComment } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { addReviewComment, deleteReviewComment, fetchReviewComments, requestChanges, updateReviewComment } from '../lib/humanLoopApi.js';
import { commentLocation, requestChangesOutcome, requestChangesState, reviewableTasks, taskReviewView } from '../lib/reviewActions.js';
import { hasPin, requestChangesProfile } from '../lib/agentProfile.js';
import type { ProfileValue } from '../lib/agentProfile.js';
import { AgentProfilePicker } from './AgentProfilePicker.js';

const STATE_STYLE: Record<ReviewComment['state'], string> = {
  open: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  sent: 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300',
  resolved: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
};

const KEEP: ProfileValue = { model: null, effort: null };

/** The requirement's review comments (one query shared by every task card) and a refresh after changes. */
function useReviewComments(reqId: string) {
  const queryClient = useQueryClient();
  const { data: comments = [] } = useQuery({ queryKey: ['review-comments', reqId], queryFn: () => fetchReviewComments(reqId) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['review-comments', reqId] });
    queryClient.invalidateQueries({ queryKey: ['requirement', reqId] });
    queryClient.invalidateQueries({ queryKey: ['requirement-graph', reqId] });
  };
  return { comments, refresh };
}

const fail = (err: Error) => toast.error(err.message);

/** A repository task card's review comments and comment box (In Review / QA). */
export function TaskReviewComments({ req, task }: { req: Requirement; task: BridgeTask }) {
  const { comments, refresh } = useReviewComments(req.id);
  const view = taskReviewView(req, task, comments);
  const [filePath, setFilePath] = useState('');
  const [line, setLine] = useState('');
  const [body, setBody] = useState('');

  const add = useMutation({
    mutationFn: () =>
      addReviewComment(req.id, {
        task_id: task.id,
        body: body.trim(),
        file_path: filePath.trim() || undefined,
        line: filePath.trim() && line.trim() ? Number(line) : undefined,
      }),
    onSuccess: () => {
      setBody('');
      setLine('');
      refresh();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (v: { id: number; state: 'open' | 'resolved' }) => updateReviewComment(v.id, { state: v.state }),
    onSuccess: refresh,
    onError: fail,
  });
  const remove = useMutation({ mutationFn: (id: number) => deleteReviewComment(id), onSuccess: refresh, onError: fail });

  if (!view.show) return null;
  const input = 'rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2 py-1.5 text-xs';

  return (
    <div className="pt-2 border-t border-slate-100 dark:border-[#2d2d2d] space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
        <MessageSquare className="w-3 h-3" />
        <span>Review comments{view.comments.length ? ` (${view.comments.length})` : ''}</span>
      </div>

      {view.comments.map((c) => (
        <div key={c.id} className="rounded-lg border border-slate-200 dark:border-[#262732] bg-white dark:bg-[#1a1b23] p-2 text-xs space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] text-slate-500 dark:text-slate-400">{commentLocation(c)}</code>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATE_STYLE[c.state]}`}>
              {c.state}
              {c.round ? ` · round ${c.round}` : ''}
            </span>
            <span className="flex-1" />
            {c.state !== 'resolved' ? (
              <button
                type="button"
                onClick={() => update.mutate({ id: c.id, state: 'resolved' })}
                className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600"
                title="Mark as resolved"
              >
                <CheckCircle2 className="w-3 h-3" />
                Resolve
              </button>
            ) : (
              <button
                type="button"
                onClick={() => update.mutate({ id: c.id, state: 'open' })}
                className="flex items-center gap-1 text-[10px] font-semibold text-amber-600"
                title="Reopen: it is sent again with the next request"
              >
                <RotateCcw className="w-3 h-3" />
                Reopen
              </button>
            )}
            {c.state === 'open' && (
              <button
                type="button"
                onClick={() => remove.mutate(c.id)}
                aria-label="Delete comment"
                className="text-slate-400 hover:text-rose-500"
                title="Delete comment"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}

      {view.canAdd && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              aria-label={`File for ${task.project}`}
              placeholder="File (optional), e.g. src/api/users.ts"
              className={`flex-1 min-w-0 ${input}`}
            />
            <input
              value={line}
              onChange={(e) => setLine(e.target.value.replace(/[^0-9]/g, ''))}
              aria-label={`Line for ${task.project}`}
              placeholder="Line"
              inputMode="numeric"
              disabled={!filePath.trim()}
              className={`w-16 ${input} disabled:opacity-40`}
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={4000}
            aria-label={`Comment for ${task.project}`}
            placeholder="What should the agent change?"
            className={`w-full ${input}`}
          />
          <button
            type="button"
            disabled={!body.trim() || add.isPending}
            onClick={() => add.mutate()}
            className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-bold disabled:opacity-40"
          >
            Add comment
          </button>
        </div>
      )}
    </div>
  );
}

/** "Request changes (N)": sends every open comment, across repositories, as one round (In Review / QA). */
export function RequestChangesButton({ req, tasks }: { req: Requirement; tasks: BridgeTask[] }) {
  const { comments, refresh } = useReviewComments(req.id);
  const [confirming, setConfirming] = useState(false);
  const [profile, setProfile] = useState<ProfileValue>(KEEP);
  const [clearPins, setClearPins] = useState(false);
  // The tasks "Request changes" sends back are the ones with an open comment; a pin on any of them can be cleared here.
  const openTaskIds = new Set(comments.filter((c) => c.state === 'open').map((c) => c.task_id));
  const anyPinned = reviewableTasks(tasks).some((t) => openTaskIds.has(t.id) && hasPin(t));
  // A Clear pins ticked before the pins went away (the tasks refreshed) must not stay in effect.
  const clearing = clearPins && anyPinned;

  // Every way out of the dialog (Keep reviewing, Escape, a click outside, a send) lands here, so a pick never leaks into the next round.
  const closeDialog = () => {
    setConfirming(false);
    setProfile(KEEP);
    setClearPins(false);
  };

  const send = useMutation({
    mutationFn: (body: ReturnType<typeof requestChangesProfile>) => requestChanges(req.id, undefined, body),
    onSuccess: (result) => {
      const outcome = requestChangesOutcome(result);
      toast[outcome.kind](outcome.message);
      closeDialog();
      refresh();
    },
    onError: (err: Error) => {
      closeDialog();
      fail(err);
    },
  });

  if (req.status !== 'in_review' && req.status !== 'qa') return null;
  const state = requestChangesState(req, comments);

  return (
    <div className="flex items-center gap-2">
      {!state.ok && state.reason && <span className="text-[10px] text-slate-400">{state.reason}</span>}
      <button
        type="button"
        disabled={!state.ok || send.isPending}
        onClick={() => setConfirming(true)}
        title={state.reason}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold disabled:opacity-40"
      >
        <Send className="w-3 h-3" />
        <span>Request changes{state.open ? ` (${state.open})` : ''}</span>
      </button>

      <Dialog open={confirming} onOpenChange={(open) => (open ? setConfirming(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request changes?</DialogTitle>
            <DialogDescription>
              {state.open} open {state.open === 1 ? 'comment goes' : 'comments go'} to {state.tasks} {state.tasks === 1 ? 'agent' : 'agents'}. Each starts a new run on
              the same branch{req.status === 'qa' ? '; the merge is redone afterwards' : ''}, and {req.id} moves back to In Progress.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Pin a model for the tasks sent back (optional)</div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">The pin stays for later runs of those tasks until you clear it.</p>
            <AgentProfilePicker
              value={profile}
              onChange={setProfile}
              disabled={clearing}
              defaultLabel="Keep each task's setting"
              defaultChipLabel="Keep"
              className="w-full justify-between max-w-none rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-3 py-2"
            />
            {anyPinned && (
              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={clearPins} onChange={(e) => setClearPins(e.target.checked)} className="accent-[#7b68ee]" />
                <span>Clear pins (use the requirement's or workspace's setting)</span>
              </label>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={closeDialog}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs font-semibold"
            >
              Keep reviewing
            </button>
            <button
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate(requestChangesProfile(profile, clearPins, anyPinned))}
              className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-40"
            >
              Send to agents
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
