//! Performance gates over Fleet's scale-critical hot paths.
//!
//! **Why this exists.** Every performance claim in `docs/features/plugins/dev tools/fleet.md`
//! — "~4 MB and ~1% of one core" for 30 tiles, "claude processes 36 → 5",
//! "≈6.4 GB reclaimed" — comes from a one-off manual load test. Nothing re-runs
//! them, so a regression in the paths that make a 40-session fleet affordable
//! would land silently and only surface as "the app got slow with a lot of
//! sessions". This module makes the load-bearing ones executable.
//!
//! **Why RELATIVE invariants, not p99 baselines.** The obvious design (borrowed
//! from xAI's `grok-build`, whose PTY harness records p50/p99/jank into a
//! baseline JSON and fails on >15% drift) does not survive contact with this
//! repo:
//!
//!  - A committed absolute baseline is machine-specific. CI hardware, a laptop
//!    on battery, and a machine with 30 `claude` processes running produce
//!    wildly different microsecond numbers — the gate would flap.
//!  - `grok-build` derives frame boundaries from the `CSI ? 2026` synchronized-
//!    update markers its own TUI emits. Claude Code does not emit them (checked
//!    2026-07-27: the escape appears once in the bundled binary, isolated in
//!    native code ~43 MB from any other terminal escape, while the real TUI
//!    vocabulary — `?1049h/l`, `?25l/h`, `2J` — clusters elsewhere). There is no
//!    frame signal to percentile.
//!
//! So the gates here assert **ratios and scaling shape**, which hold on any
//! machine: "the incremental screen model must be dramatically cheaper than a
//! full re-parse", "ring push must not get slower as the ring fills". Those are
//! the properties the optimizations actually promised. The absolute-timing
//! helpers below are still provided for ad-hoc measurement, but nothing gates on
//! them.
//!
//! **The specific thing being guarded.** `OutputRing::render_screen` keeps a
//! persistent `vt100::Parser` fed incrementally by every `push`, so a steady-
//! state screen read is O(screen) instead of re-parsing up to 512 KiB. fleet.md
//! records why: orchestration wakes, screen-hash dedupes and previews all read
//! screens, and "a 40-session fleet was paying a full ring re-parse for each".
//! There is a correctness test for that path
//! (`render_screen_incremental_feed_matches_full_reparse`) but no performance
//! one — so a change that quietly dropped incrementality would still pass CI
//! while making the fleet unaffordable at scale. That is the gap this closes.
//!
//! **Local execution caveat (2026-07-27):** `app_lib`'s test binary currently
//! fails to launch on this machine with `STATUS_ENTRYPOINT_NOT_FOUND`
//! (0xC0000139) — a pre-existing loader issue, not caused by these tests
//! (`personas-core`'s own test binary runs fine, so it is specific to this
//! crate's link graph). These gates therefore run in CI until that is fixed.

use std::time::{Duration, Instant};

// ── Timing helpers ─────────────────────────────────────────────────────────

/// Wall-clock samples from repeating one operation.
#[derive(Debug, Clone)]
pub struct Samples {
    pub label: String,
    pub durations: Vec<Duration>,
}

impl Samples {
    /// Run `op` `iterations` times, timing each call.
    ///
    /// `warmup` runs are executed first and discarded — the first call through a
    /// cold path materializes the `vt100` parser and touches fresh pages, which
    /// would otherwise dominate a short run and mask the very difference we are
    /// measuring.
    pub fn collect<F: FnMut()>(label: &str, warmup: usize, iterations: usize, mut op: F) -> Self {
        for _ in 0..warmup {
            op();
        }
        let mut durations = Vec::with_capacity(iterations);
        for _ in 0..iterations {
            let t0 = Instant::now();
            op();
            durations.push(t0.elapsed());
        }
        Self {
            label: label.to_string(),
            durations,
        }
    }

    /// Median. Preferred over the mean everywhere in this module: a single
    /// scheduler preemption or GC-ish pause skews a mean badly at microsecond
    /// scale, and these gates must not flap on a busy machine.
    pub fn p50(&self) -> Duration {
        self.percentile(50.0)
    }

    pub fn p99(&self) -> Duration {
        self.percentile(99.0)
    }

    /// `pct` in `[0, 100]`. Returns zero for an empty sample set.
    pub fn percentile(&self, pct: f64) -> Duration {
        if self.durations.is_empty() {
            return Duration::ZERO;
        }
        let mut sorted = self.durations.clone();
        sorted.sort_unstable();
        let idx = ((pct / 100.0) * (sorted.len() - 1) as f64).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    /// One-line summary for test failure messages.
    pub fn summary(&self) -> String {
        format!(
            "{}: n={} p50={:?} p99={:?}",
            self.label,
            self.durations.len(),
            self.p50(),
            self.p99()
        )
    }
}

/// How many times faster `slow`'s median is than `fast`'s.
///
/// Guards against a zero denominator: a sub-microsecond median can round to zero
/// on a coarse clock, which would otherwise produce `inf` and a confusing
/// failure. Falls back to nanosecond comparison with a floor of 1ns.
pub fn speedup(slow: &Samples, fast: &Samples) -> f64 {
    let s = slow.p50().as_nanos().max(1) as f64;
    let f = fast.p50().as_nanos().max(1) as f64;
    s / f
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::registry::{OutputRing, OUTPUT_RING_CAP};

    /// Bytes resembling what `claude` actually writes: cursor-addressed redraws
    /// of a status line plus content, so the vt100 parser does representative
    /// work rather than walking a flat ASCII blob.
    fn tui_chunk(i: usize) -> Vec<u8> {
        format!(
            "\x1b[{row};1H\x1b[K● Working… ({i} tokens)\x1b[2;1Hsrc/lib.rs:{i}\r\n",
            row = (i % 20) + 1,
            i = i
        )
        .into_bytes()
    }

    /// Fill a ring to capacity, as a long-lived session's ring always is.
    fn filled_ring() -> OutputRing {
        let mut ring = OutputRing::new(OUTPUT_RING_CAP);
        let mut written = 0usize;
        let mut i = 0usize;
        while written < OUTPUT_RING_CAP + 64 * 1024 {
            let chunk = tui_chunk(i);
            written += chunk.len();
            ring.push(&chunk);
            i += 1;
        }
        ring
    }

    /// THE gate. `render_screen` keeps a persistent parser fed by `push`; a
    /// fresh ring must re-parse the whole 512 KiB buffer once. Steady-state
    /// reads must therefore be dramatically cheaper than that cold read.
    ///
    /// If someone drops incrementality, warm and cold converge and this fails.
    /// The threshold is deliberately loose (5×) — the real difference is orders
    /// of magnitude, and a loose bound is what keeps this from flapping on a
    /// loaded machine while still catching a total loss of the optimization.
    #[test]
    fn render_screen_incremental_is_far_cheaper_than_full_reparse() {
        // Cold: a brand-new ring each time, so the first render_screen pays the
        // full catch-up parse. Rebuilding the ring is NOT timed.
        let mut cold_durations = Vec::new();
        for _ in 0..5 {
            let mut ring = filled_ring();
            let t0 = Instant::now();
            let _ = ring.render_screen(24, 80);
            cold_durations.push(t0.elapsed());
        }
        let cold = Samples {
            label: "render_screen (cold, full re-parse)".into(),
            durations: cold_durations,
        };

        // Warm: same ring, parser already materialized and kept current.
        let mut ring = filled_ring();
        let _ = ring.render_screen(24, 80);
        let warm = Samples::collect("render_screen (warm, incremental)", 5, 200, || {
            let _ = ring.render_screen(24, 80);
        });

        let ratio = speedup(&cold, &warm);
        assert!(
            ratio >= 5.0,
            "incremental screen model lost its advantage — a 40-session fleet \
             pays a full ring re-parse on every orchestration wake, screen-hash \
             dedupe and preview.\n  {}\n  {}\n  speedup={ratio:.1}x (want >=5x)",
            cold.summary(),
            warm.summary()
        );
    }

    /// A resize rebuilds the parser at the new dims; the NEXT read must be warm
    /// again. Guards the `parser_dims` invalidation from degrading into a
    /// rebuild on every call (which would make every resize permanently costly).
    #[test]
    fn render_screen_rewarms_after_resize() {
        let mut ring = filled_ring();
        let _ = ring.render_screen(24, 80);
        let _ = ring.render_screen(30, 100); // triggers one rebuild
        let warm = Samples::collect("render_screen after resize", 5, 100, || {
            let _ = ring.render_screen(30, 100);
        });
        let cold = {
            let mut r = filled_ring();
            let t0 = Instant::now();
            let _ = r.render_screen(30, 100);
            Samples {
                label: "render_screen (cold)".into(),
                durations: vec![t0.elapsed()],
            }
        };
        assert!(
            speedup(&cold, &warm) >= 5.0,
            "post-resize reads never re-warmed — every read is rebuilding the \
             parser.\n  {}\n  {}",
            cold.summary(),
            warm.summary()
        );
    }

    /// `push` is on the PTY reader's hot path for EVERY session, so its cost
    /// must not grow as the ring fills — the ring trims from the front, and a
    /// non-amortized trim (or a full re-parse per push) would show up as the
    /// full ring being markedly slower than the empty one.
    #[test]
    fn ring_push_cost_does_not_grow_as_ring_fills() {
        let chunk = tui_chunk(42);

        let mut empty_ring = OutputRing::new(OUTPUT_RING_CAP);
        let empty = Samples::collect("push (empty ring)", 50, 500, || {
            empty_ring.push(&chunk);
        });

        let mut full_ring = filled_ring();
        let full = Samples::collect("push (full ring)", 50, 500, || {
            full_ring.push(&chunk);
        });

        // Generous bound: we are catching an O(n) regression, not policing noise.
        let ratio = speedup(&full, &empty);
        assert!(
            ratio <= 10.0,
            "push got much more expensive on a full ring — this runs per PTY \
             chunk per session.\n  {}\n  {}\n  ratio={ratio:.1}x (want <=10x)",
            empty.summary(),
            full.summary()
        );
    }

    // ── helper self-tests (pure, no Fleet types) ───────────────────────────

    #[test]
    fn percentile_is_ordinal_and_clamped() {
        // Odd length: the median is unambiguous, so this pins the intent.
        let odd = Samples {
            label: "odd".into(),
            durations: (1..=101).map(Duration::from_micros).collect(),
        };
        assert_eq!(odd.p50(), Duration::from_micros(51));
        assert_eq!(odd.percentile(0.0), Duration::from_micros(1));
        assert_eq!(odd.percentile(100.0), Duration::from_micros(101));

        // Even length: NEAREST-RANK over a zero-based index, matching the
        // reference implementation this was adapted from —
        // `idx = round(pct/100 * (len-1))`. For 1..=100 that is
        // `round(0.5 * 99) = 50`, so p50 is the 51st value, not the 50th.
        // Asserted explicitly because it reads as an off-by-one otherwise.
        let even = Samples {
            label: "even".into(),
            durations: (1..=100).map(Duration::from_micros).collect(),
        };
        assert_eq!(even.p50(), Duration::from_micros(51));
        assert_eq!(even.p99(), Duration::from_micros(99));
        assert_eq!(even.percentile(100.0), Duration::from_micros(100));
    }

    #[test]
    fn percentile_of_empty_is_zero_not_a_panic() {
        let s = Samples {
            label: "empty".into(),
            durations: vec![],
        };
        assert_eq!(s.percentile(50.0), Duration::ZERO);
    }

    #[test]
    fn speedup_handles_sub_microsecond_medians() {
        let zero = Samples {
            label: "z".into(),
            durations: vec![Duration::ZERO],
        };
        let ten = Samples {
            label: "t".into(),
            durations: vec![Duration::from_nanos(10)],
        };
        // Must not divide by zero or yield inf.
        assert!(speedup(&ten, &zero).is_finite());
        assert_eq!(speedup(&ten, &zero), 10.0);
    }
}
