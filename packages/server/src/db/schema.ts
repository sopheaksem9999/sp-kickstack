export const INITIAL_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  name          TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'other',
  repo_path     TEXT NOT NULL,
  engine_type   TEXT NOT NULL,
  engine_url    TEXT,
  engine_meta   TEXT NOT NULL DEFAULT '{}',
  base_branch   TEXT NOT NULL DEFAULT 'main',
  contract_path TEXT,
  done_means    TEXT NOT NULL DEFAULT 'merged',
  high_risk_paths TEXT NOT NULL DEFAULT '[]',
  enabled       INTEGER NOT NULL DEFAULT 1,
  engine_status TEXT NOT NULL DEFAULT 'unknown',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requirements (
  id          TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'normal',
  body_md     TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requirement_projects (
  req_id  TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  project TEXT NOT NULL REFERENCES projects(name),
  PRIMARY KEY (req_id, project)
);

CREATE TABLE IF NOT EXISTS bridge_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id          TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  project         TEXT NOT NULL REFERENCES projects(name),
  role            TEXT NOT NULL,
  engine_task_id  TEXT,
  title           TEXT NOT NULL,
  body_md         TEXT,
  origin_task_id  INTEGER REFERENCES bridge_tasks(id),
  depth           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  engine_status_raw TEXT,
  engine_url      TEXT,
  pr_url          TEXT,
  last_error      TEXT,
  revision        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bridge_tasks_engine ON bridge_tasks(project, engine_task_id);
CREATE INDEX IF NOT EXISTS idx_bridge_tasks_req ON bridge_tasks(req_id);

CREATE TABLE IF NOT EXISTS links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES bridge_tasks(id) ON DELETE CASCADE,
  depends_on_id  INTEGER NOT NULL REFERENCES bridge_tasks(id) ON DELETE CASCADE,
  placeholder_id INTEGER REFERENCES bridge_tasks(id),
  state          TEXT NOT NULL DEFAULT 'waiting',
  context_md     TEXT,
  created_at     TEXT NOT NULL,
  released_at    TEXT,
  CHECK (task_id <> depends_on_id),
  UNIQUE (task_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id    TEXT,
  task_id   INTEGER,
  type      TEXT NOT NULL,
  payload   TEXT NOT NULL DEFAULT '{}',
  read      INTEGER NOT NULL DEFAULT 0,
  at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
CREATE INDEX IF NOT EXISTS idx_events_req_id ON events(req_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
