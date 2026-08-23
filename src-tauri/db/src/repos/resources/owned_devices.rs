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

/// Move the local device-group anchor to `proposed_group_id`, refusing when the
/// move would strand devices this machine is already paired with.
///
/// The anchor is a single value in `local_identity`, but every row in
/// `owned_devices` carries the group it was registered under. Re-anchoring does
/// NOT rewrite those rows, so a device that already has peers under group `G`
/// and then adopts group `H` silently splits its group in two: the peers keep
/// pointing at `G` while this machine now claims `H`. That is the fragmentation
/// this guard exists to prevent.
///
/// A group counts as populated only through *other* devices:
/// - the local machine has no `owned_devices` row of its own, and any row that
///   ever matched `local_identity.peer_id` is excluded defensively;
/// - `pairing_peer_id` is excluded too, because [`register_paired_device`]
///   rewrites exactly that row to the new group in the same ceremony, so it
///   cannot be stranded. Re-pairing a peer that moved groups therefore still
///   works when it is this machine's only paired device.
///
/// Returns [`AppError::DeviceGroupConflict`] when the move is unsafe, with the
/// stranded devices named and the remedy stated. Nothing is written in that
/// case.
///
/// This is the *local* half of the decision and it is deliberately blind to what
/// the peer claims: it answers only "may this machine leave its group?".
/// [`resolve_pairing_group`] adds the peer's side and can resolve a would-be
/// refusal into a counter-offer — but every write still goes through here, so no
/// remote claim can talk this machine into stranding its own devices.
pub fn join_device_group(
    pool: &DbPool,
    proposed_group_id: &str,
    pairing_peer_id: &str,
) -> Result<String, AppError> {
    if proposed_group_id.trim().is_empty() {
        return Err(AppError::Validation(
            "device_group_id must not be empty".into(),
        ));
    }
    let conn = pool.get()?;

    // No anchor yet, or already anchored where we are being asked to go: nothing
    // can be left behind, so the join is a no-op or a first-time anchor.
    if let Some(current) = current_group_id(&conn).filter(|c| c != proposed_group_id) {
        let stranded = other_devices_in_group(&conn, &current, pairing_peer_id)?;
        if !stranded.is_empty() {
            return Err(group_conflict(&stranded));
        }
    }

    drop(conn);
    set_device_group_id(pool, proposed_group_id)
}

/// Read the local device-group anchor without creating one.
fn current_group_id(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT device_group_id FROM local_identity WHERE id = 1",
        [],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional_flatten()
}

/// Devices in `group_id` that leaving it would strand, newest first.
///
/// The exclusions ARE the definition of "at stake" and every caller must use
/// exactly these two: the local machine's own identity row (it cannot strand
/// itself) and `pairing_peer_id` (the ceremony rewrites that row to the surviving
/// group in the same breath, so it moves with us).
fn other_devices_in_group(
    conn: &rusqlite::Connection,
    group_id: &str,
    pairing_peer_id: &str,
) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT display_name FROM owned_devices
         WHERE device_group_id = ?1
           AND peer_id <> ?2
           AND peer_id <> COALESCE((SELECT peer_id FROM local_identity WHERE id = 1), '')
         ORDER BY added_at DESC",
    )?;
    let names = stmt
        .query_map(rusqlite::params![group_id, pairing_peer_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names)
}

fn group_conflict(stranded: &[String]) -> AppError {
    AppError::DeviceGroupConflict(format!(
        "Pairing refused: this device already belongs to a device group that also contains {}. \
         Joining the other device's group would strand those devices. \
         Unpair them here, or unpair the conflicting devices on the other side, then pair again.",
        summarize_names(stranded)
    ))
}

/// How many devices the local group would strand if this machine left it — the
/// number the pairing ceremony puts on the wire so the other side can tell
/// "nothing at stake" from "devices at stake".
///
/// Uses the same exclusions as [`join_device_group`]; returns 0 when there is no
/// anchor yet.
pub fn count_devices_at_stake(pool: &DbPool, pairing_peer_id: &str) -> Result<u32, AppError> {
    let conn = pool.get()?;
    let Some(current) = current_group_id(&conn) else {
        return Ok(0);
    };
    Ok(other_devices_in_group(&conn, &current, pairing_peer_id)?.len() as u32)
}

/// Which group survives a pairing ceremony, decided from this machine's point of
/// view. See [`resolve_pairing_group`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroupResolution {
    /// The peer's group wins: this machine re-anchors onto it.
    Adopt(String),
    /// Counter-offer — this machine's group wins and the peer must adopt it.
    /// Chosen when we have devices at stake and the peer says it has none.
    Keep(String),
}

/// Decide the single surviving device group for a pairing, WITHOUT writing.
///
/// Two devices can only end up in one group, and re-anchoring never rewrites the
/// `owned_devices` rows a machine already holds — so whichever side re-anchors
/// strands whatever it was already paired with. The resolution therefore turns
/// on which side has anything at stake:
///
/// | local has devices | peer claims devices | outcome |
/// |---|---|---|
/// | no  | no  | `Adopt` — the peer's group wins (the initiator's group is the deterministic tie-break, because the responder is always the side running this) |
/// | no  | yes | `Adopt` — nothing here to strand |
/// | yes | no  | `Keep` — counter-offer; the peer adopts ours |
/// | yes | yes | [`AppError::DeviceGroupConflict`] — neither side can move |
///
/// Same group on both sides is idempotent and always resolves to `Adopt`.
///
/// **`peer_has_devices` is an UNTRUSTED claim off the network.** It can only ever
/// push this machine toward *keeping* its own group or refusing — never toward
/// abandoning devices it holds, because the "can we leave?" half is answered
/// locally from `owned_devices`. A peer that lies "I have nothing" gets a
/// counter-offer, not a re-anchor; a peer that lies "I have devices" only denies
/// itself the pairing. The caller must still route the surviving group through
/// [`join_device_group`] before writing, so the local predicate is the last word
/// on both sides of the wire.
pub fn resolve_pairing_group(
    pool: &DbPool,
    proposed_group_id: &str,
    pairing_peer_id: &str,
    peer_has_devices: bool,
) -> Result<GroupResolution, AppError> {
    if proposed_group_id.trim().is_empty() {
        return Err(AppError::Validation(
            "device_group_id must not be empty".into(),
        ));
    }
    let conn = pool.get()?;
    let Some(current) = current_group_id(&conn).filter(|c| c != proposed_group_id) else {
        // No anchor yet, or already where we are being asked to go.
        return Ok(GroupResolution::Adopt(proposed_group_id.to_string()));
    };
    let stranded = other_devices_in_group(&conn, &current, pairing_peer_id)?;
    if stranded.is_empty() {
        return Ok(GroupResolution::Adopt(proposed_group_id.to_string()));
    }
    if peer_has_devices {
        return Err(group_conflict(&stranded));
    }
    Ok(GroupResolution::Keep(current))
}

/// Render a device-name list for an operator-facing message: at most three
/// names, then a count for the rest.
fn summarize_names(names: &[String]) -> String {
    const SHOWN: usize = 3;
    let head = names
        .iter()
        .take(SHOWN)
        .map(|n| format!("\"{n}\""))
        .collect::<Vec<_>>()
        .join(", ");
    if names.len() > SHOWN {
        format!("{head} and {} more", names.len() - SHOWN)
    } else {
        head
    }
}

/// Overwrite the local device-group anchor. Prefer [`join_device_group`] on any
/// path where the new group comes from a peer: this function is the unguarded
/// primitive and will happily strand already-paired devices.
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

    // -- join_device_group: the anti-fragmentation guard --------------------
    //
    // Re-anchoring never rewrites the `owned_devices` rows we already hold, so
    // the only question that matters is "would anyone be left behind?".

    /// The common case: a device with nothing paired yet joins an existing
    /// group. Nothing can be stranded, so it must simply anchor.
    #[test]
    fn join_group_from_an_empty_group_succeeds() {
        let pool = test_pool();
        let own = ensure_device_group_id(&pool).expect("group");
        let theirs = "their-group-id";

        let landed = join_device_group(&pool, theirs, "peerA").expect("fresh device joins");
        assert_eq!(landed, theirs);
        assert_ne!(landed, own, "the anchor really moved");
        assert_eq!(ensure_device_group_id(&pool).expect("re-read"), theirs);
    }

    /// Neither side has anything paired. Same outcome, but pinned separately so
    /// a future guard cannot start requiring a non-empty registry.
    #[test]
    fn join_group_with_both_registries_empty_succeeds() {
        let pool = test_pool();
        ensure_device_group_id(&pool).expect("group");
        assert!(list_owned_devices(&pool).expect("list").is_empty());
        assert!(join_device_group(&pool, "fresh-group", "peerA").is_ok());
    }

    /// Re-pairing devices that already share a group is idempotent: the anchor
    /// is unchanged, and a populated registry must NOT trip the guard.
    #[test]
    fn join_same_group_is_idempotent_even_when_populated() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");

        let landed = join_device_group(&pool, &group, "peerA").expect("same-group re-pair");
        assert_eq!(landed, group);
        assert_eq!(ensure_device_group_id(&pool).expect("re-read"), group);
    }

    /// The refusal. Two populated groups cannot be merged by re-anchoring, so
    /// the join is rejected with a typed error that names what would be
    /// stranded and what to do about it -- and writes nothing.
    #[test]
    fn join_different_populated_group_is_refused_with_a_typed_conflict() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");

        let err = join_device_group(&pool, "other-group", "peerC")
            .expect_err("a populated group must not be silently abandoned");
        assert!(
            matches!(err, AppError::DeviceGroupConflict(_)),
            "expected a typed DeviceGroupConflict, got {err:?}"
        );
        let msg = err.to_string();
        assert!(msg.contains("Laptop") && msg.contains("Desktop"), "{msg}");
        assert!(
            msg.contains("Unpair"),
            "the remedy must be in the message: {msg}"
        );

        assert_eq!(
            ensure_device_group_id(&pool).expect("re-read"),
            group,
            "a refused join must not move the anchor"
        );
    }

    /// The device being paired with is not "left behind" -- the same ceremony
    /// rewrites its row to the new group. So a machine whose only paired device
    /// is the one re-pairing can still follow it into another group.
    #[test]
    fn join_ignores_the_peer_being_paired() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");

        assert!(
            join_device_group(&pool, "moved-group", "peerA").is_ok(),
            "the only paired device is the one asking; nothing is stranded"
        );
        // A *second* device under the old group flips the same call to a refusal.
        let pool2 = test_pool();
        let group2 = ensure_device_group_id(&pool2).expect("group");
        register_paired_device(&pool2, "peerA", &group2, "Laptop", "kA").expect("A");
        register_paired_device(&pool2, "peerB", &group2, "Phone", "kB").expect("B");
        assert!(join_device_group(&pool2, "moved-group", "peerA").is_err());
    }

    /// The local device is not a member of its own registry, but if a row ever
    /// matched `local_identity.peer_id` it must not make the group look
    /// populated -- the local machine cannot strand itself.
    #[test]
    fn join_does_not_count_the_local_device_as_populating_the_group() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        // `test_pool` seeds local_identity.peer_id = 'test-peer'.
        register_paired_device(&pool, "test-peer", &group, "This Machine", "kSelf").expect("self");

        assert!(
            join_device_group(&pool, "other-group", "peerZ").is_ok(),
            "our own row must not block a join"
        );
    }

    // -- resolve_pairing_group: the counter-offer ---------------------------

    /// The new case. WE have devices at stake, the peer has none, and the groups
    /// differ -- so the ceremony must resolve toward US: we keep our group and
    /// the peer adopts it. Refusing here (the old behavior) is what made a third
    /// device impossible to add.
    #[test]
    fn counter_offer_keeps_our_group_when_the_peer_has_nothing_at_stake() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");

        let outcome = resolve_pairing_group(&pool, "their-group", "peerC", false)
            .expect("a peer with nothing at stake must be counter-offered, not refused");
        assert_eq!(outcome, GroupResolution::Keep(group.clone()));
        assert_eq!(
            ensure_device_group_id(&pool).expect("re-read"),
            group,
            "resolving must not move the anchor by itself"
        );
    }

    /// Row 1 of the table: nobody has anything at stake. The tie-break is
    /// "the proposing side's group wins", which on the responder (the only side
    /// that runs this) means the initiator's group survives.
    #[test]
    fn resolve_with_neither_side_populated_adopts_the_proposed_group() {
        let pool = test_pool();
        ensure_device_group_id(&pool).expect("group");
        assert_eq!(
            resolve_pairing_group(&pool, "their-group", "peerA", false).expect("resolve"),
            GroupResolution::Adopt("their-group".into())
        );
    }

    /// Row 2: only the peer has devices at stake, so we move. Today's behavior,
    /// pinned so the counter-offer cannot accidentally invert it.
    #[test]
    fn resolve_adopts_when_only_the_peer_has_devices() {
        let pool = test_pool();
        ensure_device_group_id(&pool).expect("group");
        assert_eq!(
            resolve_pairing_group(&pool, "their-group", "peerA", true).expect("resolve"),
            GroupResolution::Adopt("their-group".into())
        );
    }

    /// Row 4: both sides populated. Still a typed refusal, still naming the
    /// devices and the remedy -- merging two populated groups remains out of
    /// scope for this primitive.
    #[test]
    fn resolve_refuses_when_both_sides_have_devices() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");

        let err = resolve_pairing_group(&pool, "their-group", "peerC", true)
            .expect_err("two populated groups cannot merge");
        assert!(
            matches!(err, AppError::DeviceGroupConflict(_)),
            "expected a typed DeviceGroupConflict, got {err:?}"
        );
        let msg = err.to_string();
        assert!(msg.contains("Laptop") && msg.contains("Desktop"), "{msg}");
        assert!(msg.contains("Unpair"), "the remedy must survive: {msg}");
    }

    /// Same group on both sides stays idempotent regardless of what the peer
    /// claims -- there is nothing to resolve, so neither claim can trip a guard.
    #[test]
    fn resolve_same_group_is_idempotent_for_either_claim() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");

        for claim in [false, true] {
            assert_eq!(
                resolve_pairing_group(&pool, &group, "peerA", claim).expect("same-group"),
                GroupResolution::Adopt(group.clone()),
                "same-group re-pair must resolve to itself (peer claim: {claim})"
            );
        }
    }

    /// SECURITY. `peer_has_devices` is an unauthenticated claim off the wire, so
    /// a hostile peer will claim whatever gets us to move. It must not be able
    /// to: the "may we leave?" half is answered from our own `owned_devices`,
    /// and `join_device_group` -- which every write goes through -- re-checks it.
    /// A lying "I have nothing at stake" therefore yields a counter-offer, never
    /// a re-anchor.
    #[test]
    fn a_lying_peer_cannot_make_us_strand_our_own_devices() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");

        // The lie: "my group is empty, come join me".
        let outcome = resolve_pairing_group(&pool, "attacker-group", "peerC", false)
            .expect("a claim of emptiness is answered, not obeyed");
        assert_eq!(
            outcome,
            GroupResolution::Keep(group.clone()),
            "we must counter-offer, never adopt, while we hold devices"
        );
        assert_eq!(
            ensure_device_group_id(&pool).expect("re-read"),
            group,
            "the anchor must not have moved"
        );

        // And the write path itself refuses independently, so even a caller that
        // ignored the resolution cannot strand the devices.
        assert!(
            matches!(
                join_device_group(&pool, "attacker-group", "peerC"),
                Err(AppError::DeviceGroupConflict(_))
            ),
            "the local guard must hold regardless of any remote claim"
        );
        assert_eq!(ensure_device_group_id(&pool).expect("re-read"), group);
    }

    /// The count that goes on the wire must use the ceremony's exclusions: our
    /// own identity row never counts, and neither does the peer we are pairing
    /// with (its row moves with us).
    #[test]
    fn devices_at_stake_applies_the_pairing_exclusions() {
        let pool = test_pool();
        let group = ensure_device_group_id(&pool).expect("group");
        assert_eq!(count_devices_at_stake(&pool, "peerA").expect("empty"), 0);

        register_paired_device(&pool, "peerA", &group, "Laptop", "kA").expect("A");
        assert_eq!(
            count_devices_at_stake(&pool, "peerA").expect("only the pairing peer"),
            0,
            "the peer being paired with is not at stake"
        );

        // `test_pool` seeds local_identity.peer_id = 'test-peer'.
        register_paired_device(&pool, "test-peer", &group, "This Machine", "kSelf").expect("self");
        assert_eq!(
            count_devices_at_stake(&pool, "peerA").expect("self excluded"),
            0,
            "our own row must never count as a device at stake"
        );

        register_paired_device(&pool, "peerB", &group, "Desktop", "kB").expect("B");
        assert_eq!(count_devices_at_stake(&pool, "peerA").expect("B counts"), 1);

        // A device under some other group is not ours to strand.
        register_paired_device(&pool, "peerD", "unrelated-group", "Tablet", "kD").expect("D");
        assert_eq!(count_devices_at_stake(&pool, "peerA").expect("scoped"), 1);
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
