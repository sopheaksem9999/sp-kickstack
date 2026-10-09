import { AppDatabase } from '../db/index.js';
import { Project, ProjectSchema } from '@sp-kickstack/shared';
import YAML from 'yaml';

export class ProjectService {
  constructor(private db: AppDatabase) {}

  public registerProject(input: Partial<Project> & { name: string; repo_path: string; engine_type: any }): Project {
    const now = new Date().toISOString();
    const validated = ProjectSchema.parse({
      ...input,
      created_at: now,
      updated_at: now,
    });

    const stmt = this.db.prepare(`
      INSERT INTO projects (
        name, kind, repo_path, engine_type, engine_url, engine_meta,
        base_branch, contract_path, done_means, high_risk_paths,
        enabled, engine_status, created_at, updated_at
      ) VALUES (
        @name, @kind, @repo_path, @engine_type, @engine_url, @engine_meta,
        @base_branch, @contract_path, @done_means, @high_risk_paths,
        @enabled, @engine_status, @created_at, @updated_at
      )
      ON CONFLICT(name) DO UPDATE SET
        kind = excluded.kind,
        repo_path = excluded.repo_path,
        engine_type = excluded.engine_type,
        engine_url = excluded.engine_url,
        engine_meta = excluded.engine_meta,
        base_branch = excluded.base_branch,
        contract_path = excluded.contract_path,
        done_means = excluded.done_means,
        high_risk_paths = excluded.high_risk_paths,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      ...validated,
      engine_meta: JSON.stringify(validated.engine_meta || {}),
      high_risk_paths: JSON.stringify(validated.high_risk_paths || []),
      enabled: validated.enabled ? 1 : 0,
      engine_url: validated.engine_url || null,
      contract_path: validated.contract_path || null,
    });

    return this.getProject(validated.name)!;
  }

  public getProject(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as any;
    if (!row) return null;

    return {
      ...row,
      enabled: Boolean(row.enabled),
      engine_meta: JSON.parse(row.engine_meta || '{}'),
      high_risk_paths: JSON.parse(row.high_risk_paths || '[]'),
    };
  }

  public listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY name ASC').all() as any[];
    return rows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      engine_meta: JSON.parse(row.engine_meta || '{}'),
      high_risk_paths: JSON.parse(row.high_risk_paths || '[]'),
    }));
  }

  public updateEngineStatus(name: string, status: 'ok' | 'down' | 'unknown') {
    this.db.prepare(`
      UPDATE projects SET engine_status = ?, updated_at = datetime('now') WHERE name = ?
    `).run(status, name);
  }

  public seedFromYaml(yamlContent: string) {
    const parsed = YAML.parse(yamlContent);
    const projects = Array.isArray(parsed) ? parsed : parsed.projects || [];
    for (const proj of projects) {
      this.registerProject(proj);
    }
  }
}
