use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    DevContext, DevContextGroup, DevContextGroupRelationship, DevGoal, DevGoalSignal, DevIdea,
    DevProject, DevScan, DevTask, TriageRule,
};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// ============================================================================
// Projects
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_projects(
    state: State<'_, Arc<AppState>>,
    status: Option<String>,
) -> Result<Vec<DevProject>, AppError> {
    require_auth_sync(&state)?;
    repo::list_projects(&state.db, status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::get_project_by_id(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_create_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    root_path: String,
    description: Option<String>,
    status: Option<String>,
    tech_stack: Option<String>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::create_project(
        &state.db,
        &name,
        &root_path,
        description.as_deref(),
        status.as_deref(),
        tech_stack.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_update_project(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    tech_stack: Option<Option<String>>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::update_project(
        &state.db,
        &id,
        name.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        tech_stack.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_project(&state.db, &id)
}

// ============================================================================
// Goals
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_goals(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    status: Option<String>,
) -> Result<Vec<DevGoal>, AppError> {
    require_auth_sync(&state)?;
    repo::list_goals_by_project(&state.db, &project_id, status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_goal(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevGoal, AppError> {
    require_auth_sync(&state)?;
    repo::get_goal_by_id(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_create_goal(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    title: String,
    description: Option<String>,
    context_id: Option<String>,
    status: Option<String>,
    target_date: Option<String>,
) -> Result<DevGoal, AppError> {
    require_auth_sync(&state)?;
    repo::create_goal(
        &state.db,
        &project_id,
        &title,
        description.as_deref(),
        context_id.as_deref(),
        status.as_deref(),
        target_date.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_update_goal(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    progress: Option<i32>,
    target_date: Option<Option<String>>,
    context_id: Option<Option<String>>,
    started_at: Option<Option<String>>,
    completed_at: Option<Option<String>>,
) -> Result<DevGoal, AppError> {
    require_auth_sync(&state)?;
    repo::update_goal(
        &state.db,
        &id,
        title.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        progress,
        target_date.as_ref().map(|o| o.as_deref()),
        context_id.as_ref().map(|o| o.as_deref()),
        started_at.as_ref().map(|o| o.as_deref()),
        completed_at.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_goal(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_goal(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_reorder_goals(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::reorder_goals(&state.db, &ids)
}

// ============================================================================
// Goal Signals
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_goal_signals(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
    limit: Option<i64>,
) -> Result<Vec<DevGoalSignal>, AppError> {
    require_auth_sync(&state)?;
    repo::list_goal_signals(&state.db, &goal_id, limit)
}

#[tauri::command]
pub fn dev_tools_create_goal_signal(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
    signal_type: String,
    source_id: Option<String>,
    delta: Option<i32>,
    message: Option<String>,
) -> Result<DevGoalSignal, AppError> {
    require_auth_sync(&state)?;
    repo::create_goal_signal(
        &state.db,
        &goal_id,
        &signal_type,
        source_id.as_deref(),
        delta,
        message.as_deref(),
    )
}

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
) -> Result<DevContextGroup, AppError> {
    require_auth_sync(&state)?;
    repo::create_context_group(
        &state.db,
        &project_id,
        &name,
        color.as_deref(),
        icon.as_deref(),
        group_type.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_update_context_group(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    color: Option<String>,
    icon: Option<Option<String>>,
    group_type: Option<Option<String>>,
    health_score: Option<Option<i32>>,
    last_scan_at: Option<Option<String>>,
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
    )
}

#[tauri::command]
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
// Ideas
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_ideas(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    status: Option<String>,
    category: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<DevIdea>, AppError> {
    require_auth_sync(&state)?;
    repo::list_ideas(
        &state.db,
        project_id.as_deref(),
        status.as_deref(),
        category.as_deref(),
        limit,
        offset,
    )
}

#[tauri::command]
pub fn dev_tools_get_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    repo::get_idea_by_id(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_create_idea(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    context_id: Option<String>,
    scan_type: String,
    category: Option<String>,
    title: String,
    description: Option<String>,
    reasoning: Option<String>,
    status: Option<String>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    repo::create_idea(
        &state.db,
        project_id.as_deref(),
        context_id.as_deref(),
        &scan_type,
        category.as_deref(),
        &title,
        description.as_deref(),
        reasoning.as_deref(),
        status.as_deref(),
        effort,
        impact,
        risk,
        provider.as_deref(),
        model.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_update_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    category: Option<String>,
    effort: Option<Option<i32>>,
    impact: Option<Option<i32>>,
    risk: Option<Option<i32>>,
    rejection_reason: Option<Option<String>>,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    repo::update_idea(
        &state.db,
        &id,
        title.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        category.as_deref(),
        effort,
        impact,
        risk,
        rejection_reason.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_idea(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_bulk_delete_ideas(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<usize, AppError> {
    require_auth_sync(&state)?;
    repo::bulk_delete_ideas(&state.db, &ids)
}

// ============================================================================
// Scans
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_scans(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<DevScan>, AppError> {
    require_auth_sync(&state)?;
    repo::list_scans(&state.db, project_id.as_deref(), limit)
}

#[tauri::command]
pub fn dev_tools_get_scan(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevScan, AppError> {
    require_auth_sync(&state)?;
    repo::get_scan_by_id(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_create_scan(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    scan_type: String,
    status: Option<String>,
) -> Result<DevScan, AppError> {
    require_auth_sync(&state)?;
    repo::create_scan(
        &state.db,
        project_id.as_deref(),
        &scan_type,
        status.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_update_scan(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: Option<String>,
    idea_count: Option<i32>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<Option<String>>,
) -> Result<DevScan, AppError> {
    require_auth_sync(&state)?;
    repo::update_scan(
        &state.db,
        &id,
        status.as_deref(),
        idea_count,
        input_tokens,
        output_tokens,
        duration_ms,
        error.as_ref().map(|o| o.as_deref()),
    )
}

// ============================================================================
// Tasks
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_tasks(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<DevTask>, AppError> {
    require_auth_sync(&state)?;
    repo::list_tasks(&state.db, project_id.as_deref(), status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_task(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevTask, AppError> {
    require_auth_sync(&state)?;
    repo::get_task_by_id(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_create_task(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    title: String,
    description: Option<String>,
    source_idea_id: Option<String>,
    goal_id: Option<String>,
    status: Option<String>,
) -> Result<DevTask, AppError> {
    require_auth_sync(&state)?;
    repo::create_task(
        &state.db,
        project_id.as_deref(),
        &title,
        description.as_deref(),
        source_idea_id.as_deref(),
        goal_id.as_deref(),
        status.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_update_task(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    session_id: Option<Option<String>>,
    progress_pct: Option<i32>,
    output_lines: Option<i32>,
    error: Option<Option<String>>,
    started_at: Option<Option<String>>,
    completed_at: Option<Option<String>>,
) -> Result<DevTask, AppError> {
    require_auth_sync(&state)?;
    repo::update_task(
        &state.db,
        &id,
        title.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        session_id.as_ref().map(|o| o.as_deref()),
        progress_pct,
        output_lines,
        error.as_ref().map(|o| o.as_deref()),
        started_at.as_ref().map(|o| o.as_deref()),
        completed_at.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_task(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_task(&state.db, &id)
}

// ============================================================================
// Triage Rules
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_triage_rules(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<Vec<TriageRule>, AppError> {
    require_auth_sync(&state)?;
    repo::list_triage_rules(&state.db, project_id.as_deref())
}

#[tauri::command]
pub fn dev_tools_create_triage_rule(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    name: String,
    conditions: String,
    action: String,
    enabled: Option<bool>,
) -> Result<TriageRule, AppError> {
    require_auth_sync(&state)?;
    repo::create_triage_rule(
        &state.db,
        project_id.as_deref(),
        &name,
        &conditions,
        &action,
        enabled,
    )
}

#[tauri::command]
pub fn dev_tools_update_triage_rule(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    conditions: Option<String>,
    action: Option<String>,
    enabled: Option<bool>,
    times_fired: Option<i32>,
) -> Result<TriageRule, AppError> {
    require_auth_sync(&state)?;
    repo::update_triage_rule(
        &state.db,
        &id,
        name.as_deref(),
        conditions.as_deref(),
        action.as_deref(),
        enabled,
        times_fired,
    )
}

#[tauri::command]
pub fn dev_tools_delete_triage_rule(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_triage_rule(&state.db, &id)
}
