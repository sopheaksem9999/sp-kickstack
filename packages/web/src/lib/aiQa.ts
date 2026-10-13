import type { QaRunView, QaSeverity, RequirementQa, RequirementStatus, ReviewComment } from '@sp-kickstack/shared';

export type QaTone = 'running' | 'passed' | 'findings' | 'failed';

const RUN_MARK: Record<string, string> = { done: '✓', failed: '✗', cancelled: '–' };

export const QA_TONE_STYLE: Record<QaTone, string> = {
  running: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300',
  passed: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  findings: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  failed: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300',
};

export const SEVERITY_STYLE: Record<QaSeverity, string> = {
  blocker: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  major: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300',
  minor: 'bg-slate-100 dark:bg-[#262732] text-slate-600 dark:text-slate-300',
};

/** "3 findings (1 blocker)", "1 finding", or '' for none. */
export function findingsText(f: RequirementQa['findings']): string {
  if (f.total === 0) return '';
  const blockers = f.blocker ? ` (${f.blocker} blocker${f.blocker === 1 ? '' : 's'})` : '';
  return `${f.total} finding${f.total === 1 ? '' : 's'}${blockers}`;
}

/** The requirement header's AI QA line (latest round), or null before the first QA run. */
export function qaStatusLine(qa: RequirementQa | null | undefined): { text: string; tone: QaTone } | null {
  if (!qa || qa.round === 0) return null;
  const skipped = qa.skipped.map((s) => `skipped ${s.project}: ${s.reason}`).join(' · ');
  const line = (text: string, tone: QaTone) => ({ text: skipped ? `${text} · ${skipped}` : text, tone });
  if (qa.running) return line(`AI QA running… (${qa.runs.map((r) => `${r.project} ${RUN_MARK[r.status] ?? '…'}`).join(', ')})`, 'running');
  const findings = findingsText(qa.findings);
  const broken = qa.runs.find((r) => r.status === 'failed' || r.status === 'cancelled');
  if (broken) {
    const reason = broken.status === 'cancelled' ? 'stopped' : (broken.error ?? 'unknown error').split('\n')[0];
    return line(`AI QA failed: ${broken.project}: ${reason}${findings ? ` · ${findings}` : ''}`, 'failed');
  }
  if (findings) return line(`AI QA: ${findings}`, 'findings');
  const notPassed = qa.runs.find((r) => r.passed === false);
  if (notPassed) return line(`AI QA: ${notPassed.project} did not pass${notPassed.summary ? `: ${notPassed.summary}` : ''}`, 'findings');
  return line('AI QA passed', 'passed');
}

/** One repository's run, for the header popover. */
export function qaRunText(run: QaRunView): string {
  const findings = run.findings ? ` · ${run.findings} finding${run.findings === 1 ? '' : 's'}` : '';
  if (run.status === 'failed') return `Failed: ${(run.error ?? 'unknown error').split('\n')[0]}${findings}`;
  if (run.status === 'cancelled') return `Stopped${findings}`;
  if (run.status === 'done') {
    const verdict = run.passed === true ? 'Passed' : run.passed === false ? 'Found problems' : 'Done';
    return `${verdict}${run.summary && run.passed !== null ? `: ${run.summary}` : ''}${findings}`;
  }
  if (run.status === 'rate_limited') return `Paused by a usage limit${findings}`;
  return `${run.status === 'running' ? 'Running' : 'Waiting to start'}${findings}`;
}

/** "AI QA · blocker" for a finding of the AI QA agent; null for a person's comment. */
export function qaBadge(c: Pick<ReviewComment, 'source' | 'severity'>): string | null {
  if (c.source !== 'ai-qa') return null;
  return c.severity ? `AI QA · ${c.severity}` : 'AI QA';
}

/** Why "Run AI QA" is disabled, or null when it can run. */
export function runAiQaBlocked(status: RequirementStatus, qa: RequirementQa | undefined): string | null {
  if (status !== 'qa') return 'AI QA runs while the requirement is in QA';
  if (qa?.running) return 'AI QA is running';
  return null;
}
