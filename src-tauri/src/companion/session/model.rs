//! Which model and effort a companion turn runs at. Both read
//! [`crate::companion::model_routing`], which stays the single source of truth
//! for Athena's tiers — this module only asks it.
//!
//! Moved verbatim out of the former single-file `session.rs`.

/// The model every full companion turn runs on. Recorded into the turn ledger
/// (`companion_turn.model`) and passed to the CLI `--model` flag — one source so
/// the two never drift. Sourced from the P4 routing table
/// (`model_routing::MAIN`), which also carries the default reasoning effort.
pub(super) const COMPANION_TURN_MODEL: &str = crate::companion::model_routing::MAIN.model;

/// Reasoning effort for web-build (Studio) turns. Build sessions prefer quality
/// over speed/cost — non-technical users can't specify the quality bars a dev
/// would, so we lean on the model's deepest thinking. Applied only to build
/// turns (cwd_override present), not normal companion chat.
pub(super) const BUILD_TURN_EFFORT: &str = "xhigh";

/// Bench/routing override seam (Track B of
/// `docs/plans/athena-live-conversation-layer.md`). `PERSONAS_ATHENA_MODEL`
/// replaces the pinned model for companion-chat turns; read per-spawn so a
/// bench run can flip it without an app restart.
///
/// Since the engine seam (hybrid-LLM-engine spark) the chat spawn reads its
/// model from `engine_settings::resolve`, which folds this same env layer
/// above the persisted tier; this helper remains for the failure ledger row
/// (`failure::FailedTurnCtx`), which has no resolved tier in hand.
pub(super) fn companion_turn_model() -> String {
    match std::env::var("PERSONAS_ATHENA_MODEL") {
        Ok(m) if !m.trim().is_empty() => m.trim().to_string(),
        _ => COMPANION_TURN_MODEL.to_string(),
    }
}
