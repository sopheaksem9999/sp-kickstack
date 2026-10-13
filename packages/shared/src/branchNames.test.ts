import { describe, it, expect } from 'vitest';
import { branchNameProblem, renderTaskBranchPattern, taskBranchPatternProblem } from './branchNames.js';
import { BranchMergeSettingsSchema, UpdateRunSettingsInputSchema } from './schemas.js';

describe('branch names', () => {
  it('accepts ordinary branch names', () => {
    for (const name of ['REQ-008', 'release/1.3', 'feature/rides_v2', 'REQ-008-ticket-12']) expect(branchNameProblem(name)).toBeNull();
  });

  it('refuses names git or the bridge cannot use', () => {
    expect(branchNameProblem('  ')).toBe('Enter a branch name');
    expect(branchNameProblem('-x')).toBe('A branch name cannot start with - or /');
    expect(branchNameProblem('/x')).toBe('A branch name cannot start with - or /');
    expect(branchNameProblem('a/')).toBe('A branch name cannot end with /, . or .lock');
    expect(branchNameProblem('a.lock')).toBe('A branch name cannot end with /, . or .lock');
    expect(branchNameProblem('../x')).toBe('A branch name cannot contain .. or //');
    expect(branchNameProblem('a//b')).toBe('A branch name cannot contain .. or //');
    expect(branchNameProblem('a/.b')).toBe('No part of a branch name can start with .');
    expect(branchNameProblem('feat ure')).toBe('Branch names use letters, digits and . _ / - only');
    expect(branchNameProblem('a@{1}')).toBe('Branch names use letters, digits and . _ / - only');
    expect(branchNameProblem('x'.repeat(101))).toBe('Branch names are at most 100 characters');
  });

  it('fills in a task branch pattern', () => {
    const tokens = { req: 'REQ-008', task: 12, project: 'backend' };
    expect(renderTaskBranchPattern('{req}', tokens)).toBe('REQ-008');
    expect(renderTaskBranchPattern(' {project}/{req}-{task} ', tokens)).toBe('backend/REQ-008-12');
  });

  it('checks a pattern', () => {
    expect(taskBranchPatternProblem('{req}')).toBeNull();
    expect(taskBranchPatternProblem('feature/{task}')).toBe('The pattern must contain {req}');
    expect(taskBranchPatternProblem('{req} x')).toBe('Branch names use letters, digits and . _ / - only (it gives "REQ-001 x")');
  });
});

describe('run settings schemas', () => {
  it('adds the branch name pattern and push switch to the branch settings', () => {
    expect(BranchMergeSettingsSchema.parse({})).toMatchObject({ task_branch_pattern: '{req}', push_branches: true });
    expect(() => BranchMergeSettingsSchema.parse({ task_branch_pattern: 'feature' })).toThrow(/must contain \{req\}/);
  });

  it('validates the run settings of a requirement', () => {
    expect(UpdateRunSettingsInputSchema.parse({ agent_cli: 'agy-cli', target_branch: ' release/1.3 ', merge_policy: null })).toEqual({
      agent_cli: 'agy-cli', target_branch: 'release/1.3', merge_policy: null,
    });
    expect(UpdateRunSettingsInputSchema.parse({ target_branch: null })).toEqual({ target_branch: null });
    expect(() => UpdateRunSettingsInputSchema.parse({ target_branch: '../x' })).toThrow(/cannot contain/);
    expect(() => UpdateRunSettingsInputSchema.parse({ agent_cli: 'ollama' })).toThrow();
    expect(() => UpdateRunSettingsInputSchema.parse({ title: 'x' })).toThrow();
  });
});
