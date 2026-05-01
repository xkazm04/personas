//! Phase 1 chat commands.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::companion::brain::episodic;
use crate::companion::session::{self, DEFAULT_SESSION_ID};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTurnResult {
    pub user_episode_id: String,
    pub assistant_episode_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

/// Send a user message; returns once Claude finishes. Streaming progress
/// arrives on the `companion://stream` Tauri event channel.
#[tauri::command]
pub async fn companion_send_message(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    message: String,
) -> Result<SendTurnResult, AppError> {
    require_auth(&state).await?;
    let pool = Arc::new(state.user_db.clone());
    let (user_episode_id, assistant_episode_id) =
        session::send_turn(&app, pool, message).await?;
    Ok(SendTurnResult {
        user_episode_id,
        assistant_episode_id,
    })
}

/// Read the most recent N messages oldest-first for the panel transcript.
#[tauri::command]
pub fn companion_list_recent_messages(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<CompanionMessage>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let limit = limit.unwrap_or(50).min(500);
    let episodes = episodic::list_recent(&state.user_db, DEFAULT_SESSION_ID, limit)?;
    Ok(episodes
        .into_iter()
        .map(|e| CompanionMessage {
            id: e.id,
            role: e.role,
            content: e.content,
            created_at: e.created_at,
        })
        .collect())
}
