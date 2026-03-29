use std::sync::Arc;

use tauri::State;

use crate::db::models::DesignConversation;
use crate::db::repos::core::design_conversations as conv_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_design_conversations(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<DesignConversation>, AppError> {
    require_auth_sync(&state)?;
    conv_repo::list_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_design_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DesignConversation, AppError> {
    require_auth_sync(&state)?;
    conv_repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn get_active_design_conversation(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<DesignConversation>, AppError> {
    require_auth_sync(&state)?;
    conv_repo::get_active(&state.db, &persona_id)
}

#[tauri::command]
pub fn create_design_conversation(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    title: String,
    messages: String,
) -> Result<DesignConversation, AppError> {
    require_auth_sync(&state)?;
    let id = uuid::Uuid::new_v4().to_string();
    conv_repo::create(&state.db, &id, &persona_id, &title, &messages)
}

#[tauri::command]
pub fn append_design_conversation_message(
    state: State<'_, Arc<AppState>>,
    id: String,
    messages: String,
    last_result: Option<String>,
) -> Result<DesignConversation, AppError> {
    require_auth_sync(&state)?;
    conv_repo::append_message(&state.db, &id, &messages, last_result.as_deref())
}

/// Append a single message server-side (O(1) IPC payload instead of O(n)).
#[tauri::command]
pub fn append_single_design_message(
    state: State<'_, Arc<AppState>>,
    id: String,
    message_json: String,
    last_result: Option<String>,
) -> Result<DesignConversation, AppError> {
    require_auth_sync(&state)?;
    conv_repo::append_single_message(&state.db, &id, &message_json, last_result.as_deref(), 500)
}

#[tauri::command]
pub fn update_design_conversation_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    conv_repo::update_status(&state.db, &id, &status)
}

#[tauri::command]
pub fn delete_design_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    conv_repo::delete(&state.db, &id)
}
