//! Shared schema-version policy for artist artifacts.
//!
//! The Artist plugin writes three independent artifact families that each
//! carry a `schema_version` field:
//!
//!   - **Saved compositions** (`persistence.rs`) — `mstudio.json` files in
//!     the user's Documents folder. Long-lived, may live across many app
//!     versions, and must be loadable even if the format has drifted.
//!   - **Autosaves** (`persistence.rs`) — same shape as saved compositions
//!     but living in app-data. Recoverability is best-effort: if the
//!     autosave is unparseable we silently drop it.
//!   - **Word-timing transcripts** (`transcribe.rs`) — `*.transcript.json`
//!     sidecars next to clips. Currently consumer-side checks are absent;
//!     callers parse the file via `serde_json::from_str` and accept any
//!     shape that happens to deserialize.
//!   - **Live roadmap payload** (`live_roadmap.rs`) — fetched from the
//!     marketing site. Hard-rejects mismatches with frontend fallback.
//!
//! Before this module each surface had its own informal rule. The result
//! was that bumping the version on one surface could brick another, with
//! no shared vocabulary for "is this drift safe to accept?"
//!
//! ## The Policy (single source of truth)
//!
//! Every artist artifact follows the same three-tier rule:
//!
//!   1. **Newer than current → reject.** If a payload's `schema_version`
//!      is greater than what this build knows about, refuse to load it
//!      (or, for autosave, log and skip). Forward compat is opt-in only —
//!      a future writer must bump major and the older reader must reject
//!      until it gains migration code.
//!   2. **Same as current → accept.** The hot path.
//!   3. **Older than current → accept with a migration step.** Each
//!      artifact owner is responsible for in-place migration (see
//!      `import_export.rs::run_migrations` for the canonical pattern).
//!      Until a migration step lands for a specific surface, "older"
//!      payloads are loaded permissively as raw `serde_json::Value` and
//!      a `tracing::warn!` records the drift.
//!   4. **Unknown / unparseable → log and ignore.** We never silently
//!      pretend a corrupt file loaded successfully.
//!
//! The `SchemaCompatibility` enum below encodes this decision so callers
//! get one consistent matcher rather than three hand-rolled `if`s.

/// Outcome of comparing a payload's `schema_version` to the writer's
/// `CURRENT_SCHEMA_VERSION` for that artifact family. See module docs for
/// the policy each variant implies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchemaCompatibility {
    /// Payload was written by the same version this build understands.
    Match,
    /// Payload is older than the current schema. Load it but a migration
    /// step is required (or, until one is written, treat as best-effort
    /// permissive load and `tracing::warn!`).
    OlderNeedsMigration,
    /// Payload is newer than this build understands. Reject loads outright;
    /// for best-effort surfaces (autosave) log and ignore.
    NewerThanSupported,
}

/// Compare a payload's recorded schema version to the writer's current
/// version using the shared policy.
///
/// The numeric scheme is intentionally simple: monotonically-increasing
/// `u32` per artifact family. We don't encode semver here because the
/// artifacts are local files, not a public API — a single counter is
/// enough to pick the right migration path, and the policy says any
/// non-equal version is suspect by default.
pub fn classify(payload_version: u32, current_version: u32) -> SchemaCompatibility {
    use std::cmp::Ordering;
    match payload_version.cmp(&current_version) {
        Ordering::Equal => SchemaCompatibility::Match,
        Ordering::Less => SchemaCompatibility::OlderNeedsMigration,
        Ordering::Greater => SchemaCompatibility::NewerThanSupported,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_when_versions_equal() {
        assert_eq!(classify(1, 1), SchemaCompatibility::Match);
        assert_eq!(classify(7, 7), SchemaCompatibility::Match);
    }

    #[test]
    fn older_needs_migration() {
        assert_eq!(classify(1, 2), SchemaCompatibility::OlderNeedsMigration);
        assert_eq!(classify(0, 1), SchemaCompatibility::OlderNeedsMigration);
    }

    #[test]
    fn newer_than_supported_is_rejected() {
        assert_eq!(classify(2, 1), SchemaCompatibility::NewerThanSupported);
        assert_eq!(classify(99, 1), SchemaCompatibility::NewerThanSupported);
    }
}
