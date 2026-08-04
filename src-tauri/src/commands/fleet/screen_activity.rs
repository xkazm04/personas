//! Does a session's screen show *work*, or just chrome moving?
//!
//! **The gap this fills.** Fleet derives liveness from `last_pty_output_ms` —
//! whether bytes arrived. `docs/features/plugins/dev tools/fleet.md` is explicit
//! that this is a one-way signal: *"since claude redraws its status line
//! continuously even when idle, total PTY silence is a high-confidence 'the
//! process is frozen' signal (while output **presence** proves nothing about
//! work, which is why this field never feeds freshness)"*.
//!
//! So Fleet can detect a *dead* session but not a *stuck* one. A session whose
//! spinner is still animating while nothing progresses looks perfectly healthy:
//! bytes keep flowing, `last_pty_output_ms` keeps advancing, and no lane
//! notices. At 16-30 sessions that is exactly the failure an operator cannot
//! spot by eye.
//!
//! **What replaced the original plan.** This was going to read frame boundaries
//! from the `CSI ? 2026` synchronized-update markers, the way xAI's `grok-build`
//! PTY harness measures its own TUI. Claude Code does not emit them (verified
//! 2026-07-27 against the shipped binary), so there is no frame signal. The
//! substitute needs no cooperation from the child at all: Fleet already
//! reconstructs the rendered screen through a persistent `vt100` parser, so
//! comparing consecutive renders line-by-line says how much of the grid actually
//! moved. A spinner touches one line. Streaming output touches many.
//!
//! **Cost: zero added work.** Deltas are a byproduct of renders that already
//! happen — orchestration wakes, screen-hash dedupes, tile previews. Nothing
//! here schedules a render of its own.

/// How much of the screen changed between two consecutive renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenDelta {
    /// Lines whose content differs from the previous render.
    pub changed_lines: usize,
    /// Lines in the current render (trailing blanks already trimmed).
    pub total_lines: usize,
    /// When the comparison was taken. `i64` to match `personas_core::utils::now_ms`,
    /// which every other Fleet timestamp uses.
    pub at_ms: i64,
}

/// The verdict for one delta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenActivity {
    /// Nothing moved. With bytes still arriving this means pure repaint of an
    /// unchanged grid.
    Silent,
    /// Only chrome moved — a spinner frame, an elapsed-time counter. The
    /// session is alive but is not producing anything.
    Cosmetic,
    /// Enough of the grid changed to be real output.
    Working,
}

impl ScreenActivity {
    /// Stable token for logs. Matches the lowercase style of the other Fleet
    /// tokens so it reads consistently in the debug recorder.
    pub fn token(self) -> &'static str {
        match self {
            ScreenActivity::Silent => "silent",
            ScreenActivity::Cosmetic => "cosmetic",
            ScreenActivity::Working => "working",
        }
    }
}

/// Lines at or below which a change is treated as chrome.
///
/// Claude Code's status area is one line (spinner + elapsed + token count), and
/// a second line often carries the current tool or file. Three or more moving
/// lines is content. Deliberately a small constant rather than a fraction of the
/// screen: the status area does not grow with the terminal, so a percentage
/// would wrongly call five changed lines "cosmetic" on a tall window.
const COSMETIC_MAX_LINES: usize = 2;

/// Screens at or below this height cannot be judged — there is no room to
/// separate chrome from content, so any movement counts as work rather than
/// risking a false "stuck" verdict on a small pane.
const MIN_CLASSIFIABLE_LINES: usize = 4;

impl ScreenDelta {
    pub fn activity(&self) -> ScreenActivity {
        if self.changed_lines == 0 {
            return ScreenActivity::Silent;
        }
        if self.total_lines <= MIN_CLASSIFIABLE_LINES {
            return ScreenActivity::Working;
        }
        if self.changed_lines <= COSMETIC_MAX_LINES {
            return ScreenActivity::Cosmetic;
        }
        ScreenActivity::Working
    }

    /// Whether this sample can carry weight in a state decision.
    ///
    /// A screen at or below [`MIN_CLASSIFIABLE_LINES`] reports `Working` for
    /// ANY movement (see [`Self::activity`]) — a deliberate fail-safe so a
    /// small pane is never called stuck. That fail-safe becomes a hazard the
    /// moment a rule reads `Working` as *evidence*: a two-line screen would
    /// then vouch for a session forever, which is a "never stale" hole rather
    /// than a corroboration. Rules ask this first and fall back to their
    /// screen-free behaviour when it is false.
    pub fn classifiable(&self) -> bool {
        self.total_lines > MIN_CLASSIFIABLE_LINES
    }

    /// `changed/total working` — compact enough for a ticker line.
    pub fn summary(&self) -> String {
        format!(
            "{}/{} {}",
            self.changed_lines,
            self.total_lines,
            self.activity().token()
        )
    }
}

/// Cheap per-line fingerprints for delta comparison.
///
/// Hashes rather than retaining the lines themselves: a 40-session fleet would
/// otherwise hold 40 copies of every screen, and the *contents* are never needed
/// — only whether a line differs from last time. Also keeps the user's code out
/// of a long-lived buffer.
pub fn line_hashes(lines: &[String]) -> Vec<u64> {
    lines.iter().map(|l| fnv1a(l.as_bytes())).collect()
}

/// Count differing entries between two fingerprint lists.
///
/// A length change counts every added or removed line as changed — a screen that
/// grew by ten rows did ten rows of work.
pub fn changed_count(prev: &[u64], next: &[u64]) -> usize {
    let overlap = prev.len().min(next.len());
    let differing = (0..overlap).filter(|&i| prev[i] != next[i]).count();
    differing + prev.len().abs_diff(next.len())
}

/// FNV-1a. Chosen over `DefaultHasher` because it is stable across releases and
/// process runs — these fingerprints are only ever compared to the previous
/// render in the same process, but a stable hash keeps the behaviour
/// reproducible in tests and in a debug log read after the fact.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delta(changed: usize, total: usize) -> ScreenDelta {
        ScreenDelta {
            changed_lines: changed,
            total_lines: total,
            at_ms: 0,
        }
    }

    #[test]
    fn no_movement_is_silent() {
        assert_eq!(delta(0, 24).activity(), ScreenActivity::Silent);
    }

    #[test]
    fn spinner_sized_movement_is_cosmetic() {
        // The case the whole module exists for: bytes keep arriving and
        // last_pty_output_ms keeps advancing, but only the status area moves.
        assert_eq!(delta(1, 24).activity(), ScreenActivity::Cosmetic);
        assert_eq!(delta(2, 24).activity(), ScreenActivity::Cosmetic);
    }

    #[test]
    fn content_sized_movement_is_working() {
        assert_eq!(delta(3, 24).activity(), ScreenActivity::Working);
        assert_eq!(delta(20, 24).activity(), ScreenActivity::Working);
    }

    #[test]
    fn tiny_screens_are_never_called_cosmetic() {
        // Too little room to separate chrome from content — fail toward
        // "working" so a small pane is never reported as stuck.
        assert_eq!(delta(1, 4).activity(), ScreenActivity::Working);
        assert_eq!(delta(1, 2).activity(), ScreenActivity::Working);
        // ...but genuinely frozen still reads as silent.
        assert_eq!(delta(0, 2).activity(), ScreenActivity::Silent);
    }

    #[test]
    fn cosmetic_threshold_does_not_scale_with_screen_height() {
        // A tall window must not make 5 changed lines "chrome".
        assert_eq!(delta(5, 200).activity(), ScreenActivity::Working);
        assert_eq!(delta(2, 200).activity(), ScreenActivity::Cosmetic);
    }

    #[test]
    fn identical_screens_have_no_changes() {
        let a = line_hashes(&["one".into(), "two".into(), "three".into()]);
        assert_eq!(changed_count(&a, &a), 0);
    }

    #[test]
    fn only_the_differing_line_counts() {
        let before = line_hashes(&["● Working (12s)".into(), "src/lib.rs".into()]);
        let after = line_hashes(&["● Working (13s)".into(), "src/lib.rs".into()]);
        assert_eq!(changed_count(&before, &after), 1);
    }

    #[test]
    fn growth_counts_every_new_line() {
        let before = line_hashes(&["a".into(), "b".into()]);
        let after = line_hashes(&["a".into(), "b".into(), "c".into(), "d".into()]);
        assert_eq!(changed_count(&before, &after), 2);
    }

    #[test]
    fn shrink_counts_removed_lines() {
        let before = line_hashes(&["a".into(), "b".into(), "c".into()]);
        let after = line_hashes(&["a".into()]);
        assert_eq!(changed_count(&before, &after), 2);
    }

    #[test]
    fn first_render_against_empty_is_all_new() {
        let after = line_hashes(&["a".into(), "b".into(), "c".into()]);
        assert_eq!(changed_count(&[], &after), 3);
    }

    #[test]
    fn hash_is_order_and_content_sensitive() {
        assert_ne!(fnv1a(b"ab"), fnv1a(b"ba"));
        assert_ne!(fnv1a(b"a"), fnv1a(b"a "));
        assert_eq!(fnv1a(b"same"), fnv1a(b"same"));
    }

    #[test]
    fn tiny_screens_are_not_classifiable_evidence() {
        // The `Working`-on-a-tiny-screen fail-safe must never be READ as proof
        // of work — that would make a 2-line pane un-stale-able forever.
        assert!(!delta(1, 4).classifiable());
        assert!(!delta(0, 2).classifiable());
        assert!(delta(1, 5).classifiable());
        assert!(delta(3, 24).classifiable());
    }

    #[test]
    fn summary_is_compact_and_content_free() {
        let d = delta(2, 24);
        assert_eq!(d.summary(), "2/24 cosmetic");
    }
}
