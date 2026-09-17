//! Features (`dev_use_cases`) no longer have a review queue: every pending
//! proposal becomes active, once.
//!
//! Scans used to land features as `proposed` behind an accept/reject strip on
//! the Context Map. Nothing downstream reads a proposed feature (the KPI scan,
//! the Notes plan pane and the LLM-cost join all read `active`), and the queue
//! was never drained, so the layer starved. The gate is gone: scans now write
//! `active`, and a bad feature is archived instead of rejected.
//!
//! The postcondition probe is safe here, unlike e31's: after this change no
//! code path can write `proposed` (the repo's status vocabulary and the HTTP
//! decision route both refuse it), so "no proposed row" is reached once and
//! stays reached. The column CHECK still admits the value; it is not rebuilt
//! for a dead state.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_use_cases.auto_approve_proposed",
            description:
                "Features: promote every pending proposal to active (the review queue was removed)",
            already_applied: |conn| {
                if !has_table(conn, "dev_use_cases")? {
                    return Ok(true);
                }
                let pending: i64 = conn.query_row(
                    "SELECT COUNT(*) AS n FROM dev_use_cases WHERE status = 'proposed'",
                    [],
                    |r| r.get("n"),
                )?;
                Ok(pending == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "UPDATE dev_use_cases
                        SET status = 'active', updated_at = datetime('now')
                      WHERE status = 'proposed';",
                )
            },
        },
    )
}
