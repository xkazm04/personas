use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use serde::Serialize;
use tauri::State;
use tracing::{info, instrument};
use ts_rs::TS;

use crate::db::models::PersonaPromptVersion;
use crate::db::repos::execution::metrics as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Guard that prevents concurrent A/B tests from running simultaneously.
static AB_TEST_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn get_prompt_versions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaPromptVersion>, AppError> {
    require_auth_sync(&state)?;
    repo::get_prompt_versions(&state.db, &persona_id, limit)
}

/// Tag a prompt version as production, experimental, or archived.
/// When tagging as "production", demotes the previous production version to "experimental".
#[tauri::command]
pub fn tag_prompt_version(
    state: State<'_, Arc<AppState>>,
    id: String,
    tag: String,
) -> Result<PersonaPromptVersion, AppError> {
    require_auth_sync(&state)?;
    let valid_tags = ["production", "experimental", "archived"];
    if !valid_tags.contains(&tag.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid tag '{}'. Must be one of: {}", tag, valid_tags.join(", ")
        )));
    }

    // If promoting to production, demote existing production version
    if tag == "production" {
        let version = repo::get_prompt_version_by_id(&state.db, &id)?;
        if let Ok(Some(current_prod)) = repo::get_production_version(&state.db, &version.persona_id) {
            if current_prod.id != id {
                let _ = repo::update_prompt_version_tag(&state.db, &current_prod.id, "experimental");
            }
        }
    }

    repo::update_prompt_version_tag(&state.db, &id, &tag)
}

/// Rollback a persona's prompt to a specific version.
/// Restores the version's prompt content to the persona and tags it as production.
#[tauri::command]
pub fn rollback_prompt_version(
    state: State<'_, Arc<AppState>>,
    version_id: String,
) -> Result<PersonaPromptVersion, AppError> {
    require_auth_sync(&state)?;
    let version = repo::get_prompt_version_by_id(&state.db, &version_id)?;

    // Wrap all writes in a single transaction to ensure atomicity
    let conn = state.db.get()?;
    conn.execute_batch("BEGIN")?;
    let result = (|| -> Result<(), AppError> {
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(ref sp) = version.structured_prompt {
            conn.execute(
                "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![sp, now, version.persona_id],
            )?;
        }
        if let Some(ref sys) = version.system_prompt {
            conn.execute(
                "UPDATE personas SET system_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![sys, now, version.persona_id],
            )?;
        }

        // Demote current production, promote this version
        if let Ok(Some(current_prod)) = repo::get_production_version(&state.db, &version.persona_id) {
            if current_prod.id != version_id {
                let _ = repo::update_prompt_version_tag(&state.db, &current_prod.id, "experimental");
            }
        }
        repo::update_prompt_version_tag(&state.db, &version_id, "production")?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e);
        }
    }

    repo::get_prompt_version_by_id(&state.db, &version_id)
}

/// Get the recent error rate for a persona.
#[tauri::command]
#[instrument(skip(state), fields(persona_id, window))]
pub fn get_prompt_error_rate(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    window: Option<i64>,
) -> Result<f64, AppError> {
    require_auth_sync(&state)?;
    let start = std::time::Instant::now();
    let result = repo::get_recent_error_rate(&state.db, &persona_id, window.unwrap_or(10));
    info!(duration_ms = start.elapsed().as_millis() as u64, "cmd::get_prompt_error_rate");
    result
}

// =============================================================================
// Prompt Lab -- A/B Test
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PromptAbTestResult {
    pub version_a_id: String,
    pub version_b_id: String,
    pub version_a_number: i32,
    pub version_b_number: i32,
    pub execution_a_id: String,
    pub execution_b_id: String,
    pub result_a: PromptAbExecResult,
    pub result_b: PromptAbExecResult,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PromptAbExecResult {
    pub status: String,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub cost_usd: f64,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub output_preview: Option<String>,
    pub error_message: Option<String>,
}

/// Run an A/B test: execute a persona with two different prompt versions
/// against the same input, returning a comparison of results.
///
/// Uses oneshot channels to await execution completion instead of polling,
/// and prevents concurrent A/B tests via an atomic guard.
#[tauri::command]
pub async fn run_prompt_ab_test(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    version_a_id: String,
    version_b_id: String,
    test_input: Option<String>,
) -> Result<PromptAbTestResult, AppError> {
    require_auth(&state).await?;

    // Debounce guard: prevent concurrent A/B tests
    if AB_TEST_RUNNING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err(AppError::Validation("An A/B test is already running. Please wait for it to finish.".into()));
    }
    // Ensure the guard is always released, even on early returns / errors
    let _guard = AbTestGuard;

    let version_a = repo::get_prompt_version_by_id(&state.db, &version_a_id)?;
    let version_b = repo::get_prompt_version_by_id(&state.db, &version_b_id)?;

    if version_a.persona_id != persona_id || version_b.persona_id != persona_id {
        return Err(AppError::Validation("Both versions must belong to the specified persona".into()));
    }

    let persona = crate::db::repos::core::personas::get_by_id(&state.db, &persona_id)?;
    let tools = crate::db::repos::resources::tools::get_tools_for_persona(&state.db, &persona_id)?;

    let model_used = crate::engine::prompt::parse_model_profile(persona.model_profile.as_deref())
        .and_then(|mp| mp.model);

    let input_json: Option<serde_json::Value> = test_input
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    // Create execution A with version A's prompt
    let mut persona_a = persona.clone();
    if let Some(ref sp) = version_a.structured_prompt {
        persona_a.structured_prompt = Some(sp.clone());
    }
    if let Some(ref sys) = version_a.system_prompt {
        persona_a.system_prompt = sys.clone();
    }

    let exec_a = crate::db::repos::execution::executions::create(
        &state.db, &persona_id, None, test_input.clone(), model_used.clone(), None,
    )?;
    crate::db::repos::execution::executions::update_status(
        &state.db, &exec_a.id,
        crate::db::models::UpdateExecutionStatus { status: crate::engine::types::ExecutionState::Running, ..Default::default() },
    )?;

    // Create execution B with version B's prompt
    let mut persona_b = persona;
    if let Some(ref sp) = version_b.structured_prompt {
        persona_b.structured_prompt = Some(sp.clone());
    }
    if let Some(ref sys) = version_b.system_prompt {
        persona_b.system_prompt = sys.clone();
    }

    let exec_b = crate::db::repos::execution::executions::create(
        &state.db, &persona_id, None, test_input, model_used, None,
    )?;
    crate::db::repos::execution::executions::update_status(
        &state.db, &exec_b.id,
        crate::db::models::UpdateExecutionStatus { status: crate::engine::types::ExecutionState::Running, ..Default::default() },
    )?;

    let db_a = state.db.clone();
    let db_b = state.db.clone();
    let engine = state.engine.clone();
    let app_a = app.clone();
    let exec_a_id = exec_a.id.clone();
    let exec_b_id = exec_b.id.clone();

    // Subscribe to completion signals BEFORE starting executions to avoid races
    let rx_a = engine.subscribe_completion(&exec_a_id).await;
    let rx_b = engine.subscribe_completion(&exec_b_id).await;

    // Start both executions concurrently (fire-and-forget, returns immediately)
    let (res_a, res_b) = tokio::join!(
        engine.start_execution(app_a, db_a, exec_a_id.clone(), persona_a, tools.clone(), input_json.clone(), None),
        engine.start_execution(app, db_b, exec_b_id.clone(), persona_b, tools, input_json, None),
    );

    // Check for execution start failures immediately instead of waiting for timeout
    if let Err(e) = res_a {
        return Err(AppError::Validation(format!("Execution A failed to start: {e}")));
    }
    if let Err(e) = res_b {
        return Err(AppError::Validation(format!("Execution B failed to start: {e}")));
    }

    // Await both completion signals with a 120-second timeout
    let timeout = std::time::Duration::from_secs(120);
    let wait_result = tokio::time::timeout(timeout, async {
        // Wait for both to complete (order doesn't matter)
        let _ = rx_a.await;
        let _ = rx_b.await;
    })
    .await;

    if wait_result.is_err() {
        return Err(AppError::Validation("A/B test timed out after 120 seconds".into()));
    }

    // Both executions are done — read final results
    let a = crate::db::repos::execution::executions::get_by_id(&state.db, &exec_a_id)?;
    let b = crate::db::repos::execution::executions::get_by_id(&state.db, &exec_b_id)?;

    Ok(PromptAbTestResult {
        version_a_id: version_a.id,
        version_b_id: version_b.id,
        version_a_number: version_a.version_number,
        version_b_number: version_b.version_number,
        execution_a_id: a.id,
        execution_b_id: b.id,
        result_a: PromptAbExecResult {
            status: a.status,
            duration_ms: a.duration_ms,
            cost_usd: a.cost_usd,
            input_tokens: a.input_tokens,
            output_tokens: a.output_tokens,
            output_preview: a.output_data.map(|s| s.chars().take(500).collect()),
            error_message: a.error_message,
        },
        result_b: PromptAbExecResult {
            status: b.status,
            duration_ms: b.duration_ms,
            cost_usd: b.cost_usd,
            input_tokens: b.input_tokens,
            output_tokens: b.output_tokens,
            output_preview: b.output_data.map(|s| s.chars().take(500).collect()),
            error_message: b.error_message,
        },
    })
}

/// RAII guard that resets the AB_TEST_RUNNING flag on drop.
struct AbTestGuard;

impl Drop for AbTestGuard {
    fn drop(&mut self) {
        AB_TEST_RUNNING.store(false, Ordering::Release);
    }
}
