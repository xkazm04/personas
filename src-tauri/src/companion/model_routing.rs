//! Per-turn-class model/effort routing — the P4 lever of
//! `docs/plans/athena-live-conversation-layer.md`, calibrated by the
//! 1,026-turn bench (`docs/plans/athena-model-bench-report.md`).
//!
//! One source of truth for "which model + reasoning effort does this kind of
//! Athena call run on". Consumers: `session.rs` (main chat turns),
//! `athena_reaction.rs` (headless micro + triage calls); the P3 aside lane adopts
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
/// is a free win on this corpus. Model moved Opus → Sonnet 5.5 on the
/// operator's decision 2026-09-29 (Sonnet 5.5 is capable enough to replace
/// Opus by default); the bench's Sonnet candidate was reinforced Sonnet@high
/// (96.5%), so effort stays a dial to re-measure, not a number to trust here.
pub const MAIN: TurnTier = TurnTier {
    model: personas_core::model_ids::SONNET_CURRENT,
    effort: Some("low"),
};

/// Aside turns / status summaries (P3b — not yet built): awareness-heavy,
/// carries NO op grammar. Sonnet@medium scored 100% on awareness, restraint
/// and format with a 30% p50 latency win over the Opus baseline. Re-pinned
/// 2026-10-08 from the bare `claude-sonnet-5` to the dated
/// [`SONNET_CURRENT`](personas_core::model_ids::SONNET_CURRENT): the 2026-10-08
/// Athena bench (`scripts/test/athena-model-bench.mjs`, 46 scenarios x 3 reps)
/// kept the judgment-bearing lanes on Sonnet 5.5, and an undated alias is a
/// vendor fact spelled at a call site.
pub const ASIDE: TurnTier = TurnTier {
    model: personas_core::model_ids::SONNET_CURRENT,
    effort: Some("medium"),
};

/// Headless micro calls — titling, one-shot classifications, digest
/// summaries (`athena_reaction::cli_text*`); triage now rides [`TRIAGE`]. Deliberately
/// receives NO constitution/act-doctrine: reinforcement at low effort
/// regressed awareness 94→78% (the "emit ops" rule beat the "don't re-spawn
/// in-flight work" nuance).
///
/// Haiku@low since 2026-10-08. The deterministic one-shot bench
/// (`scripts/test/oneshot-model-bench.mjs`, 61 tasks x 4 cells x 3 reps;
/// `docs/tests/model-bench/haiku-5-5.md`) put Haiku 5.5 level with or ahead
/// of Sonnet 5.5 on naming (97.2% vs 94.4% at low), extraction, structured
/// JSON and SQL at ~95% lower cost. Haiku's measured Athena gap — memory-write
/// proposals 0/3 vs 3/3 — does not apply here: micro calls never write
/// memory. Its OTHER measured gap — triage verdicts on hard cases, 92% vs
/// Sonnet's 100% — no longer reaches this tier: the triage legs
/// (`backlog_triage`, `exec_triage`, `msg_triage`, `review_resolution`,
/// `reaction_batch`) ride [`TRIAGE`] since 2026-10-08. Re-measure before
/// moving this row again. Previously Sonnet@low (40% p50 win over the Opus
/// baseline, p90 9.2s vs 19.3s).
pub const MICRO: TurnTier = TurnTier {
    model: personas_core::model_ids::HAIKU_CURRENT,
    effort: Some("low"),
};

/// Headless triage legs — per-item verdicts over a batch (`backlog_triage`,
/// `exec_triage`, `msg_triage`, `review_resolution`, `reaction_batch`), via
/// `athena_reaction::cli_text_tracked_on`. Split from [`MICRO`] 2026-10-08
/// because judgment is Haiku's measured weak spot: the 2026-10-08 one-shot
/// bench triage row (`scripts/test/oneshot-model-bench.mjs`;
/// `docs/tests/model-bench/haiku-5-5.md`) scored Haiku 5.5 at 92% on the hard
/// triage cases against 100% for Sonnet 5.5 at low effort (s55-low), so the
/// verdict legs stay on Sonnet@low while the rest of MICRO moved to Haiku.
pub const TRIAGE: TurnTier = TurnTier {
    model: personas_core::model_ids::SONNET_CURRENT,
    effort: Some("low"),
};
