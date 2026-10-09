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

  return db;
}
