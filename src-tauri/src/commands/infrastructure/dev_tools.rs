use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    DevContext, DevContextGroup, DevContextGroupRelationship, DevGoal, DevGoalSignal, DevIdea,
    DevPipeline, DevProject, DevScan, DevTask, ContextHealthSnapshot, TriageRule,
    CrossProjectRelation, PortfolioHealthSummary, TechRadarEntry, RiskMatrixEntry,
    TestRunResult, GitOperationResult,
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
pub fn dev_tools_update_project(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    tech_stack: Option<Option<String>>,
    github_url: Option<Option<String>>,
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
#[tauri::command]
pub fn dev_tools_get_cross_project_map(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let projects = repo::list_projects(&state.db, None)?;
    let relations = repo::list_cross_project_relations(&state.db)?;

    let project_summaries: Vec<serde_json::Value> = projects
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "root_path": p.root_path,
                "tech_stack": p.tech_stack,
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

    let pending_ideas = ideas.iter().filter(|i| i.status == "pending").count();
    let accepted_ideas = ideas.iter().filter(|i| i.status == "accepted").count();
    let running_tasks = tasks.iter().filter(|t| t.status == "running").count();

    Ok(serde_json::json!({
        "project": {
            "id": project.id,
            "name": project.name,
            "root_path": project.root_path,
            "tech_stack": project.tech_stack,
            "status": project.status,
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
                // Match lines like: dep_name = "version" or dep_name = { version = "..." }
                let section_re = regex::Regex::new(r"\[((?:dev-|build-)?dependencies)\]").unwrap();
                let dep_inline_re = regex::Regex::new(r#"^(\w[\w-]*)\s*=\s*"([^"]+)""#).unwrap();
                let dep_table_re = regex::Regex::new(r#"^(\w[\w-]*)\s*=\s*\{.*version\s*=\s*"([^"]+)".*\}"#).unwrap();

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
