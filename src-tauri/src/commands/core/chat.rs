use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    ChatMessage, ChatSession, ChatSessionContext, CreateChatMessageInput, UpsertSessionContextInput,
};
use crate::db::repos::communication::chat as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub fn list_chat_sessions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatSession>, AppError> {
    require_auth_sync(&state)?;
    repo::list_sessions(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn get_chat_messages(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    require_auth_sync(&state)?;
    repo::get_session_messages(&state.db, &persona_id, &session_id, limit)
}

#[tauri::command]
pub fn create_chat_message(
    state: State<'_, Arc<AppState>>,
    input: CreateChatMessageInput,
) -> Result<ChatMessage, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn delete_chat_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    session_id: String,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::delete_session(&state.db, &persona_id, &session_id)
}

#[tauri::command]
pub fn save_chat_session_context(
    state: State<'_, Arc<AppState>>,
    input: UpsertSessionContextInput,
) -> Result<ChatSessionContext, AppError> {
    require_auth_sync(&state)?;
    repo::upsert_session_context(&state.db, input)
}

#[tauri::command]
pub fn get_chat_session_context(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<Option<ChatSessionContext>, AppError> {
    require_auth_sync(&state)?;
    repo::get_session_context(&state.db, &session_id)
}

#[tauri::command]
pub fn get_latest_chat_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<ChatSessionContext>, AppError> {
    require_auth_sync(&state)?;
    repo::get_latest_session(&state.db, &persona_id)
}

/// Send one message in a persona chat: the whole turn, in Rust
/// ([`super::chat_turn::start`]). Inserts the user row, saves the session
/// context, starts the execution and registers the hook that writes the reply
/// when the run completes. Returns once the run has started; the reply streams
/// over the execution's `execution-output` events and lands as a row
/// (`chat-changed`). Starts a paid run, so it is enforced by its
/// `PRIVILEGED_COMMANDS` entry like `execute_persona` (an async
/// `#[requires(privileged)]` cannot fail). `title` names a new session
/// instead of the title derived from its first message (the feedback chat).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_chat_turn(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    session_id: String,
    message: String,
    chat_mode: String,
    title: Option<String>,
    idempotency_key: Option<String>,
) -> Result<super::chat_turn::ChatTurnStarted, AppError> {
    require_auth(&state).await?;
    super::chat_turn::start_with(
        state.inner(),
        app,
        &persona_id,
        super::chat_turn::ChatTurnRequest {
            session_id: Some(session_id),
            message,
            mode: Some(super::chat_turn::ChatTurnMode::from_ui(&chat_mode)),
        },
        &super::chat_turn::ChatTurnOptions { title },
        idempotency_key.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
    )
    .await
}
