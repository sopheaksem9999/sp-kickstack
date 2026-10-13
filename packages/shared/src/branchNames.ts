/** Default pattern for task branch names: the requirement ID, e.g. REQ-008. */
export const DEFAULT_TASK_BRANCH_PATTERN = '{req}';

/**
 * Why `name` cannot be a branch the bridge creates or merges into, or null when it can. Stricter than
 * git: letters, digits and . _ / - only.
 */
export function branchNameProblem(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Enter a branch name';
  if (value.length > 100) return 'Branch names are at most 100 characters';
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return 'Branch names use letters, digits and . _ / - only';
  if (value.startsWith('-') || value.startsWith('/')) return 'A branch name cannot start with - or /';
  if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) return 'A branch name cannot end with /, . or .lock';
  if (value.includes('..') || value.includes('//')) return 'A branch name cannot contain .. or //';
  if (value.split('/').some((part) => part.startsWith('.'))) return 'No part of a branch name can start with .';
  return null;
}

export interface TaskBranchTokens {
  req: string;
  task: number;
  project: string;
}

/** The pattern with {req}, {task} and {project} filled in. */
export function renderTaskBranchPattern(pattern: string, tokens: TaskBranchTokens): string {
  return pattern.trim().split('{req}').join(tokens.req).split('{task}').join(String(tokens.task)).split('{project}').join(tokens.project);
}

/** Why a task branch name pattern cannot be used, or null. */
export function taskBranchPatternProblem(pattern: string): string | null {
  if (!pattern.includes('{req}')) return 'The pattern must contain {req}';
  const example = renderTaskBranchPattern(pattern, { req: 'REQ-001', task: 1, project: 'backend' });
  const problem = branchNameProblem(example);
  return problem ? `${problem} (it gives "${example}")` : null;
}
