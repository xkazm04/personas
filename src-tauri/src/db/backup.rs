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
//!   EVERY boot of an existing database instead; rotation caps the disk
//!   cost at [`MAX_BACKUPS`] sets, and user databases are small-to-medium
//!   so the one sequential `fs::copy` per boot is acceptable.
//! - Everything here is best-effort: a full disk, locked file, or ACL
//!   problem logs a warning and boot continues. A failed backup must
//!   never be worse than the risk it protects against.

use std::path::{Path, PathBuf};

/// How many backup sets (newest first) survive rotation.
const MAX_BACKUPS: usize = 3;

/// Subdirectory of the app data dir where snapshots live.
const BACKUP_DIR_NAME: &str = "backups";

/// SQLite sidecar extensions copied/rotated together with the main file.
/// `foo.db`'s WAL is `foo.db-wal`, and `Path::with_extension("db-wal")` on
/// a `.db` path produces exactly that shape — so a restored backup keeps
/// the sidecar naming SQLite expects.
const SIDECAR_EXTENSIONS: [&str; 2] = ["db-wal", "db-shm"];

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
    for ext in SIDECAR_EXTENSIONS {
        let src = db_path.with_extension(ext);
        if !src.exists() {
            continue; // clean shutdown last session — WAL was checkpointed away
        }
        let dst = backup_db.with_extension(ext);
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

    rotate_backups(&backup_dir);
    Some(backup_db)
}

/// Keep the newest [`MAX_BACKUPS`] backup sets, delete the rest (including
/// their WAL/SHM siblings). Sorting is lexicographic on the file name,
/// which matches chronology for the `personas-<stamp>-<nn>.db` scheme.
/// Best-effort: every failure logs a warning and moves on — rotation debt
/// is disk usage, never a boot blocker.
fn rotate_backups(backup_dir: &Path) {
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

    let mut sets: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().is_some_and(|x| x == "db")
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("personas-"))
        })
        .collect();
    if sets.len() <= MAX_BACKUPS {
        return;
    }
    sets.sort(); // ascending lexicographic == oldest first
    let excess = sets.len() - MAX_BACKUPS;
    for old in sets.into_iter().take(excess) {
        let mut doomed = vec![old.clone()];
        doomed.extend(SIDECAR_EXTENSIONS.iter().map(|ext| old.with_extension(ext)));
        for path in doomed {
            if !path.exists() {
                continue;
            }
            if let Err(e) = std::fs::remove_file(&path) {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "Backup rotation could not delete an old backup (non-fatal)"
                );
            }
        }
        tracing::debug!(path = %old.display(), "Rotated out old pre-migration backup");
    }
}
