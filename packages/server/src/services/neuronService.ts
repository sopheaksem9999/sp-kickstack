import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '../db/index.js';
import type { NeuronRule, CreateNeuronRuleInput, NeuronCategory } from '@sp-kickstack/shared';

export interface RuleSearchResult {
  rule: NeuronRule;
  score: number;
}

/**
 * Lightweight pure-JS in-memory indexer for learned rules.
 * Uses token frequency and keyword matching without external dependencies.
 */
export class RuleIndex {
  private rules: NeuronRule[] = [];

  constructor(rules: NeuronRule[] = []) {
    this.rules = rules;
  }

  setRules(rules: NeuronRule[]): void {
    this.rules = rules;
  }

  search(query: string, project?: string, limit = 5): NeuronRule[] {
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (tokens.length === 0) {
      return this.rules
        .filter((r) => r.is_active && (!project || r.project === project || r.project === 'all'))
        .sort((a, b) => b.confidence_score - a.confidence_score)
        .slice(0, limit);
    }

    const scored = this.rules
      .filter((r) => r.is_active && (!project || r.project === project || r.project === 'all'))
      .map((rule) => {
        const text = `${rule.rule_text} ${rule.category} ${rule.project}`.toLowerCase();
        let matches = 0;
        for (const token of tokens) {
          if (text.includes(token)) {
            matches++;
          }
        }
        const score = matches * 10 + rule.confidence_score * 5 + (rule.project === project ? 5 : 0);
        return { rule, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => s.rule);
  }
}

export class NeuronService {
  private index: RuleIndex;

  constructor(private db: AppDatabase) {
    this.index = new RuleIndex();
    this.refreshIndex();
  }

  private refreshIndex(): void {
    try {
      const rows = this.db
        .prepare('SELECT * FROM neuron_rules WHERE is_active = 1')
        .all() as any[];
      this.index.setRules(rows.map(this.mapRow));
    } catch {
      // Table may not yet be initialized in early tests
    }
  }

  private mapRow(row: any): NeuronRule {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      project: row.project,
      category: row.category as NeuronCategory,
      rule_text: row.rule_text,
      confidence_score: Number(row.confidence_score),
      trigger_count: Number(row.trigger_count),
      is_active: Boolean(row.is_active),
      source_run_id: row.source_run_id ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listRules(workspaceId = 'default', project?: string): NeuronRule[] {
    let sql = 'SELECT * FROM neuron_rules WHERE workspace_id = ?';
    const params: any[] = [workspaceId];
    if (project) {
      sql += " AND (project = ? OR project = 'all')";
      params.push(project);
    }
    sql += ' ORDER BY confidence_score DESC, trigger_count DESC, created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.mapRow);
  }

  getRule(id: string): NeuronRule | null {
    const row = this.db.prepare('SELECT * FROM neuron_rules WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  createRule(input: CreateNeuronRuleInput): NeuronRule {
    const id = `rule-${randomUUID()}`;
    const now = new Date().toISOString();
    const workspaceId = input.workspace_id || 'default';
    const confidence = input.confidence_score ?? 0.9;

    this.db
      .prepare(`
        INSERT INTO neuron_rules (id, workspace_id, project, category, rule_text, confidence_score, trigger_count, is_active, source_run_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
      `)
      .run(
        id,
        workspaceId,
        input.project,
        input.category,
        input.rule_text,
        confidence,
        input.source_run_id ?? null,
        now,
        now
      );

    this.refreshIndex();
    return this.getRule(id)!;
  }

  updateRule(id: string, patch: Partial<NeuronRule>): NeuronRule | null {
    const existing = this.getRule(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: any[] = [];
    const now = new Date().toISOString();

    if (patch.rule_text !== undefined) {
      fields.push('rule_text = ?');
      values.push(patch.rule_text);
    }
    if (patch.category !== undefined) {
      fields.push('category = ?');
      values.push(patch.category);
    }
    if (patch.confidence_score !== undefined) {
      fields.push('confidence_score = ?');
      values.push(patch.confidence_score);
    }
    if (patch.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(patch.is_active ? 1 : 0);
    }
    if (patch.trigger_count !== undefined) {
      fields.push('trigger_count = ?');
      values.push(patch.trigger_count);
    }

    if (fields.length === 0) return existing;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    this.db.prepare(`UPDATE neuron_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    this.refreshIndex();
    return this.getRule(id);
  }

  deleteRule(id: string): boolean {
    const res = this.db.prepare('DELETE FROM neuron_rules WHERE id = ?').run(id);
    this.refreshIndex();
    return res.changes > 0;
  }

  /**
   * Search active rules matching query tokens.
   */
  searchRules(query: string, limit = 5): NeuronRule[] {
    return this.index.search(query, undefined, limit);
  }

  /**
   * Enriches a task prompt with relevant learned heuristics from previous runs.
   */
  enrichPrompt(basePrompt: string, project: string): string {
    const matched = this.index.search(basePrompt, project, 4);
    if (matched.length === 0) {
      return basePrompt;
    }

    const rulesSection = [
      '### Learned Repository Patterns & Guardrails (Neuron Service)',
      'Follow these project-specific patterns learned from previous runs to ensure high-quality execution:',
      ...matched.map((r, i) => `${i + 1}. [${r.category.toUpperCase()}] ${r.rule_text}`),
      '',
    ].join('\n');

    return `${basePrompt}\n\n${rulesSection}`;
  }

  /**
   * Syncs active learned patterns to `.agents/rules/learned-patterns.md`.
   */
  syncMarkdown(workspaceDir: string): void {
    try {
      const activeRules = this.listRules('default').filter((r) => r.is_active);
      const targetDir = path.join(workspaceDir, '.agents', 'rules');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const content = [
        '# Learned Repository Patterns & Rules',
        '',
        '> Auto-synthesized by SP-Kickstack Neuron Service from agent telemetry and review outcomes.',
        '',
        ...activeRules.map(
          (r) => `- **[${r.category}]** (${r.project}) ${r.rule_text} *(confidence: ${(r.confidence_score * 100).toFixed(0)}%)*`
        ),
        '',
      ].join('\n');

      fs.writeFileSync(path.join(targetDir, 'learned-patterns.md'), content, 'utf-8');
    } catch (err: any) {
      console.warn(`[neuron] could not sync markdown rules: ${err.message}`);
    }
  }
}
