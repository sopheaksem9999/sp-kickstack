import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GitMerge } from 'lucide-react';
import type { Requirement, RequirementQa } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { fetchRequirementQa } from '../lib/aiQaApi.js';
import { mergeWarning } from '../lib/aiQa.js';

const button = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#2e303d]';

/**
 * Before a move to QA merges a requirement that is in review: ask when AI QA is still checking it or found
 * open blockers. Requirements in other states merge without a question.
 */
export function useAskBeforeMerge(): { askBeforeMerge: (req: Pick<Requirement, 'id' | 'status'>, merge: () => void) => void; mergeDialog: ReactNode } {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ reqId: string; text: string; merge: () => void } | null>(null);

  const askBeforeMerge = (req: Pick<Requirement, 'id' | 'status'>, merge: () => void) => {
    if (req.status !== 'in_review') return merge();
    void queryClient
      .fetchQuery<RequirementQa>({ queryKey: ['requirement-qa', req.id], queryFn: () => fetchRequirementQa(req.id), staleTime: 2000 })
      .then((qa) => mergeWarning(qa), () => null)
      .then((text) => (text ? setPending({ reqId: req.id, text, merge }) : merge()));
  };

  const mergeDialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge {pending?.reqId} and move to QA?</DialogTitle>
          <DialogDescription>{pending?.text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" className={button} onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={`${button} bg-emerald-600 border-emerald-600 text-white`}
            onClick={() => {
              const merge = pending?.merge;
              setPending(null);
              merge?.();
            }}
          >
            <GitMerge className="w-3.5 h-3.5" />
            Merge anyway
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { askBeforeMerge, mergeDialog };
}
