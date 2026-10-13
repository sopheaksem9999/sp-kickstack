import type { Project } from '@sp-kickstack/shared';

/** Kind choices for a repository (informational: shown on cards and given to the AI architect). */
export const PROJECT_KIND_OPTIONS: Array<{ value: Project['kind']; label: string }> = [
  { value: 'backend', label: 'Backend' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'full-stack', label: 'Full-stack' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'other', label: 'Other' },
];
