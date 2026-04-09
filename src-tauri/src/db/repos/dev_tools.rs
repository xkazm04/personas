use rusqlite::{params, Row};

use crate::db::models::{
    DevCompetition, DevCompetitionSlot, DevContext, DevContextGroup, DevContextGroupRelationship,
    DevGoal, DevGoalDependency, DevGoalSignal, DevIdea, DevProject, DevScan, DevTask, TriageRule,
};
use crate::db::query_builder::QueryBuilder;
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
        github_url: row.get("github_url").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_goal(row: &Row) -> rusqlite::Result<DevGoal> {
    Ok(DevGoal {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        parent_goal_id: row.get("parent_goal_id")?,
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
    timed_query!("dev_projects", "dev_projects::list_projects", {
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
    })
}

pub fn get_project_by_id(pool: &DbPool, id: &str) -> Result<DevProject, AppError> {
    timed_query!("dev_projects", "dev_projects::get_project_by_id", {
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
    })
}

pub fn create_project(
    pool: &DbPool,
    name: &str,
    root_path: &str,
    description: Option<&str>,
    status: Option<&str>,
    tech_stack: Option<&str>,
    github_url: Option<&str>,
) -> Result<DevProject, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    if root_path.trim().is_empty() {
        return Err(AppError::Validation("Root path cannot be empty".into()));
    }

    timed_query!("dev_projects", "dev_projects::create_project", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let status = status.unwrap_or("active");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, description, status, tech_stack, github_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![id, name, root_path, description, status, tech_stack, github_url, now],
        )?;

        get_project_by_id(pool, &id)
    })
}

pub fn update_project(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    tech_stack: Option<Option<&str>>,
    github_url: Option<Option<&str>>,
) -> Result<DevProject, AppError> {
    timed_query!("dev_projects", "dev_projects::update_project", {
        get_project_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;

        push_field!(name, "name", sets, param_idx);
        push_field!(description, "description", sets, param_idx);
        push_field!(status, "status", sets, param_idx);
        push_field!(tech_stack, "tech_stack", sets, param_idx);
        push_field!(github_url, "github_url", sets, param_idx);

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
        if let Some(v) = github_url {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_project_by_id(pool, id)
    })
}

pub fn delete_project(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_projects", "dev_projects::delete_project", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_projects WHERE id = ?1", params![id])?;
        Ok(rows > 0)
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
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_goals WHERE project_id = ?1 ORDER BY order_index",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_goal)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
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
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Dev goal {id}"))
            }
            other => AppError::Database(other),
        })
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

        conn.execute(
            "INSERT INTO dev_goals (id, project_id, parent_goal_id, context_id, order_index, title, description, status, target_date, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![id, project_id, parent_goal_id, context_id, order_index, title, description, status, target_date, now],
        )?;

        get_goal_by_id(pool, &id)
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
) -> Result<DevGoal, AppError> {
    timed_query!("dev_goals", "dev_goals::update_goal", {
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
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
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
    timed_query!("dev_goal_signals", "dev_goal_signals::create_goal_signal", {
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
    })
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
        let rows = stmt.query_map(params![goal_id], |row| {
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

pub fn add_goal_dependency(
    pool: &DbPool,
    goal_id: &str,
    depends_on_id: &str,
    dependency_type: Option<&str>,
) -> Result<DevGoalDependency, AppError> {
    timed_query!("dev_goal_dependencies", "dev_goal_dependencies::add", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let dep_type = dependency_type.unwrap_or("blocks");
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
        let count = conn.execute("DELETE FROM dev_goal_dependencies WHERE id = ?1", params![id])?;
        Ok(count > 0)
    })
}

// ============================================================================
// Context Groups
// ============================================================================

pub fn list_context_groups(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextGroup>, AppError> {
    timed_query!("dev_context_groups", "dev_context_groups::list_context_groups", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_context_groups WHERE project_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_context_group)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
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

    timed_query!("dev_context_groups", "dev_context_groups::create_context_group", {
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
    })
}

#[allow(clippy::too_many_arguments)]
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
    timed_query!("dev_context_groups", "dev_context_groups::update_context_group", {
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
    })
}

pub fn delete_context_group(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_context_groups", "dev_context_groups::delete_context_group", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_context_groups WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

pub fn reorder_context_groups(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    timed_query!("dev_context_groups", "dev_context_groups::reorder_context_groups", {
        let conn = pool.get()?;
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE dev_context_groups SET position = ?1, updated_at = ?2 WHERE id = ?3",
                params![i as i32, chrono::Utc::now().to_rfc3339(), id],
            )?;
        }
        Ok(())
    })
}

// ============================================================================
// Contexts
// ============================================================================

pub fn list_contexts_by_project(
    pool: &DbPool,
    project_id: &str,
    group_id: Option<&str>,
) -> Result<Vec<DevContext>, AppError> {
    timed_query!("dev_contexts", "dev_contexts::list_contexts_by_project", {
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
    })
}

pub fn get_context_by_id(pool: &DbPool, id: &str) -> Result<DevContext, AppError> {
    timed_query!("dev_contexts", "dev_contexts::get_context_by_id", {
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
    })
}

#[allow(clippy::too_many_arguments)]
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

    timed_query!("dev_contexts", "dev_contexts::create_context", {
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
    })
}

#[allow(clippy::too_many_arguments)]
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
    timed_query!("dev_contexts", "dev_contexts::update_context", {
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
    })
}

pub fn delete_context(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_contexts", "dev_contexts::delete_context", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_contexts WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

pub fn move_context_to_group(
    pool: &DbPool,
    id: &str,
    group_id: Option<&str>,
) -> Result<DevContext, AppError> {
    timed_query!("dev_contexts", "dev_contexts::move_context_to_group", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_contexts SET group_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![group_id, now, id],
        )?;
        get_context_by_id(pool, id)
    })
}

/// Walk `root_path`, discover top-level directories containing source files,
/// and create one `DevContext` per directory.  Returns all newly-created contexts.
pub fn scan_codebase(
    pool: &DbPool,
    project_id: &str,
    root_path: &str,
) -> Result<Vec<DevContext>, AppError> {
    timed_query!("dev_contexts", "dev_contexts::scan_codebase", {
    use std::collections::BTreeMap;
    use std::path::Path;

    let root = Path::new(root_path).canonicalize().map_err(|e| {
        AppError::Validation(format!("Cannot resolve root path '{}': {}", root_path, e))
    })?;

    // Collect files grouped by their first sub-directory under root.
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();

    let source_exts: &[&str] = &[
        "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "rb", "css", "scss",
        "html", "vue", "svelte", "json", "toml", "yaml", "yml", "sql", "sh",
    ];

    fn visit_dir(
        dir: &Path,
        root: &Path,
        source_exts: &[&str],
        groups: &mut BTreeMap<String, Vec<String>>,
    ) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden dirs and common non-source directories.
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" || name == "build" {
                continue;
            }

            if path.is_dir() {
                visit_dir(&path, root, source_exts, groups);
            } else if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if source_exts.contains(&ext) {
                    // Key = first sub-directory under root, or "_root" for files directly in root.
                    let rel = path.strip_prefix(root).unwrap_or(&path);
                    let key = rel
                        .components()
                        .next()
                        .and_then(|c| {
                            let s = c.as_os_str().to_string_lossy().to_string();
                            // If the first component IS the file itself, it's a root-level file.
                            if rel.components().count() <= 1 { None } else { Some(s) }
                        })
                        .unwrap_or_else(|| "_root".to_string());

                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    groups.entry(key).or_default().push(rel_str);
                }
            }
        }
    }

    visit_dir(&root, &root, source_exts, &mut groups);

    let mut created: Vec<DevContext> = Vec::new();
    for (dir_name, files) in &groups {
        let context_name = if dir_name == "_root" {
            "Root Files".to_string()
        } else {
            dir_name.clone()
        };

        let file_paths_json = serde_json::to_string(files).unwrap_or_else(|_| "[]".into());
        let description = Some(format!("{} source files", files.len()));

        let ctx = create_context(
            pool,
            project_id,
            &context_name,
            None,
            description.as_deref(),
            Some(&file_paths_json),
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        created.push(ctx);
    }

    Ok(created)
    })
}

// ============================================================================
// Context Group Relationships
// ============================================================================

pub fn list_context_group_relationships(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextGroupRelationship>, AppError> {
    timed_query!("dev_context_group_relationships", "dev_context_group_relationships::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_context_group_relationships WHERE project_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_context_group_relationship)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn create_context_group_relationship(
    pool: &DbPool,
    project_id: &str,
    source_group_id: &str,
    target_group_id: &str,
) -> Result<DevContextGroupRelationship, AppError> {
    timed_query!("dev_context_group_relationships", "dev_context_group_relationships::create", {
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
    })
}

pub fn delete_context_group_relationship(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_context_group_relationships", "dev_context_group_relationships::delete", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM dev_context_group_relationships WHERE id = ?1",
            params![id],
        )?;
        Ok(rows > 0)
    })
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
    timed_query!("dev_ideas", "dev_ideas::list_ideas", {
    let conn = pool.get()?;
    let mut qb = QueryBuilder::new();

    if let Some(v) = project_id {
        qb.where_eq("project_id", v.to_string());
    }
    if let Some(v) = status {
        qb.where_eq("status", v.to_string());
    }
    if let Some(v) = category {
        qb.where_eq("category", v.to_string());
    }

    qb.order_by("created_at", "DESC");
    qb.limit(limit.unwrap_or(100));
    qb.offset(offset.unwrap_or(0));

    let sql = qb.build_select("SELECT * FROM dev_ideas");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_idea)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_idea_by_id(pool: &DbPool, id: &str) -> Result<DevIdea, AppError> {
    timed_query!("dev_ideas", "dev_ideas::get_idea_by_id", {
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
    })
}

#[allow(clippy::too_many_arguments)]
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

    timed_query!("dev_ideas", "dev_ideas::create_idea", {
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
    })
}

#[allow(clippy::too_many_arguments)]
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
    timed_query!("dev_ideas", "dev_ideas::update_idea", {
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
    })
}

pub fn delete_idea(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_ideas", "dev_ideas::delete_idea", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_ideas WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

pub fn bulk_delete_ideas(pool: &DbPool, ids: &[String]) -> Result<usize, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    timed_query!("dev_ideas", "dev_ideas::bulk_delete_ideas", {
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
    })
}

// ============================================================================
// Scans
// ============================================================================

pub fn list_scans(
    pool: &DbPool,
    project_id: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<DevScan>, AppError> {
    timed_query!("dev_scans", "dev_scans::list_scans", {
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
    })
}

pub fn get_scan_by_id(pool: &DbPool, id: &str) -> Result<DevScan, AppError> {
    timed_query!("dev_scans", "dev_scans::get_scan_by_id", {
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
    })
}

pub fn create_scan(
    pool: &DbPool,
    project_id: Option<&str>,
    scan_type: &str,
    status: Option<&str>,
) -> Result<DevScan, AppError> {
    timed_query!("dev_scans", "dev_scans::create_scan", {
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
    })
}

#[allow(clippy::too_many_arguments)]
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
    timed_query!("dev_scans", "dev_scans::update_scan", {
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
    })
}

// ============================================================================
// Tasks
// ============================================================================

pub fn list_tasks(
    pool: &DbPool,
    project_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_tasks", {
    let conn = pool.get()?;
    let mut qb = QueryBuilder::new();

    if let Some(v) = project_id {
        qb.where_eq("project_id", v.to_string());
    }
    if let Some(v) = status {
        qb.where_eq("status", v.to_string());
    }

    qb.order_by("created_at", "DESC");

    let sql = qb.build_select("SELECT * FROM dev_tasks");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_task)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_task_by_id(pool: &DbPool, id: &str) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::get_task_by_id", {
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

    timed_query!("dev_tasks", "dev_tasks::create_task", {
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
    })
}

#[allow(clippy::too_many_arguments)]
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
    timed_query!("dev_tasks", "dev_tasks::update_task", {
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
    })
}

pub fn delete_task(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_tasks", "dev_tasks::delete_task", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_tasks WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Triage Rules
// ============================================================================

pub fn list_triage_rules(
    pool: &DbPool,
    project_id: Option<&str>,
) -> Result<Vec<TriageRule>, AppError> {
    timed_query!("dev_triage_rules", "dev_triage_rules::list_triage_rules", {
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
    })
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

    timed_query!("dev_triage_rules", "dev_triage_rules::create_triage_rule", {
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
    })
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
    timed_query!("dev_triage_rules", "dev_triage_rules::update_triage_rule", {
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
    })
}

pub fn delete_triage_rule(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_triage_rules", "dev_triage_rules::delete_triage_rule", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_triage_rules WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Pipelines (Idea-to-Execution)
// ============================================================================

use crate::db::models::{DevPipeline, ContextHealthSnapshot};

fn row_to_pipeline(row: &Row) -> rusqlite::Result<DevPipeline> {
    Ok(DevPipeline {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        idea_id: row.get("idea_id")?,
        task_id: row.get("task_id")?,
        stage: row.get("stage")?,
        auto_execute: row.get::<_, i32>("auto_execute")? != 0,
        verify_after: row.get::<_, i32>("verify_after")? != 0,
        verification_scan_id: row.get("verification_scan_id")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn create_pipeline(
    pool: &DbPool,
    project_id: &str,
    idea_id: &str,
    auto_execute: bool,
    verify_after: bool,
) -> Result<DevPipeline, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::create_pipeline", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO dev_pipelines (id, project_id, idea_id, stage, auto_execute, verify_after)
             VALUES (?1, ?2, ?3, 'triaged', ?4, ?5)",
            params![id, project_id, idea_id, auto_execute as i32, verify_after as i32],
        )?;
        get_pipeline_by_id(pool, &id)
    })
}

pub fn get_pipeline_by_id(pool: &DbPool, id: &str) -> Result<DevPipeline, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::get_pipeline_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_pipelines WHERE id = ?1",
            params![id],
            row_to_pipeline,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Pipeline not found: {id}")),
            other => AppError::from(other),
        })
    })
}

pub fn list_pipelines(
    pool: &DbPool,
    project_id: &str,
    stage: Option<&str>,
) -> Result<Vec<DevPipeline>, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::list_pipelines", {
        let conn = pool.get()?;
        if let Some(s) = stage {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_pipelines WHERE project_id = ?1 AND stage = ?2 ORDER BY created_at DESC"
            )?;
            let rows = stmt.query_map(params![project_id, s], row_to_pipeline)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_pipelines WHERE project_id = ?1 ORDER BY created_at DESC"
            )?;
            let rows = stmt.query_map(params![project_id], row_to_pipeline)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        }
    })
}

pub fn advance_pipeline_stage(
    pool: &DbPool,
    id: &str,
    new_stage: &str,
    task_id: Option<&str>,
    error: Option<&str>,
) -> Result<DevPipeline, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::advance_pipeline_stage", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_pipelines SET stage = ?2, task_id = COALESCE(?3, task_id), error = ?4, updated_at = datetime('now') WHERE id = ?1",
            params![id, new_stage, task_id, error],
        )?;
        get_pipeline_by_id(pool, id)
    })
}

pub fn delete_pipeline(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::delete_pipeline", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_pipelines WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Context Health Snapshots
// ============================================================================

fn row_to_health_snapshot(row: &Row) -> rusqlite::Result<ContextHealthSnapshot> {
    Ok(ContextHealthSnapshot {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        group_id: row.get("group_id")?,
        group_name: row.get("group_name")?,
        overall_score: row.get("overall_score")?,
        security_score: row.get("security_score")?,
        quality_score: row.get("quality_score")?,
        coverage_score: row.get("coverage_score")?,
        debt_score: row.get("debt_score")?,
        issues_found: row.get("issues_found")?,
        issues_json: row.get("issues_json")?,
        recommendations: row.get("recommendations")?,
        scanned_at: row.get("scanned_at")?,
    })
}

pub fn insert_health_snapshot(pool: &DbPool, snap: &ContextHealthSnapshot) -> Result<ContextHealthSnapshot, AppError> {
    timed_query!("context_health_snapshots", "context_health_snapshots::insert", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO context_health_snapshots (id, project_id, group_id, group_name, overall_score, security_score, quality_score, coverage_score, debt_score, issues_found, issues_json, recommendations, scanned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                snap.id, snap.project_id, snap.group_id, snap.group_name,
                snap.overall_score, snap.security_score, snap.quality_score,
                snap.coverage_score, snap.debt_score, snap.issues_found,
                snap.issues_json, snap.recommendations, snap.scanned_at,
            ],
        )?;
        get_health_snapshot_by_id(pool, &snap.id)
    })
}

pub fn get_health_snapshot_by_id(pool: &DbPool, id: &str) -> Result<ContextHealthSnapshot, AppError> {
    timed_query!("context_health_snapshots", "context_health_snapshots::get_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM context_health_snapshots WHERE id = ?1",
            params![id],
            row_to_health_snapshot,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Health snapshot not found: {id}")),
            other => AppError::from(other),
        })
    })
}

pub fn list_health_snapshots(
    pool: &DbPool,
    project_id: &str,
    limit: Option<i32>,
) -> Result<Vec<ContextHealthSnapshot>, AppError> {
    timed_query!("context_health_snapshots", "context_health_snapshots::list", {
        let conn = pool.get()?;
        let lim = limit.unwrap_or(50);
        let mut stmt = conn.prepare(
            "SELECT * FROM context_health_snapshots WHERE project_id = ?1 ORDER BY scanned_at DESC LIMIT ?2"
        )?;
        let rows = stmt.query_map(params![project_id, lim], row_to_health_snapshot)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    })
}

// ============================================================================
// Cross-Project (Codebases connector)
// ============================================================================

use crate::db::models::{
    CrossProjectRelation, PortfolioHealthSummary, ProjectHealthEntry,
    TechRadarEntry, RiskMatrixEntry,
};

fn row_to_cross_relation(row: &Row) -> rusqlite::Result<CrossProjectRelation> {
    Ok(CrossProjectRelation {
        id: row.get("id")?,
        source_project_id: row.get("source_project_id")?,
        target_project_id: row.get("target_project_id")?,
        relation_type: row.get("relation_type")?,
        details: row.get("details")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_cross_project_relations(pool: &DbPool) -> Result<Vec<CrossProjectRelation>, AppError> {
    timed_query!("cross_project_relations", "cross_project_relations::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM cross_project_relations ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_cross_relation)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    })
}

pub fn upsert_cross_project_relation(
    pool: &DbPool,
    source_project_id: &str,
    target_project_id: &str,
    relation_type: &str,
    details: Option<&str>,
) -> Result<CrossProjectRelation, AppError> {
    timed_query!("cross_project_relations", "cross_project_relations::upsert", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO cross_project_relations (id, source_project_id, target_project_id, relation_type, details, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(source_project_id, target_project_id, relation_type)
             DO UPDATE SET details = ?5, updated_at = ?6",
            params![id, source_project_id, target_project_id, relation_type, details, now],
        )?;
        // Return the upserted row
        conn.query_row(
            "SELECT * FROM cross_project_relations WHERE source_project_id = ?1 AND target_project_id = ?2 AND relation_type = ?3",
            params![source_project_id, target_project_id, relation_type],
            row_to_cross_relation,
        )
        .map_err(AppError::from)
    })
}

pub fn delete_cross_project_relations_for_project(pool: &DbPool, project_id: &str) -> Result<usize, AppError> {
    timed_query!("cross_project_relations", "cross_project_relations::delete_for_project", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM cross_project_relations WHERE source_project_id = ?1 OR target_project_id = ?1",
            params![project_id],
        )?;
        Ok(rows)
    })
}

/// Bulk create ideas across multiple projects in a single transaction.
#[allow(clippy::type_complexity)]
pub fn bulk_create_ideas_cross_project(
    pool: &DbPool,
    ideas: &[(Option<&str>, Option<&str>, &str, &str, &str, Option<&str>, Option<i32>, Option<i32>, Option<i32>)],
    // Each tuple: (project_id, context_id, scan_type, category, title, description, effort, impact, risk)
) -> Result<Vec<DevIdea>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::bulk_create_ideas_cross_project", {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut created = Vec::with_capacity(ideas.len());

    for &(project_id, context_id, scan_type, category, title, description, effort, impact, risk) in ideas {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, description, status, effort, impact, risk, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?11, ?11)",
            params![id, project_id, context_id, scan_type, category, title, description, effort, impact, risk, now],
        )?;
        created.push(DevIdea {
            id,
            project_id: project_id.map(|s| s.to_string()),
            context_id: context_id.map(|s| s.to_string()),
            scan_type: scan_type.to_string(),
            category: category.to_string(),
            title: title.to_string(),
            description: description.map(|s| s.to_string()),
            reasoning: None,
            status: "pending".to_string(),
            effort,
            impact,
            risk,
            provider: None,
            model: None,
            rejection_reason: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }
    Ok(created)
    })
}

/// Build portfolio health summary across all projects.
pub fn get_portfolio_health(pool: &DbPool) -> Result<PortfolioHealthSummary, AppError> {
    timed_query!("dev_projects", "dev_projects::get_portfolio_health", {
    let conn = pool.get()?;

    let total_projects: i32 = conn.query_row("SELECT COUNT(*) FROM dev_projects", [], |r| r.get(0))?;
    let active_projects: i32 = conn.query_row("SELECT COUNT(*) FROM dev_projects WHERE status = 'active'", [], |r| r.get(0))?;
    let total_ideas: i32 = conn.query_row("SELECT COUNT(*) FROM dev_ideas", [], |r| r.get(0))?;
    let pending_ideas: i32 = conn.query_row("SELECT COUNT(*) FROM dev_ideas WHERE status = 'pending'", [], |r| r.get(0))?;
    let total_tasks: i32 = conn.query_row("SELECT COUNT(*) FROM dev_tasks", [], |r| r.get(0))?;
    let running_tasks: i32 = conn.query_row("SELECT COUNT(*) FROM dev_tasks WHERE status = 'running'", [], |r| r.get(0))?;

    let avg_health_score: Option<f64> = conn.query_row(
        "SELECT AVG(overall_score) FROM (
            SELECT project_id, overall_score, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY scanned_at DESC) AS rn
            FROM context_health_snapshots
         ) WHERE rn = 1",
        [],
        |r| r.get(0),
    ).unwrap_or(None);

    let mut projects = Vec::new();
    let mut stmt = conn.prepare("SELECT * FROM dev_projects ORDER BY name")?;
    let project_rows = stmt.query_map([], row_to_project)?;
    for project_result in project_rows {
        let p = project_result?;
        let context_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_contexts WHERE project_id = ?1", params![p.id], |r| r.get(0)
        )?;
        let idea_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1", params![p.id], |r| r.get(0)
        )?;
        let task_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_tasks WHERE project_id = ?1", params![p.id], |r| r.get(0)
        )?;
        let latest_health_score: Option<i32> = conn.query_row(
            "SELECT overall_score FROM context_health_snapshots WHERE project_id = ?1 ORDER BY scanned_at DESC LIMIT 1",
            params![p.id], |r| r.get(0),
        ).ok();
        let open_risk_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND status = 'pending' AND risk >= 7",
            params![p.id], |r| r.get(0),
        )?;

        projects.push(ProjectHealthEntry {
            project_id: p.id,
            project_name: p.name,
            status: p.status,
            tech_stack: p.tech_stack,
            context_count,
            idea_count,
            task_count,
            latest_health_score,
            open_risk_count,
        });
    }

    Ok(PortfolioHealthSummary {
        total_projects,
        active_projects,
        total_ideas,
        pending_ideas,
        total_tasks,
        running_tasks,
        avg_health_score,
        projects,
    })
    })
}

/// Build tech radar by aggregating tech_stack across all projects.
pub fn get_tech_radar(pool: &DbPool) -> Result<Vec<TechRadarEntry>, AppError> {
    timed_query!("dev_projects", "dev_projects::get_tech_radar", {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT id, name, tech_stack FROM dev_projects WHERE tech_stack IS NOT NULL AND tech_stack != ''")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>("id")?,
            row.get::<_, String>("name")?,
            row.get::<_, String>("tech_stack")?,
        ))
    })?;

    // Accumulate: tech -> list of project names
    let mut tech_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for row_result in rows {
        let (_id, name, stack) = row_result?;
        for tech in stack.split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
            tech_map.entry(tech).or_default().push(name.clone());
        }
    }

    let total_projects: i32 = conn.query_row("SELECT COUNT(*) FROM dev_projects", [], |r| r.get(0))?;

    let mut entries: Vec<TechRadarEntry> = tech_map.into_iter().map(|(tech, names)| {
        let count = names.len() as i32;
        let category = categorize_tech(&tech);
        let status = if count as f64 / total_projects.max(1) as f64 > 0.6 {
            "adopt"
        } else if count > 1 {
            "trial"
        } else {
            "assess"
        };
        TechRadarEntry {
            technology: tech,
            category: category.to_string(),
            project_count: count,
            project_names: names,
            status: status.to_string(),
        }
    }).collect();

    entries.sort_by(|a, b| b.project_count.cmp(&a.project_count));
    Ok(entries)
    })
}

/// Simple heuristic to categorize a technology string.
fn categorize_tech(tech: &str) -> &'static str {
    match tech {
        "rust" | "python" | "typescript" | "javascript" | "go" | "java" | "c#" | "ruby" | "swift" | "kotlin" => "language",
        "react" | "vue" | "angular" | "svelte" | "next.js" | "nuxt" | "fastapi" | "express" | "django" | "rails" | "actix" | "axum" | "tauri" => "framework",
        "postgres" | "postgresql" | "mysql" | "sqlite" | "mongodb" | "redis" | "dynamodb" | "supabase" | "neon" | "planetscale" => "database",
        "docker" | "kubernetes" | "terraform" | "github actions" | "circleci" | "vercel" | "netlify" | "aws" | "gcp" | "azure" => "tool",
        _ => "library",
    }
}

/// Build risk matrix by analyzing multiple risk dimensions across projects.
pub fn get_risk_matrix(pool: &DbPool) -> Result<Vec<RiskMatrixEntry>, AppError> {
    timed_query!("dev_projects", "dev_projects::get_risk_matrix", {
    let conn = pool.get()?;
    let mut risks = Vec::new();

    let mut stmt = conn.prepare("SELECT * FROM dev_projects WHERE status = 'active' ORDER BY name")?;
    let project_rows = stmt.query_map([], row_to_project)?;

    for project_result in project_rows {
        let p = project_result?;

        // Check for high-risk pending ideas
        let high_risk_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND status = 'pending' AND risk >= 8",
            params![p.id], |r| r.get(0),
        )?;
        if high_risk_count > 0 {
            let affected: Vec<String> = {
                let mut s = conn.prepare(
                    "SELECT DISTINCT c.name FROM dev_ideas i JOIN dev_contexts c ON i.context_id = c.id WHERE i.project_id = ?1 AND i.status = 'pending' AND i.risk >= 8"
                )?;
                let rows = s.query_map(params![p.id], |r| r.get::<_, String>(0))?;
                rows.filter_map(|r| r.ok()).collect()
            };
            risks.push(RiskMatrixEntry {
                project_id: p.id.clone(),
                project_name: p.name.clone(),
                risk_category: "security".to_string(),
                severity: if high_risk_count > 3 { "critical" } else { "high" }.to_string(),
                description: format!("{} high-risk ideas pending review", high_risk_count),
                affected_contexts: affected,
            });
        }

        // Check for stale projects (no scans in 30 days)
        let latest_scan: Option<String> = conn.query_row(
            "SELECT MAX(created_at) FROM dev_scans WHERE project_id = ?1",
            params![p.id], |r| r.get(0),
        ).unwrap_or(None);
        let is_stale = match &latest_scan {
            Some(ts) => {
                if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(ts) {
                    chrono::Utc::now().signed_duration_since(parsed).num_days() > 30
                } else {
                    true
                }
            }
            None => true,
        };
        if is_stale {
            risks.push(RiskMatrixEntry {
                project_id: p.id.clone(),
                project_name: p.name.clone(),
                risk_category: "stale_project".to_string(),
                severity: "medium".to_string(),
                description: match &latest_scan {
                    Some(ts) => format!("Last scan: {}", &ts[..10]),
                    None => "Never scanned".to_string(),
                },
                affected_contexts: vec![],
            });
        }

        // Check for tech debt accumulation
        let debt_ideas: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND scan_type = 'tech-debt-tracker' AND status = 'pending'",
            params![p.id], |r| r.get(0),
        )?;
        if debt_ideas > 5 {
            risks.push(RiskMatrixEntry {
                project_id: p.id.clone(),
                project_name: p.name.clone(),
                risk_category: "tech_debt".to_string(),
                severity: if debt_ideas > 15 { "high" } else { "medium" }.to_string(),
                description: format!("{} unaddressed tech debt items", debt_ideas),
                affected_contexts: vec![],
            });
        }
    }

    risks.sort_by(|a, b| {
        let sev_order = |s: &str| match s { "critical" => 0, "high" => 1, "medium" => 2, _ => 3 };
        sev_order(&a.severity).cmp(&sev_order(&b.severity))
    });

    Ok(risks)
    })
}

// ============================================================================
// Dev Competitions (multi-clone parallel task execution)
// ============================================================================

fn row_to_competition(row: &Row) -> rusqlite::Result<DevCompetition> {
    Ok(DevCompetition {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        task_title: row.get("task_title")?,
        task_description: row.get("task_description")?,
        source_idea_id: row.get("source_idea_id")?,
        source_goal_id: row.get("source_goal_id")?,
        slot_count: row.get("slot_count")?,
        status: row.get("status")?,
        winner_task_id: row.get("winner_task_id")?,
        winner_insight: row.get::<_, Option<String>>("winner_insight").ok().flatten(),
        baseline_json: row.get::<_, Option<String>>("baseline_json").ok().flatten(),
        reviewer_notes: row.get("reviewer_notes")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

fn row_to_competition_slot(row: &Row) -> rusqlite::Result<DevCompetitionSlot> {
    Ok(DevCompetitionSlot {
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
}

pub fn create_competition(
    pool: &DbPool,
    project_id: &str,
    task_title: &str,
    task_description: Option<&str>,
    source_idea_id: Option<&str>,
    source_goal_id: Option<&str>,
    slot_count: i32,
) -> Result<DevCompetition, AppError> {
    if task_title.trim().is_empty() {
        return Err(AppError::Validation("Competition title cannot be empty".into()));
    }
    if !(2..=4).contains(&slot_count) {
        return Err(AppError::Validation("slot_count must be 2..=4".into()));
    }
    timed_query!("dev_competitions", "dev_competitions::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_competitions (id, project_id, task_title, task_description, source_idea_id, source_goal_id, slot_count, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8)",
            params![id, project_id, task_title, task_description, source_idea_id, source_goal_id, slot_count, now],
        )?;
        get_competition_by_id(pool, &id)
    })
}

pub fn get_competition_by_id(pool: &DbPool, id: &str) -> Result<DevCompetition, AppError> {
    timed_query!("dev_competitions", "dev_competitions::get", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_competitions WHERE id = ?1",
            params![id],
            row_to_competition,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Competition {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn list_competitions_by_project(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevCompetition>, AppError> {
    timed_query!("dev_competitions", "dev_competitions::list", {
        let conn = pool.get()?;
        let rows: Vec<DevCompetition> = if let Some(s) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_competitions WHERE project_id = ?1 AND status = ?2 ORDER BY created_at DESC",
            )?;
            let result = stmt.query_map(params![project_id, s], row_to_competition)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            result
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_competitions WHERE project_id = ?1 ORDER BY created_at DESC",
            )?;
            let result = stmt.query_map(params![project_id], row_to_competition)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            result
        };
        Ok(rows)
    })
}

pub fn update_competition_status(
    pool: &DbPool,
    id: &str,
    status: &str,
    winner_task_id: Option<&str>,
    reviewer_notes: Option<&str>,
    winner_insight: Option<&str>,
) -> Result<DevCompetition, AppError> {
    timed_query!("dev_competitions", "dev_competitions::update_status", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let is_final = matches!(status, "resolved" | "cancelled");
        conn.execute(
            "UPDATE dev_competitions SET status = ?1, winner_task_id = COALESCE(?2, winner_task_id),
             reviewer_notes = COALESCE(?3, reviewer_notes),
             winner_insight = COALESCE(?4, winner_insight),
             resolved_at = CASE WHEN ?5 = 1 THEN ?6 ELSE resolved_at END
             WHERE id = ?7",
            params![status, winner_task_id, reviewer_notes, winner_insight, is_final as i32, now, id],
        )?;
        get_competition_by_id(pool, id)
    })
}

/// Persist diff analysis for a slot. Pass None for disqualify_reason to clear it.
pub fn update_slot_diff_analysis(
    pool: &DbPool,
    slot_id: &str,
    diff_hash: Option<&str>,
    diff_stats_json: Option<&str>,
    disqualified: bool,
    disqualify_reason: Option<&str>,
) -> Result<DevCompetitionSlot, AppError> {
    timed_query!("dev_competition_slots", "dev_competition_slots::update_diff", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_competition_slots SET
                diff_hash = ?1,
                diff_stats_json = ?2,
                disqualified = ?3,
                disqualify_reason = ?4,
                diff_analyzed_at = ?5
             WHERE id = ?6",
            params![diff_hash, diff_stats_json, disqualified as i32, disqualify_reason, now, slot_id],
        )?;
        conn.query_row(
            "SELECT * FROM dev_competition_slots WHERE id = ?1",
            params![slot_id],
            row_to_competition_slot,
        )
        .map_err(AppError::Database)
    })
}

/// Aggregate per-strategy win/loss/DQ stats across all resolved competitions in a project.
pub fn get_strategy_leaderboard(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<crate::db::models::DevStrategyStats>, AppError> {
    use crate::db::models::DevStrategyStats;
    timed_query!("dev_competition_slots", "dev_competition_slots::leaderboard", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT
                s.strategy_label,
                SUM(CASE WHEN c.winner_task_id = s.task_id THEN 1 ELSE 0 END) AS wins,
                COUNT(*) AS total,
                SUM(CASE WHEN s.disqualified = 1 THEN 1 ELSE 0 END) AS dq_count,
                MAX(CASE WHEN c.winner_task_id = s.task_id THEN c.resolved_at ELSE NULL END) AS last_win_at
             FROM dev_competition_slots s
             JOIN dev_competitions c ON c.id = s.competition_id
             WHERE c.project_id = ?1 AND c.status = 'resolved'
             GROUP BY s.strategy_label
             ORDER BY wins DESC, total DESC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            let wins: i32 = row.get("wins")?;
            let total: i32 = row.get("total")?;
            let dq: i32 = row.get("dq_count")?;
            Ok(DevStrategyStats {
                label: row.get("strategy_label")?,
                wins,
                total,
                disqualified_count: dq,
                win_rate: if total > 0 { wins as f64 / total as f64 } else { 0.0 },
                last_win_at: row.get::<_, Option<String>>("last_win_at").ok().flatten(),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn create_competition_slot(
    pool: &DbPool,
    competition_id: &str,
    task_id: &str,
    strategy_label: &str,
    strategy_prompt: Option<&str>,
    worktree_name: &str,
    slot_index: i32,
) -> Result<DevCompetitionSlot, AppError> {
    timed_query!("dev_competition_slots", "dev_competition_slots::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_competition_slots (id, competition_id, task_id, strategy_label, strategy_prompt, worktree_name, slot_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, competition_id, task_id, strategy_label, strategy_prompt, worktree_name, slot_index, now],
        )?;
        conn.query_row(
            "SELECT * FROM dev_competition_slots WHERE id = ?1",
            params![id],
            row_to_competition_slot,
        )
        .map_err(AppError::Database)
    })
}

pub fn list_competition_slots(
    pool: &DbPool,
    competition_id: &str,
) -> Result<Vec<DevCompetitionSlot>, AppError> {
    timed_query!("dev_competition_slots", "dev_competition_slots::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_competition_slots WHERE competition_id = ?1 ORDER BY slot_index ASC",
        )?;
        let rows = stmt.query_map(params![competition_id], row_to_competition_slot)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}
