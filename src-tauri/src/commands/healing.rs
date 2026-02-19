use std::sync::Arc;
use tauri::State;

use crate::db::models::PersonaHealingIssue;
use crate::db::repos::executions as exec_repo;
use crate::db::repos::healing as repo;
use crate::engine::healing;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_healing_issues(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<PersonaHealingIssue>, AppError> {
    repo::get_all(&state.db, persona_id.as_deref(), status.as_deref())
}

#[tauri::command]
pub fn get_healing_issue(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaHealingIssue, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn update_healing_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
) -> Result<(), AppError> {
    repo::update_status(&state.db, &id, &status)
}

/// Scan recent failed executions for a persona and create healing issues.
#[tauri::command]
pub fn run_healing_analysis(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    let pool = &state.db;

    let failures = exec_repo::get_recent_failures(pool, &persona_id, 10)?;

    let mut created = 0u32;
    let mut auto_fixed = 0u32;

    // Load existing issues once to avoid duplicates
    let existing = repo::get_all(pool, Some(&persona_id), None)?;

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
        let consecutive = failures.len() as u32;
        let diagnosis = healing::diagnose(&category, error, timeout_ms, consecutive);

        let issue = repo::create(
            pool,
            &persona_id,
            &diagnosis.title,
            &diagnosis.description,
            Some(&diagnosis.severity),
            Some(&diagnosis.db_category),
            Some(&exec.id),
            diagnosis.suggested_fix.as_deref(),
        )?;

        created += 1;
        if healing::is_auto_fixable(&category) {
            let _ = repo::mark_auto_fixed(pool, &issue.id);
            auto_fixed += 1;
        }
    }

    Ok(serde_json::json!({
        "status": "completed",
        "failures_analyzed": failures.len(),
        "issues_created": created,
        "auto_fixed": auto_fixed,
    }))
}
