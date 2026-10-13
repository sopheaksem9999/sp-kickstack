import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ScrollText, ShieldCheck } from 'lucide-react';
import type { BridgeTask, Requirement } from '@sp-kickstack/shared';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { LiveTaskLogsDrawer } from './LiveTaskLogsDrawer.js';
import { fetchRequirementQa, runAiQa } from '../lib/aiQaApi.js';
import { QA_TONE_STYLE, qaRunText, qaStatusLine, runAiQaBlocked } from '../lib/aiQa.js';

const RUN_BUTTON =
  'flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs font-bold shadow-xs active:scale-[0.98] transition-all disabled:opacity-50';

/** Requirement header, in QA: the AI QA status (each repository's run and log) and "Run AI QA". */
export function AiQaHeader({ req, buttonClassName }: { req: Requirement; buttonClassName?: string }) {
  const queryClient = useQueryClient();
  const inQa = req.status === 'qa';
  const { data: qa } = useQuery({
    queryKey: ['requirement-qa', req.id],
    queryFn: () => fetchRequirementQa(req.id),
    enabled: inQa,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const [logTask, setLogTask] = useState<BridgeTask | null>(null);
  const findings = qa?.findings.total ?? 0;
  useEffect(() => {
    // New findings are review comments on the repository cards.
    if (findings > 0) void queryClient.invalidateQueries({ queryKey: ['review-comments', req.id] });
  }, [findings, req.id, queryClient]);
  const run = useMutation({
    mutationFn: () => runAiQa(req.id),
    onSuccess: (next) => {
      queryClient.setQueryData(['requirement-qa', req.id], next);
      toast.success(`AI QA started for ${req.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  if (!inQa) return null;

  const line = qaStatusLine(qa);
  const blocked = runAiQaBlocked(req.status, qa);
  return (
    <>
      {line && qa && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" title={line.text} className={`max-w-xs truncate px-3 py-1.5 rounded-lg text-xs font-semibold ${QA_TONE_STYLE[line.tone]}`}>
              <ShieldCheck className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
              {line.text}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2 space-y-1">
            <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">AI QA · round {qa.round}</p>
            {qa.runs.map((r) => (
              <div key={r.task.id} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-slate-50 dark:hover:bg-[#262732]">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{r.project}</p>
                  <p className="text-[11px] text-slate-500 break-words">{qaRunText(r)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLogTask(r.task)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#7b68ee]"
                  title={`Open the AI QA log of ${r.project}`}
                >
                  <ScrollText className="w-3 h-3" />
                  Log
                </button>
              </div>
            ))}
            {qa.skipped.map((s) => (
              <p key={s.project} className="px-1.5 text-[11px] text-slate-500">
                Skipped {s.project}: {s.reason}
              </p>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={Boolean(blocked) || run.isPending}
        title={blocked ?? "Check every repository's merged code with an AI agent: acceptance criteria, code review, test / build / lint"}
        className={buttonClassName ?? RUN_BUTTON}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>{run.isPending ? 'Starting…' : 'Run AI QA'}</span>
      </button>
      <LiveTaskLogsDrawer task={logTask} isOpen={Boolean(logTask)} onClose={() => setLogTask(null)} />
    </>
  );
}
