//! Engine-wide execution ceilings.
//!
//! These live in `personas-core` rather than in the engine because `validation`
//! clamps user-supplied timeouts against them, and `validation` sits below the
//! engine in the crate graph. A single `crate::engine::ENGINE_MAX_EXECUTION_MS`
//! reference was otherwise enough to drag all 157k LOC of `engine` into the
//! core layer — see the crate-split notes in `lib.rs`.
//!
//! `engine` re-exports both constants, so `crate::engine::ENGINE_MAX_EXECUTION_*`
//! keeps resolving for the ~dozen call sites that use it.

/// Hard engine-level ceiling for any single execution (20 minutes).
/// This is a non-overridable safety net that prevents runaway executions
/// regardless of per-persona timeout configuration.
pub const ENGINE_MAX_EXECUTION_SECS: u64 = 20 * 60;

/// Engine ceiling expressed in milliseconds for validation and clamping.
pub const ENGINE_MAX_EXECUTION_MS: i32 = (ENGINE_MAX_EXECUTION_SECS * 1000) as i32;

// ---------------------------------------------------------------------------
// Ingest / scheduling caps, moved down from `engine::limits` (crate-split 4a).
//
// `db::settings_keys` reads SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT, so
// the module had to sit below the data layer. Merged into this file rather than
// kept separate because both halves are the same thing — engine ceilings — and
// two `limits` modules in one crate would just invite the wrong import.
// ---------------------------------------------------------------------------

// =============================================================================
// Vector store
// =============================================================================

/// Vectors inserted per SQLite transaction. 500 keeps per-batch memory under
/// ~2 MB for a 1024-dim f32 embedding (~4 KB per row), which is well below
/// the threshold where the SQLite write lock would meaningfully block other
/// readers; smaller batches paid a measurable per-tx overhead in early
/// benchmarks.
pub const VECTOR_INSERT_BATCH: usize = 500;

// =============================================================================
// Knowledge-base ingestion
// =============================================================================

/// Hash algorithm used to fingerprint document contents for dedup. SHA-256
/// is overkill for collision resistance at our scale, but it's already
/// brought in by `bundle.rs` and ts-rs friends, so adding a faster hash
/// would mean a second dep + a second migration. Not worth it until
/// dedup-throughput becomes a measured bottleneck.
pub const KB_CONTENT_HASH_ALGORITHM: &str = "sha256";

// =============================================================================
// Backfill / scheduler
// =============================================================================

/// Hard ceiling on backfill events emitted per tick per trigger. Defends
/// against amplification when a trigger with a large `max_backfill` was
/// offline overnight — an every-minute trigger that missed 12 hours would
/// otherwise emit 720 events at the next tick and drown the queue.
pub const BACKFILL_HARD_CAP: usize = 100;

/// Default maximum scheduled executions a single persona may enqueue per
/// rolling hour. One per minute is the highest cadence currently supported by
/// the 5-field cron parser, so 60 preserves that intent while preventing
/// multi-trigger/backfill bursts from growing without bound.
pub const SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT: i64 = 60;

// =============================================================================
// Helpers
// =============================================================================

/// Apply a hard cap to a count, emitting a `tracing::debug!` line when the
/// requested value exceeds the cap so an operator can attribute clipped
/// behaviour without firing up a debugger.
#[inline]
pub fn cap_with_log(label: &'static str, requested: usize, cap: usize) -> usize {
    if requested > cap {
        tracing::debug!(
            label,
            requested,
            cap,
            "limit applied: {label} clipped from {requested} to {cap}"
        );
        cap
    } else {
        requested
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_passes_through_values_under_cap() {
        assert_eq!(cap_with_log("t", 50, 100), 50);
        assert_eq!(cap_with_log("t", 100, 100), 100);
    }

    #[test]
    fn cap_clips_values_over_cap() {
        assert_eq!(cap_with_log("t", 200, 100), 100);
    }

    #[test]
    fn vector_insert_batch_is_a_safe_default() {
        // The exact value isn't load-bearing for this test — we just want a
        // canary so a future bump is intentional rather than accidental.
        assert!(VECTOR_INSERT_BATCH >= 100, "VECTOR_INSERT_BATCH too low");
        assert!(
            VECTOR_INSERT_BATCH <= 5000,
            "VECTOR_INSERT_BATCH risks blocking the SQLite write lock"
        );
    }
}
