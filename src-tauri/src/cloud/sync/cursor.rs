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
