import Database from 'better-sqlite3';
import { INITIAL_SCHEMA } from './schema.js';
import path from 'node:path';
import fs from 'node:fs';

export type AppDatabase = Database.Database;

export function initDatabase(dbPath: string = ':memory:'): AppDatabase {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  
  // Pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Execute schema
  db.exec(INITIAL_SCHEMA);

  // Migrate existing tables if columns are missing
  try {
    const projCols = db.pragma('table_info(projects)') as any[];
    if (projCols.length > 0 && !projCols.some((col) => col.name === 'workspace_id')) {
      db.exec("ALTER TABLE projects ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;");
    }
    const reqCols = db.pragma('table_info(requirements)') as any[];
    if (reqCols.length > 0 && !reqCols.some((col) => col.name === 'workspace_id')) {
      db.exec("ALTER TABLE requirements ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;");
    }
  } catch (err) {
    // Already migrated or in-memory
  }

  return db;
}
