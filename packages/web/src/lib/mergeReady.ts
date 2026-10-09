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
