import { AppDatabase } from '../db/index.js';
import { CreateSprintInput, UpdateSprintInput, Sprint } from '@sp-kickstack/shared';
import crypto from 'node:crypto';

export class SprintService {
  constructor(private db: AppDatabase) {}

  public listSprints(workspaceId?: string): Sprint[] {
    const rows = (
      workspaceId && workspaceId !== 'all'
        ? this.db
            .prepare('SELECT * FROM sprints WHERE workspace_id = ? ORDER BY created_at DESC')
            .all(workspaceId)
        : this.db.prepare('SELECT * FROM sprints ORDER BY created_at DESC').all()
    ) as any[];

    return rows.map((r) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      name: r.name,
      goal: r.goal || undefined,
      start_date: r.start_date || undefined,
      end_date: r.end_date || undefined,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  public getSprint(id: string): Sprint | null {
    const r = this.db.prepare('SELECT * FROM sprints WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      workspace_id: r.workspace_id,
      name: r.name,
      goal: r.goal || undefined,
      start_date: r.start_date || undefined,
      end_date: r.end_date || undefined,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  public getActiveSprint(workspaceId: string): Sprint | null {
    const r = this.db
      .prepare("SELECT * FROM sprints WHERE workspace_id = ? AND status = 'active' LIMIT 1")
      .get(workspaceId) as any;
    if (!r) return null;
    return this.getSprint(r.id);
  }

  public createSprint(input: CreateSprintInput): Sprint {
    const id = `sprint_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO sprints (id, workspace_id, name, goal, start_date, end_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)
      `)
      .run(
        id,
        input.workspace_id || 'default',
        input.name,
        input.goal || null,
        input.start_date || null,
        input.end_date || null,
        now,
        now
      );

    return this.getSprint(id)!;
  }

  public updateSprint(id: string, input: UpdateSprintInput): Sprint {
    const existing = this.getSprint(id);
    if (!existing) throw new Error(`Sprint ${id} not found`);

    const name = input.name !== undefined ? input.name : existing.name;
    const goal = input.goal !== undefined ? input.goal : existing.goal;
    const start_date = input.start_date !== undefined ? input.start_date : existing.start_date;
    const end_date = input.end_date !== undefined ? input.end_date : existing.end_date;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE sprints
        SET name = ?, goal = ?, start_date = ?, end_date = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(name, goal || null, start_date || null, end_date || null, now, id);

    return this.getSprint(id)!;
  }

  public startSprint(id: string): Sprint {
    const target = this.getSprint(id);
    if (!target) throw new Error(`Sprint ${id} not found`);

    const tx = this.db.transaction(() => {
      // Complete any existing active sprint in the same workspace
      this.db
        .prepare(`
          UPDATE sprints
          SET status = 'completed', updated_at = datetime('now')
          WHERE workspace_id = ? AND status = 'active' AND id != ?
        `)
        .run(target.workspace_id, id);

      // Activate target sprint
      this.db
        .prepare(`
          UPDATE sprints
          SET status = 'active', updated_at = datetime('now')
          WHERE id = ?
        `)
        .run(id);
    });

    tx();
    return this.getSprint(id)!;
  }

  public completeSprint(id: string): { sprint: Sprint; rolledOverCount: number } {
    const target = this.getSprint(id);
    if (!target) throw new Error(`Sprint ${id} not found`);

    let rolledOverCount = 0;

    const tx = this.db.transaction(() => {
      // Mark sprint completed
      this.db
        .prepare(`
          UPDATE sprints
          SET status = 'completed', updated_at = datetime('now')
          WHERE id = ?
        `)
        .run(id);

      // Roll unfinished requirements (status != 'done') back to Product Backlog
      const res = this.db
        .prepare(`
          UPDATE requirements
          SET sprint_id = NULL, updated_at = datetime('now')
          WHERE sprint_id = ? AND status != 'done'
        `)
        .run(id);

      rolledOverCount = res.changes;
    });

    tx();

    return {
      sprint: this.getSprint(id)!,
      rolledOverCount,
    };
  }
}
