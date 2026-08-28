//! One lock for `PERSONAS_HOME`, shared by every brain test that needs a
//! throwaway on-disk brain.
//!
//! `disk::brain_root()` honours the `PERSONAS_HOME` environment variable, and
//! an environment variable is process-global while Rust runs tests on many
//! threads of one process. So any two tests that point it at their own temp
//! directory race, and the loser writes its markdown into the winner's brain —
//! or reads back a file that is not its own.
//!
//! The tree already knew this and solved it three times, with three mutexes
//! that cannot see each other (`sleep_cycle/tests.rs`, `cycle_report.rs`, and
//! `commands/core/data_portability/tests.rs`). Three locks over one global
//! serialize nothing between them: a `sleep_cycle` test and a `cycle_report`
//! test can still collide, because each holds a mutex the other never takes.
//!
//! This is that lock, once, for the `brain` module. `data_portability` keeps
//! its own for now — it is a different area with its own in-flight work, and
//! migrating it is a separate change.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

static HOME_LOCK: Mutex<()> = Mutex::new(());

/// A temp `PERSONAS_HOME` held for the lifetime of the guard.
///
/// Restores the previous value on drop rather than clearing it, so a test that
/// runs inside another's home (or on a machine where the operator has set the
/// variable for real) leaves the environment as it found it.
pub(crate) struct TestHome {
    dir: PathBuf,
    previous: Option<String>,
    // Declared last so it is dropped last: the environment must be restored
    // while the lock is still held, or the next test observes the restore.
    _guard: MutexGuard<'static, ()>,
}

impl TestHome {
    /// Claim the lock and point `PERSONAS_HOME` at a fresh directory.
    ///
    /// `tag` only makes the directory legible when a failing test leaves one
    /// behind; uniqueness comes from the uuid.
    pub(crate) fn new(tag: &str) -> Self {
        // A poisoned lock here means some other test panicked while holding
        // it. That is information about THAT test, not a reason to fail this
        // one, and the data it protects is an env var we are about to
        // overwrite anyway.
        let guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "personas_brain_test_{tag}_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create test brain home");
        let previous = std::env::var("PERSONAS_HOME").ok();
        std::env::set_var("PERSONAS_HOME", &dir);
        Self {
            dir,
            previous,
            _guard: guard,
        }
    }

    /// The directory `brain_root()` resolves to while this guard is alive.
    #[allow(dead_code)]
    pub(crate) fn path(&self) -> &std::path::Path {
        &self.dir
    }
}

impl Drop for TestHome {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(v) => std::env::set_var("PERSONAS_HOME", v),
            None => std::env::remove_var("PERSONAS_HOME"),
        }
        // Best-effort: a leftover temp dir is untidy, a panic in Drop while
        // unwinding from a failed assertion would abort the whole test binary
        // and hide which test actually failed.
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
