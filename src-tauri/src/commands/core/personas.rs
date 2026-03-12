use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreatePersonaInput, Persona, PersonaSummary, UpdateExecutionStatus, UpdatePersonaInput};
use crate::db::repos::core::personas as repo;
use crate::db::repos::execution::executions as exec_repo;
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
