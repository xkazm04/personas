use std::sync::Arc;
use tauri::State;

use crate::db::models::{ExecutionKnowledge, KnowledgeGraphSummary};
use crate::db::repos::execution::knowledge as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_execution_knowledge(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    knowledge_type: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
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
    repo::get_summary(&state.db, persona_id.as_deref())
}
