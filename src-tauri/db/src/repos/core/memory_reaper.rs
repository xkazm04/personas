//! Reaper registry, durable orphan ledger, and dependent-side sweep for the
//! stores that hold persona-memory data the relational cascade cannot reach.
//!
//! Spec: `docs/architecture/memory-vector-orphan-reconciliation.md`
//! (deferred-fixes #108; registry technique
//! `entity-lifecycle/orphan-reconciliation`).
//!
//! A memory's embeddings live in a separate database file
//! (`persona_memory_embedding` + `persona_memory_embedding_meta`), so deleting
//! a memory is a cross-store delete wearing a single door's clothing. Three
//! structures keep it honest:
//!
//! 1. **The registry** ([`MEMORY_REAPERS`]) — one enumerable structure, one
//!    entry per dependent store. The cascade iterates it, receipts/logs name
//!    entries by it, and the sweep derives its work from it. Adding a
//!    dependent store is one entry here, nowhere else.
//! 2. **The ledger** (`memory_reaper_ledger`, main DB, **no foreign keys** so
//!    no entity cascade can reach it) — written at the delete door *before*
//!    the fire-and-forget reapers run, while the parent's id and title are
//!    still in scope. A reaper's success resolves its entry; a failure (or a
//!    build/runtime that cannot run reapers at all) leaves the debt recorded
//!    durably instead of in a log line.
//! 3. **The sweep** ([`reconcile_memory_vector_orphans`]) — the one pass that
//!    walks the *dependent* side and asks, per vector, whether its owner
//!    still exists. Every other reconciler here runs parent-first, and a
//!    parent-first sweep cannot find an orphan (measured 2026-08-17: a 100%
//!    orphaned store while every sweep reported clean). Report mode deletes
//!    nothing and logs even a zero; apply mode is explicit and idempotent.

use rusqlite::{params, Connection, OptionalExtension};

use personas_core::error::AppError;

use crate::{DbPool, PoolExt, UserDbPool};

// ---------------------------------------------------------------------------
// Reaper registry
// ---------------------------------------------------------------------------

/// One dependent store owed a cleanup when a memory row is destroyed.
pub struct ReaperEntry {
    /// Stable name — ledger `pending` entries and log lines use it.
    pub name: &'static str,
    /// Delete this store's rows for the given memory ids. Must be idempotent
    /// (an already-gone target is a no-op, not an error) and tolerate the
    /// store not being provisioned yet. Returns rows removed.
    pub run: fn(&UserDbPool, &[String]) -> Result<usize, AppError>,
}

/// The enumerable set of dependent stores. Cascade, receipt, and sweep all
/// derive from this slice and none maintains a second list.
pub const MEMORY_REAPERS: &[ReaperEntry] = &[ReaperEntry {
    name: "vector_embeddings",
    run: reap_vector_embeddings,
}];

/// JSON array of every reaper name — the `pending` set a fresh ledger record
/// starts with (all reapers owed).
fn all_reaper_names_json() -> String {
    let names: Vec<&str> = MEMORY_REAPERS.iter().map(|r| r.name).collect();
    serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, AppError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?1",
        params![table],
        |r| r.get("n"),
    )?;
    Ok(n > 0)
}

/// The vector-store reaper: chunked delete from the KNN table and its
/// model-stamp sidecar. Plain SQL — callable from any build. In an ml build
/// the vec0 virtual table is readable/writable because sqlite-vec is
/// registered on the pool's connections; elsewhere the DELETE fails loudly
/// and the ledger keeps the debt. An unprovisioned table means nothing was
/// ever embedded — nothing to reap.
pub fn reap_vector_embeddings(vec_pool: &UserDbPool, ids: &[String]) -> Result<usize, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let conn = vec_pool.conn("memory_reaper::reap_vector_embeddings")?;
    const CHUNK: usize = 400;
    let mut removed = 0usize;
    for table in ["persona_memory_embedding", "persona_memory_embedding_meta"] {
        if !table_exists(&conn, table)? {
            continue;
        }
        for chunk in ids.chunks(CHUNK) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let params: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            removed += conn.execute(
                &format!("DELETE FROM {table} WHERE memory_id IN ({placeholders})"),
                params.as_slice(),
            )?;
        }
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/// Ledger DDL. Lives in the MAIN database, created lazily (the same
/// provision-at-runtime pattern as the vec tables themselves), and carries no
/// foreign keys: no entity's deletion can cascade into the record of that
/// deletion's own unfinished business.
const LEDGER_DDL: &str = "CREATE TABLE IF NOT EXISTS memory_reaper_ledger (
    memory_id         TEXT PRIMARY KEY,
    display_name      TEXT,
    pending           TEXT NOT NULL,
    attempts          INTEGER NOT NULL DEFAULT 0,
    first_recorded_at TEXT NOT NULL,
    last_attempt_at   TEXT
)";

pub fn ensure_ledger_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute(LEDGER_DDL, [])?;
    Ok(())
}

/// A ledger row: a destroyed memory whose dependent-store cleanup is still
/// owed (in part or in full).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerRow {
    pub memory_id: String,
    pub display_name: Option<String>,
    /// Reaper names still owed.
    pub pending: Vec<String>,
    pub attempts: i64,
}

/// Record that every reaper is owed for these destroyed memories. Called at
/// the delete door while the parent's identity is still in scope. Re-recording
/// merges rather than duplicates (upsert on `memory_id`); this is also the
/// entry point for pre-ledger orphans — hand it an id, all reapers are
/// assumed owed, and the sweep existence-checks it like any other candidate.
pub fn record_owed(
    conn: &Connection,
    victims: &[(String, Option<String>)],
) -> Result<(), AppError> {
    if victims.is_empty() {
        return Ok(());
    }
    ensure_ledger_table(conn)?;
    let pending = all_reaper_names_json();
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn.prepare_cached(
        "INSERT INTO memory_reaper_ledger (memory_id, display_name, pending, attempts, first_recorded_at)
         VALUES (?1, ?2, ?3, 0, ?4)
         ON CONFLICT(memory_id) DO UPDATE SET
             pending = excluded.pending,
             display_name = COALESCE(excluded.display_name, display_name)",
    )?;
    for (id, title) in victims {
        stmt.execute(params![id, title, pending, now])?;
    }
    Ok(())
}

/// One reaper finished for these ids: shrink each row's pending set and
/// resolve (delete) rows whose pending set is now empty. A resolved ledger is
/// how the sweep knows it is done.
pub fn resolve_reaper(conn: &Connection, reaper: &str, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    ensure_ledger_table(conn)?;
    const CHUNK: usize = 400;
    for chunk in ids.chunks(CHUNK) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&reaper as &dyn rusqlite::ToSql];
        params.extend(chunk.iter().map(|s| s as &dyn rusqlite::ToSql));
        conn.execute(
            &format!(
                "UPDATE memory_reaper_ledger
                 SET pending = (SELECT COALESCE(json_group_array(value), '[]')
                                FROM json_each(pending) WHERE value <> ?1)
                 WHERE memory_id IN ({placeholders})"
            ),
            params.as_slice(),
        )?;
        let params_ids: Vec<&dyn rusqlite::ToSql> =
            chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        conn.execute(
            &format!(
                "DELETE FROM memory_reaper_ledger
                 WHERE pending = '[]' AND memory_id IN ({placeholders})"
            ),
            params_ids.as_slice(),
        )?;
    }
    Ok(())
}

/// Resolve entire rows regardless of their pending set — used when the
/// existence check finds the parent alive (nothing is orphaned; the record is
/// dropped and no delete runs).
pub fn resolve_rows(conn: &Connection, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    ensure_ledger_table(conn)?;
    const CHUNK: usize = 400;
    for chunk in ids.chunks(CHUNK) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let params: Vec<&dyn rusqlite::ToSql> =
            chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        conn.execute(
            &format!("DELETE FROM memory_reaper_ledger WHERE memory_id IN ({placeholders})"),
            params.as_slice(),
        )?;
    }
    Ok(())
}

/// A reap attempt failed for these ids: count it and stamp the time, keeping
/// the debt.
pub fn record_attempt(conn: &Connection, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    ensure_ledger_table(conn)?;
    let now = chrono::Utc::now().to_rfc3339();
    const CHUNK: usize = 400;
    for chunk in ids.chunks(CHUNK) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&now as &dyn rusqlite::ToSql];
        params.extend(chunk.iter().map(|s| s as &dyn rusqlite::ToSql));
        conn.execute(
            &format!(
                "UPDATE memory_reaper_ledger
                 SET attempts = attempts + 1, last_attempt_at = ?1
                 WHERE memory_id IN ({placeholders})"
            ),
            params.as_slice(),
        )?;
    }
    Ok(())
}

/// Oldest-debt-first page of unresolved ledger rows.
pub fn pending_rows(conn: &Connection, limit: usize) -> Result<Vec<LedgerRow>, AppError> {
    ensure_ledger_table(conn)?;
    let mut stmt = conn.prepare_cached(
        "SELECT memory_id, display_name, pending, attempts FROM memory_reaper_ledger
         ORDER BY first_recorded_at ASC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |r| {
        Ok((
            r.get::<_, String>("memory_id")?,
            r.get::<_, Option<String>>("display_name")?,
            r.get::<_, String>("pending")?,
            r.get::<_, i64>("attempts")?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (memory_id, display_name, pending_json, attempts) = row?;
        let pending: Vec<String> = serde_json::from_str(&pending_json).unwrap_or_default();
        out.push(LedgerRow {
            memory_id,
            display_name,
            pending,
            attempts,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// The cascade door
// ---------------------------------------------------------------------------

/// Per-invocation bound on how much OLD ledger debt a delete door drains on
/// the side. Finishing the previous half-delete before starting a new one is
/// what makes transient outages self-healing without a scheduler; the bound
/// keeps a door from paying for an unbounded backlog.
const DOOR_DRAIN_LIMIT: usize = 256;

/// The single door-facing cascade: record the owed cleanup durably (while the
/// victims' ids and titles are still in scope), then run every registry
/// reaper fire-and-forget, resolving the ledger on success and keeping the
/// debt on failure. Callable from any build — where the reapers cannot run
/// (lite build, no recall runtime, no tokio handle) the ledger simply holds
/// the debt for the sweep.
pub fn run_memory_reapers(main_pool: &DbPool, victims: Vec<(String, Option<String>)>) {
    if victims.is_empty() {
        return;
    }
    match main_pool.conn("memory_reaper::record_owed") {
        Ok(conn) => {
            if let Err(e) = record_owed(&conn, &victims) {
                tracing::warn!(
                    count = victims.len(),
                    error = %e,
                    "memory reaper ledger write failed; dependent-side sweep is the backstop"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                count = victims.len(),
                error = %e,
                "memory reaper ledger write failed; dependent-side sweep is the backstop"
            );
        }
    }
    let ids: Vec<String> = victims.into_iter().map(|(id, _)| id).collect();
    spawn_reapers(main_pool, ids);
}

/// Run the registry reapers WITHOUT a ledger record — for doors whose parent
/// row SURVIVES (the archive path): the id stays findable relationally, so a
/// missed drop is repaired by the parent-first archived-GC sweep, and an
/// orphan-ledger record would be wrong (the drain's existence check would
/// resolve it as "parent alive" without deleting the vector).
pub fn run_memory_reapers_unledgered(main_pool: &DbPool, ids: Vec<String>) {
    if ids.is_empty() {
        return;
    }
    spawn_reapers(main_pool, ids);
}

#[cfg(feature = "ml")]
fn spawn_reapers(main_pool: &DbPool, ids: Vec<String>) {
    let Some((vec_pool, _)) = crate::memory_recall::task_recall_runtime() else {
        tracing::debug!(
            count = ids.len(),
            "memory reapers skipped (no recall runtime); ledger holds the debt"
        );
        return;
    };
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        tracing::debug!(
            count = ids.len(),
            "memory reapers skipped (no async runtime); ledger holds the debt"
        );
        return;
    };
    let main_pool = main_pool.clone();
    handle.spawn_blocking(move || {
        reap_recorded(&main_pool, &vec_pool, &ids);
        if let Err(e) = drain_ledger(&main_pool, &vec_pool, DOOR_DRAIN_LIMIT) {
            tracing::debug!(error = %e, "piggybacked ledger drain failed (next delete or sweep retries)");
        }
    });
}

#[cfg(not(feature = "ml"))]
fn spawn_reapers(_main_pool: &DbPool, ids: Vec<String>) {
    tracing::debug!(
        count = ids.len(),
        "memory reapers skipped (build without the ml feature); ledger holds the debt"
    );
}

/// Run every registry reaper over `ids` (all freshly recorded as owed),
/// resolving the ledger per reaper on success. Failures are loud and keep the
/// debt ([`record_attempt`]).
fn reap_recorded(main_pool: &DbPool, vec_pool: &UserDbPool, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    for entry in MEMORY_REAPERS {
        match (entry.run)(vec_pool, ids) {
            Ok(removed) => {
                match main_pool.conn("memory_reaper::resolve") {
                    Ok(conn) => {
                        if let Err(e) = resolve_reaper(&conn, entry.name, ids) {
                            tracing::warn!(reaper = entry.name, error = %e, "memory reaper ledger resolve failed (sweep re-checks the rows)");
                        }
                    }
                    Err(e) => {
                        tracing::warn!(reaper = entry.name, error = %e, "memory reaper ledger resolve failed (sweep re-checks the rows)");
                    }
                }
                tracing::debug!(
                    reaper = entry.name,
                    count = ids.len(),
                    removed,
                    "memory reaper completed"
                );
            }
            Err(e) => {
                if let Ok(conn) = main_pool.conn("memory_reaper::attempt") {
                    let _ = record_attempt(&conn, ids);
                }
                tracing::warn!(
                    reaper = entry.name,
                    count = ids.len(),
                    error = %e,
                    "memory reaper failed; owed cleanup stays in the ledger"
                );
            }
        }
    }
}

/// What one ledger drain found and did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct LedgerDrainReceipt {
    /// Rows examined this pass.
    pub examined: usize,
    /// Rows resolved because the parent memory EXISTS (nothing orphaned;
    /// nothing deleted) — the existence check that makes a recreated or
    /// mistyped identifier safe.
    pub resolved_alive: usize,
    /// Rows whose owed reapers were re-run to completion.
    pub reaped: usize,
    /// Rows whose reap failed again (debt kept, attempts incremented).
    pub failed: usize,
}

/// Re-run owed reapers for up to `limit` recorded orphans, oldest first.
/// Existence-checked and idempotent; safe to piggyback on any delete or tick.
pub fn drain_ledger(
    main_pool: &DbPool,
    vec_pool: &UserDbPool,
    limit: usize,
) -> Result<LedgerDrainReceipt, AppError> {
    let conn = main_pool.conn("memory_reaper::drain_ledger")?;
    let rows = pending_rows(&conn, limit)?;
    let mut receipt = LedgerDrainReceipt {
        examined: rows.len(),
        ..Default::default()
    };
    if rows.is_empty() {
        return Ok(receipt);
    }

    // Existence check: a parent that exists means nothing is orphaned — drop
    // the record, run no delete.
    let mut alive: Vec<String> = Vec::new();
    let mut owed: Vec<LedgerRow> = Vec::new();
    {
        let mut stmt =
            conn.prepare_cached("SELECT 1 FROM persona_memories WHERE id = ?1 LIMIT 1")?;
        for row in rows {
            let exists = stmt
                .query_row(params![row.memory_id], |_| Ok(()))
                .optional()?
                .is_some();
            if exists {
                alive.push(row.memory_id);
            } else {
                owed.push(row);
            }
        }
    }
    resolve_rows(&conn, &alive)?;
    receipt.resolved_alive = alive.len();

    for entry in MEMORY_REAPERS {
        let ids: Vec<String> = owed
            .iter()
            .filter(|r| r.pending.iter().any(|p| p == entry.name))
            .map(|r| r.memory_id.clone())
            .collect();
        if ids.is_empty() {
            continue;
        }
        match (entry.run)(vec_pool, &ids) {
            Ok(_removed) => {
                resolve_reaper(&conn, entry.name, &ids)?;
                receipt.reaped += ids.len();
            }
            Err(e) => {
                record_attempt(&conn, &ids)?;
                receipt.failed += ids.len();
                tracing::warn!(
                    reaper = entry.name,
                    count = ids.len(),
                    error = %e,
                    "ledger drain reap failed; debt kept"
                );
            }
        }
    }
    Ok(receipt)
}

// ---------------------------------------------------------------------------
// The dependent-side sweep
// ---------------------------------------------------------------------------

/// Whether a sweep may destroy data. Report is the default invocation shape:
/// nothing is ever removed by looking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SweepMode {
    /// Enumerate and count only; delete nothing.
    Report,
    /// Delete the orphaned dependent rows via the registry reapers.
    Apply,
}

/// The sweep's accounting. Logged even when every number is zero — a
/// reconciler whose only output is silence is indistinguishable from one that
/// never ran.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct OrphanSweepReport {
    /// True when this pass was allowed to delete.
    pub applied: bool,
    /// Distinct memory ids present in the dependent store.
    pub dependents_scanned: usize,
    /// Of those, ids whose owner no longer exists in `persona_memories`.
    pub orphaned: usize,
    /// Dependent rows actually removed (apply mode only).
    pub rows_removed: usize,
    /// Ledger drain half of the pass.
    pub ledger: LedgerDrainReceipt,
}

/// The dependent-side reconciliation: walk the vector store and ask, per
/// `memory_id`, whether its owner still exists — the direction every other
/// sweep in this tree does not run, and the only one that can find an orphan.
/// Also drains the ledger (bounded by `ledger_limit`). Idempotent: a second
/// apply finds nothing.
pub fn reconcile_memory_vector_orphans(
    main_pool: &DbPool,
    vec_pool: &UserDbPool,
    mode: SweepMode,
    ledger_limit: usize,
) -> Result<OrphanSweepReport, AppError> {
    let applied = mode == SweepMode::Apply;
    let mut report = OrphanSweepReport {
        applied,
        ..Default::default()
    };

    // Ledger first: recorded debt is cheaper and better-attributed than a
    // discovered orphan. Report mode only counts it.
    if applied {
        report.ledger = drain_ledger(main_pool, vec_pool, ledger_limit)?;
    } else {
        let conn = main_pool.conn("memory_reaper::sweep_ledger_count")?;
        report.ledger.examined = pending_rows(&conn, ledger_limit)?.len();
    }

    // Enumerate the DEPENDENT side: every distinct memory_id holding vector
    // data, from both the KNN table and its sidecar (either can exist alone
    // after a partial cleanup).
    let dependent_ids: Vec<String> = {
        let conn = vec_pool.conn("memory_reaper::sweep_enumerate")?;
        let mut arms: Vec<&str> = Vec::new();
        if table_exists(&conn, "persona_memory_embedding")? {
            arms.push("SELECT memory_id FROM persona_memory_embedding");
        }
        if table_exists(&conn, "persona_memory_embedding_meta")? {
            arms.push("SELECT memory_id FROM persona_memory_embedding_meta");
        }
        if arms.is_empty() {
            Vec::new()
        } else {
            let sql = arms.join(" UNION ");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        }
    };
    report.dependents_scanned = dependent_ids.len();

    // Existence-check each dependent id against the authoritative table,
    // chunked; in apply mode reap immediately after each chunk's check so the
    // check-to-delete window stays minimal.
    const CHUNK: usize = 400;
    let main_conn = main_pool.conn("memory_reaper::sweep_check")?;
    for chunk in dependent_ids.chunks(CHUNK) {
        let ids_json = serde_json::to_string(chunk)
            .map_err(|e| AppError::Internal(format!("orphan sweep ids serialize: {e}")))?;
        let orphans: Vec<String> = {
            let mut stmt = main_conn.prepare_cached(
                "SELECT value FROM json_each(?1)
                 WHERE value NOT IN (SELECT id FROM persona_memories)",
            )?;
            let rows = stmt.query_map(params![ids_json], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        report.orphaned += orphans.len();
        if applied && !orphans.is_empty() {
            for entry in MEMORY_REAPERS {
                report.rows_removed += (entry.run)(vec_pool, &orphans)?;
            }
            // These orphans may also have ledger rows; their debt is now paid.
            resolve_rows(&main_conn, &orphans)?;
        }
    }

    tracing::info!(
        applied = report.applied,
        dependents_scanned = report.dependents_scanned,
        orphaned = report.orphaned,
        rows_removed = report.rows_removed,
        ledger_examined = report.ledger.examined,
        ledger_resolved_alive = report.ledger.resolved_alive,
        ledger_reaped = report.ledger.reaped,
        ledger_failed = report.ledger.failed,
        "memory vector orphan sweep"
    );
    Ok(report)
}

// ---------------------------------------------------------------------------
// Tests — plain-table stand-ins for the vec tables (same names, ordinary DDL)
// so the whole surface is witnessed without the ml feature or sqlite-vec.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreatePersonaInput, CreatePersonaMemoryInput};
    use crate::repos::core::{memories, personas};
    use crate::{init_test_db, init_test_user_db};

    fn vec_pool_with_stand_ins() -> UserDbPool {
        let pool = init_test_user_db().unwrap();
        let conn = pool.conn("memory_reaper::tests").unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS persona_memory_embedding (
                 memory_id TEXT, embedding BLOB);
             CREATE TABLE IF NOT EXISTS persona_memory_embedding_meta (
                 memory_id TEXT PRIMARY KEY,
                 embedding_model TEXT NOT NULL,
                 embedding_dims INTEGER NOT NULL);",
        )
        .unwrap();
        pool
    }

    fn seed_vector(pool: &UserDbPool, memory_id: &str) {
        let conn = pool.conn("memory_reaper::tests").unwrap();
        conn.execute(
            "INSERT INTO persona_memory_embedding (memory_id, embedding) VALUES (?1, x'00')",
            params![memory_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO persona_memory_embedding_meta (memory_id, embedding_model, embedding_dims)
             VALUES (?1, 'test-model', 4)",
            params![memory_id],
        )
        .unwrap();
    }

    fn vector_rows(pool: &UserDbPool, memory_id: &str) -> i64 {
        let conn = pool.conn("memory_reaper::tests").unwrap();
        conn.query_row(
            "SELECT (SELECT COUNT(*) FROM persona_memory_embedding WHERE memory_id = ?1)
                  + (SELECT COUNT(*) FROM persona_memory_embedding_meta WHERE memory_id = ?1)",
            params![memory_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn make_persona(pool: &DbPool) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: "Reaper Test".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn memory_input(persona_id: &str, title: &str) -> CreatePersonaMemoryInput {
        CreatePersonaMemoryInput {
            persona_id: persona_id.into(),
            title: title.into(),
            content: format!("content for {title}"),
            category: None,
            source_execution_id: None,
            importance: None,
            tags: None,
            use_case_id: None,
        }
    }

    fn make_memory(pool: &DbPool, persona_id: &str, title: &str) -> String {
        memories::create(pool, memory_input(persona_id, title))
            .unwrap()
            .id
    }

    fn ledger_row(pool: &DbPool, id: &str) -> Option<LedgerRow> {
        let conn = pool.conn("memory_reaper::tests").unwrap();
        ensure_ledger_table(&conn).unwrap();
        pending_rows(&conn, 10_000)
            .unwrap()
            .into_iter()
            .find(|r| r.memory_id == id)
    }

    #[test]
    fn record_owed_upserts_and_resolve_empties() {
        let pool = init_test_db().unwrap();
        let conn = pool.conn("memory_reaper::tests").unwrap();
        record_owed(&conn, &[("m1".into(), Some("First".into()))]).unwrap();
        // Re-record merges rather than duplicates.
        record_owed(&conn, &[("m1".into(), None)]).unwrap();
        let rows = pending_rows(&conn, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pending, vec!["vector_embeddings".to_string()]);
        assert_eq!(rows[0].display_name.as_deref(), Some("First"));

        record_attempt(&conn, &["m1".into()]).unwrap();
        assert_eq!(pending_rows(&conn, 10).unwrap()[0].attempts, 1);

        // Resolving the only owed reaper resolves the record.
        resolve_reaper(&conn, "vector_embeddings", &["m1".into()]).unwrap();
        assert!(pending_rows(&conn, 10).unwrap().is_empty());
    }

    #[test]
    fn every_delete_door_records_the_owed_cleanup() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);

        // Door 1: single delete (the former crud_delete! macro).
        let m = make_memory(&pool, &persona_id, "door-delete");
        assert!(memories::delete(&pool, &m).unwrap());
        let row = ledger_row(&pool, &m).expect("delete door records the ledger");
        assert_eq!(row.pending, vec!["vector_embeddings".to_string()]);
        assert_eq!(row.display_name.as_deref(), Some("door-delete"));

        // Door 2: delete_non_core.
        let m = make_memory(&pool, &persona_id, "door-non-core");
        assert!(memories::delete_non_core(&pool, &m).unwrap());
        assert!(ledger_row(&pool, &m).is_some());

        // Door 3: batch_delete.
        let m = make_memory(&pool, &persona_id, "door-batch");
        assert_eq!(memories::batch_delete(&pool, &[m.clone()]).unwrap(), 1);
        assert!(ledger_row(&pool, &m).is_some());

        // Door 4: delete_all (non-core).
        let m = make_memory(&pool, &persona_id, "door-all");
        assert!(memories::delete_all(&pool).unwrap() >= 1);
        assert!(ledger_row(&pool, &m).is_some());

        // Door 5: merge retires both source rows.
        let a = make_memory(&pool, &persona_id, "door-merge-a");
        let b = make_memory(&pool, &persona_id, "door-merge-b");
        memories::merge(&pool, memory_input(&persona_id, "merged"), &a, &b).unwrap();
        assert!(ledger_row(&pool, &a).is_some());
        assert!(ledger_row(&pool, &b).is_some());

        // Door 6: archive drops the vector companion but the row SURVIVES, so
        // it is deliberately unledgered (the parent-first archived-GC sweep is
        // the repair path when the relational row still exists).
        let m = make_memory(&pool, &persona_id, "door-archive");
        assert_eq!(memories::archive_by_ids(&pool, &[m.clone()]).unwrap(), 1);
        assert!(ledger_row(&pool, &m).is_none());

        // Door 7: persona delete — the FK cascade destroys the memories, so
        // the door records them before the cascade runs.
        let m = make_memory(&pool, &persona_id, "door-persona-cascade");
        assert!(personas::delete(&pool, &persona_id).unwrap());
        assert!(ledger_row(&pool, &m).is_some());
    }

    #[test]
    fn drain_resolves_alive_parents_without_deleting_and_reaps_orphans() {
        let pool = init_test_db().unwrap();
        let vec_pool = vec_pool_with_stand_ins();
        let persona_id = make_persona(&pool);

        // An ALIVE memory wrongly recorded (recreated id): resolved, vector kept.
        let alive = make_memory(&pool, &persona_id, "alive");
        seed_vector(&vec_pool, &alive);
        // A genuinely destroyed memory with a surviving vector.
        let gone = "gone-memory-id".to_string();
        seed_vector(&vec_pool, &gone);
        {
            let conn = pool.conn("memory_reaper::tests").unwrap();
            record_owed(
                &conn,
                &[(alive.clone(), None), (gone.clone(), Some("Gone".into()))],
            )
            .unwrap();
        }

        let receipt = drain_ledger(&pool, &vec_pool, 100).unwrap();
        assert_eq!(receipt.examined, 2);
        assert_eq!(receipt.resolved_alive, 1);
        assert_eq!(receipt.reaped, 1);
        assert_eq!(receipt.failed, 0);
        assert_eq!(vector_rows(&vec_pool, &alive), 2, "live entity untouched");
        assert_eq!(vector_rows(&vec_pool, &gone), 0, "orphan reaped");
        assert!(ledger_row(&pool, &gone).is_none(), "debt resolved");
    }

    #[test]
    fn sweep_report_deletes_nothing_and_apply_is_idempotent() {
        let pool = init_test_db().unwrap();
        let vec_pool = vec_pool_with_stand_ins();
        let persona_id = make_persona(&pool);

        let live = make_memory(&pool, &persona_id, "live");
        seed_vector(&vec_pool, &live);
        seed_vector(&vec_pool, "orphan-1");
        seed_vector(&vec_pool, "orphan-2");

        // Report mode: full accounting, zero destruction.
        let report =
            reconcile_memory_vector_orphans(&pool, &vec_pool, SweepMode::Report, 100).unwrap();
        assert!(!report.applied);
        assert_eq!(report.dependents_scanned, 3);
        assert_eq!(report.orphaned, 2);
        assert_eq!(report.rows_removed, 0);
        assert_eq!(vector_rows(&vec_pool, "orphan-1"), 2);

        // Apply mode: exactly the orphans die; the live vector survives.
        let report =
            reconcile_memory_vector_orphans(&pool, &vec_pool, SweepMode::Apply, 100).unwrap();
        assert!(report.applied);
        assert_eq!(report.orphaned, 2);
        assert_eq!(report.rows_removed, 4); // 2 ids × (embedding + meta)
        assert_eq!(vector_rows(&vec_pool, &live), 2);
        assert_eq!(vector_rows(&vec_pool, "orphan-1"), 0);
        assert_eq!(vector_rows(&vec_pool, "orphan-2"), 0);

        // Idempotent: a second apply finds nothing left.
        let report =
            reconcile_memory_vector_orphans(&pool, &vec_pool, SweepMode::Apply, 100).unwrap();
        assert_eq!(report.dependents_scanned, 1);
        assert_eq!(report.orphaned, 0);
        assert_eq!(report.rows_removed, 0);
    }

    #[test]
    fn sweep_survives_an_unprovisioned_vector_store() {
        let pool = init_test_db().unwrap();
        let vec_pool = init_test_user_db().unwrap(); // no vec tables at all
        let report =
            reconcile_memory_vector_orphans(&pool, &vec_pool, SweepMode::Report, 100).unwrap();
        assert_eq!(report.dependents_scanned, 0);
        assert_eq!(report.orphaned, 0);
    }
}
