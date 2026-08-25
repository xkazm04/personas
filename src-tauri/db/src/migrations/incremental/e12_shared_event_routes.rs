//! Shared-event feed → dev-project routes (spark: fleet dispatch UX).
//!
//! A route pins one marketplace feed to one dev project so a firing can open
//! the quick-dispatch door pre-scoped to that project. The table is new (no
//! legacy shape to converge), so a single `has_table`-probed CREATE covers
//! both fresh installs and upgrades — `run_incremental` replays at every boot.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "shared_event_project_routes",
            description:
                "Create shared_event_project_routes (feed → project quick-dispatch routes)",
            already_applied: |conn| has_table(conn, "shared_event_project_routes"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS shared_event_project_routes (
                        catalog_entry_id TEXT NOT NULL,
                        project_id       TEXT NOT NULL,
                        created_at       TEXT NOT NULL,
                        PRIMARY KEY (catalog_entry_id, project_id)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "shared_event_impact_runs",
            description:
                "Create shared_event_impact_runs (ingested feed-impact verdicts per firing × project)",
            already_applied: |conn| has_table(conn, "shared_event_impact_runs"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS shared_event_impact_runs (
                        id               TEXT PRIMARY KEY NOT NULL,
                        firing_id        TEXT NOT NULL,
                        catalog_entry_id TEXT NOT NULL,
                        project_id       TEXT NOT NULL,
                        verdict          TEXT NOT NULL,
                        summary          TEXT NOT NULL,
                        commit_sha       TEXT,
                        details_md       TEXT,
                        created_at       TEXT NOT NULL
                    );",
                )
            },
        },
    )?;

    Ok(())
}
