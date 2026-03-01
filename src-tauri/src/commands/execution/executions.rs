use std::sync::Arc;
use tauri::State;

use crate::db::models::PersonaExecution;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::error::AppError;
use crate::AppState;

/// Verify that the execution belongs to the expected persona.
fn verify_execution_owner(exec: &PersonaExecution, caller_persona_id: &str) -> Result<(), AppError> {
    if exec.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Execution does not belong to the specified persona".into(),
        ));
    }
    Ok(())
}

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
    caller_persona_id: String,
) -> Result<PersonaExecution, AppError> {
    let execution = repo::get_by_id(&state.db, &id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    Ok(execution)
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

    // 2. Check budget limit (concurrency is handled by the engine's queue)
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

    // 4. Create execution record in DB (starts as "queued")
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

    // ── Stage: SpawnEngine ───────────────────────────────────────────
    pipeline.enter_stage(PipelineStage::SpawnEngine);

    // 5. Get tools
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    // 6. Parse input data JSON
    let input_json: Option<serde_json::Value> = input_data
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    // 7. Start execution (may run immediately or be queued with backpressure)
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
    caller_persona_id: String,
) -> Result<(), AppError> {
    // Look up persona_id so the engine can clean up the tracker
    let execution = repo::get_by_id(&state.db, &id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    let persona_id = Some(execution.persona_id);

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
    caller_persona_id: String,
) -> Result<Option<String>, AppError> {
    let execution = repo::get_by_id(&state.db, &id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    if let Some(ref path) = execution.log_file_path {
        // Path traversal guard: canonicalize both the log root and the requested
        // path, then verify the requested path is inside the log directory.
        let log_root = state.engine.log_dir().canonicalize().unwrap_or_else(|_| state.engine.log_dir().to_path_buf());
        let requested = std::path::Path::new(path)
            .canonicalize()
            .map_err(|_| AppError::NotFound(format!("Log file not found: {}", id)))?;
        if !requested.starts_with(&log_root) {
            return Err(AppError::Validation(
                "Log file path is outside the allowed log directory".into(),
            ));
        }
        match std::fs::read_to_string(&requested) {
            Ok(content) => Ok(Some(content)),
            Err(_) => Ok(execution.log_file_path),
        }
    } else {
        Ok(None)
    }
}

/// Get the structured execution trace for a specific execution.
#[tauri::command]
pub fn get_execution_trace(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    caller_persona_id: String,
) -> Result<Option<crate::engine::trace::ExecutionTrace>, AppError> {
    let execution = repo::get_by_id(&state.db, &execution_id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    crate::db::repos::execution::traces::get_by_execution_id(&state.db, &execution_id)
}

/// Get all traces sharing a chain_trace_id (distributed trace across chain executions).
#[tauri::command]
pub fn get_chain_trace(
    state: State<'_, Arc<AppState>>,
    chain_trace_id: String,
    caller_persona_id: String,
) -> Result<Vec<crate::engine::trace::ExecutionTrace>, AppError> {
    let traces = crate::db::repos::execution::traces::get_by_chain_trace_id(&state.db, &chain_trace_id)?;
    // Verify at least one trace in the chain belongs to the caller
    if let Some(first) = traces.first() {
        if first.persona_id != caller_persona_id {
            return Err(AppError::Auth(
                "Chain trace does not belong to the specified persona".into(),
            ));
        }
    }
    Ok(traces)
}
