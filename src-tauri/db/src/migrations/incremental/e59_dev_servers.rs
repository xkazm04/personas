//! Server control (spark `server-control`): a dev project can carry its own
//! dev server, and a server Personas started outlives the app.
//!
//! - `dev_projects.dev_command` — the command that runs the project's dev
//!   server (`npm run dev`, `npm run dev -- --port {port}`). NULL means not
//!   configured yet (a scan is pending or failed).
//! - `dev_projects.dev_port` — the port the server listens on. NULL means the
//!   project is NOT in the Server control view: membership IS this column, so
//!   there is no second flag to disagree with it.
//! - `dev_server_runs` — one row per server Personas spawned and still owns.
//!   It is what lets a server survive an app restart: on boot each row whose
//!   pid is still alive is re-adopted, every other row is deleted. `persistent
//!   = 0` marks a Studio preview, which is still killed at app exit.
//!
//! Guarded with `has_table` / `has_column` like every other step here.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects.dev_command",
            description: "Add dev_command to dev_projects (nullable; NULL means not configured)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_projects")?
                    || has_column(conn, "dev_projects", "dev_command")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN dev_command TEXT;",
                )
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects.dev_port",
            description:
                "Add dev_port to dev_projects (nullable; NULL means not in Server control)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_projects")?
                    || has_column(conn, "dev_projects", "dev_port")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN dev_port INTEGER;",
                )
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_server_runs",
            description: "Create dev_server_runs (servers Personas spawned and still owns)",
            already_applied: |conn| has_table(conn, "dev_server_runs"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_server_runs (
                        project_id TEXT PRIMARY KEY REFERENCES dev_projects(id) ON DELETE CASCADE,
                        pid        INTEGER NOT NULL,
                        port       INTEGER NOT NULL,
                        started_at INTEGER NOT NULL,
                        persistent INTEGER NOT NULL DEFAULT 1
                    );",
                )
            },
        },
    )?;
    Ok(())
}
