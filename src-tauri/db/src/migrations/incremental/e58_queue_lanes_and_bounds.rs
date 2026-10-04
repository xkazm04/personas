//! Two nullable queue columns on `fleet_sessions`: `lane` and `reserved_band`.
//!
//! Both are the storage half of a contract three later packages build on (a
//! bounded queue, a reserved band for Curator, and lanes). This migration adds
//! the columns and nothing else — no backfill, no index, no behaviour.
//!
//! # Why `lane` is nullable rather than `NOT NULL DEFAULT 0`
//!
//! A lane is an ORDERING device: N strands that each move to the queue's tail
//! after one of their tasks finishes. It is not a concurrency width. Lanes are
//! therefore **1-based**, matching `queue_rank`, and a row that belongs to no
//! lane is a genuinely different fact from a row in lane 0.
//!
//! The queue already demonstrates the cost of collapsing those two facts:
//! `queue_rank` is nullable and its `None` sorts as `u32::MAX`, i.e. "last".
//! A second field whose absence was spelled `0` would sort the opposite way —
//! anyone ordering by lane would read an unassigned row as "lane 0, highest
//! priority" and quietly promote every row that never opted in. NULL has no
//! such reading: it sorts out of the comparison instead of winning it.
//!
//! `reserved_band` is nullable for the same reason, with a sharper edge: the
//! column IS the reservation. NULL means the row holds none, and band 0 would
//! otherwise be indistinguishable from "no band" at every call site.
//!
//! Guarded with `has_table` / `has_column` like every other step here.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "fleet_sessions.lane",
            description: "Add lane to fleet_sessions (nullable, 1-based; NULL means no lane)",
            already_applied: |conn| {
                Ok(!has_table(conn, "fleet_sessions")?
                    || has_column(conn, "fleet_sessions", "lane")?)
            },
            apply: |conn| ddl_step(conn, "ALTER TABLE fleet_sessions ADD COLUMN lane INTEGER;"),
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "fleet_sessions.reserved_band",
            description:
                "Add reserved_band to fleet_sessions (nullable; NULL means no reservation held)",
            already_applied: |conn| {
                Ok(!has_table(conn, "fleet_sessions")?
                    || has_column(conn, "fleet_sessions", "reserved_band")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE fleet_sessions ADD COLUMN reserved_band INTEGER;",
                )
            },
        },
    )
}
