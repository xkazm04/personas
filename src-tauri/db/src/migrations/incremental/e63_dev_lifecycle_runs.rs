//! Lifecycle measurement runs (spark lifecycle-health, 2026-10-08).
//!
//! `dev_lifecycle_runs` is the APPEND-ONLY ledger of every gate / test /
//! coverage command Lifecycle's Measure ran, one row per command per measure.
//! It is deliberately not `app_master_gate_runs`: a `kind = 'baseline'` row
//! there feeds the App Master's `latest_baseline` / `inherited_red` merge
//! logic, and that table has no column for a coverage value.
//!
//! `started_at` = child process spawn, `finished_at` = child exit;
//! `duration_ms` is the wall clock between the two, so worktree setup and
//! dependency linking are not timed. `outcome` is
//! `passed | failed | did_not_run | timeout` - a command that could not run is
//! never `failed`. `value_pct` is a parsed coverage figure, NULL otherwise.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_lifecycle_runs",
            description: "Append-only ledger of Lifecycle gate/test/coverage command runs",
            already_applied: |conn| has_table(conn, "dev_lifecycle_runs"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_lifecycle_runs (
                        id           TEXT PRIMARY KEY,
                        project_id   TEXT NOT NULL,
                        measure_id   TEXT NOT NULL,
                        command_id   TEXT NOT NULL,
                        command      TEXT NOT NULL,
                        kind         TEXT NOT NULL CHECK (kind IN
                                        ('lint','typecheck','test','check','coverage','other')),
                        outcome      TEXT NOT NULL CHECK (outcome IN
                                        ('passed','failed','did_not_run','timeout')),
                        exit_code    INTEGER,
                        duration_ms  INTEGER NOT NULL DEFAULT 0,
                        value_pct    REAL,
                        first_error  TEXT,
                        head_sha     TEXT NOT NULL,
                        started_at   TEXT NOT NULL,
                        finished_at  TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_lifecycle_runs_project
                        ON dev_lifecycle_runs(project_id, finished_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_dev_lifecycle_runs_command
                        ON dev_lifecycle_runs(project_id, command_id, finished_at DESC);",
                )
            },
        },
    )?;
    Ok(())
}
