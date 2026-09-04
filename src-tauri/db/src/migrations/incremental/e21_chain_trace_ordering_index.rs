//! Composite `(chain_trace_id, created_at)` indexes for the two chain reads.
//!
//! `repos::execution::traces::get_by_chain_trace_id` and
//! `repos::execution::chain_stop_reasons::get_by_chain_trace_id` both filter on
//! `chain_trace_id` and then `ORDER BY created_at ASC`. The indexes that existed
//! (`idx_et_chain`, `idx_csr_chain`) stop one column short of that ordering, so
//! SQLite either sorted every matching row through a TEMP B-TREE or — measured
//! on the live database — abandoned the equality index entirely and ran
//! `SCAN execution_traces USING INDEX idx_et_created`, reading all 2,942 rows
//! and their 28.1 MB of `spans` JSON to answer a handful-of-rows question.
//! Widening the index to `(chain_trace_id, created_at)` makes the equality a
//! SEARCH and the ordering free.
//!
//! The narrow indexes are deliberately LEFT IN PLACE: `count_by_chain_trace_id`
//! is a covering `COUNT(*)` against `idx_et_chain` and `idx_et_created` serves
//! the recency reads. Dropping either is a separate decision with its own
//! evidence.
//!
//! `ANALYZE` is part of the step, and it is not decoration. The live database
//! carries a stale `sqlite_stat1` row (`idx_et_chain 266 266` — every chain id
//! claimed to select 266 rows), which is what made the planner walk away from
//! the index in the first place. The idle maintenance task (`db/src/lib.rs:272`)
//! cannot refresh it: it runs `PRAGMA optimize` on a **freshly acquired pooled
//! connection**, and `PRAGMA optimize`'s default mask only analyses tables the
//! *current connection* has actually queried — a connection that has run no
//! query analyses nothing, so that pragma is a no-op for this table by
//! construction. One `ANALYZE execution_traces` here fixes both the stale row
//! and the missing one, costs an index walk of a small table, and — being
//! behind the `has_index` guard — runs exactly once.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "execution_traces_chain_created_index",
            description: "Add (chain_trace_id, created_at) index for the chain trace read",
            already_applied: |conn| {
                // Guarded on the table too: it exists only where the execution
                // schema was created, and an index against a missing table
                // would abort the whole migration run.
                Ok(!has_table(conn, "execution_traces")?
                    || has_index(conn, "idx_et_chain_created")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_et_chain_created\n\
                         ON execution_traces(chain_trace_id, created_at);",
                )?;
                // Outside `ddl_step`: ANALYZE writes sqlite_stat1 and is not
                // part of the schema change's atomicity contract.
                conn.execute_batch("ANALYZE execution_traces;")?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "chain_stop_reasons_chain_created_index",
            description: "Add (chain_trace_id, created_at) index for the chain stop-reason read",
            already_applied: |conn| {
                Ok(!has_table(conn, "chain_stop_reasons")?
                    || has_index(conn, "idx_csr_chain_created")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_csr_chain_created\n\
                         ON chain_stop_reasons(chain_trace_id, created_at);",
                )?;
                conn.execute_batch("ANALYZE chain_stop_reasons;")?;
                Ok(())
            },
        },
    )?;

    Ok(())
}
