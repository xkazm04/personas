//! Standup plan repo and revisioning: `companion_standup` rows, re-open as
//! revision n+1 with items copied, item patches, away-rule edits. WP1 owns.

use crate::db::UserDbPool;
use crate::error::AppError;

use super::model::StandupItem;

/// Items of the currently ARMED revision that dead-spot backfill may pull
/// early: `accepted`/`edited` items not yet dispatched, plus `filler` items,
/// highest `priority` first. Empty when no revision is armed.
///
/// Cross-package seam frozen by the Director before the WP1-WP3 fan-out:
/// WP1 implements it, WP2 (`engine::resources::dead_spot`) calls it.
pub fn backfill_candidates(_pool: &UserDbPool) -> Result<Vec<StandupItem>, AppError> {
    Ok(Vec::new())
}
