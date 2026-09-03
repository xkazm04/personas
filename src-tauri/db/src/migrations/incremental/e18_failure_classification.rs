//! The failure's class, carried on the row instead of re-derived from its prose
//! (registry golden path `error-handling`, technique
//! `parse-failure-keeps-identity`).
//!
//! One nullable column on `persona_executions`:
//!
//! * `error_category` — an `ErrorCategory`'s existing `snake_case` serde token
//!   (`personas_core::error_taxonomy`), written ONLY where the code knows the
//!   class from a structural fact: the engine's own safety ceiling, the
//!   runner's no-stderr process exit, and the provider usage-limit parse. The
//!   enum already derives `Serialize` + `TS` with `rename_all`, so the wire
//!   value, the DB value and the frontend value are one string with no new
//!   definition.
//!
//! Nullable, and it stays that way. Every row written before this column
//! existed has no class, and giving it one by running `classify_error` over the
//! history would destroy the only honest signal the column carries: this row's
//! class was measured, that row's was guessed. Nothing backfills, and the
//! observability aggregate keeps the Rust ladder for the `NULL` rows precisely
//! so it does not have to.
//!
//! No index. The one reader (`metrics::get_error_category_breakdown`) already
//! filters on `status = 'failed'` inside a `created_at` window and now groups
//! the classed rows in SQL; an index on a column that is `NULL` for the entire
//! retained history would be mostly empty and would earn nothing.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.error_category",
            description:
                "Add error_category to persona_executions (class minted at the raise site)",
            already_applied: |conn| has_column(conn, "persona_executions", "error_category"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN error_category TEXT;",
                )
            },
        },
    )?;

    Ok(())
}
