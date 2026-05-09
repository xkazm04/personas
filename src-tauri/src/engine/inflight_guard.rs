//! In-flight exclusivity guard for keyed operations.
//!
//! Companion primitive to [`crate::engine::rate_limiter::RateLimiter`]: where
//! the rate limiter caps frequency over a window, this guard enforces that at
//! most one operation per key is in flight at any moment.
//!
//! Originally lived as a `LazyLock<Mutex<HashSet<String>>>` static inside
//! `commands::tools::automations` to prevent double-trigger of the same
//! automation. Lifted here so future trigger/event/chain callers reuse one
//! mutex-management module instead of growing N copies — see
//! `.claude/commands/unclear-wins/idea-6157bb9b-reactions-collapse-events-trig.md`
//! (descoped to this single-subsystem win on 2026-05-09).

use std::collections::HashSet;
use std::sync::Mutex;

/// Tracks the set of keys currently in flight. Re-entry while a key is
/// in-flight returns `false` from [`InflightGuard::acquire`]; the caller
/// should refuse the duplicate request.
///
/// Recovers from poison automatically (`unwrap_or_else(|e| e.into_inner())`)
/// — a panic in another caller does not seal the guard.
#[derive(Default)]
pub struct InflightGuard {
    keys: Mutex<HashSet<String>>,
}

impl InflightGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `true` if the key was newly inserted (caller may proceed),
    /// `false` if it was already in flight (caller must refuse).
    pub fn acquire(&self, key: &str) -> bool {
        let mut keys = self.keys.lock().unwrap_or_else(|e| e.into_inner());
        keys.insert(key.to_string())
    }

    /// Marks a key as no longer in flight. Idempotent — releasing a key that
    /// was not held is a silent no-op.
    pub fn release(&self, key: &str) {
        let mut keys = self.keys.lock().unwrap_or_else(|e| e.into_inner());
        keys.remove(key);
    }

    /// Test/diagnostic helper: number of keys currently in flight.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.keys.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

/// RAII handle returned by [`InflightGuard::guard`]. Releases the key on
/// drop, so callers cannot forget to release on early-return paths.
pub struct InflightHandle<'a> {
    guard: &'a InflightGuard,
    key: String,
}

impl Drop for InflightHandle<'_> {
    fn drop(&mut self) {
        self.guard.release(&self.key);
    }
}

impl InflightGuard {
    /// Acquire and return an RAII handle. `Some(handle)` means the caller
    /// may proceed; `None` means the key is already in flight.
    pub fn guard<'a>(&'a self, key: &str) -> Option<InflightHandle<'a>> {
        if self.acquire(key) {
            Some(InflightHandle {
                guard: self,
                key: key.to_string(),
            })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_then_release() {
        let g = InflightGuard::new();
        assert!(g.acquire("a"));
        assert!(!g.acquire("a"), "second acquire of same key must fail");
        assert!(g.acquire("b"), "different key must still acquire");
        g.release("a");
        assert!(g.acquire("a"), "released key must be re-acquirable");
    }

    #[test]
    fn release_unheld_is_noop() {
        let g = InflightGuard::new();
        g.release("never-held");
        assert_eq!(g.len(), 0);
    }

    #[test]
    fn handle_releases_on_drop() {
        let g = InflightGuard::new();
        {
            let _h = g.guard("a").expect("first guard acquires");
            assert!(g.guard("a").is_none(), "second guard rejected while held");
            assert_eq!(g.len(), 1);
        }
        assert_eq!(g.len(), 0, "drop must release");
        assert!(g.guard("a").is_some(), "key reusable after drop");
    }

    #[test]
    fn handle_releases_on_panic_unwind() {
        // Validate that a panic in the protected block still releases the key
        // via Drop, so the static guard does not leak permanently-locked keys.
        let g = std::sync::Arc::new(InflightGuard::new());
        let g_clone = g.clone();
        let result = std::panic::catch_unwind(move || {
            let _h = g_clone.guard("a").expect("acquire");
            panic!("simulated work failure");
        });
        assert!(result.is_err());
        assert_eq!(g.len(), 0, "Drop ran on unwind");
    }
}
