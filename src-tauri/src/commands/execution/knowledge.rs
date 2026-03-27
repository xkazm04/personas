use std::sync::Arc;
use tauri::State;

use crate::db::models::{ExecutionKnowledge, KnowledgeGraphSummary};
use crate::db::repos::execution::knowledge as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_execution_knowledge(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    knowledge_type: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    require_auth_sync(&state)?;
    repo::list_for_persona(
        &state.db,
        &persona_id,
        knowledge_type.as_deref(),
        limit,
    )
}

#[tauri::command]
pub fn get_knowledge_injection(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    use_case_id: Option<String>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    require_auth_sync(&state)?;
    repo::get_injection_guidance(
        &state.db,
        &persona_id,
        use_case_id.as_deref(),
    )
}

#[tauri::command]
pub fn get_knowledge_summary(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<KnowledgeGraphSummary, AppError> {
    require_auth_sync(&state)?;
    repo::get_summary(&state.db, persona_id.as_deref())
}

#[tauri::command]
pub fn list_scoped_knowledge(
    state: State<'_, Arc<AppState>>,
    scope_type: String,
    scope_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    require_auth_sync(&state)?;
    repo::list_by_scope(
        &state.db,
        &scope_type,
        scope_id.as_deref(),
        limit,
    )
}

// -- Dev seed: mock knowledge pattern (debug builds only) -----------------------

#[cfg(debug_assertions)]
const MOCK_KNOWLEDGE_TYPES: &[&str] = &[
    "tool_sequence", "failure_pattern", "cost_quality", "model_performance",
    "data_flow", "agent_annotation",
];

#[cfg(debug_assertions)]
const MOCK_PATTERN_KEYS: &[&str] = &[
    "gmail→sheets_sync", "slack_timeout_retry", "gpt4_vs_haiku_cost",
    "sonnet_accuracy_report", "jira→github_flow", "memory_cleanup_rule",
];

#[cfg(debug_assertions)]
const MOCK_PATTERN_DATA: &[&str] = &[
    r#"{"sequence":["gmail.read","sheets.append"],"avg_latency_ms":1200,"notes":"Batch rows for efficiency"}"#,
    r#"{"error":"timeout","retry_strategy":"exponential","max_retries":3,"success_rate_after_retry":0.92}"#,
    r#"{"model_a":"gpt-4o","model_b":"haiku","cost_ratio":8.5,"quality_delta":0.12}"#,
    r#"{"model":"sonnet","task":"classification","accuracy":0.94,"sample_size":500}"#,
    r#"{"flow":["jira.webhook","transform","github.create_issue"],"avg_duration_ms":3400}"#,
    r#"{"rule":"Delete memories older than 90 days with importance < 2","source":"admin"}"#,
];

#[tauri::command]
pub fn seed_mock_knowledge(
    state: State<'_, Arc<AppState>>,
) -> Result<ExecutionKnowledge, AppError> {
    require_auth_sync(&state)?;

    #[cfg(not(debug_assertions))]
    {
        return Err(AppError::Validation(
            "seed_mock_knowledge is only available in debug builds".into(),
        ));
    }

    #[cfg(debug_assertions)]
    {
        let personas = crate::db::repos::core::personas::get_all(&state.db)?;
        if personas.is_empty() {
            return Err(AppError::Validation("No personas exist. Create an agent first.".into()));
        }
        let idx = (chrono::Utc::now().timestamp_millis() as usize) % personas.len();
        let persona_id = &personas[idx].id;

        let t = (chrono::Utc::now().timestamp_millis() as usize) / 7;
        let knowledge_type = MOCK_KNOWLEDGE_TYPES[t % MOCK_KNOWLEDGE_TYPES.len()];
        let pattern_key = MOCK_PATTERN_KEYS[t % MOCK_PATTERN_KEYS.len()];
        let pattern_data = MOCK_PATTERN_DATA[t % MOCK_PATTERN_DATA.len()];

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let success_count = ((t % 20) + 5) as i64;
        let failure_count = (t % 4) as i64;
        let avg_cost = 0.001 + (t % 10) as f64 * 0.002;
        let avg_duration = 800.0 + (t % 15) as f64 * 200.0;
        let confidence = 0.6 + (t % 4) as f64 * 0.1;

        let conn = state.db.get()?;
        conn.execute(
            "INSERT INTO execution_knowledge
             (id, persona_id, use_case_id, knowledge_type, pattern_key, pattern_data,
              success_count, failure_count, avg_cost_usd, avg_duration_ms, confidence,
              last_execution_id, scope_type, scope_id, created_at, updated_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, 'persona', NULL, ?11, ?11)",
            rusqlite::params![
                id, persona_id, knowledge_type, pattern_key, pattern_data,
                success_count, failure_count, avg_cost, avg_duration, confidence, now
            ],
        )?;

        Ok(ExecutionKnowledge {
            id,
            persona_id: persona_id.clone(),
            use_case_id: None,
            knowledge_type: knowledge_type.to_string(),
            pattern_key: pattern_key.to_string(),
            pattern_data: pattern_data.to_string(),
            success_count,
            failure_count,
            avg_cost_usd: avg_cost,
            avg_duration_ms: avg_duration,
            confidence,
            last_execution_id: None,
            created_at: now.clone(),
            updated_at: now,
            scope_type: "persona".to_string(),
            scope_id: None,
            annotation_text: None,
            annotation_source: None,
            is_verified: false,
        })
    }
}

/// Valid scope_type values for knowledge annotations.
const VALID_SCOPE_TYPES: &[&str] = &["tool", "connector", "global"];

#[tauri::command]
pub fn upsert_knowledge_annotation(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    scope_type: String,
    scope_id: Option<String>,
    annotation_text: String,
    annotation_source: Option<String>,
) -> Result<ExecutionKnowledge, AppError> {
    require_auth_sync(&state)?;
    if !VALID_SCOPE_TYPES.contains(&scope_type.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid scope_type '{}'. Must be one of: {}",
            scope_type,
            VALID_SCOPE_TYPES.join(", ")
        )));
    }
    repo::upsert_annotation(
        &state.db,
        &persona_id,
        &scope_type,
        scope_id.as_deref(),
        &annotation_text,
        annotation_source.as_deref().unwrap_or("user"),
        None,
    )
}

#[tauri::command]
pub fn verify_knowledge_annotation(
    state: State<'_, Arc<AppState>>,
    knowledge_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::verify_annotation(&state.db, &knowledge_id)
}

#[tauri::command]
pub fn dismiss_knowledge_annotation(
    state: State<'_, Arc<AppState>>,
    knowledge_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::dismiss_annotation(&state.db, &knowledge_id)
}

#[tauri::command]
pub fn get_shared_knowledge_injection(
    state: State<'_, Arc<AppState>>,
    tool_names: Vec<String>,
    connector_types: Vec<String>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    require_auth_sync(&state)?;
    let tool_refs: Vec<&str> = tool_names.iter().map(|s| s.as_str()).collect();
    let conn_refs: Vec<&str> = connector_types.iter().map(|s| s.as_str()).collect();
    repo::get_shared_injection(&state.db, &tool_refs, &conn_refs)
}
