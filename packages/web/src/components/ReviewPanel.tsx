import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, MessageSquare, RotateCcw, Send, Trash2 } from 'lucide-react';
import type { BridgeTask, Requirement, ReviewComment } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { addReviewComment, deleteReviewComment, fetchReviewComments, requestChanges, updateReviewComment } from '../lib/humanLoopApi.js';
import { commentLocation, requestChangesOutcome, requestChangesState, reviewableTasks } from '../lib/reviewActions.js';
import { profilePatch } from '../lib/agentProfile.js';
import type { ProfileValue } from '../lib/agentProfile.js';
import { AgentProfilePicker } from './AgentProfilePicker.js';

const STATE_STYLE: Record<ReviewComment['state'], string> = {
  open: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  sent: 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300',
  resolved: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
};

/** Reviewer comments per task and "Request changes" (a new agent run on the same branch). */
export function ReviewPanel({ req, tasks }: { req: Requirement; tasks: BridgeTask[] }) {
  const queryClient = useQueryClient();
  const { data: comments = [] } = useQuery({ queryKey: ['review-comments', req.id], queryFn: () => fetchReviewComments(req.id) });
  const candidates = reviewableTasks(tasks);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [filePath, setFilePath] = useState('');
  const [line, setLine] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [profile, setProfile] = useState<ProfileValue>({ model: null, effort: null });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['review-comments', req.id] });
    queryClient.invalidateQueries({ queryKey: ['requirement', req.id] });
    queryClient.invalidateQueries({ queryKey: ['requirement-graph', req.id] });
  };
  const fail = (err: Error) => toast.error(err.message);

  const add = useMutation({
    mutationFn: () =>
      addReviewComment(req.id, {
        task_id: (taskId ?? candidates[0]?.id)!,
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
  const send = useMutation({
    mutationFn: () => requestChanges(req.id, undefined, profilePatch(profile)),
    onSuccess: (result) => {
      const outcome = requestChangesOutcome(result);
      toast[outcome.kind](outcome.message);
      setConfirming(false);
      setProfile({ model: null, effort: null });
      refresh();
    },
    onError: (err: Error) => {
      setConfirming(false);
      fail(err);
    },
  });

  const inReview = req.status === 'in_review' || req.status === 'qa';
  if (!inReview && comments.length === 0) return null;
  if (candidates.length === 0) return null;

  const selected = taskId ?? candidates[0].id;
  const state = requestChangesState(req, comments);
  const byTask = candidates.map((t) => ({ task: t, comments: comments.filter((c) => c.task_id === t.id) }));

  return (
    <section className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          <MessageSquare className="w-4 h-4" />
          <span>Review comments</span>
        </div>
        <button
          type="button"
          disabled={!state.ok || send.isPending}
          onClick={() => setConfirming(true)}
          title={state.reason}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Request changes{state.open ? ` (${state.open})` : ''}</span>
        </button>
      </div>
      {!state.ok && state.reason && <p className="text-[11px] text-slate-500 dark:text-slate-400">{state.reason}</p>}

      <div className="space-y-2 rounded-xl border border-slate-200 dark:border-[#262732] p-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Task">
          {candidates.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected === t.id}
              onClick={() => setTaskId(t.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                selected === t.id
                  ? 'bg-[#7b68ee] border-[#7b68ee] text-white'
                  : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#262732]'
              }`}
            >
              {t.project} · #{t.id}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            aria-label="File"
            placeholder="File (optional), e.g. src/api/users.ts"
            className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2 py-1.5 text-xs"
          />
          <input
            value={line}
            onChange={(e) => setLine(e.target.value.replace(/[^0-9]/g, ''))}
            aria-label="Line"
            placeholder="Line"
            inputMode="numeric"
            disabled={!filePath.trim()}
            className="w-20 rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2 py-1.5 text-xs disabled:opacity-40"
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          aria-label="Comment"
          placeholder="What should the agent change?"
          className="w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] p-2 text-xs"
        />
        <button
          type="button"
          disabled={!body.trim() || add.isPending}
          onClick={() => add.mutate()}
          className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold disabled:opacity-40"
        >
          Add comment
        </button>
      </div>

      {byTask
        .filter((g) => g.comments.length > 0)
        .map((g) => (
          <div key={g.task.id} className="space-y-2">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              {g.task.project} · #{g.task.id} · {g.task.status}
            </div>
            {g.comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 dark:border-[#262732] p-2.5 text-xs space-y-1">
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
          </div>
        ))}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request changes?</DialogTitle>
            <DialogDescription>
              {state.open} open {state.open === 1 ? 'comment goes' : 'comments go'} to {state.tasks} {state.tasks === 1 ? 'agent' : 'agents'}. Each starts a new run on
              the same branch{req.status === 'qa' ? '; the merge is redone afterwards' : ''}, and {req.id} moves back to In Progress.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Model for this round (optional)</div>
            <AgentProfilePicker
              value={profile}
              onChange={setProfile}
              defaultLabel="Keep each task's setting"
              className="w-full justify-between max-w-none rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-3 py-2"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs font-semibold"
            >
              Keep reviewing
            </button>
            <button
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate()}
              className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-40"
            >
              Send to agents
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
