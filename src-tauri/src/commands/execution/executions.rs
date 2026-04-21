use std::sync::Arc;
use tauri::State;

use crate::db::models::{ExecutionCounts, GlobalExecutionRow, PersonaExecution};
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

/// Return precise counts for the Activity filter badges (total / running /
/// completed / failed), optionally scoped to a persona. Unlike
/// `list_all_executions` this is not paginated, so the frontend can display
/// accurate totals regardless of how many rows have been loaded.
#[tauri::command]
pub fn count_executions(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<ExecutionCounts, AppError> {
    require_auth_sync(&state)?;
    repo::count_all_global(&state.db, persona_id.as_deref())
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
    execute_persona_inner(
        &state,
        app,
        persona_id,
        trigger_id,
        input_data,
        use_case_id,
        continuation,
        idempotency_key,
        /* is_simulation */ false,
    )
    .await
}

/// Shared implementation for `execute_persona` and `simulate_use_case`.
///
/// Phase C3 — `is_simulation=true` flags the execution row so the dispatcher
/// skips real notification delivery and the activity feed can filter it out.
/// Simulations also **bypass** the `enabled` gate on the target capability so
/// users can test a disabled capability before activating it.
///
/// All other runtime behavior is identical: prompt assembly, tool exposure,
/// memory injection, and engine spawn happen the same way.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_persona_inner(
    state: &Arc<AppState>,
    app: tauri::AppHandle,
    persona_id: String,
    trigger_id: Option<String>,
    input_data: Option<String>,
    use_case_id: Option<String>,
    continuation: Option<crate::engine::types::Continuation>,
    idempotency_key: Option<String>,
    is_simulation: bool,
) -> Result<PersonaExecution, AppError> {
    use crate::engine::pipeline::{PipelineContext, PipelineStage};

    // -- Stage: Initiate ----------------------------------------------
    let mut pipeline = PipelineContext::new("pending", &persona_id);
    pipeline.enter_stage(PipelineStage::Initiate);

    // -- Stage: Validate ----------------------------------------------
    pipeline.enter_stage(PipelineStage::Validate);

    // 1. Get persona
    let mut persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    // 1b. Auto-expand use_case_id into input_data._use_case (Phase C1).
    //
    // When a trigger fires with a use_case_id (or a manual per-capability run
    // provides one), expand the capability JSON from design_context and merge
    // it into input_data so the prompt assembler renders "Current Focus"
    // correctly. Enforces `enabled != Some(false)` — disabled capabilities
    // cannot be executed even if a stale trigger fires.
    //
    // See docs/concepts/persona-capabilities/03-runtime.md §2.
    let mut input_data = input_data;
    if let Some(uc_id) = use_case_id.as_ref() {
        let Some(dc_str) = persona.design_context.as_deref() else {
            return Err(AppError::Validation(format!(
                "Persona '{}' has no design_context but use_case_id='{}' was requested",
                persona.name, uc_id
            )));
        };
        let dc: serde_json::Value = serde_json::from_str(dc_str).map_err(|e| {
            AppError::Validation(format!("design_context is not valid JSON: {}", e))
        })?;
        let use_case = dc
            .get("use_cases")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.iter().find(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(uc_id)))
            .cloned()
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "use_case_id '{}' not found on persona '{}'",
                    uc_id, persona.name
                ))
            })?;

        // Simulations deliberately bypass the enable gate so users can test
        // a disabled capability before activating it. Real executions reject.
        if !is_simulation
            && use_case.get("enabled").and_then(|v| v.as_bool()) == Some(false)
        {
            return Err(AppError::Validation(format!(
                "Capability '{}' is disabled on persona '{}'",
                uc_id, persona.name
            )));
        }

        // Merge capability metadata into input_data._use_case and _time_filter.
        // Caller-provided _use_case takes precedence — this is only a default.
        let mut merged: serde_json::Map<String, serde_json::Value> = input_data
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();

        merged.entry("_use_case".to_string()).or_insert_with(|| use_case.clone());
        if let Some(tf) = use_case.get("time_filter").cloned() {
            merged.entry("_time_filter".to_string()).or_insert(tf);
        }
        input_data = Some(serde_json::to_string(&merged).unwrap_or_default());

        // Apply model_override (if any) by mutating the persona's model_profile
        // for this execution. Engine reads persona.model_profile at spawn time.
        if let Some(mo) = use_case.get("model_override") {
            if !mo.is_null() {
                persona.model_profile = Some(mo.to_string());
            }
        }
    }

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
        use_case_id.clone(),
        idempotency_key,
        is_simulation,
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
    let mut input_json: Option<serde_json::Value> = input_data
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            serde_json::from_str(s).unwrap_or_else(|_| {
                // Plain text input (e.g. a URL or user message) — wrap as JSON object
                serde_json::json!({ "user_input": s })
            })
        });

    // 6b. Advisory mode: enrich input with diagnostic context from DB
    let is_advisory = input_json
        .as_ref()
        .and_then(|v| v.get("_advisory").or_else(|| v.get("_ops")))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if is_advisory {
        if let Some(ref mut json) = input_json {
            let ctx = build_advisory_context(&state.db, &persona_id);
            json.as_object_mut()
                .map(|obj| obj.insert("_advisory_context".into(), ctx));
        }
    }

    // 7. Check session pool for warm session reuse (if no explicit continuation)
    let continuation = if continuation.is_some() {
        continuation
    } else {
        // Compute config hash from current persona state.
        //
        // Phase C1 — includes `structured_prompt` and a fingerprint of the
        // currently-enabled capabilities so toggling `enabled` on any use case
        // invalidates warm sessions that would otherwise serve a prompt with
        // stale capability awareness.
        //
        // See docs/concepts/persona-capabilities/03-runtime.md §3.
        let config_hash = {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            persona.system_prompt.as_str().hash(&mut hasher);
            persona
                .structured_prompt
                .as_deref()
                .unwrap_or("")
                .hash(&mut hasher);
            persona.model_profile.as_deref().unwrap_or("").hash(&mut hasher);
            tools.len().hash(&mut hasher);
            crate::engine::prompt::active_capabilities_fingerprint(
                persona.design_context.as_deref(),
            )
            .hash(&mut hasher);
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
///
/// Supports pagination via optional `offset` and `limit` parameters to avoid
/// loading entire multi-MB log files into memory.  When neither is supplied the
/// command returns the **last 500** matching lines (tail mode).
#[tauri::command]
pub fn get_execution_log_lines(
    state: State<'_, Arc<AppState>>,
    id: String,
    caller_persona_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<String>, AppError> {
    require_auth_sync(&state)?;
    let execution = repo::get_by_id(&state.db, &id)?;
    verify_execution_owner(&execution, &caller_persona_id)?;
    if let Some(ref path) = execution.log_file_path {
        let requested = safe_resolve_log_path(path, state.engine.log_dir())?;
        let file = match std::fs::File::open(&requested) {
            Ok(f) => f,
            Err(_) => return Ok(vec![]),
        };
        let reader = std::io::BufReader::new(file);
        use std::io::BufRead;

        let max_lines = limit.unwrap_or(500);
        let skip = offset.unwrap_or(0);

        // When no offset is given, return the *last* `max_lines` (tail mode)
        // to show the most recent output.  With an explicit offset, return
        // lines starting from that position.
        if offset.is_some() {
            // Forward pagination: skip `offset` matching lines, take `limit`
            let lines: Vec<String> = reader
                .lines()
                .filter_map(|l| l.ok())
                .filter_map(|line| {
                    line.find("[STDOUT] ").map(|pos| line[pos + 9..].to_string())
                })
                .skip(skip)
                .take(max_lines)
                .collect();
            Ok(lines)
        } else {
            // Tail mode: collect only the last `max_lines` matching lines
            // using a ring buffer to keep memory bounded.
            use std::collections::VecDeque;
            let mut ring = VecDeque::with_capacity(max_lines + 1);
            for line in reader.lines().filter_map(|l| l.ok()) {
                if let Some(pos) = line.find("[STDOUT] ") {
                    ring.push_back(line[pos + 9..].to_string());
                    if ring.len() > max_lines {
                        ring.pop_front();
                    }
                }
            }
            Ok(ring.into_iter().collect())
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
        None, // no connector usage hints in preview
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

// ═══════════════════════════════════════════════════════════════════════════════
// Advisory context builder — enriches chat input with diagnostic data from DB
// ═══════════════════════════════════════════════════════════════════════════════

/// Build a JSON object with diagnostic context for the advisory assistant.
/// Called when `_advisory` (or legacy `_ops`) flag is present in chat input.
/// Each section is best-effort — failures are silently omitted so the advisory
/// prompt still works with partial context.
fn build_advisory_context(pool: &crate::db::DbPool, persona_id: &str) -> serde_json::Value {
    use crate::db::repos::execution::{
        assertions as assertion_repo,
        executions as exec_repo,
        knowledge as knowledge_repo,
        metrics as metrics_repo,
    };
    use crate::db::repos::core::memories as memory_repo;

    let mut ctx = serde_json::Map::new();

    // 1. Execution metrics summary (last 30 days)
    if let Ok(metrics) = metrics_repo::get_summary(pool, Some(30), Some(persona_id)) {
        let total = metrics.total_executions;
        let success_rate = if total > 0 {
            (metrics.successful_executions as f64 / total as f64 * 100.0).round()
        } else {
            0.0
        };
        ctx.insert("execution_metrics".into(), serde_json::json!({
            "period_days": 30,
            "total": total,
            "successful": metrics.successful_executions,
            "failed": metrics.failed_executions,
            "success_rate_pct": success_rate,
            "total_cost_usd": (metrics.total_cost_usd * 10000.0).round() / 10000.0,
        }));
    }

    // 2. Recent executions (last 10) — status, duration, cost, error summaries
    if let Ok(recent) = exec_repo::get_by_persona_id(pool, persona_id, Some(10)) {
        let exec_summaries: Vec<serde_json::Value> = recent.iter().map(|e| {
            let mut obj = serde_json::json!({
                "status": e.status,
                "started_at": e.started_at,
                "cost_usd": (e.cost_usd * 10000.0).round() / 10000.0,
            });
            if let Some(dur) = e.duration_ms {
                obj["duration_ms"] = serde_json::json!(dur);
            }
            if let Some(ref err) = e.error_message {
                // Truncate error to keep context compact
                let truncated = if err.len() > 200 { &err[..200] } else { err.as_str() };
                obj["error"] = serde_json::json!(truncated);
            }
            obj
        }).collect();
        ctx.insert("recent_executions".into(), serde_json::json!(exec_summaries));
    }

    // 3. Consecutive failure streak
    if let Ok(streak) = exec_repo::get_consecutive_failure_count(pool, persona_id) {
        if streak > 0 {
            ctx.insert("consecutive_failures".into(), serde_json::json!(streak));
        }
    }

    // 4. Knowledge graph summary
    if let Ok(kg) = knowledge_repo::get_summary(pool, Some(persona_id)) {
        let mut kg_obj = serde_json::json!({
            "total_entries": kg.total_entries,
            "tool_sequences": kg.tool_sequence_count,
            "failure_patterns": kg.failure_pattern_count,
            "model_performance": kg.model_performance_count,
            "annotations": kg.annotation_count,
        });
        // Include top patterns with confidence
        if !kg.top_patterns.is_empty() {
            let patterns: Vec<serde_json::Value> = kg.top_patterns.iter().take(5).map(|p| {
                serde_json::json!({
                    "type": p.knowledge_type,
                    "key": p.pattern_key,
                    "confidence": (p.confidence * 100.0).round() / 100.0,
                    "successes": p.success_count,
                    "failures": p.failure_count,
                })
            }).collect();
            kg_obj["top_patterns"] = serde_json::json!(patterns);
        }
        ctx.insert("knowledge_graph".into(), kg_obj);
    }

    // 5. Assertions summary — pass/fail counts per rule
    if let Ok(assertions) = assertion_repo::list_by_persona(pool, persona_id) {
        if !assertions.is_empty() {
            let assertion_summaries: Vec<serde_json::Value> = assertions.iter().map(|a| {
                let total = a.pass_count + a.fail_count;
                let pass_rate = if total > 0 {
                    (a.pass_count as f64 / total as f64 * 100.0).round()
                } else {
                    0.0
                };
                serde_json::json!({
                    "name": a.name,
                    "type": a.assertion_type,
                    "severity": a.severity,
                    "enabled": a.enabled,
                    "pass_count": a.pass_count,
                    "fail_count": a.fail_count,
                    "pass_rate_pct": pass_rate,
                })
            }).collect();
            ctx.insert("assertions".into(), serde_json::json!(assertion_summaries));
        }
    }

    // 6. Memory summary — counts by tier and category
    if let Ok(memories) = memory_repo::get_by_persona(pool, persona_id, Some(50)) {
        if !memories.is_empty() {
            let mut core_count = 0u32;
            let mut active_count = 0u32;
            let mut archive_count = 0u32;
            let mut by_category: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
            for m in &memories {
                match m.tier.as_str() {
                    "core" => core_count += 1,
                    "active" => active_count += 1,
                    _ => archive_count += 1,
                }
                *by_category.entry(m.category.clone()).or_default() += 1;
            }
            ctx.insert("memory_state".into(), serde_json::json!({
                "total": memories.len(),
                "core": core_count,
                "active": active_count,
                "archive": archive_count,
                "by_category": by_category,
            }));
        }
    }

    serde_json::Value::Object(ctx)
}
