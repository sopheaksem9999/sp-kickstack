import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, type AppDatabase } from '../db/index.js';
import { NeuronService } from './neuronService.js';

describe('NeuronService', () => {
  let db: AppDatabase;
  let service: NeuronService;

  beforeEach(() => {
    db = initDatabase(':memory:');
    service = new NeuronService(db);
  });

  it('creates, lists, searches, and enriches prompts with learned rules', () => {
    const rule = service.createRule({
      workspace_id: 'default',
      project: 'backend',
      category: 'testing',
      rule_text: 'Run migrations before executing integration tests',
      confidence_score: 0.95,
    });
    expect(rule.id).toBeDefined();
    expect(rule.category).toBe('testing');

    const rules = service.listRules('default', 'backend');
    expect(rules).toHaveLength(1);
    expect(rules[0].rule_text).toBe('Run migrations before executing integration tests');

    const enriched = service.enrichPrompt('Implement backend migration and tests', 'backend');
    expect(enriched).toContain('Learned Repository Patterns');
    expect(enriched).toContain('Run migrations before executing integration tests');
  });

  it('supports updating rule status, score and deletion', () => {
    const rule = service.createRule({
      workspace_id: 'default',
      project: 'frontend',
      category: 'convention',
      rule_text: 'Use Radix primitives for dialog overlays',
      confidence_score: 0.8,
    });

    const updated = service.updateRule(rule.id, { is_active: false, confidence_score: 0.85 });
    expect(updated?.is_active).toBe(false);
    expect(updated?.confidence_score).toBe(0.85);

    // Inactive rules are excluded from prompt enrichment
    const enriched = service.enrichPrompt('Create modal dialog overlay', 'frontend');
    expect(enriched).not.toContain('Use Radix primitives');

    const deleted = service.deleteRule(rule.id);
    expect(deleted).toBe(true);
    expect(service.listRules('default', 'frontend')).toHaveLength(0);
  });
});
