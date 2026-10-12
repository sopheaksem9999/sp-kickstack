import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import type { BridgeTask } from '@sp-kickstack/shared';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { AgentProfileFields } from './AgentProfilePicker.js';
import { retryTaskWith } from '../lib/humanLoopApi.js';
import { retryOutcome } from '../lib/taskActions.js';
import { describeProfile, retryBody } from '../lib/agentProfile.js';
import type { ProfileValue } from '../lib/agentProfile.js';

const KEEP: ProfileValue = { model: null, effort: null };

/** Chevron next to "Retry": send the task again with a different model or effort (pinned on the task). */
export function RetryWithProfile({ task }: { task: Pick<BridgeTask, 'id' | 'req_id' | 'model_override' | 'effort_override'> }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ProfileValue>(KEEP);
  const [clearPin, setClearPin] = useState(false);
  const pin = describeProfile({ model: task.model_override, effort: task.effort_override });
  const hasPin = pin !== '';
  // A Clear pin ticked before the pin went away (the task refreshed) must not stay in effect.
  const clearing = clearPin && hasPin;

  // Radix does not call onOpenChange for a programmatic close, so every close path goes through here.
  const reset = () => {
    setValue(KEEP);
    setClearPin(false);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const retry = useMutation({
    mutationFn: () => retryTaskWith(task.id, retryBody(value, clearPin, hasPin)),
    onSuccess: (retried) => {
      const outcome = retryOutcome(retried);
      toast[outcome.kind](outcome.message);
      close();
      queryClient.invalidateQueries({ queryKey: ['requirement-graph', task.req_id] });
      queryClient.invalidateQueries({ queryKey: ['requirement', task.req_id] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to retry task'),
  });

  const onOpenChange = (next: boolean) => {
    if (next) setOpen(true);
    else close();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Retry with a different model or effort"
          title="Retry with a different model or effort"
          className="flex items-center px-1 py-1 rounded-r bg-amber-100 dark:bg-amber-950/40 hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-l border-amber-200 dark:border-amber-900/60 transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <div className="text-xs font-bold text-slate-800 dark:text-slate-100">Retry with</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {pin ? `Pinned now: ${pin}. ` : ''}Keep leaves this task's setting as it is; a choice here is pinned on the task and used for its later runs.
          </p>
        </div>

        <AgentProfileFields value={value} onChange={setValue} disabled={clearing} defaultChipLabel="Keep" defaultTitle="Keep this task's current setting" />

        {pin && (
          <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={clearPin} onChange={(e) => setClearPin(e.target.checked)} className="accent-[#7b68ee]" />
            <span>Clear pin (use the requirement's or workspace's setting)</span>
          </label>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-40"
          >
            {retry.isPending ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
