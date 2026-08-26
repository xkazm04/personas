//! The one door for Anthropic model identifiers.
//!
//! **Why this module exists.** A model id is a fact that changes on the
//! vendor's schedule, not ours. Until 2026-08-25 the Rust tree spelled
//! `claude-<family>-<n>` literals in **54 production files**, and five of them
//! independently declared the same "default judge" string. When Anthropic
//! retired `claude-sonnet-4-20250514` / `claude-opus-4-20250514`, the failover
//! ladder in `engine/failover.rs` kept handing them out and every run that hit
//! the ladder 404'd (`failover.rs:634`). The build path was patched; the
//! execution path was not, because there was no single place to patch.
//!
//! The shape is borrowed from Apache Maka's `model-metadata`: one committed
//! snapshot, every consumer reads from it, and a change to a model id is a
//! diff in exactly one file. Personas is subscription-CLI-first, so the
//! retirement-proof spelling for CLI spawns is the **alias** the CLI resolves
//! itself (`sonnet` / `opus` / `haiku`); dated ids exist only for API-shaped
//! callers that must pin a version. Both spellings live here and nowhere else.
//!
//! Census rule `bare-model-id-literal` (`scripts/census/rules.json`) counts
//! every `"claude-…"` string literal in `src-tauri/**` outside this file and
//! ratchets the count down. Add a constant here rather than a literal there.

/// CLI aliases — resolved by the Claude CLI to its current model of that
/// family. Never retire; prefer these for every `claude` subprocess spawn.
pub const ALIAS_HAIKU: &str = "haiku";
pub const ALIAS_SONNET: &str = "sonnet";
pub const ALIAS_OPUS: &str = "opus";

/// Current dated ids per family. These are what the CLI resolves the aliases
/// to today; bump them here when the vendor ships a successor.
pub const HAIKU_CURRENT: &str = "claude-haiku-4-5-20251001";
pub const SONNET_CURRENT: &str = "claude-sonnet-4-6";
pub const OPUS_CURRENT: &str = "claude-opus-4-8";

/// Tier defaults consumed by headless judges, lab runs, capability fallbacks
/// and settings defaults. Named by the *job* so a caller never has to know
/// which family currently fills it.
///
/// - `DEFAULT_FAST`: cheap classification, ranking, lint — latency-bound work.
/// - `DEFAULT_BALANCED`: the default judge / evaluator / capability tier
///   ("null = sonnet default" in the recipe-bundle tiering doctrine).
/// - `DEFAULT_STRONG`: synthesis and anything the operator explicitly pays for.
pub const DEFAULT_FAST: &str = HAIKU_CURRENT;
pub const DEFAULT_BALANCED: &str = SONNET_CURRENT;
pub const DEFAULT_STRONG: &str = OPUS_CURRENT;

/// Ids the vendor has retired. `is_retired` lets a failover ladder, a stored
/// `model_profile`, or an imported bundle refuse a dead id *before* the 404.
/// Append, never remove — a retired id does not come back.
pub const RETIRED: &[&str] = &[
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-sonnet-4-5-20250514",
];

/// True when `model` is a dated id the vendor no longer serves.
pub fn is_retired(model: &str) -> bool {
    RETIRED.contains(&model)
}

/// True when `model` is one of the three CLI aliases.
pub fn is_alias(model: &str) -> bool {
    matches!(model, ALIAS_HAIKU | ALIAS_SONNET | ALIAS_OPUS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_defaults_are_current_ids_not_retired_ones() {
        for m in [DEFAULT_FAST, DEFAULT_BALANCED, DEFAULT_STRONG] {
            assert!(!is_retired(m), "{m} is in RETIRED");
            assert!(m.starts_with("claude-"), "{m} must be a dated id");
        }
    }

    #[test]
    fn retired_list_is_recognised() {
        assert!(is_retired("claude-sonnet-4-20250514"));
        assert!(!is_retired(SONNET_CURRENT));
        assert!(!is_retired(ALIAS_SONNET));
    }

    #[test]
    fn aliases_are_bare_family_names() {
        assert!(is_alias("sonnet"));
        assert!(!is_alias(SONNET_CURRENT));
    }
}
