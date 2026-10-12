//! `dev_milestones.kind` (2026-10-09).
//!
//! A milestone is either an ordinary cut (`'milestone'`) or a DEADLINE: a cut
//! whose date is a commitment rather than an aim. A deadline always carries a
//! `target_date`; the repo refuses to create one without it or to clear it
//! later. Every row that existed before this step is an ordinary milestone,
//! which is what the column default says.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_milestones.kind",
            description: "Milestones carry a kind (milestone | deadline)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_milestones")?
                    || has_column(conn, "dev_milestones", "kind")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_milestones ADD COLUMN kind TEXT NOT NULL DEFAULT 'milestone' \
                     CHECK (kind IN ('milestone', 'deadline'));",
                )
            },
        },
    )?;
    Ok(())
}
