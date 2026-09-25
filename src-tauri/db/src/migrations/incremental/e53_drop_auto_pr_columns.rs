//! Drop `dev_projects.auto_pr_on_success`, the runner auto-PR toggle.
//!
//! The only thing that ever read it was the task executor's auto-PR hook,
//! which fired only on Competition's `worktree:` tasks and was removed with
//! Competition (`4f0369a82`). The column kept showing in the passport and did
//! nothing; the operator decided to remove it (2026-09-25).
//!
//! `pr_credential_id`, added beside it in `c01_plugin_tables`, STAYS: it is
//! the project's GitHub connector binding (the project modal's Source-control
//! step, the Overview pipeline editor, `GitHubRepoSelector`), not part of the
//! toggle.
//!
//! ## Why a plain `DROP COLUMN`
//!
//! SQLite refuses `ALTER TABLE … DROP COLUMN` for a column that is part of a
//! PRIMARY KEY, UNIQUE constraint, index, foreign key, generated column,
//! trigger or view. `auto_pr_on_success` is none of these (a bare
//! `INTEGER NOT NULL DEFAULT 0`, named by no index, trigger or view), so the
//! rebuild helper (`rebuild_table_from_live_ddl`) is not needed. Every row
//! keeps every other column.
//!
//! ## Why the older DDL is gone too
//!
//! `c01_plugin_tables` added the column on every boot (`ADD COLUMN`, errors
//! ignored). Left in place it would re-add the column one step after this one
//! dropped it, so that `ALTER` was removed in the same change.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "drop_auto_pr_columns",
            description: "Drop dev_projects.auto_pr_on_success (the runner auto-PR toggle, dead since Competition was removed)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_projects")?
                    || !has_column(conn, "dev_projects", "auto_pr_on_success")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects DROP COLUMN auto_pr_on_success;",
                )
            },
        },
    )
}
