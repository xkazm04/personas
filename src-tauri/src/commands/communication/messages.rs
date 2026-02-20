use std::sync::Arc;
use tauri::State;

use crate::db::models::{PersonaMessage, PersonaMessageDelivery};
use crate::db::repos::messages as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_messages(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PersonaMessage>, AppError> {
    repo::get_all(&state.db, limit, offset)
}

#[tauri::command]
pub fn get_message(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaMessage, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn mark_message_read(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    repo::mark_as_read(&state.db, &id)
}

#[tauri::command]
pub fn mark_all_messages_read(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<(), AppError> {
    repo::mark_all_as_read(&state.db, persona_id.as_deref())
}

#[tauri::command]
pub fn delete_message(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn get_unread_message_count(
    state: State<'_, Arc<AppState>>,
) -> Result<i64, AppError> {
    repo::get_unread_count(&state.db)
}

#[tauri::command]
pub fn get_message_count(
    state: State<'_, Arc<AppState>>,
) -> Result<i64, AppError> {
    repo::get_total_count(&state.db)
}

#[tauri::command]
pub fn get_message_deliveries(
    state: State<'_, Arc<AppState>>,
    message_id: String,
) -> Result<Vec<PersonaMessageDelivery>, AppError> {
    repo::get_deliveries_by_message(&state.db, &message_id)
}
