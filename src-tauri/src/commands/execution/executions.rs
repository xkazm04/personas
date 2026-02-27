use std::sync::Arc;
use tauri::State;

use crate::db::models::{PersonaExecution, UpdateExecutionStatus};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as repo;
use crate::db::repos::resources::tools as tool_repo;
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
    use_case_id: Option<String>,
) -> Result<PersonaExecution, AppError> {
    repo::create(&state.db, &persona_id, trigger_id, input_data, model_used, use_case_id)
}

/// Start a persona execution: create record, spawn Claude CLI, stream output.
///
/// Pipeline stages executed here:
///   Initiate -> Validate -> CreateRecord -> SpawnEngine
///
/// The remaining stages (StreamOutput, FinalizeStatus, Complete) run
/// asynchronously inside the spawned engine task.
#[tauri::command]
pub async fn execute_persona(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    trigger_id: Option<String>,
    input_data: Option<String>,
    use_case_id: Option<String>,
    continuation: Option<crate::engine::types::Continuation>,
) -> Result<PersonaExecution, AppError> {
    use crate::engine::pipeline::{PipelineContext, PipelineStage};

    // ── Stage: Initiate ──────────────────────────────────────────────
    let mut pipeline = PipelineContext::new("pending", &persona_id);
    pipeline.enter_stage(PipelineStage::Initiate);

    // ── Stage: Validate ──────────────────────────────────────────────
    pipeline.enter_stage(PipelineStage::Validate);

    // 1. Get persona
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    // 2. Check concurrency
    if !state
        .engine
        .has_capacity(&persona_id, persona.max_concurrent)
        .await
    {
        pipeline.fail_stage("concurrency limit reached");
        return Err(AppError::Validation(format!(
            "Persona '{}' has reached max concurrent executions ({})",
            persona.name, persona.max_concurrent
        )));
    }

    // 2b. Check budget limit
    if let Some(budget) = persona.max_budget_usd {
        if budget > 0.0 {
            let monthly_spend = crate::db::repos::execution::executions::get_monthly_spend(
                &state.db,
                &persona_id,
            )?;
            if monthly_spend >= budget {
                pipeline.fail_stage("budget limit exceeded");
                return Err(AppError::Validation(format!(
                    "Budget limit exceeded for '{}': ${:.2} spent this month, limit is ${:.2}",
                    persona.name, monthly_spend, budget
                )));
            }
        }
    }

    // 3. Parse model from profile
    let model_used =
        crate::engine::prompt::parse_model_profile(persona.model_profile.as_deref())
            .and_then(|mp| mp.model);

    // ── Stage: CreateRecord ──────────────────────────────────────────
    pipeline.enter_stage(PipelineStage::CreateRecord);

    // 4. Create execution record in DB
    let execution = repo::create(
        &state.db,
        &persona_id,
        trigger_id,
        input_data.clone(),
        model_used,
        use_case_id,
    )?;

    // Update pipeline context with real execution ID
    pipeline.execution_id = execution.id.clone();

    // 5. Update status to running
    repo::update_status(
        &state.db,
        &execution.id,
        UpdateExecutionStatus {
            status: crate::engine::types::ExecutionState::Running,
            ..Default::default()
        },
    )?;

    // ── Stage: SpawnEngine ───────────────────────────────────────────
    pipeline.enter_stage(PipelineStage::SpawnEngine);

    // 6. Get tools
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    // 7. Parse input data JSON
    let input_json: Option<serde_json::Value> = input_data
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    // 8. Start execution in background (remaining stages run in the spawned task)
    state
        .engine
        .start_execution(
            app,
            state.db.clone(),
            execution.id.clone(),
            persona,
            tools,
            input_json,
            continuation,
        )
        .await?;

    pipeline.complete_stage();
    pipeline.log_summary();

    // 9. Return the execution record (frontend uses the ID for event filtering)
    repo::get_by_id(&state.db, &execution.id)
}

#[tauri::command]
pub fn list_executions_for_use_case(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    use_case_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    repo::get_by_use_case_id(&state.db, &persona_id, &use_case_id, limit)
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
