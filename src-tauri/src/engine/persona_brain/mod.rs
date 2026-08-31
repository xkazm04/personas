//! Living-agent persona brain (spark `living-agent-core`, WP4).
//!
//! Every user persona gets the same three organs Athena's companion brain
//! proved out, scoped per persona and governed harder:
//!
//! * [`episodes`] — the append-only episodic record: disk markdown under
//!   `~/.personas/personas/<persona_id>/episodes/` plus an indexed excerpt row
//!   in `persona_episodes` (WP1's repo).
//! * [`identity`] — the persona's self-model `identity.md`, grown ONLY by
//!   anchored diffs through a `persona_memory_review_proposal` row of kind
//!   `self_model_diff` (proposed by consolidation, applied by a human). The
//!   diff grammar and appliers are the companion's pure fns
//!   (`companion::brain::identity`), reused verbatim.
//! * [`sleep_cycle`] — the consolidation loop: a keyed single-flight pass that
//!   turns new episodes into `working`-tier fact memories through the ONE
//!   governed writer (`db::repos::core::memories::create_consolidated`), with
//!   every pass — run, refused, or failed — recorded in
//!   `persona_attention_ledger`.
//!
//! The pure admission logic lives in `personas_core::cycle` so it unit-tests
//! without a database.

pub mod episodes;
pub mod identity;
pub mod sleep_cycle;

use std::path::PathBuf;

use crate::error::AppError;

/// Resolve the per-persona brain root: `~/.personas/personas/<persona_id>/`.
/// Honors the `PERSONAS_HOME` override for tests — the same convention as
/// `companion::disk::brain_root` (disk.rs:31-38).
pub fn persona_root(persona_id: &str) -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("personas").join(persona_id))
}
