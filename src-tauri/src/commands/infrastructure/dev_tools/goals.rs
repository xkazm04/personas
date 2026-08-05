use std::sync::Arc;
use tauri::State;
use crate::db::models::{AttentionQueue, DevGoal, DevGoalDependency, DevGoalItem, DevGoalSignal, GoalProgressSuggestion, PortfolioSummary};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

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
    // Manual goal↔KPI link (UAT F-MAJOR-15). Some(Some) links, Some(None)
    // unlinks, None leaves untouched.
    kpi_id: Option<Option<String>>,
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
        kpi_id.as_ref().map(|o| o.as_deref()),
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
    repo::add_goal_dependency(
        &state.db,
        &goal_id,
        &depends_on_id,
        dependency_type.as_deref(),
    )
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
// Goal Items (lightweight checklist) + progress resolver
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_goal_items(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
) -> Result<Vec<DevGoalItem>, AppError> {
    require_auth_sync(&state)?;
    repo::list_goal_items(&state.db, &goal_id)
}

#[tauri::command]
pub fn dev_tools_create_goal_item(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
    title: String,
) -> Result<DevGoalItem, AppError> {
    require_auth_sync(&state)?;
    let item = repo::create_goal_item(&state.db, &goal_id, &title)?;
    // New (incomplete) work invalidates a prior UAT pass — re-open the gate so
    // "done" can't outlive the scope it was verified against.
    let _ = repo::reopen_verification_if_passed(&state.db, &goal_id);
    Ok(item)
}

#[tauri::command]
pub fn dev_tools_update_goal_item(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    done: Option<bool>,
) -> Result<DevGoalItem, AppError> {
    require_auth_sync(&state)?;
    // A browser-test UAT gate is ticked only by a passing test — never by a
    // manual checkbox. Block a done-toggle on a verification item so the gate
    // can't be hand-waved closed.
    if done.is_some() {
        if let Ok(existing) = repo::get_goal_item_by_id(&state.db, &id) {
            if existing.verify_kind.is_some() {
                return Err(AppError::Validation(
                    "This is a browser UAT gate — it's ticked by a passing test, not manually. Use 'Verify now'.".into(),
                ));
            }
        }
    }
    let updated = repo::update_goal_item(&state.db, &id, title.as_deref(), done)?;
    // Un-completing a to-do re-introduces incomplete work → re-open a passed
    // UAT gate (the goal must be re-verified before it's done again).
    if done == Some(false) && updated.verify_kind.is_none() {
        let _ = repo::reopen_verification_if_passed(&state.db, &updated.goal_id);
    }
    Ok(updated)
}

#[tauri::command]
pub fn dev_tools_delete_goal_item(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_goal_item(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_reorder_goal_items(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::reorder_goal_items(&state.db, &ids)
}

// ── Goal-UAT browser-test gate ───────────────────────────────────────────────

/// Attach (or replace) a goal's browser-test UAT gate — a verification item
/// only a passing live browser test can tick, which keeps the goal under 100%
/// until then. Web projects only (react/nodejs/combined).
#[tauri::command]
pub fn dev_tools_set_goal_verification(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
    scenario: String,
    url: Option<String>,
) -> Result<DevGoalItem, AppError> {
    require_auth_sync(&state)?;
    if scenario.trim().is_empty() {
        return Err(AppError::Validation("Scenario cannot be empty".into()));
    }
    let goal = repo::get_goal_by_id(&state.db, &goal_id)?;
    let project = repo::get_project_by_id(&state.db, &goal.project_id)?;
    if !repo::project_type_is_web(project.tech_stack.as_deref()) {
        return Err(AppError::Validation(
            "Browser UAT is only available for web projects (React / NodeJS / Combined).".into(),
        ));
    }
    repo::set_goal_verification(&state.db, &goal_id, scenario.trim(), url.as_deref())
}

/// Remove a goal's browser-test UAT gate.
#[tauri::command]
pub fn dev_tools_clear_goal_verification(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let removed = match repo::goal_verification_item(&state.db, &goal_id)? {
        Some(item) => repo::delete_goal_item(&state.db, &item.id)?,
        None => false,
    };
    if removed {
        let _ = repo::apply_resolved_goal_progress(&state.db, &goal_id);
    }
    Ok(removed)
}

/// Run the goal's browser-test UAT now. Requires: a web project, a configured
/// gate, all other to-dos complete (UAT is the final acceptance step), and a
/// resolvable target URL (the gate's `url`, else the project's `test_env_url`).
/// Spawns the same `browser_test` proactive turn `run_browser_test` uses, with
/// the goal_id threaded so a clean pass closes the gate.
#[tauri::command]
pub fn dev_tools_run_goal_uat(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    goal_id: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let goal = repo::get_goal_by_id(&state.db, &goal_id)?;
    let project = repo::get_project_by_id(&state.db, &goal.project_id)?;
    if !repo::project_type_is_web(project.tech_stack.as_deref()) {
        return Err(AppError::Validation(
            "Browser UAT is only available for web projects.".into(),
        ));
    }
    let gate = repo::goal_verification_item(&state.db, &goal_id)?
        .ok_or_else(|| AppError::Validation("No browser UAT gate on this goal.".into()))?;
    if !repo::goal_todos_all_complete(&state.db, &goal_id)? {
        return Err(AppError::Validation(
            "Complete the goal's other to-dos before running the UAT — the browser test is the final acceptance step.".into(),
        ));
    }
    // Resolve scenario + target URL from the gate config, falling back to the
    // project's configured test-environment URL.
    let cfg: serde_json::Value =
        match serde_json::from_str(gate.verify_config.as_deref().unwrap_or("{}")) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(goal_id = %goal_id, error = %e, "unparseable verify_config on browser UAT gate");
                return Err(AppError::Validation(format!(
                    "This goal's UAT gate configuration is corrupted and could not be parsed: {e}"
                )));
            }
        };
    let scenario = cfg
        .get("scenario")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let url = cfg
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| project.test_env_url.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
        .ok_or_else(|| AppError::Validation(
            "No target URL — set a test-environment URL on the project or a url on the UAT gate.".into(),
        ))?;

    crate::commands::companion::approvals::spawn_browser_test_turn(
        &state,
        &app,
        &url,
        Some(&project.name),
        &scenario,
        Some(&goal_id),
    );
    Ok(format!("Browser UAT started for \"{}\" against {url}.", goal.title))
}

/// Close a goal's browser-test UAT gate (ticks the verification item and
/// recomputes progress). Called by the browser-test report card on a clean
/// pass; returns the goal's new progress.
#[tauri::command]
pub fn dev_tools_complete_goal_uat(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
) -> Result<i32, AppError> {
    require_auth_sync(&state)?;
    repo::complete_goal_verification(&state.db, &goal_id)
}

#[tauri::command]
pub fn dev_tools_list_child_goals(
    state: State<'_, Arc<AppState>>,
    parent_goal_id: String,
) -> Result<Vec<DevGoal>, AppError> {
    require_auth_sync(&state)?;
    repo::list_child_goals(&state.db, &parent_goal_id)
}

/// Hybrid progress: composes the goal's ad-hoc checklist items, its sub-goals,
/// and its linked team-assignment steps into a single suggested progress %.
/// Read-only — never writes; the UI/Athena surface this as an accept/edit nudge.
#[tauri::command]
pub fn dev_tools_resolve_goal_progress(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
) -> Result<GoalProgressSuggestion, AppError> {
    require_auth_sync(&state)?;
    let goal = repo::get_goal_by_id(&state.db, &goal_id)?;

    let items = repo::list_goal_items(&state.db, &goal_id)?;
    let items_done = items.iter().filter(|i| i.done).count();

    let subgoals = repo::list_child_goals(&state.db, &goal_id)?;
    let subgoals_done = subgoals
        .iter()
        .filter(|g| repo::goal_status_is_complete(&g.status) || g.progress >= 100)
        .count();

    let assignments =
        crate::db::repos::orchestration::team_assignments::list_for_goal(&state.db, &goal_id)?;
    let mut steps_total = 0usize;
    let mut steps_done = 0usize;
    for a in &assignments {
        let steps =
            crate::db::repos::orchestration::team_assignments::list_steps(&state.db, &a.id)?;
        steps_total += steps.len();
        steps_done += steps
            .iter()
            .filter(|s| repo::step_status_is_complete(&s.status))
            .count();
    }

    Ok(repo::compute_suggested_progress(
        &goal_id,
        goal.progress,
        items_done,
        items.len(),
        subgoals_done,
        subgoals.len(),
        steps_done,
        steps_total,
    ))
}

// ---- Goals v2: cross-project surfaces (Portfolio / Attention / Timeline / Map) ----

/// Every goal across all projects — backs the Portfolio + Timeline surfaces.
#[tauri::command]
pub fn dev_tools_list_all_goals(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DevGoal>, AppError> {
    require_auth_sync(&state)?;
    repo::list_all_goals(&state.db)
}

/// Goals in the human-acceptance queue (`awaiting_acceptance`), enriched with
/// project + owning team + served KPI for the Goal Acceptance view.
#[tauri::command]
pub fn dev_tools_list_pending_acceptance(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::db::models::PendingAcceptanceGoal>, AppError> {
    require_auth_sync(&state)?;
    repo::list_pending_acceptance(&state.db)
}

/// Count of goals awaiting acceptance — backs the goals board's own readout.
#[tauri::command]
pub fn dev_tools_count_pending_acceptance(
    state: State<'_, Arc<AppState>>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::count_pending_acceptance(&state.db)
}

/// Every human-decision queue's pending count in ONE round-trip — backs the
/// title-bar review badge. See `repo::PendingCounts` for why it is one query and
/// why build questions are not in it.
#[tauri::command]
pub fn dev_tools_pending_counts(
    state: State<'_, Arc<AppState>>,
) -> Result<repo::PendingCounts, AppError> {
    require_auth_sync(&state)?;
    repo::pending_counts(&state.db)
}

/// Accept (→ `done`, off-board) or reject (→ `in-progress`, with a comment) a
/// pending-acceptance goal. `decision` is `accept` | `reject`.
#[tauri::command]
pub fn dev_tools_resolve_goal_acceptance(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
    decision: String,
    comment: Option<String>,
) -> Result<DevGoal, AppError> {
    require_auth_sync(&state)?;
    let accept = match decision.as_str() {
        "accept" => true,
        "reject" => false,
        other => {
            return Err(AppError::Validation(format!(
                "unknown acceptance decision `{other}` (expected accept|reject)"
            )))
        }
    };
    repo::resolve_goal_acceptance(&state.db, &goal_id, accept, comment.as_deref())
}

/// All dependency edges for one project's goals (single query; Map edges).
#[tauri::command]
pub fn dev_tools_list_goal_dependencies_for_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevGoalDependency>, AppError> {
    require_auth_sync(&state)?;
    repo::list_goal_dependencies_for_project(&state.db, &project_id)
}

/// All checklist items for one project's goals (single query; Board card todos).
#[tauri::command]
pub fn dev_tools_list_goal_items_for_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevGoalItem>, AppError> {
    require_auth_sync(&state)?;
    repo::list_goal_items_for_project(&state.db, &project_id)
}

/// Cross-project health rollup (per-project counts by status, at-risk, avg progress).
#[tauri::command]
pub fn dev_tools_portfolio_summary(
    state: State<'_, Arc<AppState>>,
) -> Result<PortfolioSummary, AppError> {
    require_auth_sync(&state)?;
    repo::portfolio_summary(&state.db)
}

/// Cross-project "needs you" queue (awaiting-review / overdue / stalled / unstaffed).
#[tauri::command]
pub fn dev_tools_attention_queue(
    state: State<'_, Arc<AppState>>,
) -> Result<AttentionQueue, AppError> {
    require_auth_sync(&state)?;
    repo::attention_queue(&state.db)
}

/// `(goal_id, team_name)` pairs for every goal a team_assignment is advancing —
/// powers the "advancing team" badge on the goal Map (O4).
#[tauri::command]
pub fn dev_tools_goal_advancing_teams(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<(String, String)>, AppError> {
    require_auth_sync(&state)?;
    repo::goal_advancing_teams(&state.db)
}

