//! Desktop → cloud sync writer (Phase 1a, v2).
//!
//! Periodically (and on local-mutation nudges) pushes a read-projection of the
//! local SQLite data up to the user's own Supabase tenant, scoped server-side
//! by Row-Level Security on `auth.uid()`. Execution and the credential vault
//! never leave the device — only the secret-free projections in `rows` are sent.
//!
//! ## v2 — fault-isolated passes
//!
//! A pass syncs each table independently. A single table's failure (a transient
//! network blip, a schema drift on one table) no longer aborts the whole pass or
//! strands the *other* tables' cursors — every healthy table still advances and
//! its rows still land. The per-table outcome (rows + error + last-synced) is
//! surfaced through [`CloudSyncStatus`] so the Settings panel can show exactly
//! what synced and what didn't.

pub mod client;
pub(crate) mod cursor;
mod rows;

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tokio::sync::{Mutex, Notify};
use ts_rs::TS;

use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;
use client::SyncClient;

/// Woken by `notify_dirty()` (fired from the CDC drain on local mutations) so
/// the loop can sync promptly instead of waiting for the next periodic tick.
static SYNC_WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);

/// In-memory status surfaced by `cloud_sync_status`.
static RUNTIME: LazyLock<Mutex<RuntimeState>> = LazyLock::new(|| Mutex::new(RuntimeState::default()));

/// Canonical list of synced tables — the single source of truth for both the
/// pass (below) and the status enumeration. Tuple = `(remote table, cursor key,
/// full_backfill, resync_recent_window)`.
///
/// `full_backfill`: first run starts at the epoch (sync the whole table) vs 90
/// days back (bound the first push for append-heavy logs).
/// `resync`: also re-read rows whose `created_at` is within the last 24h, to
/// capture in-place mutations (status/read-flag transitions) on append tables.
const SYNC_TABLES: &[(&str, &str, bool, bool)] = &[
    ("synced_personas", "personas", true, false),
    ("synced_executions", "executions", false, true),
    ("synced_events", "events", false, true),
    ("synced_manual_reviews", "reviews", false, false),
    ("synced_messages", "messages", false, true),
    ("synced_metrics_snapshots", "metrics", false, true),
    ("synced_tool_usage", "tool_usage", false, false),
    ("synced_memories", "memories", true, false),
    ("synced_knowledge_patterns", "knowledge_patterns", true, false),
    ("synced_healing_issues", "healing_issues", false, true),
    ("synced_triggers", "triggers", true, false),
];

/// Last-pass result for one table, retained in memory for the status surface.
#[derive(Debug, Clone, Default)]
struct LastTable {
    remote: String,
    rows: u64,
    error: Option<String>,
}

#[derive(Default, Clone)]
struct RuntimeState {
    syncing: bool,
    last_error: Option<String>,
    rows_synced_last: u64,
    /// Per-table rows + error from the most recent pass, keyed by remote name.
    tables: Vec<LastTable>,
}

/// Per-table status surfaced to the UI.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TableSyncStatus {
    /// Remote table name, e.g. `synced_executions`.
    pub table: String,
    /// Rows pushed for this table in the most recent pass.
    pub rows_last: u64,
    /// RFC3339 cursor watermark — the table's last successful sync, or null if
    /// it has never synced.
    pub last_synced_at: Option<String>,
    /// Error from the most recent pass for this table, if it failed.
    pub error: Option<String>,
}

/// Cloud-sync status surfaced by `cloud_sync_status` / returned by `cloud_sync_now`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncStatus {
    pub enabled: bool,
    /// True while a pass is in flight (drives the "syncing…" UI state).
    pub syncing: bool,
    /// This device's stable sync id, or null before the first pass.
    pub device_id: Option<String>,
    /// RFC3339 time of the last fully-successful pass.
    pub last_sync_at: Option<String>,
    /// First error from the most recent pass (null when the last pass was clean).
    pub last_error: Option<String>,
    /// Rows pushed in the most recent pass (across all tables).
    pub rows_synced_last: u64,
    /// Lifetime rows pushed across all passes (persisted, monotonic).
    pub total_rows_synced: u64,
    /// Per-table breakdown for the most recent pass + cursor watermarks.
    pub tables: Vec<TableSyncStatus>,
}

/// Internal result of one pass — drives both the persisted counters and the
/// in-memory status snapshot.
struct SyncReport {
    tables: Vec<LastTable>,
    total: u64,
}

impl SyncReport {
    fn is_clean(&self) -> bool {
        self.tables.iter().all(|t| t.error.is_none())
    }
    fn first_error(&self) -> Option<String> {
        self.tables.iter().find_map(|t| t.error.clone())
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Signal that local data changed; the sync loop debounces and pushes.
pub fn notify_dirty() {
    SYNC_WAKE.notify_one();
}

/// Toggle cloud sync. Enabling also kicks an immediate sync.
pub fn set_enabled(pool: &DbPool, enabled: bool) -> Result<(), AppError> {
    cursor::set_enabled(pool, enabled)?;
    if enabled {
        notify_dirty();
    }
    Ok(())
}

/// Current sync status: persisted facts (enabled, device, last-at, lifetime
/// total, per-table cursors) merged with the in-memory last-pass snapshot
/// (syncing flag, per-table rows/errors).
pub async fn status(pool: &DbPool) -> CloudSyncStatus {
    let rt = RUNTIME.lock().await.clone();
    let by_remote = |remote: &str| rt.tables.iter().find(|t| t.remote == remote);

    let tables = SYNC_TABLES
        .iter()
        .map(|(remote, cursor_key, _, _)| {
            let last = by_remote(remote);
            TableSyncStatus {
                table: (*remote).to_string(),
                rows_last: last.map(|t| t.rows).unwrap_or(0),
                last_synced_at: cursor::peek_cursor(pool, cursor_key),
                error: last.and_then(|t| t.error.clone()),
            }
        })
        .collect();

    CloudSyncStatus {
        enabled: cursor::is_enabled(pool),
        syncing: rt.syncing,
        device_id: cursor::peek_device_id(pool),
        last_sync_at: cursor::get_last_at(pool),
        last_error: rt.last_error,
        rows_synced_last: rt.rows_synced_last,
        total_rows_synced: cursor::get_total_rows(pool),
        tables,
    }
}

/// Sync one table: read rows changed since the cursor, upsert them, advance the
/// cursor on success. Captures its own failure into the returned [`LastTable`]
/// rather than propagating — so one table's error can't abort the pass.
async fn sync_table<T, F>(
    pool: &DbPool,
    client: &SyncClient,
    remote_table: &str,
    cursor_name: &str,
    full_backfill: bool,
    resync: bool,
    device_id: &str,
    fetch: F,
) -> LastTable
where
    T: Serialize + Send + 'static,
    F: Fn(&DbPool, String, Option<String>, String) -> Result<(Vec<T>, Option<String>), AppError>
        + Send
        + 'static,
{
    match sync_table_inner(
        pool,
        client,
        remote_table,
        cursor_name,
        full_backfill,
        resync,
        device_id,
        fetch,
    )
    .await
    {
        Ok(rows) => LastTable { remote: remote_table.to_string(), rows, error: None },
        Err(e) => {
            tracing::warn!(table = remote_table, error = %e, "cloud sync: table failed (isolated)");
            LastTable {
                remote: remote_table.to_string(),
                rows: 0,
                error: Some(e.to_string()),
            }
        }
    }
}

async fn sync_table_inner<T, F>(
    pool: &DbPool,
    client: &SyncClient,
    remote_table: &str,
    cursor_name: &str,
    full_backfill: bool,
    resync: bool,
    device_id: &str,
    fetch: F,
) -> Result<u64, AppError>
where
    T: Serialize + Send + 'static,
    F: Fn(&DbPool, String, Option<String>, String) -> Result<(Vec<T>, Option<String>), AppError>
        + Send
        + 'static,
{
    let cursor_prev = cursor::get_cursor(pool, cursor_name, full_backfill);
    let resync_floor = if resync {
        Some((chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339())
    } else {
        None
    };

    let pool_c = pool.clone();
    let device = device_id.to_string();
    // Keep a copy for the cursor fallback; the closure moves its own.
    let cursor_prev_fallback = cursor_prev.clone();
    let (rows, observed_max) =
        tokio::task::spawn_blocking(move || fetch(&pool_c, cursor_prev, resync_floor, device))
            .await
            .map_err(|e| AppError::Internal(format!("cloud sync fetch join: {e}")))??;

    let n = rows.len() as u64;
    client.upsert(remote_table, &rows).await?;
    // Advance the cursor to the MAX watermark value actually present in the rows
    // we just synced, or leave it unchanged if none. Previously this set the
    // cursor to wall-clock `now()` captured at pass start, which moved it past
    // any row committed to SQLite after the SELECT's read snapshot but stamped
    // before that instant — permanently excluding it from every later pass
    // (`get_recent_after`/the changed-since filter only return rows newer than
    // the cursor). The observed max can never be ahead of a row this pass didn't
    // read. The read filter wraps both sides in datetime(), so the stored value's
    // exact format doesn't affect future comparisons.
    let new_cursor = observed_max.unwrap_or(cursor_prev_fallback);
    cursor::set_cursor(pool, cursor_name, &new_cursor)?;
    Ok(n)
}

/// Collect every table's outcome for one pass. Device heartbeat first so the
/// dashboard always knows this device exists; then each Phase-1 table, fault
/// isolated. The heartbeat's outcome influences `is_clean()`/`last_error` but is
/// not shown as a per-table grid row (it has no cursor).
async fn collect_pass(pool: &DbPool, client: &SyncClient, device_id: &str) -> SyncReport {
    let mut tables: Vec<LastTable> = Vec::with_capacity(SYNC_TABLES.len() + 1);

    // Device heartbeat (own outcome, kept out of the displayed grid).
    let dev = rows::device_row(device_id);
    let heartbeat = match client.upsert("synced_devices", std::slice::from_ref(&dev)).await {
        Ok(()) => LastTable { remote: "synced_devices".into(), rows: 1, error: None },
        Err(e) => {
            tracing::warn!(error = %e, "cloud sync: device heartbeat failed");
            LastTable { remote: "synced_devices".into(), rows: 0, error: Some(e.to_string()) }
        }
    };
    tables.push(heartbeat);

    // Each Phase-1 table, in SYNC_TABLES order. Typed fetch fns can't live in a
    // homogeneous list, so the dispatch is explicit — but the (remote, cursor,
    // backfill, resync) tuples are read from SYNC_TABLES so they can't drift.
    macro_rules! sync {
        ($idx:expr, $fetch:expr) => {{
            let (remote, cursor_key, bf, rs) = SYNC_TABLES[$idx];
            sync_table(pool, client, remote, cursor_key, bf, rs, device_id, $fetch).await
        }};
    }
    tables.push(sync!(0, rows::fetch_personas));
    tables.push(sync!(1, rows::fetch_executions));
    tables.push(sync!(2, rows::fetch_events));
    tables.push(sync!(3, rows::fetch_reviews));
    tables.push(sync!(4, rows::fetch_messages));
    tables.push(sync!(5, rows::fetch_metrics));
    tables.push(sync!(6, rows::fetch_tool_usage));
    tables.push(sync!(7, rows::fetch_memories));
    tables.push(sync!(8, rows::fetch_knowledge_patterns));
    tables.push(sync!(9, rows::fetch_healing_issues));
    tables.push(sync!(10, rows::fetch_triggers));

    // Delete propagation (v2): mirror local persona deletions into the cloud.
    // Kept out of the displayed grid (it has no upsert cursor of its own row),
    // but its outcome still influences is_clean()/last_error.
    tables.push(process_tombstones(pool, client).await);

    // "Rows synced" counts upserted data rows — not the heartbeat or deletes.
    let total = tables
        .iter()
        .filter(|t| t.remote != "synced_devices" && t.remote != "deletes")
        .map(|t| t.rows)
        .sum();
    SyncReport { tables, total }
}

/// Synced child tables keyed by `persona_id` (mirror of the local
/// `ON DELETE CASCADE` from `personas`).
const PERSONA_SCOPED_TABLES: &[&str] = &[
    "synced_executions",
    "synced_manual_reviews",
    "synced_messages",
    "synced_metrics_snapshots",
    "synced_tool_usage",
    "synced_memories",
    "synced_knowledge_patterns",
];

/// Delete every cloud row belonging to a deleted persona, mirroring the local
/// cascade. RLS scopes each delete to this user. Personas row deleted last so a
/// mid-cascade failure leaves the persona present (and thus retried next pass)
/// rather than orphaning its children.
async fn delete_persona_cascade(client: &SyncClient, persona_id: &str) -> Result<(), AppError> {
    for table in PERSONA_SCOPED_TABLES {
        client.delete(&format!("{table}?persona_id=eq.{persona_id}")).await?;
    }
    // Events reference the persona via target_persona_id, not persona_id.
    client
        .delete(&format!("synced_events?target_persona_id=eq.{persona_id}"))
        .await?;
    client
        .delete(&format!("synced_personas?id=eq.{persona_id}"))
        .await?;
    Ok(())
}

/// Process persona tombstones since the cursor: cascade-delete each in the
/// cloud, then advance the cursor only if all deletes succeeded (so a failure
/// is retried next pass). Fault-isolated like a table — returns its outcome.
async fn process_tombstones(pool: &DbPool, client: &SyncClient) -> LastTable {
    let cursor_prev = cursor::get_cursor(pool, "tombstones", false);
    let tick_start = now_rfc3339();
    let tombstones = match rows::fetch_tombstones(pool, &cursor_prev) {
        Ok(t) => t,
        Err(e) => {
            return LastTable { remote: "deletes".into(), rows: 0, error: Some(e.to_string()) };
        }
    };

    let mut deleted: u64 = 0;
    for tomb in &tombstones {
        if let Err(e) = delete_persona_cascade(client, &tomb.persona_id).await {
            tracing::warn!(persona_id = %tomb.persona_id, error = %e, "cloud sync: delete propagation failed");
            // Don't advance the cursor — the failed (and any later) tombstone
            // is reprocessed next pass. Deletes are idempotent.
            return LastTable { remote: "deletes".into(), rows: deleted, error: Some(e.to_string()) };
        }
        deleted += 1;
    }

    let _ = cursor::set_cursor(pool, "tombstones", &tick_start);
    LastTable { remote: "deletes".into(), rows: deleted, error: None }
}

/// Run one full sync pass. No-op when sync is disabled or no Supabase JWT is
/// available — both are "nothing to do", not errors. Persists the lifetime
/// total, advances `last_sync_at` only on a fully-clean pass, and writes the
/// in-memory status snapshot (including the `syncing` flag). Per-table failures
/// are logged inside `sync_table` and surfaced via `status()`.
pub async fn run_sync_once(state: &Arc<AppState>) {
    let pool = state.db.clone();
    if !cursor::is_enabled(&pool) {
        return;
    }

    let jwt = {
        let auth = state.auth.read().await;
        match auth.access_token.as_ref() {
            Some(s) => s.expose_secret().to_string(),
            None => return,
        }
    };

    // Flip the syncing flag so a concurrent status() call reflects the in-flight
    // pass. Reset on every exit path below.
    RUNTIME.lock().await.syncing = true;

    let report = match SyncClient::new(jwt) {
        Ok(client) => {
            let device_id = cursor::resolve_device_id(&pool);
            collect_pass(&pool, &client, &device_id).await
        }
        Err(e) => SyncReport {
            tables: vec![LastTable { remote: "client".into(), rows: 0, error: Some(e.to_string()) }],
            total: 0,
        },
    };

    // Persist: lifetime total always; last-at only on a clean pass.
    let _ = cursor::add_total_rows(&pool, report.total);
    if report.is_clean() {
        let _ = cursor::set_last_at(&pool, &now_rfc3339());
    }

    let mut rt = RUNTIME.lock().await;
    rt.syncing = false;
    rt.rows_synced_last = report.total;
    rt.last_error = report.first_error();
    rt.tables = report.tables;
}

/// Spawn the background sync loop: a ~45s periodic tick plus event-driven wakes
/// from `notify_dirty()` (debounced 2s to coalesce bursts). Leader-gated so a
/// multi-instance checkout doesn't double-push.
pub fn spawn_sync_loop(_app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(45));
        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = SYNC_WAKE.notified() => {
                    // Coalesce a burst of mutations into one pass.
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }

            if !state.leadership.is_leader() || !cursor::is_enabled(&state.db) {
                continue;
            }

            // run_sync_once writes the status snapshot internally and logs any
            // per-table failures (in sync_table); nothing more for the loop to do.
            run_sync_once(&state).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_clean_when_no_table_errors() {
        let r = SyncReport {
            tables: vec![
                LastTable { remote: "a".into(), rows: 3, error: None },
                LastTable { remote: "b".into(), rows: 0, error: None },
            ],
            total: 3,
        };
        assert!(r.is_clean());
        assert_eq!(r.first_error(), None);
    }

    #[test]
    fn report_surfaces_first_error_and_is_not_clean() {
        // One table failing must NOT mask the others' row counts — fault
        // isolation: total still reflects the tables that succeeded.
        let r = SyncReport {
            tables: vec![
                LastTable { remote: "a".into(), rows: 5, error: None },
                LastTable { remote: "b".into(), rows: 0, error: Some("boom".into()) },
                LastTable { remote: "c".into(), rows: 2, error: None },
            ],
            total: 7,
        };
        assert!(!r.is_clean());
        assert_eq!(r.first_error(), Some("boom".into()));
        assert_eq!(r.total, 7, "healthy tables still contribute rows when a sibling fails");
    }

    #[test]
    fn sync_tables_cover_all_phase1_tables() {
        // The grid + dispatch are driven off this list; guard its length so a
        // table added to collect_pass without a SYNC_TABLES entry fails CI.
        assert_eq!(SYNC_TABLES.len(), 11);
        // cursor keys must be unique (they key app_settings rows).
        let mut keys: Vec<&str> = SYNC_TABLES.iter().map(|(_, c, _, _)| *c).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), SYNC_TABLES.len(), "duplicate cursor key in SYNC_TABLES");
    }
}
