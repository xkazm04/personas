//! Prompt-size tripwires for the living-agent sections (spark
//! `living-agent-core`, WP2).
//!
//! Observability ONLY: [`warn_over_budget`] emits at most one `tracing::warn!`
//! per assembly naming every block over its tripwire, and NEVER truncates.
//! Bounding actual prompt size is a separate decision with its own blast
//! radius (the model-tier router already reads prompt length) — see the
//! deliberate-divergence note above `## Input Data` in `assemble.rs`.
//!
//! Also home to the crate's FNV-1a-64 content-hash helper, shared by
//! `capabilities::core_fingerprint`.

/// Generous tripwire for the rendered `## Manifest` section (chars). The
/// manifest carries three law sections plus the growing self-model, so it
/// gets twice the old Core allowance.
pub const MANIFEST_BUDGET_CHARS: usize = 16_000;
/// Generous tripwire for the rendered `## Responsibilities` roster (chars).
/// Uncapped roster-of-N (WP2): ~5 compact lines per charter, so this trips
/// around the ~40-charter mark — a flare that the roster shape needs
/// revisiting, not a bound.
pub const RESPONSIBILITIES_BUDGET_CHARS: usize = 12_000;
/// Generous tripwire for the rendered `## Current Focus` charter detail
/// (chars) — the procedure is prompt-shaped text and can be long.
pub const FOCUSED_BUDGET_CHARS: usize = 8_000;
/// Generous tripwire for the rendered `## Recent Episodes` section (chars).
pub const EPISODES_BUDGET_CHARS: usize = 12_000;
/// Generous tripwire for the whole assembled prompt (chars).
pub const TOTAL_BUDGET_CHARS: usize = 200_000;

/// Section-name → char-count measurements for one assembled prompt.
///
/// Plain data — deliberately NOT a serde model (it never crosses a wire), so
/// it carries no `rename_all` obligations.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PromptBlockSizes {
    /// Rendered `## Manifest` section, chars (0 when the section was skipped).
    pub manifest: usize,
    /// Rendered `## Responsibilities` roster, chars.
    pub responsibilities: usize,
    /// Rendered `## Current Focus` charter detail, chars (0 when the run is
    /// not dispatched for a charter).
    pub focused: usize,
    /// Rendered `## Recent Episodes (oldest first)` section, chars.
    pub episodes: usize,
    /// The whole assembled prompt, chars.
    pub total: usize,
}

impl PromptBlockSizes {
    /// Every block over its tripwire as `(name, measured, budget)`.
    /// Split from [`warn_over_budget`] so the detection is unit-testable
    /// without capturing log output.
    pub fn over_budget(&self) -> Vec<(&'static str, usize, usize)> {
        let checks = [
            ("manifest", self.manifest, MANIFEST_BUDGET_CHARS),
            (
                "responsibilities",
                self.responsibilities,
                RESPONSIBILITIES_BUDGET_CHARS,
            ),
            ("focused", self.focused, FOCUSED_BUDGET_CHARS),
            ("episodes", self.episodes, EPISODES_BUDGET_CHARS),
            ("total", self.total, TOTAL_BUDGET_CHARS),
        ];
        checks
            .into_iter()
            .filter(|(_, measured, budget)| measured > budget)
            .collect()
    }
}

/// FNV-1a 64-bit content hash. Stable across processes and platforms (unlike
/// `DefaultHasher`), dependency-free, and cheap — exactly what a fingerprint
/// that lands in cache keys needs. Not cryptographic; never use it where an
/// adversarial collision would matter.
pub fn fnv1a_64(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    bytes.iter().fold(OFFSET_BASIS, |hash, b| {
        (hash ^ u64::from(*b)).wrapping_mul(PRIME)
    })
}

/// Emit AT MOST ONE `tracing::warn!` for this assembly, naming every block
/// over its tripwire. Never truncates, never errors — a huge prompt still
/// ships; this is the flare, not the fence.
pub fn warn_over_budget(sizes: &PromptBlockSizes) {
    let over = sizes.over_budget();
    if over.is_empty() {
        return;
    }
    let detail = over
        .iter()
        .map(|(name, measured, budget)| format!("{name} {measured} > {budget}"))
        .collect::<Vec<_>>()
        .join(", ");
    tracing::warn!(
        manifest_chars = sizes.manifest,
        responsibilities_chars = sizes.responsibilities,
        focused_chars = sizes.focused,
        episodes_chars = sizes.episodes,
        total_chars = sizes.total,
        "prompt block(s) over size tripwire (nothing truncated): {detail}",
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_64_matches_the_published_test_vectors() {
        // Offset basis: the hash of the empty input.
        assert_eq!(fnv1a_64(b""), 0xcbf2_9ce4_8422_2325);
        // Classic single-byte vector from the FNV reference tables.
        assert_eq!(fnv1a_64(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_ne!(fnv1a_64(b"risk:0.2"), fnv1a_64(b"risk:0.9"));
    }

    #[test]
    fn over_budget_names_exactly_the_blocks_past_their_tripwire() {
        let fine = PromptBlockSizes {
            manifest: MANIFEST_BUDGET_CHARS,
            responsibilities: 10,
            focused: FOCUSED_BUDGET_CHARS,
            episodes: 0,
            total: 50_000,
        };
        assert!(fine.over_budget().is_empty(), "at-budget is not over");

        let over = PromptBlockSizes {
            manifest: MANIFEST_BUDGET_CHARS + 1,
            responsibilities: 10,
            focused: FOCUSED_BUDGET_CHARS + 3,
            episodes: EPISODES_BUDGET_CHARS + 5,
            total: TOTAL_BUDGET_CHARS + 1,
        };
        let names: Vec<&str> = over.over_budget().iter().map(|(n, _, _)| *n).collect();
        assert_eq!(names, vec!["manifest", "focused", "episodes", "total"]);
        // Emitting the warn for real must not panic outside a subscriber.
        warn_over_budget(&over);
    }
}
