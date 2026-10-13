import { describe, it, expect } from 'vitest';
import type { BridgeTask, Requirement } from '@sp-kickstack/shared';
import {
  branchOptions, branchPatternExamples, createTargetBranch, draftFromRequirement, fanOutResult, modelSuggestionsFor, optionalBranchProblem, pickerRows,
  runSettingsPatch, runSettingsProblem, runSettingsSummary, shouldResetDraft, statusChangeStartsFanOut,
} from './runSettings.js';

const req = (over: Partial<Requirement> = {}): Requirement => ({
  id: 'REQ-008', seq: 8, title: 'T', status: 'draft', priority: 'normal', body_md: '', file_path: '', revision: 1,
  affected_projects: ['backend', 'frontend'], created_at: 'x', updated_at: 'x', ...over,
});

describe('run settings helpers', () => {
  it('starts a draft from the requirement', () => {
    expect(draftFromRequirement(req({ agent_cli: 'agy-cli', target_branch: 'release/1.3' }))).toEqual({
      agent_cli: 'agy-cli', agent_model: null, agent_effort: null, target_branch: 'release/1.3', merge_policy: null, affected_projects: ['backend', 'frontend'],
    });
  });

  it('suggests the models of the chosen CLI', () => {
    expect(modelSuggestionsFor('agy-cli')).toContain('gemini-3.8-flash');
    expect(modelSuggestionsFor('claude-cli')).toContain('opus');
    expect(modelSuggestionsFor(null)).toContain('opus');
    expect(modelSuggestionsFor('codex-cli')).toEqual([]);
  });

  it('checks a draft', () => {
    const draft = draftFromRequirement(req());
    expect(runSettingsProblem(draft, 'edit')).toBeNull();
    expect(runSettingsProblem({ ...draft, affected_projects: [] }, 'fan-out')).toBe('Choose at least one repository');
    expect(runSettingsProblem({ ...draft, target_branch: '../x' }, 'edit')).toBe('A branch name cannot contain .. or //');
    expect(runSettingsProblem({ ...draft, agent_model: 'bad model' }, 'edit')).toMatch(/Model ids/);
  });

  it('sends only what changed, with an empty target as null', () => {
    const r = req({ agent_cli: 'claude-cli', target_branch: 'release/1.3' });
    const draft = { ...draftFromRequirement(r), agent_cli: 'agy-cli' as const, target_branch: '  ' };
    expect(runSettingsPatch(draft, r)).toEqual({ agent_cli: 'agy-cli', target_branch: null });
    expect(runSettingsPatch(draftFromRequirement(r), r)).toEqual({});
  });

  it('lists matching branches with where they exist, and offers to create a new valid name', () => {
    const entries = [{ name: 'develop', projects: ['backend', 'frontend'] }, { name: 'release/1.3', projects: ['backend'] }];
    expect(branchOptions(entries, '', ['backend', 'frontend'])).toEqual([
      { name: 'develop', detail: 'backend, frontend', create: false },
      { name: 'release/1.3', detail: 'backend only (created in frontend at fan-out)', create: false },
    ]);
    expect(branchOptions(entries, 'release/2', ['backend'])).toEqual([
      { name: 'release/2', detail: "new: created from each repository's base branch at fan-out", create: true },
    ]);
    expect(branchOptions(entries, '../x', ['backend'])).toEqual([]);
  });

  it('summarises the settings for the card', () => {
    expect(runSettingsSummary(req())).toEqual(['Default CLI', 'default model', '→ base branch', 'Default merge']);
    expect(runSettingsSummary(req({ agent_cli: 'agy-cli', agent_model: 'gemini-3.8-flash', agent_effort: 'high', target_branch: 'release/1.3', merge_policy: 'auto_merge' }))).toEqual([
      'AGY', 'gemini-3.8-flash · high', '→ release/1.3', 'Auto-merge',
    ]);
  });
});


describe('branch name pattern examples', () => {
  it('shows a goal and a ticket name for a pattern, or the problem', () => {
    expect(branchPatternExamples('{req}')).toEqual({ goal: 'REQ-008', ticket: 'REQ-008-ticket-12', problem: null });
    expect(branchPatternExamples('{project}/{req}')).toEqual({ goal: 'backend/REQ-008', ticket: 'backend/REQ-008-ticket-12', problem: null });
    expect(branchPatternExamples('feature').problem).toBe('The pattern must contain {req}');
  });
});

describe('run settings dialog, picker and status changes', () => {
  it('branch picker: Enter picks the base branch only without search text, else the exact or the new name', () => {
    const entries = [
      { name: 'develop', projects: ['backend'] },
      { name: 'release/2.0', projects: ['backend'] },
      { name: 'release/2', projects: ['backend'] },
    ];
    expect(pickerRows(entries, '', ['backend'])[0].name).toBe('');
    expect(pickerRows(entries, 'release/3', ['backend'])[0]).toMatchObject({ name: 'release/3', create: true });
    expect(pickerRows(entries, 'release/2', ['backend'])[0]).toMatchObject({ name: 'release/2', create: false });
    expect(pickerRows(entries, 'release/2', ['backend']).some((r) => r.name === '')).toBe(false);
  });

  it('fan-out result: an error when no goal reached its engine, a warning when some failed', () => {
    const goal = (project: string, status: string, last_error: string | null = null) => ({ project, status, last_error }) as BridgeTask;
    expect(fanOutResult('REQ-008', [goal('backend', 'queued')])).toEqual({ level: 'success', message: 'Fan-out started for REQ-008' });
    expect(fanOutResult('REQ-008', [goal('backend', 'failed', 'Base branch "nope" was not found')])).toEqual({
      level: 'error', message: 'No agent started. backend: Base branch "nope" was not found',
    });
    expect(fanOutResult('REQ-008', [goal('backend', 'queued'), goal('mobile', 'failed', 'boom')])).toEqual({
      level: 'warning', message: 'Fan-out started for REQ-008, but mobile failed: boom',
    });
  });

  it('moving To Do or Ready to In Progress goes through the fan-out dialog', () => {
    expect(statusChangeStartsFanOut('draft', 'in_progress')).toBe(true);
    expect(statusChangeStartsFanOut('ready', 'in_progress')).toBe(true);
    expect(statusChangeStartsFanOut('qa', 'in_progress')).toBe(false);
    expect(statusChangeStartsFanOut('draft', 'ready')).toBe(false);
  });

  it('the dialog draft restarts when the dialog opens, not when the requirement is refetched while open', () => {
    expect(shouldResetDraft({ open: false, reqId: null }, { open: true, reqId: 'REQ-008' })).toBe(true);
    expect(shouldResetDraft({ open: true, reqId: 'REQ-008' }, { open: true, reqId: 'REQ-008' })).toBe(false);
    expect(shouldResetDraft({ open: true, reqId: 'REQ-008' }, { open: true, reqId: 'REQ-009' })).toBe(true);
    expect(shouldResetDraft({ open: true, reqId: 'REQ-008' }, { open: false, reqId: 'REQ-008' })).toBe(false);
  });

  it('Settings default target branch: empty is fine, else a valid branch name', () => {
    expect(optionalBranchProblem('')).toBeNull();
    expect(optionalBranchProblem('  ')).toBeNull();
    expect(optionalBranchProblem('release/1.3')).toBeNull();
    expect(optionalBranchProblem('bad..name')).not.toBeNull();
  });

  it('create form: empty means base branch once Settings are loaded; before that the server default applies', () => {
    expect(createTargetBranch(' release/1.3 ', true)).toBe('release/1.3');
    expect(createTargetBranch('', true)).toBeNull();
    expect(createTargetBranch('', false)).toBeUndefined();
  });
});
