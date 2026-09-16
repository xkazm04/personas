//! Pre-migration snapshot of the primary database (`personas.db`).
//!
//! `init_db` replays the FULL migration chain (`migrations::run` +
//! `run_incremental`) on every launch, mutating the user's database in
//! place. A single bad migration would therefore brick the install with
//! the user's data stranded inside a half-migrated file. This module
//! copies the database (plus its `-wal`/`-shm` siblings) into
//! `<data_dir>/backups/` BEFORE the connection pool opens the file, so a
//! botched boot can always be recovered by copying the newest backup back
//! over `personas.db`.
//!
//! Policy:
//! - Fresh installs (no `personas.db` on disk yet) are skipped — there is
//!   no user data to protect.
//! - There is no schema-version counter in this codebase (migrations are
//!   idempotent replays, see `db/migrations/mod.rs`), so there is no cheap
//!   "will this boot actually change the schema?" signal. We back up on
//!   EVERY boot of an existing database instead.
//! - Rotation covers EVERY set in `backups/`, not only the ones this module
//!   writes. Boot sets (`personas-<stamp>-<nn>.db`) keep the newest
//!   [`MIN_BACKUPS`] unconditionally and up to [`MAX_BACKUPS`] while the kept
//!   sets fit in [`MAX_BACKUP_BYTES`]. Any other `.db` in the directory is an
//!   ad-hoc set — an agent's `personas-pre-sweep-ingest-*.db`, the test-env
//!   reset script's `personas-cleanbak-*.db` — and ages out after
//!   [`ADHOC_MAX_AGE`].
//!
//!   Why the byte cap, measured 2026-09-14: a 347 MB database cost 1.04 GB of
//!   backups at three sets, and a 996 MB directory had held that for months.
//!   Two sets is still two independent pre-migration copies; the third is kept
//!   whenever the store is small enough to afford it.
//!
//!   Why ad-hoc sets needed a rule of their own: the old filter matched every
//!   `personas-*` file and sorted by name, so `personas-pre-…` sorted AFTER
//!   `personas-2026…` and read as the NEWEST set. It was never rotated, and it
//!   pushed a real boot set out on every boot instead.
//! - Everything here is best-effort: a full disk, locked file, or ACL
//!   problem logs a warning and boot continues. A failed backup must
//!   never be worse than the risk it protects against.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Boot sets always kept, whatever they cost — the recovery guarantee.
const MIN_BACKUPS: usize = 2;

/// How many boot sets (newest first) can survive rotation.
const MAX_BACKUPS: usize = 3;

/// Boot sets past [`MIN_BACKUPS`] are kept only while the kept total stays
/// under this. 768 MiB fits three sets of a ~250 MB store and two of the
/// 347 MB store that motivated it.
const MAX_BACKUP_BYTES: u64 = 768 * 1024 * 1024;

/// Age after which an ad-hoc set (anything not named like a boot set) is
/// removed. Long enough to back out of whatever the snapshot was taken before;
/// short enough that a forgotten one does not cost disk for a season.
const ADHOC_MAX_AGE: Duration = Duration::from_secs(14 * 24 * 60 * 60);

/// Subdirectory of the app data dir where snapshots live. Shared with
/// [`crate::restore`], which lists what this module writes.
pub(crate) const BACKUP_DIR_NAME: &str = "backups";

/// SQLite sidecar suffixes copied/rotated together with the main file.
/// SQLite appends these to the FULL file name (`foo.db` → `foo.db-wal`,
/// `store` → `store-wal`); [`sidecar_path`] applies that rule, so a restored
/// backup keeps the sidecar naming SQLite expects whatever the store is named.
/// A restore copies and removes the same set of siblings a snapshot copies —
/// [`crate::restore`] shares this list so the two halves cannot drift apart.
pub(crate) const SIDECAR_SUFFIXES: [&str; 2] = ["-wal", "-shm"];

use crate::sidecar_path;

/// Snapshot `db_path` into `<app_data_dir>/backups/personas-<stamp>-<nn>.db`
/// (+ WAL/SHM siblings if present), then rotate old sets. Returns the path
/// of the new backup's main file, or `None` when skipped or failed (fresh
/// install, copy error). Never returns an error: boot must not be blocked.
///
/// Call this BEFORE any connection opens the database. At that point the
/// current process holds no handle on the file, so a plain file copy of
/// `.db` + `-wal` is a consistent snapshot (the WAL holds any
/// not-yet-checkpointed transactions from the previous session).
pub(super) fn backup_before_migrations(app_data_dir: &Path, db_path: &Path) -> Option<PathBuf> {
    if !db_path.exists() {
        // Fresh install — nothing to back up (and no `backups/` dir litter).
        return None;
    }

    let backup_dir = app_data_dir.join(BACKUP_DIR_NAME);
    if let Err(e) = std::fs::create_dir_all(&backup_dir) {
        tracing::warn!(
            dir = %backup_dir.display(),
            error = %e,
            "Pre-migration DB backup skipped — backup directory could not be created (non-fatal)"
        );
        return None;
    }

    // `personas-<UTC stamp>-<nn>.db`. The two-digit counter disambiguates
    // multiple boots within one second (test loops, crash-restart storms)
    // while keeping lexicographic order == chronological order, which is
    // what rotation sorts by. UTC avoids DST-fold ordering glitches.
    //
    // The counter must be (highest existing counter for this second) + 1,
    // NOT the first free slot: rotation frees low slots (`-00` dies once a
    // fourth same-second backup lands), and a reused low slot would make
    // the NEWEST backup sort as the oldest — and get rotated out by its
    // own rotation pass moments after being written.
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let prefix = format!("personas-{stamp}-");
    let next_n = match std::fs::read_dir(&backup_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name();
                let name = name.to_str()?;
                name.strip_prefix(&prefix)?
                    .strip_suffix(".db")?
                    .parse::<u32>()
                    .ok()
            })
            .max()
            .map_or(0, |max| max + 1),
        Err(e) => {
            tracing::warn!(
                dir = %backup_dir.display(),
                error = %e,
                "Pre-migration DB backup skipped — could not list backup dir (non-fatal)"
            );
            return None;
        }
    };
    if next_n > 99 {
        // 100 boots inside one second — not a real-world scenario; skip
        // rather than break the two-digit lexicographic ordering.
        tracing::warn!("Pre-migration DB backup skipped — backup name space exhausted (non-fatal)");
        return None;
    }
    let backup_db = backup_dir.join(format!("{prefix}{next_n:02}.db"));

    if let Err(e) = std::fs::copy(db_path, &backup_db) {
        tracing::warn!(
            from = %db_path.display(),
            to = %backup_db.display(),
            error = %e,
            "Pre-migration DB backup failed (non-fatal) — continuing boot without a safety copy"
        );
        // Don't leave a truncated half-copy behind masquerading as a backup.
        let _ = std::fs::remove_file(&backup_db);
        return None;
    }

    // On Unix, fs::copy carries over the source's 0600 mode; on Windows the
    // file inherits the owner-only ACL that init_db set on the data dir —
    // so backups get the same protection as the live database for free.
    for suffix in SIDECAR_SUFFIXES {
        let src = sidecar_path(db_path, suffix);
        if !src.exists() {
            continue; // clean shutdown last session — WAL was checkpointed away
        }
        let dst = sidecar_path(&backup_db, suffix);
        if let Err(e) = std::fs::copy(&src, &dst) {
            // The .db copy alone is still a valid database as of its last
            // checkpoint; a missing WAL only means the tail of the final
            // session may be absent from the backup. Warn, don't block boot.
            tracing::warn!(
                from = %src.display(),
                error = %e,
                "Pre-migration backup of SQLite sidecar failed (non-fatal)"
            );
        }
    }

    tracing::info!(
        path = %backup_db.display(),
        "Pre-migration DB backup created"
    );

    // The quarantine clause. Three slots is enough for a bad migration — the
    // risk this module was written for — and NOT enough for slow structural
    // damage: a session that keeps writing to a damaged file, then three more
    // boots, has rotated every pre-damage copy out of existence before anyone
    // noticed. So if the previous session ended quarantined, take the backup
    // and do not rotate. The marker is a file beside the store, read here
    // BEFORE any connection opens it — a flag stored inside the damaged
    // database is unreadable exactly when it matters.
    //
    // Nothing clears the marker automatically: `damage::clear_quarantine` is a
    // deliberate operator act after a restore. Rotation debt is disk usage; a
    // rotated-away last good copy is the user's data.
    if crate::damage::previous_session_quarantined(db_path) {
        tracing::warn!(
            dir = %backup_dir.display(),
            "Backup rotation HELD — the store is quarantined, so no pre-damage backup is deleted"
        );
        return Some(backup_db);
    }

    rotate_backups(&backup_dir);
    Some(backup_db)
}

/// The `<stamp>` of a boot set name — `personas-YYYYMMDD-HHMMSS-NN.db` →
/// `YYYYMMDD-HHMMSS` — or `None` for any other name. Strict on purpose: a
/// loose `personas-*` match is what let an ad-hoc set pose as the newest boot
/// set. Shared with [`crate::restore`], which orders its list by it.
pub(crate) fn boot_set_stamp(name: &str) -> Option<&str> {
    let rest = name.strip_prefix("personas-")?.strip_suffix(".db")?;
    let bytes = rest.as_bytes();
    let shaped = bytes.len() == 18
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 15 => *b == b'-',
            _ => b.is_ascii_digit(),
        });
    shaped.then(|| &rest[..15])
}

/// Rotation limits, parameterised so the tests can use small numbers.
#[derive(Debug, Clone, Copy)]
struct RotationPolicy {
    min_sets: usize,
    max_sets: usize,
    max_bytes: u64,
    adhoc_max_age: Duration,
}

impl Default for RotationPolicy {
    fn default() -> Self {
        Self {
            min_sets: MIN_BACKUPS,
            max_sets: MAX_BACKUPS,
            max_bytes: MAX_BACKUP_BYTES,
            adhoc_max_age: ADHOC_MAX_AGE,
        }
    }
}

/// Size of a set: the `.db` plus whatever sidecars it kept.
fn set_bytes(db: &Path) -> u64 {
    std::iter::once(db.to_path_buf())
        .chain(SIDECAR_SUFFIXES.iter().map(|s| sidecar_path(db, s)))
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum()
}

/// Delete a set and its sidecars. Best-effort, one warning per failure.
fn delete_set(db: &Path, why: &str) {
    for path in std::iter::once(db.to_path_buf())
        .chain(SIDECAR_SUFFIXES.iter().map(|s| sidecar_path(db, s)))
    {
        if !path.exists() {
            continue;
        }
        if let Err(e) = std::fs::remove_file(&path) {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "Backup rotation could not delete a backup file (non-fatal)"
            );
        }
    }
    tracing::info!(path = %db.display(), reason = why, "Rotated out a backup set");
}

/// Apply the rotation rules (see the module doc) with the shipped limits.
/// Best-effort: every failure logs a warning and moves on — rotation debt is
/// disk usage, never a boot blocker.
fn rotate_backups(backup_dir: &Path) {
    rotate_backups_with(backup_dir, RotationPolicy::default(), SystemTime::now());
}

fn rotate_backups_with(backup_dir: &Path, policy: RotationPolicy, now: SystemTime) {
    let entries = match std::fs::read_dir(backup_dir) {
        Ok(entries) => entries,
        Err(e) => {
            tracing::warn!(
                dir = %backup_dir.display(),
                error = %e,
                "Backup rotation skipped — could not list backup dir (non-fatal)"
            );
            return;
        }
    };

    let mut boot_sets: Vec<PathBuf> = Vec::new();
    let mut adhoc_sets: Vec<PathBuf> = Vec::new();
    for path in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
        if !path.is_file() || path.extension().is_none_or(|x| x != "db") {
            continue;
        }
        let is_boot = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(boot_set_stamp)
            .is_some();
        if is_boot {
            boot_sets.push(path);
        } else {
            adhoc_sets.push(path);
        }
    }

    // Newest first: for the strict boot-set name, lexicographic == chronological.
    boot_sets.sort_by(|a, b| b.cmp(a));
    let mut kept_bytes: u64 = 0;
    for (index, set) in boot_sets.iter().enumerate() {
        let bytes = set_bytes(set);
        let within_floor = index < policy.min_sets;
        let within_budget =
            index < policy.max_sets && kept_bytes.saturating_add(bytes) <= policy.max_bytes;
        if within_floor || within_budget {
            kept_bytes = kept_bytes.saturating_add(bytes);
        } else {
            delete_set(set, "boot set beyond the count/size budget");
        }
    }

    for set in adhoc_sets {
        // An unreadable mtime counts as fresh — the direction that keeps a file.
        let age = std::fs::metadata(&set)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .unwrap_or(Duration::ZERO);
        if age > policy.adhoc_max_age {
            delete_set(&set, "ad-hoc set past its age limit");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("personas_backup_rot_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, bytes: usize) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, vec![0u8; bytes]).unwrap();
        path
    }

    fn age(path: &Path, days: u64) {
        let when = SystemTime::now() - Duration::from_secs(days * 24 * 60 * 60);
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        out.sort();
        out
    }

    fn policy(max_bytes: u64) -> RotationPolicy {
        RotationPolicy {
            min_sets: 2,
            max_sets: 3,
            max_bytes,
            adhoc_max_age: ADHOC_MAX_AGE,
        }
    }

    #[test]
    fn boot_set_names_are_recognised_strictly() {
        assert_eq!(
            boot_set_stamp("personas-20260914-161146-00.db"),
            Some("20260914-161146")
        );
        assert_eq!(
            boot_set_stamp("personas-pre-sweep-ingest-20260829-184713.db"),
            None
        );
        assert_eq!(
            boot_set_stamp("personas-cleanbak-2026-06-02T22-39-46.db"),
            None
        );
        assert_eq!(boot_set_stamp("personas-20260914-161146-00.db-wal"), None);
    }

    /// The byte cap removes the third set when the store is large, and the
    /// floor keeps two however large it is.
    #[test]
    fn rotation_keeps_newest_boot_sets_within_budget_and_never_fewer_than_two() {
        let dir = temp_dir();
        for stamp in [
            "20260901-100000-00",
            "20260902-100000-00",
            "20260903-100000-00",
            "20260904-100000-00",
        ] {
            write(&dir, &format!("personas-{stamp}.db"), 10);
        }
        write(&dir, "personas-20260901-100000-00.db-wal", 5);

        rotate_backups_with(&dir, policy(1_000), SystemTime::now());
        assert_eq!(
            names(&dir),
            vec![
                "personas-20260902-100000-00.db",
                "personas-20260903-100000-00.db",
                "personas-20260904-100000-00.db",
            ],
            "budget allows three: the oldest set goes, with its sidecar"
        );

        rotate_backups_with(&dir, policy(25), SystemTime::now());
        assert_eq!(
            names(&dir),
            vec![
                "personas-20260903-100000-00.db",
                "personas-20260904-100000-00.db"
            ],
            "a third 10-byte set does not fit 25 bytes"
        );

        rotate_backups_with(&dir, policy(1), SystemTime::now());
        assert_eq!(
            names(&dir).len(),
            2,
            "the floor holds even when two sets bust the budget"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The operator's directory: an agent's pre-sweep snapshot sorted after
    /// every boot set, so it read as the newest, was never rotated, and pushed
    /// a real boot set out instead. Ad-hoc sets now age out on their own and
    /// never displace a boot set.
    #[test]
    fn adhoc_sets_age_out_with_their_sidecars_and_never_displace_boot_sets() {
        let dir = temp_dir();
        for stamp in [
            "20260912-100000-00",
            "20260913-100000-00",
            "20260914-100000-00",
        ] {
            write(&dir, &format!("personas-{stamp}.db"), 10);
        }
        let stale = write(&dir, "personas-pre-sweep-ingest-20260829-184713.db", 10);
        let stale_wal = write(&dir, "personas-pre-sweep-ingest-20260829-184713.db-wal", 10);
        age(&stale, 16);
        age(&stale_wal, 16);
        write(&dir, "personas-cleanbak-2026-09-14T10-00-00.db", 10);
        write(&dir, "notes.txt", 3);

        rotate_backups_with(&dir, policy(1_000), SystemTime::now());

        assert_eq!(
            names(&dir),
            vec![
                "notes.txt",
                "personas-20260912-100000-00.db",
                "personas-20260913-100000-00.db",
                "personas-20260914-100000-00.db",
                "personas-cleanbak-2026-09-14T10-00-00.db",
            ],
            "the 16-day-old ad-hoc set and its WAL go; a fresh one stays; all three boot sets stay"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
