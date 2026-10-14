import type { AgentCliId, AiQaSettings, LocalEngineStatus, QaRunView, QaSeverity, QaTier, RequirementQa, RequirementStatus, ReviewComment } from '@sp-kickstack/shared';
import { isValidModel } from './agentProfile.js';
import { installBadge, limitBadge } from './localEngineText.js';
import { modelSuggestionsFor } from './runSettings.js';

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

/** "3 minor findings", or "2 findings (1 major)" when some are major (no blockers here). */
function passedFindingsText(f: RequirementQa['findings']): string {
  const plural = f.total === 1 ? '' : 's';
  return f.major ? `${f.total} finding${plural} (${f.major} major)` : `${f.total} minor finding${plural}`;
}

/** The requirement header's AI QA line (latest round), or null before the first QA run. */
export function qaStatusLine(qa: RequirementQa | null | undefined): { text: string; tone: QaTone } | null {
  if (!qa || qa.round === 0) return null;
  const prefix = qa.stage === 'review' ? 'AI QA before merge' : 'AI QA';
  const passed = qa.stage === 'review' ? 'AI QA before merge: passed' : 'AI QA passed';
  const skipped = qa.skipped.map((s) => `skipped ${s.project}: ${s.reason}`).join(' · ');
  const line = (text: string, tone: QaTone) => ({ text: skipped ? `${text} · ${skipped}` : text, tone });
  if (qa.running) {
    // A round whose previews are still being built has no runs yet.
    if (qa.runs.length === 0) return line(`${prefix} starting…`, 'running');
    return line(`${prefix} running… (${qa.runs.map((r) => `${r.project} ${RUN_MARK[r.status] ?? '…'}`).join(', ')})`, 'running');
  }
  const findings = findingsText(qa.findings);
  const broken = qa.runs.find((r) => r.status === 'failed' || r.status === 'cancelled');
  if (broken) {
    const reason = broken.status === 'cancelled' ? 'stopped' : (broken.error ?? 'unknown error').split('\n')[0];
    // Many reasons already start with the repository ("backend: merging … conflicts"): name it once.
    const where = reason.startsWith(`${broken.project}: `) ? reason : `${broken.project}: ${reason}`;
    return line(`${prefix} failed: ${where}${findings ? ` · ${findings}` : ''}`, 'failed');
  }
  // Every agent said "passed" and nothing is a blocker: the findings are notes, not a failed check.
  if (findings && qa.findings.blocker === 0 && qa.runs.every((r) => r.passed === true)) return line(`${passed} · ${passedFindingsText(qa.findings)}`, 'passed');
  if (findings) return line(`${prefix}: ${findings}`, 'findings');
  const notPassed = qa.runs.find((r) => r.passed === false);
  if (notPassed) return line(`${prefix}: ${notPassed.project} did not pass${notPassed.summary ? `: ${notPassed.summary}` : ''}`, 'findings');
  // "Passed" only when every agent said so: one that ended without `xticket qa-result` gave no verdict.
  const noVerdict = qa.runs.find((r) => r.passed !== true);
  if (noVerdict) return line(`${prefix}: ${noVerdict.project} finished without a result`, 'findings');
  return line(passed, 'passed');
}

/** The popover title: the round, and for review rounds what the preview merged into. */
export function qaRoundTitle(qa: RequirementQa): string {
  return `AI QA · round ${qa.round}${qa.stage === 'review' && qa.previewInto ? ` · merge preview into ${qa.previewInto}` : ''}`;
}

/** A repository's line in the popover: its name, and the model tier with why. */
export function qaRunTitle(run: QaRunView): string {
  return run.tier ? `${run.project} · ${run.tier} · ${run.tierReason ?? ''}`.trim() : run.project;
}

/** The question before a merge, or null when there is nothing to ask. */
export function mergeWarning(qa: RequirementQa | null | undefined): string | null {
  if (!qa) return null;
  if (qa.stage === 'review' && qa.running) return 'AI QA is still checking this requirement. Merge anyway?';
  if (qa.openBlockers > 0) return `${qa.openBlockers} open AI QA blocker${qa.openBlockers === 1 ? '' : 's'}. Merge anyway?`;
  return null;
}

/** One repository's run, for the header popover. */
export function qaRunText(run: QaRunView): string {
  const findings = run.findings ? ` · ${run.findings} finding${run.findings === 1 ? '' : 's'}` : '';
  if (run.status === 'failed') return `Failed: ${(run.error ?? 'unknown error').split('\n')[0]}${findings}`;
  if (run.status === 'cancelled') return `Stopped${findings}`;
  if (run.status === 'done') {
    const verdict = run.passed === true ? 'Passed' : run.passed === false ? 'Found problems' : 'Finished without a result';
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
export function runAiQaBlocked(req: { status: RequirementStatus; merge_state?: string | null }, qa: RequirementQa | undefined): string | null {
  if (req.status !== 'in_review' && req.status !== 'qa') return 'AI QA runs while the requirement is in review or in QA';
  if (req.merge_state === 'running') return 'A merge is running';
  if (qa?.running) return 'AI QA is running';
  return null;
}

/** What is wrong with an AI QA settings draft before saving (the server checks the same), or null. */
export function aiQaDraftProblem(draft: AiQaSettings): string | null {
  if (!Number.isInteger(draft.timeLimitMinutes) || draft.timeLimitMinutes < 5 || draft.timeLimitMinutes > 240) {
    return 'Time limit must be a whole number of minutes from 5 to 240.';
  }
  if (!Number.isInteger(draft.maxFindings) || draft.maxFindings < 1 || draft.maxFindings > 200) return 'Maximum findings must be a whole number from 1 to 200.';
  if (!Number.isInteger(draft.lightMaxLines) || draft.lightMaxLines < 10 || draft.lightMaxLines > 5000) return 'Light: changed lines must be a whole number from 10 to 5000.';
  if (!Number.isInteger(draft.deepMinLines) || draft.deepMinLines < 50 || draft.deepMinLines > 100000) return 'Deep: changed lines must be a whole number from 50 to 100000.';
  if (draft.lightMaxLines >= draft.deepMinLines) return 'The light limit must be lower than the deep limit.';
  const models = [draft.model, ...Object.values(draft.tiers).flatMap((t) => [t.light.model, t.standard.model, t.deep.model])];
  if (models.some((m) => m !== null && !isValidModel(m))) return 'Model ids use letters, digits and . _ : / - (up to 80 characters), e.g. opus';
  return null;
}

/** Model chips for AI QA: the names the CLI that runs it understands (Codex: none, AGY: its own). */
export function qaModelSuggestions(cli: AgentCliId): string[] {
  return modelSuggestionsFor(cli);
}

/** The CLI whose tiers the card edits: the one chosen for AI QA, else the Local AI CLI engine's. */
export function qaTierCli(agentCli: AiQaSettings['agentCli'], status: LocalEngineStatus | undefined): AgentCliId | null {
  return agentCli !== 'default' ? agentCli : (status?.cli ?? null);
}

export const TIER_LABEL: Record<QaTier, string> = { light: 'Light', standard: 'Standard', deep: 'Deep' };

/** When a tier applies, in words. */
export function tierWhen(tier: QaTier, s: Pick<AiQaSettings, 'lightMaxLines' | 'deepMinLines'>): string {
  if (tier === 'light') return `Up to ${s.lightMaxLines} changed lines in up to 8 files`;
  if (tier === 'deep') return `${s.deepMinLines}+ changed lines, 40+ files, or a risky path`;
  return 'Anything between light and deep';
}

/** High-risk paths typed one per line or comma-separated; blanks and repeats dropped. */
export function riskPathsFromText(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((p) => p.trim()).filter(Boolean))];
}

export function riskPathsToText(paths: string[]): string {
  return paths.join('\n');
}

/** Which CLI runs AI QA, with its live badges (Installed on PC / Not Detected, HEALTHY / PAUSED). */
export function qaCliStatus(agentCli: AiQaSettings['agentCli'], status: LocalEngineStatus | undefined): { text: string; good: boolean } | null {
  if (!status) return null;
  if (!status.enabled) return { text: 'The Local AI CLI engine is turned off: AI QA cannot run', good: false };
  const id = agentCli === 'default' ? status.cli : agentCli;
  const cli = id ? status.clis.find((c) => c.id === id) : undefined;
  if (!cli) return { text: status.problem ?? 'No AI CLI can run AI QA', good: false };
  const limit = limitBadge(cli);
  return {
    text: `AI QA runs with ${cli.label} · ${installBadge(cli)} · ${limit}${cli.enabled ? '' : ' · turned off'}`,
    good: cli.installed && cli.enabled && limit === 'HEALTHY',
  };
}
