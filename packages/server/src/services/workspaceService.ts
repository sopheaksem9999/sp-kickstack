import { AppDatabase } from '../db/index.js';
import {
  Workspace,
  WorkspaceSchema,
  CreateWorkspaceInput,
  CreateWorkspaceInputSchema,
  UpdateWorkspaceInput,
  UpdateWorkspaceInputSchema,
} from '@sp-kickstack/shared';

export class WorkspaceService {
  constructor(private db: AppDatabase) {}

  public listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM workspaces 
        ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, name ASC
      `)
      .all() as any[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      rules: r.rules || '',
      context: r.context || '',
      agent_model: r.agent_model ?? null,
      agent_effort: r.agent_effort ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  public getWorkspace(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      rules: row.rules || '',
      context: row.context || '',
      agent_model: row.agent_model ?? null,
      agent_effort: row.agent_effort ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  public createWorkspace(input: CreateWorkspaceInput): Workspace {
    const validated = CreateWorkspaceInputSchema.parse(input);
    const now = new Date().toISOString();

    const existing = this.getWorkspace(validated.id);
    if (existing) {
      throw new Error(`Workspace with id '${validated.id}' already exists`);
    }

    this.db.prepare(`
      INSERT INTO workspaces (id, name, description, rules, context, created_at, updated_at)
      VALUES (@id, @name, @description, @rules, @context, @created_at, @updated_at)
    `).run({
      id: validated.id,
      name: validated.name,
      description: validated.description || '',
      rules: validated.rules || '',
      context: validated.context || '',
      created_at: now,
      updated_at: now,
    });

    return this.getWorkspace(validated.id)!;
  }

  public updateWorkspace(id: string, input: UpdateWorkspaceInput): Workspace {
    const existing = this.getWorkspace(id);
    if (!existing) {
      throw new Error(`Workspace '${id}' not found`);
    }

    const validated = UpdateWorkspaceInputSchema.parse(input);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE workspaces
      SET 
        name = COALESCE(@name, name),
        description = COALESCE(@description, description),
        rules = COALESCE(@rules, rules),
        context = COALESCE(@context, context),
        updated_at = @updated_at
      WHERE id = @id
    `).run({
      id,
      name: validated.name ?? null,
      description: validated.description ?? null,
      rules: validated.rules ?? null,
      context: validated.context ?? null,
      updated_at: now,
    });

    // The agent defaults can be cleared, which COALESCE cannot express: undefined keeps, null clears.
    if (validated.agent_model !== undefined || validated.agent_effort !== undefined) {
      this.db
        .prepare(`
          UPDATE workspaces SET
            agent_model = CASE WHEN @setModel = 1 THEN @model ELSE agent_model END,
            agent_effort = CASE WHEN @setEffort = 1 THEN @effort ELSE agent_effort END
          WHERE id = @id
        `)
        .run({
          id,
          setModel: validated.agent_model !== undefined ? 1 : 0,
          model: validated.agent_model ?? null,
          setEffort: validated.agent_effort !== undefined ? 1 : 0,
          effort: validated.agent_effort ?? null,
        });
    }

    return this.getWorkspace(id)!;
  }

  public deleteWorkspace(id: string): void {
    if (id === 'default') {
      throw new Error('Cannot delete default workspace');
    }
    const res = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    if (res.changes === 0) {
      throw new Error(`Workspace '${id}' not found`);
    }
  }
}
