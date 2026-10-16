-- Test fixture: what v3 adds to v2 (the undo): proposals.triaged_from, last in the table.
ALTER TABLE proposals ADD COLUMN triaged_from TEXT;
PRAGMA user_version = 3;
