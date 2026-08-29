//! The memory-reaper orphan ledger (deferred-fixes #108; registry technique
//! `entity-lifecycle/orphan-reconciliation`).
//!
//! One table, main DB, **no foreign keys** — deliberately: this is the durable
//! record of a memory deletion's unfinished cross-store business (vector rows
//! in `personas_data.db` the relational cascade cannot reach), so no entity's
//! deletion may be able to cascade into the record of its own owed cleanup.
//! Written at every memory delete door (`repos::core::memory_reaper`) before
//! the fire-and-forget reapers run; a reaper's success resolves the row; the
//! dependent-side sweep drains whatever remains.
//!
//! `pending` is a JSON array of reaper names still owed (from the
//! `MEMORY_REAPERS` registry); an empty set resolves the row (it is deleted).

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    if has_table(conn, "memory_reaper_ledger")? {
        return Ok(());
    }
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_reaper_ledger (
            memory_id         TEXT PRIMARY KEY,
            display_name      TEXT,
            pending           TEXT NOT NULL,
            attempts          INTEGER NOT NULL DEFAULT 0,
            first_recorded_at TEXT NOT NULL,
            last_attempt_at   TEXT
        );",
    )?;
    Ok(())
}
