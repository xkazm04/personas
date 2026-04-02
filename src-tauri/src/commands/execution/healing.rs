use std::sync::Arc;
use tauri::State;

use crate::db::models::{HealingAuditEntry, HealingKnowledge, HealingTimelineEvent, PersonaExecution, PersonaHealingIssue};
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as repo;
use crate::engine::healing;
use crate::engine::healing_timeline;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

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
    healing_timeline::verify_healing_owner(&issue, &caller_persona_id)?;
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
    healing_timeline::verify_healing_owner(&issue, &caller_persona_id)?;
    repo::update_status(&state.db, &id, &status)
}

#[tauri::command]
pub async fn run_healing_analysis(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let pool = &state.db;

    let (result, retries) = healing_timeline::run_healing_analysis(pool, &persona_id)?;

    for retry in &retries {
        state.engine.schedule_healing_retry(
            &app,
            pool,
            &retry.execution_id,
            &persona_id,
            &retry.diagnosis,
        );
    }

    Ok(serde_json::json!({
        "status": "completed",
        "failures_analyzed": result.failures_analyzed,
        "issues_created": result.issues_created,
        "auto_fixed": result.auto_fixed,
        "auto_retried": result.auto_retried,
    }))
}

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

#[tauri::command]
pub async fn trigger_ai_healing(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    execution_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    if !cfg!(debug_assertions) && std::env::var("VITE_DEVELOPMENT").as_deref() != Ok("true") {
        return Err(AppError::Internal("AI healing is only available in development mode".into()));
    }

    let pool = &state.db;
    let execution = exec_repo::get_by_id(pool, &execution_id)?;

    // Per-persona concurrency guard: atomically acquire the healing slot before
    // returning "started" to avoid TOCTOU where two callers both see is_healing=false.
    if !state.engine.try_start_healing(&execution.persona_id).await {
        return Err(AppError::Internal(
            "A healing session is already in progress for this persona".into(),
        ));
    }

    let session_id = execution.claude_session_id.ok_or_else(|| {
        AppError::Internal("Cannot heal: no Claude session ID on this execution".into())
    })?;

    let error_str = execution.error_message.as_deref().unwrap_or("Unknown error");
    let timed_out = error_str.contains("timed out");
    let session_limit = error_str.contains("Session limit");
    let category = healing::classify_error(error_str, timed_out, session_limit);

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
        "message": "AI healing chain started -- watch ai-healing-status events for progress",
    }))
}

#[tauri::command]
pub fn get_healing_timeline(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<HealingTimelineEvent>, AppError> {
    require_auth_sync(&state)?;
    healing_timeline::build_healing_timeline(&state.db, &persona_id)
}

#[tauri::command]
pub fn list_healing_audit_log(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<HealingAuditEntry>, AppError> {
    require_auth_sync(&state)?;
    repo::list_audit_log(&state.db, persona_id.as_deref(), limit.unwrap_or(100))
}
