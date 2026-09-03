//! A total order for the per-persona run list.
//!
//! `repos::execution::executions::list_items_by_persona_id` pages with
//! `LIMIT/OFFSET` under `ORDER BY created_at DESC`. `created_at` alone is not a
//! total order — two runs created in the same second tie — and a tie under
//! OFFSET is how a row gets served twice or never. The fix is the `id DESC`
//! tiebreak the global list already carries; this index is what keeps that
//! tiebreak from costing a TEMP B-TREE sort.
//!
//! `idx_pe_persona_created` (`persona_id, created_at`) already exists and
//! cannot serve the tiebreak: it stops one column short, so SQLite must sort
//! every matching row to break the tie. The wider index supersedes it for this
//! query; the narrower one is deliberately LEFT IN PLACE — other queries in the
//! repo order by `(persona_id, created_at)` alone and dropping it is a separate
//! decision with its own evidence.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions_persona_created_id_index",
            description:
                "Add (persona_id, created_at DESC, id DESC) index for disjoint per-persona paging",
            already_applied: |conn| {
                // Guarded on the table too: it exists only where the execution
                // schema was created, and an index against a missing table
                // would abort the whole migration run.
                Ok(!has_table(conn, "persona_executions")?
                    || has_index(conn, "idx_pe_persona_created_id")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_pe_persona_created_id\n\
                         ON persona_executions(persona_id, created_at DESC, id DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    Ok(())
}
