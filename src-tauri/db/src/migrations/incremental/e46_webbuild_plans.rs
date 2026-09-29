//! `webbuild_plans` — a Studio project's plan, kept with the project.
//!
//! Studio's plan (the BUILD_PLAN phases) and the sketch lane's first drawing
//! of the site lived only in the WebView's localStorage, so reopening a
//! project showed a skeleton while its dev server booted, and a cleared
//! WebView lost the plan outright. One row per project holds both as JSON, so
//! the Guide layout can replay the plan's composition while the preview starts.
//!
//! Schema decisions worth naming:
//!
//! 1. **`project_id` is the key and cascades.** A plan has no meaning without
//!    its project; deleting the project must not leave a plan behind.
//! 2. **JSON columns, not tables per phase.** The plan is replaced whole on
//!    every turn (BUILD_PLAN is a full snapshot), never queried by phase, and
//!    its shape is owned by `webbuild::plan` / `webbuild::sketch` in app_lib.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "webbuild_plans",
            description: "Studio: webbuild_plans - a project's plan phases and site sketch, kept with the project",
            already_applied: |conn| has_table(conn, "webbuild_plans"),
            apply: create_webbuild_plans,
        },
    )
}

fn create_webbuild_plans(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS webbuild_plans (
            project_id   TEXT PRIMARY KEY NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            phases_json  TEXT NOT NULL DEFAULT '[]',
            sketch_json  TEXT,
            updated_at   TEXT NOT NULL
         );",
    )
}
