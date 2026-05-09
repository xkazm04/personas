//! Stage D Phase 4 — IPC surface for recipe-suggestion telemetry.
//!
//! Three commands:
//! - `log_recipe_suggestion_event` — fire-and-forget append
//! - `get_recipe_suggestion_stats` — windowed aggregate for the Phase 5 gate
//! - `list_recipe_suggestion_events` — debug surface; usually unused

use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    RecipeSuggestionEvent, RecipeSuggestionEventType, RecipeSuggestionStats,
};
use crate::db::repos::resources::recipe_suggestions as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[tauri::command]
pub async fn log_recipe_suggestion_event(
    state: State<'_, Arc<AppState>>,
    recipe_id: String,
    event_type: RecipeSuggestionEventType,
    score: f32,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    if recipe_id.trim().is_empty() {
        return Err(AppError::Validation("recipe_id cannot be empty".into()));
    }
    if !score.is_finite() || !(0.0..=1.0).contains(&score) {
        return Err(AppError::Validation(format!(
            "score must be a finite number in [0.0, 1.0]; got {score}"
        )));
    }
    repo::log_event(&state.db, &recipe_id, event_type, score)
}

/// Window defaults to `repo::DEFAULT_SAMPLE_WINDOW` (50). Callers can pass
/// a smaller value to inspect short-term behavior or a larger one for a
/// stability check; the underlying SQL clamps via `LIMIT`, so unsanitized
/// callers can't OOM us.
#[tauri::command]
pub async fn get_recipe_suggestion_stats(
    state: State<'_, Arc<AppState>>,
    window: Option<i64>,
) -> Result<RecipeSuggestionStats, AppError> {
    require_auth(&state).await?;
    let window = window
        .filter(|w| *w > 0)
        .unwrap_or(repo::DEFAULT_SAMPLE_WINDOW);
    repo::compute_stats(&state.db, window)
}

#[tauri::command]
pub async fn list_recipe_suggestion_events(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<RecipeSuggestionEvent>, AppError> {
    require_auth(&state).await?;
    let limit = limit.filter(|l| *l > 0).unwrap_or(100).min(1000);
    repo::list_recent(&state.db, limit)
}
