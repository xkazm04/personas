//! Per-turn-class model/effort routing — the P4 lever of
//! `docs/plans/athena-live-conversation-layer.md`, calibrated by the
//! 1,026-turn bench (`docs/plans/athena-model-bench-report.md`).
//!
//! One source of truth for "which model + reasoning effort does this kind of
//! Athena call run on". Consumers: `session.rs` (main chat turns),
//! `athena_reaction.rs` (headless micro calls); the P3 aside lane adopts
//! `ASIDE` when it lands. Bench-only env overrides
//! (`PERSONAS_ATHENA_MODEL` / `PERSONAS_ATHENA_EFFORT`) are applied by the
//! main-turn consumer in `session.rs`, not here.

pub struct TurnTier {
    pub model: &'static str,
    /// CLI `--effort` value; `None` = the model's default (high).
    pub effort: Option<&'static str>,
}

/// Main conversational turns — full op grammar, gated proposals, the
/// quality-critical surface. Opus@low matched Opus@default accuracy exactly
/// (93.9% over 114 runs per cell) at 16% lower p50 latency — the effort dial
/// is a free win on this corpus. Model stays Opus: the bench's promotion
/// candidate (reinforced Sonnet@high, 96.5%) waits on corpus v3 + a judge
/// pass before main turns move.
pub const MAIN: TurnTier = TurnTier {
    model: "claude-opus-4-8",
    effort: Some("low"),
};

/// Aside turns / status summaries (P3b — not yet built): awareness-heavy,
/// carries NO op grammar. Sonnet@medium scored 100% on awareness, restraint
/// and format with a 30% p50 latency win over the Opus baseline.
pub const ASIDE: TurnTier = TurnTier {
    model: "claude-sonnet-5",
    effort: Some("medium"),
};

/// Headless micro calls — titling, one-shot classifications, digest
/// summaries, triage legs (`athena_reaction::cli_text*`). Sonnet@low: 40%
/// p50 win, p90 9.2s vs 19.3s; its bench misses (live-awareness nuance)
/// don't apply to stateless micro work. Deliberately receives NO
/// constitution/act-doctrine: reinforcement at low effort regressed
/// awareness 94→78% (the "emit ops" rule beat the "don't re-spawn
/// in-flight work" nuance).
pub const MICRO: TurnTier = TurnTier {
    model: "claude-sonnet-5",
    effort: Some("low"),
};
