use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{
    CreatePersonaInput, Persona, PersonaAutomation, PersonaEventSubscription, PersonaSummary,
    PersonaToolDefinition, PersonaTrigger, UpdateExecutionStatus, UpdatePersonaInput,
};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::personas as repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::automations as automation_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::types::ExecutionState;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub fn list_personas(state: State<'_, Arc<AppState>>) -> Result<Vec<Persona>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_persona(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaInput,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_persona(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdatePersonaInput,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn duplicate_persona(
    state: State<'_, Arc<AppState>>,
    source_id: String,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    repo::duplicate(&state.db, &source_id)
}

#[tauri::command]
pub fn get_persona_summaries(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaSummary>, AppError> {
    require_auth_sync(&state)?;
    repo::get_summaries(&state.db)
}

/// Batched persona detail: persona + tools + triggers + subscriptions + automations
/// in a single IPC round trip.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaDetail {
    #[serde(flatten)]
    pub persona: Persona,
    pub tools: Vec<PersonaToolDefinition>,
    pub triggers: Vec<PersonaTrigger>,
    pub subscriptions: Vec<PersonaEventSubscription>,
    pub automations: Vec<PersonaAutomation>,
}

#[tauri::command]
pub fn get_persona_detail(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaDetail, AppError> {
    require_auth_sync(&state)?;
    let persona = repo::get_by_id(&state.db, &id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &id).unwrap_or_default();
    let triggers = trigger_repo::get_by_persona_id(&state.db, &id).unwrap_or_default();
    let subscriptions = event_repo::get_subscriptions_by_persona(&state.db, &id).unwrap_or_default();
    let automations = automation_repo::get_by_persona(&state.db, &id).unwrap_or_default();
    Ok(PersonaDetail {
        persona,
        tools,
        triggers,
        subscriptions,
        automations,
    })
}

/// Pre-delete impact summary for a persona.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BlastRadiusItem {
    pub category: String,
    pub description: String,
}

#[tauri::command]
pub fn persona_blast_radius(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<BlastRadiusItem>, AppError> {
    require_auth_sync(&state)?;
    let items = repo::blast_radius(&state.db, &id)?;
    Ok(items
        .into_iter()
        .map(|(category, description)| BlastRadiusItem { category, description })
        .collect())
}

#[tauri::command]
pub async fn delete_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    require_auth(&state).await?;

    // Cancel any running/queued executions for this persona before deleting
    let running = match exec_repo::get_running(&state.db) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(
                persona_id = %id,
                error = %e,
                "Failed to query running executions before persona deletion"
            );
            return Err(AppError::Internal(format!(
                "Cannot safely delete persona {id}: failed to check running executions"
            )));
        }
    };

    let mut cancel_failures: Vec<String> = Vec::new();
    for exec in &running {
        if exec.persona_id == id {
            let cancelled = state
                .engine
                .cancel_execution(&exec.id, &state.db, Some(&id))
                .await;
            if !cancelled {
                tracing::warn!(
                    persona_id = %id,
                    execution_id = %exec.id,
                    "Engine failed to cancel execution; marking as cancelled in DB"
                );
                // Force-mark the execution as cancelled in DB to prevent orphaned runs
                if let Err(e) = exec_repo::update_status(
                    &state.db,
                    &exec.id,
                    UpdateExecutionStatus {
                        status: ExecutionState::Cancelled,
                        error_message: Some("Cancelled during persona deletion".into()),
                        ..Default::default()
                    },
                ) {
                    tracing::error!(
                        persona_id = %id,
                        execution_id = %exec.id,
                        error = %e,
                        "Failed to mark orphaned execution as cancelled"
                    );
                    cancel_failures.push(exec.id.clone());
                }
            }
        }
    }

    if !cancel_failures.is_empty() {
        tracing::error!(
            persona_id = %id,
            failed_executions = ?cancel_failures,
            "Some executions could not be cancelled or marked; proceeding with deletion"
        );
    }

    repo::delete(&state.db, &id)
}
