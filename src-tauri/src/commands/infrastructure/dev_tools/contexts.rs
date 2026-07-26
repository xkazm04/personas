use std::sync::Arc;
use tauri::State;
use crate::db::models::{ContextHealthSnapshot, DevContext, DevContextGroup, DevContextGroupRelationship};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// ============================================================================
// Context Groups
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_context_groups(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevContextGroup>, AppError> {
    require_auth_sync(&state)?;
    repo::list_context_groups(&state.db, &project_id)
}

#[tauri::command]
pub fn dev_tools_create_context_group(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    group_type: Option<String>,
    domain: Option<String>,
) -> Result<DevContextGroup, AppError> {
    require_auth_sync(&state)?;
    repo::create_context_group(
        &state.db,
        &project_id,
        &name,
        color.as_deref(),
        icon.as_deref(),
        group_type.as_deref(),
        domain.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_context_group(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    color: Option<String>,
    icon: Option<Option<String>>,
    group_type: Option<Option<String>>,
    health_score: Option<Option<i32>>,
    last_scan_at: Option<Option<String>>,
    domain: Option<Option<String>>,
) -> Result<DevContextGroup, AppError> {
    require_auth_sync(&state)?;
    repo::update_context_group(
        &state.db,
        &id,
        name.as_deref(),
        color.as_deref(),
        icon.as_ref().map(|o| o.as_deref()),
        group_type.as_ref().map(|o| o.as_deref()),
        health_score,
        last_scan_at.as_ref().map(|o| o.as_deref()),
        domain.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_context_group(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_context_group(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_reorder_context_groups(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::reorder_context_groups(&state.db, &ids)
}

// ============================================================================
// Contexts
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_contexts(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    group_id: Option<String>,
) -> Result<Vec<DevContext>, AppError> {
    require_auth_sync(&state)?;
    repo::list_contexts_by_project(&state.db, &project_id, group_id.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_context(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevContext, AppError> {
    require_auth_sync(&state)?;
    repo::get_context_by_id(&state.db, &id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_context(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    name: String,
    group_id: Option<String>,
    description: Option<String>,
    file_paths: Option<String>,
    entry_points: Option<String>,
    db_tables: Option<String>,
    keywords: Option<String>,
    api_surface: Option<String>,
    cross_refs: Option<String>,
    tech_stack: Option<String>,
    category: Option<String>,
    business_feature: Option<String>,
) -> Result<DevContext, AppError> {
    require_auth_sync(&state)?;
    repo::create_context(
        &state.db,
        &project_id,
        &name,
        group_id.as_deref(),
        description.as_deref(),
        file_paths.as_deref(),
        entry_points.as_deref(),
        db_tables.as_deref(),
        keywords.as_deref(),
        api_surface.as_deref(),
        cross_refs.as_deref(),
        tech_stack.as_deref(),
        category.as_deref(),
        business_feature.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_context(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    file_paths: Option<String>,
    entry_points: Option<Option<String>>,
    db_tables: Option<Option<String>>,
    keywords: Option<Option<String>>,
    api_surface: Option<Option<String>>,
    cross_refs: Option<Option<String>>,
    tech_stack: Option<Option<String>>,
    category: Option<Option<String>>,
    business_feature: Option<Option<String>>,
) -> Result<DevContext, AppError> {
    require_auth_sync(&state)?;
    repo::update_context(
        &state.db,
        &id,
        name.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        file_paths.as_deref(),
        entry_points.as_ref().map(|o| o.as_deref()),
        db_tables.as_ref().map(|o| o.as_deref()),
        keywords.as_ref().map(|o| o.as_deref()),
        api_surface.as_ref().map(|o| o.as_deref()),
        cross_refs.as_ref().map(|o| o.as_deref()),
        tech_stack.as_ref().map(|o| o.as_deref()),
        category.as_ref().map(|o| o.as_deref()),
        business_feature.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_context(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_context(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_move_context_to_group(
    state: State<'_, Arc<AppState>>,
    id: String,
    group_id: Option<String>,
) -> Result<DevContext, AppError> {
    require_auth_sync(&state)?;
    repo::move_context_to_group(&state.db, &id, group_id.as_deref())
}

/// Pin (or unpin) a context so a full rescan preserves it instead of
/// DELETE-and-recreate. Pinning is how a maintainer protects hand-curation.
#[tauri::command]
pub fn dev_tools_set_context_pinned(
    state: State<'_, Arc<AppState>>,
    id: String,
    pinned: bool,
) -> Result<DevContext, AppError> {
    require_auth_sync(&state)?;
    repo::set_context_pinned(&state.db, &id, pinned)
}

// ============================================================================
// Context Group Relationships
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_context_group_relationships(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevContextGroupRelationship>, AppError> {
    require_auth_sync(&state)?;
    repo::list_context_group_relationships(&state.db, &project_id)
}

#[tauri::command]
pub fn dev_tools_create_context_group_relationship(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    source_group_id: String,
    target_group_id: String,
) -> Result<DevContextGroupRelationship, AppError> {
    require_auth_sync(&state)?;
    repo::create_context_group_relationship(
        &state.db,
        &project_id,
        &source_group_id,
        &target_group_id,
    )
}

#[tauri::command]
pub fn dev_tools_delete_context_group_relationship(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_context_group_relationship(&state.db, &id)
}

// ============================================================================
// Context Health Snapshots
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_health_snapshots(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    limit: Option<i32>,
) -> Result<Vec<ContextHealthSnapshot>, AppError> {
    require_auth_sync(&state)?;
    repo::list_health_snapshots(&state.db, &project_id, limit)
}
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn dev_tools_save_health_snapshot(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    group_id: Option<String>,
    group_name: String,
    overall_score: i32,
    security_score: Option<i32>,
    quality_score: Option<i32>,
    coverage_score: Option<i32>,
    debt_score: Option<i32>,
    issues_found: i32,
    issues_json: Option<String>,
    recommendations: Option<String>,
) -> Result<ContextHealthSnapshot, AppError> {
    require_auth_sync(&state)?;
    let snap = ContextHealthSnapshot {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        group_id,
        group_name,
        overall_score,
        security_score,
        quality_score,
        coverage_score,
        debt_score,
        issues_found,
        issues_json,
        recommendations,
        scanned_at: chrono::Utc::now().to_rfc3339(),
    };
    repo::insert_health_snapshot(&state.db, &snap)
}

