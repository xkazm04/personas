//! The fleet dispatch queue's durable half: seven nullable columns on
//! `fleet_sessions`.
//!
//! A dispatch that arrives while the fleet is at its live-session cap
//! (`fleet.max_parallel_sessions`) is admitted as a `queued` row instead of
//! being started over the cap or silently refused. The row already carries
//! everything a later spawn needs (`cwd`, `args_json`, `mode`, `run_label`,
//! `name`, `title`); these columns add the queue's own facts — the position,
//! when it was admitted, an earliest-start gate, and the dispatch's provenance
//! (who asked, for which persona / goal, in which cycle) — so a restart
//! re-ranks and resumes the queue rather than losing it.
//!
//! All nullable: every pre-queue row reads as "never queued", and a promoted
//! row keeps its provenance with `queue_rank` cleared. The partial index makes
//! the head-of-queue read (`ORDER BY queue_rank`) cheap without touching the
//! non-queued majority.
//!
//! Guarded per column with `has_column` (the step is idempotent column by
//! column, so a half-applied run resumes); the index is `IF NOT EXISTS`.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// `(column, SQL type)` — the queue's seven columns, in the order the repo's
/// `COLUMNS` projection names them.
const QUEUE_COLUMNS: &[(&str, &str)] = &[
    ("queue_rank", "INTEGER"),
    ("queued_at_ms", "INTEGER"),
    ("not_before_ms", "INTEGER"),
    ("origin", "TEXT"),
    ("persona_id", "TEXT"),
    ("goal_id", "TEXT"),
    ("cycle_index", "INTEGER"),
];

fn every_queue_column_present(conn: &Connection) -> Result<bool, AppError> {
    if !has_table(conn, "fleet_sessions")? {
        return Ok(true);
    }
    for (column, _) in QUEUE_COLUMNS {
        if !has_column(conn, "fleet_sessions", column)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn add_missing_queue_columns(conn: &Connection) -> Result<(), AppError> {
    for (column, ddl_type) in QUEUE_COLUMNS {
        if has_column(conn, "fleet_sessions", column)? {
            continue;
        }
        ddl_step(
            conn,
            &format!("ALTER TABLE fleet_sessions ADD COLUMN {column} {ddl_type};"),
        )?;
    }
    Ok(())
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "fleet_sessions.queue_columns",
            description: "Add the dispatch-queue columns (rank, admission, gate, provenance) to fleet_sessions",
            already_applied: every_queue_column_present,
            apply: add_missing_queue_columns,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "fleet_sessions.idx_queue_rank",
            description: "Partial index over the queued rows, in promotion order",
            already_applied: |conn| {
                Ok(!has_table(conn, "fleet_sessions")?
                    || has_index(conn, "idx_fleet_sessions_queue_rank")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_fleet_sessions_queue_rank
                        ON fleet_sessions(queue_rank, queued_at_ms)
                        WHERE state = 'queued';",
                )
            },
        },
    )
}
