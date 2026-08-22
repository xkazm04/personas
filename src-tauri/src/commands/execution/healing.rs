use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    HealingAuditEntry, HealingTimelineEvent, PersonaExecution, PersonaHealingIssue,
};
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as repo;
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
) -> Result<healing_timeline::HealingAnalysisResult, AppError> {
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

    // Return the typed struct, NOT a hand-built `serde_json::json!` copy. The
    // copy is what let the binding drift: it carried a `status: "completed"`
    // field that exists on no Rust struct, and its snake_case keys silently
    // stopped matching the moment the struct adopted camelCase. A command that
    // returns its own exported type cannot drift from its binding.
    Ok(result)
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

/// Windowed self-healing effectiveness ledger (overall + per-category confirm
/// vs revert rates). `window_days` defaults to 30 when omitted.
#[tauri::command]
pub fn get_healing_effectiveness(
    state: State<'_, Arc<AppState>>,
    window_days: Option<i64>,
) -> Result<repo::HealingEffectivenessReport, AppError> {
    require_auth_sync(&state)?;
    repo::get_healing_effectiveness(&state.db, window_days)
}
