//! `dev_lifecycle_runs.output_tail` (lifecycle excellence wave 6, 2026-10-09).
//!
//! The end of what a Measure command printed, so the step screen can show WHY
//! a gate failed without re-running it. Nullable and filled only for rows
//! written after this step: NULL means nothing was captured (the command did
//! not run, was killed at its timeout, or ran before the column existed); an
//! empty string means it ran and printed nothing.
//!
//! The shape is the writer's (`lifecycle::measure::stored_output`): at most
//! 16 KiB, the stdout tail under a `--- stdout ---` line, then the stderr tail
//! under a `--- stderr ---` line. Kept out of the list payloads; read one row
//! at a time (`lifecycle_runs::run_output`). The table stays append-only.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_lifecycle_runs.output_tail",
            description: "Lifecycle runs keep the tail of the command's output",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_lifecycle_runs")?
                    || has_column(conn, "dev_lifecycle_runs", "output_tail")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_lifecycle_runs ADD COLUMN output_tail TEXT;",
                )
            },
        },
    )?;
    Ok(())
}
