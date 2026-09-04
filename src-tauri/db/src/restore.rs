//! The door back: turning the backup sets [`crate::backup`] already keeps into
//! a recovery the product can offer.
//!
//! [`crate::backup`] snapshots the store before every boot of an existing
//! database and [`crate::damage`] quarantines it when its canonical structure
//! is damaged, so the good copies stop being rotated away. Neither of them
//! gives the operator a way back: the recovery story was a doc comment telling
//! them to copy the newest backup over `personas.db` by hand, choosing among
//! files in a directory the product never shows them and whose state they
//! cannot inspect. A backup the product cannot offer back is disk usage, not
//! recovery.
//!
//! This module adds three things and no policy:
//!
//! - **A list with a state column.** [`list_backup_sets`] enumerates every set
//!   under `<data_dir>/backups/` with its timestamp, size and a *probed*
//!   verdict — each set is opened read-only and run through
//!   `PRAGMA quick_check(1)`, the same probe [`crate::damage`] trusts at open.
//!   Every set is listed, including the ones that fail: a list that silently
//!   drops the bad ones reads as "you only ever had two backups". The verdict
//!   carries the name of the probe that produced it ([`BackupSet::probe`]),
//!   because `quick_check` is not `integrity_check` and a column that will not
//!   say what it ran is a column that can lie quietly.
//! - **A state to reach the operator from.** [`offer_for`] answers "is this
//!   boot one that ended with no way forward?" — quarantined, or a live store
//!   that fails the probe — and returns the reason together with the list. A
//!   healthy store returns `None`; that is the control.
//! - **A restore that runs where a copy is safe.** [`request_restore`] does
//!   NOT copy anything. It writes the chosen set's path to a marker beside the
//!   store, and [`apply_pending_restore`] performs the copy on the next boot,
//!   from `init_db`, BEFORE any connection opens the file — the same
//!   precondition that makes the snapshot in [`crate::backup`] consistent
//!   (`backup.rs:46-49`). By the time a dialog could return, boot holds a pool
//!   of twelve connections; copying over the file underneath them is how a
//!   damaged store becomes an unopenable one.
//!
//! What this module deliberately does not do: it never restores on its own. A
//! restore discards every write since the snapshot, and that is the operator's
//! decision, never boot's. Nothing here clears a quarantine except an applied
//! restore — the file is then genuinely a different file.

use std::path::{Path, PathBuf};

use crate::backup::{BACKUP_DIR_NAME, SIDECAR_SUFFIXES};
use crate::sidecar_path;

/// Sidecar suffix of the deferred-restore request. A file beside the store for
/// the same reason the quarantine marker is one: it has to be readable before
/// any connection opens a database that may not open at all.
const PENDING_SUFFIX: &str = ".restore-pending";

/// Probed verdict on one backup set. Three-way, because "not usable" and "not
/// readable at all" are different things to an operator staring at a list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SetState {
    /// The probe ran and reported `ok`.
    Readable,
    /// The probe ran and reported damage.
    Damaged,
    /// The probe could not run — the file would not open at all.
    Unreadable,
}

/// One backup set (the `.db` plus whatever siblings it kept), as an
/// operator-facing row.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupSet {
    pub path: PathBuf,
    pub name: String,
    /// When the snapshot was taken, from the name's UTC stamp.
    pub taken_at: String,
    pub size_bytes: u64,
    /// A `-wal` sibling came with the set, so its restore carries the tail of
    /// the session that was interrupted.
    pub has_wal: bool,
    pub state: SetState,
    /// The probe that produced `state`, named. `quick_check` verifies page and
    /// B-tree structure but skips index content, so a set marked readable here
    /// can still fail a full `integrity_check`.
    pub probe: &'static str,
}

/// A boot that ended with no way forward, plus what it can be offered.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RestoreOffer {
    pub db_path: PathBuf,
    /// Why the store is not usable, in the words the detector recorded.
    pub reason: String,
    pub detected_at: String,
    /// Newest first. An empty list is still an offer: it tells the operator
    /// the history is gone, which is a different fact from silence.
    pub sets: Vec<BackupSet>,
}

impl RestoreOffer {
    /// The default selection: the newest set the probe could read.
    pub fn newest_readable(&self) -> Option<&BackupSet> {
        self.sets.iter().find(|s| s.state == SetState::Readable)
    }
}

/// Where [`crate::backup`] keeps its sets.
pub fn backup_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(BACKUP_DIR_NAME)
}

/// Every backup set under `<app_data_dir>/backups/`, newest first, each probed.
///
/// Sorting is descending on the file name, which is chronological for the
/// `personas-<stamp>-<nn>.db` scheme (see `backup.rs`).
pub fn list_backup_sets(app_data_dir: &Path) -> Vec<BackupSet> {
    let dir = backup_dir(app_data_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut sets: Vec<BackupSet> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().is_some_and(|x| x == "db")
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("personas-"))
        })
        .map(|path| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let (state, probe) = probe_state(&path);
            BackupSet {
                taken_at: taken_at_from_name(&name),
                size_bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                has_wal: sidecar_path(&path, "-wal").exists(),
                name,
                path,
                state,
                probe,
            }
        })
        .collect();
    sets.sort_by(|a, b| b.name.cmp(&a.name));
    sets
}

/// Open `path` read-only and run the integrity probe. Returns the verdict and
/// the name of the probe that produced it.
///
/// A set that kept a `-wal` sibling cannot always be opened read-only (SQLite
/// needs to create the `-shm` index), so the fallback opens it `immutable`,
/// which ignores the WAL. That is a narrower check and it is reported as such
/// rather than silently passed off as the same one.
fn probe_state(path: &Path) -> (SetState, &'static str) {
    use rusqlite::OpenFlags;
    const PLAIN: &str = "PRAGMA quick_check(1)";
    const IMMUTABLE: &str = "PRAGMA quick_check(1), immutable open (WAL not replayed)";

    let read_only = OpenFlags::SQLITE_OPEN_READ_ONLY;
    match rusqlite::Connection::open_with_flags(path, read_only) {
        Ok(conn) => (verdict(&conn), PLAIN),
        Err(_) => {
            let uri = format!(
                "file:{}?immutable=1",
                path.to_string_lossy().replace('\\', "/")
            );
            match rusqlite::Connection::open_with_flags(uri, read_only | OpenFlags::SQLITE_OPEN_URI)
            {
                Ok(conn) => (verdict(&conn), IMMUTABLE),
                Err(_) => (SetState::Unreadable, IMMUTABLE),
            }
        }
    }
}

fn verdict(conn: &rusqlite::Connection) -> SetState {
    // By column name, not position: the pragma's single result column is named
    // after the pragma itself, and a name cannot shift under an index.
    match conn.query_row("PRAGMA quick_check(1)", [], |r| {
        r.get::<_, String>("quick_check")
    }) {
        Ok(v) if v.eq_ignore_ascii_case("ok") => SetState::Readable,
        Ok(_) => SetState::Damaged,
        // The probe itself failed. The file opened and then would not answer:
        // that is damage, not an absent file.
        Err(_) => SetState::Damaged,
    }
}

/// `personas-20260903-142207-00.db` -> `2026-09-03T14:22:07Z`. Falls back to
/// the raw name, which is never worse than an invented timestamp.
fn taken_at_from_name(name: &str) -> String {
    name.strip_prefix("personas-")
        .and_then(|rest| rest.get(..15))
        .and_then(|stamp| {
            chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%d-%H%M%S")
                .ok()
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        })
        .unwrap_or_else(|| name.to_string())
}

/// Is this a boot that ended with no way forward? `Some` means the operator
/// has to be shown a choice; `None` means the store is usable and no restore
/// surface should ever appear.
///
/// Two sources, in order: the quarantine [`crate::damage`] recorded (this
/// process, or a marker a previous session left), and — for the case where the
/// store is so damaged that `init_db` fails before anything can be recorded —
/// the same probe run against the live store.
pub fn offer_for(app_data_dir: &Path, db_path: &Path) -> Option<RestoreOffer> {
    let (reason, detected_at) = match crate::damage::quarantine_status(db_path) {
        Some(report) => (report.reason, report.detected_at),
        None => match marker_report(db_path) {
            Some(pair) => pair,
            None => {
                if !db_path.exists() {
                    return None;
                }
                let (state, probe) = probe_state(db_path);
                if state == SetState::Readable {
                    return None;
                }
                (
                    format!("the store failed its integrity probe ({probe})"),
                    chrono::Utc::now().to_rfc3339(),
                )
            }
        },
    };
    Some(RestoreOffer {
        db_path: db_path.to_path_buf(),
        reason,
        detected_at,
        sets: list_backup_sets(app_data_dir),
    })
}

/// The quarantine marker a previous session left, as (reason, detected_at).
fn marker_report(db_path: &Path) -> Option<(String, String)> {
    let raw = std::fs::read_to_string(crate::damage::marker_path(db_path)).ok()?;
    let mut lines = raw.lines();
    let detected_at = lines.next()?.to_string();
    let reason = lines
        .next()
        .unwrap_or("a previous session quarantined this store");
    Some((reason.to_string(), detected_at))
}

/// Path of the deferred-restore request for `db_path`.
pub fn pending_path(db_path: &Path) -> PathBuf {
    sidecar_path(db_path, PENDING_SUFFIX)
}

/// Ask for `set` to be restored over `db_path` on the next boot.
///
/// Records the choice; copies nothing. The copy happens in
/// [`apply_pending_restore`], before any connection opens the store.
pub fn request_restore(db_path: &Path, set: &Path) -> std::io::Result<()> {
    if !set.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("no such backup set: {}", set.display()),
        ));
    }
    std::fs::write(pending_path(db_path), format!("{}\n", set.display()))?;
    tracing::warn!(
        set = %set.display(),
        db = %db_path.display(),
        "Restore requested — the chosen backup will be copied over the store on the next boot"
    );
    Ok(())
}

/// Withdraw a pending restore. Declining leaves the store exactly as
/// [`crate::damage`] left it.
pub fn cancel_restore(db_path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(pending_path(db_path)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// The set a pending restore names, if any.
pub fn pending_restore(db_path: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(pending_path(db_path)).ok()?;
    let chosen = PathBuf::from(raw.trim());
    (!chosen.as_os_str().is_empty()).then_some(chosen)
}

/// Honour a pending restore. Called from `init_db` AFTER the pre-migration
/// snapshot and BEFORE the pool opens: the snapshot means the file being
/// replaced is itself preserved (a restore is not a deletion), and the closed
/// pool means the copy is safe.
///
/// Returns the name of the set that was restored, so the caller can name it if
/// the restored store also fails to open — a second failure, not the same list
/// offered again with no acknowledgement that the first choice was tried.
pub(crate) fn apply_pending_restore(db_path: &Path) -> Option<String> {
    let chosen = pending_restore(db_path)?;
    // Consume the request before acting on it. A request that cannot be
    // honoured must not be retried on every boot forever — that is a boot loop
    // that copies a broken file over the store each time round.
    let _ = std::fs::remove_file(pending_path(db_path));

    if !chosen.exists() {
        tracing::error!(
            set = %chosen.display(),
            "Restore request names a backup set that no longer exists — nothing restored"
        );
        return None;
    }

    // The live store's `-wal`/`-shm` belong to the file about to be replaced. A
    // journal left beside a restored database is a journal for a DIFFERENT
    // database, and SQLite would replay it into the restored file. Remove them
    // first, then bring the chosen set's own siblings in.
    for suffix in SIDECAR_SUFFIXES {
        let _ = std::fs::remove_file(sidecar_path(db_path, suffix));
    }
    if let Err(e) = std::fs::copy(&chosen, db_path) {
        tracing::error!(
            set = %chosen.display(),
            error = %e,
            "Restore failed while copying the chosen backup over the store"
        );
        return None;
    }
    for suffix in SIDECAR_SUFFIXES {
        let src = sidecar_path(&chosen, suffix);
        if src.exists() {
            let _ = std::fs::copy(&src, sidecar_path(db_path, suffix));
        }
    }

    // The file is now a different file, so the verdict recorded against the old
    // one no longer applies. This is the deliberate operator act
    // `damage::clear_quarantine` was waiting for — the choice was the act.
    let _ = crate::damage::clear_quarantine(db_path);

    let name = chosen
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| chosen.display().to_string());
    tracing::warn!(
        set = %name,
        db = %db_path.display(),
        "Store RESTORED from a backup set — every write made after that snapshot is gone"
    );
    Some(name)
}

/// Put the offer in the boot log. The count of quarantine boots that reached a
/// restore state is read from this line; before it existed, such a boot left
/// nothing behind but a quarantine warning and no way forward.
pub(crate) fn log_offer(app_data_dir: &Path, db_path: &Path) {
    let Some(offer) = offer_for(app_data_dir, db_path) else {
        return;
    };
    let listed = offer
        .sets
        .iter()
        .map(|s| {
            format!(
                "{} [{:?}] {} bytes @ {}",
                s.name, s.state, s.size_bytes, s.taken_at
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    tracing::error!(
        reason = %offer.reason,
        sets = offer.sets.len(),
        readable = offer.sets.iter().filter(|s| s.state == SetState::Readable).count(),
        default_choice = offer.newest_readable().map(|s| s.name.clone()).unwrap_or_else(|| "none".into()),
        listed = %listed,
        "RESTORE AVAILABLE — this boot has no usable store; a backup set can be chosen \
         (db::restore::request_restore) and is applied on the next boot"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{init_db, repos, settings_keys};

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("personas_restore_test_{}", uuid::Uuid::new_v4()))
    }

    /// Trash the header magic — the one place SQLite is guaranteed to read
    /// first and reject. Same deterministic fault `damage.rs` uses.
    fn damage_header(db_path: &Path) {
        /// The SQLite file header opens with a fixed 16-byte magic string. This
        /// is that string's length, not an arbitrary sample size: overwriting
        /// exactly it is what makes the file unopenable and nothing more.
        const HEADER_MAGIC_LEN: usize = 16;
        let mut bytes = std::fs::read(db_path).expect("read the store");
        for b in bytes.iter_mut().take(HEADER_MAGIC_LEN) {
            *b = 0xFF;
        }
        std::fs::write(db_path, &bytes).expect("write the damaged store");
    }

    /// The measurable: a boot on a canonically damaged store must end in a
    /// choice, and the choice must produce a running store holding the data
    /// that was in the snapshot.
    #[test]
    fn a_damaged_boot_ends_in_a_restore_offer_and_the_choice_restores_the_store() {
        let data_dir = temp_dir();
        let db_path = data_dir.join("personas.db");

        // Session 1: fresh install, one durable fact to recover later.
        {
            let pool = init_db(&data_dir, None).expect("fresh init_db");
            repos::core::settings::set(&pool, settings_keys::CLI_ENGINE, "claude_code")
                .expect("write a settings row");
        }
        // Session 2: boot on the existing store -> the pre-damage snapshot.
        {
            let _pool = init_db(&data_dir, None).expect("second init_db");
        }
        assert_eq!(
            list_backup_sets(&data_dir).len(),
            1,
            "session 2 must leave exactly one backup set"
        );

        damage_header(&db_path);

        // Session 3: the boot that used to end nowhere. Header damage makes
        // the POOL fail to build, so this returns `Err` before `damage.rs`
        // gets a connection to quarantine — the surface has to work from a
        // failed boot as well as from a quarantined one.
        {
            let booted = init_db(&data_dir, None);
            let usable = booted.is_ok() && !crate::damage::is_quarantined(&db_path);
            assert!(!usable, "a damaged store must not boot as a healthy one");
        }

        let offer = offer_for(&data_dir, &db_path)
            .expect("a damaged boot must reach a restore state — this is the measurable");
        assert!(
            !offer.reason.is_empty(),
            "the offer must classify the failure"
        );
        assert_eq!(
            offer.sets.len(),
            2,
            "both sets must be listed — the pre-damage one and session 3's snapshot of the damage"
        );
        // Newest first: session 3 snapshotted the DAMAGED store, so the newest
        // set must NOT be readable and the default choice must skip it. This is
        // the state column doing the work; without it the operator would pick
        // the newest and restore the damage.
        assert_ne!(
            offer.sets[0].state,
            SetState::Readable,
            "a snapshot of a damaged store must not be listed as readable"
        );
        assert_eq!(offer.sets[1].state, SetState::Readable);
        assert!(
            offer.sets[1].probe.contains("quick_check"),
            "the state column must name the probe it ran, got {:?}",
            offer.sets[1].probe
        );
        let choice = offer
            .newest_readable()
            .expect("a readable set must be offered as the default choice");
        assert_eq!(choice.name, offer.sets[1].name);
        assert!(
            choice.taken_at.starts_with("20"),
            "unparsed stamp: {}",
            choice.taken_at
        );

        request_restore(&db_path, &choice.path).expect("request the restore");
        assert!(
            pending_restore(&db_path).is_some(),
            "the request must be durable"
        );

        // Session 4: the restore is applied before any connection opens.
        {
            let pool = init_db(&data_dir, None).expect("boot after restore");
            assert!(
                !crate::damage::is_quarantined(&db_path),
                "a restored store must not stay quarantined"
            );
            let value = repos::core::settings::get(&pool, settings_keys::CLI_ENGINE)
                .expect("read the restored settings row");
            assert_eq!(
                value.as_deref(),
                Some("claude_code"),
                "the restored store must hold the data the snapshot held"
            );
        }
        assert!(
            pending_restore(&db_path).is_none(),
            "the request must be consumed, never replayed on later boots"
        );
        assert!(
            offer_for(&data_dir, &db_path).is_none(),
            "a restored, healthy store must stop offering a restore"
        );

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// The control. Without it every assertion above would pass against an
    /// `offer_for` that returns `Some` unconditionally.
    #[test]
    fn a_healthy_store_is_never_offered_a_restore() {
        let data_dir = temp_dir();
        let db_path = data_dir.join("personas.db");
        {
            let _pool = init_db(&data_dir, None).expect("fresh init_db");
        }
        {
            let _pool = init_db(&data_dir, None).expect("second init_db");
        }
        assert_eq!(list_backup_sets(&data_dir).len(), 1, "the backup exists");
        assert!(
            offer_for(&data_dir, &db_path).is_none(),
            "a healthy store must never reach the restore state, backups or not"
        );
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// The second door into the same state. Header damage makes the pool fail
    /// to build, so `init_db` never reaches `damage.rs` — that is the path the
    /// test above walks. Slower damage quarantines a store that still opens,
    /// and leaves a marker; the offer must then come from the recorded
    /// incident, with the reason the detector wrote, not from a fresh probe of
    /// a file that reads fine.
    #[test]
    fn a_quarantine_marker_alone_reaches_the_restore_state() {
        let data_dir = temp_dir();
        let db_path = data_dir.join("personas.db");
        {
            let _pool = init_db(&data_dir, None).expect("fresh init_db");
        }
        {
            let _pool = init_db(&data_dir, None).expect("second init_db");
        }
        std::fs::write(
            crate::damage::marker_path(&db_path),
            "2026-09-03T10:00:00Z\ntest: canonical damage in the record trees\n",
        )
        .unwrap();

        let offer =
            offer_for(&data_dir, &db_path).expect("a quarantined store must be offered a restore");
        assert_eq!(offer.reason, "test: canonical damage in the record trees");
        assert_eq!(offer.detected_at, "2026-09-03T10:00:00Z");
        assert_eq!(
            offer.newest_readable().map(|s| s.name.clone()),
            offer.sets.first().map(|s| s.name.clone()),
            "the only set predates the damage and must be offered"
        );
        log_offer(&data_dir, &db_path);

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// A request naming a set that is gone must be consumed, not retried: the
    /// falsifier is a boot loop that offers the same list forever.
    #[test]
    fn a_restore_request_for_a_missing_set_is_consumed_not_retried() {
        let data_dir = temp_dir();
        std::fs::create_dir_all(&data_dir).unwrap();
        let db_path = data_dir.join("personas.db");
        std::fs::write(&db_path, b"stand-in store").unwrap();
        let ghost = data_dir
            .join("backups")
            .join("personas-20260101-000000-00.db");

        assert!(
            request_restore(&db_path, &ghost).is_err(),
            "a request must refuse a set that does not exist"
        );
        // ...and if one is planted anyway (the set was rotated away between the
        // choice and the boot), the boot consumes it and leaves the store alone.
        std::fs::write(pending_path(&db_path), format!("{}\n", ghost.display())).unwrap();
        assert_eq!(apply_pending_restore(&db_path), None);
        assert!(
            pending_restore(&db_path).is_none(),
            "the request must be consumed"
        );
        assert_eq!(
            std::fs::read(&db_path).unwrap(),
            b"stand-in store",
            "a failed restore must not touch the store"
        );

        let _ = std::fs::remove_dir_all(&data_dir);
    }
}
