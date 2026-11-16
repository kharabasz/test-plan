import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const schema = `
CREATE TABLE IF NOT EXISTS test_groups (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  parent_id TEXT REFERENCES test_groups(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES test_groups(id),
  short_description TEXT NOT NULL,
  full_description TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT NOT NULL REFERENCES tests(id),
  run_at TEXT NOT NULL,
  run_at_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail')),
  failure_description TEXT,
  reported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_test_results_latest
  ON test_results (test_id, run_at_utc DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_tests_group ON tests (group_id);

CREATE TRIGGER IF NOT EXISTS test_results_append_only_update
  BEFORE UPDATE ON test_results
  BEGIN SELECT RAISE(ABORT, 'test results are append only'); END;

CREATE TRIGGER IF NOT EXISTS test_results_append_only_delete
  BEFORE DELETE ON test_results
  BEGIN SELECT RAISE(ABORT, 'test results are append only'); END;
`;

export function openDatabase(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(schema);
  return db;
}
