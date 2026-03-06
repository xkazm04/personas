use std::sync::Arc;
use tauri::State;

use crate::db::models::{HealingKnowledge, PersonaExecution, PersonaHealingIssue};
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as repo;
use crate::engine::healing;
use crate::engine::healing::HealingAction;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use crate::engine::healing::MAX_RETRY_COUNT;

/// Verify that the healing issue belongs to the expected persona.
fn verify_healing_owner(issue: &PersonaHealingIssue, caller_persona_id: &str) -> Result<(), AppError> {
    if issue.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Healing issue does not belong to the specified persona".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn list_healing_issues(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<PersonaHealingIssue>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db, persona_id.as_deref(), status.as_deref())
}

#[tauri::command]
pub fn get_healing_issue(
    state: State<'_, Arc<AppState>>,
    id: String,
    caller_persona_id: String,
) -> Result<PersonaHealingIssue, AppError> {
    require_auth_sync(&state)?;
    let issue = repo::get_by_id(&state.db, &id)?;
    verify_healing_owner(&issue, &caller_persona_id)?;
    Ok(issue)
}

#[tauri::command]
pub fn update_healing_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
    caller_persona_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let issue = repo::get_by_id(&state.db, &id)?;
    verify_healing_owner(&issue, &caller_persona_id)?;
    repo::update_status(&state.db, &id, &status)
}

/// Scan recent failed executions for a persona, create healing issues,
/// and execute auto-fix actions (RetryWithBackoff, RetryWithTimeout).
#[tauri::command]
pub async fn run_healing_analysis(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let pool = &state.db;

    let failures = exec_repo::get_recent_failures(pool, &persona_id, 10)?;

    let mut created = 0u32;
    let mut auto_fixed = 0u32;
    let mut auto_retried = 0u32;

    // Load existing issues once to avoid duplicates
    let existing = repo::get_all(pool, Some(&persona_id), None)?;

    // Only retry the most recent auto-fixable failure to avoid spawning
    // multiple concurrent retries from a single scan.
    let mut retry_scheduled = false;

    // Consecutive failure count is stable for a single scan — compute once.
    let consecutive = exec_repo::get_consecutive_failure_count(pool, &persona_id)?;

    for exec in &failures {
        // Skip if a healing issue already exists for this execution
        if existing
            .iter()
            .any(|i| i.execution_id.as_deref() == Some(&exec.id))
        {
            continue;
        }

        let error = exec.error_message.as_deref().unwrap_or("");
        let timed_out = error.contains("timed out");
        let session_limit = error.contains("Session limit");
        let timeout_ms = exec.duration_ms.unwrap_or(600_000) as u64;

        let category = healing::classify_error(error, timed_out, session_limit);
        let diagnosis = healing::diagnose(&category, error, timeout_ms, consecutive, exec.retry_count);

        let issue = repo::create(
            pool,
            &persona_id,
            &diagnosis.title,
            &diagnosis.description,
            diagnosis.title.to_ascii_lowercase().contains("circuit breaker"),
            Some(&diagnosis.severity),
            Some(&diagnosis.db_category),
            Some(&exec.id),
            diagnosis.suggested_fix.as_deref(),
        )?;

        created += 1;

        let is_auto_fixable = healing::is_auto_fixable(&category)
            && consecutive < 3
            && exec.retry_count < MAX_RETRY_COUNT
            && matches!(diagnosis.action, HealingAction::RetryWithBackoff { .. } | HealingAction::RetryWithTimeout { .. });

        if is_auto_fixable {
            let _ = repo::mark_auto_fixed(pool, &issue.id);
            auto_fixed += 1;

            // Execute the healing action: schedule an actual retry
            if !retry_scheduled {
                state.engine.schedule_healing_retry(
                    &app,
                    pool,
                    &exec.id,
                    &persona_id,
                    &diagnosis,
                );
                auto_retried += 1;
                retry_scheduled = true;
            }
        }
    }

    Ok(serde_json::json!({
        "status": "completed",
        "failures_analyzed": failures.len(),
        "issues_created": created,
        "auto_fixed": auto_fixed,
        "auto_retried": auto_retried,
    }))
}

/// Get the retry chain for an execution (original + all retries).
#[tauri::command]
pub fn get_retry_chain(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    caller_persona_id: String,
) -> Result<Vec<PersonaExecution>, AppError> {
    require_auth_sync(&state)?;
    let execution = exec_repo::get_by_id(&state.db, &execution_id)?;
    if execution.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Execution does not belong to the specified persona".into(),
        ));
    }
    exec_repo::get_retry_chain(&state.db, &execution_id)
}

/// Get all entries from the fleet-wide healing knowledge base.
#[tauri::command]
pub fn list_healing_knowledge(
    state: State<'_, Arc<AppState>>,
    service_type: Option<String>,
) -> Result<Vec<HealingKnowledge>, AppError> {
    require_auth_sync(&state)?;
    match service_type {
        Some(st) => repo::get_knowledge_by_service(&state.db, &st),
        None => repo::get_all_knowledge(&state.db),
    }
}

/// Manually trigger AI healing for a failed execution (dev-mode only).
///
/// Resumes the original Claude session as a chained execution. The healing
/// runs in the background and emits `ai-healing-status` events to the frontend.
/// Requires the original execution to have a `claude_session_id`.
#[tauri::command]
pub async fn trigger_ai_healing(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    execution_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    // Only available in dev mode
    if !cfg!(debug_assertions) && std::env::var("VITE_DEVELOPMENT").as_deref() != Ok("true") {
        return Err(AppError::Internal("AI healing is only available in development mode".into()));
    }

    let pool = &state.db;
    let execution = exec_repo::get_by_id(pool, &execution_id)?;

    let session_id = execution.claude_session_id.ok_or_else(|| {
        AppError::Internal("Cannot heal: no Claude session ID on this execution".into())
    })?;

    let error_str = execution.error_message.as_deref().unwrap_or("Unknown error");
    let timed_out = error_str.contains("timed out");
    let session_limit = error_str.contains("Session limit");
    let category = healing::classify_error(error_str, timed_out, session_limit);

    // Delegate to the engine which spawns the healing chain as a background task.
    // The engine handles execution record creation, running, and fix application.
    state.engine.start_healing_chain(
        &app,
        pool,
        &execution_id,
        &execution.persona_id,
        &session_id,
        error_str,
        &format!("{category:?}"),
    );

    Ok(serde_json::json!({
        "status": "started",
        "message": "AI healing chain started — watch ai-healing-status events for progress",
    }))
}
