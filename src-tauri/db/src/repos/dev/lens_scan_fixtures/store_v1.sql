-- Test fixture: the lens-scan store at v1 (ai-registry skills/lens-scan/references/store.sql before the
-- release train): runs, measurements, proposals, activity, shots, coverage. No packs or releases tables,
-- no v2 columns. The CHECK constraints of the real DDL are left out: the reader never relies on them.
CREATE TABLE runs (
  id            TEXT NOT NULL PRIMARY KEY,
  started_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  ended_at      TEXT,
  phase         TEXT NOT NULL,
  status        TEXT NOT NULL,
  lenses        TEXT NOT NULL,
  scope         TEXT,
  skill_version TEXT,
  model         TEXT,
  note          TEXT
);
CREATE TABLE measurements (
  id          INTEGER PRIMARY KEY,
  run_id      TEXT NOT NULL,
  feature     TEXT NOT NULL,
  lens        TEXT NOT NULL,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT,
  method      TEXT,
  evidence    TEXT,
  measured_at TEXT NOT NULL
);
CREATE TABLE proposals (
  id             TEXT NOT NULL PRIMARY KEY,
  run_id         TEXT NOT NULL,
  feature        TEXT NOT NULL,
  lens           TEXT NOT NULL,
  metric         TEXT,
  title          TEXT NOT NULL,
  body           TEXT,
  standard       TEXT NOT NULL DEFAULT 'none',
  expected_delta REAL,
  size           TEXT,
  risk           INTEGER,
  kind           TEXT NOT NULL,
  parent_id      TEXT,
  status         TEXT NOT NULL,
  decided_by     TEXT,
  decided_at     TEXT,
  decision_note  TEXT,
  after_value    REAL,
  result_sha     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE TABLE activity (
  id      INTEGER PRIMARY KEY,
  run_id  TEXT NOT NULL,
  at      TEXT NOT NULL,
  feature TEXT,
  lens    TEXT,
  kind    TEXT NOT NULL,
  text    TEXT NOT NULL
);
CREATE TABLE shots (
  id             INTEGER PRIMARY KEY,
  run_id         TEXT NOT NULL,
  feature        TEXT NOT NULL,
  path           TEXT NOT NULL,
  size           TEXT,
  theme          TEXT,
  harness_module TEXT,
  captured_at    TEXT NOT NULL,
  report         TEXT
);
CREATE TABLE coverage (
  feature   TEXT NOT NULL,
  standard  TEXT NOT NULL,
  state     TEXT NOT NULL,
  evidence  TEXT,
  judged_at TEXT NOT NULL,
  run_id    TEXT,
  PRIMARY KEY (feature, standard)
);
PRAGMA user_version = 1;
