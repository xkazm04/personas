use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    DevCompetition, DevCompetitionSlot, DevContext, DevContextGroup, DevContextGroupRelationship,
    DevGoal, DevGoalDependency, DevGoalSignal, DevIdea, DevPipeline, DevProject, DevScan, DevTask,
    ContextHealthSnapshot, TriageRule, CrossProjectRelation, PortfolioHealthSummary,
    TechRadarEntry, RiskMatrixEntry, TestRunResult, GitOperationResult,
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
    github_url: Option<String>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::create_project(
        &state.db,
        &name,
        &root_path,
        description.as_deref(),
        status.as_deref(),
        tech_stack.as_deref(),
        github_url.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_project(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    tech_stack: Option<Option<String>>,
    github_url: Option<Option<String>>,
    monitoring_credential_id: Option<Option<String>>,
    monitoring_project_slug: Option<Option<String>>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::update_project(
        &state.db,
        &id,
        name.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        tech_stack.as_ref().map(|o| o.as_deref()),
        github_url.as_ref().map(|o| o.as_deref()),
        monitoring_credential_id.as_ref().map(|o| o.as_deref()),
        monitoring_project_slug.as_ref().map(|o| o.as_deref()),
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
// Active Project (in-memory session state)
// ============================================================================

static ACTIVE_PROJECT_ID: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn dev_tools_get_active_project(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<DevProject>, AppError> {
    require_auth_sync(&state)?;
    let guard = ACTIVE_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_deref() {
        Some(id) => match repo::get_project_by_id(&state.db, id) {
            Ok(p) => Ok(Some(p)),
            Err(_) => Ok(None),
        },
        None => Ok(None),
    }
}

#[tauri::command]
pub fn dev_tools_set_active_project(
    state: State<'_, Arc<AppState>>,
    id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let mut guard = ACTIVE_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner());
    *guard = id;
    Ok(())
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
    parent_goal_id: Option<String>,
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
        parent_goal_id.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
// Goal Dependencies
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_goal_dependencies(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
) -> Result<Vec<DevGoalDependency>, AppError> {
    require_auth_sync(&state)?;
    repo::list_goal_dependencies(&state.db, &goal_id)
}

#[tauri::command]
pub fn dev_tools_add_goal_dependency(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
    depends_on_id: String,
    dependency_type: Option<String>,
) -> Result<DevGoalDependency, AppError> {
    require_auth_sync(&state)?;
    repo::add_goal_dependency(&state.db, &goal_id, &depends_on_id, dependency_type.as_deref())
}

#[tauri::command]
pub fn dev_tools_remove_goal_dependency(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::remove_goal_dependency(&state.db, &id)
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
#[allow(clippy::too_many_arguments)]
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
#[allow(clippy::too_many_arguments)]
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
#[allow(clippy::too_many_arguments)]
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
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_task(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    title: String,
    description: Option<String>,
    source_idea_id: Option<String>,
    goal_id: Option<String>,
    status: Option<String>,
    depth: Option<String>,
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
        depth.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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

/// Run all enabled triage rules against pending ideas for a project.
/// Returns the number of ideas affected.
#[tauri::command]
pub fn dev_tools_run_triage_rules(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    // 1. Fetch enabled rules
    let rules = repo::list_triage_rules(&state.db, Some(&project_id))?;
    let enabled_rules: Vec<_> = rules.into_iter().filter(|r| r.enabled).collect();

    if enabled_rules.is_empty() {
        return Ok(serde_json::json!({ "applied": 0, "ideas_affected": 0 }));
    }

    // 2. Fetch pending ideas
    let ideas = repo::list_ideas(
        &state.db,
        Some(&project_id),
        Some("pending"),
        None,
        None,
        None,
    )?;

    let mut ideas_affected = 0;

    // 3. Evaluate rules against each idea (first matching rule wins)
    for idea in &ideas {
        for rule in &enabled_rules {
            if evaluate_triage_conditions(&rule.conditions, idea) {
                let new_status = if rule.action == "accept" {
                    "accepted"
                } else {
                    "rejected"
                };
                let _ = repo::update_idea(
                    &state.db,
                    &idea.id,
                    None,
                    None,
                    Some(new_status),
                    None,
                    None,
                    None,
                    None,
                    None,
                );
                // Increment times_fired
                let _ = repo::update_triage_rule(
                    &state.db,
                    &rule.id,
                    None,
                    None,
                    None,
                    None,
                    Some(rule.times_fired + 1),
                );
                ideas_affected += 1;
                break; // first match wins
            }
        }
    }

    Ok(serde_json::json!({ "applied": enabled_rules.len(), "ideas_affected": ideas_affected }))
}

/// Evaluate triage rule conditions against a single idea.
/// Conditions are JSON: [{ "field": "effort|impact|risk|category|scan_type", "op": "lt|gt|eq|in", "value": ... }]
/// All conditions must match (AND logic).
fn evaluate_triage_conditions(
    conditions_json: &str,
    idea: &DevIdea,
) -> bool {
    let conditions: Vec<serde_json::Value> = match serde_json::from_str(conditions_json) {
        Ok(c) => c,
        Err(_) => return false,
    };

    conditions.iter().all(|cond| {
        let field = cond.get("field").and_then(|f| f.as_str()).unwrap_or("");
        let op = cond.get("op").and_then(|o| o.as_str()).unwrap_or("");
        let value = cond.get("value");

        match field {
            "effort" => compare_numeric(idea.effort.unwrap_or(0), op, value),
            "impact" => compare_numeric(idea.impact.unwrap_or(0), op, value),
            "risk" => compare_numeric(idea.risk.unwrap_or(0), op, value),
            "category" => compare_string(Some(&idea.category), op, value),
            "scan_type" => compare_string(Some(&idea.scan_type), op, value),
            _ => false,
        }
    })
}

fn compare_numeric(field_value: i32, op: &str, value: Option<&serde_json::Value>) -> bool {
    let target = value.and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    match op {
        "lt" => field_value < target,
        "gt" => field_value > target,
        "eq" => field_value == target,
        "lte" => field_value <= target,
        "gte" => field_value >= target,
        _ => false,
    }
}

fn compare_string(field_value: Option<&str>, op: &str, value: Option<&serde_json::Value>) -> bool {
    let field_str = field_value.unwrap_or("");
    match op {
        "eq" => value
            .and_then(|v| v.as_str())
            .map(|s| s == field_str)
            .unwrap_or(false),
        "in" => value
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().any(|item| item.as_str() == Some(field_str)))
            .unwrap_or(false),
        _ => false,
    }
}

// ============================================================================
// Pipelines (Idea-to-Execution)
// ============================================================================

#[tauri::command]
pub fn dev_tools_create_pipeline(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    idea_id: String,
    auto_execute: Option<bool>,
    verify_after: Option<bool>,
) -> Result<DevPipeline, AppError> {
    require_auth_sync(&state)?;
    repo::create_pipeline(
        &state.db,
        &project_id,
        &idea_id,
        auto_execute.unwrap_or(true),
        verify_after.unwrap_or(false),
    )
}

#[tauri::command]
pub fn dev_tools_list_pipelines(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    stage: Option<String>,
) -> Result<Vec<DevPipeline>, AppError> {
    require_auth_sync(&state)?;
    repo::list_pipelines(&state.db, &project_id, stage.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_pipeline(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevPipeline, AppError> {
    require_auth_sync(&state)?;
    repo::get_pipeline_by_id(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_advance_pipeline(
    state: State<'_, Arc<AppState>>,
    id: String,
    new_stage: String,
    task_id: Option<String>,
    error: Option<String>,
) -> Result<DevPipeline, AppError> {
    require_auth_sync(&state)?;
    repo::advance_pipeline_stage(
        &state.db,
        &id,
        &new_stage,
        task_id.as_deref(),
        error.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_delete_pipeline(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_pipeline(&state.db, &id)
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

// ============================================================================
// Cross-Project (Codebases connector)
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_cross_project_relations(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CrossProjectRelation>, AppError> {
    require_auth_sync(&state)?;
    repo::list_cross_project_relations(&state.db)
}

#[tauri::command]
pub fn dev_tools_upsert_cross_project_relation(
    state: State<'_, Arc<AppState>>,
    source_project_id: String,
    target_project_id: String,
    relation_type: String,
    details: Option<String>,
) -> Result<CrossProjectRelation, AppError> {
    require_auth_sync(&state)?;
    repo::upsert_cross_project_relation(
        &state.db,
        &source_project_id,
        &target_project_id,
        &relation_type,
        details.as_deref(),
    )
}

/// Get a cross-project dependency map: all projects with their relations.
/// If a rich metadata map has been generated via generate_cross_project_metadata,
/// return that instead so agents get the full metadata layer.
#[tauri::command]
pub fn dev_tools_get_cross_project_map(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    // Prefer the rich cached metadata map if it exists
    if let Some(cached) = crate::db::repos::core::settings::get(&state.db, CROSS_PROJECT_METADATA_KEY)? {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cached) {
            return Ok(parsed);
        }
    }

    let projects = repo::list_projects(&state.db, None)?;
    let relations = repo::list_cross_project_relations(&state.db)?;

    let project_summaries: Vec<serde_json::Value> = projects
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "root_path": p.root_path,
                "description": p.description,
                "tech_stack": p.tech_stack,
                "github_url": p.github_url,
                "status": p.status,
            })
        })
        .collect();

    let relation_edges: Vec<serde_json::Value> = relations
        .iter()
        .map(|r| {
            serde_json::json!({
                "source": r.source_project_id,
                "target": r.target_project_id,
                "type": r.relation_type,
                "details": r.details,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "projects": project_summaries,
        "relations": relation_edges,
        "generated_at": chrono::Utc::now().to_rfc3339(),
    }))
}

// ============================================================================
// Rich Cross-Project Metadata Map
//
// Aggregates per-project capabilities, keywords, tech layers, and entry points
// from each project's already-generated context map. Caches the result in
// app_settings under CROSS_PROJECT_METADATA_KEY so agents connecting via the
// Codebases connector can efficiently evaluate which projects are relevant to
// a business task without re-scanning the filesystem.
// ============================================================================

const CROSS_PROJECT_METADATA_KEY: &str = "dev_tools_cross_project_metadata";

fn parse_json_array(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

fn top_n_by_count(counts: std::collections::HashMap<String, u32>, n: usize) -> Vec<String> {
    let mut pairs: Vec<(String, u32)> = counts.into_iter().collect();
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    pairs.into_iter().take(n).map(|(k, _)| k).collect()
}

fn detect_tech_layers(tech_stack_fields: &[Vec<String>], declared_tech_stack: &Option<String>) -> Vec<String> {
    let mut layers = std::collections::HashSet::new();
    let all: Vec<String> = tech_stack_fields
        .iter()
        .flatten()
        .cloned()
        .chain(
            declared_tech_stack
                .as_deref()
                .map(|s| s.split(',').map(|x| x.trim().to_string()).collect::<Vec<_>>())
                .unwrap_or_default(),
        )
        .collect();

    for item in &all {
        let lower = item.to_lowercase();
        if lower.contains("react") || lower.contains("vue") || lower.contains("svelte") || lower.contains("angular") {
            layers.insert("frontend".to_string());
        }
        if lower.contains("rust") || lower.contains("tauri") || lower.contains("actix") {
            layers.insert("rust-backend".to_string());
        }
        if lower.contains("node") || lower.contains("express") || lower.contains("nest") || lower.contains("fastify") {
            layers.insert("node-backend".to_string());
        }
        if lower.contains("python") || lower.contains("fastapi") || lower.contains("django") || lower.contains("flask") {
            layers.insert("python-backend".to_string());
        }
        if lower.contains("postgres") || lower.contains("mysql") || lower.contains("sqlite") || lower.contains("mongo") {
            layers.insert("database".to_string());
        }
        if lower.contains("typescript") || lower.contains("ts") {
            layers.insert("typescript".to_string());
        }
        if lower.contains("docker") || lower.contains("kubernetes") || lower.contains("terraform") {
            layers.insert("devops".to_string());
        }
    }

    let mut result: Vec<String> = layers.into_iter().collect();
    result.sort();
    result
}

fn jaccard_similarity(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let set_a: std::collections::HashSet<&String> = a.iter().collect();
    let set_b: std::collections::HashSet<&String> = b.iter().collect();
    let intersection = set_a.intersection(&set_b).count() as f64;
    let union = set_a.union(&set_b).count() as f64;
    if union == 0.0 { 0.0 } else { intersection / union }
}

/// Aggregate metadata for a single project from its existing context map.
fn aggregate_project_metadata(
    pool: &crate::db::DbPool,
    project: &crate::db::models::DevProject,
) -> Result<serde_json::Value, AppError> {
    let contexts = repo::list_contexts_by_project(pool, &project.id, None)?;
    let groups = repo::list_context_groups(pool, &project.id)?;
    let goals = repo::list_goals_by_project(pool, &project.id, None).unwrap_or_default();

    // Capabilities: derived from context groups (one entry per group with count)
    let capabilities: Vec<serde_json::Value> = groups
        .iter()
        .map(|g| {
            let count = contexts.iter().filter(|c| c.group_id.as_deref() == Some(&g.id)).count();
            serde_json::json!({
                "name": g.name,
                "color": g.color,
                "group_type": g.group_type,
                "context_count": count,
            })
        })
        .collect();

    // Aggregate arrays from every context
    let mut keyword_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut all_entry_points: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_db_tables: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_api_surface: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_cross_refs: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut tech_stack_fields: Vec<Vec<String>> = Vec::new();
    let mut file_path_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    for ctx in &contexts {
        for k in parse_json_array(&Some(ctx.keywords.clone().unwrap_or_default())) {
            let normalized = k.trim().to_lowercase();
            if !normalized.is_empty() && normalized.len() > 2 {
                *keyword_counts.entry(normalized).or_insert(0) += 1;
            }
        }
        for ep in parse_json_array(&ctx.entry_points) {
            if !ep.trim().is_empty() { all_entry_points.insert(ep); }
        }
        for db in parse_json_array(&ctx.db_tables) {
            if !db.trim().is_empty() { all_db_tables.insert(db); }
        }
        for api in parse_json_array(&ctx.api_surface) {
            if !api.trim().is_empty() { all_api_surface.insert(api); }
        }
        for xref in parse_json_array(&ctx.cross_refs) {
            if !xref.trim().is_empty() { all_cross_refs.insert(xref); }
        }
        tech_stack_fields.push(parse_json_array(&ctx.tech_stack));

        // Extract directory prefixes from file_paths to show hot areas
        for fp in parse_json_array(&Some(ctx.file_paths.clone())) {
            let dir = fp.split(&['/', '\\'][..]).next().unwrap_or(&fp).to_string();
            if !dir.is_empty() {
                *file_path_counts.entry(dir).or_insert(0) += 1;
            }
        }
    }

    let top_keywords = top_n_by_count(keyword_counts, 30);
    let hot_directories = top_n_by_count(file_path_counts, 10);
    let tech_layers = detect_tech_layers(&tech_stack_fields, &project.tech_stack);

    // Summary: human-readable one-liner
    let summary = if contexts.is_empty() {
        format!(
            "No context map generated yet for {}. Run Context Map scan to enable rich metadata.",
            project.name
        )
    } else {
        let capability_list: Vec<String> = groups.iter().take(5).map(|g| g.name.clone()).collect();
        format!(
            "{} — {} contexts across {} groups ({}). Tech: {}. {}",
            project.name,
            contexts.len(),
            groups.len(),
            capability_list.join(", "),
            if tech_layers.is_empty() { "unspecified".to_string() } else { tech_layers.join(", ") },
            project.description.as_deref().unwrap_or("No description.")
        )
    };

    Ok(serde_json::json!({
        "project_id": project.id,
        "name": project.name,
        "root_path": project.root_path,
        "description": project.description,
        "github_url": project.github_url,
        "status": project.status,
        "declared_tech_stack": project.tech_stack,
        "summary": summary,
        "capabilities": capabilities,
        "keywords": top_keywords,
        "tech_layers": tech_layers,
        "entry_points": all_entry_points.into_iter().take(20).collect::<Vec<_>>(),
        "db_tables": all_db_tables.into_iter().take(20).collect::<Vec<_>>(),
        "api_surface": all_api_surface.into_iter().take(20).collect::<Vec<_>>(),
        "cross_refs": all_cross_refs.into_iter().collect::<Vec<_>>(),
        "hot_directories": hot_directories,
        "context_count": contexts.len(),
        "group_count": groups.len(),
        "active_goal_count": goals.iter().filter(|g| g.status == "in-progress" || g.status == "open").count(),
    }))
}

/// Generate a rich cross-project metadata map by aggregating each project's
/// existing context map. No filesystem scanning — reuses data already in the DB.
#[tauri::command]
pub fn dev_tools_generate_cross_project_metadata(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let projects = repo::list_projects(&state.db, None)?;
    let relations = repo::list_cross_project_relations(&state.db)?;

    // Aggregate per project
    let mut project_metadata: Vec<serde_json::Value> = Vec::new();
    for project in &projects {
        match aggregate_project_metadata(&state.db, project) {
            Ok(meta) => project_metadata.push(meta),
            Err(e) => {
                tracing::warn!("Failed to aggregate metadata for {}: {}", project.name, e);
            }
        }
    }

    // Cross-project insights
    let project_keyword_sets: Vec<(String, Vec<String>)> = project_metadata
        .iter()
        .map(|p| {
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let keywords: Vec<String> = p
                .get("keywords")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            (name, keywords)
        })
        .collect();

    // Shared keywords: appearing in 2+ projects
    let mut keyword_project_count: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (name, keywords) in &project_keyword_sets {
        for kw in keywords {
            keyword_project_count.entry(kw.clone()).or_default().push(name.clone());
        }
    }
    let shared_keywords: Vec<serde_json::Value> = keyword_project_count
        .iter()
        .filter(|(_, projects)| projects.len() >= 2)
        .map(|(kw, projects)| {
            serde_json::json!({ "keyword": kw, "projects": projects, "count": projects.len() })
        })
        .collect();

    // Similarity matrix
    let mut similarity_matrix: Vec<serde_json::Value> = Vec::new();
    for i in 0..project_keyword_sets.len() {
        for j in (i + 1)..project_keyword_sets.len() {
            let sim = jaccard_similarity(&project_keyword_sets[i].1, &project_keyword_sets[j].1);
            if sim > 0.0 {
                similarity_matrix.push(serde_json::json!({
                    "source": project_keyword_sets[i].0,
                    "target": project_keyword_sets[j].0,
                    "similarity": (sim * 100.0).round() / 100.0,
                }));
            }
        }
    }

    // Shared tech layers across projects
    let mut tech_layer_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for p in &project_metadata {
        if let Some(layers) = p.get("tech_layers").and_then(|v| v.as_array()) {
            for l in layers {
                if let Some(s) = l.as_str() {
                    *tech_layer_counts.entry(s.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    let tech_distribution: Vec<serde_json::Value> = tech_layer_counts
        .into_iter()
        .map(|(layer, count)| serde_json::json!({ "layer": layer, "project_count": count }))
        .collect();

    let relation_edges: Vec<serde_json::Value> = relations
        .iter()
        .map(|r| {
            serde_json::json!({
                "source": r.source_project_id,
                "target": r.target_project_id,
                "type": r.relation_type,
                "details": r.details,
            })
        })
        .collect();

    let result = serde_json::json!({
        "projects": project_metadata,
        "cross_project": {
            "shared_keywords": shared_keywords,
            "similarity_matrix": similarity_matrix,
            "tech_distribution": tech_distribution,
            "relations": relation_edges,
        },
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "total_projects": projects.len(),
    });

    // Cache result in app_settings
    let json_str = serde_json::to_string(&result)
        .map_err(|e| AppError::Validation(format!("Failed to serialize metadata: {e}")))?;
    crate::db::repos::core::settings::set(&state.db, CROSS_PROJECT_METADATA_KEY, &json_str)?;

    Ok(result)
}

/// Get the cached cross-project metadata map. Returns None if never generated.
#[tauri::command]
pub fn dev_tools_get_cross_project_metadata(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<serde_json::Value>, AppError> {
    require_auth_sync(&state)?;
    match crate::db::repos::core::settings::get(&state.db, CROSS_PROJECT_METADATA_KEY)? {
        Some(json_str) => {
            let parsed: serde_json::Value = serde_json::from_str(&json_str)
                .map_err(|e| AppError::Validation(format!("Corrupted metadata cache: {e}")))?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}

/// Bulk create ideas targeting different projects.
#[tauri::command]
pub fn dev_tools_create_idea_batch(
    state: State<'_, Arc<AppState>>,
    ideas: Vec<serde_json::Value>,
) -> Result<Vec<DevIdea>, AppError> {
    require_auth_sync(&state)?;
    let mut tuples = Vec::new();
    for idea in &ideas {
        let project_id = idea.get("project_id").and_then(|v| v.as_str());
        let context_id = idea.get("context_id").and_then(|v| v.as_str());
        let scan_type = idea.get("scan_type").and_then(|v| v.as_str()).unwrap_or("cross-impact");
        let category = idea.get("category").and_then(|v| v.as_str()).unwrap_or("technical");
        let title = idea.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
        let description = idea.get("description").and_then(|v| v.as_str());
        let effort = idea.get("effort").and_then(|v| v.as_i64()).map(|v| v as i32);
        let impact = idea.get("impact").and_then(|v| v.as_i64()).map(|v| v as i32);
        let risk = idea.get("risk").and_then(|v| v.as_i64()).map(|v| v as i32);
        tuples.push((project_id, context_id, scan_type, category, title, description, effort, impact, risk));
    }
    repo::bulk_create_ideas_cross_project(&state.db, &tuples)
}

/// Search code across all registered projects using ripgrep.
#[tauri::command]
pub async fn dev_tools_search_across_projects(
    state: State<'_, Arc<AppState>>,
    query: String,
    file_pattern: Option<String>,
    max_results_per_project: Option<i32>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let projects = repo::list_projects(&state.db, Some("active"))?;
    let limit = max_results_per_project.unwrap_or(20);

    let mut results = Vec::new();
    for project in &projects {
        let mut args = vec![
            "--json".to_string(),
            "--max-count".to_string(),
            limit.to_string(),
            "--no-heading".to_string(),
        ];
        if let Some(ref pat) = file_pattern {
            args.push("--glob".to_string());
            args.push(pat.clone());
        }
        args.push(query.clone());
        args.push(project.root_path.clone());

        let output = tokio::process::Command::new("rg")
            .args(&args)
            .output()
            .await;

        let matches: Vec<serde_json::Value> = match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                    .filter(|v| v.get("type").and_then(|t| t.as_str()) == Some("match"))
                    .collect()
            }
            Err(_) => vec![],
        };

        if !matches.is_empty() {
            results.push(serde_json::json!({
                "project_id": project.id,
                "project_name": project.name,
                "root_path": project.root_path,
                "match_count": matches.len(),
                "matches": matches,
            }));
        }
    }

    Ok(serde_json::json!({
        "query": query,
        "projects_searched": projects.len(),
        "projects_with_matches": results.len(),
        "results": results,
    }))
}

// ============================================================================
// Direction 3: Agent-Driven Implementation Pipeline
// ============================================================================

/// Create a git branch in a project.
#[tauri::command]
pub async fn dev_tools_create_branch(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    branch_name: String,
    base_branch: Option<String>,
) -> Result<GitOperationResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let base = base_branch.unwrap_or_else(|| "HEAD".to_string());

    let output = tokio::process::Command::new("git")
        .args(["checkout", "-b", &branch_name, &base])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to run git: {e}")))?;

    let success = output.status.success();
    let message = if success {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        String::from_utf8_lossy(&output.stderr).to_string()
    };

    Ok(GitOperationResult {
        success,
        message: message.trim().to_string(),
        branch_name: if success { Some(branch_name) } else { None },
        commit_hash: None,
        files_changed: None,
    })
}

/// Apply a unified diff to files in a project.
#[tauri::command]
pub async fn dev_tools_apply_diff(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    diff_content: String,
) -> Result<GitOperationResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    let mut child = tokio::process::Command::new("git")
        .args(["apply", "--stat", "--apply", "-"])
        .current_dir(&project.root_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Internal(format!("Failed to spawn git apply: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(diff_content.as_bytes()).await.ok();
        drop(stdin);
    }

    let output = child.wait_with_output().await
        .map_err(|e| AppError::Internal(format!("git apply failed: {e}")))?;

    let success = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    Ok(GitOperationResult {
        success,
        message: if success { stdout.trim().to_string() } else { stderr.trim().to_string() },
        branch_name: None,
        commit_hash: None,
        files_changed: None,
    })
}

/// Run tests for a project by detecting the test runner.
#[tauri::command]
pub async fn dev_tools_run_tests(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    test_command: Option<String>,
) -> Result<TestRunResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let root = std::path::Path::new(&project.root_path);

    // Auto-detect test command if not provided
    let cmd = if let Some(ref c) = test_command {
        c.clone()
    } else if root.join("Cargo.toml").exists() {
        "cargo test --no-fail-fast 2>&1".to_string()
    } else if root.join("package.json").exists() {
        "npm test -- --passWithNoTests 2>&1".to_string()
    } else if root.join("pyproject.toml").exists() || root.join("setup.py").exists() {
        "python -m pytest -v 2>&1".to_string()
    } else {
        return Err(AppError::Validation("Could not detect test runner. Provide test_command.".into()));
    };

    let start = std::time::Instant::now();

    let output = if cfg!(target_os = "windows") {
        tokio::process::Command::new("cmd")
            .args(["/C", &cmd])
            .current_dir(&project.root_path)
            .output()
            .await
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", &cmd])
            .current_dir(&project.root_path)
            .output()
            .await
    };

    let duration_ms = start.elapsed().as_millis() as i64;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let full_output = format!("{stdout}\n{stderr}");
            let success = out.status.success();

            // Parse test counts heuristically from output
            let (total, passed, failed, skipped) = parse_test_counts(&full_output);

            Ok(TestRunResult {
                project_id,
                success,
                total_tests: total,
                passed,
                failed,
                skipped,
                duration_ms,
                output: full_output,
                error: if success { None } else { Some(stderr) },
            })
        }
        Err(e) => Ok(TestRunResult {
            project_id,
            success: false,
            total_tests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration_ms,
            output: String::new(),
            error: Some(format!("Failed to execute test command: {e}")),
        }),
    }
}

/// Parse test counts from common test runner outputs.
fn parse_test_counts(output: &str) -> (i32, i32, i32, i32) {
    // Cargo test: "test result: ok. X passed; Y failed; Z ignored"
    if let Some(caps) = regex::Regex::new(r"(\d+) passed[;,]\s*(\d+) failed[;,]\s*(\d+) ignored")
        .ok()
        .and_then(|re| re.captures(output))
    {
        let p: i32 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let f: i32 = caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let s: i32 = caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        return (p + f + s, p, f, s);
    }
    // Jest/Vitest: "Tests: X passed, Y failed, Z total"
    if let Some(caps) = regex::Regex::new(r"Tests:\s+(?:(\d+) passed)?[,\s]*(?:(\d+) failed)?[,\s]*(\d+) total")
        .ok()
        .and_then(|re| re.captures(output))
    {
        let p: i32 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let f: i32 = caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let t: i32 = caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        return (t, p, f, t - p - f);
    }
    // pytest: "X passed, Y failed"
    if let Some(caps) = regex::Regex::new(r"(\d+) passed")
        .ok()
        .and_then(|re| re.captures(output))
    {
        let p: i32 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let f: i32 = regex::Regex::new(r"(\d+) failed")
            .ok()
            .and_then(|re| re.captures(output))
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        return (p + f, p, f, 0);
    }
    (0, 0, 0, 0)
}

/// Get git status for a project.
#[tauri::command]
pub async fn dev_tools_get_git_status(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    let branch_output = tokio::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git branch failed: {e}")))?;

    let status_output = tokio::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git status failed: {e}")))?;

    let log_output = tokio::process::Command::new("git")
        .args(["log", "--oneline", "-5"])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git log failed: {e}")))?;

    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();
    let status = String::from_utf8_lossy(&status_output.stdout).to_string();
    let log = String::from_utf8_lossy(&log_output.stdout).to_string();

    let changed_files: Vec<&str> = status.lines().filter(|l| !l.is_empty()).collect();

    Ok(serde_json::json!({
        "project_id": project_id,
        "project_name": project.name,
        "branch": branch,
        "is_clean": changed_files.is_empty(),
        "changed_files_count": changed_files.len(),
        "changed_files": changed_files,
        "recent_commits": log.lines().collect::<Vec<&str>>(),
    }))
}

/// Commit staged/all changes in a project.
#[tauri::command]
pub async fn dev_tools_commit_changes(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    message: String,
    stage_all: Option<bool>,
) -> Result<GitOperationResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    if stage_all.unwrap_or(true) {
        let add_output = tokio::process::Command::new("git")
            .args(["add", "-A"])
            .current_dir(&project.root_path)
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("git add failed: {e}")))?;

        if !add_output.status.success() {
            return Ok(GitOperationResult {
                success: false,
                message: String::from_utf8_lossy(&add_output.stderr).trim().to_string(),
                branch_name: None,
                commit_hash: None,
                files_changed: None,
            });
        }
    }

    let output = tokio::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git commit failed: {e}")))?;

    let success = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Extract commit hash from output
    let commit_hash = regex::Regex::new(r"\[[\w/]+ ([a-f0-9]+)\]")
        .ok()
        .and_then(|re| re.captures(&stdout))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    // Count files changed
    let files_changed = regex::Regex::new(r"(\d+) file")
        .ok()
        .and_then(|re| re.captures(&stdout))
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<i32>().ok());

    Ok(GitOperationResult {
        success,
        message: if success { stdout.trim().to_string() } else { stderr.trim().to_string() },
        branch_name: None,
        commit_hash,
        files_changed,
    })
}

// ============================================================================
// Direction 5: Portfolio Intelligence
// ============================================================================

#[tauri::command]
pub fn dev_tools_get_portfolio_health(
    state: State<'_, Arc<AppState>>,
) -> Result<PortfolioHealthSummary, AppError> {
    require_auth_sync(&state)?;
    repo::get_portfolio_health(&state.db)
}

#[tauri::command]
pub fn dev_tools_get_tech_radar(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TechRadarEntry>, AppError> {
    require_auth_sync(&state)?;
    repo::get_tech_radar(&state.db)
}

#[tauri::command]
pub fn dev_tools_get_risk_matrix(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RiskMatrixEntry>, AppError> {
    require_auth_sync(&state)?;
    repo::get_risk_matrix(&state.db)
}

/// Get a summary of a single project (used by both Codebase and Codebases connectors).
#[tauri::command]
pub fn dev_tools_get_project_summary(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let contexts = repo::list_contexts_by_project(&state.db, &project_id, None)?;
    let groups = repo::list_context_groups(&state.db, &project_id)?;
    let ideas = repo::list_ideas(&state.db, Some(&project_id), None, None, None, None)?;
    let tasks = repo::list_tasks(&state.db, Some(&project_id), None)?;
    let goals = repo::list_goals_by_project(&state.db, &project_id, None).unwrap_or_default();

    let pending_ideas = ideas.iter().filter(|i| i.status == "pending").count();
    let accepted_ideas = ideas.iter().filter(|i| i.status == "accepted").count();
    let running_tasks = tasks.iter().filter(|t| t.status == "running").count();
    let active_goals = goals.iter().filter(|g| g.status == "in-progress" || g.status == "open").count();

    Ok(serde_json::json!({
        "project": {
            "id": project.id,
            "name": project.name,
            "root_path": project.root_path,
            "description": project.description,
            "tech_stack": project.tech_stack,
            "github_url": project.github_url,
            "status": project.status,
            "created_at": project.created_at,
        },
        "context_map": {
            "groups": groups.len(),
            "contexts": contexts.len(),
            "group_names": groups.iter().map(|g| g.name.clone()).collect::<Vec<_>>(),
        },
        "backlog": {
            "total_ideas": ideas.len(),
            "pending": pending_ideas,
            "accepted": accepted_ideas,
        },
        "tasks": {
            "total": tasks.len(),
            "running": running_tasks,
        },
        "goals": {
            "total": goals.len(),
            "active": active_goals,
            "titles": goals.iter().take(10).map(|g| g.title.clone()).collect::<Vec<_>>(),
        },
    }))
}

/// Analyze dependency manifests across all projects to find shared deps and version drift.
#[tauri::command]
pub async fn dev_tools_get_dependency_graph(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let projects = repo::list_projects(&state.db, Some("active"))?;

    let mut all_deps: std::collections::HashMap<String, Vec<serde_json::Value>> = std::collections::HashMap::new();

    let section_re = regex::Regex::new(r"\[((?:dev-|build-)?dependencies)\]").unwrap();
    let dep_inline_re = regex::Regex::new(r#"^(\w[\w-]*)\s*=\s*"([^"]+)""#).unwrap();
    let dep_table_re = regex::Regex::new(r#"^(\w[\w-]*)\s*=\s*\{.*version\s*=\s*"([^"]+)".*\}"#).unwrap();

    for project in &projects {
        let root = std::path::Path::new(&project.root_path);

        // Check package.json
        let pkg_path = root.join("package.json");
        if pkg_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&pkg_path).await {
                if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                    for section in ["dependencies", "devDependencies"] {
                        if let Some(deps) = pkg.get(section).and_then(|d| d.as_object()) {
                            for (name, version) in deps {
                                all_deps.entry(name.clone()).or_default().push(serde_json::json!({
                                    "project_id": project.id,
                                    "project_name": project.name,
                                    "version": version,
                                    "section": section,
                                    "manifest": "package.json",
                                }));
                            }
                        }
                    }
                }
            }
        }

        // Check Cargo.toml (simple regex parse -- no toml crate needed)
        let cargo_path = root.join("Cargo.toml");
        if cargo_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&cargo_path).await {
                let mut current_section: Option<&str> = None;
                for line in content.lines() {
                    let trimmed = line.trim();
                    if let Some(caps) = section_re.captures(trimmed) {
                        current_section = caps.get(1).map(|m| m.as_str());
                        // Leak-free: match on known section strings
                        current_section = match current_section {
                            Some("dependencies") => Some("dependencies"),
                            Some("dev-dependencies") => Some("dev-dependencies"),
                            Some("build-dependencies") => Some("build-dependencies"),
                            _ => None,
                        };
                        continue;
                    }
                    if trimmed.starts_with('[') {
                        current_section = None;
                        continue;
                    }
                    if let Some(section) = current_section {
                        let (name, version) = if let Some(caps) = dep_inline_re.captures(trimmed) {
                            (caps.get(1).map(|m| m.as_str().to_string()), caps.get(2).map(|m| m.as_str().to_string()))
                        } else if let Some(caps) = dep_table_re.captures(trimmed) {
                            (caps.get(1).map(|m| m.as_str().to_string()), caps.get(2).map(|m| m.as_str().to_string()))
                        } else {
                            (None, None)
                        };
                        if let (Some(name), Some(version)) = (name, version) {
                            all_deps.entry(name).or_default().push(serde_json::json!({
                                "project_id": project.id,
                                "project_name": project.name,
                                "version": version,
                                "section": section,
                                "manifest": "Cargo.toml",
                            }));
                        }
                    }
                }
            }
        }
    }

    // Find shared deps (used by 2+ projects)
    let shared: Vec<serde_json::Value> = all_deps.iter()
        .filter(|(_, usages)| {
            let unique_projects: std::collections::HashSet<&str> = usages.iter()
                .filter_map(|u| u.get("project_id").and_then(|p| p.as_str()))
                .collect();
            unique_projects.len() > 1
        })
        .map(|(name, usages)| {
            let versions: Vec<&str> = usages.iter()
                .filter_map(|u| u.get("version").and_then(|v| v.as_str()))
                .collect();
            let has_drift = {
                let unique: std::collections::HashSet<&&str> = versions.iter().collect();
                unique.len() > 1
            };
            serde_json::json!({
                "name": name,
                "usages": usages,
                "has_version_drift": has_drift,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "total_unique_deps": all_deps.len(),
        "shared_deps": shared.len(),
        "dependencies": shared,
    }))
}

// ============================================================================
// Competitions (multi-clone parallel task execution via Claude Code worktrees)
// ============================================================================

/// Capture project health baseline before a competition starts.
/// Runs quick checks (build, test runner detection, git status) to establish
/// a before-snapshot that can be compared to each competitor's after-state.
fn capture_project_baseline(root_path: &str) -> serde_json::Value {
    let root = std::path::Path::new(root_path);

    // TypeScript check (tsc --noEmit) — count errors
    let tsc_errors = std::process::Command::new("npx")
        .args(["tsc", "--noEmit"])
        .current_dir(root)
        .output()
        .ok()
        .map(|out| {
            if out.status.success() {
                0i32
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let stdout = String::from_utf8_lossy(&out.stdout);
                let combined = format!("{stdout}\n{stderr}");
                combined.lines().filter(|l| l.contains("error TS")).count() as i32
            }
        });

    // Cargo check (for Rust projects)
    let cargo_errors = if root.join("Cargo.toml").exists() {
        std::process::Command::new("cargo")
            .args(["check", "--message-format=short"])
            .current_dir(root)
            .output()
            .ok()
            .map(|out| {
                if out.status.success() { 0i32 }
                else {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    stderr.lines().filter(|l| l.contains("error[E")).count() as i32
                }
            })
    } else {
        None
    };

    // Test runner detection
    let has_test_config = root.join("vitest.config.ts").exists()
        || root.join("vitest.config.js").exists()
        || root.join("jest.config.ts").exists()
        || root.join("jest.config.js").exists()
        || root.join("jest.config.cjs").exists()
        || root.join("pytest.ini").exists()
        || root.join("pyproject.toml").exists();

    // Git status — clean or dirty
    let git_clean = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(root)
        .output()
        .ok()
        .map(|out| {
            out.status.success() && String::from_utf8_lossy(&out.stdout).trim().is_empty()
        })
        .unwrap_or(false);

    serde_json::json!({
        "tsc_errors": tsc_errors,
        "cargo_errors": cargo_errors,
        "has_test_runner": has_test_config,
        "git_clean": git_clean,
        "captured_at": chrono::Utc::now().to_rfc3339(),
    })
}

/// Strategy slot config for a single competitor in a competition.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CompetitionSlotInput {
    pub label: String,
    pub prompt: Option<String>,
}

/// Start a competition: spawn N dev_tasks on the same work item, each with
/// a distinct worktree name. Claude Code creates isolated git worktrees so
/// the runs don't clobber each other. Each task's `session_id` is set to
/// "worktree:<name>" which the task executor reads to add --worktree flag.
#[tauri::command]
pub fn dev_tools_start_competition(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    task_title: String,
    task_description: Option<String>,
    source_idea_id: Option<String>,
    source_goal_id: Option<String>,
    slots: Vec<CompetitionSlotInput>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    if slots.len() < 2 || slots.len() > 4 {
        return Err(AppError::Validation(
            "Competition requires 2–4 slots".into(),
        ));
    }
    if task_title.trim().is_empty() {
        return Err(AppError::Validation("Task title cannot be empty".into()));
    }

    // Verify project exists
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    // Baseline capture — measure project health BEFORE competitors run.
    // Non-blocking: if any check fails, we still create the competition.
    let baseline = capture_project_baseline(&project.root_path);

    // Create competition row
    let competition = repo::create_competition(
        &state.db,
        &project_id,
        &task_title,
        task_description.as_deref(),
        source_idea_id.as_deref(),
        source_goal_id.as_deref(),
        slots.len() as i32,
    )?;

    // Persist the baseline on the competition record (best-effort update)
    if let Ok(baseline_str) = serde_json::to_string(&baseline) {
        let _ = state.db.get().map(|conn| {
            conn.execute(
                "UPDATE dev_competitions SET baseline_json = ?1 WHERE id = ?2",
                rusqlite::params![baseline_str, competition.id],
            )
        });
    }

    // Short competition tag used inside worktree names (Claude Code trims + normalizes)
    let comp_tag: String = competition.id.chars().take(8).collect();

    let mut created_slots: Vec<DevCompetitionSlot> = Vec::new();
    for (idx, slot_input) in slots.iter().enumerate() {
        // Derive a stable, unique, URL-safe worktree name.
        let slug: String = slot_input
            .label
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .trim_matches('-')
            .chars()
            .take(20)
            .collect();
        let worktree_name = format!("comp-{}-{}-{}", comp_tag, idx, if slug.is_empty() { "slot".to_string() } else { slug });

        // Compose the per-slot prompt: base task + strategy prompt override if given
        let composed_description = match &slot_input.prompt {
            Some(p) => {
                let base = task_description.as_deref().unwrap_or("");
                format!("{base}\n\n## Strategy override — {}\n{p}", slot_input.label)
            }
            None => task_description.clone().unwrap_or_default(),
        };

        // Create the dev_task for this slot
        let task = repo::create_task(
            &state.db,
            Some(&project_id),
            &format!("{} · {}", task_title, slot_input.label),
            Some(&composed_description),
            source_idea_id.as_deref(),
            source_goal_id.as_deref(),
            Some("queued"),
            None,
        )?;

        // Tag the task with its worktree name via session_id
        // (convention: session_id = "worktree:<name>" → task executor adds --worktree)
        let session_value = format!("worktree:{}", worktree_name);
        let _ = repo::update_task(
            &state.db,
            &task.id,
            None,
            None,
            None,
            Some(Some(&session_value)),
            None,
            None,
            None,
            None,
            None,
        );

        let slot = repo::create_competition_slot(
            &state.db,
            &competition.id,
            &task.id,
            &slot_input.label,
            slot_input.prompt.as_deref(),
            &worktree_name,
            idx as i32,
        )?;
        created_slots.push(slot);
    }

    Ok(serde_json::json!({
        "competition": competition,
        "slots": created_slots,
    }))
}

#[tauri::command]
pub fn dev_tools_list_competitions(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    status: Option<String>,
) -> Result<Vec<DevCompetition>, AppError> {
    require_auth_sync(&state)?;
    repo::list_competitions_by_project(&state.db, &project_id, status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_competition(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let competition = repo::get_competition_by_id(&state.db, &id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;
    let slots = repo::list_competition_slots(&state.db, &id)?;

    // Lazy diff analysis: for every slot whose task is completed but hasn't been
    // analyzed yet, compute the diff + stats + hash and persist it.
    let mut analyzed_slots: Vec<crate::db::models::DevCompetitionSlot> = Vec::new();
    for slot in slots {
        let task = repo::get_task_by_id(&state.db, &slot.task_id).ok();
        let needs_analysis = slot.diff_analyzed_at.is_none()
            && task.as_ref().map(|t| t.status == "completed").unwrap_or(false);

        let updated_slot = if needs_analysis {
            if let Some((_diff_text, diff_hash, files, added, removed)) =
                compute_slot_diff(&project.root_path, &slot.worktree_name)
            {
                let stats_json = serde_json::json!({
                    "files_changed": files,
                    "lines_added": added,
                    "lines_removed": removed,
                })
                .to_string();
                // Empty diff → auto-disqualify
                let (dq, reason) = if files == 0 && added == 0 && removed == 0 {
                    (true, Some("Empty diff — no files changed"))
                } else {
                    (false, None)
                };
                repo::update_slot_diff_analysis(
                    &state.db,
                    &slot.id,
                    Some(&diff_hash),
                    Some(&stats_json),
                    dq,
                    reason,
                )
                .unwrap_or(slot)
            } else {
                slot
            }
        } else {
            slot
        };
        analyzed_slots.push(updated_slot);
    }

    // Duplicate detection: any two slots with the same non-null diff_hash →
    // keep the earliest (lowest slot_index) as-is and mark the others as
    // duplicates. Only flip if not already disqualified for a different reason.
    let mut first_seen: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
    for slot in &analyzed_slots {
        if let Some(ref h) = slot.diff_hash {
            first_seen.entry(h.clone()).or_insert(slot.slot_index);
        }
    }
    let mut after_dedup: Vec<crate::db::models::DevCompetitionSlot> = Vec::new();
    for slot in analyzed_slots {
        let is_dup = match (&slot.diff_hash, slot.disqualified) {
            (Some(h), false) => {
                first_seen.get(h).map(|&idx| idx < slot.slot_index).unwrap_or(false)
            }
            _ => false,
        };
        let resolved_slot = if is_dup {
            repo::update_slot_diff_analysis(
                &state.db,
                &slot.id,
                slot.diff_hash.as_deref(),
                slot.diff_stats_json.as_deref(),
                true,
                Some("Duplicate of an earlier competitor's diff"),
            )
            .unwrap_or(slot)
        } else {
            slot
        };
        after_dedup.push(resolved_slot);
    }

    // Also auto-advance competition status to awaiting_review if all tasks are done
    let enriched_slots: Vec<serde_json::Value> = after_dedup
        .iter()
        .map(|s| {
            let task = repo::get_task_by_id(&state.db, &s.task_id).ok();
            serde_json::json!({ "slot": s, "task": task })
        })
        .collect();

    let all_finished = enriched_slots.iter().all(|entry| {
        entry
            .get("task")
            .and_then(|t| t.get("status"))
            .and_then(|s| s.as_str())
            .map(|s| matches!(s, "completed" | "failed" | "cancelled"))
            .unwrap_or(false)
    });
    let updated_competition =
        if all_finished && competition.status == "running" {
            repo::update_competition_status(
                &state.db,
                &id,
                "awaiting_review",
                None,
                None,
                None,
            )
            .unwrap_or(competition)
        } else {
            competition
        };

    Ok(serde_json::json!({
        "competition": updated_competition,
        "slots": enriched_slots,
    }))
}

/// Force refresh a single slot's diff analysis (e.g. after a manual git operation).
#[tauri::command]
pub fn dev_tools_refresh_competition_slot(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<crate::db::models::DevCompetitionSlot, AppError> {
    require_auth_sync(&state)?;
    // Look up the slot → competition → project to get the root_path
    let conn = state.db.get()?;
    let slot: crate::db::models::DevCompetitionSlot = conn
        .query_row(
            "SELECT * FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| {
                Ok(crate::db::models::DevCompetitionSlot {
                    id: row.get("id")?,
                    competition_id: row.get("competition_id")?,
                    task_id: row.get("task_id")?,
                    strategy_label: row.get("strategy_label")?,
                    strategy_prompt: row.get("strategy_prompt")?,
                    worktree_name: row.get("worktree_name")?,
                    branch_name: row.get("branch_name")?,
                    slot_index: row.get("slot_index")?,
                    disqualified: row.get::<_, i32>("disqualified").unwrap_or(0) != 0,
                    disqualify_reason: row.get::<_, Option<String>>("disqualify_reason").ok().flatten(),
                    diff_hash: row.get::<_, Option<String>>("diff_hash").ok().flatten(),
                    diff_stats_json: row.get::<_, Option<String>>("diff_stats_json").ok().flatten(),
                    diff_analyzed_at: row.get::<_, Option<String>>("diff_analyzed_at").ok().flatten(),
                    created_at: row.get("created_at")?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &slot.competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    if let Some((_diff_text, diff_hash, files, added, removed)) =
        compute_slot_diff(&project.root_path, &slot.worktree_name)
    {
        let stats_json = serde_json::json!({
            "files_changed": files,
            "lines_added": added,
            "lines_removed": removed,
        })
        .to_string();
        let (dq, reason) = if files == 0 && added == 0 && removed == 0 {
            (true, Some("Empty diff — no files changed"))
        } else {
            (false, None)
        };
        repo::update_slot_diff_analysis(
            &state.db,
            &slot.id,
            Some(&diff_hash),
            Some(&stats_json),
            dq,
            reason,
        )
    } else {
        Ok(slot)
    }
}

/// Return the unified diff text for a slot's worktree branch (for preview UI).
#[tauri::command]
pub fn dev_tools_get_competition_slot_diff(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    let (worktree_name, competition_id): (String, String) = conn
        .query_row(
            "SELECT worktree_name, competition_id FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| Ok((row.get("worktree_name")?, row.get("competition_id")?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    match compute_slot_diff(&project.root_path, &worktree_name) {
        Some((diff_text, _, _, _, _)) => Ok(diff_text),
        None => Ok(String::new()),
    }
}

/// Compute the unified diff + stats for a competitor worktree branch vs the
/// project's current HEAD. Returns (diff_text, diff_hash, files_changed, lines_added, lines_removed).
/// Best-effort: returns None if git fails or the branch doesn't exist.
fn compute_slot_diff(
    project_root: &str,
    worktree_name: &str,
) -> Option<(String, String, i32, i32, i32)> {
    use sha2::{Digest, Sha256};

    let branch = format!("worktree-{}", worktree_name);
    let worktree_path = std::path::PathBuf::from(project_root)
        .join(".claude")
        .join("worktrees")
        .join(worktree_name);

    // Strategy 1: Check committed branch diff (HEAD...branch from project root).
    // This captures changes that Claude committed on the worktree branch.
    let branch_diff = std::process::Command::new("git")
        .args(["diff", "--unified=3"])
        .arg(format!("HEAD...{}", branch))
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // Strategy 2: Check UNCOMMITTED changes inside the worktree directory.
    // Claude Code sometimes makes changes but doesn't commit them.
    let uncommitted_diff = if worktree_path.exists() {
        std::process::Command::new("git")
            .args(["diff", "--unified=3", "HEAD"])
            .current_dir(&worktree_path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Use whichever diff is larger (more informative).
    // If Claude committed, branch_diff has the changes.
    // If Claude didn't commit, uncommitted_diff has the working-tree changes.
    let use_branch_diff = branch_diff.len() >= uncommitted_diff.len();
    let diff_text = if use_branch_diff {
        branch_diff
    } else {
        uncommitted_diff
    };

    if diff_text.is_empty() {
        // Last resort: check for untracked new files in the worktree
        if worktree_path.exists() {
            let untracked = std::process::Command::new("git")
                .args(["status", "--porcelain"])
                .current_dir(&worktree_path)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default();
            if untracked.trim().is_empty() {
                // Genuinely no changes at all
            }
        }
    }

    // Hash the diff for duplicate detection
    let mut hasher = Sha256::new();
    hasher.update(diff_text.as_bytes());
    let diff_hash = format!("{:x}", hasher.finalize());

    // Compute stats — use numstat for the same source we picked
    let numstat_args = if use_branch_diff {
        // Branch diff — run from project root
        let out = std::process::Command::new("git")
            .args(["diff", "--numstat"])
            .arg(format!("HEAD...{}", branch))
            .current_dir(project_root)
            .output()
            .ok();
        out
    } else {
        // Uncommitted diff — run from worktree
        std::process::Command::new("git")
            .args(["diff", "--numstat", "HEAD"])
            .current_dir(&worktree_path)
            .output()
            .ok()
    };

    let mut files_changed = 0i32;
    let mut lines_added = 0i32;
    let mut lines_removed = 0i32;
    if let Some(stats_out) = numstat_args {
        let stats_text = String::from_utf8_lossy(&stats_out.stdout);
        for line in stats_text.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                files_changed += 1;
                if let Ok(a) = parts[0].parse::<i32>() { lines_added += a; }
                if let Ok(r) = parts[1].parse::<i32>() { lines_removed += r; }
            }
        }
    }

    Some((diff_text, diff_hash, files_changed, lines_added, lines_removed))
}

/// Open a competition slot's worktree directory for review.
/// Returns the absolute path that the frontend can open in a terminal/editor.
#[tauri::command]
pub fn dev_tools_switch_to_worktree(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    let conn = state.db.get()?;
    let (worktree_name, competition_id): (String, String) = conn
        .query_row(
            "SELECT worktree_name, competition_id FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| Ok((row.get("worktree_name")?, row.get("competition_id")?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    let worktree_path = std::path::PathBuf::from(&project.root_path)
        .join(".claude")
        .join("worktrees")
        .join(&worktree_name);

    let branch_name = format!("worktree-{}", worktree_name);

    if !worktree_path.exists() {
        return Err(AppError::Validation(format!(
            "Worktree directory does not exist: {}. The competition may have been cleaned up.",
            worktree_path.display()
        )));
    }

    // Reveal the worktree directory in the OS file manager
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(worktree_path.to_string_lossy().as_ref())
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(worktree_path.to_string_lossy().as_ref())
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(worktree_path.to_string_lossy().as_ref())
            .spawn();
    }

    Ok(serde_json::json!({
        "worktree_path": worktree_path.to_string_lossy(),
        "branch_name": branch_name,
        "project_root": project.root_path,
    }))
}

/// Remove a Claude Code worktree by shelling out to `git worktree remove --force`.
/// Returns true if removal succeeded, false (and logs a warning) on any failure.
/// Non-fatal by design: if cleanup fails, the competition status change still proceeds.
fn remove_claude_worktree(project_root: &str, worktree_name: &str) -> bool {
    let worktree_path = std::path::PathBuf::from(project_root)
        .join(".claude")
        .join("worktrees")
        .join(worktree_name);

    // If the directory doesn't exist, nothing to clean up.
    if !worktree_path.exists() {
        return true;
    }

    // `git worktree remove --force <path>` — force is required because Claude Code
    // may leave the working tree dirty (uncommitted changes from the competitor run).
    let output = std::process::Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(&worktree_path)
        .current_dir(project_root)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            tracing::info!("Removed Claude Code worktree: {}", worktree_name);
            true
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            tracing::warn!(
                "git worktree remove failed for {}: {}. Falling back to rm -rf.",
                worktree_name, stderr
            );
            // Fallback: direct filesystem removal if the git command refuses
            // (e.g. worktree was never properly registered).
            match std::fs::remove_dir_all(&worktree_path) {
                Ok(_) => true,
                Err(e) => {
                    tracing::warn!("Failed to remove worktree dir {}: {}", worktree_name, e);
                    false
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to invoke git worktree remove for {}: {}", worktree_name, e);
            false
        }
    }
}

/// Also delete the associated branch (git worktree remove leaves the branch behind).
/// Best-effort; logs warnings on failure.
fn remove_claude_worktree_branch(project_root: &str, worktree_name: &str) -> bool {
    // Claude Code names the branch `worktree-<name>`.
    let branch_name = format!("worktree-{}", worktree_name);
    let output = std::process::Command::new("git")
        .args(["branch", "-D", &branch_name])
        .current_dir(project_root)
        .output();
    match output {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            tracing::debug!(
                "git branch -D {} did not succeed (may not exist): {}",
                branch_name,
                String::from_utf8_lossy(&out.stderr)
            );
            false
        }
        Err(e) => {
            tracing::debug!("Failed to invoke git branch -D {}: {}", branch_name, e);
            false
        }
    }
}

#[tauri::command]
pub fn dev_tools_pick_competition_winner(
    state: State<'_, Arc<AppState>>,
    id: String,
    winner_task_id: String,
    reviewer_notes: Option<String>,
    winner_insight: Option<String>,
) -> Result<DevCompetition, AppError> {
    require_auth_sync(&state)?;

    let competition = repo::get_competition_by_id(&state.db, &id)?;
    let slots = repo::list_competition_slots(&state.db, &id)?;

    // Verify the winner is part of this competition
    let winner_slot = slots
        .iter()
        .find(|s| s.task_id == winner_task_id)
        .ok_or_else(|| {
            AppError::Validation("Winner task_id is not part of this competition".into())
        })?;

    // Resolve project root so we can clean up loser worktrees on the filesystem
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    // Cleanup every LOSER worktree (winner's worktree stays so user can review/merge/push)
    let mut cleaned = 0u32;
    let mut failed = 0u32;
    for slot in &slots {
        if slot.task_id == winner_task_id {
            continue;
        }
        if remove_claude_worktree(&project.root_path, &slot.worktree_name) {
            let _ = remove_claude_worktree_branch(&project.root_path, &slot.worktree_name);
            cleaned += 1;
        } else {
            failed += 1;
        }
    }
    tracing::info!(
        "Competition {} resolved: cleaned {} loser worktrees ({} failures), winner worktree {} kept for review",
        id, cleaned, failed, winner_slot.worktree_name,
    );

    // Persist the resolved status + insight (insight propagation to persona memory
    // happens lazily — the next Dev Clone execution injects winning insights via
    // a new shared memory helper, see dev_tools_apply_winner_insight below).
    let resolved = repo::update_competition_status(
        &state.db,
        &id,
        "resolved",
        Some(&winner_task_id),
        reviewer_notes.as_deref(),
        winner_insight.as_deref(),
    )?;

    // Best-effort: if a winner insight was provided, write it to the Dev Clone
    // persona's memory so the next execution can learn from it. Non-fatal.
    if let Some(ref insight_text) = winner_insight {
        let _ = apply_winner_insight_to_dev_clone_memory(
            &state.db,
            &id,
            &winner_slot.strategy_label,
            insight_text,
        );

        // Also push to Obsidian vault (best-effort — vault may not be configured)
        let _ = crate::commands::obsidian_brain::push_competition_insight_to_vault(
            &state.db,
            &id,
            &winner_slot.strategy_label,
            insight_text,
            &project.name,
            &resolved.task_title,
        );
    }

    Ok(resolved)
}

/// Find the Dev Clone persona by name and create a "learned" memory entry
/// containing the winning approach from a competition. Best-effort — failure
/// never blocks the winner-pick flow.
fn apply_winner_insight_to_dev_clone_memory(
    pool: &crate::db::DbPool,
    competition_id: &str,
    winning_strategy: &str,
    insight_text: &str,
) -> Result<(), AppError> {
    use crate::db::repos::core::personas as persona_repo;
    use crate::db::repos::core::memories as mem_repo;
    use crate::db::models::CreatePersonaMemoryInput;
    use crate::db::models::Json;

    // Find a persona whose name contains "dev clone" (case-insensitive)
    let personas = persona_repo::get_all(pool)?;
    let dev_clone = personas.iter().find(|p| {
        let name = p.name.to_lowercase();
        name.contains("dev clone") || name.contains("dev-clone")
    });

    let Some(persona) = dev_clone else {
        tracing::info!("No Dev Clone persona found — skipping memory insight");
        return Ok(());
    };

    let title = format!("Winning approach from competition {}", &competition_id[..8]);
    let content = format!(
        "In competition {}, the `{}` strategy won. Key insight:\n\n{}",
        competition_id, winning_strategy, insight_text
    );

    let _ = mem_repo::create(
        pool,
        CreatePersonaMemoryInput {
            persona_id: persona.id.clone(),
            source_execution_id: None,
            title,
            content,
            category: Some("learned".to_string()),
            importance: Some(7),
            tags: Some(Json(vec![
                "competition".to_string(),
                "winner".to_string(),
                winning_strategy.to_lowercase(),
            ])),
            use_case_id: None,
        },
    );

    tracing::info!(
        "Wrote competition winner insight to Dev Clone persona memory (competition {})",
        competition_id
    );
    Ok(())
}

#[tauri::command]
pub fn dev_tools_get_strategy_leaderboard(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<crate::db::models::DevStrategyStats>, AppError> {
    require_auth_sync(&state)?;
    repo::get_strategy_leaderboard(&state.db, &project_id)
}

#[tauri::command]
pub fn dev_tools_cancel_competition(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<DevCompetition, AppError> {
    require_auth_sync(&state)?;

    let competition = repo::get_competition_by_id(&state.db, &id)?;
    let slots = repo::list_competition_slots(&state.db, &id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    // First: cancel any running competitor tasks so they stop writing to the worktrees
    for slot in &slots {
        let _ = crate::commands::infrastructure::task_executor::cancel_running_task(
            &state.db,
            &app,
            &slot.task_id,
        );
    }

    // Then: remove every worktree and its branch (best-effort)
    for slot in &slots {
        if remove_claude_worktree(&project.root_path, &slot.worktree_name) {
            let _ = remove_claude_worktree_branch(&project.root_path, &slot.worktree_name);
        }
    }
    tracing::info!(
        "Competition {} cancelled: cancelled {} tasks and cleaned all worktrees",
        id, slots.len(),
    );

    repo::update_competition_status(&state.db, &id, "cancelled", None, None, None)
}

// ============================================================================
// Dev Server management (launch preview servers per worktree)
// ============================================================================

/// Global registry of running dev servers for competition worktrees.
/// Key: slot_id, Value: (child PID, port)
static DEV_SERVERS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, (u32, u16)>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// Find a free TCP port by binding to port 0.
fn find_free_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .map(|l| l.local_addr().unwrap().port())
}

/// Detect the dev server command from package.json in a directory.
fn detect_dev_command(dir: &std::path::Path) -> (String, Vec<String>) {
    let pkg_json = dir.join("package.json");
    if pkg_json.exists() {
        if let Ok(content) = std::fs::read_to_string(&pkg_json) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                let scripts = parsed.get("scripts").and_then(|s| s.as_object());
                if let Some(s) = scripts {
                    // Prefer "dev" script, fall back to "start"
                    if s.contains_key("dev") {
                        return ("npm".to_string(), vec!["run".to_string(), "dev".to_string()]);
                    }
                    if s.contains_key("start") {
                        return ("npm".to_string(), vec!["run".to_string(), "start".to_string()]);
                    }
                }
            }
        }
    }
    // Fallback for Python/Rust
    if dir.join("manage.py").exists() {
        return ("python".to_string(), vec!["manage.py".to_string(), "runserver".to_string()]);
    }
    ("npm".to_string(), vec!["run".to_string(), "dev".to_string()])
}

/// Start a dev server in a competition slot's worktree.
/// Returns the port and URL for the frontend to display.
#[tauri::command]
pub fn dev_tools_start_slot_server(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    // Check if already running
    {
        let servers = DEV_SERVERS.lock().unwrap();
        if let Some((pid, port)) = servers.get(&slot_id) {
            return Ok(serde_json::json!({
                "status": "already_running",
                "port": port,
                "pid": pid,
                "url": format!("http://localhost:{}", port),
            }));
        }
    }

    // Look up the worktree path
    let conn = state.db.get()?;
    let (worktree_name, competition_id): (String, String) = conn
        .query_row(
            "SELECT worktree_name, competition_id FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| Ok((row.get("worktree_name")?, row.get("competition_id")?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    let worktree_path = std::path::PathBuf::from(&project.root_path)
        .join(".claude")
        .join("worktrees")
        .join(&worktree_name);

    if !worktree_path.exists() {
        return Err(AppError::Validation("Worktree directory does not exist".into()));
    }

    let port = find_free_port()
        .ok_or_else(|| AppError::Internal("Could not find a free port".into()))?;

    let (cmd_name, mut cmd_args) = detect_dev_command(&worktree_path);

    // Inject port via common env var patterns
    // Next.js/Vite: PORT env var. Also pass --port for Vite.
    let is_vite = worktree_path.join("vite.config.ts").exists()
        || worktree_path.join("vite.config.js").exists();

    if is_vite {
        cmd_args.push("--".to_string());
        cmd_args.push("--port".to_string());
        cmd_args.push(port.to_string());
    }

    let mut command = std::process::Command::new(&cmd_name);
    command
        .args(&cmd_args)
        .current_dir(&worktree_path)
        .env("PORT", port.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = command.spawn().map_err(|e| {
        AppError::Internal(format!("Failed to start dev server: {e}"))
    })?;

    let pid = child.id();
    tracing::info!("Started dev server for slot {} on port {} (PID {})", slot_id, port, pid);

    DEV_SERVERS.lock().unwrap().insert(slot_id.clone(), (pid, port));

    Ok(serde_json::json!({
        "status": "started",
        "port": port,
        "pid": pid,
        "url": format!("http://localhost:{}", port),
        "command": format!("{} {}", cmd_name, cmd_args.join(" ")),
    }))
}

/// Stop a running dev server for a competition slot.
#[tauri::command]
pub fn dev_tools_stop_slot_server(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let entry = DEV_SERVERS.lock().unwrap().remove(&slot_id);
    if let Some((pid, port)) = entry {
        tracing::info!("Stopping dev server for slot {} (PID {}, port {})", slot_id, pid, port);

        // Kill the process tree
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }

        Ok(true)
    } else {
        Ok(false)
    }
}

/// Delete a resolved or cancelled competition and its slots from the database.
/// Also cleans up any remaining worktrees.
#[tauri::command]
pub fn dev_tools_delete_competition(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let competition = repo::get_competition_by_id(&state.db, &id)?;
    if competition.status != "resolved" && competition.status != "cancelled" {
        return Err(AppError::Validation("Can only delete resolved or cancelled competitions".into()));
    }
    // Cleanup any remaining worktrees (winner's worktree may still exist)
    if let Ok(project) = repo::get_project_by_id(&state.db, &competition.project_id) {
        if let Ok(slots) = repo::list_competition_slots(&state.db, &id) {
            for slot in &slots {
                let _ = remove_claude_worktree(&project.root_path, &slot.worktree_name);
                let _ = remove_claude_worktree_branch(&project.root_path, &slot.worktree_name);
            }
        }
    }
    // CASCADE delete: slots are deleted automatically via foreign key
    let conn = state.db.get()?;
    let count = conn.execute("DELETE FROM dev_competitions WHERE id = ?1", rusqlite::params![id])?;
    Ok(count > 0)
}
