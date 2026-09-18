//! Persona tombstones — the delete half of cloud sync.
//!
//! `persona_tombstones` (DDL in `migrations/incremental/e06_teams_and_sync.rs`)
//! is the record that a persona that once existed locally has been deleted.
//! The cloud-sync pass reads it (`cloud::sync::rows::fetch_tombstones`) and
//! cascade-deletes the persona's projection, because a one-way row mirror can
//! only ever ADD rows: without a tombstone the cloud copy of a deleted persona
//! lives forever and the dashboard keeps showing it (resurrection).
//!
//! The table was created and read from the day it landed but nothing ever
//! INSERTed into it, so delete propagation was structurally dead. The single
//! writer is [`record_in`], called from inside `personas::delete`'s
//! transaction — one delete, one tombstone, atomically, for every delete path
//! (single, draft cleanup, bulk) because they all funnel through that one fn.

use rusqlite::{params, Transaction};

use crate::settings_keys;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Fallback origin tag for a tombstone written before cloud sync has ever run
/// (and therefore before a device id has been minted). The column is NOT NULL
/// and the value is only ever an origin *label* — the cascade keys on
/// `persona_id` — so a placeholder is strictly better than failing the delete.
const UNKNOWN_DEVICE: &str = "unknown";

/// Read the persisted cloud-sync device id through an open transaction.
/// Deliberately does NOT mint one: minting belongs to the sync pass, and a
/// delete must not create sync state as a side effect.
fn device_id_in(tx: &Transaction<'_>) -> String {
    tx.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![settings_keys::CLOUD_SYNC_DEVICE_ID],
        |r| r.get::<_, String>("value"),
    )
    .ok()
    .filter(|v| !v.is_empty())
    .unwrap_or_else(|| UNKNOWN_DEVICE.to_string())
}

/// Record a persona deletion inside the caller's transaction.
///
/// The conflict is targeted at `persona_id` (the primary key) rather than
/// spelled `INSERT OR REPLACE`: a persona id can be re-created and re-deleted,
/// and the newest `deleted_at` is the one the cursor-driven sync pass must see.
/// `DO UPDATE` moves that watermark forward without deleting and re-inserting
/// the row, and it still RAISES a NOT NULL violation where the statement-wide
/// form would swallow it.
pub(crate) fn record_in(tx: &Transaction<'_>, persona_id: &str) -> Result<(), AppError> {
    let device_id = device_id_in(tx);
    tx.execute(
        "INSERT INTO persona_tombstones (persona_id, deleted_at, device_id) \
         VALUES (?1, datetime('now'), ?2) \
         ON CONFLICT(persona_id) DO UPDATE SET \
           deleted_at = excluded.deleted_at, device_id = excluded.device_id",
        params![persona_id, device_id],
    )?;
    Ok(())
}

/// Whether a tombstone exists for this persona. Read surface for tests and for
/// callers that need to tell "never existed" from "deleted".
pub fn exists(pool: &DbPool, persona_id: &str) -> Result<bool, AppError> {
    timed_query!("persona_tombstones", "persona_tombstones::exists", {
        let conn = pool.conn("persona_tombstones::exists")?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM persona_tombstones WHERE persona_id = ?1",
            params![persona_id],
            |r| r.get("n"),
        )?;
        Ok(n > 0)
    })
}

/// Total tombstones on record. Used by the sync status surface and tests.
pub fn count(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!("persona_tombstones", "persona_tombstones::count", {
        let conn = pool.conn("persona_tombstones::count")?;
        let n: i64 = conn.query_row("SELECT COUNT(*) AS n FROM persona_tombstones", [], |r| {
            r.get("n")
        })?;
        Ok(n)
    })
}
