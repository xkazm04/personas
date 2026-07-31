use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How often (in `check()` calls) to trigger an automatic prune pass.
const AUTO_PRUNE_INTERVAL: u64 = 100;

/// One key's sliding window of event timestamps, plus a once-only latch for
/// the "rejecting" crossing (see `RateLimiter::check`).
#[derive(Default)]
struct Bucket {
    timestamps: Vec<Instant>,
    /// True once we've already logged the *current* streak of rejections for
    /// this key. Reset the moment a request is admitted again, so the next
    /// streak of rejections warns exactly once instead of the latch going
    /// stale forever.
    warned: bool,
}

/// Sliding-window rate limiter using in-memory token buckets.
///
/// Each key (e.g. source type or trigger ID) gets its own bucket with
/// a configurable window and max event count.
pub struct RateLimiter {
    /// Per-key buckets: key -> timestamps within the window + warn latch.
    buckets: Mutex<HashMap<String, Bucket>>,
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
        let bucket = buckets.entry(key.to_string()).or_default();

        // Evict expired entries
        bucket.timestamps.retain(|t| *t > cutoff);

        if bucket.timestamps.len() >= max_events {
            // After retain the bucket may be empty (e.g. max_events == 0, or all
            // entries expired between the len check and now). Guard against
            // index-out-of-bounds on an empty vec.
            if bucket.timestamps.is_empty() {
                return Err(window.as_secs().max(1));
            }
            // Calculate how long until the oldest entry expires
            let oldest = bucket.timestamps[0];
            let retry_after = window
                .checked_sub(now.duration_since(oldest))
                .unwrap_or(Duration::from_secs(1));
            let retry_after_secs = retry_after.as_secs().max(1);
            // Signal the crossing, not the level: warn once per rejection
            // streak (latched on `bucket.warned`), not once per rejected
            // call -- a caller hammering a limit would otherwise flood the
            // log with one warning per request. The latch resets below the
            // moment a request is admitted again.
            if !bucket.warned {
                bucket.warned = true;
                tracing::warn!(
                    rate_key = %key,
                    retry_after_secs = retry_after_secs,
                    bucket_depth = bucket.timestamps.len(),
                    max_events = max_events,
                    window_secs = window.as_secs(),
                    "Rate limit rejected request"
                );
            }
            return Err(retry_after_secs);
        }

        bucket.warned = false;
        bucket.timestamps.push(now);

        // Periodically prune fully-expired buckets to prevent unbounded memory growth.
        // We do this while already holding the lock to avoid a second lock acquisition.
        if self.call_count.fetch_add(1, Ordering::Relaxed) % AUTO_PRUNE_INTERVAL == 0 {
            // Log high-watermark summary before pruning
            if !buckets.is_empty() {
                let mut high_watermark_key = String::new();
                let mut high_watermark_depth: usize = 0;
                let active_buckets = buckets
                    .iter()
                    .filter(|(_, b)| b.timestamps.iter().any(|t| *t > cutoff))
                    .count();
                for (k, b) in buckets.iter() {
                    let live = b.timestamps.iter().filter(|t| **t > cutoff).count();
                    if live > high_watermark_depth {
                        high_watermark_depth = live;
                        high_watermark_key = k.clone();
                    }
                }
                if high_watermark_depth > 0 {
                    tracing::info!(
                        active_buckets = active_buckets,
                        high_watermark_key = %high_watermark_key,
                        high_watermark_depth = high_watermark_depth,
                        "Rate limiter periodic summary"
                    );
                }
            }

            buckets.retain(|_, b| {
                b.timestamps.retain(|t| *t > cutoff);
                !b.timestamps.is_empty()
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
            .map(|(key, bucket)| {
                bucket.timestamps.retain(|t| *t > cutoff);
                (key.clone(), bucket.timestamps.len())
            })
            .filter(|(_, count)| *count > 0)
            .collect()
    }

    /// Periodically prune empty or fully-expired buckets to prevent unbounded
    /// memory growth. Called opportunistically, not on every request.
    pub fn prune(&self, window: Duration) {
        let cutoff = Instant::now() - window;
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        buckets.retain(|_, bucket| {
            bucket.timestamps.retain(|t| *t > cutoff);
            !bucket.timestamps.is_empty()
        });
    }
}

// -- Window durations -----------------------------------------------------
// Max events per tier are defined in engine::tier::TierConfig.

/// Window duration for event source rate limiting.
pub const EVENT_SOURCE_WINDOW: Duration = Duration::from_secs(60);

/// Window duration for webhook rate limiting.
pub const WEBHOOK_TRIGGER_WINDOW: Duration = Duration::from_secs(60);

/// Window duration for per-tool execution rate limiting.
pub const TOOL_EXECUTION_WINDOW: Duration = Duration::from_secs(60);

/// Default max tool executions per minute per tool.
pub const TOOL_EXECUTION_MAX_PER_MINUTE: usize = 30;

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
    fn test_zero_max_events_does_not_panic() {
        let rl = RateLimiter::new();
        // max_events = 0 means nothing is ever allowed; must not panic.
        let result = rl.check("key", 0, Duration::from_secs(60));
        assert!(result.is_err());
    }

    #[test]
    fn test_all_entries_expired_with_zero_max_does_not_panic() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);
        // Fill bucket then let entries expire
        rl.check("key", 5, short_window).unwrap();
        thread::sleep(Duration::from_millis(60));
        // Now call with max_events = 0: retain evicts everything, len (0) >= 0 is true
        let result = rl.check("key", 0, short_window);
        assert!(result.is_err());
    }

    #[test]
    fn test_warn_latch_sets_on_first_rejection_and_stays_set() {
        // Regression: `check` used to `tracing::warn!` on EVERY rejection --
        // a caller hammering a limit would flood the log with one warning
        // per call. The fix signals the crossing (first rejection) via a
        // once-only latch, not the level (every rejection).
        let rl = RateLimiter::new();
        let window = Duration::from_secs(60);
        for _ in 0..3 {
            rl.check("key", 3, window).unwrap();
        }
        assert!(rl.check("key", 3, window).is_err());
        {
            let buckets = rl.buckets.lock().unwrap();
            assert!(
                buckets.get("key").unwrap().warned,
                "first rejection in a streak must set the latch"
            );
        }
        // A second rejection in the same streak leaves the latch set (i.e. a
        // second `tracing::warn!` would be suppressed) rather than being a
        // fresh, independent crossing.
        assert!(rl.check("key", 3, window).is_err());
        {
            let buckets = rl.buckets.lock().unwrap();
            assert!(buckets.get("key").unwrap().warned);
        }
    }

    #[test]
    fn test_warn_latch_resets_after_admission_so_next_streak_warns_again() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);
        for _ in 0..2 {
            rl.check("key", 2, short_window).unwrap();
        }
        assert!(rl.check("key", 2, short_window).is_err());
        {
            let buckets = rl.buckets.lock().unwrap();
            assert!(buckets.get("key").unwrap().warned);
        }
        // Once the window clears, the next admitted request must reset the
        // latch -- otherwise a later, independent rejection streak would
        // silently never warn again.
        thread::sleep(Duration::from_millis(60));
        rl.check("key", 2, short_window).unwrap();
        {
            let buckets = rl.buckets.lock().unwrap();
            assert!(
                !buckets.get("key").unwrap().warned,
                "admission must reset the warn latch for the next streak"
            );
        }
    }

    #[test]
    fn test_auto_prune_on_check_interval() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);

        // Create an expired bucket under a different key
        rl.check("old_key", 1000, short_window).unwrap();
        thread::sleep(Duration::from_millis(150));

        // Advance call_count so the next fetch_add returns a multiple of AUTO_PRUNE_INTERVAL
        rl.call_count
            .store(super::AUTO_PRUNE_INTERVAL, Ordering::Relaxed);

        // This call should trigger auto-prune (count hits the interval boundary)
        rl.check("new_key", 1000, short_window).unwrap();

        let buckets = rl.buckets.lock().unwrap();
        // "old_key" should have been pruned away
        assert!(
            !buckets.contains_key("old_key"),
            "expired bucket should be auto-pruned"
        );
        // "new_key" should still be present (just inserted)
        assert!(
            buckets.contains_key("new_key"),
            "active bucket should remain"
        );
    }
}
