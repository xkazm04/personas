//! Centralised magic-constants for the vector / memory / backfill pipeline.
//!
//! These constants used to live as bare literals scattered across
//! `vector_store.rs`, `chunker.rs`, `kb_ingest.rs`, and `background.rs` with
//! no rationale next to the number. The first "tune the threshold" attempt
//! was guesswork — change the wrong one and you OOM, hash-collide, or
//! silently drop trigger executions. Pinning them here turns tribal
//! knowledge into a reviewable surface.
//!
//! Every constant carries a one-line comment justifying the chosen value.
//! Call sites should reference the constant rather than inline the literal,
//! and the helper macros below emit a `tracing::debug!` line when a cap
//! kicks in so an operator can see "X was clipped from N to CAP" without
//! attaching a debugger.

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
