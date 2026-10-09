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
//! Only an exit that never reached `RunEvent::Exit` — SIGKILL, power loss, a
//! Windows force-quit — leaves the marker absent.
//!
//! # A fact, not a gate
//!
//! The marker used to make the boot skip the execution restart sweep. That
//! sweep is keyed on durable state (`status = 'running'`), not on recency, so
//! a quit that drained gives it nothing to manufacture — and a quit that did
//! not drain (the exit path does not drain persona executions) is the crash
//! case. Skipping it hid exactly those rows. Registry technique
//! `durable-agent-operations/close-is-a-controlled-crash`: close must leave
//! what a crash leaves, so recovery is one path. The sweep now runs on every
//! start (`restart_recovery::reconcile_after_exit` in the db crate) and the
//! marker only names the kind of exit in the log. The skip in
//! `stuck-loop-detection` fits a sweep keyed on recency, where a deliberate
//! restart really is indistinguishable from an interrupted one; a sweep keyed
//! on in-flight state needs no marker to tell them apart.
//!
//! # Fail mode
//!
//! A marker we cannot read or delete is reported absent. Since nothing gates
//! on it, the cost of either error is a misleading log line, nothing more.
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
/// Best-effort: a failure to write means the next boot logs this exit as
/// unclean. Nothing gates on the marker, so that is the whole cost.
pub fn record_clean_shutdown(app_data_dir: &Path) {
    let path = marker_path(app_data_dir);
    // The content is diagnostic only — presence is the whole signal. An RFC3339
    // stamp makes a stale marker readable to a human staring at the data dir.
    let stamp = chrono_now_rfc3339();
    if let Err(e) = std::fs::write(&path, stamp) {
        tracing::warn!(
            path = %path.display(),
            "Failed to write clean-shutdown marker: {e} - the next boot will \
             log this exit as unclean"
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
    // Delete before reporting: a marker we could not remove would label every
    // subsequent boot graceful, including the ones after a real crash.
    match std::fs::remove_file(&path) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                "Clean-shutdown marker exists but could not be removed: {e} - \
                 treating the previous exit as unclean so the marker cannot \
                 mislabel future exits"
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

    /// The graceful path: write, then a boot finds it once.
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

    /// A marker left by a *previous* boot must not be claimed more
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
