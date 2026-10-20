//! `team_assignments.status` admits `paused` (2026-10-20).
//!
//! The orchestrator's `pause_assignment` writes `paused` and the tick loop,
//! `resume_assignment` and the UI all read it, but the original CHECK in
//! `c02_dev_goals_and_kpis` listed only queued/running/awaiting_review/done/
//! failed/aborted. Every Pause click therefore failed with `CHECK constraint
//! failed` and pause/resume of team runs never worked. SQLite cannot alter a
//! CHECK in place, so the table is rebuilt through
//! [`rebuild_table_from_live_ddl`] (foreign keys off for the swap, so the
//! `ON DELETE CASCADE` children - steps and events - are not touched). The
//! partial index on status is replayed unchanged: it covers the hot queue
//! states, and a paused assignment is deliberately not one of them.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "team_assignments.status.paused",
            description: "team_assignments.status CHECK admits 'paused'",
            already_applied: |conn| {
                if !has_table(conn, "team_assignments")? {
                    return Ok(true);
                }
                let ddl: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='team_assignments'",
                    [],
                    |r| r.get("sql"),
                )?;
                Ok(ddl.contains("'paused'"))
            },
            apply: |conn| {
                rebuild_table_from_live_ddl(
                    conn,
                    "team_assignments",
                    &|create_sql| {
                        // `'aborted'` is the last entry of the status CHECK and
                        // occurs exactly once; anything else means the table is
                        // not the shape this step was written against.
                        if create_sql.matches("'aborted'").count() != 1 {
                            return Err(AppError::Validation(
                                "team_assignments status CHECK is not in the expected shape - \
                                 refusing to rebuild"
                                    .into(),
                            ));
                        }
                        Ok(create_sql.replacen("'aborted'", "'aborted','paused'", 1))
                    },
                    "",
                )
            },
        },
    )?;
    Ok(())
}
