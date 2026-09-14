//! Remembered usage, carried forward when a plan cannot be read.
//!
//! A stored plan is unreachable more often than it is broken: the endpoint
//! rate-limits, the network drops, a token is mid-refresh. Each successful
//! read is persisted with its stamp, and when the next read fails the last
//! one is PROJECTED to now rather than replaced with a blank card:
//!
//!   • a window whose reset is still ahead keeps its utilisation — this
//!     machine did not use the plan, so it cannot have gone down, and if
//!     something else used it the figure is a floor, which the UI says;
//!   • a window whose reset has passed has reset: utilisation 0. The weekly
//!     window rolls on a fixed weekly cadence, so its next reset is the old
//!     one advanced by whole weeks into the future; the 5-hour window only
//!     starts on the first message, so its next reset is unknown.
//!
//! Not precise, and never claimed to be — the view carries the stamp it was
//! projected from, and the strip renders such meters as estimates.

use super::super::claude_usage::ClaudeUsageWindow;

/// Carry `last` (read at `last_at_ms`) forward to `now_ms`.
pub fn project_usage(last: &[ClaudeUsageWindow], now_ms: i64) -> Vec<ClaudeUsageWindow> {
    last.iter()
        .map(|w| {
            let Some(reset) = w.resets_at_ms else {
                return w.clone();
            };
            if reset > now_ms {
                return w.clone();
            }
            // The window has rolled over since the read.
            let rolling_weekly = w.window_ms >= 24 * 3_600_000;
            let next = if rolling_weekly && w.window_ms > 0 {
                let periods = (now_ms - reset) / w.window_ms + 1;
                Some(reset + periods * w.window_ms)
            } else {
                None
            };
            ClaudeUsageWindow {
                key: w.key.clone(),
                utilization_pct: 0.0,
                resets_at_ms: next,
                window_ms: w.window_ms,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: i64 = 3_600_000;
    const D: i64 = 24 * H;

    fn w(key: &str, pct: f64, reset: Option<i64>, window: i64) -> ClaudeUsageWindow {
        ClaudeUsageWindow {
            key: key.into(),
            utilization_pct: pct,
            resets_at_ms: reset,
            window_ms: window,
        }
    }

    #[test]
    fn keeps_windows_whose_reset_is_still_ahead() {
        let now = 1_000 * H;
        let last = vec![
            w("five_hour", 42.0, Some(now + 2 * H), 5 * H),
            w("seven_day", 10.0, Some(now + D), 7 * D),
        ];
        let out = project_usage(&last, now);
        assert_eq!(out, last);
    }

    #[test]
    fn a_rolled_five_hour_window_reads_empty_with_no_reset() {
        let now = 1_000 * H;
        let out = project_usage(&[w("five_hour", 90.0, Some(now - H), 5 * H)], now);
        assert_eq!(out[0].utilization_pct, 0.0);
        assert_eq!(out[0].resets_at_ms, None);
    }

    #[test]
    fn a_rolled_weekly_window_advances_its_reset_by_whole_weeks() {
        let now = 100 * D;
        // Reset was 10 days ago: two periods must pass to land in the future.
        let out = project_usage(&[w("seven_day", 55.0, Some(now - 10 * D), 7 * D)], now);
        assert_eq!(out[0].utilization_pct, 0.0);
        assert_eq!(out[0].resets_at_ms, Some(now - 10 * D + 14 * D));
        // Reset exactly now: one period ahead.
        let out = project_usage(&[w("seven_day", 55.0, Some(now), 7 * D)], now);
        assert_eq!(out[0].resets_at_ms, Some(now + 7 * D));
    }

    #[test]
    fn a_window_without_a_reset_is_passed_through() {
        let now = 5 * H;
        let last = vec![w("five_hour", 0.0, None, 5 * H)];
        assert_eq!(project_usage(&last, now), last);
    }
}
