//! `StandupReport` builder ("Since last standup") and the
//! `companion_standup_event` writer. WP3 owns.

use crate::db::UserDbPool;
use crate::error::AppError;

use super::model::{StandupEvent, StandupReport};

/// Append one away act to `companion_standup_event` (append-only).
///
/// Cross-package seam frozen by the Director before the WP1-WP3 fan-out:
/// WP3 implements it; WP1 (arm/dispatch events) and WP2 (backfill events)
/// call it.
pub fn append_event(_pool: &UserDbPool, _event: &StandupEvent) -> Result<(), AppError> {
    Ok(())
}

/// Compose the report for a standup revision from its event ledger, the
/// fleet and the projects' git history since `armed_at`.
///
/// Cross-package seam: WP3 implements it; WP1's `standup_end` command and
/// `standup_open` (the recall of the previous revision) call it.
pub fn build(_pool: &UserDbPool, standup_id: &str) -> Result<StandupReport, AppError> {
    Err(AppError::Execution(format!(
        "standup report for {standup_id}: not implemented: WP3"
    )))
}
