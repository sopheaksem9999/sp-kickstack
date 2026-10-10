import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { fetchQuestions } from '../lib/humanLoopApi.js';
import { orderQuestions } from '../lib/questions.js';

/** Header shortcut to every agent waiting for an answer, across requirements. Hidden when none wait. */
export function OpenQuestionsButton() {
  const [open, setOpen] = useState(false);
  const { data: questions = [] } = useQuery({
    queryKey: ['questions', 'open'],
    queryFn: () => fetchQuestions({ status: 'open' }),
    refetchInterval: 30_000,
  });
  if (questions.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Agents waiting for your answer"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-xs font-bold hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Waiting for your answer</div>
        <ul className="max-h-80 overflow-y-auto">
          {orderQuestions(questions).map((q) => (
            <li key={q.id}>
              <Link
                to={`/requirements/${q.req_id}`}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2 py-2 hover:bg-slate-100 dark:hover:bg-[#262732]"
              >
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {q.req_id} · {q.project}
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 line-clamp-2">{q.question}</div>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
