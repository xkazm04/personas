//! Tauri commands for whole-machine utilisation and the standup forecast
//! (spark app-standup). WP2 owns this file.
//!
//! Both commands are adapters: validate, one blocking call off the IPC thread
//! (`db::repos::resources::host_utilization`, written by
//! `engine::resources::host_sampler`; `companion::standup::forecast`), map.

use std::sync::Arc;

use tauri::State;

use crate::db::models::{ForecastSlot, HostUtilizationPoint};
use crate::db::repos::resources::host_utilization::{self, RETENTION_MS};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The widest range one call serves: the retention window (14 days, at most
/// `host_utilization::MAX_SERIES_POINTS` = 20,160 minutes). A wider request
/// keeps its most recent 14 days.
pub const MAX_SERIES_RANGE_MS: i64 = RETENTION_MS;

/// `(since, until)` clamped to [`MAX_SERIES_RANGE_MS`], keeping the recent
/// end. An inverted range is the caller's mistake and says so.
fn clamp_range(since_ms: i64, until_ms: i64) -> Result<(i64, i64), AppError> {
    if until_ms < since_ms {
        return Err(AppError::Validation(format!(
            "host_utilization_series: untilMs ({until_ms}) is before sinceMs ({since_ms})"
        )));
    }
    Ok((
        since_ms.max(until_ms.saturating_sub(MAX_SERIES_RANGE_MS)),
        until_ms,
    ))
}

/// The 1-minute host rollups with `since_ms <= minute_ms < until_ms`, oldest
/// first. The range is capped at 14 days (the retention window).
#[tauri::command]
pub async fn host_utilization_series(
    state: State<'_, Arc<AppState>>,
    since_ms: i64,
    until_ms: i64,
) -> Result<Vec<HostUtilizationPoint>, AppError> {
    require_auth(&state).await?;
    let (since_ms, until_ms) = clamp_range(since_ms, until_ms)?;
    let pool = state.db.clone();
    tokio::task::spawn_blocking(move || host_utilization::series(&pool, since_ms, until_ms))
        .await
        .map_err(|e| join_failure("host_utilization_series", e))?
}

/// Where each accepted item of the standup's plan is expected to run.
#[tauri::command]
pub async fn standup_forecast(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
) -> Result<Vec<ForecastSlot>, AppError> {
    require_auth(&state).await?;
    personas_core::validation::require_non_empty("standupId", &standup_id)?;
    let (pool, user_db) = (state.db.clone(), state.user_db.clone());
    tokio::task::spawn_blocking(move || {
        crate::companion::standup::forecast::forecast_for_standup(&pool, &user_db, &standup_id)
    })
    .await
    .map_err(|e| join_failure("standup_forecast", e))?
}

/// The blocking task's death as this command's error, naming a panic as a
/// panic (rather than folding it into "failed") so the log says which.
fn join_failure(op: &str, e: tokio::task::JoinError) -> AppError {
    if e.is_panic() {
        AppError::Internal(format!(
            "{op}: the blocking task panicked: {}",
            crate::utils::extract_panic_message(e.into_panic())
        ))
    } else {
        AppError::Internal(format!("{op}: the blocking task was cancelled: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_range_is_capped_at_the_retention_window_keeping_the_recent_end() {
        assert_eq!(clamp_range(10, 20).unwrap(), (10, 20));
        assert_eq!(clamp_range(5, 5).unwrap(), (5, 5));
        let until = 100 * RETENTION_MS;
        assert_eq!(
            clamp_range(0, until).unwrap(),
            (until - MAX_SERIES_RANGE_MS, until)
        );
        assert!(matches!(clamp_range(20, 10), Err(AppError::Validation(_))));
    }
}
