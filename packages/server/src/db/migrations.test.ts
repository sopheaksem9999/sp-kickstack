import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from './index.js';
import { runMigrations, LATEST_VERSION } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.resolve(__dirname, '../../.temp/sp-test-migrations');

const LEGACY_SCHEMA = `
CREATE TABLE projects (
  name TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'other', repo_path TEXT NOT NULL,
  engine_type TEXT NOT NULL, engine_url TEXT, engine_meta TEXT NOT NULL DEFAULT '{}',
  base_branch TEXT NOT NULL DEFAULT 'develop', contract_path TEXT,
  done_means TEXT NOT NULL DEFAULT 'merged', high_risk_paths TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1, engine_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE requirements (
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal', body_md TEXT NOT NULL, file_path TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO projects (name, repo_path, engine_type, created_at, updated_at)
VALUES ('backend', '/repos/backend', 'manual', '2026-01-01', '2026-01-01');
INSERT INTO requirements (id, seq, title, status, body_md, file_path, created_at, updated_at)
VALUES ('REQ-001', 1, 'Legacy', 'draft', '# Legacy', 'r.md', '2026-01-01', '2026-01-01');
`;

function columns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as any[]).map((c) => c.name);
}

describe('Database migrations', () => {
  let caseDir: string;
  let n = 0;

  beforeEach(() => {
    caseDir = path.join(tempDir, `case-${process.pid}-${n++}`);
    fs.mkdirSync(caseDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('brings a fresh database to the latest version with the new columns', () => {
    const db = initDatabase(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(7);
    expect(columns(db, 'review_comments')).toEqual(expect.arrayContaining(['task_id', 'file_path', 'line', 'body_md', 'state', 'round']));
    expect(columns(db, 'bridge_tasks')).toEqual(
      expect.arrayContaining(['attempts', 'idempotency_key', 'branch', 'base_sha', 'merge_sha', 'merged_at', 'paused_until', 'options', 'answer_md', 'answered_at'])
    );
    expect(columns(db, 'requirements')).toEqual(expect.arrayContaining(['merge_state', 'merge_error']));
    expect(columns(db, 'projects')).toContain('test_command');
    expect(columns(db, 'workspaces')).toEqual(expect.arrayContaining(['agent_model', 'agent_effort']));
    expect(columns(db, 'requirements')).toEqual(expect.arrayContaining(['agent_model', 'agent_effort']));
    expect(columns(db, 'bridge_tasks')).toEqual(expect.arrayContaining(['model', 'effort', 'model_override', 'effort_override']));
    db.close();
  });

  it('migration 3 renames the auto_merge_main policy everywhere', () => {
    const file = path.join(caseDir, 'bridge.db');
    const seed = initDatabase(file);
    seed.prepare("UPDATE settings SET value = ? WHERE key = 'branch_merge_settings'").run(
      JSON.stringify({ default_base_branch: 'develop', merge_policy: 'auto_merge_main', auto_delete_branch: false })
    );
    seed.exec(`
      INSERT INTO requirements (id, seq, title, status, body_md, file_path, merge_policy, created_at, updated_at)
      VALUES ('REQ-001', 1, 'T', 'draft', '#', 'f', 'auto_merge_main', 'x', 'x');
    `);
    seed.pragma('user_version = 2');
    seed.close();

    const db = initDatabase(file);
    const settings = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'branch_merge_settings'").get() as any).value);
    expect(settings.merge_policy).toBe('auto_merge');
    expect((db.prepare("SELECT merge_policy FROM requirements WHERE id = 'REQ-001'").get() as any).merge_policy).toBe('auto_merge');
    expect((db.prepare("SELECT merge_state FROM requirements WHERE id = 'REQ-001'").get() as any).merge_state).toBe('idle');
    db.close();
  });

  it('migrates a legacy file database without losing rows and backs it up first', () => {
    const file = path.join(caseDir, 'bridge.db');
    const legacy = new Database(file);
    legacy.exec(LEGACY_SCHEMA);
    legacy.close();

    const db = initDatabase(file);

    expect(columns(db, 'projects')).toContain('workspace_id');
    expect(columns(db, 'requirements')).toEqual(
      expect.arrayContaining(['workspace_id', 'attachments', 'merge_policy', 'sprint_id'])
    );
    expect((db.prepare('SELECT COUNT(*) c FROM requirements').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) c FROM projects').get() as any).c).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);

    const backups = fs.readdirSync(path.join(caseDir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^bridge-.*-v0\.db$/);
    db.close();
  });

  it('does not back up fresh or already-current databases', () => {
    const file = path.join(caseDir, 'bridge.db');
    initDatabase(file).close();
    initDatabase(file).close();
    expect(fs.existsSync(path.join(caseDir, 'backups'))).toBe(false);
  });

  it('deduplicates active goals before enforcing one goal per (req, project, revision)', () => {
    const file = path.join(caseDir, 'bridge.db');
    const seed = initDatabase(file);
    seed.exec('DROP INDEX IF EXISTS ux_goal_once');
    seed.exec(`
      INSERT INTO projects (name, repo_path, engine_type, created_at, updated_at)
      VALUES ('backend', '/r/b', 'manual', 'x', 'x'), ('mobile', '/r/m', 'manual', 'x', 'x');
      INSERT INTO requirements (id, seq, title, status, body_md, file_path, created_at, updated_at)
      VALUES ('REQ-001', 1, 'T', 'in_progress', '#', 'f', 'x', 'x');
    `);
    const goal = seed.prepare(`
      INSERT INTO bridge_tasks (id, req_id, project, role, engine_task_id, title, status, revision, created_at, updated_at)
      VALUES (?, 'REQ-001', ?, ?, ?, 't', 'queued', 1, 'x', 'x')
    `);
    // backend: no reference anywhere -> keep the one with an engine id (11)
    goal.run(10, 'backend', 'goal', null);
    goal.run(11, 'backend', 'goal', 'e-11');
    goal.run(12, 'backend', 'goal', null);
    // mobile: 20 has no engine id but a link depends on it -> it wins over 21
    goal.run(20, 'mobile', 'goal', null);
    goal.run(21, 'mobile', 'goal', 'e-21');
    goal.run(30, 'backend', 'ticket', 'e-30');
    seed.exec(`INSERT INTO links (task_id, depends_on_id, state, created_at) VALUES (20, 30, 'waiting', 'x')`);
    seed.pragma('user_version = 1');
    seed.close();

    const db = initDatabase(file);
    const active = db
      .prepare("SELECT id FROM bridge_tasks WHERE role = 'goal' AND status <> 'cancelled' ORDER BY id")
      .all()
      .map((r: any) => r.id);
    expect(active).toEqual([11, 20]);

    const dropped = db
      .prepare("SELECT id, last_error FROM bridge_tasks WHERE status = 'cancelled' ORDER BY id")
      .all() as any[];
    expect(dropped.map((r) => r.id)).toEqual([10, 12, 21]);
    expect(dropped.every((r) => r.last_error === 'deduplicated by migration 2')).toBe(true);
    expect((db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'task_failed'").get() as any).c).toBe(3);
    db.close();
  });

  it('rejects a second active goal for the same requirement, project and revision', () => {
    const db = initDatabase(':memory:');
    db.exec(`
      INSERT INTO projects (name, repo_path, engine_type, created_at, updated_at) VALUES ('backend', '/r', 'manual', 'x', 'x');
      INSERT INTO requirements (id, seq, title, status, body_md, file_path, created_at, updated_at)
      VALUES ('REQ-001', 1, 'T', 'ready', '#', 'f', 'x', 'x');
    `);
    const insert = (status: string) =>
      db
        .prepare(`
          INSERT INTO bridge_tasks (req_id, project, role, title, status, revision, created_at, updated_at)
          VALUES ('REQ-001', 'backend', 'goal', 't', ?, 1, 'x', 'x')
        `)
        .run(status);

    insert('cancelled');
    insert('queued');
    expect(() => insert('pending')).toThrow(/UNIQUE/);
    db.close();
  });

  it('throws on a failing migration and keeps the earlier ones committed', () => {
    const db = new Database(':memory:');
    const migrations = [
      { version: 1, name: 'one', up: (d: Database.Database) => d.exec('CREATE TABLE t1 (x)') },
      { version: 2, name: 'two', up: (d: Database.Database) => { d.exec('CREATE TABLE t2 (x)'); throw new Error('boom'); } },
    ];

    expect(() => runMigrations(db, migrations)).toThrow(/boom/);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => r.name);
    expect(tables).toContain('t1');
    expect(tables).not.toContain('t2');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});
