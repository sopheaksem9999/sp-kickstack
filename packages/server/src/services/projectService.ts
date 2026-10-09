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
        name, workspace_id, kind, repo_path, engine_type, engine_url, engine_meta,
        base_branch, contract_path, done_means, high_risk_paths, test_command,
        enabled, engine_status, created_at, updated_at
      ) VALUES (
        @name, @workspace_id, @kind, @repo_path, @engine_type, @engine_url, @engine_meta,
        @base_branch, @contract_path, @done_means, @high_risk_paths, @test_command,
        @enabled, @engine_status, @created_at, @updated_at
      )
      ON CONFLICT(name) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        kind = excluded.kind,
        repo_path = excluded.repo_path,
        engine_type = excluded.engine_type,
        engine_url = excluded.engine_url,
        engine_meta = excluded.engine_meta,
        base_branch = excluded.base_branch,
        contract_path = excluded.contract_path,
        done_means = excluded.done_means,
        high_risk_paths = excluded.high_risk_paths,
        test_command = excluded.test_command,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      ...validated,
      workspace_id: validated.workspace_id || 'default',
      engine_meta: JSON.stringify(validated.engine_meta || {}),
      high_risk_paths: JSON.stringify(validated.high_risk_paths || []),
      enabled: validated.enabled ? 1 : 0,
      engine_url: validated.engine_url || null,
      contract_path: validated.contract_path || null,
      test_command: validated.test_command || null,
    });

    return this.getProject(validated.name)!;
  }

  public getProject(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as any;
    if (!row) return null;

    return {
      ...row,
      workspace_id: row.workspace_id || 'default',
      enabled: Boolean(row.enabled),
      engine_meta: JSON.parse(row.engine_meta || '{}'),
      high_risk_paths: JSON.parse(row.high_risk_paths || '[]'),
    };
  }

  public listProjects(workspaceId?: string): Project[] {
    const rows = (
      workspaceId
        ? this.db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY name ASC').all(workspaceId)
        : this.db.prepare('SELECT * FROM projects ORDER BY name ASC').all()
    ) as any[];

    return rows.map((row) => ({
      ...row,
      workspace_id: row.workspace_id || 'default',
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

  public updateProject(name: string, patch: Partial<Project>): Project {
    const existing = this.getProject(name);
    if (!existing) {
      throw new Error(`Project '${name}' not found`);
    }

    const updated = {
      ...existing,
      ...patch,
      name: existing.name,
      updated_at: new Date().toISOString(),
    };
    const validated = ProjectSchema.parse(updated);

    this.db.prepare(`
      UPDATE projects SET
        workspace_id = @workspace_id,
        kind = @kind,
        repo_path = @repo_path,
        engine_type = @engine_type,
        engine_url = @engine_url,
        engine_meta = @engine_meta,
        base_branch = @base_branch,
        contract_path = @contract_path,
        done_means = @done_means,
        high_risk_paths = @high_risk_paths,
        test_command = @test_command,
        enabled = @enabled,
        updated_at = @updated_at
      WHERE name = @name
    `).run({
      ...validated,
      engine_meta: JSON.stringify(validated.engine_meta || {}),
      high_risk_paths: JSON.stringify(validated.high_risk_paths || []),
      enabled: validated.enabled ? 1 : 0,
      engine_url: validated.engine_url || null,
      contract_path: validated.contract_path || null,
      test_command: validated.test_command || null,
    });

    return this.getProject(name)!;
  }

  public deleteProject(name: string): void {
    const existing = this.getProject(name);
    if (!existing) {
      throw new Error(`Project '${name}' not found`);
    }

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM requirement_projects WHERE project = ?').run(name);
      this.db.prepare(`
        DELETE FROM links WHERE task_id IN (SELECT id FROM bridge_tasks WHERE project = ?)
           OR depends_on_id IN (SELECT id FROM bridge_tasks WHERE project = ?)
      `).run(name, name);
      this.db.prepare('DELETE FROM bridge_tasks WHERE project = ?').run(name);
      this.db.prepare('DELETE FROM projects WHERE name = ?').run(name);
    })();
  }

  public seedFromYaml(yamlContent: string) {
    const parsed = YAML.parse(yamlContent);
    const projects = Array.isArray(parsed) ? parsed : parsed.projects || [];
    for (const proj of projects) {
      this.registerProject(proj);
    }
  }
}
