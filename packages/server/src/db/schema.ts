export const INITIAL_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  rules       TEXT NOT NULL DEFAULT '',
  context     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO workspaces (id, name, description, rules, context, created_at, updated_at)
VALUES ('default', 'Default Workspace', 'Default workspace for projects and requirements', '', '', datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS projects (
  name          TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'other',
  repo_path     TEXT NOT NULL,
  engine_type   TEXT NOT NULL,
  engine_url    TEXT,
  engine_meta   TEXT NOT NULL DEFAULT '{}',
  base_branch   TEXT NOT NULL DEFAULT 'develop',
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
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id  TEXT DEFAULT NULL REFERENCES ai_chat_sessions(id) ON DELETE SET NULL,
  seq         INTEGER NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'normal',
  body_md     TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  attachments TEXT NOT NULL DEFAULT '[]',
  merge_policy TEXT DEFAULT NULL,
  sprint_id   TEXT DEFAULT NULL REFERENCES sprints(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sprints (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  goal         TEXT,
  start_date   TEXT,
  end_date     TEXT,
  status       TEXT NOT NULL DEFAULT 'planned',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sprints_workspace ON sprints(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status);

CREATE TABLE IF NOT EXISTS shared_assets (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  size         INTEGER NOT NULL DEFAULT 0,
  data_url     TEXT NOT NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_assets_workspace ON shared_assets(workspace_id);

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
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  total_tokens    INTEGER,
  cost_usd        REAL,
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

INSERT OR IGNORE INTO settings (key, value)
VALUES ('branch_merge_settings', '{"default_base_branch":"develop","merge_policy":"manual_review_merge","auto_delete_branch":false}');

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'auto',
  model        TEXT,
  effort       TEXT NOT NULL DEFAULT 'medium',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_workspace ON ai_chat_sessions(workspace_id);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  spec_json    TEXT,
  attachments  TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages(session_id);

CREATE TABLE IF NOT EXISTS task_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES bridge_tasks(id) ON DELETE CASCADE,
  stream     TEXT NOT NULL DEFAULT 'stdout',
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id);
`;

