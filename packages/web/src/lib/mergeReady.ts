import type { BridgeTask, RequirementStatus } from '@sp-kickstack/shared';

/**
 * A requirement can be confirmed merged once every goal and ticket (cancelled ones aside)
 * is in review or done. Mirrors the server rule in RequirementService.confirmMerged.
 */
export function isMergeReady(
  status: RequirementStatus | undefined,
  tasks: Array<Pick<BridgeTask, 'role' | 'status'>> = []
): boolean {
  if (!status || status === 'done' || status === 'cancelled' || status === 'draft') return false;
  const work = tasks.filter((t) => (t.role === 'goal' || t.role === 'ticket') && t.status !== 'cancelled');
  return work.length > 0 && work.every((t) => t.status === 'in_review' || t.status === 'done');
}

/** Button and toast wording: only demo mode may talk about merging into main. */
export function mergeCopy(demoMode: boolean) {
  return demoMode
    ? {
        action: 'Review & Merge to Main',
        pending: 'Merging...',
        success: 'Successfully reviewed and merged into main branch! 🎉',
      }
    : {
        action: 'Confirm merged',
        pending: 'Confirming...',
        success: 'Marked as merged (no git operation)',
      };
}

type MergeTask = Pick<BridgeTask, 'role' | 'status'> & { branch?: string | null; merged_at?: string | null };

/**
 * Which merge control a requirement shows:
 * - 'merge'    — branched work is all in review: "Merge & move to QA" runs the merge gate
 * - 'merging'  — the merge gate is running
 * - 'confirm'  — legacy work without branches: "Confirm merged"
 * - null       — nothing to do yet (or already merged)
 */
export function mergeGateAction(
  req: { status: RequirementStatus; merge_state?: string | null } | undefined,
  tasks: MergeTask[] = []
): 'merge' | 'merging' | 'confirm' | null {
  if (!req) return null;
  if (req.merge_state === 'running') return 'merging';
  const work = tasks.filter((t) => (t.role === 'goal' || t.role === 'ticket') && t.status !== 'cancelled');
  const unmerged = work.filter((t) => t.branch && !t.merged_at);
  if (unmerged.length > 0) {
    const allInReview = work.every((t) => t.status === 'in_review' || t.status === 'done');
    return req.status === 'in_review' && allInReview ? 'merge' : null;
  }
  if (work.some((t) => t.branch)) return null; // everything branched is merged already
  return isMergeReady(req.status, tasks) ? 'confirm' : null;
}

export function policyLabel(policy: 'manual_review_merge' | 'auto_merge'): string {
  return policy === 'auto_merge' ? 'Auto-merge (no review)' : 'Review first';
}
