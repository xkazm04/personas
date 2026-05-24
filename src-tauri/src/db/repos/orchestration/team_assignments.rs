//! Team-assignment repo — CRUD over `team_assignments`,
//! `team_assignment_steps`, `team_assignment_events`.
//!
//! All multi-row inserts (assignment + its steps) are wrapped in a transaction
//! so a partial composer submission can't leave a half-built assignment in
//! the DB. Read paths are split per table; the orchestrator + commands
//! combine them at call time rather than forcing the repo to express a
//! denormalized "with steps" type.

use rusqlite::params;

use crate::db::models::{
    CreateTeamAssignmentInput, CreateTeamAssignmentTemplateInput, TeamAssignment,
    TeamAssignmentEvent, TeamAssignmentStep, TeamAssignmentTemplate,
};
use crate::db::DbPool;
use crate::error::AppError;

// ----------------------------------------------------------------------------
// Row mappers
// ----------------------------------------------------------------------------

fn row_to_assignment(row: &rusqlite::Row) -> rusqlite::Result<TeamAssignment> {
    Ok(TeamAssignment {
        id: row.get("id")?,
        team_id: row.get("team_id")?,
        title: row.get("title")?,
        goal: row.get("goal")?,
        status: row.get("status")?,
        match_strategy: row.get("match_strategy")?,
        max_parallel_steps: row.get("max_parallel_steps")?,
        source: row.get("source")?,
        companion_op_id: row.get("companion_op_id")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        error_message: row.get("error_message")?,
    })
}

fn row_to_step(row: &rusqlite::Row) -> rusqlite::Result<TeamAssignmentStep> {
    Ok(TeamAssignmentStep {
        id: row.get("id")?,
        assignment_id: row.get("assignment_id")?,
        step_order: row.get("step_order")?,
        title: row.get("title")?,
        description: row.get("description")?,
        status: row.get("status")?,
        assigned_persona_id: row.get("assigned_persona_id")?,
        assigned_use_case_id: row.get("assigned_use_case_id")?,
        match_confidence: row.get("match_confidence")?,
        match_rationale: row.get("match_rationale")?,
        execution_id: row.get("execution_id")?,
        depends_on: row.get("depends_on")?,
        output_summary: row.get("output_summary")?,
        retry_count: row.get("retry_count")?,
        error_message: row.get("error_message")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<TeamAssignmentEvent> {
    Ok(TeamAssignmentEvent {
        id: row.get("id")?,
        assignment_id: row.get("assignment_id")?,
        step_id: row.get("step_id")?,
        kind: row.get("kind")?,
        payload: row.get("payload")?,
        created_at: row.get("created_at")?,
    })
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const MAX_TITLE_LEN: usize = 200;
const MAX_GOAL_LEN: usize = 8_000;
const MAX_STEP_TITLE_LEN: usize = 200;
const MAX_STEP_DESCRIPTION_LEN: usize = 8_000;
const MIN_PARALLEL: i32 = 1;
const MAX_PARALLEL: i32 = 16;

fn validate_input(input: &CreateTeamAssignmentInput) -> Result<(), AppError> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Validation(
            "Assignment title cannot be empty".into(),
        ));
    }
    if title.len() > MAX_TITLE_LEN {
        return Err(AppError::Validation(format!(
            "Assignment title exceeds {MAX_TITLE_LEN} characters"
        )));
    }
    let goal = input.goal.trim();
    if goal.is_empty() {
        return Err(AppError::Validation(
            "Assignment goal cannot be empty".into(),
        ));
    }
    if goal.len() > MAX_GOAL_LEN {
        return Err(AppError::Validation(format!(
            "Assignment goal exceeds {MAX_GOAL_LEN} characters"
        )));
    }
    if input.steps.is_empty() {
        return Err(AppError::Validation(
            "Assignment must contain at least one step".into(),
        ));
    }
    for (idx, step) in input.steps.iter().enumerate() {
        if step.title.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "Step {} title cannot be empty",
                idx + 1
            )));
        }
        if step.title.len() > MAX_STEP_TITLE_LEN {
            return Err(AppError::Validation(format!(
                "Step {} title exceeds {MAX_STEP_TITLE_LEN} characters",
                idx + 1
            )));
        }
        if let Some(ref desc) = step.description {
            if desc.len() > MAX_STEP_DESCRIPTION_LEN {
                return Err(AppError::Validation(format!(
                    "Step {} description exceeds {MAX_STEP_DESCRIPTION_LEN} characters",
                    idx + 1
                )));
            }
        }
        // Manual match strategy (Phase A default) requires assigned_persona_id.
        let strategy = input.match_strategy.as_deref().unwrap_or("manual");
        if strategy == "manual" && step.assigned_persona_id.is_none() {
            return Err(AppError::Validation(format!(
                "Step {} requires an assigned persona (manual matching)",
                idx + 1
            )));
        }
        // Validate depends_on_indices reference earlier steps only (DAGs are
        // forward-only — a step can't depend on a step that comes after it).
        if let Some(ref deps) = step.depends_on_indices {
            for dep_idx in deps {
                if *dep_idx < 0 || (*dep_idx as usize) >= idx {
                    return Err(AppError::Validation(format!(
                        "Step {} dependency index {} is invalid (must reference an earlier step)",
                        idx + 1,
                        dep_idx
                    )));
                }
            }
        }
    }
    if let Some(p) = input.max_parallel_steps {
        if !(MIN_PARALLEL..=MAX_PARALLEL).contains(&p) {
            return Err(AppError::Validation(format!(
                "max_parallel_steps must be between {MIN_PARALLEL} and {MAX_PARALLEL}"
            )));
        }
    }
    Ok(())
}

// ----------------------------------------------------------------------------
// Create — single transaction for assignment + steps + initial event
// ----------------------------------------------------------------------------

pub fn create(
    pool: &DbPool,
    input: CreateTeamAssignmentInput,
) -> Result<TeamAssignment, AppError> {
    validate_input(&input)?;

    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    let assignment_id = uuid::Uuid::new_v4().to_string();
    let strategy = input.match_strategy.as_deref().unwrap_or("manual");
    let source = input.source.as_deref().unwrap_or("team_ui");
    let max_parallel = input.max_parallel_steps.unwrap_or(3);

    tx.execute(
        "INSERT INTO team_assignments
            (id, team_id, title, goal, status, match_strategy, max_parallel_steps, source, companion_op_id)
         VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, ?8)",
        params![
            assignment_id,
            input.team_id,
            input.title.trim(),
            input.goal.trim(),
            strategy,
            max_parallel,
            source,
            input.companion_op_id,
        ],
    )?;

    // Two-pass insert so depends_on (index → id) can resolve.
    let step_ids: Vec<String> = (0..input.steps.len())
        .map(|_| uuid::Uuid::new_v4().to_string())
        .collect();

    for (idx, step) in input.steps.iter().enumerate() {
        let depends_on_json = step
            .depends_on_indices
            .as_ref()
            .map(|indices| {
                let ids: Vec<&str> = indices
                    .iter()
                    .filter_map(|i| step_ids.get(*i as usize).map(|s| s.as_str()))
                    .collect();
                serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())
            });

        tx.execute(
            "INSERT INTO team_assignment_steps
                (id, assignment_id, step_order, title, description, status,
                 assigned_persona_id, assigned_use_case_id, depends_on)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8)",
            params![
                step_ids[idx],
                assignment_id,
                idx as i32,
                step.title.trim(),
                step.description.as_deref().map(str::trim),
                step.assigned_persona_id,
                step.assigned_use_case_id,
                depends_on_json,
            ],
        )?;
    }

    let event_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO team_assignment_events (id, assignment_id, kind, payload)
         VALUES (?1, ?2, 'created', ?3)",
        params![
            event_id,
            assignment_id,
            serde_json::json!({"step_count": input.steps.len()}).to_string(),
        ],
    )?;

    tx.commit()?;

    get_by_id(pool, &assignment_id)
}

// ----------------------------------------------------------------------------
// Read paths
// ----------------------------------------------------------------------------

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<TeamAssignment, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, team_id, title, goal, status, match_strategy, max_parallel_steps,
                source, companion_op_id, created_at, started_at, completed_at, error_message
         FROM team_assignments WHERE id = ?1",
    )?;
    stmt.query_row([id], row_to_assignment).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Assignment '{id}' not found"))
        }
        other => AppError::Database(other),
    })
}

pub fn list_for_team(pool: &DbPool, team_id: &str) -> Result<Vec<TeamAssignment>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, team_id, title, goal, status, match_strategy, max_parallel_steps,
                source, companion_op_id, created_at, started_at, completed_at, error_message
         FROM team_assignments
         WHERE team_id = ?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([team_id], row_to_assignment)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn list_steps(pool: &DbPool, assignment_id: &str) -> Result<Vec<TeamAssignmentStep>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, assignment_id, step_order, title, description, status,
                assigned_persona_id, assigned_use_case_id, match_confidence,
                match_rationale, execution_id, depends_on, output_summary,
                retry_count, error_message, started_at, completed_at
         FROM team_assignment_steps
         WHERE assignment_id = ?1
         ORDER BY step_order",
    )?;
    let rows = stmt.query_map([assignment_id], row_to_step)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn list_events(
    pool: &DbPool,
    assignment_id: &str,
    limit: Option<i64>,
) -> Result<Vec<TeamAssignmentEvent>, AppError> {
    let conn = pool.get()?;
    let limit = limit.unwrap_or(200);
    let mut stmt = conn.prepare(
        "SELECT id, assignment_id, step_id, kind, payload, created_at
         FROM team_assignment_events
         WHERE assignment_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![assignment_id, limit], row_to_event)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_step(pool: &DbPool, step_id: &str) -> Result<TeamAssignmentStep, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, assignment_id, step_order, title, description, status,
                assigned_persona_id, assigned_use_case_id, match_confidence,
                match_rationale, execution_id, depends_on, output_summary,
                retry_count, error_message, started_at, completed_at
         FROM team_assignment_steps WHERE id = ?1",
    )?;
    stmt.query_row([step_id], row_to_step).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Step '{step_id}' not found"))
        }
        other => AppError::Database(other),
    })
}

// ----------------------------------------------------------------------------
// Update paths — narrow, named operations rather than a kitchen-sink updater.
// Each operation also writes an audit event in the same transaction.
// ----------------------------------------------------------------------------

pub fn update_assignment_status(
    pool: &DbPool,
    id: &str,
    status: &str,
    error_message: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    // started_at sets on the first transition to running; completed_at on
    // any terminal transition. These COALESCE clauses make re-entries safe.
    tx.execute(
        "UPDATE team_assignments
         SET status = ?1,
             error_message = ?2,
             started_at = CASE WHEN ?1 = 'running' AND started_at IS NULL
                               THEN datetime('now') ELSE started_at END,
             completed_at = CASE WHEN ?1 IN ('done','failed','aborted')
                                 THEN datetime('now') ELSE completed_at END
         WHERE id = ?3",
        params![status, error_message, id],
    )?;

    let event_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO team_assignment_events (id, assignment_id, kind, payload)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            event_id,
            id,
            format!("status_{status}"),
            error_message.map(|m| serde_json::json!({"error": m}).to_string()),
        ],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn update_step_status(
    pool: &DbPool,
    step_id: &str,
    status: &str,
    error_message: Option<&str>,
    output_summary: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE team_assignment_steps
         SET status = ?1,
             error_message = COALESCE(?2, error_message),
             output_summary = COALESCE(?3, output_summary),
             started_at = CASE WHEN ?1 IN ('matching','running') AND started_at IS NULL
                               THEN datetime('now') ELSE started_at END,
             completed_at = CASE WHEN ?1 IN ('done','skipped','failed')
                                 THEN datetime('now') ELSE completed_at END
         WHERE id = ?4",
        params![status, error_message, output_summary, step_id],
    )?;

    // Fetch assignment_id for the audit event row.
    let assignment_id: String = tx.query_row(
        "SELECT assignment_id FROM team_assignment_steps WHERE id = ?1",
        [step_id],
        |row| row.get(0),
    )?;

    let event_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "step_id": step_id,
        "status": status,
        "error": error_message,
    })
    .to_string();
    tx.execute(
        "INSERT INTO team_assignment_events (id, assignment_id, step_id, kind, payload)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            event_id,
            assignment_id,
            step_id,
            format!("step_{status}"),
            payload,
        ],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn set_step_execution(
    pool: &DbPool,
    step_id: &str,
    execution_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE team_assignment_steps SET execution_id = ?1 WHERE id = ?2",
        params![execution_id, step_id],
    )?;
    Ok(())
}

/// Persist a Phase-B match result onto a step. Called by the orchestrator after
/// resolve-assignee returns. Leaves status untouched — the orchestrator
/// transitions through `matching → running` separately.
pub fn set_step_match_result(
    pool: &DbPool,
    step_id: &str,
    persona_id: &str,
    use_case_id: Option<&str>,
    confidence: Option<f64>,
    rationale: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE team_assignment_steps
         SET assigned_persona_id = ?1,
             assigned_use_case_id = ?2,
             match_confidence = ?3,
             match_rationale = ?4
         WHERE id = ?5",
        params![persona_id, use_case_id, confidence, rationale, step_id],
    )?;

    let assignment_id: String = tx.query_row(
        "SELECT assignment_id FROM team_assignment_steps WHERE id = ?1",
        [step_id],
        |row| row.get(0),
    )?;

    let event_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO team_assignment_events (id, assignment_id, step_id, kind, payload)
         VALUES (?1, ?2, ?3, 'step_matched', ?4)",
        params![
            event_id,
            assignment_id,
            step_id,
            serde_json::json!({
                "persona_id": persona_id,
                "use_case_id": use_case_id,
                "confidence": confidence,
                "rationale": rationale,
            }).to_string(),
        ],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn override_step_assignment(
    pool: &DbPool,
    step_id: &str,
    persona_id: &str,
    use_case_id: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    // Reset the step to pending so the orchestrator re-picks it on next tick.
    tx.execute(
        "UPDATE team_assignment_steps
         SET assigned_persona_id = ?1,
             assigned_use_case_id = ?2,
             status = 'pending',
             error_message = NULL,
             retry_count = retry_count + 1,
             execution_id = NULL
         WHERE id = ?3",
        params![persona_id, use_case_id, step_id],
    )?;

    let assignment_id: String = tx.query_row(
        "SELECT assignment_id FROM team_assignment_steps WHERE id = ?1",
        [step_id],
        |row| row.get(0),
    )?;

    let event_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO team_assignment_events (id, assignment_id, step_id, kind, payload)
         VALUES (?1, ?2, ?3, 'step_reassigned', ?4)",
        params![
            event_id,
            assignment_id,
            step_id,
            serde_json::json!({
                "persona_id": persona_id,
                "use_case_id": use_case_id,
            }).to_string(),
        ],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn edit_step_description(
    pool: &DbPool,
    step_id: &str,
    description: &str,
) -> Result<(), AppError> {
    if description.len() > MAX_STEP_DESCRIPTION_LEN {
        return Err(AppError::Validation(format!(
            "Description exceeds {MAX_STEP_DESCRIPTION_LEN} characters"
        )));
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE team_assignment_steps
         SET description = ?1,
             status = 'pending',
             error_message = NULL,
             retry_count = retry_count + 1,
             execution_id = NULL
         WHERE id = ?2",
        params![description.trim(), step_id],
    )?;

    let assignment_id: String = tx.query_row(
        "SELECT assignment_id FROM team_assignment_steps WHERE id = ?1",
        [step_id],
        |row| row.get(0),
    )?;

    let event_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO team_assignment_events (id, assignment_id, step_id, kind, payload)
         VALUES (?1, ?2, ?3, 'step_edited', ?4)",
        params![
            event_id,
            assignment_id,
            step_id,
            serde_json::json!({"description_preview": description.chars().take(80).collect::<String>()}).to_string(),
        ],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn insert_event(
    pool: &DbPool,
    assignment_id: &str,
    step_id: Option<&str>,
    kind: &str,
    payload: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let event_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO team_assignment_events (id, assignment_id, step_id, kind, payload)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![event_id, assignment_id, step_id, kind, payload],
    )?;
    Ok(())
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n = conn.execute("DELETE FROM team_assignments WHERE id = ?1", [id])?;
    Ok(n > 0)
}

// ----------------------------------------------------------------------------
// Templates (Phase C4)
// ----------------------------------------------------------------------------

fn row_to_template(row: &rusqlite::Row) -> rusqlite::Result<TeamAssignmentTemplate> {
    Ok(TeamAssignmentTemplate {
        id: row.get("id")?,
        team_id: row.get("team_id")?,
        title: row.get("title")?,
        goal: row.get("goal")?,
        match_strategy: row.get("match_strategy")?,
        max_parallel_steps: row.get("max_parallel_steps")?,
        steps_json: row.get("steps_json")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn create_template(
    pool: &DbPool,
    input: CreateTeamAssignmentTemplateInput,
) -> Result<TeamAssignmentTemplate, AppError> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Validation("Template title cannot be empty".into()));
    }
    if title.len() > MAX_TITLE_LEN {
        return Err(AppError::Validation(format!(
            "Template title exceeds {MAX_TITLE_LEN} characters"
        )));
    }
    if input.goal.trim().is_empty() {
        return Err(AppError::Validation("Template goal cannot be empty".into()));
    }
    if input.steps.is_empty() {
        return Err(AppError::Validation(
            "Template must contain at least one step".into(),
        ));
    }
    let strategy = input.match_strategy.as_deref().unwrap_or("manual");
    let max_parallel = input.max_parallel_steps.unwrap_or(3).clamp(MIN_PARALLEL, MAX_PARALLEL);
    let steps_json = serde_json::to_string(&input.steps)
        .map_err(|e| AppError::Internal(format!("Failed to serialize template steps: {e}")))?;

    let id = uuid::Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO team_assignment_templates
            (id, team_id, title, goal, match_strategy, max_parallel_steps, steps_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            input.team_id,
            title,
            input.goal.trim(),
            strategy,
            max_parallel,
            steps_json,
        ],
    )?;
    get_template(pool, &id)
}

pub fn get_template(pool: &DbPool, id: &str) -> Result<TeamAssignmentTemplate, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, team_id, title, goal, match_strategy, max_parallel_steps,
                steps_json, created_at, updated_at
         FROM team_assignment_templates WHERE id = ?1",
    )?;
    stmt.query_row([id], row_to_template).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Template '{id}' not found"))
        }
        other => AppError::Database(other),
    })
}

pub fn list_templates(
    pool: &DbPool,
    team_id: &str,
) -> Result<Vec<TeamAssignmentTemplate>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, team_id, title, goal, match_strategy, max_parallel_steps,
                steps_json, created_at, updated_at
         FROM team_assignment_templates
         WHERE team_id = ?1
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([team_id], row_to_template)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn delete_template(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n = conn.execute("DELETE FROM team_assignment_templates WHERE id = ?1", [id])?;
    Ok(n > 0)
}
