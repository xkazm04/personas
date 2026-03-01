use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{MetricsChartData, PersonaPromptVersion, PromptPerformanceData, ExecutionDashboardData};
use crate::db::repos::execution::metrics as repo;
use crate::error::AppError;
use crate::AppState;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PersonaMonthlySpend {
    pub id: String,
    pub spend: f64,
    pub max_budget_usd: Option<f64>,
    pub name: String,
}

#[tauri::command]
pub fn get_metrics_summary(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    repo::get_summary(&state.db, days, persona_id.as_deref())
}

#[tauri::command]
pub fn get_metrics_chart_data(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
) -> Result<MetricsChartData, AppError> {
    repo::get_chart_data(&state.db, days, persona_id.as_deref())
}

#[tauri::command]
pub fn get_prompt_versions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaPromptVersion>, AppError> {
    repo::get_prompt_versions(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn get_all_monthly_spend(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaMonthlySpend>, AppError> {
    let conn = state.db.get()?;
    let mut stmt = conn.prepare(
        "SELECT p.id, COALESCE(e.spend, 0.0), p.max_budget_usd, p.name
         FROM personas p
         LEFT JOIN (
             SELECT persona_id, SUM(cost_usd) AS spend
             FROM persona_executions
             WHERE status = 'completed'
               AND created_at >= datetime('now', 'start of month')
             GROUP BY persona_id
         ) e ON e.persona_id = p.id
         ORDER BY p.name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PersonaMonthlySpend {
            id: row.get(0)?,
            spend: row.get(1)?,
            max_budget_usd: row.get(2)?,
            name: row.get(3)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// =============================================================================
// Prompt Performance Dashboard
// =============================================================================

/// Returns aggregated prompt performance data for a single persona,
/// including daily metrics with percentiles, version markers, and anomalies.
#[tauri::command]
pub fn get_prompt_performance(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    days: Option<i64>,
) -> Result<PromptPerformanceData, AppError> {
    repo::get_prompt_performance(&state.db, &persona_id, days.unwrap_or(30))
}

// =============================================================================
// Execution Metrics Dashboard (global, cross-persona)
// =============================================================================

/// Returns aggregated dashboard data across all personas for the last N days,
/// including daily time-series, latency percentiles, top-5 personas by cost,
/// and cost anomaly detection.
#[tauri::command]
pub fn get_execution_dashboard(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<ExecutionDashboardData, AppError> {
    repo::get_execution_dashboard(&state.db, days.unwrap_or(30))
}

// =============================================================================
// Prompt Lab — Version Management
// =============================================================================

/// Tag a prompt version as production, experimental, or archived.
/// When tagging as "production", demotes the previous production version to "experimental".
#[tauri::command]
pub fn tag_prompt_version(
    state: State<'_, Arc<AppState>>,
    id: String,
    tag: String,
) -> Result<PersonaPromptVersion, AppError> {
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
    let version = repo::get_prompt_version_by_id(&state.db, &version_id)?;

    // Update the persona's prompt to the version's prompt
    let update_input = crate::db::models::UpdatePersonaInput {
        structured_prompt: Some(version.structured_prompt.clone()),
        system_prompt: version.system_prompt.clone(),
        ..Default::default()
    };
    // Use a direct DB update to avoid re-triggering auto-versioning
    let conn = state.db.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(ref sp) = update_input.structured_prompt {
        conn.execute(
            "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![sp, now, version.persona_id],
        )?;
    }
    if let Some(ref sys) = update_input.system_prompt {
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
    repo::update_prompt_version_tag(&state.db, &version_id, "production")
}

/// Get the recent error rate for a persona.
#[tauri::command]
pub fn get_prompt_error_rate(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    window: Option<i64>,
) -> Result<f64, AppError> {
    repo::get_recent_error_rate(&state.db, &persona_id, window.unwrap_or(10))
}

// =============================================================================
// Prompt Lab — A/B Test
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
#[tauri::command]
pub async fn run_prompt_ab_test(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    version_a_id: String,
    version_b_id: String,
    test_input: Option<String>,
) -> Result<PromptAbTestResult, AppError> {
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

    // Run both executions concurrently
    let db_a = state.db.clone();
    let db_b = state.db.clone();
    let engine = state.engine.clone();
    let app_a = app.clone();
    let exec_a_id = exec_a.id.clone();
    let exec_b_id = exec_b.id.clone();

    let (res_a, res_b) = tokio::join!(
        engine.start_execution(app_a, db_a, exec_a_id.clone(), persona_a, tools.clone(), input_json.clone(), None),
        engine.start_execution(app, db_b, exec_b_id.clone(), persona_b, tools, input_json, None),
    );

    // Allow execution failures — we still want to report results
    let _ = res_a;
    let _ = res_b;

    // Wait a moment for executions to complete, then poll results
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Poll for completion (max 120s)
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    loop {
        let a = crate::db::repos::execution::executions::get_by_id(&state.db, &exec_a_id)?;
        let b = crate::db::repos::execution::executions::get_by_id(&state.db, &exec_b_id)?;

        let a_done = a.state().is_terminal();
        let b_done = b.state().is_terminal();

        if a_done && b_done {
            return Ok(PromptAbTestResult {
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
            });
        }

        if std::time::Instant::now() > deadline {
            return Err(AppError::Validation("A/B test timed out after 120 seconds".into()));
        }

        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
    }
}
