//! Retire the Artist and Research Lab plugin tables.
//!
//! Both plugins were removed from the app on 2026-09-14 — no command reads or
//! writes these tables any more. The drop is destructive by intent (operator
//! decision): any rows a dev build left behind are discarded rather than kept
//! as orphaned schema. Children are dropped before their parents so a
//! `foreign_keys = ON` connection never has to cascade through a live FK.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// Child-first, so every `REFERENCES` target still exists when its dependant goes.
const RETIRED_TABLES: [&str; 11] = [
    "artist_tags",
    "artist_assets",
    "research_report_sections",
    "research_reports",
    "research_findings",
    "research_experiment_runs",
    "research_experiments",
    "research_hypotheses",
    "research_citations",
    "research_sources",
    "research_projects",
];

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "retire_artist_research_lab_tables",
            description: "Drop the Artist and Research Lab plugin tables (plugins removed)",
            already_applied: |conn| {
                for table in RETIRED_TABLES {
                    if has_table(conn, table)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            },
            apply: |conn| {
                for table in RETIRED_TABLES {
                    ddl_step(conn, &format!("DROP TABLE IF EXISTS {table};"))?;
                }
                Ok(())
            },
        },
    )
}
