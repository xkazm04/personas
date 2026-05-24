//! Repository for `owned_devices` — the registry of a user's own paired devices,
//! plus the `local_identity.device_group_id` ownership anchor. See ADR
//! 2026-05-24-cross-device-persona-continuity (Stage 2).
//!
//! Pure data layer (not `p2p`-gated) so it is unit-testable in lite builds. The
//! `commands/network/owned_devices.rs` wrappers (which ARE `p2p`-gated) call into
//! these functions.

use crate::db::models::OwnedDevice;
use crate::db::DbPool;
use crate::error::AppError;

/// Return the local device-group id, generating and persisting one on first use.
///
/// The group id is the shared anchor that marks a set of peers as "the same
/// user's devices". A pairing flow shares it out-of-band (QR/PIN); both devices
/// then store the same value so each can recognise the other as its own.
pub fn ensure_device_group_id(pool: &DbPool) -> Result<String, AppError> {
    let conn = pool.get()?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT device_group_id FROM local_identity WHERE id = 1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional_flatten();

    if let Some(id) = existing {
        return Ok(id);
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    let affected = conn.execute(
        "UPDATE local_identity SET device_group_id = ?1 WHERE id = 1",
        rusqlite::params![new_id],
    )?;
    if affected == 0 {
        // No identity row yet — identity initialization (engine/identity.rs) must
        // run before a device group can be anchored. Erroring here (rather than
        // returning an unpersisted id) keeps the group id stable across calls.
        return Err(AppError::Internal(
            "local identity not initialized; cannot assign a device group".into(),
        ));
    }
    Ok(new_id)
}

/// Register (or update) a peer as one of the user's own devices. Idempotent on
/// `peer_id`; re-registering refreshes the group and display name and preserves
/// `last_synced_at`.
pub fn register_owned_device(
    pool: &DbPool,
    peer_id: &str,
    device_group_id: &str,
    display_name: &str,
) -> Result<OwnedDevice, AppError> {
    if peer_id.trim().is_empty() {
        return Err(AppError::Validation("peer_id must not be empty".into()));
    }
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO owned_devices (peer_id, device_group_id, display_name, added_at, last_synced_at)
         VALUES (?1, ?2, ?3, ?4, NULL)
         ON CONFLICT(peer_id) DO UPDATE SET
            device_group_id = excluded.device_group_id,
            display_name    = excluded.display_name",
        rusqlite::params![peer_id, device_group_id, display_name, now],
    )?;
    get_owned_device(pool, peer_id)?
        .ok_or_else(|| AppError::Internal("owned device vanished after insert".into()))
}

/// Fetch a single owned device by peer id.
pub fn get_owned_device(pool: &DbPool, peer_id: &str) -> Result<Option<OwnedDevice>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT peer_id, device_group_id, display_name, added_at, last_synced_at
             FROM owned_devices WHERE peer_id = ?1",
            rusqlite::params![peer_id],
            map_owned_device,
        )
        .optional()?;
    Ok(row)
}

/// List all of the user's own devices, most-recently-added first.
pub fn list_owned_devices(pool: &DbPool) -> Result<Vec<OwnedDevice>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT peer_id, device_group_id, display_name, added_at, last_synced_at
         FROM owned_devices ORDER BY added_at DESC",
    )?;
    let rows = stmt
        .query_map([], map_owned_device)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Remove a device from the user's registry. Returns `true` if a row was deleted.
pub fn forget_owned_device(pool: &DbPool, peer_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let affected = conn.execute(
        "DELETE FROM owned_devices WHERE peer_id = ?1",
        rusqlite::params![peer_id],
    )?;
    Ok(affected > 0)
}

/// Record that a sync round with this device just completed.
pub fn mark_synced(pool: &DbPool, peer_id: &str, at: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE owned_devices SET last_synced_at = ?2 WHERE peer_id = ?1",
        rusqlite::params![peer_id, at],
    )?;
    Ok(())
}

fn map_owned_device(row: &rusqlite::Row<'_>) -> rusqlite::Result<OwnedDevice> {
    Ok(OwnedDevice {
        peer_id: row.get(0)?,
        device_group_id: row.get(1)?,
        display_name: row.get(2)?,
        added_at: row.get(3)?,
        last_synced_at: row.get(4)?,
    })
}

/// Small ergonomic helpers for `query_row`'s `Option` handling.
trait OptionalRow<T> {
    fn optional(self) -> Result<Option<T>, AppError>;
}
impl<T> OptionalRow<T> for rusqlite::Result<T> {
    fn optional(self) -> Result<Option<T>, AppError> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    }
}

trait OptionalFlatten<T> {
    /// Collapse a `query_row` returning `Option<T>` plus a possible no-rows error
    /// into a single `Option<T>`.
    fn optional_flatten(self) -> Option<T>;
}
impl<T> OptionalFlatten<T> for rusqlite::Result<Option<T>> {
    fn optional_flatten(self) -> Option<T> {
        self.ok().flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:owned_devices_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("initial migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
            // Seed the singleton identity row that engine/identity.rs would create
            // at runtime, so the device-group anchor has something to attach to.
            conn.execute(
                "INSERT INTO local_identity (id, peer_id, public_key, display_name)
                 VALUES (1, 'test-peer', X'00', 'Test Device')",
                [],
            )
            .expect("seed local_identity");
        }
        pool
    }

    #[test]
    fn device_group_id_is_stable_after_first_generation() {
        let pool = test_pool();
        let first = ensure_device_group_id(&pool).expect("first");
        let second = ensure_device_group_id(&pool).expect("second");
        assert_eq!(first, second, "group id must persist, not regenerate");
        assert!(!first.is_empty());
    }

    #[test]
    fn register_list_forget_roundtrip() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");

        let dev = register_owned_device(&pool, "peerA", &group, "Laptop").expect("register");
        assert_eq!(dev.peer_id, "peerA");
        assert_eq!(dev.device_group_id, group);
        assert!(dev.last_synced_at.is_none());

        let list = list_owned_devices(&pool).expect("list");
        assert_eq!(list.len(), 1);

        assert!(forget_owned_device(&pool, "peerA").expect("forget"));
        assert!(list_owned_devices(&pool).expect("list2").is_empty());
        assert!(!forget_owned_device(&pool, "peerA").expect("forget-again"));
    }

    #[test]
    fn register_is_idempotent_and_updates_name() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_owned_device(&pool, "peerA", &group, "Old Name").expect("first");
        mark_synced(&pool, "peerA", "2026-05-24T12:00:00Z").expect("mark");
        let updated = register_owned_device(&pool, "peerA", &group, "New Name").expect("second");

        assert_eq!(list_owned_devices(&pool).expect("list").len(), 1);
        assert_eq!(updated.display_name, "New Name");
        assert_eq!(
            updated.last_synced_at.as_deref(),
            Some("2026-05-24T12:00:00Z"),
            "re-register must preserve last_synced_at"
        );
    }

    #[test]
    fn empty_peer_id_is_rejected() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        assert!(register_owned_device(&pool, "  ", &group, "x").is_err());
    }
}
