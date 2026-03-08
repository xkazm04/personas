use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How often (in `check()` calls) to trigger an automatic prune pass.
const AUTO_PRUNE_INTERVAL: u64 = 100;

/// Sliding-window rate limiter using in-memory token buckets.
///
/// Each key (e.g. source type or trigger ID) gets its own bucket with
/// a configurable window and max event count.
pub struct RateLimiter {
    /// Per-key buckets: key → list of timestamps within the window.
    buckets: Mutex<HashMap<String, Vec<Instant>>>,
    /// Monotonic counter of `check()` calls, used to trigger periodic pruning.
    call_count: AtomicU64,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            call_count: AtomicU64::new(0),
        }
    }

    /// Attempt to consume one token for `key`.
    ///
    /// Returns `Ok(())` if allowed, or `Err(retry_after_secs)` with the
    /// number of seconds until the oldest entry in the window expires.
    pub fn check(&self, key: &str, max_events: usize, window: Duration) -> Result<(), u64> {
        let now = Instant::now();
        let cutoff = now - window;

        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        let timestamps = buckets.entry(key.to_string()).or_default();

        // Evict expired entries
        timestamps.retain(|t| *t > cutoff);

        if timestamps.len() >= max_events {
            // Calculate how long until the oldest entry expires
            let oldest = timestamps[0];
            let retry_after = window
                .checked_sub(now.duration_since(oldest))
                .unwrap_or(Duration::from_secs(1));
            return Err(retry_after.as_secs().max(1));
        }

        timestamps.push(now);

        // Periodically prune fully-expired buckets to prevent unbounded memory growth.
        // We do this while already holding the lock to avoid a second lock acquisition.
        if self.call_count.fetch_add(1, Ordering::Relaxed) % AUTO_PRUNE_INTERVAL == 0 {
            buckets.retain(|_, ts| {
                ts.retain(|t| *t > cutoff);
                !ts.is_empty()
            });
        }

        Ok(())
    }

    /// Return the current event count for each key within the given window.
    ///
    /// Used by the tier usage dashboard to show how many events have been
    /// consumed against the tier limit.
    pub fn usage_snapshot(&self, window: Duration) -> Vec<(String, usize)> {
        let now = Instant::now();
        let cutoff = now - window;
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        buckets
            .iter_mut()
            .map(|(key, timestamps)| {
                timestamps.retain(|t| *t > cutoff);
                (key.clone(), timestamps.len())
            })
            .filter(|(_, count)| *count > 0)
            .collect()
    }

    /// Periodically prune empty or fully-expired buckets to prevent unbounded
    /// memory growth. Called opportunistically, not on every request.
    pub fn prune(&self, window: Duration) {
        let cutoff = Instant::now() - window;
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        buckets.retain(|_, timestamps| {
            timestamps.retain(|t| *t > cutoff);
            !timestamps.is_empty()
        });
    }
}

// ── Window durations ─────────────────────────────────────────────────────
// Max events per tier are defined in engine::tier::TierConfig.

/// Window duration for event source rate limiting.
pub const EVENT_SOURCE_WINDOW: Duration = Duration::from_secs(60);

/// Window duration for webhook rate limiting.
pub const WEBHOOK_TRIGGER_WINDOW: Duration = Duration::from_secs(60);

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_allows_within_limit() {
        let rl = RateLimiter::new();
        for _ in 0..5 {
            assert!(rl.check("key", 5, Duration::from_secs(60)).is_ok());
        }
    }

    #[test]
    fn test_rejects_over_limit() {
        let rl = RateLimiter::new();
        for _ in 0..5 {
            rl.check("key", 5, Duration::from_secs(60)).unwrap();
        }
        let result = rl.check("key", 5, Duration::from_secs(60));
        assert!(result.is_err());
    }

    #[test]
    fn test_separate_keys() {
        let rl = RateLimiter::new();
        for _ in 0..3 {
            rl.check("a", 3, Duration::from_secs(60)).unwrap();
        }
        // "a" is exhausted but "b" should still work
        assert!(rl.check("a", 3, Duration::from_secs(60)).is_err());
        assert!(rl.check("b", 3, Duration::from_secs(60)).is_ok());
    }

    #[test]
    fn test_window_expiry() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);
        for _ in 0..3 {
            rl.check("key", 3, short_window).unwrap();
        }
        assert!(rl.check("key", 3, short_window).is_err());
        // Wait for the window to expire
        thread::sleep(Duration::from_millis(60));
        assert!(rl.check("key", 3, short_window).is_ok());
    }

    #[test]
    fn test_prune_removes_expired_buckets() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);
        rl.check("key1", 10, short_window).unwrap();
        thread::sleep(Duration::from_millis(60));
        rl.prune(short_window);
        let buckets = rl.buckets.lock().unwrap();
        assert!(buckets.is_empty());
    }

    #[test]
    fn test_auto_prune_on_check_interval() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);

        // Create an expired bucket under a different key
        rl.check("old_key", 1000, short_window).unwrap();
        thread::sleep(Duration::from_millis(150));

        // Advance call_count so the next fetch_add returns a multiple of AUTO_PRUNE_INTERVAL
        rl.call_count.store(super::AUTO_PRUNE_INTERVAL, Ordering::Relaxed);

        // This call should trigger auto-prune (count hits the interval boundary)
        rl.check("new_key", 1000, short_window).unwrap();

        let buckets = rl.buckets.lock().unwrap();
        // "old_key" should have been pruned away
        assert!(!buckets.contains_key("old_key"), "expired bucket should be auto-pruned");
        // "new_key" should still be present (just inserted)
        assert!(buckets.contains_key("new_key"), "active bucket should remain");
    }
}
