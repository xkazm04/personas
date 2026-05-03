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
    migrate_persona_messages(conn)?;
    migrate_persona_message_deliveries(conn)?;
    migrate_persona_healing_issues(conn)?;
    migrate_persona_metrics_snapshots(conn)?;
    migrate_persona_prompt_versions(conn)?;
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

fn migrate_persona_prompt_versions(conn: &Connection) -> Result<(), AppError> {
    // Prompt version history is meaningless once the persona is gone.
    // CASCADE matches the user's mental model — deleting a persona deletes
    // its full history.
    recreate_with_fk(
        conn,
        "persona_prompt_versions",
        1,
        &[
            "DELETE FROM persona_prompt_versions \
             WHERE persona_id NOT IN (SELECT id FROM personas);",
        ],
        "CREATE TABLE persona_prompt_versions_new (
            id                TEXT PRIMARY KEY,
            persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            version_number    INTEGER NOT NULL,
            structured_prompt TEXT,
            system_prompt     TEXT,
            change_summary    TEXT,
            tag               TEXT NOT NULL DEFAULT 'experimental',
            created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );",
        "id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, created_at",
        &[
            "CREATE INDEX IF NOT EXISTS idx_ppv_persona ON persona_prompt_versions(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_ppv_version ON persona_prompt_versions(persona_id, version_number DESC);",
        ],
    )
}

fn migrate_persona_metrics_snapshots(conn: &Connection) -> Result<(), AppError> {
    // Snapshots are aggregate counters scoped to a persona — pure derived
    // data with no value once the persona is deleted. No prior cleanup
    // existed in any repo, so orphans are likely.
    recreate_with_fk(
        conn,
        "persona_metrics_snapshots",
        1,
        &[
            "DELETE FROM persona_metrics_snapshots \
             WHERE persona_id NOT IN (SELECT id FROM personas);",
        ],
        "CREATE TABLE persona_metrics_snapshots_new (
            id                      TEXT PRIMARY KEY,
            persona_id              TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            snapshot_date           TEXT NOT NULL,
            total_executions        INTEGER NOT NULL DEFAULT 0,
            successful_executions   INTEGER NOT NULL DEFAULT 0,
            failed_executions       INTEGER NOT NULL DEFAULT 0,
            total_cost_usd          REAL NOT NULL DEFAULT 0,
            total_input_tokens      INTEGER NOT NULL DEFAULT 0,
            total_output_tokens     INTEGER NOT NULL DEFAULT 0,
            avg_duration_ms         REAL NOT NULL DEFAULT 0,
            events_emitted          INTEGER NOT NULL DEFAULT 0,
            events_consumed         INTEGER NOT NULL DEFAULT 0,
            messages_sent           INTEGER NOT NULL DEFAULT 0,
            created_at              TEXT NOT NULL
        );",
        "id, persona_id, snapshot_date, total_executions, successful_executions, failed_executions, total_cost_usd, total_input_tokens, total_output_tokens, avg_duration_ms, events_emitted, events_consumed, messages_sent, created_at",
        &[
            "CREATE INDEX IF NOT EXISTS idx_pms_persona ON persona_metrics_snapshots(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_pms_date ON persona_metrics_snapshots(snapshot_date);",
        ],
    )
}

fn migrate_persona_healing_issues(conn: &Connection) -> Result<(), AppError> {
    // Healing issues are persona-scoped diagnostics. Once the persona is
    // gone there's nothing to heal, so CASCADE is correct. Nullable
    // execution_id stays unconstrained — issues open during a long-running
    // execution can be reviewed after the execution row is purged.
    recreate_with_fk(
        conn,
        "persona_healing_issues",
        1,
        &[
            "DELETE FROM persona_healing_issues \
             WHERE persona_id NOT IN (SELECT id FROM personas);",
        ],
        "CREATE TABLE persona_healing_issues_new (
            id          TEXT PRIMARY KEY,
            persona_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            execution_id TEXT,
            title       TEXT NOT NULL,
            description TEXT NOT NULL,
            is_circuit_breaker INTEGER NOT NULL DEFAULT 0,
            severity    TEXT NOT NULL DEFAULT 'low',
            category    TEXT NOT NULL DEFAULT 'config',
            suggested_fix TEXT,
            auto_fixed  INTEGER NOT NULL DEFAULT 0,
            status      TEXT NOT NULL DEFAULT 'open',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            resolved_at TEXT
        );",
        "id, persona_id, execution_id, title, description, is_circuit_breaker, severity, category, suggested_fix, auto_fixed, status, created_at, resolved_at",
        &[
            "CREATE INDEX IF NOT EXISTS idx_phi_persona ON persona_healing_issues(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_phi_status ON persona_healing_issues(status);",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_phi_persona_execution ON persona_healing_issues(persona_id, execution_id) WHERE execution_id IS NOT NULL;",
        ],
    )
}

fn migrate_persona_message_deliveries(conn: &Connection) -> Result<(), AppError> {
    // Worst case in the FK-hygiene scope per the ADR: NO FK *and* no
    // cleanup block in any repo. Orphans guaranteed accumulating until now.
    // CASCADE on message_id finally collects them when the parent message
    // is deleted (which `personas.rs::delete()` triggers via its persona_id
    // cascade once persona_messages also CASCADEs to a persona).
    recreate_with_fk(
        conn,
        "persona_message_deliveries",
        1,
        &[
            "DELETE FROM persona_message_deliveries \
             WHERE message_id NOT IN (SELECT id FROM persona_messages);",
        ],
        "CREATE TABLE persona_message_deliveries_new (
            id            TEXT PRIMARY KEY,
            message_id    TEXT NOT NULL REFERENCES persona_messages(id) ON DELETE CASCADE,
            channel_type  TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            external_id   TEXT,
            delivered_at  TEXT,
            created_at    TEXT NOT NULL
        );",
        "id, message_id, channel_type, status, error_message, external_id, delivered_at, created_at",
        &[
            "CREATE INDEX IF NOT EXISTS idx_pmd_message ON persona_message_deliveries(message_id);",
        ],
    )
}

fn migrate_persona_messages(conn: &Connection) -> Result<(), AppError> {
    // Only persona_id gets a FK; nullable execution_id stays unconstrained.
    // Messages are surfaced in dashboards independently of execution lifetime
    // and an execution being purged shouldn't strand the message that
    // originated from it — frontend renders a soft "execution unavailable"
    // state when the link is broken.
    recreate_with_fk(
        conn,
        "persona_messages",
        1,
        &[
            "DELETE FROM persona_messages \
             WHERE persona_id NOT IN (SELECT id FROM personas);",
        ],
        "CREATE TABLE persona_messages_new (
            id           TEXT PRIMARY KEY,
            persona_id   TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            execution_id TEXT,
            title        TEXT,
            content      TEXT NOT NULL,
            content_type TEXT NOT NULL DEFAULT 'text',
            priority     TEXT NOT NULL DEFAULT 'normal',
            is_read      INTEGER NOT NULL DEFAULT 0,
            metadata     TEXT,
            created_at   TEXT NOT NULL,
            read_at      TEXT,
            thread_id    TEXT
        );",
        "id, persona_id, execution_id, title, content, content_type, priority, is_read, metadata, created_at, read_at, thread_id",
        &[
            "CREATE INDEX IF NOT EXISTS idx_pmsg_persona ON persona_messages(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_pmsg_is_read ON persona_messages(is_read);",
            "CREATE INDEX IF NOT EXISTS idx_pmsg_created ON persona_messages(created_at DESC);",
            "CREATE INDEX IF NOT EXISTS idx_pmsg_thread ON persona_messages(thread_id);",
        ],
    )
}

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
