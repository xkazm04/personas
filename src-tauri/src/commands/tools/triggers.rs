use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreateTriggerInput, PersonaTrigger, UpdateTriggerInput};
use crate::db::repos::resources::triggers as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_all_triggers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaTrigger>, AppError> {
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn list_triggers(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaTrigger>, AppError> {
    repo::get_by_persona_id(&state.db, &persona_id)
}

#[tauri::command]
pub fn create_trigger(
    state: State<'_, Arc<AppState>>,
    input: CreateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_trigger(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_trigger(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}

// =============================================================================
// Chain Triggers
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TriggerChainLink {
    pub trigger_id: String,
    pub source_persona_id: String,
    pub source_persona_name: String,
    pub target_persona_id: String,
    pub target_persona_name: String,
    pub condition_type: String,
    pub enabled: bool,
}

/// List all chain trigger links for visualization.
#[tauri::command]
pub fn list_trigger_chains(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TriggerChainLink>, AppError> {
    let all_triggers = repo::get_all(&state.db)?;
    let chain_triggers: Vec<_> = all_triggers
        .into_iter()
        .filter(|t| t.trigger_type == "chain")
        .collect();

    let mut links = Vec::new();
    for trigger in chain_triggers {
        let config: serde_json::Value = trigger
            .config
            .as_deref()
            .and_then(|c| serde_json::from_str(c).ok())
            .unwrap_or(serde_json::Value::Null);

        let source_persona_id = config
            .get("source_persona_id")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();

        let condition_type = config
            .get("condition")
            .and_then(|c| c.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("any")
            .to_string();

        // Resolve persona names
        let source_name = crate::db::repos::core::personas::get_by_id(&state.db, &source_persona_id)
            .map(|p| p.name)
            .unwrap_or_else(|_| "Unknown".into());

        let target_name = crate::db::repos::core::personas::get_by_id(&state.db, &trigger.persona_id)
            .map(|p| p.name)
            .unwrap_or_else(|_| "Unknown".into());

        links.push(TriggerChainLink {
            trigger_id: trigger.id,
            source_persona_id,
            source_persona_name: source_name,
            target_persona_id: trigger.persona_id,
            target_persona_name: target_name,
            condition_type,
            enabled: trigger.enabled,
        });
    }

    Ok(links)
}

// =============================================================================
// Webhook Info
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct WebhookStatus {
    pub listening: bool,
    pub port: u16,
    pub base_url: String,
}

/// Get the webhook server status.
#[tauri::command]
pub fn get_webhook_status(
    state: State<'_, Arc<AppState>>,
) -> Result<WebhookStatus, AppError> {
    let running = state.scheduler.is_running();
    Ok(WebhookStatus {
        listening: running,
        port: 9420,
        base_url: "http://localhost:9420".into(),
    })
}
