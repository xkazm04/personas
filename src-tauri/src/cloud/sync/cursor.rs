//! Per-table incremental sync cursors + the enable flag + device identity,
//! all persisted in the `app_settings` key/value table.

use chrono::Utc;

use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// Whether cloud sync is enabled for this install (default off).
pub fn is_enabled(pool: &DbPool) -> bool {
    settings::get(pool, settings_keys::CLOUD_SYNC_ENABLED)
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
}

/// Toggle cloud sync on/off.
pub fn set_enabled(pool: &DbPool, enabled: bool) -> Result<(), AppError> {
    settings::set(
        pool,
        settings_keys::CLOUD_SYNC_ENABLED,
        if enabled { "true" } else { "false" },
    )
}

/// Read the incremental cursor for `cursor_name`. On first run the cursor is
/// absent: config tables (`full_backfill = true`) start at the epoch so the
/// entire table syncs; append-heavy log tables start 90 days back so the first
/// sync is bounded (per the chosen backfill policy).
pub fn get_cursor(pool: &DbPool, cursor_name: &str, full_backfill: bool) -> String {
    let key = format!("{}{}", settings_keys::CLOUD_SYNC_CURSOR_PREFIX, cursor_name);
    if let Ok(Some(v)) = settings::get(pool, &key) {
        if !v.is_empty() {
            return v;
        }
    }
    if full_backfill {
        "1970-01-01T00:00:00Z".to_string()
    } else {
        (Utc::now() - chrono::Duration::days(90)).to_rfc3339()
    }
}

/// Advance the cursor for `cursor_name` to `value` (RFC3339).
pub fn set_cursor(pool: &DbPool, cursor_name: &str, value: &str) -> Result<(), AppError> {
    let key = format!("{}{}", settings_keys::CLOUD_SYNC_CURSOR_PREFIX, cursor_name);
    settings::set(pool, &key, value)
}

/// Read the raw cursor value for `cursor_name` without substituting a backfill
/// default. Returns `None` when the table has never synced — used by the status
/// surface to show "never synced" rather than the epoch/90d-ago placeholder.
pub fn peek_cursor(pool: &DbPool, cursor_name: &str) -> Option<String> {
    let key = format!("{}{}", settings_keys::CLOUD_SYNC_CURSOR_PREFIX, cursor_name);
    settings::get(pool, &key).ok().flatten().filter(|v| !v.is_empty())
}

/// Record the last successful sync time (RFC3339), surfaced in the status command.
pub fn set_last_at(pool: &DbPool, value: &str) -> Result<(), AppError> {
    settings::set(pool, settings_keys::CLOUD_SYNC_LAST_AT, value)
}

/// Read the last successful sync time, if any.
pub fn get_last_at(pool: &DbPool) -> Option<String> {
    settings::get(pool, settings_keys::CLOUD_SYNC_LAST_AT)
        .ok()
        .flatten()
}

/// Lifetime count of rows pushed across all passes (0 when unset/malformed).
pub fn get_total_rows(pool: &DbPool) -> u64 {
    settings::get(pool, settings_keys::CLOUD_SYNC_TOTAL_ROWS)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

/// Add `delta` to the lifetime row counter (saturating). No-op when `delta` is 0.
pub fn add_total_rows(pool: &DbPool, delta: u64) -> Result<(), AppError> {
    if delta == 0 {
        return Ok(());
    }
    let next = get_total_rows(pool).saturating_add(delta);
    settings::set(pool, settings_keys::CLOUD_SYNC_TOTAL_ROWS, &next.to_string())
}

/// Read the persisted device id without minting one. Returns `None` before the
/// first sync (the status surface shows nothing rather than forcing an id).
pub fn peek_device_id(pool: &DbPool) -> Option<String> {
    settings::get(pool, settings_keys::CLOUD_SYNC_DEVICE_ID)
        .ok()
        .flatten()
        .filter(|v| !v.is_empty())
}

/// A stable per-device identifier used to tag synced rows with their origin.
/// Persisted (and minted on first use) in `app_settings`, so it survives
/// restarts and works in builds without the p2p identity table.
pub fn resolve_device_id(pool: &DbPool) -> String {
    if let Ok(Some(v)) = settings::get(pool, settings_keys::CLOUD_SYNC_DEVICE_ID) {
        if !v.is_empty() {
            return v;
        }
    }
    let new_id = uuid::Uuid::new_v4().to_string();
    let _ = settings::set(pool, settings_keys::CLOUD_SYNC_DEVICE_ID, &new_id);
    new_id
}
