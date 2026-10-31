-- Test fixture: what v4 adds to v3 (severity and imported items): seven proposals columns, last in the table, as
-- lens-scan's references/store.sql declares them. lens-scan's own migration rebuilds the table to widen the kind CHECK
-- to 'work-item' (store.mjs migrateV3); the reader sees only columns, so ADD COLUMN yields the same rows.
ALTER TABLE proposals ADD COLUMN origin TEXT NOT NULL DEFAULT 'scan' CHECK (origin IN ('scan', 'ado', 'sweep'));
ALTER TABLE proposals ADD COLUMN external_ref TEXT;
ALTER TABLE proposals ADD COLUMN external_url TEXT;
ALTER TABLE proposals ADD COLUMN tier INTEGER CHECK (tier BETWEEN 0 AND 3);
ALTER TABLE proposals ADD COLUMN risk_class TEXT CHECK (risk_class IN ('secret', 'authz', 'money', 'data', 'llm', 'perf', 'reliability', 'ux', 'debt'));
ALTER TABLE proposals ADD COLUMN ranked_by TEXT;
ALTER TABLE proposals ADD COLUMN ranked_at TEXT;
PRAGMA user_version = 4;
