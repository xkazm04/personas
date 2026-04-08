//! Cross-process lock file for daemon/UI coordination.
//!
//! Prevents the `personas-daemon` binary and the windowed Tauri app from
//! firing the same scheduled trigger twice. The protocol is deliberately
//! simple: a JSON file in the app data directory with a periodic heartbeat.
//!
//! # Protocol
//!
//! - **Acquire** (daemon startup): atomic create via `OpenOptions::create_new`.
//!   If the file already exists, parse it and treat it as stale if the
//!   `heartbeat_at` is older than [`STALE_THRESHOLD`]; otherwise exit with
//!   "another daemon is running."
//! - **Heartbeat** (daemon, every 30s): rewrite the file with a new
//!   `heartbeat_at` timestamp.
//! - **Release** (daemon clean shutdown): delete the file.
//! - **Check** (windowed UI, before firing a `headless=true` trigger):
//!   [`DaemonLock::check_active`] reads the file; if present and fresh,
//!   the UI yields ownership of the trigger kinds listed in `owns[]`.
//!
//! # Fallback behavior
//!
//! If the lock file is missing OR stale (heartbeat older than
//! [`STALE_THRESHOLD`]), the windowed UI fires triggers normally. This
//! means a user who marks personas `headless=true` but has not installed
//! the daemon still sees their triggers fire — the `headless` flag is a
//! "prefer daemon if available" hint, not a hard requirement.
//!
//! # What this protocol does NOT do
//!
//! - No PID-based liveness check. Heartbeat freshness is the sole
//!   liveness indicator. A hung daemon (not writing heartbeats) is
//!   treated as dead, which is the correct behavior for our use case.
//! - No advisory `flock`/`LockFileEx`. Those have inconsistent semantics
//!   across platforms and don't survive process crashes cleanly. A plain
//!   JSON lock file is portable and debuggable (`cat daemon.lock`).
//! - No cross-host coordination. If the app data dir is on a network share
//!   (OneDrive, iCloud Drive), the protocol will produce false positives.
//!   The `hostname` field is recorded for future diagnostic use.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// A daemon is considered stale if its last heartbeat is older than this.
///
/// The daemon writes a heartbeat every [`HEARTBEAT_INTERVAL`]; 90s gives
/// three missed heartbeats before we declare the daemon dead and let
/// another process take over. Conservative enough to avoid false
/// positives from brief GC pauses or I/O stalls, short enough that a
/// crashed daemon doesn't block a fresh start for more than ~1.5 minutes.
pub const STALE_THRESHOLD: Duration = Duration::from_secs(90);

/// How often the daemon refreshes `heartbeat_at` on its own lock file.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

/// File name inside the app data directory.
pub const LOCK_FILENAME: &str = "daemon.lock";

/// Known trigger kinds the daemon can claim ownership of.
///
/// The daemon records the kinds it handles in [`LockFileContents::owns`];
/// the windowed UI yields only those trigger kinds. This lets Phase 0
/// ship with a narrow claim (cron + polling only) and expand later
/// without a lock-file format bump.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    Cron,
    Polling,
    Webhook,
    SmeeRelay,
    SharedEventRelay,
    CloudWebhookRelay,
}

/// Serialized contents of `daemon.lock`.
///
/// Kept deliberately small so the file is cheap to re-write every 30s.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockFileContents {
    /// OS process id of the daemon. Recorded for diagnostics; NOT used
    /// for liveness (see module docs).
    pub pid: u32,
    /// Machine hostname. Recorded for diagnostics only — the protocol
    /// does not currently reject foreign-host locks.
    pub hostname: String,
    /// When the daemon process started.
    pub started_at: DateTime<Utc>,
    /// Last heartbeat. Refreshed every [`HEARTBEAT_INTERVAL`] by the
    /// daemon; compared against [`STALE_THRESHOLD`] by the UI.
    pub heartbeat_at: DateTime<Utc>,
    /// Version of the daemon binary (from `CARGO_PKG_VERSION`).
    pub version: String,
    /// Trigger kinds the daemon has claimed. The UI yields ownership
    /// only for these kinds. Unlisted kinds remain UI-owned.
    pub owns: Vec<TriggerKind>,
}

impl LockFileContents {
    /// Returns `true` if `heartbeat_at` is older than [`STALE_THRESHOLD`].
    pub fn is_stale(&self) -> bool {
        let age = Utc::now().signed_duration_since(self.heartbeat_at);
        match age.to_std() {
            Ok(std_age) => std_age > STALE_THRESHOLD,
            // Negative duration means heartbeat is in the future —
            // probably clock drift. Treat as fresh.
            Err(_) => false,
        }
    }

    /// Returns `true` if this lock claims the given trigger kind.
    pub fn owns_kind(&self, kind: TriggerKind) -> bool {
        self.owns.contains(&kind)
    }
}

/// Errors produced by lock-file operations.
#[derive(Debug, thiserror::Error)]
pub enum LockError {
    #[error("another daemon is already running (pid {pid}, heartbeat {heartbeat_at})")]
    AlreadyHeld {
        pid: u32,
        heartbeat_at: DateTime<Utc>,
    },

    #[error("lock file I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("lock file is corrupt ({source}) — delete {} and retry", path.display())]
    Corrupt {
        source: serde_json::Error,
        path: PathBuf,
    },
}

impl From<LockError> for AppError {
    fn from(err: LockError) -> Self {
        AppError::Internal(err.to_string())
    }
}

/// Owned handle to an acquired daemon lock.
///
/// Drops the lock file on `release()` or when the process exits cleanly.
/// An unclean crash leaves the file behind; the next daemon start detects
/// it as stale via heartbeat age.
#[derive(Debug)]
pub struct DaemonLock {
    path: PathBuf,
    contents: LockFileContents,
}

impl DaemonLock {
    /// Attempt to acquire the lock at `app_data_dir.join(LOCK_FILENAME)`.
    ///
    /// Returns `Err(LockError::AlreadyHeld)` if a fresh lock file exists
    /// for another process. If the existing file is stale (heartbeat
    /// older than [`STALE_THRESHOLD`]), it is deleted and the acquire
    /// is retried once.
    pub fn acquire(
        app_data_dir: &Path,
        owns: Vec<TriggerKind>,
    ) -> Result<Self, LockError> {
        fs::create_dir_all(app_data_dir)?;
        let path = app_data_dir.join(LOCK_FILENAME);

        // If an existing lock file is stale, remove it and try again.
        if let Ok(existing) = read_lock_file(&path) {
            if existing.is_stale() {
                tracing::info!(
                    path = %path.display(),
                    stale_pid = existing.pid,
                    heartbeat_at = %existing.heartbeat_at,
                    "removing stale daemon lock file"
                );
                let _ = fs::remove_file(&path);
            } else {
                return Err(LockError::AlreadyHeld {
                    pid: existing.pid,
                    heartbeat_at: existing.heartbeat_at,
                });
            }
        }

        let now = Utc::now();
        let contents = LockFileContents {
            pid: std::process::id(),
            hostname: hostname_or_unknown(),
            started_at: now,
            heartbeat_at: now,
            version: env!("CARGO_PKG_VERSION").to_string(),
            owns,
        };

        // Atomic create. On Windows this maps to CREATE_NEW; on Unix to O_EXCL.
        // If another daemon raced us after our staleness check, this fails.
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;

        let json = serde_json::to_vec_pretty(&contents)
            .map_err(std::io::Error::other)?;
        file.write_all(&json)?;
        file.sync_all()?;

        Ok(Self { path, contents })
    }

    /// Refresh `heartbeat_at` on the lock file.
    ///
    /// The daemon binary calls this every [`HEARTBEAT_INTERVAL`] from a
    /// tokio task. A write error (e.g. disk full) is bubbled up — the
    /// daemon should log it and decide whether to keep running.
    pub fn heartbeat(&mut self) -> Result<(), LockError> {
        self.contents.heartbeat_at = Utc::now();
        let json = serde_json::to_vec_pretty(&self.contents)
            .map_err(std::io::Error::other)?;

        // Write to a temp file and rename for atomicity — prevents a
        // reader from ever seeing a truncated file mid-write.
        let tmp_path = self.path.with_extension("lock.tmp");
        {
            let mut tmp = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp_path)?;
            tmp.write_all(&json)?;
            tmp.sync_all()?;
        }
        fs::rename(&tmp_path, &self.path)?;
        Ok(())
    }

    /// Delete the lock file. Called on clean shutdown.
    ///
    /// If the file has already been deleted or never existed, this is a
    /// no-op rather than an error — the caller's intent ("make sure no
    /// lock file remains") is satisfied either way.
    pub fn release(self) -> Result<(), LockError> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(LockError::Io(e)),
        }
    }

    /// Returns the full lock file path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns a copy of the current lock contents.
    pub fn contents(&self) -> &LockFileContents {
        &self.contents
    }

    /// Check whether a fresh daemon is currently running.
    ///
    /// Called by the windowed UI before firing a `headless=true` trigger.
    /// Returns:
    /// - `Ok(Some(lock))` — a daemon is running; the UI should yield
    ///   ownership for trigger kinds in `lock.owns`.
    /// - `Ok(None)` — no daemon; the UI fires normally.
    ///
    /// A stale lock file is automatically cleaned up and treated as "no
    /// daemon." This is the fallback path that guarantees users without
    /// the daemon are unaffected.
    pub fn check_active(app_data_dir: &Path) -> Result<Option<LockFileContents>, LockError> {
        let path = app_data_dir.join(LOCK_FILENAME);
        match read_lock_file(&path) {
            Ok(lock) => {
                if lock.is_stale() {
                    // Best-effort cleanup. Ignore errors — another process
                    // may be racing us to remove or replace the file.
                    let _ = fs::remove_file(&path);
                    Ok(None)
                } else {
                    Ok(Some(lock))
                }
            }
            Err(LockError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
}

fn read_lock_file(path: &Path) -> Result<LockFileContents, LockError> {
    let bytes = fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|source| LockError::Corrupt {
        source,
        path: path.to_path_buf(),
    })
}

fn hostname_or_unknown() -> String {
    // Best-effort; never fails the acquire. `whoami` is already a dep.
    whoami::fallible::hostname().unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn acquire_writes_fresh_lock_file() {
        let tmp = TempDir::new().unwrap();
        let lock = DaemonLock::acquire(tmp.path(), vec![TriggerKind::Cron]).unwrap();
        assert!(lock.path().exists());
        assert_eq!(lock.contents().pid, std::process::id());
        assert!(lock.contents().owns_kind(TriggerKind::Cron));
        assert!(!lock.contents().owns_kind(TriggerKind::Webhook));
    }

    #[test]
    fn second_acquire_fails_when_first_is_fresh() {
        let tmp = TempDir::new().unwrap();
        let _lock1 = DaemonLock::acquire(tmp.path(), vec![TriggerKind::Cron]).unwrap();
        let err = DaemonLock::acquire(tmp.path(), vec![TriggerKind::Cron]).unwrap_err();
        match err {
            LockError::AlreadyHeld { .. } => {}
            other => panic!("expected AlreadyHeld, got {other:?}"),
        }
    }

    #[test]
    fn acquire_replaces_stale_lock() {
        let tmp = TempDir::new().unwrap();
        // Write a stale lock file by hand.
        let stale = LockFileContents {
            pid: 99999,
            hostname: "ghost".into(),
            started_at: Utc::now() - chrono::Duration::hours(1),
            heartbeat_at: Utc::now() - chrono::Duration::minutes(10),
            version: "0.0.0".into(),
            owns: vec![TriggerKind::Cron],
        };
        let path = tmp.path().join(LOCK_FILENAME);
        fs::write(&path, serde_json::to_vec_pretty(&stale).unwrap()).unwrap();

        // Acquire should succeed, evicting the stale entry.
        let lock = DaemonLock::acquire(tmp.path(), vec![TriggerKind::Cron]).unwrap();
        assert_eq!(lock.contents().pid, std::process::id());
    }

    #[test]
    fn heartbeat_updates_timestamp() {
        let tmp = TempDir::new().unwrap();
        let mut lock = DaemonLock::acquire(tmp.path(), vec![TriggerKind::Cron]).unwrap();
        let before = lock.contents().heartbeat_at;
        std::thread::sleep(Duration::from_millis(10));
        lock.heartbeat().unwrap();
        assert!(lock.contents().heartbeat_at > before);

        // Confirm the on-disk value advanced too.
        let on_disk = read_lock_file(lock.path()).unwrap();
        assert_eq!(on_disk.heartbeat_at, lock.contents().heartbeat_at);
    }

    #[test]
    fn release_removes_lock_file() {
        let tmp = TempDir::new().unwrap();
        let lock = DaemonLock::acquire(tmp.path(), vec![TriggerKind::Cron]).unwrap();
        let path = lock.path().to_path_buf();
        lock.release().unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn release_is_idempotent_when_file_is_already_gone() {
        let tmp = TempDir::new().unwrap();
        let lock = DaemonLock::acquire(tmp.path(), vec![TriggerKind::Cron]).unwrap();
        fs::remove_file(lock.path()).unwrap();
        // Should not error.
        lock.release().unwrap();
    }

    #[test]
    fn check_active_returns_none_when_no_lock() {
        let tmp = TempDir::new().unwrap();
        assert!(DaemonLock::check_active(tmp.path()).unwrap().is_none());
    }

    #[test]
    fn check_active_returns_contents_when_fresh() {
        let tmp = TempDir::new().unwrap();
        let _lock = DaemonLock::acquire(
            tmp.path(),
            vec![TriggerKind::Cron, TriggerKind::Polling],
        )
        .unwrap();
        let seen = DaemonLock::check_active(tmp.path()).unwrap().unwrap();
        assert_eq!(seen.pid, std::process::id());
        assert!(seen.owns_kind(TriggerKind::Polling));
    }

    #[test]
    fn check_active_cleans_up_stale_lock() {
        let tmp = TempDir::new().unwrap();
        let stale = LockFileContents {
            pid: 99999,
            hostname: "ghost".into(),
            started_at: Utc::now() - chrono::Duration::hours(1),
            heartbeat_at: Utc::now() - chrono::Duration::minutes(10),
            version: "0.0.0".into(),
            owns: vec![TriggerKind::Cron],
        };
        let path = tmp.path().join(LOCK_FILENAME);
        fs::write(&path, serde_json::to_vec_pretty(&stale).unwrap()).unwrap();

        let result = DaemonLock::check_active(tmp.path()).unwrap();
        assert!(result.is_none(), "stale lock must be reported as absent");
        assert!(!path.exists(), "stale lock file must be cleaned up");
    }

    #[test]
    fn is_stale_flags_old_heartbeat() {
        let mut contents = LockFileContents {
            pid: 1,
            hostname: "h".into(),
            started_at: Utc::now(),
            heartbeat_at: Utc::now(),
            version: "0".into(),
            owns: vec![],
        };
        assert!(!contents.is_stale());
        contents.heartbeat_at = Utc::now() - chrono::Duration::seconds(200);
        assert!(contents.is_stale());
    }

    #[test]
    fn is_stale_tolerates_clock_drift() {
        let contents = LockFileContents {
            pid: 1,
            hostname: "h".into(),
            started_at: Utc::now(),
            heartbeat_at: Utc::now() + chrono::Duration::seconds(60),
            version: "0".into(),
            owns: vec![],
        };
        // Future heartbeat (clock drift) must not be flagged stale.
        assert!(!contents.is_stale());
    }
}
