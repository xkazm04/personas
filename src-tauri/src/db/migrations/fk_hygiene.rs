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
    migrate_pipeline_runs(conn)?;
    migrate_persona_events(conn)?;
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

fn migrate_persona_events(conn: &Connection) -> Result<(), AppError> {
    // Only target_persona_id gets a FK. source_id is polymorphic — its
    // referent depends on source_type ('persona', 'trigger', 'system', ...)
    // and SQL FKs can't model that. The manual `DELETE persona_events
    // WHERE source_id = ?1` block in personas.rs::delete still handles the
    // persona-source case after this migration; the deletion-cascade for
    // target_persona_id moves to the FK as SET NULL (events outlive their
    // recipient — the row stays, the link goes null).
    //
    // No orphan cleanup needed: SET NULL already handles existing rows
    // pointing at non-existent personas (PRAGMA foreign_key_check rejects
    // those, but in our case any current target_persona_id pointing at a
    // missing persona just gets the SET NULL treatment when the original
    // persona was already deleted by the manual cleanup). To be safe we
    // null out any currently-orphaned target_persona_id references before
    // declaring the FK.
    recreate_with_fk(
        conn,
        "persona_events",
        1,
        &[
            "UPDATE persona_events SET target_persona_id = NULL \
             WHERE target_persona_id IS NOT NULL \
               AND target_persona_id NOT IN (SELECT id FROM personas);",
        ],
        "CREATE TABLE persona_events_new (
            id                 TEXT PRIMARY KEY,
            project_id         TEXT NOT NULL DEFAULT 'default',
            event_type         TEXT NOT NULL,
            source_type        TEXT NOT NULL,
            source_id          TEXT,
            target_persona_id  TEXT REFERENCES personas(id) ON DELETE SET NULL,
            payload            TEXT,
            payload_iv         TEXT,
            status             TEXT NOT NULL DEFAULT 'pending',
            error_message      TEXT,
            processed_at       TEXT,
            created_at         TEXT NOT NULL
        );",
        "id, project_id, event_type, source_type, source_id, target_persona_id, payload, payload_iv, status, error_message, processed_at, created_at",
        &[
            "CREATE INDEX IF NOT EXISTS idx_pev_status ON persona_events(status);",
            "CREATE INDEX IF NOT EXISTS idx_pev_project ON persona_events(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_pev_type ON persona_events(event_type);",
            "CREATE INDEX IF NOT EXISTS idx_pev_target ON persona_events(target_persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_pev_created ON persona_events(created_at DESC);",
        ],
    )
}

fn migrate_pipeline_runs(conn: &Connection) -> Result<(), AppError> {
    // pipeline_runs is the only FK target in this sweep that points at
    // persona_teams rather than personas. teams.rs::delete already does a
    // manual cleanup so orphans aren't expected; the FK still adds defense
    // in depth (third-party SQL writes, future code paths).
    recreate_with_fk(
        conn,
        "pipeline_runs",
        1,
        &["DELETE FROM pipeline_runs \
             WHERE team_id NOT IN (SELECT id FROM persona_teams);"],
        "CREATE TABLE pipeline_runs_new (
            id              TEXT PRIMARY KEY,
            team_id         TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
            status          TEXT NOT NULL DEFAULT 'running',
            node_statuses   TEXT NOT NULL DEFAULT '[]',
            input_data      TEXT,
            started_at      TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at    TEXT,
            error_message   TEXT
        );",
        "id, team_id, status, node_statuses, input_data, started_at, completed_at, error_message",
        &[
            "CREATE INDEX IF NOT EXISTS idx_pr_team ON pipeline_runs(team_id);",
            "CREATE INDEX IF NOT EXISTS idx_pr_status ON pipeline_runs(status);",
        ],
    )
}

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

#[cfg(test)]
mod tests {
    //! Orphan-prevention tests for the FK hygiene ADR
    //! (2026-05-02-fk-hygiene-cascade). Each test creates a parent + child
    //! pair, deletes the parent, and asserts the child is gone (CASCADE) or
    //! has its FK column nulled (SET NULL).
    //!
    //! Tests use `init_test_db()` which runs both migration phases against
    //! a fresh temp DB, so they exercise the canonical schema path that
    //! fresh installs hit. Legacy DB rebuild path is exercised implicitly
    //! by the helper's idempotency check (skips when FK already declared).
    use rusqlite::params;

    use crate::db::{init_test_db, DbPool};

    fn count(pool: &DbPool, sql: &str, persona_id: &str) -> i64 {
        let conn = pool.get().expect("pool.get");
        conn.query_row(sql, params![persona_id], |row| row.get::<_, i64>(0))
            .expect("query_row")
    }

    fn insert_persona(pool: &DbPool, id: &str) {
        let conn = pool.get().expect("pool.get");
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at) \
             VALUES (?1, 'test', 'sp', datetime('now'), datetime('now'))",
            params![id],
        )
        .expect("insert persona");
    }

    fn insert_team(pool: &DbPool, id: &str) {
        let conn = pool.get().expect("pool.get");
        conn.execute(
            "INSERT INTO persona_teams (id, name, created_at, updated_at) \
             VALUES (?1, 'team', datetime('now'), datetime('now'))",
            params![id],
        )
        .expect("insert team");
    }

    #[test]
    fn deleting_persona_cascades_memories() {
        let pool = init_test_db().expect("init_test_db");
        insert_persona(&pool, "p1");
        let conn = pool.get().expect("pool.get");
        conn.execute(
            "INSERT INTO persona_memories (id, persona_id, title, content) \
             VALUES ('m1', 'p1', 't', 'c')",
            [],
        )
        .expect("insert memory");
        drop(conn);
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?1",
                "p1"
            ),
            1
        );
        pool.get()
            .unwrap()
            .execute("DELETE FROM personas WHERE id = ?1", params!["p1"])
            .unwrap();
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?1",
                "p1"
            ),
            0
        );
    }

    #[test]
    fn deleting_persona_cascades_messages_and_deliveries() {
        let pool = init_test_db().expect("init_test_db");
        insert_persona(&pool, "p1");
        let conn = pool.get().expect("pool.get");
        conn.execute(
            "INSERT INTO persona_messages (id, persona_id, content, created_at) \
             VALUES ('msg1', 'p1', 'c', datetime('now'))",
            [],
        )
        .expect("insert message");
        conn.execute(
            "INSERT INTO persona_message_deliveries (id, message_id, channel_type, created_at) \
             VALUES ('d1', 'msg1', 'email', datetime('now'))",
            [],
        )
        .expect("insert delivery");
        drop(conn);
        pool.get()
            .unwrap()
            .execute("DELETE FROM personas WHERE id = ?1", params!["p1"])
            .unwrap();
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM persona_messages WHERE persona_id = ?1",
                "p1"
            ),
            0
        );
        // Transitive: deliveries should be gone too via the message_id cascade.
        assert_eq!(
            pool.get()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM persona_message_deliveries WHERE message_id = 'msg1'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn deleting_persona_cascades_healing_issues() {
        let pool = init_test_db().expect("init_test_db");
        insert_persona(&pool, "p1");
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO persona_healing_issues (id, persona_id, title, description) \
             VALUES ('h1', 'p1', 't', 'd')",
                [],
            )
            .unwrap();
        pool.get()
            .unwrap()
            .execute("DELETE FROM personas WHERE id = ?1", params!["p1"])
            .unwrap();
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM persona_healing_issues WHERE persona_id = ?1",
                "p1"
            ),
            0
        );
    }

    #[test]
    fn deleting_persona_cascades_metrics_snapshots() {
        let pool = init_test_db().expect("init_test_db");
        insert_persona(&pool, "p1");
        pool.get().unwrap().execute(
            "INSERT INTO persona_metrics_snapshots (id, persona_id, snapshot_date, created_at) \
             VALUES ('s1', 'p1', '2026-05-03', datetime('now'))",
            [],
        ).unwrap();
        pool.get()
            .unwrap()
            .execute("DELETE FROM personas WHERE id = ?1", params!["p1"])
            .unwrap();
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM persona_metrics_snapshots WHERE persona_id = ?1",
                "p1"
            ),
            0
        );
    }

    #[test]
    fn deleting_persona_cascades_prompt_versions() {
        let pool = init_test_db().expect("init_test_db");
        insert_persona(&pool, "p1");
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO persona_prompt_versions (id, persona_id, version_number) \
             VALUES ('v1', 'p1', 1)",
                [],
            )
            .unwrap();
        pool.get()
            .unwrap()
            .execute("DELETE FROM personas WHERE id = ?1", params!["p1"])
            .unwrap();
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM persona_prompt_versions WHERE persona_id = ?1",
                "p1"
            ),
            0
        );
    }

    #[test]
    fn deleting_team_cascades_pipeline_runs() {
        let pool = init_test_db().expect("init_test_db");
        insert_team(&pool, "t1");
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO pipeline_runs (id, team_id) VALUES ('pr1', 't1')",
                [],
            )
            .unwrap();
        pool.get()
            .unwrap()
            .execute("DELETE FROM persona_teams WHERE id = ?1", params!["t1"])
            .unwrap();
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM pipeline_runs WHERE team_id = ?1",
                "t1"
            ),
            0
        );
    }

    #[test]
    fn deleting_persona_nulls_event_target() {
        let pool = init_test_db().expect("init_test_db");
        insert_persona(&pool, "p1");
        pool.get().unwrap().execute(
            "INSERT INTO persona_events (id, event_type, source_type, source_id, target_persona_id, status, created_at) \
             VALUES ('e1', 'tick', 'system', NULL, 'p1', 'pending', datetime('now'))",
            [],
        ).unwrap();
        pool.get()
            .unwrap()
            .execute("DELETE FROM personas WHERE id = ?1", params!["p1"])
            .unwrap();
        // SET NULL: row preserved, target nulled.
        let target: Option<String> = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT target_persona_id FROM persona_events WHERE id = 'e1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            target.is_none(),
            "target_persona_id should be NULL after parent delete"
        );
    }

    #[test]
    fn fk_hygiene_run_is_idempotent() {
        let pool = init_test_db().expect("init_test_db");
        // init_test_db already ran fk_hygiene::run via run_incremental.
        // Calling it again on the same DB must be a no-op (skip via
        // pragma_foreign_key_list count >= expected).
        let conn = pool.get().expect("pool.get");
        super::super::fk_hygiene::run(&conn).expect("re-run fk_hygiene");
        // Sanity: the FKs still exist.
        let fk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('persona_memories')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            fk_count >= 1,
            "persona_memories should still have FK after re-run"
        );
    }
}
