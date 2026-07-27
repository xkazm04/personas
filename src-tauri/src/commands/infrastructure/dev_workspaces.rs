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
    let project = repo::assign_project(&state.db, &project_id, workspace_id.as_deref())?;
    // POST-COMMIT (never inside `assign_project`'s tx — `create_finding` takes
    // its own connection and publishes on the bus): joining a workspace
    // inherits its adopted practices, and every cell that landed `to_process`
    // is work this repo now owes. The backfill is the right shape here — it
    // walks exactly the `to_process` cells and is dedup-gated, so a re-join
    // never stacks a second idea.
    if workspace_id.is_some() {
        match repo::backfill_practice_ideas(&state.db) {
            Ok(n) if n > 0 => tracing::info!(
                project_id = %project_id,
                count = n,
                "workspace join materialized {n} practice idea(s)"
            ),
            Err(e) => tracing::warn!(project_id = %project_id, error = %e, "practice materialization failed after workspace join"),
            _ => {}
        }
    }
    Ok(project)
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
    let item = repo::decide_knowledge(&state.db, &id, &decision, superseded_by.as_deref())?;

    // POST-COMMIT side effects (plan 1C). Deliberately out here rather than
    // inside `decide_knowledge`'s transaction: `create_finding` takes its own
    // pooled connection and publishes `signal.raised` on the bus, so running
    // it under the open tx would risk a pool deadlock and would announce work
    // a rollback could still erase.
    match decision.as_str() {
        // Adopting an ACTIONABLE practice makes it work every applicable member
        // repo owes — one backlog idea per project whose cell was seeded
        // `to_process`. Backlog becomes the adoption-queue executor.
        "adopt" => match repo::materialize_pending_for_practice(&state.db, &id) {
            Ok(n) if n > 0 => {
                tracing::info!(practice_id = %id, count = n, "adopted practice materialized {n} backlog idea(s)")
            }
            Err(e) => {
                tracing::warn!(practice_id = %id, error = %e, "practice materialization failed after adopt")
            }
            _ => {}
        },
        // Retiring a practice retires the work it asked for — but only the part
        // nobody has decided on yet.
        "deprecate" | "reject" => match repo::archive_practice_ideas(&state.db, &id) {
            Ok(n) if n > 0 => {
                tracing::info!(practice_id = %id, count = n, "retired practice archived {n} pending backlog idea(s)")
            }
            Err(e) => {
                tracing::warn!(practice_id = %id, error = %e, "failed to archive materialized practice ideas")
            }
            _ => {}
        },
        _ => {}
    }

    Ok(item)
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

/// Adjudicate many practices at once — the review path for a large harvest.
/// Same governance gate as the single decide (agents propose, humans adopt);
/// only the batch size changes.
#[tauri::command]
pub fn dev_tools_workspace_knowledge_decide_bulk(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
    decision: String,
) -> Result<repo::BulkDecision, AppError> {
    if ids.is_empty() {
        return Ok(repo::BulkDecision::default());
    }
    repo::decide_knowledge_bulk(&state.db, &ids, &decision, None)
}

/// Derive `governing_id` across a workspace: within each topic, the macro
/// doctrine adopts its instances. Runs after ingest and on demand.
#[tauri::command]
pub fn dev_tools_workspace_roll_up_doctrine(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<u32, AppError> {
    repo::roll_up_topic_doctrine(&state.db, &workspace_id)
}

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

/// Reconcile the adoption queue against the backlog: every `to_process` cell of
/// an adopted actionable practice that has no materialized idea yet gets one.
///
/// Idempotent and cheap when there is nothing to do, so it also runs once at
/// app start. Exposed as a command because the queue can be seeded by paths
/// that predate materialization (or by a direct `adoption_set`), and the user
/// should not have to re-adopt a practice to unstick its backlog.
#[tauri::command]
pub fn dev_tools_workspace_backfill_practice_ideas(
    state: State<'_, Arc<AppState>>,
) -> Result<u32, AppError> {
    require_auth_sync(&state)?;
    repo::backfill_practice_ideas(&state.db)
}

// ============================================================================
// Distribution — ambient projection (Arc 3)
// ============================================================================

/// Project the workspace's adopted practices into every member repo as a
/// Claude Code memory file, so future CLI sessions in those repos carry the
/// workspace's canon without a dispatch. Writes an owned file under
/// `.claude/` and appends at most one `@import` line to CLAUDE.md — it never
/// rewrites the user's own prose. Best-effort per project: an unwritable repo
/// is reported in its result row, not fatal to the run.
#[tauri::command]
pub fn dev_tools_workspace_project_practices(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<Vec<crate::engine::workspace_projection::ProjectionResult>, AppError> {
    require_auth_sync(&state)?;
    crate::engine::workspace_projection::project_workspace_practices(&state.db, &workspace_id)
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
