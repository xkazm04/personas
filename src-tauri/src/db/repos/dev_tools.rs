use rusqlite::{params, Row};

use crate::db::models::{
    DevContext, DevContextGroup, DevContextGroupRelationship, DevGoal, DevGoalSignal, DevIdea,
    DevProject, DevScan, DevTask, TriageRule,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_project(row: &Row) -> rusqlite::Result<DevProject> {
    Ok(DevProject {
        id: row.get("id")?,
        name: row.get("name")?,
        root_path: row.get("root_path")?,
        description: row.get("description")?,
        status: row.get("status")?,
        tech_stack: row.get("tech_stack")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_goal(row: &Row) -> rusqlite::Result<DevGoal> {
    Ok(DevGoal {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
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

fn row_to_context_group(row: &Row) -> rusqlite::Result<DevContextGroup> {
    Ok(DevContextGroup {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        icon: row.get("icon")?,
        group_type: row.get("group_type")?,
        position: row.get("position")?,
        health_score: row.get("health_score")?,
        last_scan_at: row.get("last_scan_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_context(row: &Row) -> rusqlite::Result<DevContext> {
    Ok(DevContext {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        group_id: row.get("group_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        file_paths: row.get("file_paths")?,
        entry_points: row.get("entry_points")?,
        db_tables: row.get("db_tables")?,
        keywords: row.get("keywords")?,
        api_surface: row.get("api_surface")?,
        cross_refs: row.get("cross_refs")?,
        tech_stack: row.get("tech_stack")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_context_group_relationship(row: &Row) -> rusqlite::Result<DevContextGroupRelationship> {
    Ok(DevContextGroupRelationship {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        source_group_id: row.get("source_group_id")?,
        target_group_id: row.get("target_group_id")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_idea(row: &Row) -> rusqlite::Result<DevIdea> {
    Ok(DevIdea {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        context_id: row.get("context_id")?,
        scan_type: row.get("scan_type")?,
        category: row.get("category")?,
        title: row.get("title")?,
        description: row.get("description")?,
        reasoning: row.get("reasoning")?,
        status: row.get("status")?,
        effort: row.get("effort")?,
        impact: row.get("impact")?,
        risk: row.get("risk")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        rejection_reason: row.get("rejection_reason")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_scan(row: &Row) -> rusqlite::Result<DevScan> {
    Ok(DevScan {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        scan_type: row.get("scan_type")?,
        status: row.get("status")?,
        idea_count: row.get::<_, Option<i32>>("idea_count")?.unwrap_or(0),
        input_tokens: row.get("input_tokens")?,
        output_tokens: row.get("output_tokens")?,
        duration_ms: row.get("duration_ms")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_task(row: &Row) -> rusqlite::Result<DevTask> {
    Ok(DevTask {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        source_idea_id: row.get("source_idea_id")?,
        goal_id: row.get("goal_id")?,
        status: row.get("status")?,
        session_id: row.get("session_id")?,
        progress_pct: row.get::<_, Option<i32>>("progress_pct")?.unwrap_or(0),
        output_lines: row.get::<_, Option<i32>>("output_lines")?.unwrap_or(0),
        error: row.get("error")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_triage_rule(row: &Row) -> rusqlite::Result<TriageRule> {
    Ok(TriageRule {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        conditions: row.get("conditions")?,
        action: row.get("action")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        times_fired: row.get::<_, Option<i32>>("times_fired")?.unwrap_or(0),
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Projects
// ============================================================================

pub fn list_projects(
    pool: &DbPool,
    status: Option<&str>,
) -> Result<Vec<DevProject>, AppError> {
    let conn = pool.get()?;
    if let Some(status) = status {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_projects WHERE status = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![status], row_to_project)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_projects ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_project)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

pub fn get_project_by_id(pool: &DbPool, id: &str) -> Result<DevProject, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_projects WHERE id = ?1",
        params![id],
        row_to_project,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Dev project {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_project(
    pool: &DbPool,
    name: &str,
    root_path: &str,
    description: Option<&str>,
    status: Option<&str>,
    tech_stack: Option<&str>,
) -> Result<DevProject, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    if root_path.trim().is_empty() {
        return Err(AppError::Validation("Root path cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let status = status.unwrap_or("active");

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_projects (id, name, root_path, description, status, tech_stack, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, name, root_path, description, status, tech_stack, now],
    )?;

    get_project_by_id(pool, &id)
}

pub fn update_project(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    tech_stack: Option<Option<&str>>,
) -> Result<DevProject, AppError> {
    get_project_by_id(pool, id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(name, "name", sets, param_idx);
    push_field!(description, "description", sets, param_idx);
    push_field!(status, "status", sets, param_idx);
    push_field!(tech_stack, "tech_stack", sets, param_idx);

    let sql = format!(
        "UPDATE dev_projects SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    if let Some(v) = name {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = description {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = status {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = tech_stack {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_project_by_id(pool, id)
}

pub fn delete_project(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM dev_projects WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ============================================================================
// Goals
// ============================================================================

pub fn list_goals_by_project(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevGoal>, AppError> {
    let conn = pool.get()?;
    if let Some(status) = status {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_goals WHERE project_id = ?1 AND status = ?2 ORDER BY order_index",
        )?;
        let rows = stmt.query_map(params![project_id, status], row_to_goal)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_goals WHERE project_id = ?1 ORDER BY order_index",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_goal)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

pub fn get_goal_by_id(pool: &DbPool, id: &str) -> Result<DevGoal, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_goals WHERE id = ?1",
        params![id],
        row_to_goal,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Dev goal {id}"))
        }
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
) -> Result<DevGoal, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

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

    conn.execute(
        "INSERT INTO dev_goals (id, project_id, context_id, order_index, title, description, status, target_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, project_id, context_id, order_index, title, description, status, target_date, now],
    )?;

    get_goal_by_id(pool, &id)
}

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
) -> Result<DevGoal, AppError> {
    get_goal_by_id(pool, id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(title, "title", sets, param_idx);
    push_field!(description, "description", sets, param_idx);
    push_field!(status, "status", sets, param_idx);
    push_field!(progress, "progress", sets, param_idx);
    push_field!(target_date, "target_date", sets, param_idx);
    push_field!(context_id, "context_id", sets, param_idx);
    push_field!(started_at, "started_at", sets, param_idx);
    push_field!(completed_at, "completed_at", sets, param_idx);

    let sql = format!(
        "UPDATE dev_goals SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    if let Some(v) = title {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = description {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = status {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = progress {
        param_values.push(Box::new(v));
    }
    if let Some(v) = target_date {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = context_id {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = started_at {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = completed_at {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_goal_by_id(pool, id)
}

pub fn delete_goal(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM dev_goals WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn reorder_goals(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE dev_goals SET order_index = ?1, updated_at = ?2 WHERE id = ?3",
            params![i as i32, chrono::Utc::now().to_rfc3339(), id],
        )?;
    }
    Ok(())
}

// ============================================================================
// Goal Signals
// ============================================================================

pub fn list_goal_signals(
    pool: &DbPool,
    goal_id: &str,
    limit: Option<i64>,
) -> Result<Vec<DevGoalSignal>, AppError> {
    let conn = pool.get()?;
    let limit = limit.unwrap_or(50);
    let mut stmt = conn.prepare(
        "SELECT * FROM dev_goal_signals WHERE goal_id = ?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![goal_id, limit], row_to_goal_signal)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn create_goal_signal(
    pool: &DbPool,
    goal_id: &str,
    signal_type: &str,
    source_id: Option<&str>,
    delta: Option<i32>,
    message: Option<&str>,
) -> Result<DevGoalSignal, AppError> {
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

// ============================================================================
// Context Groups
// ============================================================================

pub fn list_context_groups(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextGroup>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM dev_context_groups WHERE project_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_context_group)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn create_context_group(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    color: Option<&str>,
    icon: Option<&str>,
    group_type: Option<&str>,
) -> Result<DevContextGroup, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let color = color.unwrap_or("#6366f1");

    let conn = pool.get()?;
    let max_pos: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM dev_context_groups WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    let position = max_pos + 1;

    conn.execute(
        "INSERT INTO dev_context_groups (id, project_id, name, color, icon, group_type, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, project_id, name, color, icon, group_type, position, now],
    )?;

    conn.query_row(
        "SELECT * FROM dev_context_groups WHERE id = ?1",
        params![id],
        row_to_context_group,
    )
    .map_err(AppError::Database)
}

pub fn update_context_group(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
    icon: Option<Option<&str>>,
    group_type: Option<Option<&str>>,
    health_score: Option<Option<i32>>,
    last_scan_at: Option<Option<&str>>,
) -> Result<DevContextGroup, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(name, "name", sets, param_idx);
    push_field!(color, "color", sets, param_idx);
    push_field!(icon, "icon", sets, param_idx);
    push_field!(group_type, "group_type", sets, param_idx);
    push_field!(health_score, "health_score", sets, param_idx);
    push_field!(last_scan_at, "last_scan_at", sets, param_idx);

    let sql = format!(
        "UPDATE dev_context_groups SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    if let Some(v) = name {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = color {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = icon {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = group_type {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = health_score {
        param_values.push(Box::new(v));
    }
    if let Some(v) = last_scan_at {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    conn.query_row(
        "SELECT * FROM dev_context_groups WHERE id = ?1",
        params![id],
        row_to_context_group,
    )
    .map_err(AppError::Database)
}

pub fn delete_context_group(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM dev_context_groups WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn reorder_context_groups(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE dev_context_groups SET position = ?1, updated_at = ?2 WHERE id = ?3",
            params![i as i32, chrono::Utc::now().to_rfc3339(), id],
        )?;
    }
    Ok(())
}

// ============================================================================
// Contexts
// ============================================================================

pub fn list_contexts_by_project(
    pool: &DbPool,
    project_id: &str,
    group_id: Option<&str>,
) -> Result<Vec<DevContext>, AppError> {
    let conn = pool.get()?;
    if let Some(group_id) = group_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_contexts WHERE project_id = ?1 AND group_id = ?2 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![project_id, group_id], row_to_context)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_contexts WHERE project_id = ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_context)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

pub fn get_context_by_id(pool: &DbPool, id: &str) -> Result<DevContext, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_contexts WHERE id = ?1",
        params![id],
        row_to_context,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Dev context {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_context(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    group_id: Option<&str>,
    description: Option<&str>,
    file_paths: Option<&str>,
    entry_points: Option<&str>,
    db_tables: Option<&str>,
    keywords: Option<&str>,
    api_surface: Option<&str>,
    cross_refs: Option<&str>,
    tech_stack: Option<&str>,
) -> Result<DevContext, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let file_paths = file_paths.unwrap_or("[]");

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_contexts (id, project_id, group_id, name, description, file_paths, entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
        params![id, project_id, group_id, name, description, file_paths, entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, now],
    )?;

    get_context_by_id(pool, &id)
}

pub fn update_context(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    file_paths: Option<&str>,
    entry_points: Option<Option<&str>>,
    db_tables: Option<Option<&str>>,
    keywords: Option<Option<&str>>,
    api_surface: Option<Option<&str>>,
    cross_refs: Option<Option<&str>>,
    tech_stack: Option<Option<&str>>,
) -> Result<DevContext, AppError> {
    get_context_by_id(pool, id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(name, "name", sets, param_idx);
    push_field!(description, "description", sets, param_idx);
    push_field!(file_paths, "file_paths", sets, param_idx);
    push_field!(entry_points, "entry_points", sets, param_idx);
    push_field!(db_tables, "db_tables", sets, param_idx);
    push_field!(keywords, "keywords", sets, param_idx);
    push_field!(api_surface, "api_surface", sets, param_idx);
    push_field!(cross_refs, "cross_refs", sets, param_idx);
    push_field!(tech_stack, "tech_stack", sets, param_idx);

    let sql = format!(
        "UPDATE dev_contexts SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    if let Some(v) = name {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = description {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = file_paths {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = entry_points {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = db_tables {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = keywords {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = api_surface {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = cross_refs {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = tech_stack {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_context_by_id(pool, id)
}

pub fn delete_context(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM dev_contexts WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn move_context_to_group(
    pool: &DbPool,
    id: &str,
    group_id: Option<&str>,
) -> Result<DevContext, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE dev_contexts SET group_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![group_id, now, id],
    )?;
    get_context_by_id(pool, id)
}

// ============================================================================
// Context Group Relationships
// ============================================================================

pub fn list_context_group_relationships(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextGroupRelationship>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM dev_context_group_relationships WHERE project_id = ?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_context_group_relationship)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn create_context_group_relationship(
    pool: &DbPool,
    project_id: &str,
    source_group_id: &str,
    target_group_id: &str,
) -> Result<DevContextGroupRelationship, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_context_group_relationships (id, project_id, source_group_id, target_group_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, project_id, source_group_id, target_group_id, now],
    )?;

    conn.query_row(
        "SELECT * FROM dev_context_group_relationships WHERE id = ?1",
        params![id],
        row_to_context_group_relationship,
    )
    .map_err(AppError::Database)
}

pub fn delete_context_group_relationship(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM dev_context_group_relationships WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Ideas
// ============================================================================

pub fn list_ideas(
    pool: &DbPool,
    project_id: Option<&str>,
    status: Option<&str>,
    category: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<DevIdea>, AppError> {
    let conn = pool.get()?;
    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1u32;

    if let Some(v) = project_id {
        conditions.push(format!("project_id = ?{idx}"));
        param_values.push(Box::new(v.to_string()));
        idx += 1;
    }
    if let Some(v) = status {
        conditions.push(format!("status = ?{idx}"));
        param_values.push(Box::new(v.to_string()));
        idx += 1;
    }
    if let Some(v) = category {
        conditions.push(format!("category = ?{idx}"));
        param_values.push(Box::new(v.to_string()));
        idx += 1;
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);

    let sql = format!(
        "SELECT * FROM dev_ideas {} ORDER BY created_at DESC LIMIT ?{} OFFSET ?{}",
        where_clause, idx, idx + 1
    );

    param_values.push(Box::new(limit));
    param_values.push(Box::new(offset));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_idea)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_idea_by_id(pool: &DbPool, id: &str) -> Result<DevIdea, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_ideas WHERE id = ?1",
        params![id],
        row_to_idea,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Dev idea {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_idea(
    pool: &DbPool,
    project_id: Option<&str>,
    context_id: Option<&str>,
    scan_type: &str,
    category: Option<&str>,
    title: &str,
    description: Option<&str>,
    reasoning: Option<&str>,
    status: Option<&str>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<DevIdea, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let category = category.unwrap_or("functionality");
    let status = status.unwrap_or("pending");

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, description, reasoning, status, effort, impact, risk, provider, model, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
        params![id, project_id, context_id, scan_type, category, title, description, reasoning, status, effort, impact, risk, provider, model, now],
    )?;

    get_idea_by_id(pool, &id)
}

pub fn update_idea(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    category: Option<&str>,
    effort: Option<Option<i32>>,
    impact: Option<Option<i32>>,
    risk: Option<Option<i32>>,
    rejection_reason: Option<Option<&str>>,
) -> Result<DevIdea, AppError> {
    get_idea_by_id(pool, id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(title, "title", sets, param_idx);
    push_field!(description, "description", sets, param_idx);
    push_field!(status, "status", sets, param_idx);
    push_field!(category, "category", sets, param_idx);
    push_field!(effort, "effort", sets, param_idx);
    push_field!(impact, "impact", sets, param_idx);
    push_field!(risk, "risk", sets, param_idx);
    push_field!(rejection_reason, "rejection_reason", sets, param_idx);

    let sql = format!(
        "UPDATE dev_ideas SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    if let Some(v) = title {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = description {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = status {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = category {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = effort {
        param_values.push(Box::new(v));
    }
    if let Some(v) = impact {
        param_values.push(Box::new(v));
    }
    if let Some(v) = risk {
        param_values.push(Box::new(v));
    }
    if let Some(v) = rejection_reason {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_idea_by_id(pool, id)
}

pub fn delete_idea(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM dev_ideas WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn bulk_delete_ideas(pool: &DbPool, ids: &[String]) -> Result<usize, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let conn = pool.get()?;
    let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "DELETE FROM dev_ideas WHERE id IN ({})",
        placeholders.join(", ")
    );
    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    let rows = conn.execute(&sql, params_ref.as_slice())?;
    Ok(rows)
}

// ============================================================================
// Scans
// ============================================================================

pub fn list_scans(
    pool: &DbPool,
    project_id: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<DevScan>, AppError> {
    let conn = pool.get()?;
    let limit = limit.unwrap_or(50);
    if let Some(project_id) = project_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_scans WHERE project_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![project_id, limit], row_to_scan)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_scans ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_scan)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

pub fn get_scan_by_id(pool: &DbPool, id: &str) -> Result<DevScan, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_scans WHERE id = ?1",
        params![id],
        row_to_scan,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Dev scan {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_scan(
    pool: &DbPool,
    project_id: Option<&str>,
    scan_type: &str,
    status: Option<&str>,
) -> Result<DevScan, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let status = status.unwrap_or("running");

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_scans (id, project_id, scan_type, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, project_id, scan_type, status, now],
    )?;

    get_scan_by_id(pool, &id)
}

pub fn update_scan(
    pool: &DbPool,
    id: &str,
    status: Option<&str>,
    idea_count: Option<i32>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<Option<&str>>,
) -> Result<DevScan, AppError> {
    get_scan_by_id(pool, id)?;
    let conn = pool.get()?;

    let mut sets: Vec<String> = Vec::new();
    let mut param_idx = 1u32;

    push_field!(status, "status", sets, param_idx);
    push_field!(idea_count, "idea_count", sets, param_idx);
    push_field!(input_tokens, "input_tokens", sets, param_idx);
    push_field!(output_tokens, "output_tokens", sets, param_idx);
    push_field!(duration_ms, "duration_ms", sets, param_idx);
    push_field!(error, "error", sets, param_idx);

    if sets.is_empty() {
        return get_scan_by_id(pool, id);
    }

    let sql = format!(
        "UPDATE dev_scans SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(v) = status {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = idea_count {
        param_values.push(Box::new(v));
    }
    if let Some(v) = input_tokens {
        param_values.push(Box::new(v));
    }
    if let Some(v) = output_tokens {
        param_values.push(Box::new(v));
    }
    if let Some(v) = duration_ms {
        param_values.push(Box::new(v));
    }
    if let Some(v) = error {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_scan_by_id(pool, id)
}

// ============================================================================
// Tasks
// ============================================================================

pub fn list_tasks(
    pool: &DbPool,
    project_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<DevTask>, AppError> {
    let conn = pool.get()?;
    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1u32;

    if let Some(v) = project_id {
        conditions.push(format!("project_id = ?{idx}"));
        param_values.push(Box::new(v.to_string()));
        idx += 1;
    }
    if let Some(v) = status {
        conditions.push(format!("status = ?{idx}"));
        param_values.push(Box::new(v.to_string()));
        idx += 1;
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT * FROM dev_tasks {} ORDER BY created_at DESC",
        where_clause
    );

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_task)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_task_by_id(pool: &DbPool, id: &str) -> Result<DevTask, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_tasks WHERE id = ?1",
        params![id],
        row_to_task,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Dev task {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_task(
    pool: &DbPool,
    project_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    source_idea_id: Option<&str>,
    goal_id: Option<&str>,
    status: Option<&str>,
) -> Result<DevTask, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let status = status.unwrap_or("queued");

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, project_id, title, description, source_idea_id, goal_id, status, now],
    )?;

    get_task_by_id(pool, &id)
}

pub fn update_task(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    session_id: Option<Option<&str>>,
    progress_pct: Option<i32>,
    output_lines: Option<i32>,
    error: Option<Option<&str>>,
    started_at: Option<Option<&str>>,
    completed_at: Option<Option<&str>>,
) -> Result<DevTask, AppError> {
    get_task_by_id(pool, id)?;
    let conn = pool.get()?;

    let mut sets: Vec<String> = Vec::new();
    let mut param_idx = 1u32;

    push_field!(title, "title", sets, param_idx);
    push_field!(description, "description", sets, param_idx);
    push_field!(status, "status", sets, param_idx);
    push_field!(session_id, "session_id", sets, param_idx);
    push_field!(progress_pct, "progress_pct", sets, param_idx);
    push_field!(output_lines, "output_lines", sets, param_idx);
    push_field!(error, "error", sets, param_idx);
    push_field!(started_at, "started_at", sets, param_idx);
    push_field!(completed_at, "completed_at", sets, param_idx);

    if sets.is_empty() {
        return get_task_by_id(pool, id);
    }

    let sql = format!(
        "UPDATE dev_tasks SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(v) = title {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = description {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = status {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = session_id {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = progress_pct {
        param_values.push(Box::new(v));
    }
    if let Some(v) = output_lines {
        param_values.push(Box::new(v));
    }
    if let Some(v) = error {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = started_at {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    if let Some(v) = completed_at {
        param_values.push(Box::new(v.map(|s| s.to_string())));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_task_by_id(pool, id)
}

pub fn delete_task(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM dev_tasks WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ============================================================================
// Triage Rules
// ============================================================================

pub fn list_triage_rules(
    pool: &DbPool,
    project_id: Option<&str>,
) -> Result<Vec<TriageRule>, AppError> {
    let conn = pool.get()?;
    if let Some(project_id) = project_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_triage_rules WHERE project_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_triage_rule)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_triage_rules ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], row_to_triage_rule)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

pub fn create_triage_rule(
    pool: &DbPool,
    project_id: Option<&str>,
    name: &str,
    conditions: &str,
    action: &str,
    enabled: Option<bool>,
) -> Result<TriageRule, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let enabled = if enabled.unwrap_or(true) { 1 } else { 0 };

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_triage_rules (id, project_id, name, conditions, action, enabled, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, project_id, name, conditions, action, enabled, now],
    )?;

    conn.query_row(
        "SELECT * FROM dev_triage_rules WHERE id = ?1",
        params![id],
        row_to_triage_rule,
    )
    .map_err(AppError::Database)
}

pub fn update_triage_rule(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    conditions: Option<&str>,
    action: Option<&str>,
    enabled: Option<bool>,
    times_fired: Option<i32>,
) -> Result<TriageRule, AppError> {
    let conn = pool.get()?;

    let mut sets: Vec<String> = Vec::new();
    let mut param_idx = 1u32;

    push_field!(name, "name", sets, param_idx);
    push_field!(conditions, "conditions", sets, param_idx);
    push_field!(action, "action", sets, param_idx);
    // Handle bool -> i32 conversion for enabled
    let enabled_i32 = enabled.map(|b| if b { 1i32 } else { 0i32 });
    push_field!(enabled_i32, "enabled", sets, param_idx);
    push_field!(times_fired, "times_fired", sets, param_idx);

    if sets.is_empty() {
        return conn
            .query_row(
                "SELECT * FROM dev_triage_rules WHERE id = ?1",
                params![id],
                row_to_triage_rule,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Triage rule {id}"))
                }
                other => AppError::Database(other),
            });
    }

    let sql = format!(
        "UPDATE dev_triage_rules SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(v) = name {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = conditions {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = action {
        param_values.push(Box::new(v.to_string()));
    }
    if let Some(v) = enabled_i32 {
        param_values.push(Box::new(v));
    }
    if let Some(v) = times_fired {
        param_values.push(Box::new(v));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    conn.query_row(
        "SELECT * FROM dev_triage_rules WHERE id = ?1",
        params![id],
        row_to_triage_rule,
    )
    .map_err(AppError::Database)
}

pub fn delete_triage_rule(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM dev_triage_rules WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}
