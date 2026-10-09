import { describe, it, expect } from 'vitest';
import {
  CreateRequirementInputSchema,
  CreateTicketInputSchema,
  CreateWorkspaceInputSchema,
  ProjectSchema,
} from './schemas.js';

describe('Shared Schemas Validation', () => {
  it('validates a valid project schema', () => {
    const project = {
      name: 'backend',
      kind: 'backend' as const,
      repo_path: '/repos/backend',
      engine_type: 'stoneforge' as const,
      engine_url: 'http://127.0.0.1:3457',
      base_branch: 'main',
      done_means: 'merged' as const,
      high_risk_paths: ['src/auth/**'],
      enabled: true,
      engine_status: 'ok' as const,
    };

    const parsed = ProjectSchema.safeParse(project);
    expect(parsed.success).toBe(true);
  });

  it('validates a requirement creation input', () => {
    const req = {
      title: 'Rider can see nearby drivers',
      goal: 'Display nearby drivers on map in realtime',
      acceptance_criteria: ['Driver positions shown on map', 'Polls every 5s'],
      affected_projects: ['backend', 'mobile'],
      priority: 'high' as const,
    };

    const parsed = CreateRequirementInputSchema.safeParse(req);
    expect(parsed.success).toBe(true);
  });

  it('rejects ticket input with body exceeding 20KB', () => {
    const ticket = {
      to: 'backend',
      title: 'Too large ticket',
      body: 'a'.repeat(21000),
      blocking: true,
    };

    const parsed = CreateTicketInputSchema.safeParse(ticket);
    expect(parsed.success).toBe(false);
  });

  it('validates workspace creation input and rejects invalid id', () => {
    const valid = {
      id: 'workspace-a',
      name: 'Workspace A',
      description: 'Alpha team environment',
      rules: 'All PRs must include tests.',
      context: 'PostgreSQL 16 backend, React 18 web.',
    };
    expect(CreateWorkspaceInputSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      id: 'workspace with space!',
      name: 'Workspace Invalid',
    };
    expect(CreateWorkspaceInputSchema.safeParse(invalid).success).toBe(false);
  });
});

