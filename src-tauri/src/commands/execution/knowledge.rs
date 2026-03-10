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
<<<<<<< HEAD

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
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
