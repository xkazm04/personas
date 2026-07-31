//! Tauri commands for Generative Tours (Athena-composed walkthroughs).
//!
//! `companion_compose_tour` is the widget-driven entry point: the
//! WalkthroughOfferWidget's "Show me" calls it when no static walkthrough
//! covers the topic. It runs a one-shot Claude call with the anchor manifest
//! in the prompt, validates EVERY step against that manifest (unknown anchors
//! reject the whole tour — see `companion::tours`), persists the proven tour
//! to `companion_tours`, and returns it for immediate playback.
//!
//! `companion_list_composed_tours` feeds the Home → Learning timeline, where
//! composed tours render beside the built-in registry with the
//! `<AthenaComposedBadge variant="composed">` provenance badge.

use std::sync::Arc;

use tauri::State;

use crate::companion::tours::{self, ComposedTourRecord};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

#[tauri::command]
pub async fn companion_compose_tour(
    state: State<'_, Arc<AppState>>,
    topic: String,
    summary: Option<String>,
) -> Result<ComposedTourRecord, AppError> {
    ipc_auth::require_auth(&state).await?;
    let topic = topic.trim().to_string();
    if topic.is_empty() || topic.len() > 120 {
        return Err(AppError::Validation(
            "compose_tour: topic must be 1-120 chars".into(),
        ));
    }
    let summary = summary
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .chars()
        .take(500)
        .collect::<String>();
    tours::compose_tour(&state.user_db, &topic, &summary).await
}

#[tauri::command]
pub async fn companion_list_composed_tours(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ComposedTourRecord>, AppError> {
    ipc_auth::require_auth(&state).await?;
    tours::list_tours(&state.user_db)
}
