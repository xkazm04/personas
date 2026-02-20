use std::sync::Arc;
use tauri::State;

use crate::db::models::{PersonaExecution, UpdateExecutionStatus};
use crate::db::repos::{executions as repo, personas as persona_repo, tools as tool_repo};
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_executions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    repo::get_by_persona_id(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn get_execution(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaExecution, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_execution(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
) -> Result<PersonaExecution, AppError> {
    repo::create(&state.db, &persona_id, trigger_id, input_data, model_used)
}

/// Start a persona execution: create record, spawn Claude CLI, stream output.
#[tauri::command]
pub async fn execute_persona(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    trigger_id: Option<String>,
    input_data: Option<String>,
) -> Result<PersonaExecution, AppError> {
    // 1. Get persona
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    // 2. Check concurrency
    if !state
        .engine
        .has_capacity(&persona_id, persona.max_concurrent)
        .await
    {
        return Err(AppError::Validation(format!(
            "Persona '{}' has reached max concurrent executions ({})",
            persona.name, persona.max_concurrent
        )));
    }

    // 3. Parse model from profile
    let model_used =
        crate::engine::prompt::parse_model_profile(persona.model_profile.as_deref())
            .and_then(|mp| mp.model);

    // 4. Create execution record in DB
    let execution = repo::create(
        &state.db,
        &persona_id,
        trigger_id,
        input_data.clone(),
        model_used,
    )?;

    // 5. Update status to running
    repo::update_status(
        &state.db,
        &execution.id,
        UpdateExecutionStatus {
            status: "running".into(),
            ..Default::default()
        },
    )?;

    // 6. Get tools
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    // 7. Parse input data JSON
    let input_json: Option<serde_json::Value> = input_data
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    // 8. Start execution in background
    state
        .engine
        .start_execution(
            app,
            state.db.clone(),
            execution.id.clone(),
            persona,
            tools,
            input_json,
        )
        .await?;

    // 9. Return the execution record (frontend uses the ID for event filtering)
    repo::get_by_id(&state.db, &execution.id)
}

/// Cancel a running execution.
#[tauri::command]
pub async fn cancel_execution(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    // Look up persona_id so the engine can clean up the tracker
    let persona_id = repo::get_by_id(&state.db, &id)
        .ok()
        .map(|e| e.persona_id);

    // Cancel via engine — handles flag, DB write, process kill, tracker cleanup, and abort
    let cancelled = state
        .engine
        .cancel_execution(&id, &state.db, persona_id.as_deref())
        .await;

    if cancelled {
        tracing::info!(execution_id = %id, "Execution cancelled via engine");
    } else {
        tracing::warn!(execution_id = %id, "Execution not found in engine, DB status updated");
    }

    Ok(())
}

#[tauri::command]
pub fn get_execution_log(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Option<String>, AppError> {
    let execution = repo::get_by_id(&state.db, &id)?;
    if let Some(ref path) = execution.log_file_path {
        match std::fs::read_to_string(path) {
            Ok(content) => Ok(Some(content)),
            Err(_) => Ok(execution.log_file_path),
        }
    } else {
        Ok(None)
    }
}
