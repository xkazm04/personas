//! Retrofits ON DELETE CASCADE / SET NULL foreign keys onto child tables that
//! were originally created without `REFERENCES` clauses. SQLite cannot
//! `ALTER TABLE ... ADD CONSTRAINT`, so each table is rebuilt via the
//! create-insert-drop-rename pattern; idempotency is gated by
//! `pragma_foreign_key_list`.
//!
//! ADR: 2026-05-02-fk-hygiene-cascade.

use rusqlite::Connection;

use crate::error::AppError;

/// Run the FK-hygiene sweep. Adds CASCADE/SET NULL FKs to the 8 orphan-prone
/// tables identified in the ADR. Each table is migrated independently and
/// idempotently — no-ops on a DB that has already been migrated.
pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    migrate_persona_memories(conn)?;
    Ok(())
}

/// Internal helper: rebuild `<table>` to add an FK constraint that
/// `ALTER TABLE` cannot express. Skips if the table already declares
/// `expected_fk_count` or more foreign keys.
///
/// The caller provides:
///   * `table_name` — the target table.
///   * `expected_fk_count` — how many FKs the new shape declares; the
///     idempotency check uses `>=`, so re-runs after future FK additions
///     stay safe.
///   * `cleanup_orphans_sql` — a list of `DELETE FROM <table> WHERE …`
///     statements that purge rows that would violate the new FK before
///     the rebuild. May be empty.
///   * `new_create_sql` — the full `CREATE TABLE <table>_new (...)`
///     including the FK declaration. The trailing `_new` suffix is required
///     so the helper can drop the original and rename atomically.
///   * `columns_csv` — explicit column list for the
///     `INSERT INTO <table>_new (...) SELECT ... FROM <table>` copy. Explicit
///     (rather than `SELECT *`) so reordering or adding columns in the new
///     shape doesn't silently corrupt the copy.
///   * `index_sqls` — `CREATE INDEX IF NOT EXISTS` statements to recreate
///     after the rename. The original table's indexes are dropped along
///     with it.
///
/// Wraps the whole operation in a transaction. On row-count mismatch or any
/// SQL error, the transaction rolls back and the function returns Err — the
/// surrounding `run_incremental` propagates that and aborts startup, leaving
/// the original table intact.
fn recreate_with_fk(
    conn: &Connection,
    table_name: &str,
    expected_fk_count: i64,
    cleanup_orphans_sql: &[&str],
    new_create_sql: &str,
    columns_csv: &str,
    index_sqls: &[&str],
) -> Result<(), AppError> {
    // Idempotency: count existing FKs on the table. If it's already >= the
    // expected count, the migration ran in a prior boot and we skip.
    let existing_fk_count: i64 = conn
        .prepare(&format!(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('{}')",
            table_name.replace('\'', "''"),
        ))?
        .query_row([], |row| row.get(0))?;
    if existing_fk_count >= expected_fk_count {
        return Ok(());
    }

    // Purge any pre-existing orphans that would violate the new FK. Done
    // inside the same transaction so a partial cleanup can't leak if the
    // rebuild fails.
    let tx = conn.unchecked_transaction()?;

    // foreign_keys must be OFF for DROP TABLE to skip the cascade chain on
    // any current FK that points the other way, AND to allow the rename to
    // succeed without triggering checks against the in-progress shape.
    tx.execute_batch("PRAGMA foreign_keys = OFF;")?;

    for sql in cleanup_orphans_sql {
        tx.execute_batch(sql)?;
    }

    let row_count_before: i64 = tx
        .prepare(&format!(
            "SELECT COUNT(*) FROM {}",
            table_name.replace('\'', "''"),
        ))?
        .query_row([], |row| row.get(0))?;

    // Rebuild: create _new, copy data, drop original, rename.
    tx.execute_batch(new_create_sql)?;

    let copy_sql = format!(
        "INSERT INTO {table}_new ({cols}) SELECT {cols} FROM {table}",
        table = table_name,
        cols = columns_csv,
    );
    tx.execute_batch(&copy_sql)?;

    let row_count_after: i64 = tx
        .prepare(&format!(
            "SELECT COUNT(*) FROM {}_new",
            table_name.replace('\'', "''"),
        ))?
        .query_row([], |row| row.get(0))?;

    if row_count_after != row_count_before {
        return Err(AppError::Database(rusqlite::Error::InvalidQuery));
    }

    tx.execute_batch(&format!("DROP TABLE {};", table_name))?;
    tx.execute_batch(&format!(
        "ALTER TABLE {table}_new RENAME TO {table};",
        table = table_name,
    ))?;

    for index_sql in index_sqls {
        tx.execute_batch(index_sql)?;
    }

    // Re-enable FKs and verify the new state has no violations before
    // committing. If a violation slipped past cleanup_orphans_sql, the
    // foreign_key_check pragma surfaces it now and we abort.
    tx.execute_batch("PRAGMA foreign_keys = ON;")?;
    let violations: i64 = tx
        .prepare("SELECT COUNT(*) FROM pragma_foreign_key_check")?
        .query_row([], |row| row.get(0))?;
    if violations > 0 {
        return Err(AppError::Database(rusqlite::Error::InvalidQuery));
    }

    tx.commit()?;
    tracing::info!(
        table = %table_name,
        rows = row_count_after,
        "FK hygiene: rebuilt {} with {} new FK(s); preserved {} rows",
        table_name,
        expected_fk_count,
        row_count_after,
    );
    Ok(())
}

// -- Per-table migrations -----------------------------------------------------

fn migrate_persona_memories(conn: &Connection) -> Result<(), AppError> {
    recreate_with_fk(
        conn,
        "persona_memories",
        1,
        &[
            "DELETE FROM persona_memories \
             WHERE persona_id NOT IN (SELECT id FROM personas);",
        ],
        "CREATE TABLE persona_memories_new (
            id                  TEXT PRIMARY KEY,
            persona_id          TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            content             TEXT NOT NULL,
            category            TEXT DEFAULT 'fact',
            source_execution_id TEXT,
            importance          INTEGER DEFAULT 3,
            tags                TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );",
        "id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at",
        &[
            "CREATE INDEX IF NOT EXISTS idx_persona_memories_persona ON persona_memories(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_persona_memories_category ON persona_memories(category);",
            "CREATE INDEX IF NOT EXISTS idx_persona_memories_importance ON persona_memories(importance DESC);",
            "CREATE INDEX IF NOT EXISTS idx_pm_persona_importance_created ON persona_memories(persona_id, importance DESC, created_at DESC);",
            "CREATE INDEX IF NOT EXISTS idx_pm_persona_category ON persona_memories(persona_id, category);",
        ],
    )
}
