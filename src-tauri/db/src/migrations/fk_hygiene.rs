//! Retrofits ON DELETE CASCADE / SET NULL foreign keys onto child tables that
//! were originally created without `REFERENCES` clauses. SQLite cannot
//! `ALTER TABLE ... ADD CONSTRAINT`, so each table is rebuilt via the
//! create-insert-drop-rename pattern; idempotency is gated by
//! `pragma_foreign_key_list`.
//!
//! ADR: 2026-05-02-fk-hygiene-cascade.

use rusqlite::Connection;

use personas_core::error::AppError;

/// Run the FK-hygiene sweep. Adds CASCADE/SET NULL FKs to the 8 orphan-prone
/// tables identified in the ADR. Each table is migrated independently and
/// idempotently — no-ops on a DB that has already been migrated.
pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    migrate_persona_memories(conn)?;
    migrate_persona_reports(conn)?;
    migrate_persona_report_deliveries(conn)?;
    migrate_persona_healing_issues(conn)?;
    migrate_persona_metrics_snapshots(conn)?;
    migrate_persona_prompt_versions(conn)?;
    migrate_pipeline_runs(conn)?;
    migrate_persona_events(conn)?;
    migrate_team_memories(conn)?;
    Ok(())
}

/// One column as the database itself reports it, via `pragma_table_info`.
/// Enough to re-declare the column on the staging table when the rebuild's
/// hand-written `CREATE TABLE` has never heard of it.
struct ColumnDef {
    name: String,
    decl_type: String,
    notnull: bool,
    dflt_value: Option<String>,
}

/// The table's live column list, straight from its stored DDL. This — not a
/// hand-written CSV — is the source of truth for what a rebuild has to carry.
fn table_columns(conn: &Connection, table: &str) -> Result<Vec<ColumnDef>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT \"name\", \"type\", \"notnull\", \"dflt_value\" FROM pragma_table_info('{}')",
        table.replace('\'', "''"),
    ))?;
    let rows = stmt.query_map([], |row| {
        Ok(ColumnDef {
            name: row.get(0)?,
            decl_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            notnull: row.get::<_, i64>(2)? != 0,
            dflt_value: row.get::<_, Option<String>>(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

/// Double-quote an identifier so a column named after a keyword survives the
/// round-trip into the generated SQL.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// `ALTER TABLE <staging> ADD COLUMN …` that re-declares `col` on the staging
/// table as faithfully as `ALTER TABLE` permits.
///
/// SQLite's `ADD COLUMN` refuses a parenthesised-expression or `CURRENT_*`
/// default, and refuses `NOT NULL` without a usable default. A column in that
/// shape is carried WITHOUT the constraint and a `tracing::warn!` names it:
/// preserving the user's data is the point of this whole function, and a
/// relaxed constraint on a column the rebuild never declared is a far smaller
/// loss than the column vanishing. In practice this branch is unreachable —
/// a column the rebuild has never heard of got there via `ALTER TABLE ADD
/// COLUMN`, which is subject to exactly the same restrictions.
fn add_column_ddl(staging_table: &str, col: &ColumnDef) -> String {
    let expressible_default = col.dflt_value.as_deref().filter(|d| {
        let d = d.trim();
        !d.starts_with('(') && !d.to_ascii_uppercase().starts_with("CURRENT_")
    });
    if col.dflt_value.is_some() && expressible_default.is_none() {
        tracing::warn!(
            table = %staging_table,
            column = %col.name,
            "FK hygiene: carrying column without its DEFAULT — ALTER TABLE ADD COLUMN cannot \
             express an expression default; the column and its data are preserved",
        );
    }
    let keep_notnull = col.notnull && expressible_default.is_some();
    if col.notnull && !keep_notnull {
        tracing::warn!(
            table = %staging_table,
            column = %col.name,
            "FK hygiene: carrying column as nullable — ALTER TABLE ADD COLUMN cannot add a \
             NOT NULL column without a literal default; the column and its data are preserved",
        );
    }

    let mut ddl = format!(
        "ALTER TABLE {staging_table} ADD COLUMN {}",
        quote_ident(&col.name),
    );
    if !col.decl_type.is_empty() {
        ddl.push(' ');
        ddl.push_str(&col.decl_type);
    }
    if keep_notnull {
        ddl.push_str(" NOT NULL");
    }
    if let Some(default) = expressible_default {
        ddl.push_str(" DEFAULT ");
        ddl.push_str(default);
    }
    ddl.push(';');
    ddl
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
///   * `narrow_to_columns_csv` — **normally `None`.** The column list is
///     derived from the table's OWN stored DDL (see below). Pass
///     `Some("a, b, c")` only to deliberately NARROW the copy — i.e. when the
///     rebuild's purpose includes dropping a column.
///   * `index_sqls` — `CREATE INDEX IF NOT EXISTS` statements the new shape
///     wants. Anything else the original table carried is replayed
///     automatically (see below).
///
/// ## Why the column list is derived, not hand-written
///
/// This helper is shared by nine tables. Every caller used to hand-write a
/// `columns_csv`, which meant the copy silently DROPPED any column a later
/// migration had added — the exact trap
/// `rebuild_executions_table_with_incomplete_status` and
/// `widen_kpi_measurement_source_with_ai_compose` avoid by recreating from
/// stored DDL. Deriving the list from `pragma_table_info` closes all nine at
/// once. Columns the live table has but the new shape does not declare are
/// re-added to the staging table before the copy, so they ride along with
/// their data instead of being destroyed.
///
/// Indexes and triggers are likewise replayed from `sqlite_master` rather than
/// only from `index_sqls`: `DROP TABLE` takes them with it. (`persona_memories`
/// really does carry the MEMORY CONTRACT 4 importance triggers, installed one
/// phase-1 step before this sweep runs.) `index_sqls` is applied first so the
/// new shape's own indexes win a name collision; a captured object whose name
/// already exists after that is skipped.
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
    narrow_to_columns_csv: Option<&str>,
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

    // Disable FK enforcement for the rebuild — in AUTOCOMMIT, BEFORE opening the
    // transaction. `PRAGMA foreign_keys` is a documented no-op while a
    // transaction is active, so the previous in-transaction `OFF` did nothing:
    // FKs stayed ON for the whole rebuild, and `DROP TABLE` below then fired the
    // ON DELETE CASCADE of any other table referencing this one, silently wiping
    // child rows on a legacy upgrade. The guard sets OFF now and restores the
    // prior state when it drops (after commit). Mirrors the executions rebuild.
    let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

    // Snapshot the LIVE shape before anything is dropped: the column list the
    // copy has to carry, and the index/trigger DDL `DROP TABLE` is about to
    // take with it. Auto-indexes (PK/UNIQUE) have a NULL `sql` and are skipped
    // — SQLite recreates them implicitly from the new shape.
    let live_columns = table_columns(conn, table_name)?;
    let replay_objects: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT type, name, sql FROM sqlite_master
              WHERE tbl_name = ?1 AND type IN ('index', 'trigger') AND sql IS NOT NULL",
        )?;
        let rows = stmt.query_map([table_name], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    // Purge any pre-existing orphans that would violate the new FK. Done
    // inside the same transaction so a partial cleanup can't leak if the
    // rebuild fails.
    let tx = conn.unchecked_transaction()?;

    for sql in cleanup_orphans_sql {
        tx.execute_batch(sql)?;
    }

    let row_count_before: i64 = tx
        .prepare(&format!(
            "SELECT COUNT(*) FROM {}",
            table_name.replace('\'', "''"),
        ))?
        .query_row([], |row| row.get(0))?;

    // Rebuild: create _new, copy data, drop original, rename. The staging
    // table is dropped first so a rolled-back earlier attempt can't collide.
    let staging = format!("{table_name}_new");
    tx.execute_batch(&format!("DROP TABLE IF EXISTS {staging};"))?;
    tx.execute_batch(new_create_sql)?;

    let columns_csv = match narrow_to_columns_csv {
        Some(csv) => csv.to_string(),
        None => {
            let staged_columns = table_columns(&tx, &staging)?;
            for col in &live_columns {
                if staged_columns
                    .iter()
                    .any(|s| s.name.eq_ignore_ascii_case(&col.name))
                {
                    continue;
                }
                // A column a LATER migration added. The new shape predates it,
                // so re-declare it on the staging table rather than dropping
                // the user's data on the floor.
                tracing::info!(
                    table = %table_name,
                    column = %col.name,
                    "FK hygiene: carrying a column the rebuild shape does not declare",
                );
                tx.execute_batch(&add_column_ddl(&staging, col))?;
            }
            live_columns
                .iter()
                .map(|c| quote_ident(&c.name))
                .collect::<Vec<_>>()
                .join(", ")
        }
    };

    let copy_sql = format!(
        "INSERT INTO {staging} ({cols}) SELECT {cols} FROM {table}",
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
        return Err(AppError::Validation(format!(
            "FK hygiene: rebuilding `{table_name}` copied {row_count_after} of \
             {row_count_before} rows — refusing to swap the table in",
        )));
    }

    tx.execute_batch(&format!("DROP TABLE {};", table_name))?;
    tx.execute_batch(&format!(
        "ALTER TABLE {table}_new RENAME TO {table};",
        table = table_name,
    ))?;

    // The new shape's own indexes first, so they win any name collision with
    // a stale object of the same name captured from the old table.
    for index_sql in index_sqls {
        tx.execute_batch(index_sql)?;
    }
    for (obj_type, obj_name, obj_sql) in &replay_objects {
        let already: i64 = tx.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = ?1 AND name = ?2",
            rusqlite::params![obj_type, obj_name],
            |row| row.get(0),
        )?;
        if already > 0 {
            continue;
        }
        tx.execute_batch(obj_sql)?;
    }

    // Verify the new state has no violations before committing. The
    // foreign_key_check pragma runs regardless of the (guard-disabled)
    // enforcement setting; the guard restores enforcement after commit. If a
    // violation slipped past cleanup_orphans_sql, abort.
    let violations: i64 = tx
        .prepare("SELECT COUNT(*) FROM pragma_foreign_key_check")?
        .query_row([], |row| row.get(0))?;
    if violations > 0 {
        return Err(AppError::Validation(format!(
            "FK hygiene: rebuilt `{table_name}` still has {violations} foreign-key \
             violation(s) — refusing to commit the swap",
        )));
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
        &["UPDATE persona_events SET target_persona_id = NULL \
             WHERE target_persona_id IS NOT NULL \
               AND target_persona_id NOT IN (SELECT id FROM personas);"],
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
        None,
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
        None,
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
        None,
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
        &["DELETE FROM persona_metrics_snapshots \
             WHERE persona_id NOT IN (SELECT id FROM personas);"],
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
        None,
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
            // The rebuild below adds a UNIQUE(persona_id, execution_id) index
            // (WHERE execution_id IS NOT NULL). The original table never had
            // that constraint, so a legacy DB can hold duplicate healing
            // issues for the same (persona, execution) pair — de-dupe first
            // (keep the newest row per pair) or CREATE UNIQUE INDEX aborts
            // the whole migration and startup fails. See
            // refactor-bughunt-2026-07-10/tauri-db-misc.md #3.
            "DELETE FROM persona_healing_issues \
             WHERE execution_id IS NOT NULL AND rowid NOT IN (
                 SELECT MAX(rowid) FROM persona_healing_issues \
                 WHERE execution_id IS NOT NULL \
                 GROUP BY persona_id, execution_id
             );",
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
        None,
        &[
            "CREATE INDEX IF NOT EXISTS idx_phi_persona ON persona_healing_issues(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_phi_status ON persona_healing_issues(status);",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_phi_persona_execution ON persona_healing_issues(persona_id, execution_id) WHERE execution_id IS NOT NULL;",
        ],
    )
}

fn migrate_persona_report_deliveries(conn: &Connection) -> Result<(), AppError> {
    // Worst case in the FK-hygiene scope per the ADR: NO FK *and* no
    // cleanup block in any repo. Orphans guaranteed accumulating until now.
    // CASCADE on message_id finally collects them when the parent message
    // is deleted (which `personas.rs::delete()` triggers via its persona_id
    // cascade once persona_reports also CASCADEs to a persona).
    recreate_with_fk(
        conn,
        "persona_report_deliveries",
        1,
        &["DELETE FROM persona_report_deliveries \
             WHERE message_id NOT IN (SELECT id FROM persona_reports);"],
        "CREATE TABLE persona_report_deliveries_new (
            id            TEXT PRIMARY KEY,
            message_id    TEXT NOT NULL REFERENCES persona_reports(id) ON DELETE CASCADE,
            channel_type  TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            external_id   TEXT,
            delivered_at  TEXT,
            created_at    TEXT NOT NULL
        );",
        None,
        &["CREATE INDEX IF NOT EXISTS idx_prd_message ON persona_report_deliveries(message_id);"],
    )
}

fn migrate_persona_reports(conn: &Connection) -> Result<(), AppError> {
    // Only persona_id gets a FK; nullable execution_id stays unconstrained.
    // Messages are surfaced in dashboards independently of execution lifetime
    // and an execution being purged shouldn't strand the message that
    // originated from it — frontend renders a soft "execution unavailable"
    // state when the link is broken.
    recreate_with_fk(
        conn,
        "persona_reports",
        1,
        &["DELETE FROM persona_reports \
             WHERE persona_id NOT IN (SELECT id FROM personas);"],
        "CREATE TABLE persona_reports_new (
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
        None,
        &[
            "CREATE INDEX IF NOT EXISTS idx_prpt_persona ON persona_reports(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_prpt_is_read ON persona_reports(is_read);",
            "CREATE INDEX IF NOT EXISTS idx_prpt_created ON persona_reports(created_at DESC);",
            "CREATE INDEX IF NOT EXISTS idx_prpt_thread ON persona_reports(thread_id);",
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
        None,
        &[
            "CREATE INDEX IF NOT EXISTS idx_persona_memories_persona ON persona_memories(persona_id);",
            "CREATE INDEX IF NOT EXISTS idx_persona_memories_category ON persona_memories(category);",
            "CREATE INDEX IF NOT EXISTS idx_persona_memories_importance ON persona_memories(importance DESC);",
            "CREATE INDEX IF NOT EXISTS idx_pm_persona_importance_created ON persona_memories(persona_id, importance DESC, created_at DESC);",
            "CREATE INDEX IF NOT EXISTS idx_pm_persona_category ON persona_memories(persona_id, category);",
        ],
    )
}

fn migrate_team_memories(conn: &Connection) -> Result<(), AppError> {
    // team_memories.team_id was NOT NULL but FK-less — a coverage gap in the
    // original FK-hygiene sweep (DM-F2, data-modeling scan 2026-05-24). It's an
    // owned child (a memory belongs to exactly one team), so CASCADE. The other
    // *_id columns (run_id, member_id, persona_id) are nullable/loosely-coupled
    // and intentionally stay FK-less. `teams.rs::delete` keeps its manual
    // `DELETE FROM team_memories` as belt-and-suspenders; this FK makes orphans
    // structurally impossible regardless of the delete path.
    recreate_with_fk(
        conn,
        "team_memories",
        1,
        &["DELETE FROM team_memories \
             WHERE team_id NOT IN (SELECT id FROM persona_teams);"],
        "CREATE TABLE team_memories_new (
            id          TEXT PRIMARY KEY,
            team_id     TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
            run_id      TEXT,
            member_id   TEXT,
            persona_id  TEXT,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            category    TEXT NOT NULL DEFAULT 'observation',
            importance  INTEGER NOT NULL DEFAULT 3,
            tags        TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );",
        None,
        &[
            "CREATE INDEX IF NOT EXISTS idx_tm_team       ON team_memories(team_id);",
            "CREATE INDEX IF NOT EXISTS idx_tm_run        ON team_memories(run_id);",
            "CREATE INDEX IF NOT EXISTS idx_tm_category   ON team_memories(category);",
            "CREATE INDEX IF NOT EXISTS idx_tm_importance ON team_memories(importance DESC);",
            "CREATE INDEX IF NOT EXISTS idx_tm_team_cat   ON team_memories(team_id, category);",
            "CREATE INDEX IF NOT EXISTS idx_tm_team_importance_created \
             ON team_memories(team_id, importance DESC, created_at DESC);",
            "CREATE INDEX IF NOT EXISTS idx_tm_team_run   ON team_memories(team_id, run_id);",
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

    use crate::{init_test_db, DbPool};

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
            "INSERT INTO persona_reports (id, persona_id, content, created_at) \
             VALUES ('msg1', 'p1', 'c', datetime('now'))",
            [],
        )
        .expect("insert message");
        conn.execute(
            "INSERT INTO persona_report_deliveries (id, message_id, channel_type, created_at) \
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
                "SELECT COUNT(*) FROM persona_reports WHERE persona_id = ?1",
                "p1"
            ),
            0
        );
        // Transitive: deliveries should be gone too via the message_id cascade.
        assert_eq!(
            pool.get()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM persona_report_deliveries WHERE message_id = 'msg1'",
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

    /// A column, index or trigger that a LATER migration added must SURVIVE the
    /// FK rebuild. The helper used to copy through a hand-written `columns_csv`
    /// and re-create only a hand-written index list, so anything it had never
    /// heard of was silently destroyed by the drop-and-rename.
    ///
    /// Simulates a legacy database the way
    /// `incremental::widening_the_measurement_source_preserves_rows_and_later_columns`
    /// does: rewind `persona_memories` to its pre-FK shape, then bolt on the
    /// artifacts of a "future" migration — two columns, an index over one of
    /// them, and the MEMORY CONTRACT 4 importance trigger (which
    /// `install_persona_memory_invariants` really does install one phase-1 step
    /// BEFORE `fk_hygiene::run`, so this is the live ordering, not a hypothetical).
    #[test]
    fn recreate_with_fk_preserves_later_columns_indexes_and_triggers() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at) \
             VALUES ('p1', 'test', 'sp', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert persona");

        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             DROP TABLE persona_memories;
             CREATE TABLE persona_memories (
                id                  TEXT PRIMARY KEY,
                persona_id          TEXT NOT NULL,
                title               TEXT NOT NULL,
                content             TEXT NOT NULL,
                category            TEXT DEFAULT 'fact',
                source_execution_id TEXT,
                importance          INTEGER DEFAULT 3,
                tags                TEXT,
                created_at          TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
             );
             ALTER TABLE persona_memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'active';
             ALTER TABLE persona_memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
             CREATE INDEX idx_pm_tier_injection
                ON persona_memories(persona_id, tier, importance DESC);
             CREATE TRIGGER persona_memories_importance_insert
             BEFORE INSERT ON persona_memories
             FOR EACH ROW
             WHEN NEW.importance IS NOT NULL AND (NEW.importance < 1 OR NEW.importance > 5)
             BEGIN
                 SELECT RAISE(ABORT, 'persona_memories.importance must be in 1..=5');
             END;
             INSERT INTO persona_memories
                (id, persona_id, title, content, importance, tier, access_count)
                VALUES ('m1', 'p1', 't', 'c', 4, 'core', 7);
             PRAGMA foreign_keys = ON;",
        )
        .expect("rewind persona_memories to a legacy, FK-less shape");

        let fk_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('persona_memories')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fk_before, 0, "the rewound table must start out FK-less");

        super::run(&conn).expect("fk_hygiene::run over a legacy persona_memories");

        // 1. The rebuild did what it exists to do.
        let fk_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('persona_memories')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fk_after, 1, "the FK must be declared after the rebuild");

        // 2. The row AND the columns a later migration added rode along.
        let (tier, access_count, importance): (String, i64, i64) = conn
            .query_row(
                "SELECT tier, access_count, importance FROM persona_memories WHERE id = 'm1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("a column the rebuild code never knew about must survive with its data");
        assert_eq!(tier, "core", "tier value must be preserved verbatim");
        assert_eq!(access_count, 7, "access_count value must be preserved");
        assert_eq!(importance, 4);

        // 3. An index the rebuild does not hand-write was replayed.
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'index' AND name = 'idx_pm_tier_injection'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "an index over a later column must be replayed");

        // 4. The hand-written indexes are still created too.
        let idx_persona: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'index' AND name = 'idx_persona_memories_persona'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            idx_persona, 1,
            "the hand-written index list must still apply"
        );

        // 5. The trigger survived — it still refuses an out-of-range importance.
        assert!(
            conn.execute(
                "INSERT INTO persona_memories (id, persona_id, title, content, importance) \
                 VALUES ('m2', 'p1', 't', 'c', 99)",
                [],
            )
            .is_err(),
            "the importance-invariant trigger must survive the rebuild",
        );

        // 6. And the point of the whole rebuild: the FK cascades.
        conn.execute("DELETE FROM personas WHERE id = 'p1'", [])
            .unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM persona_memories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "deleting the persona must cascade to its memories");
    }

    /// The narrowing capability the derived column list replaced must stay
    /// reachable: a rebuild that deliberately DROPS a column can still say so.
    #[test]
    fn recreate_with_fk_can_still_narrow_the_column_set_on_purpose() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             DROP TABLE team_memories;
             CREATE TABLE team_memories (
                id          TEXT PRIMARY KEY,
                team_id     TEXT NOT NULL,
                run_id      TEXT,
                member_id   TEXT,
                persona_id  TEXT,
                title       TEXT NOT NULL,
                content     TEXT NOT NULL,
                category    TEXT NOT NULL DEFAULT 'observation',
                importance  INTEGER NOT NULL DEFAULT 3,
                tags        TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
                doomed      TEXT
             );
             INSERT INTO persona_teams (id, name, created_at, updated_at)
                VALUES ('t1', 'team', datetime('now'), datetime('now'));
             INSERT INTO team_memories (id, team_id, title, content, doomed)
                VALUES ('tm1', 't1', 't', 'c', 'goodbye');
             PRAGMA foreign_keys = ON;",
        )
        .expect("rewind team_memories with a column we intend to drop");

        super::recreate_with_fk(
            &conn,
            "team_memories",
            1,
            &[],
            "CREATE TABLE team_memories_new (
                id          TEXT PRIMARY KEY,
                team_id     TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                content     TEXT NOT NULL
            );",
            Some("id, team_id, title, content"),
            &[],
        )
        .expect("an intentional narrowing must still be expressible");

        assert!(
            !super::table_columns(&conn, "team_memories")
                .unwrap()
                .iter()
                .any(|c| c.name == "doomed"),
            "an explicitly narrowed rebuild must drop the column it left out",
        );
        let content: String = conn
            .query_row(
                "SELECT content FROM team_memories WHERE id = 'tm1'",
                [],
                |r| r.get(0),
            )
            .expect("the retained columns still carry their data");
        assert_eq!(content, "c");
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

    #[test]
    fn deleting_team_cascades_team_memories() {
        let pool = init_test_db().expect("init_test_db");
        insert_team(&pool, "t1");
        {
            let conn = pool.get().expect("pool.get");
            conn.execute(
                "INSERT INTO team_memories (id, team_id, title, content) \
                 VALUES ('tm1', 't1', 't', 'c')",
                [],
            )
            .expect("insert team_memory");
            conn.execute("DELETE FROM persona_teams WHERE id = 't1'", [])
                .expect("delete team");
        }
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM team_memories WHERE team_id = ?1",
                "t1",
            ),
            0,
            "team_memories should cascade-delete when its team is deleted"
        );
    }

    #[test]
    fn team_memories_fk_present_and_rerun_is_noop() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");
        let fk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('team_memories')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fk_count, 1, "team_memories should declare exactly 1 FK");
        // Re-running the sweep must be a no-op (idempotency via FK-count guard).
        super::super::fk_hygiene::run(&conn).expect("re-run fk_hygiene");
    }
}
