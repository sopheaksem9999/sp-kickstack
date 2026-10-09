import Database from 'better-sqlite3';
import { INITIAL_SCHEMA } from './schema.js';
import { LATEST_VERSION, getUserVersion, runMigrations } from './migrations.js';
import path from 'node:path';
import fs from 'node:fs';

export type AppDatabase = Database.Database;

export function initDatabase(dbPath: string = ':memory:'): AppDatabase {
  const isFile = dbPath !== ':memory:';
  if (isFile) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Back up an existing database before its schema changes. VACUUM INTO cannot run
  // inside a transaction, so it happens here, before any migration starts.
  const hadTables =
    (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get() as { c: number }).c > 0;
  const fromVersion = getUserVersion(db);
  if (isFile && hadTables && fromVersion < LATEST_VERSION) {
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(dbPath, path.extname(dbPath));
    db.prepare('VACUUM INTO ?').run(path.join(backupDir, `${base}-${stamp}-v${fromVersion}.db`));
  }

  // Execute schema
  db.exec(INITIAL_SCHEMA);

  // Numbered migrations (db/migrations.ts); failures throw instead of being swallowed.
  runMigrations(db);

  return db;
}
