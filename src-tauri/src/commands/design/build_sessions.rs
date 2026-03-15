use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::db::models::{BuildEvent, PersistedBuildSession, UserAnswer};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Start a new build session for a persona. Returns the session ID.
/// Events are streamed back via the Channel parameter.
/// Optional workflow_json + parser_result_json enable workflow import mode.
#[tauri::command]
pub async fn start_build_session(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    channel: Channel<BuildEvent>,
    persona_id: String,
    intent: String,
    workflow_json: Option<String>,
    parser_result_json: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let session_id = uuid::Uuid::new_v4().to_string();

    state.build_session_manager.start_session(
        session_id.clone(),
        persona_id,
        intent,
        channel,
        state.db.clone(),
        state.process_registry.clone(),
        workflow_json,
        parser_result_json,
        app,
    )?;

    Ok(session_id)
}

/// Send a user answer to a pending question in a build session.
#[tauri::command]
pub async fn answer_build_question(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    cell_key: String,
    answer: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    let user_answer = UserAnswer { cell_key, answer };
    state
        .build_session_manager
        .send_answer(&session_id, user_answer)
}

/// Cancel an active build session.
#[tauri::command]
pub async fn cancel_build_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    state.build_session_manager.cancel_session(
        &session_id,
        &state.db,
        &state.process_registry,
    )
}

/// Get the active (non-terminal) build session for a persona, if any.
/// Returns a frontend-friendly representation with parsed JSON fields.
#[tauri::command]
pub async fn get_active_build_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<PersistedBuildSession>, AppError> {
    require_auth(&state).await?;

    let session = build_session_repo::get_active_for_persona(&state.db, &persona_id)?;
    Ok(session.as_ref().map(PersistedBuildSession::from_session))
}

/// List non-terminal build sessions, optionally filtered by persona_id.
#[tauri::command]
pub async fn list_build_sessions(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<Vec<PersistedBuildSession>, AppError> {
    require_auth(&state).await?;

    let sessions =
        build_session_repo::list_non_terminal(&state.db, persona_id.as_deref())?;
    Ok(sessions
        .iter()
        .map(PersistedBuildSession::from_session)
        .collect())
}
