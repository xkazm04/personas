//! Tauri command surface for the Workspace Knowledge Center
//! (docs/plans/workspace-knowledge-center.md). Thin `require_auth_sync` +
//! repo-delegation wrappers, mirroring `dev_tools.rs` conventions — kept as
//! its own module (like `kpi_sim`) instead of growing that 3.9k-line file.
//!
//! NOT related to `dev_tools/workspace.rs` (git-worktree isolation engine)
//! or `engine/workspace_sync` (cross-device DB sync).

use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    DevProject, DevWorkspace, WorkspaceImportItem, WorkspaceKnowledge, WorkspacePracticeAdoption,
};
use crate::db::repos::dev_workspaces as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// ============================================================================
// Workspaces
// ============================================================================

#[tauri::command]
pub fn dev_tools_workspace_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DevWorkspace>, AppError> {
    require_auth_sync(&state)?;
    repo::list_workspaces(&state.db)
}

#[tauri::command]
pub fn dev_tools_workspace_create(
    state: State<'_, Arc<AppState>>,
    name: String,
    color: Option<String>,
    description: Option<String>,
) -> Result<DevWorkspace, AppError> {
    require_auth_sync(&state)?;
    repo::create_workspace(&state.db, &name, color.as_deref(), description.as_deref())
}

#[tauri::command]
pub fn dev_tools_workspace_update(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    color: Option<Option<String>>,
    description: Option<Option<String>>,
) -> Result<DevWorkspace, AppError> {
    require_auth_sync(&state)?;
    repo::update_workspace(
        &state.db,
        &id,
        name.as_deref(),
        color.as_ref().map(|o| o.as_deref()),
        description.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_workspace_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_workspace(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_workspace_assign_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    workspace_id: Option<String>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::assign_project(&state.db, &project_id, workspace_id.as_deref())
}

#[tauri::command]
pub fn dev_tools_workspace_import_local(
    state: State<'_, Arc<AppState>>,
    items: Vec<WorkspaceImportItem>,
) -> Result<Vec<DevWorkspace>, AppError> {
    require_auth_sync(&state)?;
    repo::import_local(&state.db, &items)
}

// ============================================================================
// Knowledge
// ============================================================================

#[tauri::command]
pub fn dev_tools_workspace_knowledge_list(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    status: Option<String>,
) -> Result<Vec<WorkspaceKnowledge>, AppError> {
    require_auth_sync(&state)?;
    repo::list_knowledge(&state.db, &workspace_id, status.as_deref())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_workspace_knowledge_create(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    kind: String,
    title: String,
    statement: String,
    detail_md: Option<String>,
    topic: Option<String>,
    applicability: Option<String>,
    origin_project_id: Option<String>,
) -> Result<WorkspaceKnowledge, AppError> {
    require_auth_sync(&state)?;
    repo::create_knowledge(
        &state.db,
        &workspace_id,
        &kind,
        &title,
        &statement,
        detail_md.as_deref(),
        topic.as_deref(),
        applicability.as_deref(),
        origin_project_id.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_workspace_knowledge_update(
    state: State<'_, Arc<AppState>>,
    id: String,
    kind: Option<String>,
    title: Option<String>,
    statement: Option<String>,
    detail_md: Option<Option<String>>,
    topic: Option<Option<String>>,
    applicability: Option<Option<String>>,
) -> Result<WorkspaceKnowledge, AppError> {
    require_auth_sync(&state)?;
    repo::update_knowledge(
        &state.db,
        &id,
        kind.as_deref(),
        title.as_deref(),
        statement.as_deref(),
        detail_md.as_ref().map(|o| o.as_deref()),
        topic.as_ref().map(|o| o.as_deref()),
        applicability.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_workspace_knowledge_decide(
    state: State<'_, Arc<AppState>>,
    id: String,
    decision: String,
    superseded_by: Option<String>,
) -> Result<WorkspaceKnowledge, AppError> {
    require_auth_sync(&state)?;
    repo::decide_knowledge(&state.db, &id, &decision, superseded_by.as_deref())
}

#[tauri::command]
pub fn dev_tools_workspace_knowledge_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_knowledge(&state.db, &id)
}

// ============================================================================
// Adoption matrix
// ============================================================================

#[tauri::command]
pub fn dev_tools_workspace_adoption_list(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<Vec<WorkspacePracticeAdoption>, AppError> {
    require_auth_sync(&state)?;
    repo::list_adoption(&state.db, &workspace_id)
}

#[tauri::command]
pub fn dev_tools_workspace_adoption_set(
    state: State<'_, Arc<AppState>>,
    practice_id: String,
    project_id: String,
    adoption_state: String,
    note: Option<String>,
    fleet_key: Option<String>,
) -> Result<WorkspacePracticeAdoption, AppError> {
    require_auth_sync(&state)?;
    repo::set_adoption(
        &state.db,
        &practice_id,
        &project_id,
        &adoption_state,
        note.as_deref(),
        fleet_key.as_deref(),
    )
}

// ============================================================================
// Extraction engine — deterministic miners (Arc 2)
// ============================================================================

/// Run the deterministic (no-LLM) miners over a workspace and ingest their
/// candidates as `observed` knowledge with miner provenance. Cheap signal
/// before any harvest-skill LLM spend: cross-project shared findings +
/// cross-project skill-adoption gaps. Idempotent — dedup-gated on each
/// candidate's key (incl. the 90-day rejected window).
#[tauri::command]
pub fn dev_tools_workspace_run_miners(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<repo::IngestSummary, AppError> {
    require_auth_sync(&state)?;
    let mut candidates = repo::mine_shared_findings(&state.db, &workspace_id)?;
    candidates.extend(repo::mine_shared_skills(&state.db, &workspace_id)?);
    repo::ingest_candidates(&state.db, &workspace_id, &candidates, "miner", None)
}
