//! Retire the dev-only Competition feature and DELETE its data.
//!
//! Decided 2026-09-24: Competition "did not prove and was never really used";
//! its sidebar slot became Contest, whose state lives in arena folders on disk
//! (`<project>/.contest/arena/*`), not in the database. Two tables go, child
//! before parent:
//!
//! | table | parent(s) |
//! |---|---|
//! | `dev_competition_slots` | `dev_competitions`, `dev_tasks` |
//! | `dev_competitions` | `dev_projects` |
//!
//! Their indexes go with them (`DROP TABLE` takes a table's indexes); neither
//! ever had a trigger, a view or an FTS shadow, and no surviving table
//! references either one.
//!
//! ## Why the ORDER matters
//!
//! With `foreign_keys=ON`, `DROP TABLE` first runs an implicit `DELETE FROM`
//! that enforces the constraints in which the table is the PARENT. Dropping
//! the slots first leaves `dev_competitions` with no referencing table, so its
//! implicit delete checks and cascades nothing. Neither table is a parent of a
//! surviving table (`dev_projects` and `dev_tasks` are only ever parents
//! here), so no surviving row is touched.
//!
//! ## Why it is unconditional, and why the older DDL is gone too
//!
//! Same reasoning as `e28_retire_workspace_knowledge`: the operator decided the
//! rows are disposable, so there is no empty-table guard. The fresh schema's
//! `CREATE TABLE IF NOT EXISTS dev_competitions` / `dev_competition_slots` and
//! the pre-schema `ALTER TABLE` column patches in `initial.rs` were removed in
//! the same change — left in place, they would re-create the tables on the
//! next boot, one step before this one dropped them again.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// Child before parent — see the module doc for why the order is the safety
/// argument.
pub(super) const RETIRED_COMPETITION_TABLES: [&str; 2] =
    ["dev_competition_slots", "dev_competitions"];

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "retire_competitions",
            description: "Drop the retired dev-only Competition tables (dev_competition_slots, dev_competitions) and their data; Contest keeps its state on disk",
            already_applied: |conn| {
                for table in RETIRED_COMPETITION_TABLES {
                    if has_table(conn, table)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            },
            apply: |conn| {
                let mut batch = String::new();
                for table in RETIRED_COMPETITION_TABLES {
                    batch.push_str(&format!("DROP TABLE IF EXISTS {table};\n"));
                }
                ddl_step(conn, &batch)
            },
        },
    )
}
