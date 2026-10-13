import { describe, it, expect } from 'vitest';
import { PROJECT_KIND_OPTIONS } from './projectKinds.js';

describe('project kinds', () => {
  it('offers Backend, Frontend, Full-stack, Mobile and Other', () => {
    expect(PROJECT_KIND_OPTIONS).toEqual([
      { value: 'backend', label: 'Backend' },
      { value: 'frontend', label: 'Frontend' },
      { value: 'full-stack', label: 'Full-stack' },
      { value: 'mobile', label: 'Mobile' },
      { value: 'other', label: 'Other' },
    ]);
  });
});
