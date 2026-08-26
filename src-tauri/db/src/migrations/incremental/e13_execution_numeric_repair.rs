//! Repair `persona_executions` rows whose numeric columns hold TEXT.
//!
//! SQLite's type affinity converts a bound string into an INTEGER/REAL column
//! only when the conversion is LOSSLESS. `'42'` becomes the integer 42; `'mock'`
//! and `'2026-08-24 15:07:05'` are stored as TEXT in a column declared
//! `INTEGER NOT NULL DEFAULT 0`. rusqlite, unlike SQLite, is strict on the way
//! back out: `row.get::<_, Option<i64>>("cache_read_tokens")` on such a row
//! fails with `InvalidColumnType(15, "cache_read_tokens", Text)` — and because
//! `row_to_execution` is behind every full-row read of the table, ONE poisoned
//! row takes down every execution list on the surface that reads it.
//!
//! The observed damage on this operator's database was a single mock row
//! (`business_outcome`/`cache_read_tokens` = `'mock'`, and
//! `log_truncated`/`is_simulation`/`cache_creation_tokens` all carrying a
//! timestamp string) written by hand-rolled SQL that no longer exists in the
//! tree. Nothing in Rust binds a `String` to these columns — every writer goes
//! through `set_cache_tokens` / the typed INSERTs — so this step is not paired
//! with a writer fix: the writer was external, and the durable defence against
//! the next one is the lenient reader in
//! `repos::execution::executions::{coerce_i64, coerce_bool, coerce_f64}`.
//!
//! Repair rule, per column: a text value that round-trips as a canonical number
//! (`CAST(CAST(c AS INTEGER) AS TEXT) = c`) is genuinely a mis-bound number and
//! is cast; anything else is corruption and collapses to the column's own
//! default (0 / 0.0, or NULL where the column is nullable). Deliberately NOT a
//! blind `CAST`, which would turn `'2026-08-24 15:07:05'` into the token count
//! 2026 and the boolean `is_simulation` into `true`.
//!
//! Self-probing and idempotent like every step in this chain: `already_applied`
//! asks whether any repairable value is left, so a clean database skips the
//! whole thing and a re-run after the repair is a no-op.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// (column, replacement when the text is not a canonical number).
///
/// Mirrors `pragma_table_info('persona_executions')`: `duration_ms` and
/// `director_score` are the only two nullable numeric columns, so they are the
/// only two whose corruption collapses to NULL rather than to a zero the
/// mapper would read as a real measurement.
const NUMERIC_COLUMNS: &[(&str, &str)] = &[
    ("input_tokens", "0"),
    ("output_tokens", "0"),
    ("cost_usd", "0.0"),
    ("duration_ms", "NULL"),
    ("log_truncated", "0"),
    ("retry_count", "0"),
    ("is_simulation", "0"),
    ("director_score", "NULL"),
    ("cache_read_tokens", "0"),
    ("cache_creation_tokens", "0"),
];

/// True when no `persona_executions` row stores TEXT in a numeric column.
fn no_text_in_numeric_columns(conn: &Connection) -> Result<bool, AppError> {
    // A database old enough to predate the cache-token ALTERs has nothing to
    // repair; treat a missing column as "already applied" rather than letting
    // the probe fail with `no such column` and abort the boot.
    for (col, _) in NUMERIC_COLUMNS {
        if !has_column(conn, "persona_executions", col)? {
            return Ok(true);
        }
    }
    let predicate = NUMERIC_COLUMNS
        .iter()
        .map(|(col, _)| format!("typeof({col}) = 'text'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let count: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM persona_executions WHERE {predicate}"),
        [],
        |r| r.get(0),
    )?;
    Ok(count == 0)
}

fn repair_numeric_columns(conn: &Connection) -> Result<(), AppError> {
    let mut batch = String::new();
    for (col, fallback) in NUMERIC_COLUMNS {
        // `CAST(CAST(c AS INTEGER) AS TEXT) = c` holds only for canonical
        // integer strings ('0', '42', '-7'), which is exactly the set worth
        // preserving. 'mock' and '2026-08-24 15:07:05' both fail it.
        batch.push_str(&format!(
            "UPDATE persona_executions
                SET {col} = CASE
                      WHEN CAST(CAST({col} AS INTEGER) AS TEXT) = {col}
                        THEN CAST({col} AS INTEGER)
                      ELSE {fallback}
                    END
              WHERE typeof({col}) = 'text';\n"
        ));
    }
    ddl_step(conn, &batch)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.numeric_column_type_repair",
            description: "Repair persona_executions rows holding TEXT in numeric columns",
            already_applied: no_text_in_numeric_columns,
            apply: repair_numeric_columns,
        },
    )
}
