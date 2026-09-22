//! `lab_eval_results.eval_method` — the one lab result table the c01 loop
//! could never reach.
//!
//! `c01_plugin_tables` adds `eval_method` to all four lab result tables in a
//! loop whose failures are discarded (`let _ = ddl_step(...)`), because three
//! of those tables ship in the initial consolidated schema and the ALTER is a
//! no-op on a database that already has the column. The fourth,
//! `lab_eval_results`, is created by `e01_execution_and_use_cases` — inside
//! `run_incremental`, which runs AFTER `initial::run` (and therefore after the
//! `c0*` modules `initial::run` calls at its end). So on every database ever
//! created, that one ALTER ran against a table that did not exist yet, failed,
//! and was swallowed.
//!
//! The cost was not theoretical: `get_version_ratings`
//! (`repos::lab::ratings`) selects `r.eval_method` from `lab_eval_results` in
//! the first arm of its UNION, so the whole "Versions & Ratings" query failed
//! with `no such column: r.eval_method` — which is what
//! `status_vocabulary_tests` has been reporting.
//!
//! Adding it here rather than moving the c01 loop keeps the invariant stated
//! at the top of `mod.rs`: never reorder, always append.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "lab_eval_results.eval_method",
            description: "Add eval_method to lab_eval_results (c01 could not: the table \
                          is created later, in e01)",
            already_applied: |conn| {
                Ok(!has_table(conn, "lab_eval_results")?
                    || has_column(conn, "lab_eval_results", "eval_method")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE lab_eval_results ADD COLUMN eval_method TEXT;",
                )
            },
        },
    )
}
