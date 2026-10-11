import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, HelpCircle, Send, Sparkles, XCircle } from 'lucide-react';
import type { AgentQuestion } from '@sp-kickstack/shared';
import { answerQuestion, fetchQuestions } from '../lib/humanLoopApi.js';
import { LET_AGENT_DECIDE, answerSentText, askerStateText, orderQuestions } from '../lib/questions.js';

/** Questions agents asked on this requirement; open ones are answered here and the answer goes to the agent. */
export function AgentQuestionsPanel({ reqId }: { reqId: string }) {
  const { data: questions = [] } = useQuery({ queryKey: ['questions', reqId], queryFn: () => fetchQuestions({ reqId }) });
  if (questions.length === 0) return null;

  const ordered = orderQuestions(questions);
  const waiting = ordered.filter((q) => q.status === 'open').length;
  return (
    <section className="bg-white dark:bg-[#181922] border border-amber-300 dark:border-amber-800/50 rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
        <HelpCircle className="w-4 h-4" />
        <span>Questions from agents</span>
        {waiting > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-[10px] normal-case tracking-normal">
            {waiting} waiting for you
          </span>
        )}
      </div>
      <div className="space-y-3">
        {ordered.map((q) => (
          <QuestionCard key={q.id} question={q} />
        ))}
      </div>
    </section>
  );
}

function QuestionCard({ question }: { question: AgentQuestion }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const mutation = useMutation({
    mutationFn: (input: { option?: string; answer?: string }) => answerQuestion(question.id, input),
    onSuccess: (result) => {
      toast.success(answerSentText(result.delivered));
      setText('');
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['requirement-graph', question.req_id] });
      queryClient.invalidateQueries({ queryKey: ['review-comments', question.req_id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (question.status !== 'open') {
    const Icon = question.status === 'answered' ? CheckCircle2 : XCircle;
    return (
      <div className="rounded-xl border border-slate-200 dark:border-[#262732] p-3 text-xs space-y-1">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <Icon className={`w-3.5 h-3.5 ${question.status === 'answered' ? 'text-emerald-500' : 'text-slate-400'}`} />
          <span className="font-semibold">{question.project}</span>
          <span>· {question.status}</span>
        </div>
        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{question.question}</p>
        {question.answer && <p className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap">→ {question.answer}</p>}
      </div>
    );
  }

  const busy = mutation.isPending;
  const note = text.trim();
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
      <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{askerStateText(question)}</div>
      <p className="text-sm font-semibold text-slate-900 dark:text-white whitespace-pre-wrap">{question.question}</p>
      {question.details && <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{question.details}</p>}
      {question.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {question.options.map((option) => (
            <button
              key={option}
              disabled={busy}
              onClick={() => mutation.mutate({ option, answer: note || undefined })}
              className="px-3 py-1.5 rounded-lg bg-[#7b68ee] hover:bg-[#6a5acd] text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder={question.options.length ? 'Optional: add a note to your choice, or write a different answer' : 'Write your answer'}
        className="w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] p-2 text-xs text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#7b68ee]/40"
      />
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !note}
          onClick={() => mutation.mutate({ answer: note })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send answer</span>
        </button>
        <button
          disabled={busy}
          onClick={() => mutation.mutate({ answer: LET_AGENT_DECIDE })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#262732] disabled:opacity-40"
          title="The agent picks what it thinks is best and says so in its report"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Let the agent decide</span>
        </button>
      </div>
    </div>
  );
}
