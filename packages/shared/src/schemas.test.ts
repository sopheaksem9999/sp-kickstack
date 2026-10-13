import { describe, it, expect } from 'vitest';
import {
  CreateRequirementInputSchema,
  CreateTicketInputSchema,
  CreateWorkspaceInputSchema,
  ProjectSchema,
  BranchMergePolicySchema,
  normalizeMergePolicy,
  AiChatMessageSchema,
  AiChatRequestSchema,
  NeuronRuleSchema,
  BrowserPageSchema,
  JevSettingsSchema,
  ClefSettingsSchema,
  DecisionEngineIdSchema,
  SystemDecisionSettingsSchema,
} from './schemas.js';

describe('Shared Schemas Validation', () => {
  it('accepts the legacy auto_merge_main policy as auto_merge', () => {
    expect(BranchMergePolicySchema.parse('auto_merge_main')).toBe('auto_merge');
    expect(BranchMergePolicySchema.parse('auto_merge')).toBe('auto_merge');
    expect(BranchMergePolicySchema.parse('manual_review_merge')).toBe('manual_review_merge');
    expect(normalizeMergePolicy('auto_merge_main')).toBe('auto_merge');
    expect(normalizeMergePolicy(undefined)).toBe('manual_review_merge');
  });

  it('keeps an optional project test command', () => {
    const base = { name: 'backend', repo_path: '/r', engine_type: 'manual' as const };
    expect(ProjectSchema.parse({ ...base, test_command: 'npm ci && npm test' }).test_command).toBe('npm ci && npm test');
    expect(ProjectSchema.parse(base).test_command).toBeUndefined();
  });

  it('accepts a full-stack project kind', () => {
    const base = { name: 'app', repo_path: '/r', engine_type: 'local' as const };
    expect(ProjectSchema.parse({ ...base, kind: 'full-stack' }).kind).toBe('full-stack');
    expect(ProjectSchema.safeParse({ ...base, kind: 'fullstack-ish' }).success).toBe(false);
  });

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

  it('validates requirement without acceptance_criteria and with short goal', () => {
    const minimal = {
      title: 'test',
      goal: 'test',
      affected_projects: ['api'],
    };
    const parsed = CreateRequirementInputSchema.safeParse(minimal);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.acceptance_criteria).toEqual([]);
    }
  });

  it('validates AI chat message and request schemas', () => {
    const msg = {
      id: 'msg-1',
      role: 'user' as const,
      content: 'I want to build an avatar upload endpoint and React component',
      timestamp: new Date().toISOString(),
    };
    const parsedMsg = AiChatMessageSchema.safeParse(msg);
    expect(parsedMsg.success).toBe(true);

    const req = {
      messages: [msg],
      provider: 'claude-cli' as const,
      model: 'sonnet',
      effort: 'high' as const,
    };
    const parsedReq = AiChatRequestSchema.safeParse(req);
    expect(parsedReq.success).toBe(true);
  });

  it('validates neuron rule, browser page, and engine settings schemas', () => {
    const validRule = {
      id: 'rule-1',
      workspace_id: 'default',
      project: 'backend',
      category: 'convention',
      rule_text: 'Always run migrations before testing',
      confidence_score: 0.95,
      trigger_count: 3,
      is_active: true,
      source_run_id: 'local-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(NeuronRuleSchema.safeParse(validRule).success).toBe(true);

    const validPage = {
      url: 'https://example.com/docs',
      title: 'Docs Page',
      textContent: 'Welcome to docs',
      headings: ['Intro', 'Setup'],
    };
    expect(BrowserPageSchema.safeParse(validPage).success).toBe(true);

    const validJev = {
      jev_bin_path: 'jev',
      jev_model: 'default',
      jev_args_template: '-p --model {model}',
    };
    expect(JevSettingsSchema.safeParse(validJev).success).toBe(true);

    const validClef = {
      clef_enabled: true,
      clef_account_id: 'acc-123',
      clef_api_token: 'tok-abc',
      clef_model: '@cf/cloudflare/clef-flash',
      clef_auto_triage: true,
    };
    expect(ClefSettingsSchema.safeParse(validClef).success).toBe(true);

    expect(DecisionEngineIdSchema.safeParse('none').success).toBe(true);
    expect(DecisionEngineIdSchema.safeParse('clef').success).toBe(true);
    expect(DecisionEngineIdSchema.safeParse('jev').success).toBe(true);
    expect(DecisionEngineIdSchema.safeParse('invalid').success).toBe(false);

    const validNoneSystem = {
      active_engine: 'none' as const,
      clef: validClef,
      jev: validJev,
    };
    expect(SystemDecisionSettingsSchema.safeParse(validNoneSystem).success).toBe(true);
  });
});


