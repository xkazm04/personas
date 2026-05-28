//! Desktop → cloud sync writer (Phase 1a).
//!
//! Periodically (and on local-mutation nudges) pushes a read-projection of the
//! local SQLite data up to the user's own Supabase tenant, scoped server-side
//! by Row-Level Security on `auth.uid()`. Execution and the credential vault
//! never leave the device — only the secret-free projections in `rows` are sent.

pub mod client;
mod cursor;
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

#[derive(Default, Clone)]
struct RuntimeState {
    last_error: Option<String>,
    rows_synced_last: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncStatus {
    pub enabled: bool,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub rows_synced_last: u64,
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

/// Current sync status (enabled flag + last run telemetry).
pub async fn status(pool: &DbPool) -> CloudSyncStatus {
    let rt = RUNTIME.lock().await.clone();
    CloudSyncStatus {
        enabled: cursor::is_enabled(pool),
        last_sync_at: cursor::get_last_at(pool),
        last_error: rt.last_error,
        rows_synced_last: rt.rows_synced_last,
    }
}

/// Generic per-table pass: read rows changed since the cursor, upsert them, and
/// advance the cursor to the tick start on success. `cursor_name` keys the
/// persisted watermark; `full_backfill` controls the first-run cursor default;
/// `resync` enables the recent-window re-read for tables that mutate in place.
async fn sync_table<T, F>(
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
    F: Fn(&DbPool, String, Option<String>, String) -> Result<Vec<T>, AppError> + Send + 'static,
{
    let cursor_prev = cursor::get_cursor(pool, cursor_name, full_backfill);
    let tick_start = chrono::Utc::now().to_rfc3339();
    let resync_floor = if resync {
        Some((chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339())
    } else {
        None
    };

    let pool_c = pool.clone();
    let device = device_id.to_string();
    let rows = tokio::task::spawn_blocking(move || fetch(&pool_c, cursor_prev, resync_floor, device))
        .await
        .map_err(|e| AppError::Internal(format!("cloud sync fetch join: {e}")))??;

    let n = rows.len() as u64;
    client.upsert(remote_table, &rows).await?;
    cursor::set_cursor(pool, cursor_name, &tick_start)?;
    Ok(n)
}

/// Run one full sync pass over every Phase-1 table. Returns the number of rows
/// pushed. No-op (returns 0) when sync is disabled or no Supabase JWT is
/// available — the loop treats both as "nothing to do", not an error.
pub async fn run_sync_once(state: &Arc<AppState>) -> Result<u64, AppError> {
    let pool = state.db.clone();
    if !cursor::is_enabled(&pool) {
        return Ok(0);
    }

    let jwt = {
        let auth = state.auth.read().await;
        match auth.access_token.as_ref() {
            Some(s) => s.expose_secret().to_string(),
            None => return Ok(0),
        }
    };

    let client = SyncClient::new(jwt)?;
    let device_id = cursor::resolve_device_id(&pool);

    // Device heartbeat first, so the dashboard always knows this device exists.
    let dev = rows::device_row(&device_id);
    client.upsert("synced_devices", std::slice::from_ref(&dev)).await?;

    let mut total: u64 = 0;
    total += sync_table(&pool, &client, "synced_personas", "personas", true, false, &device_id, rows::fetch_personas).await?;
    total += sync_table(&pool, &client, "synced_executions", "executions", false, true, &device_id, rows::fetch_executions).await?;
    total += sync_table(&pool, &client, "synced_events", "events", false, true, &device_id, rows::fetch_events).await?;
    total += sync_table(&pool, &client, "synced_manual_reviews", "reviews", false, false, &device_id, rows::fetch_reviews).await?;
    total += sync_table(&pool, &client, "synced_messages", "messages", false, true, &device_id, rows::fetch_messages).await?;
    total += sync_table(&pool, &client, "synced_metrics_snapshots", "metrics", false, true, &device_id, rows::fetch_metrics).await?;
    total += sync_table(&pool, &client, "synced_tool_usage", "tool_usage", false, false, &device_id, rows::fetch_tool_usage).await?;

    let _ = cursor::set_last_at(&pool, &chrono::Utc::now().to_rfc3339());
    Ok(total)
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

            match run_sync_once(&state).await {
                Ok(n) => {
                    let mut rt = RUNTIME.lock().await;
                    rt.last_error = None;
                    rt.rows_synced_last = n;
                }
                Err(e) => {
                    tracing::warn!(error = %e, "cloud sync tick failed");
                    let mut rt = RUNTIME.lock().await;
                    rt.last_error = Some(e.to_string());
                }
            }
        }
    });
}
