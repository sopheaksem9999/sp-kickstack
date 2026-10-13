import type { AgentCliId, BranchMergePolicy, BridgeTask, ReasoningEffort, Requirement, RequirementStatus, UpdateRunSettingsInput } from '@sp-kickstack/shared';
import { branchNameProblem, renderTaskBranchPattern, taskBranchPatternProblem } from '@sp-kickstack/shared';
import { MODEL_SUGGESTIONS, describeProfile, isValidModel } from './agentProfile.js';
import type { BranchEntry } from './runSettingsApi.js';

export interface RunSettingsDraft {
  agent_cli: AgentCliId | null;
  agent_model: string | null;
  agent_effort: ReasoningEffort | null;
  /** '' = each repository's base branch. */
  target_branch: string;
  merge_policy: BranchMergePolicy | null;
  affected_projects: string[];
}

export const CLI_CHOICES: Array<{ value: AgentCliId | null; label: string }> = [
  { value: null, label: 'Use default' },
  { value: 'claude-cli', label: 'Claude Code' },
  { value: 'agy-cli', label: 'AGY' },
  { value: 'codex-cli', label: 'Codex' },
];

/** AGY's model presets (Settings → AI & Local Engines offers the same list). */
export const AGY_MODEL_SUGGESTIONS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro'];

/** Model suggestions for a CLI: each CLI has its own model names. */
export function modelSuggestionsFor(cli: AgentCliId | null): string[] {
  if (cli === 'agy-cli') return AGY_MODEL_SUGGESTIONS;
  if (cli === 'codex-cli') return [];
  return MODEL_SUGGESTIONS;
}

export function draftFromRequirement(req: Requirement): RunSettingsDraft {
  return {
    agent_cli: req.agent_cli ?? null,
    agent_model: req.agent_model ?? null,
    agent_effort: req.agent_effort ?? null,
    target_branch: req.target_branch ?? '',
    merge_policy: req.merge_policy ?? null,
    affected_projects: [...req.affected_projects],
  };
}

/** What is wrong with a draft before saving (the server checks the same), or null. */
export function runSettingsProblem(draft: RunSettingsDraft, mode: 'edit' | 'fan-out'): string | null {
  if (mode === 'fan-out' && draft.affected_projects.length === 0) return 'Choose at least one repository';
  if (draft.agent_model && !isValidModel(draft.agent_model)) return 'Model ids use letters, digits and . _ : / - (up to 80 characters)';
  const target = draft.target_branch.trim();
  return target ? branchNameProblem(target) : null;
}

/** The run-settings request body: only what changed (an empty target becomes null). */
export function runSettingsPatch(draft: RunSettingsDraft, req: Requirement): UpdateRunSettingsInput {
  const patch: UpdateRunSettingsInput = {};
  if (draft.agent_cli !== (req.agent_cli ?? null)) patch.agent_cli = draft.agent_cli;
  if (draft.agent_model !== (req.agent_model ?? null)) patch.agent_model = draft.agent_model;
  if (draft.agent_effort !== (req.agent_effort ?? null)) patch.agent_effort = draft.agent_effort;
  const target = draft.target_branch.trim() || null;
  if (target !== (req.target_branch ?? null)) patch.target_branch = target;
  if (draft.merge_policy !== (req.merge_policy ?? null)) patch.merge_policy = draft.merge_policy;
  return patch;
}

export interface BranchOption {
  name: string;
  detail: string;
  create: boolean;
}

/** Picker rows: branches matching `query` with where they exist, and "create" for a new valid name. */
export function branchOptions(entries: BranchEntry[], query: string, chosen: string[]): BranchOption[] {
  const q = query.trim();
  const rows: BranchOption[] = entries
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
    .map((e) => {
      const relevant = chosen.length ? chosen : e.projects;
      const missing = relevant.filter((p) => !e.projects.includes(p));
      const have = relevant.filter((p) => e.projects.includes(p));
      const detail = missing.length === 0 ? have.join(', ') : `${have.join(', ')} only (created in ${missing.join(', ')} at fan-out)`;
      return { name: e.name, detail, create: false };
    });
  if (q && !entries.some((e) => e.name === q) && !branchNameProblem(q)) {
    rows.unshift({ name: q, detail: "new: created from each repository's base branch at fan-out", create: true });
  }
  return rows;
}

/** Why an optional branch name (empty = none) cannot be used, or null. */
export function optionalBranchProblem(value: string): string | null {
  const name = value.trim();
  return name ? branchNameProblem(name) : null;
}

/**
 * The create form's target_branch: the chosen name; null = each repository's base branch once the
 * form could show the Settings default; undefined (not sent) lets the server apply that default.
 */
export function createTargetBranch(value: string, settingsLoaded: boolean): string | null | undefined {
  return value.trim() || (settingsLoaded ? null : undefined);
}

/**
 * The base branch an empty target means for the chosen repositories: each one's own Base Branch,
 * else Settings → Default Implementation Base Branch; one name when they agree.
 */
export function baseBranchLabel(projects: Array<{ name: string; base_branch?: string | null }>, chosen: string[], defaultBase: string): string {
  const bases = chosen.map((name) => ({ name, base: projects.find((p) => p.name === name)?.base_branch || defaultBase }));
  const names = [...new Set(bases.map((b) => b.base))];
  if (names.length <= 1) return names[0] ?? defaultBase;
  return bases.map((b) => `${b.name}: ${b.base}`).join(', ');
}

/** The picker row for "no target branch": each repository's base branch. */
export const BASE_BRANCH_OPTION: BranchOption = { name: '', detail: "each repository's base branch", create: false };

/**
 * Picker rows; the first is what Enter picks. Without search text the base branch comes first; with
 * text the exact branch or the new name does, and the base row is hidden.
 */
export function pickerRows(entries: BranchEntry[], query: string, chosen: string[]): BranchOption[] {
  const q = query.trim();
  if (!q) return [BASE_BRANCH_OPTION, ...branchOptions(entries, '', chosen)];
  const rows = branchOptions(entries, q, chosen);
  const exact = rows.findIndex((r) => r.name === q);
  return exact > 0 ? [rows[exact], ...rows.slice(0, exact), ...rows.slice(exact + 1)] : rows;
}

/** What the fan-out dialog says about the goals it started: an error keeps the dialog open. */
export function fanOutResult(reqId: string, goals: BridgeTask[]): { level: 'success' | 'warning' | 'error'; message: string } {
  const failed = goals.filter((g) => g.status === 'failed');
  const reasons = failed.map((g) => `${g.project}: ${g.last_error || 'unknown error'}`).join('; ');
  if (failed.length === 0) return { level: 'success', message: `Fan-out started for ${reqId}` };
  if (failed.length === goals.length) return { level: 'error', message: `No agent started. ${reasons}` };
  const which = failed.map((g) => `${g.project} failed: ${g.last_error || 'unknown error'}`).join('; ');
  return { level: 'warning', message: `Fan-out started for ${reqId}, but ${which}` };
}

/** To Do / Ready → In Progress starts agents, so it goes through the fan-out dialog, not a plain status change. */
export function statusChangeStartsFanOut(from: RequirementStatus, to: RequirementStatus): boolean {
  return (from === 'draft' || from === 'ready') && to === 'in_progress';
}

/** The dialog's draft restarts from the requirement when the dialog opens or shows another one, never on a refetch. */
export function shouldResetDraft(before: { open: boolean; reqId: string | null }, now: { open: boolean; reqId: string }): boolean {
  return now.open && (!before.open || before.reqId !== now.reqId);
}

/** The Run settings card's parts: CLI, model · effort, target branch, merge policy. */
export function runSettingsSummary(req: Requirement): string[] {
  const cli = CLI_CHOICES.find((c) => c.value === (req.agent_cli ?? null) && c.value !== null)?.label ?? 'Default CLI';
  const profile = describeProfile({ model: req.agent_model ?? null, effort: req.agent_effort ?? null }) || 'default model';
  const merge = req.merge_policy === 'auto_merge' ? 'Auto-merge' : req.merge_policy === 'manual_review_merge' ? 'Review first' : 'Default merge';
  return [cli, profile, `→ ${req.target_branch || 'base branch'}`, merge];
}

/** Example names for Settings: a goal and a ticket, or why the pattern cannot be used. */
export function branchPatternExamples(pattern: string): { goal: string; ticket: string; problem: string | null } {
  const goal = renderTaskBranchPattern(pattern, { req: 'REQ-008', task: 12, project: 'backend' });
  return { goal, ticket: `${goal}-ticket-12`, problem: taskBranchPatternProblem(pattern) };
}
