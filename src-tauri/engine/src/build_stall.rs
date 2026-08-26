//! Stall detection for the build session's design pass.
//!
//! # Why this exists
//!
//! An **unattended** (one-shot) build runs `MAX_TURNS` design turns with no
//! human in the loop. Each turn is a real Claude session — minutes of wall
//! clock and real spend — so a design pass that stops converging is not free:
//! it burns the whole turn cap and *then* fails.
//!
//! Observed on the kp App-master bench sweeps #21 / #23 / #24 (2026-08-26):
//! session `7991b75d…` logged `Gate-pass entry … events=["Progress","Progress"]
//! … turn=N resolved=0 coverage_caps=0` for **all 12 turns**, ~64 minutes, and
//! then failed at the cap. The P6h retry built the same spec in ~15 minutes, so
//! the run was not hard — that particular session was looping. Nothing in the
//! runner noticed, because nothing was comparing a turn to the one before it.
//!
//! # The signal
//!
//! Three per-turn counters, all cumulative, all cheap:
//!
//! | Signal | Rises when |
//! | --- | --- |
//! | `resolved_count` | a dimension cell was resolved (`resolved_cells.len()`) |
//! | `coverage_caps` | the LLM enumerated a capability (`coverage.len()`) |
//! | `design_hash` | the design output (resolved cells + `agent_ir`) changed |
//!
//! A turn is **flat** when all three are byte-identical to the previous turn's.
//! The hash is what makes it honest: a turn that rewrites a cell it already
//! resolved keeps `resolved_count` the same but is still doing work, and must
//! not count as a stall.
//!
//! # Deliberately not applied to interactive builds
//!
//! An interactive session is *supposed* to sit flat while the human reads the
//! clarifying question and types an answer — the runner blocks on
//! `input_rx.recv()` between turns. Only the unattended path can distinguish
//! "no progress" from "waiting for a person", so only the unattended path
//! enforces this.

/// One turn's progress fingerprint. Two turns are compared by equality; the
/// individual fields never need to be ordered or subtracted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TurnProgress {
    /// `resolved_cells.len()` after the turn's events were folded in.
    pub resolved_count: usize,
    /// `coverage.len()` — capabilities the gate ledger knows about.
    pub coverage_caps: usize,
    /// Fingerprint of the design output (see [`design_fingerprint`]).
    pub design_hash: u64,
}

/// Default number of consecutive flat turns that ends an unattended build.
///
/// Three, not one: a single flat turn is normal (the LLM spends a turn
/// enumerating, or re-reads its own context after a correction prompt), and two
/// happens. Three in a row has never been observed to recover in the sweeps —
/// every 12-turn burn logged `resolved=0` from turn 1.
pub const DEFAULT_STALL_TURNS: usize = 3;

/// Environment override for [`DEFAULT_STALL_TURNS`]. `0` disables the guard.
pub const STALL_TURNS_ENV: &str = "PERSONAS_ONESHOT_STALL_TURNS";

/// Has the design pass made no progress for `k` consecutive turns?
///
/// `history[0]` MUST be the **pre-turn baseline** (the state before turn 1 ran),
/// so that a build which never resolves anything at all is caught at turn `k`
/// rather than at turn `k + 1`. Every later entry is one completed turn.
///
/// `k == 0` disables the guard and always returns `false`.
pub fn stalled(history: &[TurnProgress], k: usize) -> bool {
    if k == 0 {
        return false;
    }
    // k flat turns need k + 1 snapshots to compare pairwise.
    if history.len() < k + 1 {
        return false;
    }
    history[history.len() - (k + 1)..]
        .windows(2)
        .all(|pair| pair[0] == pair[1])
}

/// The user-visible reason an unattended build was stopped early. The
/// `design_pass_stalled:` prefix is a contract — kp reads it off
/// `GET /api/kp/persona-requests/{id}` as `buildFailureReason` — so it is
/// produced here and pinned by a test rather than formatted at the call site.
pub fn stall_reason(k: usize, turns_taken: usize) -> String {
    format!(
        "design_pass_stalled: {k} turns without resolution. \
         The build made no progress across turns {}-{} (no new resolutions, no new \
         capabilities, unchanged design output), so it was stopped instead of \
         running out the turn cap. Retry the build.",
        turns_taken.saturating_sub(k) + 1,
        turns_taken,
    )
}

/// Parse the [`STALL_TURNS_ENV`] override. Absent, empty or unparseable falls
/// back to [`DEFAULT_STALL_TURNS`] — a typo must not silently disable a guard.
/// An explicit `0` does disable it.
pub fn parse_stall_turns(raw: Option<&str>) -> usize {
    match raw.map(str::trim) {
        Some(s) if !s.is_empty() => s.parse::<usize>().unwrap_or(DEFAULT_STALL_TURNS),
        _ => DEFAULT_STALL_TURNS,
    }
}

/// Read the stall threshold from the environment.
pub fn stall_turns_from_env() -> usize {
    parse_stall_turns(std::env::var(STALL_TURNS_ENV).ok().as_deref())
}

/// FNV-1a over the design output. Deliberately not `DefaultHasher`: this value
/// is only ever compared against another value produced by the same process,
/// but a documented, stable function is easier to reason about in a log line
/// than a hasher whose algorithm is explicitly unspecified.
pub fn design_fingerprint(resolved_cells_json: &str, agent_ir_json: Option<&str>) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET;
    let mut eat = |bytes: &[u8]| {
        for b in bytes {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(PRIME);
        }
    };
    eat(resolved_cells_json.as_bytes());
    // Separator so ("ab", None) and ("a", Some("b")) cannot collide.
    eat(b"\x1f");
    eat(agent_ir_json.unwrap_or("").as_bytes());
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(resolved: usize, caps: usize, hash: u64) -> TurnProgress {
        TurnProgress {
            resolved_count: resolved,
            coverage_caps: caps,
            design_hash: hash,
        }
    }

    /// The live failure: baseline + 3 turns that changed nothing at all.
    #[test]
    fn three_flat_turns_is_a_stall() {
        let flat = p(0, 0, 7);
        assert!(stalled(&[flat, flat, flat, flat], 3));
    }

    #[test]
    fn two_flat_turns_is_not_yet_a_stall() {
        let flat = p(0, 0, 7);
        assert!(!stalled(&[flat, flat, flat], 3));
    }

    #[test]
    fn a_new_resolution_resets_the_streak() {
        let a = p(0, 0, 7);
        let b = p(1, 0, 7);
        // baseline, flat, RESOLVED, flat  → only one flat turn since progress.
        assert!(!stalled(&[a, a, b, b], 3));
    }

    #[test]
    fn a_new_capability_resets_the_streak() {
        let a = p(0, 0, 7);
        let b = p(0, 1, 7);
        assert!(!stalled(&[a, a, b, b], 3));
    }

    /// The signal the counters cannot see: same cell count, rewritten content.
    #[test]
    fn a_changed_design_hash_resets_the_streak() {
        let a = p(4, 2, 7);
        let b = p(4, 2, 99);
        assert!(!stalled(&[a, a, b, b], 3));
    }

    #[test]
    fn the_streak_must_be_consecutive_and_most_recent() {
        let a = p(0, 0, 7);
        let b = p(1, 0, 8);
        // Three flat turns early, then progress: not stalled now.
        assert!(!stalled(&[a, a, a, a, b], 3));
    }

    #[test]
    fn a_flat_streak_that_resumes_after_progress_still_trips() {
        let a = p(0, 0, 7);
        let b = p(1, 0, 8);
        assert!(stalled(&[a, b, b, b, b], 3));
    }

    #[test]
    fn k_zero_disables_the_guard() {
        let flat = p(0, 0, 7);
        assert!(!stalled(&[flat; 12], 0));
    }

    #[test]
    fn an_empty_or_short_history_is_never_a_stall() {
        let flat = p(0, 0, 7);
        assert!(!stalled(&[], 3));
        assert!(!stalled(&[flat], 3));
        assert!(!stalled(&[flat, flat], 3));
    }

    #[test]
    fn k_one_trips_on_the_first_flat_turn() {
        let flat = p(0, 0, 7);
        assert!(stalled(&[flat, flat], 1));
        assert!(!stalled(&[flat, p(1, 0, 8)], 1));
    }

    #[test]
    fn the_env_override_falls_back_on_junk_but_honours_zero() {
        assert_eq!(parse_stall_turns(None), DEFAULT_STALL_TURNS);
        assert_eq!(parse_stall_turns(Some("")), DEFAULT_STALL_TURNS);
        assert_eq!(parse_stall_turns(Some("   ")), DEFAULT_STALL_TURNS);
        assert_eq!(parse_stall_turns(Some("banana")), DEFAULT_STALL_TURNS);
        assert_eq!(parse_stall_turns(Some("-1")), DEFAULT_STALL_TURNS);
        assert_eq!(parse_stall_turns(Some("0")), 0);
        assert_eq!(parse_stall_turns(Some(" 5 ")), 5);
    }

    #[test]
    fn the_reason_carries_the_machine_readable_prefix_and_the_turn_window() {
        let reason = stall_reason(3, 3);
        assert!(
            reason.starts_with("design_pass_stalled: 3 turns without resolution."),
            "kp parses this prefix off the wire: {reason}"
        );
        assert!(reason.contains("turns 1-3"), "{reason}");
        assert!(stall_reason(3, 12).contains("turns 10-12"));
    }

    #[test]
    fn the_fingerprint_separates_the_two_design_halves() {
        assert_eq!(
            design_fingerprint("{}", None),
            design_fingerprint("{}", Some(""))
        );
        assert_ne!(
            design_fingerprint("ab", None),
            design_fingerprint("a", Some("b"))
        );
        assert_ne!(
            design_fingerprint("{\"a\":1}", None),
            design_fingerprint("{\"a\":2}", None)
        );
        // Same cells, new agent_ir — the case the counters are blind to.
        assert_ne!(
            design_fingerprint("{\"a\":1}", Some("{\"v\":1}")),
            design_fingerprint("{\"a\":1}", Some("{\"v\":2}"))
        );
    }
}
