//! Clean-shutdown marker — the fact that separates "the operator quit" from
//! "the process died".
//!
//! Registry technique `session-continuation/stuck-loop-detection`, section
//! "The interruption that leaves no signature":
//!
//! > A clean shutdown is a fact, and it has to be recorded. A graceful stop
//! > writes a marker; a start that finds one skips the sweep entirely and
//! > deletes it. Without that marker every deliberate restart — an upgrade, a
//! > configuration reload, an operator's own restart — is indistinguishable
//! > from a crash.
//!
//! Personas is a desktop app the user quits several times a day. Without this
//! file every one of those quits manufactures a class of rows only a crash
//! should produce, and the operator learns to dismiss the surface. With it,
//! only an exit that never reached `RunEvent::Exit` — SIGKILL, power loss, a
//! Windows force-quit — leaves the marker absent, which is exactly the set of
//! exits the restart classification is for.
//!
//! # Fail mode
//!
//! Advisory, and it fails toward **sweeping** (registry technique
//! `session-continuation/advisory-guard-fail-mode`: derive the mode from what
//! the wrong direction costs). A marker we cannot read or delete is reported
//! absent, so the classification sweep runs. That direction is recoverable —
//! at worst a graceful restart classifies rows that were already finished. The
//! other direction is not: a false "clean shutdown" leaves `running` rows
//! nobody will ever reconcile, invisible, forever.
//!
//! # Ordering
//!
//! The marker is written **last**, after the drain, and never optimistically.
//! Absence of the marker is the crash signal, so anything written before the
//! teardown completes is a lie about a shutdown that had not happened yet.

use std::path::{Path, PathBuf};

/// Filename inside the app-data dir. Deliberately distinct from
/// `engine-leader.lock`: leadership answers "is another instance live?", this
/// answers "did the previous instance of *this* install exit on purpose?".
const MARKER_FILENAME: &str = "clean-shutdown.marker";

/// Absolute path of the marker for a given app-data dir.
pub fn marker_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(MARKER_FILENAME)
}

/// Record that this process is exiting on purpose. Call this **last** on the
/// graceful-exit path, after the work drain, so a crash mid-teardown still
/// reads as a crash.
///
/// Best-effort: a failure to write means the next boot classifies rows it did
/// not have to, which is the survivable direction.
pub fn record_clean_shutdown(app_data_dir: &Path) {
    let path = marker_path(app_data_dir);
    // The content is diagnostic only — presence is the whole signal. An RFC3339
    // stamp makes a stale marker readable to a human staring at the data dir.
    let stamp = chrono_now_rfc3339();
    if let Err(e) = std::fs::write(&path, stamp) {
        tracing::warn!(
            path = %path.display(),
            "Failed to write clean-shutdown marker: {e} - the next boot will \
             classify mid-run rows as if this were a crash"
        );
    }
}

/// Consume the marker: returns `true` iff the previous exit was graceful, and
/// deletes the marker either way so the *next* crash is not masked by it.
///
/// Every failure resolves to `false` (see the fail-mode note on this module).
pub fn take_clean_shutdown(app_data_dir: &Path) -> bool {
    let path = marker_path(app_data_dir);
    if !path.exists() {
        return false;
    }
    // Delete before reporting: a marker we could not remove would suppress the
    // sweep on every subsequent boot, including the ones after a real crash.
    match std::fs::remove_file(&path) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                "Clean-shutdown marker exists but could not be removed: {e} - \
                 treating the previous exit as unclean so the marker cannot \
                 suppress future sweeps"
            );
            false
        }
    }
}

/// Local RFC3339 stamp without pulling a formatting dependency into the
/// bottom of the graph. `chrono` is already a leaf dep of this crate.
fn chrono_now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch dir per test — core has no dev-dependency on `tempfile`
    /// and this crate is the one place that may not grow dependencies casually.
    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "personas_shutdown_marker_{}_{}_{}",
            tag,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The graceful path: write, then a boot finds it and skips the sweep.
    #[test]
    fn a_recorded_shutdown_is_seen_once_and_then_gone() {
        let dir = scratch("graceful");
        record_clean_shutdown(&dir);
        assert!(marker_path(&dir).exists(), "the marker must be on disk");

        assert!(
            take_clean_shutdown(&dir),
            "the boot after a graceful exit sees the marker"
        );
        assert!(
            !marker_path(&dir).exists(),
            "the marker is consumed, not left to mask the next crash"
        );
        assert!(
            !take_clean_shutdown(&dir),
            "a second boot with no new exit reads as unclean"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The crash path is the *absence* of the file. This is the case the whole
    /// mechanism turns on: `RunEvent::Exit` does not fire on SIGKILL, power
    /// loss, or a Windows force-quit, so nothing was written.
    #[test]
    fn an_absent_marker_is_a_crash() {
        let dir = scratch("crash");
        assert!(
            !take_clean_shutdown(&dir),
            "no marker means the previous exit was not graceful"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A marker left by a *previous* boot must not suppress today's sweep more
    /// than once, even if two boots race for it. Only the boot that removes it
    /// may claim the clean shutdown.
    #[test]
    fn only_one_boot_can_claim_a_single_marker() {
        let dir = scratch("once");
        record_clean_shutdown(&dir);
        let first = take_clean_shutdown(&dir);
        let second = take_clean_shutdown(&dir);
        assert!(first && !second, "the marker is claimed exactly once");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
