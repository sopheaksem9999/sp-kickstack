import { describe, it, expect } from 'vitest';
import type { Requirement } from '@sp-kickstack/shared';
import { branchOptions, branchPatternExamples, draftFromRequirement, modelSuggestionsFor, runSettingsPatch, runSettingsProblem, runSettingsSummary } from './runSettings.js';

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
