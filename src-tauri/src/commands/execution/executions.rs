use std::sync::Arc;
use tauri::State;

use crate::db::models::{GlobalExecutionRow, PersonaExecution};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as repo;
use crate::db::repos::resources::automations as automation_repo;
use crate::db::repos::resources::{tools as tool_repo, triggers as trigger_repo};
use crate::engine::automation_runner::automation_to_virtual_tool;
use crate::engine::failover::CircuitBreakerStatus;
use crate::engine::scheduler as sched_logic;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync, require_privileged, require_privileged_sync};
use crate::validation::safe_resolve_log_path;
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
    require_auth_sync(&state)?;
    repo::get_by_persona_id(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn list_all_executions(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
    status: Option<String>,
    persona_id: Option<String>,
) -> Result<Vec<GlobalExecutionRow>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all_global(&state.db, limit, status.as_deref(), persona_id.as_deref())
}

#[tauri::command]
pub fn get_execution(
    state: State<'_, Arc<AppState>>,
    id: String,
    caller_persona_id: String,
) -> Result<PersonaExecution, AppError> {
    require_auth_sync(&state)?;
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
    require_privileged_sync(&state, "create_execution")?;
    repo::create(&state.db, &persona_id, trigger_id, input_data, model_used, use_case_id)
}

/// Start a persona execution: create record, spawn Claude CLI, stream output.
///
/// Pipeline stages executed here:
///   Initiate -> Validate -> CreateRecord -> SpawnEngine
///
/// The remaining stages (StreamOutput, FinalizeStatus, Complete) run
/// asynchronously inside the spawned engine task.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn execute_persona(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    trigger_id: Option<String>,
    input_data: Option<String>,
    use_case_id: Option<String>,
    continuation: Option<crate::engine::types::Continuation>,
    idempotency_key: Option<String>,
) -> Result<PersonaExecution, AppError> {
    require_privileged(&state, "execute_persona").await?;
    use crate::engine::pipeline::{PipelineContext, PipelineStage};

    // -- Stage: Initiate ----------------------------------------------
    let mut pipeline = PipelineContext::new("pending", &persona_id);
    pipeline.enter_stage(PipelineStage::Initiate);

    // -- Stage: Validate ----------------------------------------------
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

    // -- Stage: CreateRecord ------------------------------------------
    pipeline.enter_stage(PipelineStage::CreateRecord);

    // 4. Create execution record in DB (starts as "queued").
    //    When an idempotency_key is supplied (e.g. from a timeout-retry),
    //    this returns the existing execution instead of creating a duplicate.
    let execution = repo::create_with_idempotency(
        &state.db,
        &persona_id,
        trigger_id,
        input_data.clone(),
        model_used,
        use_case_id,
        idempotency_key,
    )?;

    // Update pipeline context with real execution ID
    pipeline.execution_id = execution.id.clone();

    // If idempotency dedup returned an already-started execution, skip the
    // engine spawn — it's already running (or finished). Return it directly
    // so the frontend gets the same execution ID without a duplicate spawn.
    if execution.status != "queued" {
        tracing::info!(
            execution_id = %execution.id,
            status = %execution.status,
            "Idempotency dedup: execution already in progress, skipping engine spawn"
        );
        pipeline.complete_stage();
        pipeline.log_summary();
        return Ok(execution);
    }

    // -- Stage: SpawnEngine -------------------------------------------
    pipeline.enter_stage(PipelineStage::SpawnEngine);

    // 5. Get tools + inject virtual tools from active automations
    let mut tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    if let Ok(automations) = automation_repo::get_by_persona(&state.db, &persona_id) {
        for auto in &automations {
            if auto.deployment_status.is_runnable() {
                tools.push(automation_to_virtual_tool(auto));
            }
        }
    }

    // 6. Parse input data — try JSON first, fall back to wrapping plain text
    let input_json: Option<serde_json::Value> = input_data
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            serde_json::from_str(s).unwrap_or_else(|_| {
                // Plain text input (e.g. a URL or user message) — wrap as JSON object
                serde_json::json!({ "user_input": s })
            })
        });

    // 7. Check session pool for warm session reuse (if no explicit continuation)
    let continuation = if continuation.is_some() {
        continuation
    } else {
        // Compute config hash from current persona state
        let config_hash = {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            persona.system_prompt.as_str().hash(&mut hasher);
            persona.model_profile.as_deref().unwrap_or("").hash(&mut hasher);
            tools.len().hash(&mut hasher);
            hasher.finish()
        };
        match state.session_pool.take(&persona_id, config_hash).await {
            Some(session_id) => {
                tracing::info!(persona_id = %persona_id, "Warm session reuse from pool");
                Some(crate::engine::types::Continuation::SessionResume(session_id))
            }
            None => None,
        }
    };

    // 8. Start execution (may run immediately or be queued with backpressure)
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

    // 8. If this execution was triggered manually for a specific trigger,
    //    advance the trigger's schedule so it moves out of "overdue" state.
    //    This handles both "Run now" and "Recover" actions from the frontend.
    if let Some(ref tid) = execution.trigger_id {
        if let Ok(trigger) = trigger_repo::get_by_id(&state.db, tid) {
            let cfg = trigger.parse_config();
            let next = sched_logic::compute_next_from_config(&cfg, chrono::Utc::now());
            if let Err(e) = trigger_repo::advance_schedule(&state.db, tid, next) {
                tracing::warn!(trigger_id = %tid, error = %e, "Failed to advance trigger schedule after manual execution");
            }
        }
    }

    // 9. Return the execution record (frontend uses the ID for event filtering)
    repo::get_by_id(&state.db, &execution.id)
}

#[tauri::command]
pub fn list_executions_by_trigger(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_trigger_id(&state.db, &trigger_id, limit)
}

#[tauri::command]
pub fn list_executions_for_use_case(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    use_case_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_use_case_id(&state.db, &persona_id, &use_case_id, limit)
}

/// Cancel a running execution.
#[tauri::command]
pub async fn cancel_execution(
    state: State<'_, Arc<AppState>>,
    id: String,
    caller_persona_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    // Look up persona_id so the engine can clean up the tracker
    let execution = repo::get_by_id(&state.db, &id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    let persona_id = Some(execution.persona_id);

    // Cancel via engine -- handles flag, DB write, process kill, tracker cleanup, and abort
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
    require_auth_sync(&state)?;
    let execution = repo::get_by_id(&state.db, &id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    if let Some(ref path) = execution.log_file_path {
        let requested = safe_resolve_log_path(path, state.engine.log_dir())?;
        match std::fs::read_to_string(&requested) {
            Ok(content) => Ok(Some(content)),
            Err(_) => Ok(None),
        }
    } else {
        Ok(None)
    }
}

/// Get parsed display lines from the execution log for session recovery (replay after refresh).
#[tauri::command]
pub fn get_execution_log_lines(
    state: State<'_, Arc<AppState>>,
    id: String,
    caller_persona_id: String,
) -> Result<Vec<String>, AppError> {
    require_auth_sync(&state)?;
    let execution = repo::get_by_id(&state.db, &id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    if let Some(ref path) = execution.log_file_path {
        let requested = safe_resolve_log_path(path, state.engine.log_dir())?;
        match std::fs::read_to_string(&requested) {
            Ok(content) => {
                let lines: Vec<String> = content
                    .lines()
                    .filter_map(|line| {
                        // Extract display text from log lines with [STDOUT] prefix
                        line.find("[STDOUT] ").map(|pos| line[pos + 9..].to_string())
                    })
                    .collect();
                Ok(lines)
            }
            Err(_) => Ok(vec![]),
        }
    } else {
        Ok(vec![])
    }
}

/// Get the structured execution trace for a specific execution.
#[tauri::command]
pub fn get_execution_trace(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    caller_persona_id: String,
) -> Result<Option<crate::engine::trace::ExecutionTrace>, AppError> {
    require_auth_sync(&state)?;
    let execution = repo::get_by_id(&state.db, &execution_id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    crate::db::repos::execution::traces::get_by_execution_id(&state.db, &execution_id)
}

/// Build a deterministic dream replay session from stored trace spans.
///
/// Reconstructs frame-by-frame execution state without consuming LLM tokens.
/// Each span boundary becomes a DreamFrame with full state reconstruction.
#[tauri::command]
pub fn get_dream_replay(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    caller_persona_id: String,
) -> Result<Option<crate::engine::dream_replay::DreamReplaySession>, AppError> {
    require_auth_sync(&state)?;
    let execution = repo::get_by_id(&state.db, &execution_id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    let trace = crate::db::repos::execution::traces::get_by_execution_id(&state.db, &execution_id)?;
    Ok(trace.map(|t| crate::engine::dream_replay::build_dream_replay(&t)))
}

/// Get all traces sharing a chain_trace_id (distributed trace across chain executions).
///
/// Only returns traces belonging to the caller's persona. Chain executions may
/// span multiple personas; returning traces from other personas would leak
/// their execution details (instructions, tool outputs, credential usage).
#[tauri::command]
pub fn get_chain_trace(
    state: State<'_, Arc<AppState>>,
    chain_trace_id: String,
    caller_persona_id: String,
) -> Result<Vec<crate::engine::trace::ExecutionTrace>, AppError> {
    require_auth_sync(&state)?;
    let traces = crate::db::repos::execution::traces::get_by_chain_trace_id(&state.db, &chain_trace_id)?;
    // Filter to only traces owned by the caller's persona
    let owned: Vec<_> = traces
        .into_iter()
        .filter(|t| t.persona_id == caller_persona_id)
        .collect();
    if owned.is_empty() {
        return Err(AppError::Auth(
            "Chain trace does not belong to the specified persona".into(),
        ));
    }
    Ok(owned)
}

/// Get current circuit breaker state for all providers.
///
/// Returns per-provider status (consecutive failures, open/closed, cooldown)
/// and global breaker state. Read-only snapshot — does not reset any state.
#[tauri::command]
pub fn get_circuit_breaker_status(
    state: State<'_, Arc<AppState>>,
) -> Result<CircuitBreakerStatus, AppError> {
    require_auth_sync(&state)?;
    Ok(state.engine.circuit_breaker.get_status())
}

/// Preview an execution without running it: assembles the prompt, estimates
/// token count and cost, and returns the preview for user inspection.
#[tauri::command]
pub fn preview_execution(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    input_data: Option<String>,
    _use_case_id: Option<String>,
) -> Result<crate::engine::cost::ExecutionPreview, AppError> {
    require_auth_sync(&state)?;
    use crate::db::repos::core::memories as mem_repo;
    use crate::engine::prompt;

    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    // Parse input data
    let input_json: Option<serde_json::Value> = input_data
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    // Assemble prompt (same as real execution)
    let prompt_text = prompt::assemble_prompt(
        &persona,
        &tools,
        input_json.as_ref(),
        None, // no credential hints in preview
        None, // no workspace instructions in preview
        #[cfg(feature = "desktop")]
        None, // no ambient context in preview
    );

    // Count memories that would be injected
    let memory_count = mem_repo::get_for_injection(&state.db, &persona_id, 10, 40)
        .map(|t| (t.core.len() + t.active.len()) as u32)
        .unwrap_or(0);

    // Resolve model
    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let model = model_profile
        .and_then(|mp| mp.model)
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

    // Monthly spend
    let monthly_spend = crate::db::repos::execution::executions::get_monthly_spend(
        &state.db, &persona_id,
    ).unwrap_or(0.0);
    let budget_limit = persona.max_budget_usd.unwrap_or(0.0);

    Ok(crate::engine::cost::build_preview(
        &prompt_text,
        &model,
        memory_count,
        tools.len() as u32,
        monthly_spend,
        budget_limit,
    ))
}
