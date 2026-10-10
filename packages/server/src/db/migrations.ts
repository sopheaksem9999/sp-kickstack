import type Database from 'better-sqlite3';

type Db = Database.Database;

export interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

function hasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.length > 0 && cols.some((c) => c.name === column);
}

function addColumn(db: Db, table: string, column: string, definition: string) {
  const exists = (db.pragma(`table_info(${table})`) as unknown[]).length > 0;
  if (exists && !hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const DEDUPE_NOTE = 'deduplicated by migration 2';

function dedupeActiveGoals(db: Db) {
  const groups = db
    .prepare(`
      SELECT req_id, project, revision FROM bridge_tasks
      WHERE role = 'goal' AND status <> 'cancelled'
      GROUP BY req_id, project, revision
      HAVING COUNT(*) > 1
    `)
    .all() as Array<{ req_id: string; project: string; revision: number }>;

  const now = new Date().toISOString();
  for (const g of groups) {
    // Keeper preference: referenced by links / origin_task_id, then has an engine id, then lowest id.
    const rows = db
      .prepare(`
        SELECT t.id,
          (EXISTS (SELECT 1 FROM links l WHERE l.task_id = t.id OR l.depends_on_id = t.id OR l.placeholder_id = t.id)
            OR EXISTS (SELECT 1 FROM bridge_tasks o WHERE o.origin_task_id = t.id)) AS referenced,
          (t.engine_task_id IS NOT NULL) AS has_engine
        FROM bridge_tasks t
        WHERE t.req_id = ? AND t.project = ? AND t.revision = ? AND t.role = 'goal' AND t.status <> 'cancelled'
        ORDER BY referenced DESC, has_engine DESC, t.id ASC
      `)
      .all(g.req_id, g.project, g.revision) as Array<{ id: number }>;

    const [keeper, ...extras] = rows;
    for (const extra of extras) {
      db.prepare(`
        UPDATE bridge_tasks SET status = 'cancelled', last_error = ?, updated_at = ? WHERE id = ?
      `).run(DEDUPE_NOTE, now, extra.id);
      // The duplicate may still be running inside its engine; surface it to the operator.
      db.prepare(`
        INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, 'task_failed', ?, 0, ?)
      `).run(g.req_id, extra.id, JSON.stringify({ reason: DEDUPE_NOTE, keptTaskId: keeper.id, project: g.project }), now);
    }
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'legacy column backfill',
    up: (db) => {
      addColumn(db, 'projects', 'workspace_id', "TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE");
      addColumn(db, 'requirements', 'workspace_id', "TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE");
      addColumn(db, 'requirements', 'attachments', "TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, 'requirements', 'merge_policy', 'TEXT DEFAULT NULL');
      addColumn(db, 'requirements', 'sprint_id', 'TEXT DEFAULT NULL REFERENCES sprints(id) ON DELETE SET NULL');
      addColumn(db, 'requirements', 'session_id', 'TEXT DEFAULT NULL REFERENCES ai_chat_sessions(id) ON DELETE SET NULL');
      addColumn(db, 'ai_chat_sessions', 'effort', "TEXT NOT NULL DEFAULT 'medium'");
      addColumn(db, 'ai_chat_messages', 'attachments', "TEXT NOT NULL DEFAULT '[]'");
    },
  },
  {
    version: 2,
    name: 'task attempts, idempotency keys, one active goal per revision',
    up: (db) => {
      addColumn(db, 'bridge_tasks', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'bridge_tasks', 'idempotency_key', 'TEXT');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_idem
        ON bridge_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL
      `);
      dedupeActiveGoals(db);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_goal_once
        ON bridge_tasks(req_id, project, revision) WHERE role = 'goal' AND status <> 'cancelled'
      `);
    },
  },
  {
    version: 3,
    name: 'task branches, merge gate state, project test command, auto_merge policy',
    up: (db) => {
      addColumn(db, 'bridge_tasks', 'branch', 'TEXT');
      addColumn(db, 'bridge_tasks', 'base_sha', 'TEXT');
      addColumn(db, 'bridge_tasks', 'merge_sha', 'TEXT');
      addColumn(db, 'bridge_tasks', 'merged_at', 'TEXT');
      addColumn(db, 'requirements', 'merge_state', "TEXT NOT NULL DEFAULT 'idle'");
      addColumn(db, 'requirements', 'merge_error', 'TEXT');
      addColumn(db, 'projects', 'test_command', 'TEXT');

      db.prepare("UPDATE requirements SET merge_policy = 'auto_merge' WHERE merge_policy = 'auto_merge_main'").run();
      const row = db.prepare("SELECT value FROM settings WHERE key = 'branch_merge_settings'").get() as
        | { value: string }
        | undefined;
      if (row) {
        try {
          const settings = JSON.parse(row.value);
          if (settings.merge_policy === 'auto_merge_main') {
            settings.merge_policy = 'auto_merge';
            db.prepare("UPDATE settings SET value = ? WHERE key = 'branch_merge_settings'").run(JSON.stringify(settings));
          }
        } catch {
          // Unparseable settings are left for SettingsService to fall back from.
        }
      }
    },
  },
  {
    version: 4,
    name: 'rate-limit pause time for tasks',
    up: (db) => {
      addColumn(db, 'bridge_tasks', 'paused_until', 'TEXT');
    },
  },
  {
    version: 5,
    name: 'agent questions: options and answers',
    up: (db) => {
      addColumn(db, 'bridge_tasks', 'options', 'TEXT');
      addColumn(db, 'bridge_tasks', 'answer_md', 'TEXT');
      addColumn(db, 'bridge_tasks', 'answered_at', 'TEXT');
    },
  },
  {
    version: 6,
    name: 'review comments',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_comments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          req_id     TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
          task_id    INTEGER NOT NULL REFERENCES bridge_tasks(id) ON DELETE CASCADE,
          file_path  TEXT,
          line       INTEGER,
          body_md    TEXT NOT NULL,
          state      TEXT NOT NULL DEFAULT 'open',
          round      INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          sent_at    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_review_comments_req ON review_comments(req_id);
      `);
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function getUserVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Apply pending migrations in order. Each runs in its own BEGIN IMMEDIATE transaction
 * with foreign keys off (SQLite rejects ADD COLUMN ... REFERENCES with a non-NULL default
 * while they are on). The version is re-read inside the transaction because another
 * process (the MCP server) may open the same database concurrently. Failures throw.
 */
export function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): { from: number; to: number } {
  const from = getUserVersion(db);
  for (const migration of migrations) {
    if (getUserVersion(db) >= migration.version) continue;

    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        if (getUserVersion(db) >= migration.version) return;
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      }).immediate();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  return { from, to: getUserVersion(db) };
}
