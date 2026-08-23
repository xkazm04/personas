use crate::models::{
    DevGoal, DevGoalDependency, DevGoalItem, DevGoalSignal, GoalProgressSuggestion,
};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};

pub(super) fn row_to_goal(row: &Row) -> rusqlite::Result<DevGoal> {
    Ok(DevGoal {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        parent_goal_id: row.get("parent_goal_id")?,
        kpi_id: row.get("kpi_id").unwrap_or(None),
        context_id: row.get("context_id")?,
        order_index: row.get("order_index")?,
        title: row.get("title")?,
        description: row.get("description")?,
        status: row.get("status")?,
        progress: row.get::<_, Option<i32>>("progress")?.unwrap_or(0),
        target_date: row.get("target_date")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_goal_signal(row: &Row) -> rusqlite::Result<DevGoalSignal> {
    Ok(DevGoalSignal {
        id: row.get("id")?,
        goal_id: row.get("goal_id")?,
        signal_type: row.get("signal_type")?,
        source_id: row.get("source_id")?,
        delta: row.get("delta")?,
        message: row.get("message")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Goals
// ============================================================================

pub fn list_goals_by_project(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevGoal>, AppError> {
    timed_query!("dev_goals", "dev_goals::list_goals_by_project", {
        let conn = pool.get()?;
        if let Some(status) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_goals WHERE project_id = ?1 AND status = ?2 ORDER BY order_index",
            )?;
            let rows = stmt.query_map(params![project_id, status], row_to_goal)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt =
                conn.prepare("SELECT * FROM dev_goals WHERE project_id = ?1 ORDER BY order_index")?;
            let rows = stmt.query_map(params![project_id], row_to_goal)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    })
}

pub fn get_goal_by_id(pool: &DbPool, id: &str) -> Result<DevGoal, AppError> {
    timed_query!("dev_goals", "dev_goals::get_goal_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_goals WHERE id = ?1",
            params![id],
            row_to_goal,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev goal {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn get_goal_item_by_id(pool: &DbPool, id: &str) -> Result<DevGoalItem, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_goal_items WHERE id = ?1",
        params![id],
        row_to_goal_item,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Goal item {id}")),
        other => AppError::Database(other),
    })
}

pub fn create_goal(
    pool: &DbPool,
    project_id: &str,
    title: &str,
    description: Option<&str>,
    context_id: Option<&str>,
    status: Option<&str>,
    target_date: Option<&str>,
    parent_goal_id: Option<&str>,
) -> Result<DevGoal, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    timed_query!("dev_goals", "dev_goals::create_goal", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let status = status.unwrap_or("open");

        // Get next order_index
        let conn = pool.get()?;
        let max_order: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) FROM dev_goals WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);
        let order_index = max_order + 1;

        let status = accept_goal_status(status)?;
        conn.execute(
            "INSERT INTO dev_goals (id, project_id, parent_goal_id, context_id, order_index, title, description, status, target_date, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![id, project_id, parent_goal_id, context_id, order_index, title, description, status, target_date, now],
        )?;

        get_goal_by_id(pool, &id)
    })
}

/// Fold a caller-supplied `dev_goals.status` onto the canonical set, or refuse
/// it with a message that names the alternatives.
///
/// `dev_goals.status` carries a CHECK, which is the backstop that makes a
/// mis-laned goal impossible. This is the door in front of it, for two reasons:
/// the legacy aliases (`in_progress`, `running`, `completed`, …) that the UI has
/// always folded keep working instead of becoming a hard error, and a genuinely
/// unknown value comes back as "Unknown goal status …, expected one of …"
/// rather than SQLite's `CHECK constraint failed: status IN (...)`. The Athena
/// `update_dev_goal` op feeds this an LLM-authored string; it deserves an error
/// it can act on.
fn accept_goal_status(raw: &str) -> Result<&'static str, AppError> {
    canonical_goal_status(raw).ok_or_else(|| {
        AppError::Validation(format!(
            "Unknown goal status {raw:?} — expected one of: {}",
            CANONICAL_GOAL_STATUSES.join(", "),
        ))
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_goal(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    progress: Option<i32>,
    target_date: Option<Option<&str>>,
    context_id: Option<Option<&str>>,
    started_at: Option<Option<&str>>,
    completed_at: Option<Option<&str>>,
    // Manual goal↔KPI link (UAT F-MAJOR-15: previously ONLY the autonomous
    // kpi_derivation engine could write kpi_id — a user could not draw the
    // connection by hand). `Some(Some(id))` links, `Some(None)` unlinks,
    // `None` leaves it untouched.
    kpi_id: Option<Option<&str>>,
) -> Result<DevGoal, AppError> {
    timed_query!("dev_goals", "dev_goals::update_goal", {
        get_goal_by_id(pool, id)?;
        // Same door as `create_goal`: legacy aliases fold, unknown values are
        // refused here with a readable message instead of at the column CHECK.
        let status = match status {
            Some(raw) => Some(accept_goal_status(raw)?),
            None => None,
        };
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(
            title.map(|s| s.to_string()),
            "title",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            description.map(|o| o.map(|s| s.to_string())),
            "description",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            status.map(|s| s.to_string()),
            "status",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(progress, "progress", sets, param_idx, param_values, copy);
        push_field_param!(
            target_date.map(|o| o.map(|s| s.to_string())),
            "target_date",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            context_id.map(|o| o.map(|s| s.to_string())),
            "context_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            started_at.map(|o| o.map(|s| s.to_string())),
            "started_at",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            completed_at.map(|o| o.map(|s| s.to_string())),
            "completed_at",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            kpi_id.map(|o| o.map(|s| s.to_string())),
            "kpi_id",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE dev_goals SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_goal_by_id(pool, id)
    })
}

pub fn delete_goal(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_goals", "dev_goals::delete_goal", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_goals WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

pub fn reorder_goals(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    timed_query!("dev_goals", "dev_goals::reorder_goals", {
        let conn = pool.get()?;
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE dev_goals SET order_index = ?1, updated_at = ?2 WHERE id = ?3",
                params![i as i32, chrono::Utc::now().to_rfc3339(), id],
            )?;
        }
        Ok(())
    })
}

// ============================================================================
// Goal Signals
// ============================================================================

pub fn list_goal_signals(
    pool: &DbPool,
    goal_id: &str,
    limit: Option<i64>,
) -> Result<Vec<DevGoalSignal>, AppError> {
    timed_query!("dev_goal_signals", "dev_goal_signals::list_goal_signals", {
        let conn = pool.get()?;
        let limit = limit.unwrap_or(50);
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_goal_signals WHERE goal_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![goal_id, limit], row_to_goal_signal)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn create_goal_signal(
    pool: &DbPool,
    goal_id: &str,
    signal_type: &str,
    source_id: Option<&str>,
    delta: Option<i32>,
    message: Option<&str>,
) -> Result<DevGoalSignal, AppError> {
    timed_query!(
        "dev_goal_signals",
        "dev_goal_signals::create_goal_signal",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let conn = pool.get()?;
            conn.execute(
            "INSERT INTO dev_goal_signals (id, goal_id, signal_type, source_id, delta, message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, goal_id, signal_type, source_id, delta, message, now],
        )?;

            conn.query_row(
                "SELECT * FROM dev_goal_signals WHERE id = ?1",
                params![id],
                row_to_goal_signal,
            )
            .map_err(AppError::Database)
        }
    )
}

// ============================================================================
// Goal Items (lightweight ad-hoc checklist) + child goals + progress resolver
// ============================================================================

pub(super) fn row_to_goal_item(row: &Row) -> rusqlite::Result<DevGoalItem> {
    Ok(DevGoalItem {
        id: row.get("id")?,
        goal_id: row.get("goal_id")?,
        title: row.get("title")?,
        done: row.get::<_, i64>("done")? != 0,
        order_index: row.get("order_index")?,
        verify_kind: row.get("verify_kind").ok(),
        verify_config: row.get("verify_config").ok(),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_goal_items(pool: &DbPool, goal_id: &str) -> Result<Vec<DevGoalItem>, AppError> {
    timed_query!("dev_goal_items", "dev_goal_items::list", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare("SELECT * FROM dev_goal_items WHERE goal_id = ?1 ORDER BY order_index")?;
        let rows = stmt.query_map(params![goal_id], row_to_goal_item)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn create_goal_item(
    pool: &DbPool,
    goal_id: &str,
    title: &str,
) -> Result<DevGoalItem, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    timed_query!("dev_goal_items", "dev_goal_items::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let max_order: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) FROM dev_goal_items WHERE goal_id = ?1",
                params![goal_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);
        conn.execute(
            "INSERT INTO dev_goal_items (id, goal_id, title, done, order_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5)",
            params![id, goal_id, title.trim(), max_order + 1, now],
        )?;
        conn.query_row(
            "SELECT * FROM dev_goal_items WHERE id = ?1",
            params![id],
            row_to_goal_item,
        )
        .map_err(AppError::Database)
    })
}

pub fn update_goal_item(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    done: Option<bool>,
) -> Result<DevGoalItem, AppError> {
    timed_query!("dev_goal_items", "dev_goal_items::update", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        if let Some(t) = title {
            conn.execute(
                "UPDATE dev_goal_items SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![t.trim(), now, id],
            )?;
        }
        if let Some(d) = done {
            conn.execute(
                "UPDATE dev_goal_items SET done = ?1, updated_at = ?2 WHERE id = ?3",
                params![d as i64, now, id],
            )?;
        }
        conn.query_row(
            "SELECT * FROM dev_goal_items WHERE id = ?1",
            params![id],
            row_to_goal_item,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Goal item {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn delete_goal_item(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_goal_items", "dev_goal_items::delete", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_goal_items WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

pub fn reorder_goal_items(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    timed_query!("dev_goal_items", "dev_goal_items::reorder", {
        let conn = pool.get()?;
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE dev_goal_items SET order_index = ?1, updated_at = ?2 WHERE id = ?3",
                params![i as i32, chrono::Utc::now().to_rfc3339(), id],
            )?;
        }
        Ok(())
    })
}

// ── Goal-UAT browser-test gate ───────────────────────────────────────────────

/// Project types that ship a browser UI and so can carry a browser-test UAT
/// gate. Backend/desktop/unknown types (`fastapi`, `rust`, `python`, `other`)
/// are excluded — the gate is hidden for them. `tech_stack` holds the
/// project_type id (see PROJECT_TYPES in projectManagerTypes.tsx).
pub fn project_type_is_web(tech_stack: Option<&str>) -> bool {
    matches!(
        tech_stack.map(|s| s.trim().to_lowercase()).as_deref(),
        Some("react") | Some("nodejs") | Some("combined")
    )
}

/// The single browser-test verification item on a goal, if one exists.
pub fn goal_verification_item(
    pool: &DbPool,
    goal_id: &str,
) -> Result<Option<DevGoalItem>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT * FROM dev_goal_items \
             WHERE goal_id = ?1 AND verify_kind = 'browser_test' LIMIT 1",
            params![goal_id],
            row_to_goal_item,
        )
        .optional()?;
    Ok(row)
}

/// True when every ordinary to-do on the goal is done — i.e. the UAT gate is
/// eligible to run (the browser test is the acceptance step *after* the work).
/// Verification items themselves are excluded from the check.
pub fn goal_todos_all_complete(pool: &DbPool, goal_id: &str) -> Result<bool, AppError> {
    let items = list_goal_items(pool, goal_id)?;
    Ok(items
        .iter()
        .filter(|i| i.verify_kind.is_none())
        .all(|i| i.done))
}

/// Upsert the goal's browser-test UAT gate (one per goal). Stores
/// `verify_config` JSON `{scenario, url?}`. Re-setting replaces the prior
/// gate and resets it to open (a changed scenario must be re-verified).
pub fn set_goal_verification(
    pool: &DbPool,
    goal_id: &str,
    scenario: &str,
    url: Option<&str>,
) -> Result<DevGoalItem, AppError> {
    timed_query!("dev_goal_items", "dev_goal_items::set_verification", {
        let conn = pool.get()?;
        let config = serde_json::json!({ "scenario": scenario.trim(), "url": url }).to_string();
        let now = chrono::Utc::now().to_rfc3339();
        // Replace any existing gate so config edits don't pile up duplicates.
        conn.execute(
            "DELETE FROM dev_goal_items WHERE goal_id = ?1 AND verify_kind = 'browser_test'",
            params![goal_id],
        )?;
        let id = uuid::Uuid::new_v4().to_string();
        // Sort the gate last so it reads as the final acceptance step.
        let max_order: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) FROM dev_goal_items WHERE goal_id = ?1",
                params![goal_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);
        conn.execute(
            "INSERT INTO dev_goal_items \
             (id, goal_id, title, done, order_index, verify_kind, verify_config, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 0, ?4, 'browser_test', ?5, ?6, ?6)",
            params![id, goal_id, "Browser UAT passes", max_order + 1, config, now],
        )?;
        conn.query_row(
            "SELECT * FROM dev_goal_items WHERE id = ?1",
            params![id],
            row_to_goal_item,
        )
        .map_err(AppError::Database)
    })
}

/// Re-open a goal's browser-test gate if it had already passed — called when
/// new/incomplete work is added to the goal so "done" never outlives the scope
/// it was verified against. No-op when there's no gate or it's already open.
/// Returns true if a passed gate was re-opened.
pub fn reopen_verification_if_passed(pool: &DbPool, goal_id: &str) -> Result<bool, AppError> {
    let Some(item) = goal_verification_item(pool, goal_id)? else {
        return Ok(false);
    };
    if !item.done {
        return Ok(false);
    }
    {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_goal_items SET done = 0, updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().to_rfc3339(), item.id],
        )?;
    }
    // Recompute so the goal drops out of done/100 (the gate now blocks again).
    apply_resolved_goal_progress(pool, goal_id)?;
    Ok(true)
}

/// Mark the goal's browser-test gate passed (done) and recompute progress —
/// the close-loop a passing UAT triggers. Returns the new progress.
pub fn complete_goal_verification(pool: &DbPool, goal_id: &str) -> Result<i32, AppError> {
    let item = goal_verification_item(pool, goal_id)?
        .ok_or_else(|| AppError::NotFound(format!("no UAT gate on goal {goal_id}")))?;
    {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_goal_items SET done = 1, updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().to_rfc3339(), item.id],
        )?;
    }
    apply_resolved_goal_progress(pool, goal_id)
}

/// Sub-goals: `dev_goals` rows whose `parent_goal_id` is this goal.
pub fn list_child_goals(pool: &DbPool, parent_goal_id: &str) -> Result<Vec<DevGoal>, AppError> {
    timed_query!("dev_goals", "dev_goals::list_child_goals", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare("SELECT * FROM dev_goals WHERE parent_goal_id = ?1 ORDER BY order_index")?;
        let rows = stmt.query_map(params![parent_goal_id], row_to_goal)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// A `dev_goals` status counts as "complete" for progress derivation.
pub fn goal_status_is_complete(status: &str) -> bool {
    matches!(status, "done" | "completed")
}

/// A `team_assignment_steps` status counts as "complete" (advances the goal).
pub fn step_status_is_complete(status: &str) -> bool {
    matches!(status, "done" | "skipped")
}

/// Canonical goal-status bucket — Rust mirror of the frontend `goalStatus.ts`
/// normalizer, so cross-project rollups bucket exactly like the UI renders.
pub fn normalize_goal_status(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "in-progress" | "in_progress" | "running" | "active" | "matching" => "in-progress",
        "blocked" | "review" | "awaiting_review" => "blocked",
        // Agent/team completed the work; it sits in the human-acceptance queue
        // until the user accepts (→ done) or rejects (→ in-progress). Distinct
        // from `done` (accepted) and from `blocked`/`awaiting_review`.
        "awaiting_acceptance" | "awaiting-acceptance" | "pending_acceptance" => {
            "awaiting_acceptance"
        }
        "done" | "completed" | "complete" | "skipped" => "done",
        _ => "open",
    }
}

/// The canonical `dev_goals.status` set — the values the column's CHECK
/// constraint admits, and the ones `goalStatus.ts` declares as `GoalStatus`.
pub const CANONICAL_GOAL_STATUSES: [&str; 5] = [
    "open",
    "in-progress",
    "awaiting_acceptance",
    "blocked",
    "done",
];

/// STRICT counterpart to [`normalize_goal_status`]: the same alias table with
/// the catch-all removed, so an unrecognised value comes back as `None` instead
/// of quietly becoming `open`.
///
/// The runtime normalizer's fallback is right for rendering (never throw at the
/// user) and wrong for a migration, which has to be able to tell "this is the
/// legacy spelling of in-progress" from "nobody knows what this is". A wrong
/// status is a bug to see, not to bury, so the caller reports what this
/// returns `None` for.
pub fn canonical_goal_status(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "in-progress" | "in_progress" | "running" | "active" | "matching" => Some("in-progress"),
        "blocked" | "review" | "awaiting_review" => Some("blocked"),
        "awaiting_acceptance" | "awaiting-acceptance" | "pending_acceptance" => {
            Some("awaiting_acceptance")
        }
        "done" | "completed" | "complete" | "skipped" => Some("done"),
        "open" | "pending" | "todo" | "queued" => Some("open"),
        _ => None,
    }
}

/// Not terminal — counts as active work (drives at-risk / portfolio rollups).
pub fn goal_status_is_ongoing(status: &str) -> bool {
    normalize_goal_status(status) != "done"
}

/// Pure hybrid-progress computation (no DB — unit-testable). Composes the goal's
/// ad-hoc checklist items, its sub-goals, and its linked team-assignment steps
/// into one done/total tally and derives a suggested progress %. When there is
/// nothing to derive from, `suggested` falls back to `current` so we never push
/// a hand-set goal back to 0%. The UI surfaces `suggested != current` as an
/// accept/edit nudge — we never write progress silently.
pub fn compute_suggested_progress(
    goal_id: &str,
    current: i32,
    items_done: usize,
    items_total: usize,
    subgoals_done: usize,
    subgoals_total: usize,
    steps_done: usize,
    steps_total: usize,
) -> GoalProgressSuggestion {
    let done = items_done + subgoals_done + steps_done;
    let total = items_total + subgoals_total + steps_total;
    let suggested = if total == 0 {
        current
    } else {
        ((done as f64 / total as f64) * 100.0).round() as i32
    };
    let reason = if total == 0 {
        "No checklist, sub-goals, or linked team steps to derive progress from".to_string()
    } else {
        format!(
            "{done}/{total} complete ({items_done}/{items_total} checklist, {subgoals_done}/{subgoals_total} sub-goals, {steps_done}/{steps_total} team steps)"
        )
    };
    GoalProgressSuggestion {
        goal_id: goal_id.to_string(),
        current,
        suggested,
        done_count: done as i32,
        total_count: total as i32,
        reason,
    }
}

/// Auto-close the progress loop: recompute a goal's progress from its checklist
/// + sub-goals + linked team-assignment steps and **write it**. The orchestrator
/// calls this when a goal-linked assignment finishes, so a team that actually did
/// the work moves the goal — `dev_tools_resolve_goal_progress` only *suggests* a
/// value for the user to accept, which never happens for an unattended team.
///
/// Guarantees:
/// - **Never regresses** below the current (possibly hand-set) progress — a team
///   can only push a goal forward, so a manual override is safe.
/// - Transitions status `open → in-progress` (stamping `started_at`) once there's
///   any progress, and `→ done` (stamping `completed_at`) at 100%.
///
/// Returns the written progress %. Callers treat failures as best-effort.
pub fn apply_resolved_goal_progress(pool: &DbPool, goal_id: &str) -> Result<i32, AppError> {
    let goal = get_goal_by_id(pool, goal_id)?;

    let items = list_goal_items(pool, goal_id)?;
    let items_done = items.iter().filter(|i| i.done).count();
    let subgoals = list_child_goals(pool, goal_id)?;
    let subgoals_done = subgoals
        .iter()
        .filter(|g| goal_status_is_complete(&g.status) || g.progress >= 100)
        .count();
    let assignments = crate::repos::orchestration::team_assignments::list_for_goal(pool, goal_id)?;
    let mut steps_total = 0usize;
    let mut steps_done = 0usize;
    for a in &assignments {
        let steps = crate::repos::orchestration::team_assignments::list_steps(pool, &a.id)?;
        steps_total += steps.len();
        steps_done += steps
            .iter()
            .filter(|s| step_status_is_complete(&s.status))
            .count();
    }

    let sugg = compute_suggested_progress(
        goal_id,
        goal.progress,
        items_done,
        items.len(),
        subgoals_done,
        subgoals.len(),
        steps_done,
        steps_total,
    );
    // Never regress a manually-higher value; teams only push progress up.
    let mut new_progress = sugg.suggested.max(goal.progress);

    // Goal-UAT gate: an OPEN browser-test verification item is a hard
    // blocker — the goal cannot reach 100% / `done` until it passes,
    // regardless of how the rest of the progress composes. This is the
    // gate, independent of the suggestion formula.
    let has_open_verify = items
        .iter()
        .any(|i| i.verify_kind.as_deref() == Some("browser_test") && !i.done);
    if has_open_verify && new_progress >= 100 {
        new_progress = 99;
    }

    let now = chrono::Utc::now().to_rfc3339();
    let cur = normalize_goal_status(&goal.status);
    let mut new_status: Option<&str> = None;
    let mut started_at: Option<Option<&str>> = None;
    let mut completed_at: Option<Option<&str>> = None;

    if new_progress >= 100 {
        // Acceptance gate: agent/team-driven completion lands in
        // `awaiting_acceptance` (the human-acceptance queue, surfaced in the
        // Board's "Your turn" lane + the Goal Acceptance view), NEVER straight to
        // `done`. The user accepts (→ done, off-board) or rejects (→ in-progress
        // with a comment) via `dev_tools_resolve_goal_acceptance`. A goal already
        // accepted (`done`) or already pending (`awaiting_acceptance`) stays put.
        if cur != "done" && cur != "awaiting_acceptance" {
            new_status = Some("awaiting_acceptance");
            completed_at = Some(Some(now.as_str()));
        }
        if goal.started_at.is_none() {
            started_at = Some(Some(now.as_str()));
        }
    } else if cur == "done" || cur == "awaiting_acceptance" {
        // Was complete/pending-acceptance but progress dropped below 100 — e.g. a
        // re-opened UAT gate or new work added. Demote out of the terminal/pending
        // state and clear the completion stamp so it never outlives 100%.
        new_status = Some("in-progress");
        completed_at = Some(None);
    } else if new_progress > 0 && cur == "open" {
        new_status = Some("in-progress");
        if goal.started_at.is_none() {
            started_at = Some(Some(now.as_str()));
        }
    }

    update_goal(
        pool,
        goal_id,
        None,               // title
        None,               // description
        new_status,         // status
        Some(new_progress), // progress
        None,               // target_date
        None,               // context_id
        started_at,         // started_at
        completed_at,       // completed_at
        None,               // kpi_id (unchanged)
    )?;

    Ok(new_progress)
}

/// Mark a goal `open → in-progress` (stamping `started_at`) when work begins —
/// called by the orchestrator the moment a goal-linked step starts running, so
/// the goal reflects activity before any step has finished. No-op when the goal
/// is already past `open`. Best-effort.
pub fn mark_goal_in_progress(pool: &DbPool, goal_id: &str) -> Result<(), AppError> {
    let goal = get_goal_by_id(pool, goal_id)?;
    if normalize_goal_status(&goal.status) != "open" {
        return Ok(());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let started_at = if goal.started_at.is_none() {
        Some(Some(now.as_str()))
    } else {
        None
    };
    update_goal(
        pool,
        goal_id,
        None,
        None,
        Some("in-progress"),
        None,
        None,
        None,
        started_at,
        None,
        None,
    )?;
    Ok(())
}

#[cfg(test)]
mod apply_progress_tests {
    use super::*;
    use crate::init_test_db;
    use crate::repos::dev::portfolio::resolve_goal_acceptance;
    use crate::repos::dev::projects::{create_project, update_project};

    #[test]
    fn applies_checklist_ratio_and_transitions_status() {
        let pool = init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        let goal = create_goal(&pool, &project.id, "G", None, None, None, None, None).unwrap();
        assert_eq!(normalize_goal_status(&goal.status), "open");

        // 2 to-dos, 1 done → 50% → in-progress.
        let i1 = create_goal_item(&pool, &goal.id, "todo a").unwrap();
        let _i2 = create_goal_item(&pool, &goal.id, "todo b").unwrap();
        update_goal_item(&pool, &i1.id, None, Some(true)).unwrap();

        let p = apply_resolved_goal_progress(&pool, &goal.id).unwrap();
        assert_eq!(p, 50);
        let g = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_eq!(g.progress, 50);
        assert_eq!(normalize_goal_status(&g.status), "in-progress");
        assert!(g.started_at.is_some());

        // Finish the second → 100% → awaiting_acceptance (the human-acceptance
        // queue), NOT straight to done.
        update_goal_item(&pool, &_i2.id, None, Some(true)).unwrap();
        let p2 = apply_resolved_goal_progress(&pool, &goal.id).unwrap();
        assert_eq!(p2, 100);
        let g2 = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_eq!(normalize_goal_status(&g2.status), "awaiting_acceptance");
        assert!(g2.completed_at.is_some());

        // Explicit acceptance is what actually completes the goal.
        let accepted = resolve_goal_acceptance(&pool, &goal.id, true, None).unwrap();
        assert_eq!(normalize_goal_status(&accepted.status), "done");
    }

    #[test]
    fn never_regresses_a_manual_value() {
        let pool = init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        let goal = create_goal(&pool, &project.id, "G", None, None, None, None, None).unwrap();
        // Hand-set 80%, no items/steps → resolver would suggest fallback(current)=80; never below.
        update_goal(
            &pool,
            &goal.id,
            None,
            None,
            None,
            Some(80),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let p = apply_resolved_goal_progress(&pool, &goal.id).unwrap();
        assert_eq!(p, 80);
    }

    #[test]
    fn update_project_sets_and_clears_test_env_fields() {
        let pool = init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        // Default NULL on create (test env + main branch are post-creation concepts).
        assert_eq!(p.test_env_url, None);
        assert_eq!(p.test_env_branch, None);
        assert_eq!(p.main_branch, None);

        // SET: outer Some, inner Some(value). 9 leading Nones = params through pr_credential_id;
        // the final three are test_env_url / test_env_branch / main_branch.
        let p = update_project(
            &pool,
            &p.id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Some("https://staging.example.test")),
            Some(Some("staging")),
            Some(Some("main")),
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            p.test_env_url.as_deref(),
            Some("https://staging.example.test")
        );
        assert_eq!(p.test_env_branch.as_deref(), Some("staging"));
        assert_eq!(p.main_branch.as_deref(), Some("main"));

        // LEAVE UNCHANGED: outer None → value persists.
        let p = update_project(
            &pool, &p.id, None, None, None, None, None, None, None, None, None, None, None, None,
            None, None, None,
        )
        .unwrap();
        assert_eq!(
            p.test_env_url.as_deref(),
            Some("https://staging.example.test")
        );
        assert_eq!(p.main_branch.as_deref(), Some("main"));

        // CLEAR: outer Some, inner None → back to NULL.
        let p = update_project(
            &pool,
            &p.id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(None),
            Some(None),
            Some(None),
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(p.test_env_url, None);
        assert_eq!(p.test_env_branch, None);
        assert_eq!(p.main_branch, None);
    }
}

// ============================================================================
// Goal Dependencies
// ============================================================================

pub fn list_goal_dependencies(
    pool: &DbPool,
    goal_id: &str,
) -> Result<Vec<DevGoalDependency>, AppError> {
    timed_query!("dev_goal_dependencies", "dev_goal_dependencies::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, goal_id, depends_on_id, dependency_type, created_at
             FROM dev_goal_dependencies WHERE goal_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt
            .query_map(params![goal_id], |row| {
                Ok(DevGoalDependency {
                    id: row.get("id")?,
                    goal_id: row.get("goal_id")?,
                    depends_on_id: row.get("depends_on_id")?,
                    dependency_type: row.get("dependency_type")?,
                    created_at: row.get("created_at")?,
                })
            })
            .map_err(AppError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(rows)
    })
}

/// Bulk-load every goal's status + outgoing dependency edges for a project.
/// One query per table; in-memory join. Used by the auto-run scheduler so
/// readiness evaluation does not fan out into N+1 `list_goal_dependencies`
/// calls.
pub fn list_goal_statuses_with_deps(
    pool: &DbPool,
    project_id: &str,
) -> Result<HashMap<String, (String, Vec<String>)>, AppError> {
    timed_query!(
        "dev_goal_dependencies",
        "dev_goal_dependencies::list_statuses_with_deps",
        {
            let conn = pool.get()?;

            let mut goal_stmt =
                conn.prepare("SELECT id, status FROM dev_goals WHERE project_id = ?1")?;
            let mut map: HashMap<String, (String, Vec<String>)> = HashMap::new();
            let goal_rows = goal_stmt.query_map(params![project_id], |row| {
                Ok((row.get::<_, String>("id")?, row.get::<_, String>("status")?))
            })?;
            for r in goal_rows {
                let (id, status) = r.map_err(AppError::Database)?;
                map.insert(id, (status, Vec::new()));
            }

            let goal_ids: Vec<String> = map.keys().cloned().collect();
            if !goal_ids.is_empty() {
                let placeholders = std::iter::repeat_n("?", goal_ids.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "SELECT goal_id, depends_on_id FROM dev_goal_dependencies \
                     WHERE goal_id IN ({placeholders}) AND dependency_type = 'blocks'"
                );
                let mut dep_stmt = conn.prepare(&sql)?;
                let params: Vec<&dyn rusqlite::types::ToSql> = goal_ids
                    .iter()
                    .map(|s| s as &dyn rusqlite::types::ToSql)
                    .collect();
                let dep_rows = dep_stmt.query_map(params.as_slice(), |row| {
                    Ok((
                        row.get::<_, String>("goal_id")?,
                        row.get::<_, String>("depends_on_id")?,
                    ))
                })?;
                for r in dep_rows {
                    let (gid, dep) = r.map_err(AppError::Database)?;
                    if let Some(entry) = map.get_mut(&gid) {
                        entry.1.push(dep);
                    }
                }
            }
            Ok(map)
        }
    )
}

/// Reject a new dependency edge when adding it would create a cycle.
/// Walks forward from `depends_on_id` (DFS over `blocks`-type edges) — if it
/// can reach `goal_id`, the new edge would close a cycle.
///
/// Self-loops are rejected as the trivial cycle.
pub fn check_goal_dependency_cycle(
    pool: &DbPool,
    goal_id: &str,
    depends_on_id: &str,
) -> Result<(), AppError> {
    if goal_id == depends_on_id {
        return Err(AppError::Validation(
            "A goal cannot depend on itself".into(),
        ));
    }
    timed_query!(
        "dev_goal_dependencies",
        "dev_goal_dependencies::cycle_check",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT depends_on_id FROM dev_goal_dependencies \
                 WHERE goal_id = ?1 AND dependency_type = 'blocks'",
            )?;

            let mut visited: HashSet<String> = HashSet::new();
            let mut stack: Vec<String> = vec![depends_on_id.to_string()];
            while let Some(node) = stack.pop() {
                if !visited.insert(node.clone()) {
                    continue;
                }
                if node == goal_id {
                    return Err(AppError::Validation(
                        "Adding this dependency would create a cycle".into(),
                    ));
                }
                let rows =
                    stmt.query_map(params![node], |row| row.get::<_, String>("depends_on_id"))?;
                for r in rows {
                    stack.push(r.map_err(AppError::Database)?);
                }
            }
            Ok(())
        }
    )
}

pub fn add_goal_dependency(
    pool: &DbPool,
    goal_id: &str,
    depends_on_id: &str,
    dependency_type: Option<&str>,
) -> Result<DevGoalDependency, AppError> {
    let dep_type = dependency_type.unwrap_or("blocks");
    if dep_type == "blocks" {
        check_goal_dependency_cycle(pool, goal_id, depends_on_id)?;
    }
    timed_query!("dev_goal_dependencies", "dev_goal_dependencies::add", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_goal_dependencies (id, goal_id, depends_on_id, dependency_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, goal_id, depends_on_id, dep_type, now],
        )?;
        Ok(DevGoalDependency {
            id,
            goal_id: goal_id.to_string(),
            depends_on_id: depends_on_id.to_string(),
            dependency_type: dep_type.to_string(),
            created_at: now,
        })
    })
}

pub fn remove_goal_dependency(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_goal_dependencies", "dev_goal_dependencies::remove", {
        let conn = pool.get()?;
        let count = conn.execute(
            "DELETE FROM dev_goal_dependencies WHERE id = ?1",
            params![id],
        )?;
        Ok(count > 0)
    })
}

/// `(goal_id, team_name)` for every team_assignment that advances a goal — the
/// canonical "this team is working this goal" link, surfaced on the goal Map.
// FOREIGN TABLE: team_assignments (and persona_teams) are owned by
// `repos::orchestration::team_assignments`; this reads them directly.
pub fn goal_advancing_teams(pool: &DbPool) -> Result<Vec<(String, String)>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT ta.goal_id, t.name
         FROM team_assignments ta JOIN persona_teams t ON t.id = ta.team_id
         WHERE ta.goal_id IS NOT NULL",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[cfg(test)]
mod goal_status_tests {
    use super::{goal_status_is_ongoing, normalize_goal_status};
    use crate::repos::dev::attention::{days_between, parse_deadline, parse_stamp};

    #[test]
    fn normalize_buckets_match_the_frontend_model() {
        for raw in [
            "in-progress",
            "in_progress",
            "running",
            "active",
            "matching",
        ] {
            assert_eq!(normalize_goal_status(raw), "in-progress", "{raw}");
        }
        for raw in ["blocked", "review", "awaiting_review"] {
            assert_eq!(normalize_goal_status(raw), "blocked", "{raw}");
        }
        for raw in ["done", "completed", "complete", "skipped"] {
            assert_eq!(normalize_goal_status(raw), "done", "{raw}");
        }
        for raw in ["open", "pending", "queued", "weird", ""] {
            assert_eq!(normalize_goal_status(raw), "open", "{raw}");
        }
        assert_eq!(normalize_goal_status("  In_Progress "), "in-progress");
    }

    #[test]
    fn ongoing_is_inverse_of_done() {
        assert!(!goal_status_is_ongoing("done"));
        assert!(!goal_status_is_ongoing("completed"));
        assert!(goal_status_is_ongoing("open"));
        assert!(goal_status_is_ongoing("in_progress"));
        assert!(goal_status_is_ongoing("blocked"));
    }

    /// The strict mapper is the runtime normalizer minus its catch-all — the
    /// two must never disagree on a value they both recognise, or the DB
    /// migration and the UI would fold the same legacy row differently.
    #[test]
    fn the_strict_mapper_agrees_with_the_runtime_normalizer_and_only_drops_the_fallback() {
        for raw in [
            "in-progress",
            "in_progress",
            "running",
            "active",
            "matching",
            "blocked",
            "review",
            "awaiting_review",
            "awaiting_acceptance",
            "awaiting-acceptance",
            "pending_acceptance",
            "done",
            "completed",
            "complete",
            "skipped",
            "open",
            "pending",
            "todo",
            "queued",
            "  In_Progress ",
        ] {
            assert_eq!(
                super::canonical_goal_status(raw),
                Some(normalize_goal_status(raw)),
                "{raw} folds differently in the strict mapper than at runtime",
            );
        }
        // The whole difference: what the normalizer swallows, this reports.
        for unknown in ["weird", "", "escalated-to-legal", "in progress"] {
            assert_eq!(super::canonical_goal_status(unknown), None, "{unknown}");
            assert_eq!(normalize_goal_status(unknown), "open", "{unknown}");
        }
    }

    /// The repo door in front of the column CHECK: aliases still fold (so no
    /// existing writer regresses into a hard error), and a value nothing maps
    /// is refused with a message that names the alternatives rather than
    /// SQLite's bare "CHECK constraint failed".
    #[test]
    fn goal_writers_fold_aliases_and_refuse_what_nothing_maps() {
        let pool = crate::init_test_db().unwrap();
        let project = crate::repos::dev::projects::create_project(
            &pool,
            "P",
            "/tmp/goal-door",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let g = super::create_goal(
            &pool,
            &project.id,
            "G",
            None,
            None,
            Some("running"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            g.status, "in-progress",
            "a legacy alias is folded, not rejected"
        );

        let updated = super::update_goal(
            &pool,
            &g.id,
            None,
            None,
            Some("completed"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(updated.status, "done");

        let err = super::create_goal(
            &pool,
            &project.id,
            "Bad",
            None,
            None,
            Some("escalated-to-legal"),
            None,
            None,
        )
        .unwrap_err()
        .to_string();
        assert!(
            err.contains("escalated-to-legal") && err.contains("awaiting_acceptance"),
            "the refusal must name the offending value AND the canonical set: {err}",
        );
        assert!(super::update_goal(
            &pool,
            &g.id,
            None,
            None,
            Some("whatever"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .is_err());
    }

    /// The constrained set is exactly `GoalStatus` in `goalStatus.ts`, and
    /// every member survives its own normalizer unchanged (a canonical value
    /// that folded to something else would make the CHECK unsatisfiable).
    #[test]
    fn the_canonical_set_is_closed_under_normalization() {
        assert_eq!(
            super::CANONICAL_GOAL_STATUSES,
            [
                "open",
                "in-progress",
                "awaiting_acceptance",
                "blocked",
                "done"
            ],
            "keep in sync with GoalStatus in src/features/teams/sub_goals/goalStatus.ts",
        );
        for s in super::CANONICAL_GOAL_STATUSES {
            assert_eq!(normalize_goal_status(s), s, "{s} is not a fixed point");
            assert_eq!(super::canonical_goal_status(s), Some(s), "{s}");
        }
    }

    #[test]
    fn days_between_handles_rfc3339_date_only_and_garbage() {
        assert_eq!(
            days_between("2026-05-01T00:00:00Z", "2026-05-09T00:00:00Z"),
            Some(8)
        );
        assert_eq!(days_between("2026-05-01", "2026-05-04"), Some(3));
        // The bug this replaced: garbage used to come back as `0`, which is a
        // plausible-looking reading ("stalled 0d") rather than an admission
        // that the stamp could not be read.
        assert_eq!(
            days_between("not-a-date", "2026-05-04"),
            None,
            "an unparseable stamp must be unknown, never a confident zero",
        );
        assert_eq!(days_between("2026-05-04", "also-not-a-date"), None);
        assert_eq!(days_between("", "2026-05-04"), None);
    }

    /// SQLite's `datetime('now')` column default — the shape produced whenever
    /// a writer omits created_at/updated_at — is NOT RFC3339. The old parser
    /// rejected it and returned 0, so every such row read as freshly touched.
    #[test]
    fn parses_the_three_timestamp_shapes_this_database_actually_stores() {
        let rfc = parse_stamp("2026-05-01T12:00:00+00:00").expect("rfc3339");
        let sqlite = parse_stamp("2026-05-01 12:00:00").expect("sqlite datetime('now')");
        assert_eq!(rfc, sqlite, "the SQLite default shape must parse as UTC");
        assert!(
            parse_stamp("2026-05-01 12:00:00.123").is_some(),
            "fractional seconds"
        );
        assert!(parse_stamp("2026-05-01").is_some(), "date-only");
        assert!(parse_stamp("whenever").is_none());

        // Offsets must be honoured, not compared as text: 14:00+02:00 is
        // EARLIER than 13:00Z, which no lexicographic compare can tell you.
        let plus_two = parse_stamp("2026-05-01T14:00:00+02:00").expect("offset");
        let utc_13 = parse_stamp("2026-05-01T13:00:00Z").expect("utc");
        assert!(plus_two < utc_13);
        assert!(
            "2026-05-01T14:00:00+02:00" > "2026-05-01T13:00:00Z",
            "…yet the strings sort the other way"
        );
    }

    /// A date-only deadline means the END of that day. Compared as raw strings,
    /// `"2026-05-01" < "2026-05-01T09:00:00+00:00"` holds (prefix), so a goal
    /// due TODAY was reported overdue from midnight.
    #[test]
    fn a_date_only_deadline_is_not_overdue_until_the_day_is_out() {
        let due = parse_deadline("2026-05-01").expect("date-only deadline");
        let morning_of = parse_stamp("2026-05-01T09:00:00Z").expect("stamp");
        let next_morning = parse_stamp("2026-05-02T09:00:00Z").expect("stamp");
        assert!(due > morning_of, "due today is not yet overdue");
        assert!(due < next_morning, "due yesterday is overdue");
        // An RFC3339 deadline keeps its own instant.
        assert_eq!(
            parse_deadline("2026-05-01T09:00:00Z"),
            parse_stamp("2026-05-01T09:00:00Z")
        );
    }
}

#[cfg(test)]
mod goal_progress_tests {
    use super::compute_suggested_progress;

    #[test]
    fn empty_falls_back_to_current() {
        let s = compute_suggested_progress("g1", 42, 0, 0, 0, 0, 0, 0);
        assert_eq!(s.suggested, 42, "nothing to derive from → keep current");
        assert_eq!(s.total_count, 0);
        assert!(s.reason.contains("No checklist"));
    }

    #[test]
    fn derives_across_all_three_sources() {
        // 3 items (1 done) + 2 sub-goals (1 done) + 5 steps (3 done) = 5/10 = 50%
        let s = compute_suggested_progress("g1", 0, 1, 3, 1, 2, 3, 5);
        assert_eq!(s.done_count, 5);
        assert_eq!(s.total_count, 10);
        assert_eq!(s.suggested, 50);
    }

    #[test]
    fn all_complete_is_hundred() {
        let s = compute_suggested_progress("g1", 10, 4, 4, 0, 0, 2, 2);
        assert_eq!(s.suggested, 100);
        assert_eq!(s.done_count, s.total_count);
    }

    #[test]
    fn rounds_to_nearest_percent() {
        // 1/3 = 33.33 → 33
        let s = compute_suggested_progress("g1", 0, 1, 3, 0, 0, 0, 0);
        assert_eq!(s.suggested, 33);
        // 2/3 = 66.67 → 67
        let s = compute_suggested_progress("g1", 0, 2, 3, 0, 0, 0, 0);
        assert_eq!(s.suggested, 67);
    }
}

#[cfg(test)]
mod uat_gate_tests {
    use super::*;
    use crate::repos::dev::portfolio::resolve_goal_acceptance;
    use crate::repos::dev::projects::create_project;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:uat_gate_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::migrations::run(&conn).expect("initial migrations");
            crate::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    #[test]
    fn web_classifier() {
        assert!(project_type_is_web(Some("react")));
        assert!(project_type_is_web(Some("NodeJS")));
        assert!(project_type_is_web(Some("combined")));
        assert!(!project_type_is_web(Some("rust")));
        assert!(!project_type_is_web(Some("fastapi")));
        assert!(!project_type_is_web(Some("python")));
        assert!(!project_type_is_web(Some("other")));
        assert!(!project_type_is_web(None));
    }

    #[test]
    fn open_uat_gate_caps_progress_below_done() {
        let pool = test_pool();
        let project = create_project(
            &pool,
            "Web App",
            "/tmp/webapp",
            None,
            None,
            Some("react"),
            None,
            None,
        )
        .unwrap();
        let goal = create_goal(
            &pool,
            &project.id,
            "Ship feature",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        // One ordinary to-do, marked done.
        let todo = create_goal_item(&pool, &goal.id, "Build the feature").unwrap();
        update_goal_item(&pool, &todo.id, None, Some(true)).unwrap();
        // Attach the UAT gate (still open).
        set_goal_verification(&pool, &goal.id, "smoke test the app", None).unwrap();

        // All ordinary to-dos done, but the open gate must cap below 100 / not done.
        let progress = apply_resolved_goal_progress(&pool, &goal.id).unwrap();
        assert!(
            progress < 100,
            "open UAT gate must keep progress < 100, got {progress}"
        );
        let g = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_ne!(
            normalize_goal_status(&g.status),
            "done",
            "goal must NOT be done while UAT open"
        );

        // Eligibility: every non-verify to-do is complete → UAT may run.
        assert!(goal_todos_all_complete(&pool, &goal.id).unwrap());

        // Passing the UAT closes the gate → goal reaches 100 / awaiting_acceptance
        // (the human-acceptance queue) — accepting it is what completes it.
        let after = complete_goal_verification(&pool, &goal.id).unwrap();
        assert_eq!(after, 100, "closing the gate completes the goal");
        let g2 = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_eq!(normalize_goal_status(&g2.status), "awaiting_acceptance");

        let accepted = resolve_goal_acceptance(&pool, &goal.id, true, None).unwrap();
        assert_eq!(normalize_goal_status(&accepted.status), "done");
    }

    #[test]
    fn uat_ineligible_while_todos_open() {
        let pool = test_pool();
        let project = create_project(
            &pool,
            "Web2",
            "/tmp/web2",
            None,
            None,
            Some("nodejs"),
            None,
            None,
        )
        .unwrap();
        let goal =
            create_goal(&pool, &project.id, "Feature", None, None, None, None, None).unwrap();
        create_goal_item(&pool, &goal.id, "Unfinished work").unwrap(); // left open
        set_goal_verification(&pool, &goal.id, "test it", None).unwrap();
        assert!(
            !goal_todos_all_complete(&pool, &goal.id).unwrap(),
            "an open ordinary to-do makes the UAT ineligible"
        );
    }

    #[test]
    fn reopen_gate_when_passed() {
        let pool = test_pool();
        let project = create_project(
            &pool,
            "Web4",
            "/tmp/web4",
            None,
            None,
            Some("react"),
            None,
            None,
        )
        .unwrap();
        let goal =
            create_goal(&pool, &project.id, "Feature", None, None, None, None, None).unwrap();
        set_goal_verification(&pool, &goal.id, "test it", None).unwrap();
        // Pass the gate → goal reaches the human-acceptance queue.
        complete_goal_verification(&pool, &goal.id).unwrap();
        assert_eq!(
            normalize_goal_status(&get_goal_by_id(&pool, &goal.id).unwrap().status),
            "awaiting_acceptance"
        );
        // Re-open: new work invalidates the pass.
        let reopened = reopen_verification_if_passed(&pool, &goal.id).unwrap();
        assert!(reopened);
        let g = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_ne!(
            normalize_goal_status(&g.status),
            "done",
            "re-opening drops the goal out of done"
        );
        assert!(g.progress < 100);
        // Idempotent: re-opening an already-open gate is a no-op.
        assert!(!reopen_verification_if_passed(&pool, &goal.id).unwrap());
    }

    #[test]
    fn set_verification_replaces_not_duplicates() {
        let pool = test_pool();
        let project = create_project(
            &pool,
            "Web3",
            "/tmp/web3",
            None,
            None,
            Some("react"),
            None,
            None,
        )
        .unwrap();
        let goal =
            create_goal(&pool, &project.id, "Feature", None, None, None, None, None).unwrap();
        set_goal_verification(&pool, &goal.id, "scenario one", None).unwrap();
        set_goal_verification(
            &pool,
            &goal.id,
            "scenario two",
            Some("http://localhost:8765"),
        )
        .unwrap();
        let items = list_goal_items(&pool, &goal.id).unwrap();
        let gates: Vec<_> = items
            .iter()
            .filter(|i| i.verify_kind.as_deref() == Some("browser_test"))
            .collect();
        assert_eq!(
            gates.len(),
            1,
            "re-setting replaces the gate, never duplicates"
        );
        assert!(gates[0]
            .verify_config
            .as_deref()
            .unwrap()
            .contains("scenario two"));
    }
}
