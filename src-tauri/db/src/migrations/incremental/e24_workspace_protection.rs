//! The workspace tag that makes a delete refuse: `last_working_version`.
//!
//! One nullable-by-default integer column on `dev_workspaces`:
//!
//! * `last_working_version` — `0` (the default) for every workspace that
//!   exists today, `1` for the one the Grand Simulation declares to be the
//!   last state Personas still considers working.
//!
//! Why a column and not a setting. The rule it encodes (the simulation's rule
//! 10, `docs/architecture/grand-simulation.md`) is *about a workspace*: it
//! must survive an export/import round trip with the row, and a delete door
//! deep in a repo function has to be able to answer "is this protected?" from
//! the same connection it is about to delete on. A settings row naming a
//! workspace id would leave the two facts free to drift, and the delete path
//! would consult a table that has nothing to do with what it is deleting.
//!
//! `NOT NULL DEFAULT 0` rather than nullable: "unprotected" is the only honest
//! reading of a row written before the column existed, and there is nothing to
//! backfill it from — so the default states it instead of leaving a NULL every
//! reader would have to re-interpret.
//!
//! No index. The only reads are by primary key (a guard asking about the one
//! workspace it is about to touch) and a full listing of workspaces, which
//! already scans.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_workspaces.last_working_version",
            description: "Add last_working_version to dev_workspaces (the never-delete tag; \
                          every delete door that would remove a protected workspace, its \
                          projects, their teams or their personas' charters refuses)",
            already_applied: |conn| has_column(conn, "dev_workspaces", "last_working_version"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_workspaces
                         ADD COLUMN last_working_version INTEGER NOT NULL DEFAULT 0;",
                )
            },
        },
    )?;

    Ok(())
}
