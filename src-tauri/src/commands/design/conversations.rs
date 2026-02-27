use std::sync::Arc;

use tauri::State;

use crate::db::models::DesignConversation;
use crate::db::repos::core::design_conversations as conv_repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_design_conversations(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<DesignConversation>, AppError> {
    conv_repo::list_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_design_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DesignConversation, AppError> {
    conv_repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn get_active_design_conversation(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<DesignConversation>, AppError> {
    conv_repo::get_active(&state.db, &persona_id)
}

#[tauri::command]
pub fn create_design_conversation(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    title: String,
    messages: String,
) -> Result<DesignConversation, AppError> {
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
    conv_repo::append_message(&state.db, &id, &messages, last_result.as_deref())
}

#[tauri::command]
pub fn update_design_conversation_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
) -> Result<(), AppError> {
    conv_repo::update_status(&state.db, &id, &status)
}

#[tauri::command]
pub fn delete_design_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    conv_repo::delete(&state.db, &id)
}
