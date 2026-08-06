//! Repository for `owned_devices` — the registry of a user's own paired devices,
//! plus the `local_identity.device_group_id` ownership anchor. See ADR
//! 2026-05-24-cross-device-persona-continuity (Stage 2).
//!
//! Pure data layer (not `p2p`-gated) so it is unit-testable in lite builds. The
//! `commands/network/owned_devices.rs` wrappers (which ARE `p2p`-gated) call into
//! these functions.

use crate::models::OwnedDevice;
use crate::DbPool;
use personas_core::error::AppError;

/// Return the local device-group id, generating and persisting one on first use.
///
/// The group id is the shared anchor that marks a set of peers as "the same
/// user's devices". A pairing flow shares it out-of-band (QR/PIN); both devices
/// then store the same value so each can recognise the other as its own.
pub fn ensure_device_group_id(pool: &DbPool) -> Result<String, AppError> {
    let conn = pool.get()?;

    // Fast path: already anchored.
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

    // First-time anchor — must be atomic. The previous read→generate→
    // unconditional-UPDATE was a race: two concurrent first-time callers (e.g.
    // the pairing flow and the UI loading the Network tab) both read NULL,
    // generated DIFFERENT uuids, and both UPDATEd id=1. The one that returned
    // first handed its uuid to the pairing partner out-of-band, but the DB kept
    // the other writer's uuid — permanently desyncing the device group with no
    // error to debug. Fix: a conditional UPDATE that only the first writer wins
    // (SQLite serializes the write), then re-SELECT the persisted value so EVERY
    // caller returns the single id that actually landed in the DB.
    let candidate = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "UPDATE local_identity SET device_group_id = ?1 WHERE id = 1 AND device_group_id IS NULL",
        rusqlite::params![candidate],
    )?;

    let persisted: Option<String> = conn
        .query_row(
            "SELECT device_group_id FROM local_identity WHERE id = 1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional_flatten();

    match persisted {
        // The committed value — either our `candidate` (we won) or a racing
        // caller's id (they won; our conditional UPDATE matched 0 rows). Both
        // callers converge here.
        Some(id) => Ok(id),
        // Still NULL only when there is no identity row to anchor to. Identity
        // initialization (engine/identity.rs) must run first; erroring (rather
        // than returning an unpersisted id) keeps the group id stable.
        None => Err(AppError::Internal(
            "local identity not initialized; cannot assign a device group".into(),
        )),
    }
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

/// Record a device that completed the signed pairing ceremony.
///
/// Same idempotency contract as [`register_owned_device`], plus the pairing
/// facts: `paired_at` (now) and the peer's Ed25519 `public_key` as proven during
/// the handshake. `is_home` is deliberately NOT set here — a freshly paired
/// device defaults to false and only becomes home via [`set_device_home`].
pub fn register_paired_device(
    pool: &DbPool,
    peer_id: &str,
    device_group_id: &str,
    display_name: &str,
    public_key_b64: &str,
) -> Result<OwnedDevice, AppError> {
    if peer_id.trim().is_empty() {
        return Err(AppError::Validation("peer_id must not be empty".into()));
    }
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO owned_devices
            (peer_id, device_group_id, display_name, added_at, last_synced_at, is_home, paired_at, public_key)
         VALUES (?1, ?2, ?3, ?4, NULL, 0, ?4, ?5)
         ON CONFLICT(peer_id) DO UPDATE SET
            device_group_id = excluded.device_group_id,
            display_name    = excluded.display_name,
            paired_at       = excluded.paired_at,
            public_key      = excluded.public_key",
        rusqlite::params![peer_id, device_group_id, display_name, now, public_key_b64],
    )?;
    get_owned_device(pool, peer_id)?
        .ok_or_else(|| AppError::Internal("owned device vanished after insert".into()))
}

/// Nominate (or un-nominate) a device as the user's home machine.
///
/// Setting `is_home = true` clears the flag on every other row first, so the
/// "home device" is always singular. Returns the updated row.
pub fn set_device_home(
    pool: &DbPool,
    peer_id: &str,
    is_home: bool,
) -> Result<OwnedDevice, AppError> {
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    if is_home {
        // Clear first — the partial unique index on `is_home = 1` would
        // otherwise reject the second home before we ever demote the first.
        tx.execute(
            "UPDATE owned_devices SET is_home = 0 WHERE peer_id <> ?1 AND is_home = 1",
            rusqlite::params![peer_id],
        )?;
    }
    let affected = tx.execute(
        "UPDATE owned_devices SET is_home = ?2 WHERE peer_id = ?1",
        rusqlite::params![peer_id, is_home as i32],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "No owned device with peer_id {peer_id}"
        )));
    }
    tx.commit()?;
    get_owned_device(pool, peer_id)?
        .ok_or_else(|| AppError::Internal("owned device vanished after update".into()))
}

/// Overwrite the local device-group anchor (used when a pairing responder joins
/// the initiator's existing group). Returns the value that landed.
pub fn set_device_group_id(pool: &DbPool, device_group_id: &str) -> Result<String, AppError> {
    if device_group_id.trim().is_empty() {
        return Err(AppError::Validation(
            "device_group_id must not be empty".into(),
        ));
    }
    let conn = pool.get()?;
    let affected = conn.execute(
        "UPDATE local_identity SET device_group_id = ?1 WHERE id = 1",
        rusqlite::params![device_group_id],
    )?;
    if affected == 0 {
        return Err(AppError::Internal(
            "local identity not initialized; cannot assign a device group".into(),
        ));
    }
    Ok(device_group_id.to_string())
}

/// Fetch a single owned device by peer id.
pub fn get_owned_device(pool: &DbPool, peer_id: &str) -> Result<Option<OwnedDevice>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT peer_id, device_group_id, display_name, added_at, last_synced_at,
                    is_home, paired_at, public_key
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
        "SELECT peer_id, device_group_id, display_name, added_at, last_synced_at,
                is_home, paired_at, public_key
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
        is_home: row.get::<_, i64>(5)? != 0,
        paired_at: row.get(6)?,
        public_key: row.get(7)?,
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
            crate::migrations::run(&conn).expect("initial migrations");
            crate::migrations::run_incremental(&conn).expect("incremental migrations");
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

    #[test]
    fn paired_device_defaults_to_not_home_and_records_pairing_facts() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        let dev = register_paired_device(&pool, "peerA", &group, "Laptop", "PUBKEYB64")
            .expect("register paired");
        assert!(!dev.is_home, "a freshly paired device must not be home");
        assert!(dev.paired_at.is_some(), "paired_at must be stamped");
        assert_eq!(dev.public_key.as_deref(), Some("PUBKEYB64"));
    }

    #[test]
    fn set_device_home_toggles_and_stays_singular() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");

        let a = set_device_home(&pool, "peerA", true).expect("home A");
        assert!(a.is_home);

        // Promoting B must demote A — exactly one home at any time.
        let b = set_device_home(&pool, "peerB", true).expect("home B");
        assert!(b.is_home);
        let homes: Vec<String> = list_owned_devices(&pool)
            .expect("list")
            .into_iter()
            .filter(|d| d.is_home)
            .map(|d| d.peer_id)
            .collect();
        assert_eq!(homes, vec!["peerB".to_string()]);

        // And it toggles back off.
        let b = set_device_home(&pool, "peerB", false).expect("unhome B");
        assert!(!b.is_home);
        assert!(list_owned_devices(&pool)
            .expect("list")
            .iter()
            .all(|d| !d.is_home));
    }

    #[test]
    fn set_device_home_on_unknown_peer_is_not_found() {
        let pool = test_pool();
        assert!(set_device_home(&pool, "ghost", true).is_err());
    }

    /// The pairing-column migration must be safe to replay: `run_incremental`
    /// runs on every launch, and an ALTER TABLE that is not column-guarded
    /// aborts startup with "duplicate column name" the second time around.
    #[test]
    fn pairing_columns_migration_is_idempotent() {
        let pool = test_pool();
        let conn = pool.get().expect("conn");
        for _ in 0..3 {
            crate::migrations::run_incremental(&conn).expect("replay incremental migrations");
        }
        // Columns present exactly once, and the table still reads.
        drop(conn);
        let group = ensure_device_group_id(&pool).expect("group");
        let dev = register_paired_device(&pool, "peerA", &group, "Laptop", "k").expect("register");
        assert!(!dev.is_home);
    }
}
