use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreateMessageInput, MessageThreadSummary, PersonaMessage, PersonaMessageDelivery};
use crate::db::repos::communication::messages as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MessageDeliverySummary {
    pub message_id: String,
    pub delivered: i64,
    pub pending: i64,
    pub failed: i64,
}

#[tauri::command]
pub fn list_messages(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PersonaMessage>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db, limit, offset)
}

#[tauri::command]
pub fn get_message(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaMessage, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn mark_message_read(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::mark_as_read(&state.db, &id)
}

#[tauri::command]
pub fn mark_all_messages_read(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::mark_all_as_read(&state.db, persona_id.as_deref())
}

#[tauri::command]
pub fn delete_message(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn get_unread_message_count(
    state: State<'_, Arc<AppState>>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::get_unread_count(&state.db)
}

#[tauri::command]
pub fn get_message_count(
    state: State<'_, Arc<AppState>>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::get_total_count(&state.db)
}

#[tauri::command]
pub fn get_message_deliveries(
    state: State<'_, Arc<AppState>>,
    message_id: String,
) -> Result<Vec<PersonaMessageDelivery>, AppError> {
    require_auth_sync(&state)?;
    repo::get_deliveries_by_message(&state.db, &message_id)
}

#[tauri::command]
pub fn get_bulk_delivery_summaries(
    state: State<'_, Arc<AppState>>,
    message_ids: Vec<String>,
) -> Result<Vec<MessageDeliverySummary>, AppError> {
    require_auth_sync(&state)?;
    let rows = repo::get_bulk_delivery_summaries(&state.db, &message_ids)?;
    Ok(rows.into_iter().map(|(message_id, delivered, pending, failed)| {
        MessageDeliverySummary { message_id, delivered, pending, failed }
    }).collect())
}

#[tauri::command]
pub fn get_messages_by_thread(
    state: State<'_, Arc<AppState>>,
    thread_id: String,
) -> Result<Vec<PersonaMessage>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_thread(&state.db, &thread_id)
}

#[tauri::command]
pub fn get_thread_summaries(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
    offset: Option<i64>,
    persona_id: Option<String>,
) -> Result<Vec<MessageThreadSummary>, AppError> {
    require_auth_sync(&state)?;
    repo::get_thread_summaries(&state.db, limit, offset, persona_id.as_deref())
}

#[tauri::command]
pub fn get_thread_count(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::get_thread_count(&state.db, persona_id.as_deref())
}

// -- Dev seed: mock message -------------------------------------------------------

#[tauri::command]
pub fn seed_mock_message(
    state: State<'_, Arc<AppState>>,
) -> Result<PersonaMessage, AppError> {
    require_auth_sync(&state)?;

    use super::mock_seed::{self, MOCK_MESSAGE_TEMPLATES};

    let t = mock_seed::seed_index();
    let persona_id = mock_seed::pick_persona_id(&state.db, t)?
        .unwrap_or_else(|| "mock-persona".to_string());
    let tpl = &MOCK_MESSAGE_TEMPLATES[t % MOCK_MESSAGE_TEMPLATES.len()];

    let input = CreateMessageInput {
        persona_id,
        execution_id: None,
        title: Some(tpl.title.to_string()),
        content: tpl.content.to_string(),
        content_type: None,
        priority: Some(tpl.priority.to_string()),
        metadata: None,
        thread_id: None,
    };

    // Disable FK checks for dev seed (persona may not exist)
    let conn = state.db.get()?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = repo::create(&state.db, input);
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    result
}
