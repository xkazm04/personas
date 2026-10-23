-- Test fixture: what v2 adds to v1 (the release train): the packs and releases tables, the pack / commit /
-- attempt / release / triage columns on proposals, and the before/after linkage on measurements and shots.
CREATE TABLE packs (
  id         TEXT NOT NULL PRIMARY KEY,
  lens       TEXT NOT NULL,
  n          INTEGER NOT NULL,
  branch     TEXT NOT NULL,
  base_ref   TEXT NOT NULL,
  base_sha   TEXT NOT NULL,
  run_id     TEXT,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE releases (
  id         TEXT NOT NULL PRIMARY KEY,
  version    TEXT NOT NULL,
  branch     TEXT NOT NULL,
  base_sha   TEXT,
  status     TEXT NOT NULL,
  pr_url     TEXT,
  tag        TEXT,
  notes      TEXT,
  error      TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE proposals ADD COLUMN pack_id TEXT;
ALTER TABLE proposals ADD COLUMN commit_sha TEXT;
ALTER TABLE proposals ADD COLUMN attempt_of TEXT;
ALTER TABLE proposals ADD COLUMN release_id TEXT;
ALTER TABLE proposals ADD COLUMN triage_note TEXT;
ALTER TABLE proposals ADD COLUMN triaged_by TEXT;
ALTER TABLE proposals ADD COLUMN triaged_at TEXT;
ALTER TABLE measurements ADD COLUMN proposal_id TEXT;
ALTER TABLE measurements ADD COLUMN phase TEXT;
ALTER TABLE measurements ADD COLUMN commit_sha TEXT;
ALTER TABLE shots ADD COLUMN proposal_id TEXT;
ALTER TABLE shots ADD COLUMN phase TEXT;
PRAGMA user_version = 2;
