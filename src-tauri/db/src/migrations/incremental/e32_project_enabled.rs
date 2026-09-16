//! A project-level on/off switch that overrules every persona in it.
//!
//! `dev_projects.status` already carries `'active' | 'archived'`, and archiving
//! is a lifecycle fact (the project is done). Switching a project OFF is an
//! operational pause (nothing in it may run right now) that must round-trip
//! without touching the archive, so it is its own column rather than a third
//! status value every `status = 'active'` filter would silently misread.
//!
//! `NOT NULL DEFAULT 1`: every existing project was running, and stays so.
//! The persona -> project link is `personas.home_team_id = dev_projects.team_id`
//! (one team per project, `crate::project_team`); the run gates read it
//! through `repos::dev::projects::persona_project_disabled`.
//!
//! Guarded with `has_table` / `has_column` like every other step here.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects.enabled",
            description: "Add enabled to dev_projects (project switch overruling persona enabled)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_projects")?
                    || has_column(conn, "dev_projects", "enabled")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;",
                )
            },
        },
    )
}
