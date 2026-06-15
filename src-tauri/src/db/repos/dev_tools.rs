use std::collections::{HashMap, HashSet};

use rusqlite::{params, OptionalExtension, Row};

use crate::db::models::{
    AttentionItem, AttentionQueue, DevCompetition, DevCompetitionSlot, DevContext, DevContextGroup,
    DevContextGroupRelationship, DevGoal, DevGoalDependency, DevGoalItem, DevGoalSignal, DevKpi, DevKpiBinding, DevKpiMeasurement, DevIdea,
    DevProject, DevScan, DevStandard, DevTask, GoalProgressSuggestion, PortfolioProjectSummary,
    PortfolioSummary, TriageRule,
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
        monitoring_credential_id: row.get("monitoring_credential_id").unwrap_or(None),
        monitoring_project_slug: row.get("monitoring_project_slug").unwrap_or(None),
        static_scan_config: row.get("static_scan_config").unwrap_or(None),
        auto_pr_on_success: row
            .get::<_, Option<i64>>("auto_pr_on_success")
            .unwrap_or(None)
            .map(|v| v != 0)
            .unwrap_or(false),
        pr_credential_id: row.get("pr_credential_id").unwrap_or(None),
        test_env_url: row.get("test_env_url").unwrap_or(None),
        test_env_branch: row.get("test_env_branch").unwrap_or(None),
        main_branch: row.get("main_branch").unwrap_or(None),
        standards_config: row.get("standards_config").unwrap_or(None),
        team_id: row.get("team_id").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_goal(row: &Row) -> rusqlite::Result<DevGoal> {
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

fn row_to_context_group(row: &Row) -> rusqlite::Result<DevContextGroup> {
    Ok(DevContextGroup {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        icon: row.get("icon")?,
        group_type: row.get("group_type")?,
        domain: row.get("domain").unwrap_or(None),
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
        category: row.get("category").unwrap_or(None),
        business_feature: row.get("business_feature").unwrap_or(None),
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
        priority: row.get("priority")?,
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
        depth: row
            .get::<_, Option<String>>("depth")?
            .unwrap_or_else(|| "quick".to_string()),
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

pub fn list_projects(pool: &DbPool, status: Option<&str>) -> Result<Vec<DevProject>, AppError> {
    timed_query!("dev_projects", "dev_projects::list_projects", {
        let conn = pool.get()?;
        if let Some(status) = status {
            let mut stmt = conn
                .prepare("SELECT * FROM dev_projects WHERE status = ?1 ORDER BY updated_at DESC")?;
            let rows = stmt.query_map(params![status], row_to_project)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt = conn.prepare("SELECT * FROM dev_projects ORDER BY updated_at DESC")?;
            let rows = stmt.query_map([], row_to_project)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
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
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev project {id}")),
            other => AppError::Database(other),
        })
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_project(
    pool: &DbPool,
    name: &str,
    root_path: &str,
    description: Option<&str>,
    status: Option<&str>,
    tech_stack: Option<&str>,
    github_url: Option<&str>,
    team_id: Option<&str>,
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
            "INSERT INTO dev_projects (id, name, root_path, description, status, tech_stack, github_url, team_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, name, root_path, description, status, tech_stack, github_url, team_id, now],
        )?;

        get_project_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_project(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    tech_stack: Option<Option<&str>>,
    github_url: Option<Option<&str>>,
    monitoring_credential_id: Option<Option<&str>>,
    monitoring_project_slug: Option<Option<&str>>,
    team_id: Option<Option<&str>>,
    pr_credential_id: Option<Option<&str>>,
    test_env_url: Option<Option<&str>>,
    test_env_branch: Option<Option<&str>>,
    main_branch: Option<Option<&str>>,
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
        push_field!(
            monitoring_credential_id,
            "monitoring_credential_id",
            sets,
            param_idx
        );
        push_field!(
            monitoring_project_slug,
            "monitoring_project_slug",
            sets,
            param_idx
        );
        push_field!(team_id, "team_id", sets, param_idx);
        push_field!(pr_credential_id, "pr_credential_id", sets, param_idx);
        push_field!(test_env_url, "test_env_url", sets, param_idx);
        push_field!(test_env_branch, "test_env_branch", sets, param_idx);
        push_field!(main_branch, "main_branch", sets, param_idx);

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
        if let Some(v) = monitoring_credential_id {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = monitoring_project_slug {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = team_id {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = pr_credential_id {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = test_env_url {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = test_env_branch {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = main_branch {
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

/// Set or clear the static-analysis CLI config JSON for a project. The shape
/// is opaque to the repo — see `commands/infrastructure/static_scan.rs::ToolConfig`.
/// Pass `None` to clear (disables the per-project static sweep).
pub fn update_static_scan_config(
    pool: &DbPool,
    id: &str,
    config_json: Option<&str>,
) -> Result<DevProject, AppError> {
    timed_query!("dev_projects", "dev_projects::update_static_scan_config", {
        get_project_by_id(pool, id)?;
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_projects SET static_scan_config = ?1, updated_at = ?2 WHERE id = ?3",
            params![config_json, now, id],
        )?;
        get_project_by_id(pool, id)
    })
}

/// Set or clear the standards & branching policy JSON for a project
/// (Pipeline Stage 3). Shape is opaque to the repo — the frontend owns it
/// (`{ precommit, branching }`). Pass `None` to clear.
pub fn update_standards_config(
    pool: &DbPool,
    id: &str,
    config_json: Option<&str>,
) -> Result<DevProject, AppError> {
    timed_query!("dev_projects", "dev_projects::update_standards_config", {
        get_project_by_id(pool, id)?;
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_projects SET standards_config = ?1, updated_at = ?2 WHERE id = ?3",
            params![config_json, now, id],
        )?;
        get_project_by_id(pool, id)
    })
}

// ============================================================================
// Dev Standards (Pipeline Stage 3b — golden-standard scan findings)
// ============================================================================

fn row_to_standard(row: &Row) -> rusqlite::Result<DevStandard> {
    Ok(DevStandard {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        scan_id: row.get("scan_id").unwrap_or(None),
        rule_key: row.get("rule_key")?,
        category: row.get("category")?,
        title: row.get("title")?,
        status: row.get("status")?,
        severity: row.get("severity")?,
        evidence: row.get("evidence").unwrap_or(None),
        recommendation: row.get("recommendation").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_standard(
    pool: &DbPool,
    project_id: &str,
    scan_id: Option<&str>,
    rule_key: &str,
    category: &str,
    title: &str,
    status: &str,
    severity: &str,
    evidence: Option<&str>,
    recommendation: Option<&str>,
) -> Result<DevStandard, AppError> {
    timed_query!("dev_standards", "dev_standards::create_standard", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_standards (id, project_id, scan_id, rule_key, category, title, status, severity, evidence, recommendation, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![id, project_id, scan_id, rule_key, category, title, status, severity, evidence, recommendation, now],
        )?;
        conn.query_row("SELECT * FROM dev_standards WHERE id = ?1", params![id], row_to_standard)
            .map_err(Into::into)
    })
}

pub fn list_standards_by_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevStandard>, AppError> {
    timed_query!("dev_standards", "dev_standards::list_standards_by_project", {
        let conn = pool.get()?;
        let mut stmt = conn
            .prepare("SELECT * FROM dev_standards WHERE project_id = ?1 ORDER BY category, rule_key")?;
        let rows = stmt.query_map(params![project_id], row_to_standard)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn clear_standards_for_project(pool: &DbPool, project_id: &str) -> Result<usize, AppError> {
    timed_query!("dev_standards", "dev_standards::clear_standards_for_project", {
        let conn = pool.get()?;
        let n = conn.execute(
            "DELETE FROM dev_standards WHERE project_id = ?1",
            params![project_id],
        )?;
        Ok(n)
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

fn row_to_goal_item(row: &Row) -> rusqlite::Result<DevGoalItem> {
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
        let mut stmt = conn
            .prepare("SELECT * FROM dev_goal_items WHERE goal_id = ?1 ORDER BY order_index")?;
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
        let config = serde_json::json!({ "scenario": scenario.trim(), "url": url })
            .to_string();
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
        let mut stmt = conn
            .prepare("SELECT * FROM dev_goals WHERE parent_goal_id = ?1 ORDER BY order_index")?;
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
        "done" | "completed" | "complete" | "skipped" => "done",
        _ => "open",
    }
}

/// Not terminal — counts as active work (drives at-risk / portfolio rollups).
pub fn goal_status_is_ongoing(status: &str) -> bool {
    normalize_goal_status(status) != "done"
}

// ============================================================================
// Goals v2 — cross-project queries (Portfolio / Attention / Timeline / Map)
// ============================================================================

/// Every goal across all projects (project → order_index). Backs the Portfolio
/// + Timeline surfaces; the frontend joins with the project list it already holds.
pub fn list_all_goals(pool: &DbPool) -> Result<Vec<DevGoal>, AppError> {
    timed_query!("dev_goals", "dev_goals::list_all_goals", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare("SELECT * FROM dev_goals ORDER BY project_id, order_index")?;
        let rows = stmt.query_map([], row_to_goal)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// All dependency edges whose goal lives in the given project — one query
/// instead of the per-goal fan-out the Map used in v1.
pub fn list_goal_dependencies_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevGoalDependency>, AppError> {
    timed_query!(
        "dev_goal_dependencies",
        "dev_goal_dependencies::list_for_project",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT d.id, d.goal_id, d.depends_on_id, d.dependency_type, d.created_at
                 FROM dev_goal_dependencies d
                 JOIN dev_goals g ON g.id = d.goal_id
                 WHERE g.project_id = ?1",
            )?;
            let rows = stmt
                .query_map(params![project_id], |row| {
                    Ok(DevGoalDependency {
                        id: row.get("id")?,
                        goal_id: row.get("goal_id")?,
                        depends_on_id: row.get("depends_on_id")?,
                        dependency_type: row.get("dependency_type")?,
                        created_at: row.get("created_at")?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
}

/// Every checklist item across one project's goals — one query instead of the
/// per-goal fan-out the Board would otherwise do for ~100 cards. Ordered by
/// goal then order_index so the frontend can group by `goal_id` in a single pass.
pub fn list_goal_items_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevGoalItem>, AppError> {
    timed_query!("dev_goal_items", "dev_goal_items::list_for_project", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT i.id, i.goal_id, i.title, i.done, i.order_index, i.created_at, i.updated_at
             FROM dev_goal_items i
             JOIN dev_goals g ON g.id = i.goal_id
             WHERE g.project_id = ?1
             ORDER BY i.goal_id, i.order_index",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_goal_item)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Cross-project health rollup. One pass over all goals + projects — no N+1.
/// `at_risk` = ongoing goals that are overdue (target_date past) or stalled
/// (untouched ≥ 7 days, by `updated_at`, and not already overdue).
pub fn portfolio_summary(pool: &DbPool) -> Result<PortfolioSummary, AppError> {
    let projects = list_projects(pool, None)?;
    let goals = list_all_goals(pool)?;
    let now = chrono::Utc::now();
    let now_s = now.to_rfc3339();
    let stale_before = (now - chrono::Duration::days(7)).to_rfc3339();

    // Accumulator per project, seeded so projects with zero goals still appear.
    struct Acc {
        name: String,
        team_id: Option<String>,
        total: i32,
        open: i32,
        in_progress: i32,
        blocked: i32,
        done: i32,
        overdue: i32,
        stalled: i32,
        progress_sum: i64,
    }
    let mut acc: HashMap<String, Acc> = HashMap::new();
    for p in &projects {
        acc.insert(
            p.id.clone(),
            Acc {
                name: p.name.clone(),
                team_id: p.team_id.clone(),
                total: 0,
                open: 0,
                in_progress: 0,
                blocked: 0,
                done: 0,
                overdue: 0,
                stalled: 0,
                progress_sum: 0,
            },
        );
    }

    for g in &goals {
        let Some(a) = acc.get_mut(&g.project_id) else { continue };
        a.total += 1;
        a.progress_sum += g.progress as i64;
        match normalize_goal_status(&g.status) {
            "in-progress" => a.in_progress += 1,
            "blocked" => a.blocked += 1,
            "done" => a.done += 1,
            _ => a.open += 1,
        }
        if goal_status_is_ongoing(&g.status) {
            let overdue = g.target_date.as_deref().is_some_and(|d| d < now_s.as_str());
            if overdue {
                a.overdue += 1;
            } else if g.updated_at.as_str() < stale_before.as_str() {
                a.stalled += 1;
            }
        }
    }

    let mut summaries: Vec<PortfolioProjectSummary> = acc
        .into_iter()
        .map(|(id, a)| PortfolioProjectSummary {
            project_id: id,
            project_name: a.name,
            team_id: a.team_id,
            total: a.total,
            open: a.open,
            in_progress: a.in_progress,
            blocked: a.blocked,
            done: a.done,
            at_risk: a.overdue + a.stalled,
            overdue: a.overdue,
            avg_progress: if a.total > 0 {
                (a.progress_sum / a.total as i64) as i32
            } else {
                0
            },
        })
        .collect();
    // Busiest projects first; at-risk breaks ties so trouble floats up.
    summaries.sort_by(|x, y| {
        y.total
            .cmp(&x.total)
            .then(y.at_risk.cmp(&x.at_risk))
            .then(x.project_name.cmp(&y.project_name))
    });

    let total_goals: i32 = summaries.iter().map(|s| s.total).sum();
    let progress_total: i64 = goals.iter().map(|g| g.progress as i64).sum();
    Ok(PortfolioSummary {
        total_open: summaries.iter().map(|s| s.open).sum(),
        total_in_progress: summaries.iter().map(|s| s.in_progress).sum(),
        total_blocked: summaries.iter().map(|s| s.blocked).sum(),
        total_done: summaries.iter().map(|s| s.done).sum(),
        total_at_risk: summaries.iter().map(|s| s.at_risk).sum(),
        avg_progress: if total_goals > 0 {
            (progress_total / total_goals as i64) as i32
        } else {
            0
        },
        total_goals,
        projects: summaries,
    })
}

/// Cross-project "needs you" queue. Four kinds, ranked: awaiting_review team
/// steps (0) → overdue goals (1) → stalled goals (2) → unstaffed goals (3).
pub fn attention_queue(pool: &DbPool) -> Result<AttentionQueue, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now();
    let now_s = now.to_rfc3339();
    let stale_before = (now - chrono::Duration::days(7)).to_rfc3339();
    let mut items: Vec<AttentionItem> = Vec::new();

    // 1) Team-assignment steps awaiting review (goal-linked only).
    {
        let mut stmt = conn.prepare(
            "SELECT s.id AS step_id, s.title AS step_title, a.id AS assignment_id,
                    g.id AS goal_id, g.title AS goal_title, g.status AS goal_status,
                    g.progress AS goal_progress, p.id AS project_id, p.name AS project_name
             FROM team_assignment_steps s
             JOIN team_assignments a ON a.id = s.assignment_id
             JOIN dev_goals g ON g.id = a.goal_id
             JOIN dev_projects p ON p.id = g.project_id
             WHERE s.status = 'awaiting_review'
             ORDER BY s.started_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AttentionItem {
                    kind: "awaiting_review".into(),
                    goal_id: row.get("goal_id")?,
                    goal_title: row.get("goal_title")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                    status: row.get("goal_status")?,
                    progress: row.get::<_, Option<i32>>("goal_progress")?.unwrap_or(0),
                    detail: row.get::<_, String>("step_title")?,
                    assignment_id: Some(row.get("assignment_id")?),
                    step_id: Some(row.get("step_id")?),
                    rank: 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        items.extend(rows);
    }
    let awaiting_review = items.len() as i32;

    // 2) Overdue + 3) stalled — from goals joined to their project.
    let mut overdue = 0i32;
    let mut stalled = 0i32;
    {
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.status, g.progress, g.target_date, g.updated_at,
                    p.id AS project_id, p.name AS project_name
             FROM dev_goals g JOIN dev_projects p ON p.id = g.project_id
             WHERE g.status NOT IN ('done','completed','complete')",
        )?;
        struct OngoingGoal {
            id: String,
            title: String,
            status: String,
            progress: i32,
            target_date: Option<String>,
            updated_at: String,
            project_id: String,
            project_name: String,
        }
        let rows = stmt
            .query_map([], |row| {
                Ok(OngoingGoal {
                    id: row.get("id")?,
                    title: row.get("title")?,
                    status: row.get("status")?,
                    progress: row.get::<_, Option<i32>>("progress")?.unwrap_or(0),
                    target_date: row.get("target_date")?,
                    updated_at: row.get("updated_at")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for g in rows {
            if !goal_status_is_ongoing(&g.status) {
                continue;
            }
            let is_overdue = g.target_date.as_deref().is_some_and(|d| d < now_s.as_str());
            if is_overdue {
                overdue += 1;
                let days = days_between(g.target_date.as_deref().unwrap_or(""), &now_s);
                items.push(AttentionItem {
                    kind: "overdue".into(),
                    goal_id: g.id,
                    goal_title: g.title,
                    project_id: g.project_id,
                    project_name: g.project_name,
                    status: g.status,
                    progress: g.progress,
                    detail: format!("{days}d overdue"),
                    assignment_id: None,
                    step_id: None,
                    rank: 1,
                });
            } else if g.updated_at.as_str() < stale_before.as_str() {
                stalled += 1;
                let days = days_between(&g.updated_at, &now_s);
                items.push(AttentionItem {
                    kind: "stalled".into(),
                    goal_id: g.id,
                    goal_title: g.title,
                    project_id: g.project_id,
                    project_name: g.project_name,
                    status: g.status,
                    progress: g.progress,
                    detail: format!("stalled {days}d"),
                    assignment_id: None,
                    step_id: None,
                    rank: 2,
                });
            }
        }
    }

    // 4) Unstaffed — ongoing goals with no linked team assignment.
    let mut unstaffed = 0i32;
    {
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.status, g.progress, p.id AS project_id, p.name AS project_name
             FROM dev_goals g JOIN dev_projects p ON p.id = g.project_id
             WHERE g.status NOT IN ('done','completed','complete')
               AND NOT EXISTS (SELECT 1 FROM team_assignments a WHERE a.goal_id = g.id)",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AttentionItem {
                    kind: "unstaffed".into(),
                    goal_id: row.get("id")?,
                    goal_title: row.get("title")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                    status: row.get("status")?,
                    progress: row.get::<_, Option<i32>>("progress")?.unwrap_or(0),
                    detail: String::new(),
                    assignment_id: None,
                    step_id: None,
                    rank: 3,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for it in rows {
            if goal_status_is_ongoing(&it.status) {
                unstaffed += 1;
                items.push(it);
            }
        }
    }

    items.sort_by_key(|i| i.rank);
    Ok(AttentionQueue {
        items,
        awaiting_review,
        overdue,
        stalled,
        unstaffed,
    })
}

/// Whole days between two RFC3339/ISO timestamps (`from` → `to`), 0 on parse fail.
fn days_between(from: &str, to: &str) -> i64 {
    let parse = |s: &str| {
        chrono::DateTime::parse_from_rfc3339(s)
            .map(|d| d.with_timezone(&chrono::Utc))
            .ok()
            .or_else(|| {
                chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .ok()
                    .and_then(|d| d.and_hms_opt(0, 0, 0))
                    .map(|dt| dt.and_utc())
            })
    };
    match (parse(from), parse(to)) {
        (Some(a), Some(b)) => (b - a).num_days().abs(),
        _ => 0,
    }
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
    let assignments =
        crate::db::repos::orchestration::team_assignments::list_for_goal(pool, goal_id)?;
    let mut steps_total = 0usize;
    let mut steps_done = 0usize;
    for a in &assignments {
        let steps = crate::db::repos::orchestration::team_assignments::list_steps(pool, &a.id)?;
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
        if cur != "done" {
            new_status = Some("done");
            completed_at = Some(Some(now.as_str()));
        }
        if goal.started_at.is_none() {
            started_at = Some(Some(now.as_str()));
        }
    } else if cur == "done" {
        // Was done but progress dropped below 100 — e.g. a re-opened UAT gate
        // re-blocked the goal, or new work was added. Demote out of done and
        // clear the completion stamp so "done" never outlives 100%.
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
        None,                  // title
        None,                  // description
        new_status,            // status
        Some(new_progress),    // progress
        None,                  // target_date
        None,                  // context_id
        started_at,            // started_at
        completed_at,          // completed_at
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
        pool, goal_id, None, None, Some("in-progress"), None, None, None, started_at, None,
    )?;
    Ok(())
}

#[cfg(test)]
mod apply_progress_tests {
    use super::*;
    use crate::db::init_test_db;

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

        // Finish the second → 100% → done.
        update_goal_item(&pool, &_i2.id, None, Some(true)).unwrap();
        let p2 = apply_resolved_goal_progress(&pool, &goal.id).unwrap();
        assert_eq!(p2, 100);
        let g2 = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_eq!(normalize_goal_status(&g2.status), "done");
        assert!(g2.completed_at.is_some());
    }

    #[test]
    fn never_regresses_a_manual_value() {
        let pool = init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        let goal = create_goal(&pool, &project.id, "G", None, None, None, None, None).unwrap();
        // Hand-set 80%, no items/steps → resolver would suggest fallback(current)=80; never below.
        update_goal(&pool, &goal.id, None, None, None, Some(80), None, None, None, None).unwrap();
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
            &pool, &p.id,
            None, None, None, None, None, None, None, None, None,
            Some(Some("https://staging.example.test")),
            Some(Some("staging")),
            Some(Some("main")),
        )
        .unwrap();
        assert_eq!(p.test_env_url.as_deref(), Some("https://staging.example.test"));
        assert_eq!(p.test_env_branch.as_deref(), Some("staging"));
        assert_eq!(p.main_branch.as_deref(), Some("main"));

        // LEAVE UNCHANGED: outer None → value persists.
        let p = update_project(
            &pool, &p.id,
            None, None, None, None, None, None, None, None, None, None, None, None,
        )
        .unwrap();
        assert_eq!(p.test_env_url.as_deref(), Some("https://staging.example.test"));
        assert_eq!(p.main_branch.as_deref(), Some("main"));

        // CLEAR: outer Some, inner None → back to NULL.
        let p = update_project(
            &pool, &p.id,
            None, None, None, None, None, None, None, None, None,
            Some(None), Some(None), Some(None),
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

// ============================================================================
// Context Groups
// ============================================================================

pub fn list_context_groups(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextGroup>, AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::list_context_groups",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_context_groups WHERE project_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_context_group)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn create_context_group(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    color: Option<&str>,
    icon: Option<&str>,
    group_type: Option<&str>,
    domain: Option<&str>,
) -> Result<DevContextGroup, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    timed_query!(
        "dev_context_groups",
        "dev_context_groups::create_context_group",
        {
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
            "INSERT INTO dev_context_groups (id, project_id, name, color, icon, group_type, domain, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, project_id, name, color, icon, group_type, domain, position, now],
        )?;

            conn.query_row(
                "SELECT * FROM dev_context_groups WHERE id = ?1",
                params![id],
                row_to_context_group,
            )
            .map_err(AppError::Database)
        }
    )
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
    domain: Option<Option<&str>>,
) -> Result<DevContextGroup, AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::update_context_group",
        {
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
            push_field!(domain, "domain", sets, param_idx);

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
            if let Some(v) = domain {
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
    )
}

pub fn delete_context_group(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::delete_context_group",
        {
            let conn = pool.get()?;
            let rows = conn.execute("DELETE FROM dev_context_groups WHERE id = ?1", params![id])?;
            Ok(rows > 0)
        }
    )
}

/// Delete all contexts, groups, and group relationships for a project.
/// Used before a rescan to start with a clean slate.
pub fn clear_project_context_map(
    pool: &DbPool,
    project_id: &str,
) -> Result<(usize, usize), AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::clear_project_context_map",
        {
            let conn = pool.get()?;
            let ctx_rows = conn.execute(
                "DELETE FROM dev_contexts WHERE project_id = ?1",
                params![project_id],
            )?;
            let rel_rows = conn.execute(
                "DELETE FROM dev_context_group_relationships WHERE project_id = ?1",
                params![project_id],
            );
            let _ = rel_rows; // ok if table is empty
            let grp_rows = conn.execute(
                "DELETE FROM dev_context_groups WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok((grp_rows, ctx_rows))
        }
    )
}

pub fn reorder_context_groups(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::reorder_context_groups",
        {
            let conn = pool.get()?;
            for (i, id) in ids.iter().enumerate() {
                conn.execute(
                    "UPDATE dev_context_groups SET position = ?1, updated_at = ?2 WHERE id = ?3",
                    params![i as i32, chrono::Utc::now().to_rfc3339(), id],
                )?;
            }
            Ok(())
        }
    )
}

// ============================================================================
// Per-file content-hash cache (incremental rescan)
// ============================================================================

/// Return all cached file hashes for a project as a `{file_path: sha256}` map.
/// Populated by `commands/infrastructure/context_generation.rs` after a successful
/// scan; consumed by `commands/infrastructure/incremental_scan.rs` to compute
/// the delta {added, modified, deleted} against the live filesystem.
pub fn get_file_hashes(
    pool: &DbPool,
    project_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    timed_query!(
        "dev_context_file_hashes",
        "dev_context_file_hashes::get_file_hashes",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT file_path, sha256 FROM dev_context_file_hashes WHERE project_id = ?1",
            )?;
            let rows = stmt.query_map(params![project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut map = HashMap::new();
            for row in rows {
                let (path, sha) = row.map_err(AppError::Database)?;
                map.insert(path, sha);
            }
            Ok(map)
        }
    )
}

/// Replace the entire file-hash cache for a project in a single transaction.
/// Called after a successful scan so the next scan can compute a delta. The
/// caller passes the full live snapshot — anything not present is removed
/// (deleted files won't accumulate as stale rows).
pub fn replace_file_hashes(
    pool: &DbPool,
    project_id: &str,
    entries: &[(String, String, i64)], // (file_path, sha256, size_bytes)
) -> Result<usize, AppError> {
    timed_query!(
        "dev_context_file_hashes",
        "dev_context_file_hashes::replace_file_hashes",
        {
            let mut conn = pool.get()?;
            let tx = conn.transaction()?;
            tx.execute(
                "DELETE FROM dev_context_file_hashes WHERE project_id = ?1",
                params![project_id],
            )?;
            let now = chrono::Utc::now().to_rfc3339();
            let mut written = 0usize;
            {
                let mut stmt = tx.prepare(
                "INSERT INTO dev_context_file_hashes (project_id, file_path, sha256, size_bytes, last_extracted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
                for (path, sha, size) in entries {
                    stmt.execute(params![project_id, path, sha, size, now])?;
                    written += 1;
                }
            }
            tx.commit()?;
            Ok(written)
        }
    )
}

/// Drop all cached file hashes for a project (e.g. on project delete or a
/// "force full rescan" user action). Returns the number of rows removed.
pub fn clear_file_hashes(pool: &DbPool, project_id: &str) -> Result<usize, AppError> {
    timed_query!(
        "dev_context_file_hashes",
        "dev_context_file_hashes::clear_file_hashes",
        {
            let conn = pool.get()?;
            let n = conn.execute(
                "DELETE FROM dev_context_file_hashes WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(n)
        }
    )
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
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt =
                conn.prepare("SELECT * FROM dev_contexts WHERE project_id = ?1 ORDER BY name")?;
            let rows = stmt.query_map(params![project_id], row_to_context)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
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
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev context {id}")),
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
    category: Option<&str>,
    business_feature: Option<&str>,
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
            "INSERT INTO dev_contexts (id, project_id, group_id, name, description, file_paths, entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, category, business_feature, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            params![id, project_id, group_id, name, description, file_paths, entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, category, business_feature, now],
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
    category: Option<Option<&str>>,
    business_feature: Option<Option<&str>>,
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
        push_field!(category, "category", sets, param_idx);
        push_field!(business_feature, "business_feature", sets, param_idx);

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
        if let Some(v) = category {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = business_feature {
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
            "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "rb", "css", "scss", "html", "vue",
            "svelte", "json", "toml", "yaml", "yml", "sql", "sh",
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
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "dist"
                    || name == "build"
                {
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
                                if rel.components().count() <= 1 {
                                    None
                                } else {
                                    Some(s)
                                }
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
    timed_query!(
        "dev_context_group_relationships",
        "dev_context_group_relationships::list",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
            "SELECT * FROM dev_context_group_relationships WHERE project_id = ?1 ORDER BY created_at",
        )?;
            let rows = stmt.query_map(params![project_id], row_to_context_group_relationship)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn create_context_group_relationship(
    pool: &DbPool,
    project_id: &str,
    source_group_id: &str,
    target_group_id: &str,
) -> Result<DevContextGroupRelationship, AppError> {
    timed_query!(
        "dev_context_group_relationships",
        "dev_context_group_relationships::create",
        {
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
    )
}

pub fn delete_context_group_relationship(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!(
        "dev_context_group_relationships",
        "dev_context_group_relationships::delete",
        {
            let conn = pool.get()?;
            let rows = conn.execute(
                "DELETE FROM dev_context_group_relationships WHERE id = ?1",
                params![id],
            )?;
            Ok(rows > 0)
        }
    )
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
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
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
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev idea {id}")),
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
        // Normalize the incoming category through the canonical vocabulary
        // (see `IdeaCategory` for the mapping). Legacy values from older code
        // paths or LLM hallucinations collapse to the canonical default
        // rather than poisoning the column with a third vocabulary.
        let canonical_category = category
            .and_then(crate::db::models::IdeaCategory::from_token)
            .unwrap_or(crate::db::models::DEFAULT_IDEA_CATEGORY);
        let category = canonical_category.as_str();
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
/// Strategist triage: set (or clear) an idea's rank. 1 = do next.
pub fn set_idea_priority(pool: &DbPool, id: &str, priority: Option<i32>) -> Result<(), AppError> {
    timed_query!("dev_ideas", "dev_ideas::set_priority", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_ideas SET priority = ?1, updated_at = ?2 WHERE id = ?3",
            params![priority, now, id],
        )?;
        Ok(())
    })
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
            // Normalize through the canonical vocabulary so callers writing
            // legacy values can't reintroduce vocabulary drift via update.
            let canonical = crate::db::models::IdeaCategory::from_token(v)
                .unwrap_or(crate::db::models::DEFAULT_IDEA_CATEGORY);
            param_values.push(Box::new(canonical.as_str().to_string()));
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
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "DELETE FROM dev_ideas WHERE id IN ({})",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
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
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt =
                conn.prepare("SELECT * FROM dev_scans ORDER BY created_at DESC LIMIT ?1")?;
            let rows = stmt.query_map(params![limit], row_to_scan)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
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
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev scan {id}")),
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
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
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
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev task {id}")),
            other => AppError::Database(other),
        })
    })
}

/// Return up to `limit` queued tasks for `project_id` whose upstream goal
/// chain is fully `completed` (or whose `goal_id` is NULL — orphan-ready).
///
/// Tasks whose upstream contains a `failed` or `cancelled` goal are
/// **excluded** from the ready set; they remain `queued` in the DB until
/// the user manually re-runs after fixing the upstream.
///
/// Sorted FIFO by `created_at`. Used by the auto-run scheduler.
pub fn list_ready_tasks(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_ready_tasks", {
        let goal_state = list_goal_statuses_with_deps(pool, project_id)?;

        // Walks the upstream closure of `gid` and reports the *worst* status seen.
        // Returns: "completed" if every upstream goal is completed (or gid has no
        // upstream); "blocked" if any upstream is queued/in_progress; "failed" if
        // any upstream is failed/cancelled.
        fn upstream_state(gid: &str, map: &HashMap<String, (String, Vec<String>)>) -> &'static str {
            let mut visited: HashSet<String> = HashSet::new();
            let mut stack: Vec<String> = vec![gid.to_string()];
            let mut blocked = false;
            while let Some(node) = stack.pop() {
                if !visited.insert(node.clone()) {
                    continue;
                }
                if let Some((status, deps)) = map.get(&node) {
                    // The starting node's own status is irrelevant for readiness;
                    // only its upstream matters. Skip it.
                    if node != gid {
                        match status.as_str() {
                            "failed" | "cancelled" => return "failed",
                            "completed" => {}
                            _ => blocked = true,
                        }
                    }
                    for d in deps {
                        stack.push(d.clone());
                    }
                }
            }
            if blocked {
                "blocked"
            } else {
                "completed"
            }
        }

        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_tasks \
             WHERE project_id = ?1 AND status = 'queued' \
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_task)?;

        let mut out: Vec<DevTask> = Vec::new();
        for r in rows {
            let task = r.map_err(AppError::Database)?;
            let ready = match task.goal_id.as_deref() {
                None => true,
                Some(gid) => upstream_state(gid, &goal_state) == "completed",
            };
            if ready {
                out.push(task);
                if out.len() >= limit {
                    break;
                }
            }
        }
        Ok(out)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_task(
    pool: &DbPool,
    project_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    source_idea_id: Option<&str>,
    goal_id: Option<&str>,
    status: Option<&str>,
    depth: Option<&str>,
) -> Result<DevTask, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    timed_query!("dev_tasks", "dev_tasks::create_task", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let status = status.unwrap_or("queued");
        let depth = depth.unwrap_or("quick");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, depth, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, project_id, title, description, source_idea_id, goal_id, status, depth, now],
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
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt = conn.prepare("SELECT * FROM dev_triage_rules ORDER BY created_at")?;
            let rows = stmt.query_map([], row_to_triage_rule)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
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

    timed_query!(
        "dev_triage_rules",
        "dev_triage_rules::create_triage_rule",
        {
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
    )
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
    timed_query!(
        "dev_triage_rules",
        "dev_triage_rules::update_triage_rule",
        {
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
    )
}

pub fn delete_triage_rule(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!(
        "dev_triage_rules",
        "dev_triage_rules::delete_triage_rule",
        {
            let conn = pool.get()?;
            let rows = conn.execute("DELETE FROM dev_triage_rules WHERE id = ?1", params![id])?;
            Ok(rows > 0)
        }
    )
}

// ============================================================================
// Pipelines (Idea-to-Execution)
// ============================================================================

use crate::db::models::{ContextHealthSnapshot, DevPipeline};

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
            params![
                id,
                project_id,
                idea_id,
                auto_execute as i32,
                verify_after as i32
            ],
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
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Pipeline not found: {id}"))
            }
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
                "SELECT * FROM dev_pipelines WHERE project_id = ?1 ORDER BY created_at DESC",
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

pub fn insert_health_snapshot(
    pool: &DbPool,
    snap: &ContextHealthSnapshot,
) -> Result<ContextHealthSnapshot, AppError> {
    timed_query!(
        "context_health_snapshots",
        "context_health_snapshots::insert",
        {
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
        }
    )
}

pub fn get_health_snapshot_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<ContextHealthSnapshot, AppError> {
    timed_query!(
        "context_health_snapshots",
        "context_health_snapshots::get_by_id",
        {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT * FROM context_health_snapshots WHERE id = ?1",
                params![id],
                row_to_health_snapshot,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Health snapshot not found: {id}"))
                }
                other => AppError::from(other),
            })
        }
    )
}

pub fn list_health_snapshots(
    pool: &DbPool,
    project_id: &str,
    limit: Option<i32>,
) -> Result<Vec<ContextHealthSnapshot>, AppError> {
    timed_query!(
        "context_health_snapshots",
        "context_health_snapshots::list",
        {
            let conn = pool.get()?;
            let lim = limit.unwrap_or(50);
            let mut stmt = conn.prepare(
            "SELECT * FROM context_health_snapshots WHERE project_id = ?1 ORDER BY scanned_at DESC LIMIT ?2"
        )?;
            let rows = stmt.query_map(params![project_id, lim], row_to_health_snapshot)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        }
    )
}

// ============================================================================
// Cross-Project (Codebases connector)
// ============================================================================

use crate::db::models::{
    CrossProjectRelation, PortfolioHealthSummary, ProjectHealthEntry, RiskMatrixEntry,
    TechRadarEntry,
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
    timed_query!(
        "cross_project_relations",
        "cross_project_relations::list",
        {
            let conn = pool.get()?;
            let mut stmt =
                conn.prepare("SELECT * FROM cross_project_relations ORDER BY created_at DESC")?;
            let rows = stmt.query_map([], row_to_cross_relation)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        }
    )
}

pub fn upsert_cross_project_relation(
    pool: &DbPool,
    source_project_id: &str,
    target_project_id: &str,
    relation_type: &str,
    details: Option<&str>,
) -> Result<CrossProjectRelation, AppError> {
    timed_query!(
        "cross_project_relations",
        "cross_project_relations::upsert",
        {
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
        }
    )
}

pub fn delete_cross_project_relations_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<usize, AppError> {
    timed_query!(
        "cross_project_relations",
        "cross_project_relations::delete_for_project",
        {
            let conn = pool.get()?;
            let rows = conn.execute(
            "DELETE FROM cross_project_relations WHERE source_project_id = ?1 OR target_project_id = ?1",
            params![project_id],
        )?;
            Ok(rows)
        }
    )
}

/// Bulk create ideas across multiple projects in a single transaction.
#[allow(clippy::type_complexity)]
pub fn bulk_create_ideas_cross_project(
    pool: &DbPool,
    ideas: &[(
        Option<&str>,
        Option<&str>,
        &str,
        &str,
        &str,
        Option<&str>,
        Option<i32>,
        Option<i32>,
        Option<i32>,
    )],
    // Each tuple: (project_id, context_id, scan_type, category, title, description, effort, impact, risk)
) -> Result<Vec<DevIdea>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::bulk_create_ideas_cross_project", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut created = Vec::with_capacity(ideas.len());

        for &(
            project_id,
            context_id,
            scan_type,
            category,
            title,
            description,
            effort,
            impact,
            risk,
        ) in ideas
        {
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
                priority: None,
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

        let total_projects: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_projects", [], |r| r.get(0))?;
        let active_projects: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_projects WHERE status = 'active'",
            [],
            |r| r.get(0),
        )?;
        let total_ideas: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_ideas", [], |r| r.get(0))?;
        let pending_ideas: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE status = 'pending'",
            [],
            |r| r.get(0),
        )?;
        let total_tasks: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_tasks", [], |r| r.get(0))?;
        let running_tasks: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_tasks WHERE status = 'running'",
            [],
            |r| r.get(0),
        )?;

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
                "SELECT COUNT(*) FROM dev_contexts WHERE project_id = ?1",
                params![p.id],
                |r| r.get(0),
            )?;
            let idea_count: i32 = conn.query_row(
                "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1",
                params![p.id],
                |r| r.get(0),
            )?;
            let task_count: i32 = conn.query_row(
                "SELECT COUNT(*) FROM dev_tasks WHERE project_id = ?1",
                params![p.id],
                |r| r.get(0),
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
        let mut tech_map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row_result in rows {
            let (_id, name, stack) = row_result?;
            for tech in stack
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
            {
                tech_map.entry(tech).or_default().push(name.clone());
            }
        }

        let total_projects: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_projects", [], |r| r.get(0))?;

        let mut entries: Vec<TechRadarEntry> = tech_map
            .into_iter()
            .map(|(tech, names)| {
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
            })
            .collect();

        entries.sort_by(|a, b| b.project_count.cmp(&a.project_count));
        Ok(entries)
    })
}

/// Simple heuristic to categorize a technology string.
fn categorize_tech(tech: &str) -> &'static str {
    match tech {
        "rust" | "python" | "typescript" | "javascript" | "go" | "java" | "c#" | "ruby"
        | "swift" | "kotlin" => "language",
        "react" | "vue" | "angular" | "svelte" | "next.js" | "nuxt" | "fastapi" | "express"
        | "django" | "rails" | "actix" | "axum" | "tauri" => "framework",
        "postgres" | "postgresql" | "mysql" | "sqlite" | "mongodb" | "redis" | "dynamodb"
        | "supabase" | "neon" | "planetscale" => "database",
        "docker" | "kubernetes" | "terraform" | "github actions" | "circleci" | "vercel"
        | "netlify" | "aws" | "gcp" | "azure" => "tool",
        _ => "library",
    }
}

/// Build risk matrix by analyzing multiple risk dimensions across projects.
pub fn get_risk_matrix(pool: &DbPool) -> Result<Vec<RiskMatrixEntry>, AppError> {
    timed_query!("dev_projects", "dev_projects::get_risk_matrix", {
        let conn = pool.get()?;
        let mut risks = Vec::new();

        let mut stmt =
            conn.prepare("SELECT * FROM dev_projects WHERE status = 'active' ORDER BY name")?;
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
                    severity: if high_risk_count > 3 {
                        "critical"
                    } else {
                        "high"
                    }
                    .to_string(),
                    description: format!("{} high-risk ideas pending review", high_risk_count),
                    affected_contexts: affected,
                });
            }

            // Check for stale projects (no scans in 30 days)
            let latest_scan: Option<String> = conn
                .query_row(
                    "SELECT MAX(created_at) FROM dev_scans WHERE project_id = ?1",
                    params![p.id],
                    |r| r.get(0),
                )
                .unwrap_or(None);
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
            let sev_order = |s: &str| match s {
                "critical" => 0,
                "high" => 1,
                "medium" => 2,
                _ => 3,
            };
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
        winner_insight: row
            .get::<_, Option<String>>("winner_insight")
            .ok()
            .flatten(),
        baseline_json: row.get::<_, Option<String>>("baseline_json").ok().flatten(),
        reviewer_notes: row.get("reviewer_notes")?,
        worktree_base_ref: row
            .get::<_, Option<String>>("worktree_base_ref")
            .ok()
            .flatten(),
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
        disqualify_reason: row
            .get::<_, Option<String>>("disqualify_reason")
            .ok()
            .flatten(),
        diff_hash: row.get::<_, Option<String>>("diff_hash").ok().flatten(),
        diff_stats_json: row
            .get::<_, Option<String>>("diff_stats_json")
            .ok()
            .flatten(),
        diff_analyzed_at: row
            .get::<_, Option<String>>("diff_analyzed_at")
            .ok()
            .flatten(),
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
    worktree_base_ref: Option<&str>,
) -> Result<DevCompetition, AppError> {
    if task_title.trim().is_empty() {
        return Err(AppError::Validation(
            "Competition title cannot be empty".into(),
        ));
    }
    if !(2..=4).contains(&slot_count) {
        return Err(AppError::Validation("slot_count must be 2..=4".into()));
    }
    timed_query!("dev_competitions", "dev_competitions::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_competitions (id, project_id, task_title, task_description, source_idea_id, source_goal_id, slot_count, status, worktree_base_ref, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8, ?9)",
            params![id, project_id, task_title, task_description, source_idea_id, source_goal_id, slot_count, worktree_base_ref, now],
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
            let result = stmt
                .query_map(params![project_id, s], row_to_competition)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            result
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_competitions WHERE project_id = ?1 ORDER BY created_at DESC",
            )?;
            let result = stmt
                .query_map(params![project_id], row_to_competition)?
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
    timed_query!(
        "dev_competition_slots",
        "dev_competition_slots::update_diff",
        {
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
                params![
                    diff_hash,
                    diff_stats_json,
                    disqualified as i32,
                    disqualify_reason,
                    now,
                    slot_id
                ],
            )?;
            conn.query_row(
                "SELECT * FROM dev_competition_slots WHERE id = ?1",
                params![slot_id],
                row_to_competition_slot,
            )
            .map_err(AppError::Database)
        }
    )
}

/// Aggregate per-strategy win/loss/DQ stats across all resolved competitions in a project.
pub fn get_strategy_leaderboard(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<crate::db::models::DevStrategyStats>, AppError> {
    use crate::db::models::DevStrategyStats;
    timed_query!(
        "dev_competition_slots",
        "dev_competition_slots::leaderboard",
        {
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
                    win_rate: if total > 0 {
                        wins as f64 / total as f64
                    } else {
                        0.0
                    },
                    last_win_at: row.get::<_, Option<String>>("last_win_at").ok().flatten(),
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
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
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// `(goal_id, team_name)` for every team_assignment that advances a goal — the
/// canonical "this team is working this goal" link, surfaced on the goal Map.
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
    use super::{days_between, goal_status_is_ongoing, normalize_goal_status};

    #[test]
    fn normalize_buckets_match_the_frontend_model() {
        for raw in ["in-progress", "in_progress", "running", "active", "matching"] {
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

    #[test]
    fn days_between_handles_rfc3339_date_only_and_garbage() {
        assert_eq!(
            days_between("2026-05-01T00:00:00Z", "2026-05-09T00:00:00Z"),
            8
        );
        assert_eq!(days_between("2026-05-01", "2026-05-04"), 3);
        assert_eq!(days_between("not-a-date", "2026-05-04"), 0);
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
            crate::db::migrations::run(&conn).expect("initial migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
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
        let project =
            create_project(&pool, "Web App", "/tmp/webapp", None, None, Some("react"), None, None)
                .unwrap();
        let goal =
            create_goal(&pool, &project.id, "Ship feature", None, None, None, None, None).unwrap();
        // One ordinary to-do, marked done.
        let todo = create_goal_item(&pool, &goal.id, "Build the feature").unwrap();
        update_goal_item(&pool, &todo.id, None, Some(true)).unwrap();
        // Attach the UAT gate (still open).
        set_goal_verification(&pool, &goal.id, "smoke test the app", None).unwrap();

        // All ordinary to-dos done, but the open gate must cap below 100 / not done.
        let progress = apply_resolved_goal_progress(&pool, &goal.id).unwrap();
        assert!(progress < 100, "open UAT gate must keep progress < 100, got {progress}");
        let g = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_ne!(normalize_goal_status(&g.status), "done", "goal must NOT be done while UAT open");

        // Eligibility: every non-verify to-do is complete → UAT may run.
        assert!(goal_todos_all_complete(&pool, &goal.id).unwrap());

        // Passing the UAT closes the gate → goal reaches 100 / done.
        let after = complete_goal_verification(&pool, &goal.id).unwrap();
        assert_eq!(after, 100, "closing the gate completes the goal");
        let g2 = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_eq!(normalize_goal_status(&g2.status), "done");
    }

    #[test]
    fn uat_ineligible_while_todos_open() {
        let pool = test_pool();
        let project =
            create_project(&pool, "Web2", "/tmp/web2", None, None, Some("nodejs"), None, None)
                .unwrap();
        let goal = create_goal(&pool, &project.id, "Feature", None, None, None, None, None).unwrap();
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
        let project =
            create_project(&pool, "Web4", "/tmp/web4", None, None, Some("react"), None, None)
                .unwrap();
        let goal = create_goal(&pool, &project.id, "Feature", None, None, None, None, None).unwrap();
        set_goal_verification(&pool, &goal.id, "test it", None).unwrap();
        // Pass the gate → goal done.
        complete_goal_verification(&pool, &goal.id).unwrap();
        assert_eq!(normalize_goal_status(&get_goal_by_id(&pool, &goal.id).unwrap().status), "done");
        // Re-open: new work invalidates the pass.
        let reopened = reopen_verification_if_passed(&pool, &goal.id).unwrap();
        assert!(reopened);
        let g = get_goal_by_id(&pool, &goal.id).unwrap();
        assert_ne!(normalize_goal_status(&g.status), "done", "re-opening drops the goal out of done");
        assert!(g.progress < 100);
        // Idempotent: re-opening an already-open gate is a no-op.
        assert!(!reopen_verification_if_passed(&pool, &goal.id).unwrap());
    }

    #[test]
    fn set_verification_replaces_not_duplicates() {
        let pool = test_pool();
        let project =
            create_project(&pool, "Web3", "/tmp/web3", None, None, Some("react"), None, None)
                .unwrap();
        let goal = create_goal(&pool, &project.id, "Feature", None, None, None, None, None).unwrap();
        set_goal_verification(&pool, &goal.id, "scenario one", None).unwrap();
        set_goal_verification(&pool, &goal.id, "scenario two", Some("http://localhost:8765")).unwrap();
        let items = list_goal_items(&pool, &goal.id).unwrap();
        let gates: Vec<_> = items
            .iter()
            .filter(|i| i.verify_kind.as_deref() == Some("browser_test"))
            .collect();
        assert_eq!(gates.len(), 1, "re-setting replaces the gate, never duplicates");
        assert!(gates[0].verify_config.as_deref().unwrap().contains("scenario two"));
    }
}

// ============================================================================
// KPIs (outcome layer above goals — docs/plans/kpi-driven-orchestration.md)
// ============================================================================

pub fn row_to_kpi(row: &Row) -> rusqlite::Result<DevKpi> {
    Ok(DevKpi {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        context_group_id: row.get("context_group_id")?,
        context_id: row.get("context_id").unwrap_or(None),
        name: row.get("name")?,
        description: row.get("description")?,
        category: row.get("category")?,
        measure_kind: row.get("measure_kind")?,
        measure_config: row.get("measure_config")?,
        unit: row.get("unit")?,
        direction: row.get("direction")?,
        baseline_value: row.get("baseline_value")?,
        target_value: row.get("target_value")?,
        target_date: row.get("target_date")?,
        current_value: row.get("current_value")?,
        last_measured_at: row.get("last_measured_at")?,
        cadence: row.get("cadence")?,
        status: row.get("status")?,
        created_by: row.get("created_by")?,
        rationale: row.get("rationale")?,
        needed_connector: row.get("needed_connector")?,
        metric_type: row.get("metric_type").unwrap_or(None),
        tier: row.get("tier").unwrap_or_else(|_| "supporting".to_string()),
        warn_at: row.get("warn_at").unwrap_or(None),
        crit_at: row.get("crit_at").unwrap_or(None),
        manual_rating: row.get("manual_rating").unwrap_or(None),
        assessment_pros: row.get("assessment_pros").unwrap_or(None),
        assessment_cons: row.get("assessment_cons").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_kpi_measurement(row: &Row) -> rusqlite::Result<DevKpiMeasurement> {
    Ok(DevKpiMeasurement {
        id: row.get("id")?,
        kpi_id: row.get("kpi_id")?,
        value: row.get("value")?,
        measured_at: row.get("measured_at")?,
        source: row.get("source")?,
        evidence: row.get("evidence")?,
        note: row.get("note")?,
    })
}

/// List a project's KPIs, optionally filtered by status. Active first, then
/// proposed (review queue), then paused/archived; newest within each band.
pub fn list_kpis(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevKpi>, AppError> {
    timed_query!("dev_kpis", "dev_kpis::list_kpis", {
        let conn = pool.get()?;
        let mut sql = String::from(
            "SELECT * FROM dev_kpis WHERE project_id = ?1",
        );
        if status.is_some() {
            sql.push_str(" AND status = ?2");
        }
        sql.push_str(
            " ORDER BY CASE status
                 WHEN 'active' THEN 0 WHEN 'proposed' THEN 1
                 WHEN 'paused' THEN 2 ELSE 3 END,
               created_at DESC",
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = match status {
            Some(st) => stmt.query_map(params![project_id, st], row_to_kpi)?,
            None => stmt.query_map(params![project_id], row_to_kpi)?,
        };
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_kpi(pool: &DbPool, id: &str) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::get_kpi", {
        let conn = pool.get()?;
        conn.query_row("SELECT * FROM dev_kpis WHERE id = ?1", params![id], row_to_kpi)
            .map_err(|_| AppError::NotFound(format!("KPI {id} not found")))
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_kpi(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    description: Option<&str>,
    context_group_id: Option<&str>,
    category: &str,
    measure_kind: &str,
    measure_config: &str,
    unit: &str,
    direction: &str,
    baseline_value: Option<f64>,
    target_value: Option<f64>,
    target_date: Option<&str>,
    cadence: &str,
    status: Option<&str>,
    created_by: &str,
    rationale: Option<&str>,
    needed_connector: Option<&str>,
    metric_type: Option<&str>,
    context_id: Option<&str>,
) -> Result<DevKpi, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("KPI name cannot be empty".into()));
    }
    timed_query!("dev_kpis", "dev_kpis::create_kpi", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_kpis (id, project_id, context_group_id, name, description,
                category, measure_kind, measure_config, unit, direction,
                baseline_value, target_value, target_date, cadence, status,
                created_by, rationale, needed_connector, metric_type, context_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
            params![
                id, project_id, context_group_id, name.trim(), description,
                category, measure_kind, measure_config, unit, direction,
                baseline_value, target_value, target_date, cadence,
                status.unwrap_or("proposed"), created_by, rationale, needed_connector,
                metric_type, context_id
            ],
        )?;
        drop(conn);
        get_kpi(pool, &id)
    })
}

/// Field-wise update; `Option<Option<...>>` distinguishes "leave unchanged"
/// from "set NULL" (mirrors update_goal).
#[allow(clippy::too_many_arguments)]
pub fn update_kpi(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    context_group_id: Option<Option<&str>>,
    context_id: Option<Option<&str>>,
    category: Option<&str>,
    measure_kind: Option<&str>,
    measure_config: Option<&str>,
    unit: Option<&str>,
    direction: Option<&str>,
    baseline_value: Option<Option<f64>>,
    target_value: Option<Option<f64>>,
    target_date: Option<Option<&str>>,
    cadence: Option<&str>,
    status: Option<&str>,
    needed_connector: Option<Option<&str>>,
    metric_type: Option<Option<&str>>,
    tier: Option<&str>,
) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::update_kpi", {
        let conn = pool.get()?;
        // Build SET clause field-by-field (small N; clarity over cleverness).
        let mut sets: Vec<String> = vec!["updated_at = datetime('now')".into()];
        let mut vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut push = |sets: &mut Vec<String>, col: &str, v: Box<dyn rusqlite::types::ToSql>, vals: &mut Vec<Box<dyn rusqlite::types::ToSql>>| {
            vals.push(v);
            sets.push(format!("{col} = ?{}", vals.len()));
        };
        if let Some(v) = name { push(&mut sets, "name", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = description { push(&mut sets, "description", Box::new(v.map(str::to_string)), &mut vals); }
        if let Some(v) = context_group_id { push(&mut sets, "context_group_id", Box::new(v.map(str::to_string)), &mut vals); }
        if let Some(v) = context_id { push(&mut sets, "context_id", Box::new(v.map(str::to_string)), &mut vals); }
        if let Some(v) = category { push(&mut sets, "category", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = measure_kind { push(&mut sets, "measure_kind", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = measure_config { push(&mut sets, "measure_config", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = unit { push(&mut sets, "unit", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = direction { push(&mut sets, "direction", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = baseline_value { push(&mut sets, "baseline_value", Box::new(v), &mut vals); }
        if let Some(v) = target_value { push(&mut sets, "target_value", Box::new(v), &mut vals); }
        if let Some(v) = target_date { push(&mut sets, "target_date", Box::new(v.map(str::to_string)), &mut vals); }
        if let Some(v) = cadence { push(&mut sets, "cadence", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = status { push(&mut sets, "status", Box::new(v.to_string()), &mut vals); }
        if let Some(v) = needed_connector { push(&mut sets, "needed_connector", Box::new(v.map(str::to_string)), &mut vals); }
        if let Some(v) = metric_type { push(&mut sets, "metric_type", Box::new(v.map(str::to_string)), &mut vals); }
        if let Some(v) = tier { push(&mut sets, "tier", Box::new(v.to_string()), &mut vals); }
        let sql = format!(
            "UPDATE dev_kpis SET {} WHERE id = ?{}",
            sets.join(", "),
            vals.len() + 1
        );
        vals.push(Box::new(id.to_string()));
        let n = conn.execute(
            &sql,
            rusqlite::params_from_iter(vals.iter().map(|b| b.as_ref())),
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("KPI {id} not found")));
        }
        drop(conn);
        get_kpi(pool, id)
    })
}

pub fn delete_kpi(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_kpis", "dev_kpis::delete_kpi", {
        let conn = pool.get()?;
        let n = conn.execute("DELETE FROM dev_kpis WHERE id = ?1", params![id])?;
        Ok(n > 0)
    })
}

/// Persist Factory-console calibration + assessment. Each field is COALESCEd, so
/// a partial save (only the fields the user just changed) preserves the rest.
#[allow(clippy::too_many_arguments)]
pub fn save_kpi_assessment(
    pool: &DbPool,
    id: &str,
    warn_at: Option<f64>,
    crit_at: Option<f64>,
    manual_rating: Option<i32>,
    pros: Option<&str>,
    cons: Option<&str>,
) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::save_kpi_assessment", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE dev_kpis SET
                warn_at = COALESCE(?2, warn_at),
                crit_at = COALESCE(?3, crit_at),
                manual_rating = COALESCE(?4, manual_rating),
                assessment_pros = COALESCE(?5, assessment_pros),
                assessment_cons = COALESCE(?6, assessment_cons),
                updated_at = datetime('now')
             WHERE id = ?1",
            params![id, warn_at, crit_at, manual_rating, pros, cons],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("KPI {id} not found")));
        }
        drop(conn);
        get_kpi(pool, id)
    })
}

/// All KPIs across every project (cross-project dashboard scope). Same
/// status ordering as `list_kpis`.
pub fn list_all_kpis(pool: &DbPool) -> Result<Vec<DevKpi>, AppError> {
    timed_query!("dev_kpis", "dev_kpis::list_all_kpis", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_kpis
             ORDER BY CASE status
                  WHEN 'active' THEN 0 WHEN 'proposed' THEN 1
                  WHEN 'paused' THEN 2 ELSE 3 END,
                created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_kpi)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Bulk measurement history for a set of KPIs (trend charts) — newest-first
/// per KPI, bounded per KPI by `per_kpi` (applied client-side is wasteful;
/// a window function keeps the payload tight).
pub fn list_kpi_measurements_bulk(
    pool: &DbPool,
    kpi_ids: &[String],
    per_kpi: i64,
) -> Result<Vec<DevKpiMeasurement>, AppError> {
    if kpi_ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!("dev_kpi_measurements", "dev_kpis::list_kpi_measurements_bulk", {
        let conn = pool.get()?;
        let ph = kpi_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT * FROM (
                 SELECT m.*, ROW_NUMBER() OVER (
                     PARTITION BY kpi_id ORDER BY datetime(measured_at) DESC
                 ) AS rn
                 FROM dev_kpi_measurements m
                 WHERE kpi_id IN ({ph})
             ) WHERE rn <= ?
             ORDER BY datetime(measured_at) ASC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut params: Vec<&dyn rusqlite::types::ToSql> =
            kpi_ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
        params.push(&per_kpi);
        let rows = stmt.query_map(rusqlite::params_from_iter(params), row_to_kpi_measurement)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Newest-first measurement history (bounded).
pub fn list_kpi_measurements(
    pool: &DbPool,
    kpi_id: &str,
    limit: Option<i64>,
) -> Result<Vec<DevKpiMeasurement>, AppError> {
    timed_query!("dev_kpi_measurements", "dev_kpis::list_kpi_measurements", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_kpi_measurements WHERE kpi_id = ?1
             ORDER BY datetime(measured_at) DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![kpi_id, limit.unwrap_or(100)], row_to_kpi_measurement)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Record a measurement and roll the KPI's live state forward
/// (current_value + last_measured_at) in the same call.
pub fn record_kpi_measurement(
    pool: &DbPool,
    kpi_id: &str,
    value: f64,
    source: &str,
    evidence: Option<&str>,
    note: Option<&str>,
) -> Result<DevKpiMeasurement, AppError> {
    timed_query!("dev_kpi_measurements", "dev_kpis::record_kpi_measurement", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, evidence, note)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, kpi_id, value, source, evidence, note],
        )?;
        let n = conn.execute(
            "UPDATE dev_kpis SET current_value = ?1, last_measured_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?2",
            params![value, kpi_id],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("KPI {kpi_id} not found")));
        }
        conn.query_row(
            "SELECT * FROM dev_kpi_measurements WHERE id = ?1",
            params![id],
            row_to_kpi_measurement,
        )
        .map_err(AppError::Database)
    })
}

// ============================================================================
// KPI connector bindings (P6 — swappable tool under a type-bound KPI)
// ============================================================================

fn row_to_kpi_binding(row: &Row) -> rusqlite::Result<DevKpiBinding> {
    Ok(DevKpiBinding {
        id: row.get("id")?,
        kpi_id: row.get("kpi_id")?,
        credential_id: row.get("credential_id")?,
        service_type: row.get("service_type")?,
        procedure: row.get("procedure")?,
        composed_by: row.get("composed_by")?,
        status: row.get("status")?,
        verified_at: row.get("verified_at")?,
        created_at: row.get("created_at")?,
    })
}

pub fn list_kpi_bindings(pool: &DbPool, kpi_id: &str) -> Result<Vec<DevKpiBinding>, AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::list_kpi_bindings", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_kpi_bindings WHERE kpi_id = ?1 ORDER BY datetime(created_at) DESC",
        )?;
        let rows = stmt.query_map(params![kpi_id], row_to_kpi_binding)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn active_kpi_binding(pool: &DbPool, kpi_id: &str) -> Result<Option<DevKpiBinding>, AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::active_kpi_binding", {
        let conn = pool.get()?;
        let row = conn
            .query_row(
                "SELECT * FROM dev_kpi_bindings WHERE kpi_id = ?1 AND status = 'active'
                 ORDER BY datetime(created_at) DESC LIMIT 1",
                params![kpi_id],
                row_to_kpi_binding,
            )
            .ok();
        Ok(row)
    })
}

/// Activate a verified binding: archive any current active binding, insert
/// the new one as active, and flip the KPI to a live connector KPI. The KPI
/// row's identity + measurement series are untouched (switch-without-harm).
pub fn activate_kpi_binding(
    pool: &DbPool,
    kpi_id: &str,
    credential_id: &str,
    service_type: &str,
    procedure: &str,
    composed_by: &str,
) -> Result<DevKpiBinding, AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::activate_kpi_binding", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_kpi_bindings SET status = 'archived' WHERE kpi_id = ?1 AND status = 'active'",
            params![kpi_id],
        )?;
        conn.execute(
            "INSERT INTO dev_kpi_bindings (id, kpi_id, credential_id, service_type, procedure,
                composed_by, status, verified_at)
             VALUES (?1,?2,?3,?4,?5,?6,'active',datetime('now'))",
            params![id, kpi_id, credential_id, service_type, procedure, composed_by],
        )?;
        conn.execute(
            "UPDATE dev_kpis SET measure_kind = 'connector', needed_connector = NULL,
                 updated_at = datetime('now')
             WHERE id = ?1",
            params![kpi_id],
        )?;
        conn.query_row(
            "SELECT * FROM dev_kpi_bindings WHERE id = ?1",
            params![id],
            row_to_kpi_binding,
        )
        .map_err(AppError::Database)
    })
}

pub fn set_kpi_binding_status(pool: &DbPool, binding_id: &str, status: &str) -> Result<(), AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::set_kpi_binding_status", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_kpi_bindings SET status = ?1 WHERE id = ?2",
            params![status, binding_id],
        )?;
        Ok(())
    })
}
