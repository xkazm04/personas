use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    ChatMessage, ChatSession, ChatSessionContext, CreateChatMessageInput,
    UpsertSessionContextInput,
};
use crate::db::repos::communication::chat as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
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
