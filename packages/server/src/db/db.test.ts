import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, AppDatabase } from './index.js';

describe('Database Initialization & Constraints', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('initializes schema and tables correctly', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row: any) => row.name);

    expect(tables).toContain('workspaces');
    expect(tables).toContain('projects');
    expect(tables).toContain('requirements');
    expect(tables).toContain('requirement_projects');
    expect(tables).toContain('bridge_tasks');
    expect(tables).toContain('links');
    expect(tables).toContain('events');
    expect(tables).toContain('settings');

    const defaultWs = db.prepare("SELECT * FROM workspaces WHERE id = 'default'").get() as any;
    expect(defaultWs).toBeDefined();
    expect(defaultWs.name).toBe('Default Workspace');
  });

  it('enforces foreign key constraints', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO bridge_tasks (req_id, project, role, title, created_at, updated_at)
        VALUES ('NON_EXISTENT', 'backend', 'goal', 'Task 1', datetime('now'), datetime('now'))
      `).run();
    }).toThrow();
  });

  it('cascades deletion of requirement to bridge_tasks and requirement_projects', () => {
    // Insert project
    db.prepare(`
      INSERT INTO projects (name, repo_path, engine_type, created_at, updated_at)
      VALUES ('backend', '/repos/backend', 'manual', datetime('now'), datetime('now'))
    `).run();

    // Insert requirement
    db.prepare(`
      INSERT INTO requirements (id, seq, title, status, body_md, file_path, created_at, updated_at)
      VALUES ('REQ-001', 1, 'Test', 'draft', '# Test', 'reqs/1.md', datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO requirement_projects (req_id, project)
      VALUES ('REQ-001', 'backend')
    `).run();

    db.prepare(`
      INSERT INTO bridge_tasks (req_id, project, role, title, created_at, updated_at)
      VALUES ('REQ-001', 'backend', 'goal', 'Task 1', datetime('now'), datetime('now'))
    `).run();

    const tasksBefore = db.prepare('SELECT * FROM bridge_tasks WHERE req_id = ?').all('REQ-001');
    expect(tasksBefore.length).toBe(1);

    // Delete requirement
    db.prepare('DELETE FROM requirements WHERE id = ?').run('REQ-001');

    const reqProjects = db.prepare('SELECT * FROM requirement_projects WHERE req_id = ?').all('REQ-001');
    expect(reqProjects.length).toBe(0);
  });
});
