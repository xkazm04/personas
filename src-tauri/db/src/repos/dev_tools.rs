use std::collections::{HashMap, HashSet};

use rusqlite::{params, OptionalExtension, Row};

use crate::models::{
    AttentionItem, AttentionQueue, AttentionThresholds, DevCompetition, DevCompetitionSlot,
    DevContext, DevContextFingerprint, DevContextGroup, DevContextGroupRelationship, DevGoal,
    DevGoalDependency, DevGoalItem, DevGoalSignal, DevIdea, DevKpi, DevKpiBinding,
    DevKpiMeasurement, DevMilestone, DevMilestoneItem, DevProject, DevProjectWallSummary, DevScan,
    DevStandard, DevTask, DevUseCase, GoalProgressSuggestion, PortfolioProjectSummary,
    PortfolioSummary, TriageRule, UndispatchedIdea,
};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

pub(crate) fn row_to_project(row: &Row) -> rusqlite::Result<DevProject> {
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
        llm_tracking_credential_id: row.get("llm_tracking_credential_id").unwrap_or(None),
        support_credential_id: row.get("support_credential_id").unwrap_or(None),
        data_links: row.get("data_links").unwrap_or(None),
        test_env_url: row.get("test_env_url").unwrap_or(None),
        test_env_branch: row.get("test_env_branch").unwrap_or(None),
        main_branch: row.get("main_branch").unwrap_or(None),
        standards_config: row.get("standards_config").unwrap_or(None),
        team_id: row.get("team_id").unwrap_or(None),
        workspace_id: row.get("workspace_id").unwrap_or(None),
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
        pinned: row.get::<_, i64>("pinned").map(|v| v != 0).unwrap_or(false),
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

pub(crate) fn row_to_idea(row: &Row) -> rusqlite::Result<DevIdea> {
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
        // Findings-spine columns — `unwrap_or(None)` so a row read through a
        // pre-migration connection (or a SELECT that omits them) still maps.
        origin: row.get("origin").unwrap_or(None),
        use_case_id: row.get("use_case_id").unwrap_or(None),
        evidence: row.get("evidence").unwrap_or(None),
        dedup_key: row.get("dedup_key").unwrap_or(None),
        verify_state: row.get("verify_state").unwrap_or(None),
        verify_checked_at: row.get("verify_checked_at").unwrap_or(None),
        verify_evidence: row.get("verify_evidence").unwrap_or(None),
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
        // Same tolerant read as the retry-lineage columns below: a row seen
        // through a pre-migration connection (or a SELECT that omits it) must
        // still map rather than fail the whole Run Desk.
        updated_at: row.get("updated_at").unwrap_or(None),
        depth: row
            .get::<_, Option<String>>("depth")?
            .unwrap_or_else(|| "quick".to_string()),
        // Retry-lineage columns — tolerant `unwrap_or` for the same reason as
        // `dedup_key` on ideas: a row read through a pre-migration connection
        // (or a SELECT that omits them) must still map.
        parent_task_id: row.get("parent_task_id").unwrap_or(None),
        attempt: row
            .get::<_, Option<i32>>("attempt")
            .unwrap_or(None)
            .unwrap_or(1),
    })
}

/// Warn (never reject) on a status outside `TASK_STATUSES`. Rejecting would
/// strand a task mid-run; a warning is enough to catch a new writer that
/// invents a vocabulary the Run Desk cannot render.
fn warn_unknown_task_status(status: &str, op: &str) {
    if !crate::models::TASK_STATUSES.contains(&status) {
        tracing::warn!(
            status,
            op,
            "dev_tasks: unknown status written — the Run Desk renders only {:?}",
            crate::models::TASK_STATUSES
        );
    }
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

/// Look up a dev project by its (exact) root path. Makes re-registering an
/// existing repo idempotent. Returns None when no project has that path.
pub fn get_project_by_path(pool: &DbPool, root_path: &str) -> Result<Option<DevProject>, AppError> {
    timed_query!("dev_projects", "dev_projects::get_project_by_path", {
        let conn = pool.get()?;
        match conn.query_row(
            "SELECT * FROM dev_projects WHERE root_path = ?1",
            params![root_path],
            row_to_project,
        ) {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
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
    llm_tracking_credential_id: Option<Option<&str>>,
    support_credential_id: Option<Option<&str>>,
    data_links: Option<Option<&str>>,
) -> Result<DevProject, AppError> {
    timed_query!("dev_projects", "dev_projects::update_project", {
        get_project_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(
            name.map(|s| s.to_string()),
            "name",
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
        push_field_param!(
            tech_stack.map(|o| o.map(|s| s.to_string())),
            "tech_stack",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            github_url.map(|o| o.map(|s| s.to_string())),
            "github_url",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            monitoring_credential_id.map(|o| o.map(|s| s.to_string())),
            "monitoring_credential_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            monitoring_project_slug.map(|o| o.map(|s| s.to_string())),
            "monitoring_project_slug",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            team_id.map(|o| o.map(|s| s.to_string())),
            "team_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            pr_credential_id.map(|o| o.map(|s| s.to_string())),
            "pr_credential_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            test_env_url.map(|o| o.map(|s| s.to_string())),
            "test_env_url",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            test_env_branch.map(|o| o.map(|s| s.to_string())),
            "test_env_branch",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            main_branch.map(|o| o.map(|s| s.to_string())),
            "main_branch",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            llm_tracking_credential_id.map(|o| o.map(|s| s.to_string())),
            "llm_tracking_credential_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            support_credential_id.map(|o| o.map(|s| s.to_string())),
            "support_credential_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            data_links.map(|o| o.map(|s| s.to_string())),
            "data_links",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE dev_projects SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

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
        conn.query_row(
            "SELECT * FROM dev_standards WHERE id = ?1",
            params![id],
            row_to_standard,
        )
        .map_err(Into::into)
    })
}

pub fn list_standards_by_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevStandard>, AppError> {
    timed_query!(
        "dev_standards",
        "dev_standards::list_standards_by_project",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_standards WHERE project_id = ?1 ORDER BY category, rule_key",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_standard)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        }
    )
}

pub fn clear_standards_for_project(pool: &DbPool, project_id: &str) -> Result<usize, AppError> {
    timed_query!(
        "dev_standards",
        "dev_standards::clear_standards_for_project",
        {
            let conn = pool.get()?;
            let n = conn.execute(
                "DELETE FROM dev_standards WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(n)
        }
    )
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

// ============================================================================
// Goals v2 — cross-project queries (Portfolio / Attention / Timeline / Map)
// ============================================================================

/// Every goal across all projects (project → order_index). Backs the Portfolio
/// + Timeline surfaces; the frontend joins with the project list it already holds.
pub fn list_all_goals(pool: &DbPool) -> Result<Vec<DevGoal>, AppError> {
    timed_query!("dev_goals", "dev_goals::list_all_goals", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM dev_goals ORDER BY project_id, order_index")?;
        let rows = stmt.query_map([], row_to_goal)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// First paragraph of a goal description, with the autonomous-provenance footer
/// (`\n\n---\n*Derived from KPI ...*`) stripped — the human-readable summary the
/// acceptance view shows under each goal title.
fn goal_summary(description: Option<String>) -> Option<String> {
    let d = description?;
    let head = d.split("\n---").next().unwrap_or(&d);
    let head = head.split("\n\n").next().unwrap_or(head);
    let s: String = head.trim().chars().take(200).collect();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Enriched list of goals in `awaiting_acceptance` (the human-acceptance queue),
/// joined to project + the project's owning team + the KPI each serves. Backs
/// the Goal Acceptance view; flat so the frontend groups it by project → KPI.
pub fn list_pending_acceptance(
    pool: &DbPool,
) -> Result<Vec<crate::models::PendingAcceptanceGoal>, AppError> {
    timed_query!("dev_goals", "dev_goals::list_pending_acceptance", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.description, g.project_id, g.completed_at, g.kpi_id,
                    dp.name, dp.team_id, pt.name,
                    k.name, k.unit, k.current_value, k.target_value, k.baseline_value, k.direction
             FROM dev_goals g
             JOIN dev_projects dp ON dp.id = g.project_id
             LEFT JOIN persona_teams pt ON pt.id = dp.team_id
             LEFT JOIN dev_kpis k ON k.id = g.kpi_id
             WHERE g.status = 'awaiting_acceptance'
             ORDER BY dp.name, datetime(g.completed_at) DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            let description: Option<String> = r.get(2)?;
            Ok(crate::models::PendingAcceptanceGoal {
                goal_id: r.get(0)?,
                title: r.get(1)?,
                summary: goal_summary(description),
                project_id: r.get(3)?,
                completed_at: r.get(4)?,
                kpi_id: r.get(5)?,
                project_name: r.get(6)?,
                team_id: r.get(7)?,
                team_name: r.get(8)?,
                kpi_name: r.get(9)?,
                kpi_unit: r.get(10)?,
                kpi_current: r.get(11)?,
                kpi_target: r.get(12)?,
                kpi_baseline: r.get(13)?,
                kpi_direction: r.get(14)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Cheap count of goals awaiting acceptance — backs the TitleBar pending badge.
pub fn count_pending_acceptance(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!("dev_goals", "dev_goals::count_pending_acceptance", {
        let conn = pool.get()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dev_goals WHERE status = 'awaiting_acceptance'",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    })
}

/// Every "a human must decide this" queue's pending count, in one round-trip.
///
/// The title-bar badge used to be `pending reviews + build questions` while the
/// deck it opens deals SEVEN kinds, so a reviewer with 26 pending ideas and
/// nothing else saw `0`. A number that is confidently wrong is worse than an
/// absent one, and six per-source round-trips on a poll is not a trade a badge
/// should make — hence one connection, six counts.
///
/// Build questions are deliberately absent: they live in the frontend's
/// `buildSessions` state (a halted CLI awaiting input), not in a table, so the
/// caller adds them. There is nothing here to query for them.
///
/// `u32`, not `i64`, and that is load-bearing: ts-rs maps `i64` to TypeScript
/// `bigint`, which the badge cannot add to the frontend-derived question count
/// without a conversion nothing else in the tray does. `TriageCounts` above made
/// the same choice for the same reason. A count is non-negative and will not
/// reach four billion.
#[derive(Debug, Clone, Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PendingCounts {
    pub goal_acceptance: u32,
    pub manual_reviews: u32,
    pub ideas: u32,
    pub practices: u32,
    pub policy_proposals: u32,
    pub promotion_proposals: u32,
    /// The six above. The caller adds build questions on top.
    pub total: u32,
}

/// See {@link PendingCounts}. One pooled connection, six index-backed COUNTs.
pub fn pending_counts(pool: &DbPool) -> Result<PendingCounts, AppError> {
    timed_query!("pending_counts", "pending_counts::all", {
        let conn = pool.get()?;
        let one =
            |sql: &str| -> Result<u32, AppError> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };

        let goal_acceptance =
            one("SELECT COUNT(*) FROM dev_goals WHERE status = 'awaiting_acceptance'")?;
        let manual_reviews =
            one("SELECT COUNT(*) FROM persona_manual_reviews WHERE status = 'pending'")?;
        let ideas = one("SELECT COUNT(*) FROM dev_ideas WHERE status = 'pending'")?;
        // Two statuses, not one: a practice is awaiting a human whether it was
        // observed in the wild or proposed by a harvest. See
        // `KNOWLEDGE_STATUSES` — 'adopted'/'deprecated'/'rejected' are settled.
        let practices = one(
            "SELECT COUNT(*) FROM workspace_knowledge WHERE status IN ('observed','proposed')",
        )?;
        let policy_proposals =
            one("SELECT COUNT(*) FROM policy_proposals WHERE status = 'pending'")?;
        let promotion_proposals =
            one("SELECT COUNT(*) FROM evolution_promotion_proposals WHERE status = 'pending'")?;

        Ok(PendingCounts {
            total: goal_acceptance
                + manual_reviews
                + ideas
                + practices
                + policy_proposals
                + promotion_proposals,
            goal_acceptance,
            manual_reviews,
            ideas,
            practices,
            policy_proposals,
            promotion_proposals,
        })
    })
}

/// Resolve a pending-acceptance goal. `accept` → `done` (off-board, completion
/// stamp kept) + a `goal_accepted` signal. Reject → `in-progress` (back to the
/// team's lane) with the completion stamp cleared + a `goal_rejected` signal
/// carrying the user's comment (the feedback the team reworks against).
pub fn resolve_goal_acceptance(
    pool: &DbPool,
    goal_id: &str,
    accept: bool,
    comment: Option<&str>,
) -> Result<DevGoal, AppError> {
    let goal = get_goal_by_id(pool, goal_id)?;
    if normalize_goal_status(&goal.status) != "awaiting_acceptance" {
        return Err(AppError::Validation(format!(
            "goal {goal_id} is not awaiting acceptance (status: {})",
            goal.status
        )));
    }
    if accept {
        let updated = update_goal(
            pool,
            goal_id,
            None,
            None,
            Some("done"),
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        let _ = create_goal_signal(
            pool,
            goal_id,
            "goal_accepted",
            None,
            None,
            Some("Accepted by the user."),
        );
        Ok(updated)
    } else {
        // Reject → back to the team; clear the completion stamp.
        let updated = update_goal(
            pool,
            goal_id,
            None,
            None,
            Some("in-progress"),
            None,
            None,
            None,
            None,
            Some(None),
            None,
        )?;
        let msg = comment
            .map(|c| format!("Sent back: {c}"))
            .unwrap_or_else(|| "Sent back to the team.".into());
        let _ = create_goal_signal(pool, goal_id, "goal_rejected", None, None, Some(&msg));
        Ok(updated)
    }
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
    let today_date = now.date_naive();
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
        let Some(a) = acc.get_mut(&g.project_id) else {
            continue;
        };
        a.total += 1;
        a.progress_sum += g.progress as i64;
        match normalize_goal_status(&g.status) {
            "in-progress" => a.in_progress += 1,
            "blocked" => a.blocked += 1,
            "done" => a.done += 1,
            _ => a.open += 1,
        }
        if goal_status_is_ongoing(&g.status) {
            // `target_date` is an opaque caller-supplied string -- commonly a
            // date-only "2026-07-10" from a date picker, but a lexicographic
            // compare against a full RFC3339 `now_s` flags "due today" as
            // already overdue from 00:00 (refactor-bughunt-2026-07-10 repos#5).
            // Compare on the date portion only (the first 10 chars of either
            // shape are always YYYY-MM-DD) against today's date.
            let overdue = g.target_date.as_deref().is_some_and(|d| {
                let date_part = d.get(0..10).unwrap_or(d);
                chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
                    .map(|target| target < today_date)
                    .unwrap_or(false)
            });
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

/// How long a KPI's last measurement may age before goal derivation refuses to
/// use it, in days — 2× its cadence, with manual/unknown cadences treated as
/// weekly.
///
/// This is a MIRROR of the `CASE k.cadence` window in
/// `engine/kpi_derivation.rs::find_derivation_candidates` (app crate; this one
/// is in `personas-db`, which cannot depend on it). Keep the two in sync: this
/// function exists only to report the consequence of that rule, so if it drifts
/// the attention queue starts claiming derivation stopped when it has not, or
/// stays quiet when it has.
fn kpi_freshness_window_days(cadence: &str) -> i64 {
    match cadence {
        "daily" => 2,
        // weekly → 14; `manual` and any cadence not yet wired into the
        // derivation CASE fall through to the same 14-day arm it uses.
        _ => 14,
    }
}

/// Cross-project "needs you" queue over all three record types, plus the KPIs
/// that feed them.
///
/// Nine kinds, ranked. The four GOAL kinds keep the ranks they always had —
/// awaiting_review team steps (0) → overdue goals (1) → stalled goals (2) →
/// unstaffed goals (3) — the three record-widening kinds follow: undispatched
/// ideas (4) → stuck running tasks (5) → stale queued tasks (6), and the two
/// KPI-supply kinds are appended last: `kpi_gone_dark` (7) → `kpi_never_measured`
/// (8). Appended rather than interleaved so the existing ordering contract
/// holds; within a rank the list sorts by age, worst first.
///
/// The two KPI kinds deliberately carry NO roll-up counter on `AttentionQueue`
/// (unlike the seven above): that struct lives in `personas-core` and the count
/// is derivable from `items` by `kind`. If a summary surface needs them, add
/// `kpi_gone_dark` / `kpi_never_measured` fields there and fill them here the
/// same way the others are filled.
///
/// Every cutoff comes from `thresholds` (pass `AttentionThresholds::default()`
/// for the shipped numbers) instead of the single hard-coded 7-day window that
/// used to serve for everything.
///
/// Timestamps are PARSED, never string-compared. The previous implementation
/// tested `target_date < now_rfc3339` and `updated_at < stale_before` as raw
/// strings, which is wrong in two live ways: a date-only `target_date` is a
/// lexicographic prefix of any same-day RFC3339 stamp (so a goal due TODAY read
/// as overdue), and the SQLite `datetime('now')` column default produces
/// `"2026-08-05 10:00:00"`, which sorts against RFC3339 by luck.
pub fn attention_queue(
    pool: &DbPool,
    thresholds: AttentionThresholds,
) -> Result<AttentionQueue, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now();
    let now_s = now.to_rfc3339();
    let stale_goal_cutoff = now - chrono::Duration::days(i64::from(thresholds.stale_goal_days));
    let idea_cutoff = now - chrono::Duration::days(i64::from(thresholds.idea_dispatch_days));
    let running_cutoff = now - chrono::Duration::hours(i64::from(thresholds.task_running_hours));
    let queued_cutoff = now - chrono::Duration::hours(i64::from(thresholds.task_queued_hours));
    let mut items: Vec<AttentionItem> = Vec::new();

    // 1) Team-assignment steps awaiting review (goal-linked only).
    {
        let mut stmt = conn.prepare(
            "SELECT s.id AS step_id, s.title AS step_title, s.started_at AS step_started_at,
                    a.id AS assignment_id,
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
                let goal_id: String = row.get("goal_id")?;
                let goal_title: String = row.get("goal_title")?;
                let started_at: Option<String> = row.get("step_started_at")?;
                Ok(AttentionItem {
                    kind: "awaiting_review".into(),
                    entity_kind: "goal".into(),
                    entity_id: goal_id.clone(),
                    entity_title: goal_title.clone(),
                    goal_id: Some(goal_id),
                    goal_title: Some(goal_title),
                    project_id: Some(row.get("project_id")?),
                    project_name: Some(row.get("project_name")?),
                    status: row.get("goal_status")?,
                    progress: Some(row.get::<_, Option<i32>>("goal_progress")?.unwrap_or(0)),
                    detail: row.get::<_, String>("step_title")?,
                    assignment_id: Some(row.get("assignment_id")?),
                    step_id: Some(row.get("step_id")?),
                    // How long the step has been waiting on a human.
                    age_hours: started_at
                        .as_deref()
                        .and_then(|s| hours_since(s, now))
                        .map(|h| h.max(0) as u32),
                    rank: 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        items.extend(rows);
    }
    let awaiting_review = items.len() as u32;

    // 2) Overdue + 3) stalled — from goals joined to their project.
    let mut overdue = 0u32;
    let mut stalled = 0u32;
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
            // PARSED comparison, not lexicographic. A date-only target_date
            // means end-of-day, so "due today" is not overdue.
            let deadline = g.target_date.as_deref().and_then(parse_deadline);
            if let (Some(raw), None) = (g.target_date.as_deref(), deadline) {
                tracing::warn!(
                    goal_id = %g.id,
                    target_date = %raw,
                    "attention_queue: unparseable target_date — cannot judge overdue",
                );
            }
            let touched = parse_stamp(&g.updated_at);
            if touched.is_none() {
                tracing::warn!(
                    goal_id = %g.id,
                    updated_at = %g.updated_at,
                    "attention_queue: unparseable updated_at — cannot judge stalled",
                );
            }

            if deadline.is_some_and(|d| d < now) {
                overdue += 1;
                // `days_between` on a date-only deadline measures from midnight,
                // which would round a just-expired deadline to a bare "0d
                // overdue". Say what is true instead of printing a fake number.
                let elapsed = now - deadline.expect("checked Some above");
                let days = elapsed.num_days();
                items.push(AttentionItem {
                    kind: "overdue".into(),
                    entity_kind: "goal".into(),
                    entity_id: g.id.clone(),
                    entity_title: g.title.clone(),
                    goal_id: Some(g.id),
                    goal_title: Some(g.title),
                    project_id: Some(g.project_id),
                    project_name: Some(g.project_name),
                    status: g.status,
                    progress: Some(g.progress),
                    detail: if days >= 1 {
                        format!("{days}d overdue")
                    } else {
                        "overdue (less than a day)".to_string()
                    },
                    assignment_id: None,
                    step_id: None,
                    age_hours: Some(elapsed.num_hours().max(0) as u32),
                    rank: 1,
                });
            } else if touched.is_some_and(|t| t < stale_goal_cutoff) {
                stalled += 1;
                // Unwrap-free: `days_between` returns None only when a stamp
                // fails to parse, and `touched` proved this one parses.
                let days = days_between(&g.updated_at, &now_s).unwrap_or(0);
                let age = now - touched.expect("checked Some above");
                items.push(AttentionItem {
                    kind: "stalled".into(),
                    entity_kind: "goal".into(),
                    entity_id: g.id.clone(),
                    entity_title: g.title.clone(),
                    goal_id: Some(g.id),
                    goal_title: Some(g.title),
                    project_id: Some(g.project_id),
                    project_name: Some(g.project_name),
                    status: g.status,
                    progress: Some(g.progress),
                    detail: format!("stalled {days}d"),
                    assignment_id: None,
                    step_id: None,
                    age_hours: Some(age.num_hours().max(0) as u32),
                    rank: 2,
                });
            }
        }
    }

    // 4) Unstaffed — ongoing goals with no linked team assignment. Goal-only by
    // design; see `AttentionQueue::unstaffed` for why ideas/tasks have no
    // equivalent signal.
    let mut unstaffed = 0u32;
    {
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.status, g.progress, p.id AS project_id, p.name AS project_name
             FROM dev_goals g JOIN dev_projects p ON p.id = g.project_id
             WHERE g.status NOT IN ('done','completed','complete')
               AND NOT EXISTS (SELECT 1 FROM team_assignments a WHERE a.goal_id = g.id)",
        )?;
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get("id")?;
                let title: String = row.get("title")?;
                Ok(AttentionItem {
                    kind: "unstaffed".into(),
                    entity_kind: "goal".into(),
                    entity_id: id.clone(),
                    entity_title: title.clone(),
                    goal_id: Some(id),
                    goal_title: Some(title),
                    project_id: Some(row.get("project_id")?),
                    project_name: Some(row.get("project_name")?),
                    status: row.get("status")?,
                    progress: Some(row.get::<_, Option<i32>>("progress")?.unwrap_or(0)),
                    detail: String::new(),
                    assignment_id: None,
                    step_id: None,
                    // Not an age signal — the goal is unstaffed regardless of
                    // how long it has been. Reporting one would invent urgency.
                    age_hours: None,
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

    // 5) Undispatched ideas — `accepted`, no task. See `UndispatchedIdea` for
    // why this had no query at all before.
    let mut undispatched_ideas = 0u32;
    // Not the 200-row default: `undispatched_ideas` counts the items actually
    // emitted (the same rule the goal counts follow), so a low cap would freeze
    // the number at the cap and report a lie. The clamp ceiling is still there
    // as a backstop against a pathological backlog.
    for idea in undispatched_ideas_rows(&conn, None, Some(u32::MAX))? {
        // An unparseable acceptance stamp does NOT hide the idea: the fact that
        // a human accepted it and nothing was ever dispatched is true
        // independent of age. Goals are the opposite — there the AGE is the
        // signal, so an unreadable stamp means "cannot classify" and we skip.
        let past_threshold = match parse_stamp(&idea.accepted_at) {
            Some(t) => t < idea_cutoff,
            None => {
                tracing::warn!(
                    idea_id = %idea.id,
                    accepted_at = %idea.accepted_at,
                    "attention_queue: unparseable idea stamp — reporting without an age",
                );
                true
            }
        };
        if !past_threshold {
            continue;
        }
        undispatched_ideas += 1;
        let detail = match idea.age_hours {
            Some(h) if h >= 24 => format!("accepted {}d ago, no task", h / 24),
            Some(h) => format!("accepted {h}h ago, no task"),
            None => "accepted, no task (age unknown)".to_string(),
        };
        items.push(AttentionItem {
            kind: "undispatched_idea".into(),
            entity_kind: "idea".into(),
            entity_id: idea.id,
            entity_title: idea.title,
            goal_id: None,
            goal_title: None,
            project_id: idea.project_id,
            project_name: idea.project_name,
            status: "accepted".into(),
            // An idea has no progress; 0 would read as "started, got nowhere".
            progress: None,
            detail,
            assignment_id: None,
            step_id: None,
            age_hours: idea.age_hours,
            rank: 4,
        });
    }

    // 6) Stuck running tasks + 7) stale queued tasks.
    let mut stuck_tasks = 0u32;
    let mut stale_queued_tasks = 0u32;
    {
        struct LiveTask {
            id: String,
            title: String,
            status: String,
            progress: i32,
            goal_id: Option<String>,
            goal_title: Option<String>,
            project_id: Option<String>,
            project_name: Option<String>,
            started_at: Option<String>,
            updated_at: Option<String>,
            created_at: String,
        }
        let mut stmt = conn.prepare(
            "SELECT t.id, t.title, t.status, t.progress_pct, t.goal_id,
                    g.title AS goal_title, t.project_id, p.name AS project_name,
                    t.started_at, t.updated_at, t.created_at
             FROM dev_tasks t
             LEFT JOIN dev_projects p ON p.id = t.project_id
             LEFT JOIN dev_goals g ON g.id = t.goal_id
             WHERE t.status IN ('running', 'queued')",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LiveTask {
                    id: row.get("id")?,
                    title: row.get("title")?,
                    status: row.get("status")?,
                    progress: row.get::<_, Option<i32>>("progress_pct")?.unwrap_or(0),
                    goal_id: row.get("goal_id")?,
                    goal_title: row.get("goal_title")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                    started_at: row.get("started_at")?,
                    updated_at: row.get("updated_at").unwrap_or(None),
                    created_at: row.get("created_at")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for t in rows {
            let running = t.status == "running";
            // The heartbeat. `updated_at` is written by every task mutation —
            // task_executor stamps it on each progress milestone — so for a
            // running task this is "when did we last hear anything", not "how
            // long has this been going". `started_at`/`created_at` are the
            // fallbacks for a row that predates the column.
            let last_seen_raw = if running {
                t.updated_at
                    .clone()
                    .or_else(|| t.started_at.clone())
                    .unwrap_or_else(|| t.created_at.clone())
            } else {
                t.updated_at.clone().unwrap_or_else(|| t.created_at.clone())
            };
            let Some(last_seen) = parse_stamp(&last_seen_raw) else {
                tracing::warn!(
                    task_id = %t.id,
                    stamp = %last_seen_raw,
                    "attention_queue: unparseable task stamp — cannot judge staleness",
                );
                continue;
            };
            let cutoff = if running {
                running_cutoff
            } else {
                queued_cutoff
            };
            if last_seen >= cutoff {
                continue;
            }

            let hours = (now - last_seen).num_hours().max(0) as u32;
            let (kind, rank, detail) = if running {
                stuck_tasks += 1;
                (
                    "stuck_task",
                    5,
                    format!("running, no progress for {hours}h"),
                )
            } else {
                stale_queued_tasks += 1;
                (
                    "stale_queued_task",
                    6,
                    format!("queued {hours}h, never started"),
                )
            };
            items.push(AttentionItem {
                kind: kind.into(),
                entity_kind: "task".into(),
                entity_id: t.id,
                entity_title: t.title,
                goal_id: t.goal_id,
                goal_title: t.goal_title,
                project_id: t.project_id,
                project_name: t.project_name,
                status: t.status,
                progress: Some(t.progress),
                detail,
                assignment_id: None,
                step_id: None,
                age_hours: Some(hours),
                rank,
            });
        }
    }

    // 8) KPIs whose measurement has gone dark + 9) active KPIs never measured.
    //
    // Not "this number is old" — the CONSEQUENCE. `kpi_derivation::
    // find_derivation_candidates` refuses to derive a goal from a KPI measured
    // longer ago than 2x its cadence, so past that window the KPI silently
    // stops producing work. A codebase command that started failing and a
    // connector binding that rotted both land here, and both read to the user
    // as "this KPI just isn't generating goals any more" with nothing to click.
    //
    // Cadence-relative (`kpi_freshness_window_days`), not one global cutoff: a
    // daily KPI and a quarterly one do not share a threshold, and the window
    // used here is the same one the derivation gate enforces.
    //
    // Two distinct kinds because they are two different user problems: a KPI
    // that WAS reporting and went dark is a broken measurement to repair; one
    // that was never measured at all was never wired up in the first place.
    //
    // Scoped to keep the signal worth reading:
    //   * `status = 'active'` only. A paused or archived KPI is silent on
    //     purpose and a `proposed` one has not been adopted yet; lighting the
    //     queue up for either is exactly the noise that makes a queue ignored.
    //   * projects with a team only (`p.team_id IS NOT NULL`) — the same join
    //     `find_derivation_candidates` makes. Derivation never ran for a
    //     team-less project, so "derivation has stopped" would not be TRUE of
    //     one, and this row's whole value is that its claim is true.
    //   * a never-measured KPI is not reported until it is older than its own
    //     window, so activating a KPI does not immediately accuse it.
    {
        struct LiveKpi {
            id: String,
            name: String,
            status: String,
            cadence: String,
            last_measured_at: Option<String>,
            created_at: String,
            project_id: String,
            project_name: String,
        }
        let mut stmt = conn.prepare(
            "SELECT k.id, k.name, k.status, k.cadence, k.last_measured_at, k.created_at,
                    p.id AS project_id, p.name AS project_name
             FROM dev_kpis k
             JOIN dev_projects p ON p.id = k.project_id AND p.team_id IS NOT NULL
             WHERE k.status = 'active'",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LiveKpi {
                    id: row.get("id")?,
                    name: row.get("name")?,
                    status: row.get("status")?,
                    cadence: row.get("cadence")?,
                    last_measured_at: row.get("last_measured_at")?,
                    created_at: row.get("created_at")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for k in rows {
            let window = chrono::Duration::days(kpi_freshness_window_days(&k.cadence));
            let cutoff = now - window;
            let window_days = window.num_days();

            let (kind, rank, since_raw) = match k.last_measured_at.as_deref() {
                // Measured once and then went quiet past its own window.
                Some(stamp) => {
                    let Some(measured) = parse_stamp(stamp) else {
                        tracing::warn!(
                            kpi_id = %k.id,
                            last_measured_at = %stamp,
                            "attention_queue: unparseable KPI last_measured_at — cannot judge staleness",
                        );
                        continue;
                    };
                    if measured >= cutoff {
                        continue;
                    }
                    ("kpi_gone_dark", 7, measured)
                }
                // Never measured — reported only once it has had its own window
                // to produce a first reading.
                None => {
                    let Some(created) = parse_stamp(&k.created_at) else {
                        tracing::warn!(
                            kpi_id = %k.id,
                            created_at = %k.created_at,
                            "attention_queue: unparseable KPI created_at — cannot judge staleness",
                        );
                        continue;
                    };
                    if created >= cutoff {
                        continue;
                    }
                    ("kpi_never_measured", 8, created)
                }
            };

            let elapsed = now - since_raw;
            let days = elapsed.num_days();
            let detail = if rank == 7 {
                format!(
                    "no reading in {days}d (cadence {}, derivation needs one every {window_days}d) — goal derivation has stopped for it",
                    k.cadence
                )
            } else {
                format!("active {days}d, never measured — no goal can be derived from it yet")
            };
            items.push(AttentionItem {
                kind: kind.into(),
                entity_kind: "kpi".into(),
                entity_id: k.id,
                entity_title: k.name,
                // A KPI is upstream of goals, not attached to one: naming any
                // single derived goal here would misdirect the click.
                goal_id: None,
                goal_title: None,
                project_id: Some(k.project_id),
                project_name: Some(k.project_name),
                status: k.status,
                // A KPI has no progress; 0 would read as "measured, at zero",
                // which is a completely different (and much worse) claim.
                progress: None,
                detail,
                assignment_id: None,
                step_id: None,
                age_hours: Some(elapsed.num_hours().max(0) as u32),
                rank,
            });
        }
    }

    // Rank first (the ordering contract), then oldest-first inside a rank so
    // the worst offender leads. `Option` orders `None` below `Some`, so a row
    // with an unknown age sinks rather than pretending to be urgent.
    items.sort_by(|a, b| a.rank.cmp(&b.rank).then(b.age_hours.cmp(&a.age_hours)));
    Ok(AttentionQueue {
        items,
        awaiting_review,
        overdue,
        stalled,
        unstaffed,
        undispatched_ideas,
        stuck_tasks,
        stale_queued_tasks,
        thresholds,
    })
}

/// Every `accepted` idea with no `dev_tasks` row — the query the app could not
/// answer. See `UndispatchedIdea`.
///
/// `limit` caps the result (default 200, so a backlog with thousands of
/// accepted ideas cannot blow up a panel); rows come back OLDEST FIRST because
/// the most-forgotten decision is the one worth surfacing.
pub fn list_undispatched_ideas(
    pool: &DbPool,
    project_id: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<UndispatchedIdea>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::list_undispatched_ideas", {
        let conn = pool.get()?;
        undispatched_ideas_rows(&conn, project_id, limit)
    })
}

/// Shared body of `list_undispatched_ideas` and the attention queue's idea pass,
/// so the panel and the queue can never disagree about what "undispatched" is.
fn undispatched_ideas_rows(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<UndispatchedIdea>, AppError> {
    let now = chrono::Utc::now();
    let limit = limit.unwrap_or(200).clamp(1, 5_000);
    // COALESCE(updated_at, created_at): `updated_at` is the stamp the acceptance
    // write set, so it is when the decision was made. NOT EXISTS mirrors
    // `archive_stale_ideas` — the one existing piece of prior art — but on
    // 'accepted' rather than 'pending'.
    let sql = format!(
        "SELECT i.id, i.title, i.project_id, p.name AS project_name, i.category,
                i.origin, i.priority, i.impact, i.effort,
                COALESCE(i.updated_at, i.created_at) AS accepted_at
         FROM dev_ideas i
         LEFT JOIN dev_projects p ON p.id = i.project_id
         WHERE i.status = 'accepted'
           AND NOT EXISTS (SELECT 1 FROM dev_tasks t WHERE t.source_idea_id = i.id)
           {}
         ORDER BY accepted_at ASC, i.id ASC
         LIMIT {limit}",
        if project_id.is_some() {
            "AND i.project_id = ?1"
        } else {
            ""
        },
    );
    let mut stmt = conn.prepare(&sql)?;
    let map = |row: &Row| -> rusqlite::Result<UndispatchedIdea> {
        let accepted_at: String = row.get("accepted_at")?;
        Ok(UndispatchedIdea {
            id: row.get("id")?,
            title: row.get("title")?,
            project_id: row.get("project_id")?,
            project_name: row.get("project_name")?,
            category: row.get("category")?,
            origin: row.get("origin").unwrap_or(None),
            priority: row.get("priority").unwrap_or(None),
            impact: row.get("impact")?,
            effort: row.get("effort")?,
            age_hours: hours_since(&accepted_at, now).map(|h| h.max(0) as u32),
            accepted_at,
        })
    };
    let rows = match project_id {
        Some(pid) => stmt
            .query_map(params![pid], map)?
            .collect::<Result<Vec<_>, _>>(),
        None => stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>(),
    };
    rows.map_err(AppError::Database)
}

/// Parse a stored timestamp into UTC.
///
/// Three shapes live in this database and all three must work, or the staleness
/// engine silently mis-reads its own rows:
///   - RFC3339 (`2026-08-05T10:00:00+00:00`) — what every Rust writer emits.
///   - `YYYY-MM-DD HH:MM:SS[.f]` — SQLite's `datetime('now')`, the column
///     DEFAULT that applies whenever a writer omits the column (imports, legacy
///     INSERTs). Stored in UTC.
///   - `YYYY-MM-DD` — date-only, used by `dev_goals.target_date`. Start of day.
///
/// `None` for anything else. Callers MUST treat `None` as "unknown" and never
/// as zero — conflating those two is the bug this replaced.
fn parse_stamp(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&chrono::Utc));
    }
    for fmt in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc());
        }
    }
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|d| d.and_utc())
}

/// Parse a DEADLINE. Identical to `parse_stamp` except that a date-only value
/// means the END of that day — a goal due today is not overdue until the day is
/// out. The old code compared raw strings, so `"2026-08-05"` sorted before
/// `"2026-08-05T09:00:00+00:00"` (it is a prefix) and a goal due TODAY was
/// reported overdue from midnight onward.
fn parse_deadline(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let t = s.trim();
    if let Ok(d) = chrono::NaiveDate::parse_from_str(t, "%Y-%m-%d") {
        return d.and_hms_opt(23, 59, 59).map(|d| d.and_utc());
    }
    parse_stamp(t)
}

/// Whole days between two stored timestamps (`from` → `to`), or `None` when
/// either side is unparseable.
///
/// It used to return `0` on a parse failure. That is why a goal whose
/// `updated_at` was a SQLite `datetime('now')` string rather than RFC3339
/// rendered as "stalled 0d": a malformed input and a freshly-touched one were
/// indistinguishable, and the fabricated 0 looked exactly like a real reading.
fn days_between(from: &str, to: &str) -> Option<i64> {
    let a = parse_stamp(from)?;
    let b = parse_stamp(to)?;
    Some((b - a).num_days().abs())
}

/// Whole hours from `at` until `now`, or `None` when `at` is unparseable.
fn hours_since(at: &str, now: chrono::DateTime<chrono::Utc>) -> Option<i64> {
    parse_stamp(at).map(|t| (now - t).num_hours())
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
            // Canonical pins survive a full rescan: delete only unpinned
            // contexts. This is the fix for the documented near-miss where a
            // full rescan destroyed a hand-curated map.
            let ctx_rows = conn.execute(
                "DELETE FROM dev_contexts WHERE project_id = ?1 AND pinned = 0",
                params![project_id],
            )?;
            let rel_rows = conn.execute(
                "DELETE FROM dev_context_group_relationships WHERE project_id = ?1",
                params![project_id],
            );
            let _ = rel_rows; // ok if table is empty
                              // Delete only groups that no longer own any (surviving/pinned)
                              // context, so a pinned context keeps its group.
            let grp_rows = conn.execute(
                "DELETE FROM dev_context_groups WHERE project_id = ?1 \
                 AND id NOT IN (\
                   SELECT DISTINCT group_id FROM dev_contexts \
                   WHERE project_id = ?1 AND group_id IS NOT NULL\
                 )",
                params![project_id],
            )?;
            // The rescan recreates contexts under FRESH ids. dev_use_case_contexts
            // gets a name-based reconcile afterwards, but dev_ideas.context_id and
            // dev_goals.context_id have no FK and no reconcile — null the refs we
            // just made dangling instead of leaving them pointing at deleted rows.
            conn.execute(
                "UPDATE dev_ideas SET context_id = NULL
                  WHERE project_id = ?1 AND context_id IS NOT NULL
                    AND context_id NOT IN (SELECT id FROM dev_contexts WHERE project_id = ?1)",
                params![project_id],
            )?;
            conn.execute(
                "UPDATE dev_goals SET context_id = NULL
                  WHERE project_id = ?1 AND context_id IS NOT NULL
                    AND context_id NOT IN (SELECT id FROM dev_contexts WHERE project_id = ?1)",
                params![project_id],
            )?;
            Ok((grp_rows, ctx_rows))
        }
    )
}

/// Set (or clear) the canonical-pin flag on a single context. A pinned context
/// survives a full rescan's DELETE-and-recreate. Returns the updated row.
pub fn set_context_pinned(pool: &DbPool, id: &str, pinned: bool) -> Result<DevContext, AppError> {
    timed_query!("dev_contexts", "dev_contexts::set_context_pinned", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE dev_contexts SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![pinned as i64, chrono::Utc::now().to_rfc3339(), id],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("Dev context {id}")));
        }
        get_context_by_id(pool, id)
    })
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
// Per-context structural fingerprints (derived cache)
// ============================================================================
//
// A DERIVED cache alongside the context map — never a source of truth. Rows are
// keyed by `content_hash` (a hash over a context's file list plus each file's
// sha256), so a refresh can skip every context whose files are unchanged and
// answer later structural questions with SQL instead of file reads. See
// `personas_core::context_fingerprint` for what the counters do and don't mean.

fn row_to_context_fingerprint(row: &Row) -> rusqlite::Result<DevContextFingerprint> {
    Ok(DevContextFingerprint {
        project_id: row.get("project_id")?,
        context_id: row.get("context_id")?,
        content_hash: row.get("content_hash")?,
        file_count: row.get("file_count")?,
        missing_file_count: row.get("missing_file_count")?,
        imports: row.get("imports").unwrap_or(None),
        primitives: row.get("primitives").unwrap_or(None),
        promise_all_count: row.get("promise_all_count")?,
        join_all_count: row.get("join_all_count")?,
        await_count: row.get("await_count")?,
        sql_write_count: row.get("sql_write_count")?,
        spawn_count: row.get("spawn_count")?,
        use_effect_count: row.get("use_effect_count")?,
        set_state_after_await_count: row.get("set_state_after_await_count")?,
        exports_components: row.get::<_, i64>("exports_components")? != 0,
        exports_hooks: row.get::<_, i64>("exports_hooks")? != 0,
        exports_commands: row.get::<_, i64>("exports_commands")? != 0,
        exports_repo_fns: row.get::<_, i64>("exports_repo_fns")? != 0,
        computed_at: row.get("computed_at")?,
    })
}

/// Write (or replace) one context's fingerprint. Upsert on the
/// `(project_id, context_id)` primary key so a re-refresh overwrites in place
/// and the table can never accumulate duplicate rows per context.
pub fn upsert_context_fingerprint(
    pool: &DbPool,
    fp: &DevContextFingerprint,
) -> Result<(), AppError> {
    timed_query!(
        "dev_context_fingerprints",
        "dev_context_fingerprints::upsert_context_fingerprint",
        {
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO dev_context_fingerprints (
                    project_id, context_id, content_hash, file_count, missing_file_count,
                    imports, primitives,
                    promise_all_count, join_all_count, await_count, sql_write_count,
                    spawn_count, use_effect_count, set_state_after_await_count,
                    exports_components, exports_hooks, exports_commands, exports_repo_fns,
                    computed_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    ?15, ?16, ?17, ?18, ?19
                 )
                 ON CONFLICT(project_id, context_id) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    file_count = excluded.file_count,
                    missing_file_count = excluded.missing_file_count,
                    imports = excluded.imports,
                    primitives = excluded.primitives,
                    promise_all_count = excluded.promise_all_count,
                    join_all_count = excluded.join_all_count,
                    await_count = excluded.await_count,
                    sql_write_count = excluded.sql_write_count,
                    spawn_count = excluded.spawn_count,
                    use_effect_count = excluded.use_effect_count,
                    set_state_after_await_count = excluded.set_state_after_await_count,
                    exports_components = excluded.exports_components,
                    exports_hooks = excluded.exports_hooks,
                    exports_commands = excluded.exports_commands,
                    exports_repo_fns = excluded.exports_repo_fns,
                    computed_at = excluded.computed_at",
                params![
                    fp.project_id,
                    fp.context_id,
                    fp.content_hash,
                    fp.file_count,
                    fp.missing_file_count,
                    fp.imports,
                    fp.primitives,
                    fp.promise_all_count,
                    fp.join_all_count,
                    fp.await_count,
                    fp.sql_write_count,
                    fp.spawn_count,
                    fp.use_effect_count,
                    fp.set_state_after_await_count,
                    fp.exports_components as i32,
                    fp.exports_hooks as i32,
                    fp.exports_commands as i32,
                    fp.exports_repo_fns as i32,
                    fp.computed_at,
                ],
            )?;
            Ok(())
        }
    )
}

/// All cached fingerprints for a project, ordered by `context_id` so callers
/// get a stable listing.
pub fn list_context_fingerprints(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextFingerprint>, AppError> {
    timed_query!(
        "dev_context_fingerprints",
        "dev_context_fingerprints::list_context_fingerprints",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_context_fingerprints WHERE project_id = ?1 ORDER BY context_id",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_context_fingerprint)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(AppError::Database)?);
            }
            Ok(out)
        }
    )
}

/// `{context_id: content_hash}` for a project — the skip-logic input. Reads only
/// the two columns it needs so a refresh can decide what is dirty without
/// materializing every fingerprint.
pub fn get_context_fingerprint_hashes(
    pool: &DbPool,
    project_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    timed_query!(
        "dev_context_fingerprints",
        "dev_context_fingerprints::get_context_fingerprint_hashes",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT context_id, content_hash FROM dev_context_fingerprints
                 WHERE project_id = ?1",
            )?;
            let rows = stmt.query_map(params![project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut map = HashMap::new();
            for row in rows {
                let (context_id, hash) = row.map_err(AppError::Database)?;
                map.insert(context_id, hash);
            }
            Ok(map)
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
        // Fetch the context first so a non-existent id fails loudly (NotFound)
        // rather than the UPDATE silently affecting 0 rows and reporting success.
        let ctx = get_context_by_id(pool, id)?;

        let conn = pool.get()?;
        // Validate the target group exists AND belongs to the same project. The
        // group_id FK (ON DELETE SET NULL) doesn't guarantee per-connection FK
        // enforcement is enabled, and never enforces same-project — so without
        // this a context could be silently moved into a non-existent group or a
        // group from another project, orphaning its grouping.
        if let Some(gid) = group_id {
            let ok: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_context_groups WHERE id = ?1 AND project_id = ?2",
                    params![gid, ctx.project_id],
                    |r| r.get::<_, i64>(0),
                )
                .map(|c| c > 0)
                .unwrap_or(false);
            if !ok {
                return Err(AppError::Validation(format!(
                    "Group {gid} does not exist in project {}",
                    ctx.project_id
                )));
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE dev_contexts SET group_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![group_id, now, id],
        )?;
        if rows == 0 {
            // Context vanished between the fetch and the UPDATE (concurrent delete).
            return Err(AppError::NotFound(format!("Dev context {id}")));
        }
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

// ----------------------------------------------------------------------------
// Triage page — keyset pagination + facet counts
//
// `list_ideas` is OFFSET-paginated and count-blind; the triage surface needs a
// stable cursor (rows are inserted while a human triages) and bucket counts
// that survive pagination. Both live here rather than in the command layer so
// the SQL is testable without a Tauri app handle.
// ----------------------------------------------------------------------------

/// Pseudo-origin the triage UI uses for classic Idea-Scanner ideas: only
/// findings-spine sensors stamp a real `origin`, so "scanner" means
/// `origin IS NULL`. Kept as a constant so the filter and the count bucket
/// label can never drift apart.
pub const TRIAGE_SCANNER_ORIGIN: &str = "scanner";

/// Default / maximum page size for `triage_ideas`.
const TRIAGE_DEFAULT_LIMIT: i64 = 50;
const TRIAGE_MAX_LIMIT: i64 = 200;

/// Filters for one triage page. All optional; `project_id: None` is an
/// explicit cross-project read (the unified Backlog default), NOT "no filter
/// chosen yet".
#[derive(Debug, Clone, Default)]
pub struct TriageFilter {
    pub project_id: Option<String>,
    /// Defaults to `pending` when unset.
    pub status: Option<String>,
    /// `scanner` is the pseudo-value for `origin IS NULL`.
    pub origin: Option<String>,
    pub category: Option<String>,
}

/// Bucket counts for the triage surface. Scoped to the NON-status filters, so
/// the status tabs can show every bucket's size while one status is displayed.
#[derive(Debug, Clone, Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriageCounts {
    pub total: u32,
    pub pending: u32,
    pub accepted: u32,
    pub rejected: u32,
    pub archived: u32,
    /// Keyed by origin, with `scanner` standing in for `origin IS NULL`.
    pub by_origin: HashMap<String, u32>,
    pub by_category: HashMap<String, u32>,
}

/// One keyset page of triage ideas plus the counts the facet rail renders.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriagePage {
    pub ideas: Vec<DevIdea>,
    /// `"{created_at}|{id}"` of the last row, or `None` when the page is last.
    pub cursor: Option<String>,
    pub has_more: bool,
    pub counts: TriageCounts,
}

/// WHERE fragments for everything EXCEPT status — shared by the page query and
/// all three count rollups so a filtered page and its counts can't disagree.
fn triage_scope_clauses(
    filter: &TriageFilter,
) -> (Vec<String>, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(pid) = &filter.project_id {
        clauses.push("project_id = ?".to_string());
        params.push(Box::new(pid.clone()));
    }
    match filter.origin.as_deref() {
        Some(TRIAGE_SCANNER_ORIGIN) => clauses.push("origin IS NULL".to_string()),
        Some(origin) => {
            clauses.push("origin = ?".to_string());
            params.push(Box::new(origin.to_string()));
        }
        None => {}
    }
    if let Some(category) = &filter.category {
        clauses.push("category = ?".to_string());
        params.push(Box::new(category.clone()));
    }

    (clauses, params)
}

fn triage_counts(
    conn: &rusqlite::Connection,
    filter: &TriageFilter,
) -> Result<TriageCounts, AppError> {
    let (clauses, params) = triage_scope_clauses(filter);
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let group = |expr: &str| -> Result<HashMap<String, u32>, AppError> {
        let sql = format!(
            "SELECT {expr} AS bucket, COUNT(*) AS n FROM dev_ideas{where_sql} GROUP BY bucket"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok((
                row.get::<_, String>("bucket")?,
                row.get::<_, i64>("n")?.max(0) as u32,
            ))
        })?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(AppError::Database)
    };

    let by_status = group("status")?;
    let by_origin = group(&format!("COALESCE(origin, '{TRIAGE_SCANNER_ORIGIN}')"))?;
    let by_category = group("category")?;

    let bucket = |name: &str| by_status.get(name).copied().unwrap_or(0);
    Ok(TriageCounts {
        total: by_status.values().sum(),
        pending: bucket("pending"),
        accepted: bucket("accepted"),
        rejected: bucket("rejected"),
        archived: bucket("archived"),
        by_origin,
        by_category,
    })
}

/// One keyset page of ideas for the triage surface, newest first.
///
/// Ordering is `created_at DESC, id DESC` and the cursor is the last row's
/// `"{created_at}|{id}"`; `id` breaks ties so two ideas written in the same
/// millisecond can never hide each other across a page boundary. `limit + 1`
/// rows are fetched to learn `has_more` without a second COUNT.
pub fn triage_ideas(
    pool: &DbPool,
    filter: &TriageFilter,
    limit: Option<i64>,
    cursor: Option<&str>,
) -> Result<TriagePage, AppError> {
    timed_query!("dev_ideas", "dev_ideas::triage_ideas", {
        let limit = limit
            .unwrap_or(TRIAGE_DEFAULT_LIMIT)
            .clamp(1, TRIAGE_MAX_LIMIT);
        let status = filter.status.as_deref().unwrap_or("pending");

        let (mut clauses, mut params) = triage_scope_clauses(filter);
        clauses.push("status = ?".to_string());
        params.push(Box::new(status.to_string()));

        if let Some(raw) = cursor.filter(|c| !c.is_empty()) {
            let (created_at, id) = raw
                .split_once('|')
                .ok_or_else(|| AppError::Validation(format!("Malformed triage cursor: {raw}")))?;
            clauses.push("(created_at < ? OR (created_at = ? AND id < ?))".to_string());
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(id.to_string()));
        }

        let sql = format!(
            "SELECT * FROM dev_ideas WHERE {} ORDER BY created_at DESC, id DESC LIMIT {}",
            clauses.join(" AND "),
            limit + 1
        );

        let conn = pool.get()?;
        let mut ideas: Vec<DevIdea> = {
            let mut stmt = conn.prepare(&sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), row_to_idea)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        let has_more = ideas.len() as i64 > limit;
        if has_more {
            ideas.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            ideas.last().map(|i| format!("{}|{}", i.created_at, i.id))
        } else {
            None
        };

        let counts = triage_counts(&conn, filter)?;
        Ok(TriagePage {
            ideas,
            cursor: next_cursor,
            has_more,
            counts,
        })
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
/// Filler words dropped when normalizing an idea title into a dedup token.
/// Deliberately conservative — only words that never carry the *subject* of an
/// idea. Verbs ("add", "fix", "extract") stay: dropping them would collapse
/// "add retry" and "remove retry" onto the same key.
const IDEA_TITLE_STOPWORDS: &[&str] = &[
    "a", "an", "the", "to", "for", "in", "of", "and", "or", "on", "with", "into", "from", "at",
    "by", "is", "are", "be", "that", "this", "its", "it",
];

/// Normalize an idea title into a stable dedup token: lowercased, split on
/// non-alphanumerics, filler words dropped, first 12 significant words joined
/// with `-`. Two rewordings of the same idea ("Add retry to the fetch helper" /
/// "Add retry to fetch helper") collapse to one token, so a re-scan cannot
/// re-surface an item the backlog already holds under a slightly new phrasing.
pub fn normalize_idea_title(title: &str) -> String {
    let mut words: Vec<String> = title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !IDEA_TITLE_STOPWORDS.contains(w))
        .map(|w| w.to_string())
        .collect();
    words.truncate(12);
    words.join("-")
}

/// Stable dedup key for an LLM-scanner idea. Shares the findings spine's
/// `<producer>:<signal>` key space (see `create_finding`) so BOTH writers into
/// `dev_ideas` are governed by the same idempotency guard — the scanner is no
/// longer a second, unguarded door into the backlog.
///
/// `scope` is the context scoping of the scan (a context id, or `all` for a
/// whole-project scan): the same title raised for two different areas of the
/// codebase is genuinely two ideas, so the scope is part of the identity.
pub fn scan_dedup_key(scan_type: &str, scope: Option<&str>, title: &str) -> String {
    format!(
        "scan:{}:{}:{}",
        scan_type,
        scope.unwrap_or("all"),
        normalize_idea_title(title)
    )
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
    #[allow(clippy::too_many_arguments)]
    insert_idea(
        pool,
        project_id,
        context_id,
        scan_type,
        category,
        title,
        description,
        reasoning,
        status,
        effort,
        impact,
        risk,
        provider,
        model,
        None,
    )
}

/// `create_idea` + the findings spine's idempotency guard. Returns `Ok(None)`
/// when an idea with this `dedup_key` already exists for the project **in ANY
/// status** — including `rejected` and `archived`, so a human "no" and an aged
/// -out item both stay durable and are never re-proposed.
///
/// This is the gate every *generated* idea goes through (LLM scanner, static
/// scan, reflection product-findings, Strategist proposals). Hand-written ideas
/// (`dev_tools_create_idea`) keep the ungated `create_idea` — a human typing a
/// duplicate on purpose is a decision, not a defect.
#[allow(clippy::too_many_arguments)]
pub fn create_idea_deduped(
    pool: &DbPool,
    project_id: &str,
    context_id: Option<&str>,
    scan_type: &str,
    category: Option<&str>,
    title: &str,
    description: Option<&str>,
    reasoning: Option<&str>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    provider: Option<&str>,
    model: Option<&str>,
    dedup_key: &str,
) -> Result<Option<DevIdea>, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if dedup_key.trim().is_empty() {
        return Err(AppError::Validation(
            "Idea dedup_key cannot be empty".into(),
        ));
    }

    {
        let conn = pool.get()?;
        let existing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND dedup_key = ?2",
            params![project_id, dedup_key],
            |r| r.get(0),
        )?;
        if existing > 0 {
            return Ok(None);
        }
    }

    match insert_idea(
        pool,
        Some(project_id),
        context_id,
        scan_type,
        category,
        title,
        description,
        reasoning,
        Some("pending"),
        effort,
        impact,
        risk,
        provider,
        model,
        Some(dedup_key),
    ) {
        Ok(idea) => Ok(Some(idea)),
        // Lost the race to a concurrent writer — same contract as the COUNT
        // guard above: the key exists, so this creation is a no-op.
        Err(e) if is_dedup_unique_violation(&e) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Whether an error is the partial-unique `idx_dev_ideas_dedup_unique` firing —
/// i.e. we lost a dedup race another writer won. The COUNT pre-checks in the
/// guarded doors are a fast-path courtesy; THIS is the actual guarantee.
fn is_dedup_unique_violation(err: &AppError) -> bool {
    matches!(
        err,
        AppError::Database(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

/// The single INSERT both `create_idea` and `create_idea_deduped` go through,
/// so the column set can never drift between the guarded and unguarded doors.
#[allow(clippy::too_many_arguments)]
fn insert_idea(
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
    dedup_key: Option<&str>,
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
            .and_then(crate::models::IdeaCategory::from_token)
            .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);
        let category = canonical_category.as_str();
        let status = status.unwrap_or("pending");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, description, reasoning, status, effort, impact, risk, provider, model, dedup_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
            params![id, project_id, context_id, scan_type, category, title, description, reasoning, status, effort, impact, risk, provider, model, dedup_key, now],
        )?;

        get_idea_by_id(pool, &id)
    })
}

/// Reversible aging for the backlog: pending SCANNER ideas older than
/// `older_than_days` that never became work (no linked task) move to
/// `archived`. Mirrors the memory engine's `run_decay_forgetting` — nothing is
/// deleted, the row keeps its `dedup_key` (so archiving can never reopen the
/// duplication door), and a human can restore it by setting the status back to
/// `pending`.
///
/// Sensor FINDINGS (`origin IS NOT NULL`) are excluded: their lifecycle
/// belongs to the sensors — every sweep re-measures them — and because dedup
/// blocks re-emission in ANY status, aging one out would silence that sensor
/// signal permanently on a 30-day timer nobody chose.
///
/// Returns the number of ideas archived.
pub fn archive_stale_ideas(
    pool: &DbPool,
    project_id: Option<&str>,
    older_than_days: i64,
) -> Result<i64, AppError> {
    if older_than_days <= 0 {
        return Err(AppError::Validation(
            "archive_stale_ideas: older_than_days must be positive".into(),
        ));
    }

    timed_query!("dev_ideas", "dev_ideas::archive_stale_ideas", {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(older_than_days)).to_rfc3339();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let affected = match project_id {
            Some(pid) => conn.execute(
                "UPDATE dev_ideas SET status = 'archived', updated_at = ?1
                 WHERE status = 'pending' AND created_at < ?2 AND project_id = ?3
                   AND origin IS NULL
                   AND NOT EXISTS (SELECT 1 FROM dev_tasks WHERE dev_tasks.source_idea_id = dev_ideas.id)",
                params![now, cutoff, pid],
            )?,
            None => conn.execute(
                "UPDATE dev_ideas SET status = 'archived', updated_at = ?1
                 WHERE status = 'pending' AND created_at < ?2
                   AND origin IS NULL
                   AND NOT EXISTS (SELECT 1 FROM dev_tasks WHERE dev_tasks.source_idea_id = dev_ideas.id)",
                params![now, cutoff],
            )?,
        };

        Ok(affected as i64)
    })
}

/// Create an idea raised by a SENSOR rather than the Idea Scanner — the findings
/// spine (`docs/plans/dev-findings-loop.md`). Separate from `create_idea` so the
/// scanner's 14-arg signature and every existing call site stay untouched.
///
/// `dedup_key` is the idempotency guard: if a non-deleted idea already carries it
/// for this project, nothing is inserted and `Ok(None)` comes back. That includes
/// `rejected` ideas — a human "no" is durable, and only deleting the idea frees
/// the key for re-emission.
#[allow(clippy::too_many_arguments)]
pub fn create_finding(
    pool: &DbPool,
    project_id: &str,
    origin: &str,
    title: &str,
    description: Option<&str>,
    category: Option<&str>,
    context_id: Option<&str>,
    use_case_id: Option<&str>,
    evidence: Option<&str>,
    dedup_key: &str,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
) -> Result<Option<DevIdea>, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if !crate::models::FINDING_ORIGINS.contains(&origin) {
        return Err(AppError::Validation(format!(
            "Unknown finding origin: {origin}"
        )));
    }
    if dedup_key.trim().is_empty() {
        return Err(AppError::Validation(
            "Finding dedup_key cannot be empty".into(),
        ));
    }

    timed_query!("dev_ideas", "dev_ideas::create_finding", {
        let conn = pool.get()?;

        let existing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND dedup_key = ?2",
            params![project_id, dedup_key],
            |r| r.get(0),
        )?;
        if existing > 0 {
            return Ok(None);
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let canonical_category = category
            .and_then(crate::models::IdeaCategory::from_token)
            .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);

        let inserted = conn.execute(
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, description, status, effort, impact, risk, origin, use_case_id, evidence, dedup_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            params![
                id,
                project_id,
                context_id,
                origin, // scan_type doubles as the sensor tag, so the Scoreboard groups findings too
                canonical_category.as_str(),
                title,
                description,
                effort,
                impact,
                risk,
                origin,
                use_case_id,
                evidence,
                dedup_key,
                now
            ],
        );
        match inserted {
            Ok(_) => {}
            // Lost the dedup race to a concurrent sweep — same contract as the
            // COUNT guard above (the partial UNIQUE index is the real guarantee).
            Err(e) => {
                let err = AppError::Database(e);
                if is_dedup_unique_violation(&err) {
                    return Ok(None);
                }
                return Err(err);
            }
        }

        drop(conn);
        let idea = get_idea_by_id(pool, &id)?;
        // A sensor raised something — tell the bus. `signal.raised` is what the
        // dispatch ops (Task Runner vs Fleet) will route off.
        publish_signal_event(
            pool,
            &idea,
            personas_core::events::event_name::SIGNAL_RAISED,
        );
        Ok(Some(idea))
    })
}

/// Publish a findings-loop SIGNAL onto the persona-event bus.
///
/// Called from `create_finding` and `set_finding_verify_state` — i.e. from the repo,
/// not from the sweep — so every path that raises a finding or lands a verdict emits,
/// and no future caller can silently starve a route by forgetting to. These events are
/// what the dispatch ops route off (`signal.raised` → run it; `signal.verified` → learn
/// from it), and they surface in the Live Stream for free.
///
/// Best-effort: a bus failure must never fail the write that triggered it. The finding
/// is the source of truth; the event is a notification.
fn publish_signal_event(pool: &DbPool, idea: &DevIdea, event_type: &str) {
    let payload = serde_json::json!({
        "idea_id": idea.id,
        "origin": idea.origin,
        "dedup_key": idea.dedup_key,
        "title": idea.title,
        "project_id": idea.project_id,
        "context_id": idea.context_id,
        "use_case_id": idea.use_case_id,
        "impact": idea.impact,
        "effort": idea.effort,
        "risk": idea.risk,
        "verify_state": idea.verify_state,
        "evidence": idea.evidence,
    });
    let input = crate::models::CreatePersonaEventInput {
        event_type: event_type.to_string(),
        source_type: "findings".into(),
        source_id: Some(idea.id.clone()),
        // No target persona: a signal is an observation, not an instruction. A trigger
        // (or a dispatch op) decides who — if anyone — acts on it.
        target_persona_id: None,
        project_id: idea.project_id.clone(),
        payload: Some(payload.to_string()),
        use_case_id: idea.use_case_id.clone(),
    };
    if let Err(e) = crate::repos::communication::events::publish(pool, input) {
        tracing::warn!(error = %e, event_type, "failed to publish findings signal event");
    }
}

/// Record a verification verdict on a finding (Phase 3A). `verify_evidence` is the
/// re-measured reading, so the verdict can be audited against the original
/// `evidence` instead of taken on trust.
pub fn set_finding_verify_state(
    pool: &DbPool,
    id: &str,
    verify_state: &str,
    verify_evidence: Option<&str>,
) -> Result<(), AppError> {
    if !crate::models::VERIFY_STATES.contains(&verify_state) {
        return Err(AppError::Validation(format!(
            "Unknown verify_state: {verify_state}"
        )));
    }
    timed_query!("dev_ideas", "dev_ideas::set_verify_state", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_ideas SET verify_state = ?1, verify_evidence = ?2, verify_checked_at = ?3, updated_at = ?3 WHERE id = ?4",
            params![verify_state, verify_evidence, now, id],
        )?;
        drop(conn);

        // A verdict landed — tell the bus. This is what B-side learning and any
        // future "the fix regressed, re-open it" route hang off.
        //
        // `pending` is NOT a verdict: the sweep writes it when a sensor did not
        // probe, and `finalize_task` writes it to ARM a re-check when work
        // ships. Publishing `signal.verified` for either would announce a
        // judgement nobody made and put a "verified" row in the Live Stream for
        // an unjudged finding. Arming is silent; only real verdicts speak.
        if verify_state != "pending" {
            if let Ok(idea) = get_idea_by_id(pool, id) {
                publish_signal_event(
                    pool,
                    &idea,
                    personas_core::events::event_name::SIGNAL_VERIFIED,
                );
            }
        }
        Ok(())
    })
}

/// Every dedup key already spoken for on this project — the sweep's pre-filter,
/// so N drafts cost one query instead of N existence checks.
pub fn list_finding_dedup_keys(pool: &DbPool, project_id: &str) -> Result<Vec<String>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::list_dedup_keys", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT dedup_key FROM dev_ideas WHERE project_id = ?1 AND dedup_key IS NOT NULL",
        )?;
        let rows = stmt.query_map(params![project_id], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
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
            let canonical = crate::models::IdeaCategory::from_token(v)
                .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);
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

/// Compare-and-swap a backlog idea's triage status.
///
/// The status write behind [`crate::repos::dev_tools`]-fed verdicts, with the
/// `AND status = ?expected` predicate that `update_idea` never had. Reviews got
/// this in `manual_reviews::update_status`; ideas did not, so two surfaces
/// holding the same row could each write a verdict and each fire its own side
/// effects (the decision memory, the workspace adoption sync) — leaving a
/// `rejected` constraint memory attached to an `accepted` idea with nothing
/// warning anyone.
///
/// `expected` is the status the CALLER SAW, not a re-read: that is the whole
/// point. A deck that dealt a `pending` row passes `pending`, so a verdict
/// written from a stale card loses to whoever already decided. A reviewer
/// deliberately changing their mind from the Backlog table passes the status
/// the row actually shows and still wins — reversing a decision you can see is
/// a decision; overwriting one you never saw is data loss.
///
/// Returns [`AppError::Validation`] on a lost swap. The MESSAGE is a contract:
/// `src/lib/decisions/rowWrites.ts` (`isDecisionConflict`) and the error registry
/// both match `/already (decided|resolved) … by a concurrent action/` to tell a
/// lost swap apart from a failed write — the two make optimistic surfaces behave
/// differently, so reword it and they silently degrade to "could not record that
/// decision". `src/lib/decisions/__tests__/rowWrites.test.ts` pins the exact
/// strings all three row types emit.
pub fn decide_idea_cas(
    pool: &DbPool,
    id: &str,
    expected: &str,
    new_status: &str,
    rejection_reason: Option<Option<&str>>,
) -> Result<DevIdea, AppError> {
    timed_query!("dev_ideas", "dev_ideas::decide_idea_cas", {
        // Existence check: a missing row must read as NotFound, never as a
        // conflict.
        get_idea_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // Two statements rather than one COALESCE: a reject that carries no
        // reason must be able to write NULL (matching `update_idea`'s
        // `Option<Option<_>>` contract), while an accept must not touch the
        // column at all.
        let rows = match rejection_reason {
            Some(reason) => conn.execute(
                "UPDATE dev_ideas SET status = ?1, rejection_reason = ?2, updated_at = ?3
                 WHERE id = ?4 AND status = ?5",
                params![new_status, reason, now, id, expected],
            )?,
            None => conn.execute(
                "UPDATE dev_ideas SET status = ?1, updated_at = ?2 WHERE id = ?3 AND status = ?4",
                params![new_status, now, id, expected],
            )?,
        };

        if rows == 0 {
            // Re-read so the message names the status that actually won, not
            // the one the loser was holding.
            let actual = get_idea_by_id(pool, id)?;
            return Err(AppError::Validation(format!(
                "Backlog idea {id} was already decided as '{}' by a concurrent action",
                actual.status
            )));
        }

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
        warn_unknown_task_status(status, "create_task");
        let depth = depth.unwrap_or("quick");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, depth, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
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
        if let Some(s) = status {
            warn_unknown_task_status(s, "update_task");
        }
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
            // Nothing actually changed — do NOT bump updated_at. Every caller
            // that passes all-None is a no-op, and stamping one would forge a
            // heartbeat the attention queue reads as "this task is alive".
            return get_task_by_id(pool, id);
        }

        // Every real mutation stamps updated_at. This is the single choke point:
        // task_executor.rs drives all of its writes (start, progress milestones,
        // output-volume fallback, terminal status) through this function, so
        // stamping here covers every path that touches a task.
        let touched_at = chrono::Utc::now().to_rfc3339();
        sets.push(format!("updated_at = ?{param_idx}"));
        param_idx += 1;

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
        param_values.push(Box::new(touched_at));
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

/// One keyset page of tasks plus per-status counts. Same cursor scheme as
/// `triage_ideas` (`"{created_at}|{id}"`, `created_at DESC, id DESC`).
/// `list_tasks` stays untouched for the existing unpaginated callers.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TasksPage {
    pub tasks: Vec<DevTask>,
    pub cursor: Option<String>,
    pub has_more: bool,
    /// Per-status totals scoped to the project (NOT to the status filter), so
    /// status chips stay truthful beyond the loaded page.
    pub counts: HashMap<String, u32>,
}

const TASKS_PAGE_DEFAULT_LIMIT: i64 = 40;
const TASKS_PAGE_MAX_LIMIT: i64 = 200;

pub fn tasks_page(
    pool: &DbPool,
    project_id: Option<&str>,
    statuses: Option<&[String]>,
    limit: Option<i64>,
    cursor: Option<&str>,
) -> Result<TasksPage, AppError> {
    timed_query!("dev_tasks", "dev_tasks::tasks_page", {
        let limit = limit
            .unwrap_or(TASKS_PAGE_DEFAULT_LIMIT)
            .clamp(1, TASKS_PAGE_MAX_LIMIT);

        let mut clauses: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(pid) = project_id {
            clauses.push("project_id = ?".to_string());
            params.push(Box::new(pid.to_string()));
        }
        // An empty `statuses` vec is "no status filter", not "match nothing" —
        // an empty IN () is a SQL error and a blank filter chip must not
        // silently blank the list.
        if let Some(list) = statuses.filter(|s| !s.is_empty()) {
            let placeholders = vec!["?"; list.len()].join(", ");
            clauses.push(format!("status IN ({placeholders})"));
            for s in list {
                params.push(Box::new(s.clone()));
            }
        }
        if let Some(raw) = cursor.filter(|c| !c.is_empty()) {
            let (created_at, id) = raw
                .split_once('|')
                .ok_or_else(|| AppError::Validation(format!("Malformed tasks cursor: {raw}")))?;
            clauses.push("(created_at < ? OR (created_at = ? AND id < ?))".to_string());
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(id.to_string()));
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", clauses.join(" AND "))
        };
        let sql = format!(
            "SELECT * FROM dev_tasks{where_sql} ORDER BY created_at DESC, id DESC LIMIT {}",
            limit + 1
        );

        let conn = pool.get()?;
        let mut tasks: Vec<DevTask> = {
            let mut stmt = conn.prepare(&sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), row_to_task)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        let has_more = tasks.len() as i64 > limit;
        if has_more {
            tasks.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            tasks.last().map(|t| format!("{}|{}", t.created_at, t.id))
        } else {
            None
        };

        let counts: HashMap<String, u32> = {
            let (count_sql, count_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
                match project_id {
                    Some(pid) => (
                        "SELECT status, COUNT(*) AS n FROM dev_tasks WHERE project_id = ? GROUP BY status"
                            .to_string(),
                        vec![Box::new(pid.to_string())],
                    ),
                    None => (
                        "SELECT status, COUNT(*) AS n FROM dev_tasks GROUP BY status".to_string(),
                        Vec::new(),
                    ),
                };
            let mut stmt = conn.prepare(&count_sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                count_params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), |row| {
                    Ok((
                        row.get::<_, String>("status")?,
                        row.get::<_, i64>("n")?.max(0) as u32,
                    ))
                })?
                .collect::<Result<HashMap<_, _>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        Ok(TasksPage {
            tasks,
            cursor: next_cursor,
            has_more,
            counts,
        })
    })
}

/// Create a fresh `queued` task as a re-attempt of `task_id`.
///
/// The title is copied VERBATIM — no `[Retry] ` prefix. The prefix used to
/// accumulate across attempts and, worse, it changed the text the executor
/// prompts with, so a retry was not a re-run of the same instruction. Lineage
/// lives in `parent_task_id` / `attempt`, which the UI renders as a chip.
pub fn retry_task(pool: &DbPool, task_id: &str) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::retry_task", {
        let parent = get_task_by_id(pool, task_id)?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, depth, parent_task_id, attempt, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, ?10)",
            params![
                id,
                parent.project_id,
                parent.title,
                parent.description,
                parent.source_idea_id,
                parent.goal_id,
                parent.depth,
                parent.id,
                parent.attempt.saturating_add(1),
                now,
            ],
        )?;

        get_task_by_id(pool, &id)
    })
}

// ============================================================================
// Auto-runs (durable record of a backlog-draining wave)
// ============================================================================

/// One durable auto-run row. The in-memory `AUTO_RUN_JOBS` map is the live
/// view; this table is what survives a restart, so the Run Desk banner can
/// rehydrate instead of silently forgetting an in-flight run.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DevAutoRun {
    pub id: String,
    pub project_id: Option<String>,
    pub status: String,
    pub snapshot_size: u32,
    pub completed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub iterations: u32,
    pub termination_reason: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

fn row_to_auto_run(row: &Row) -> rusqlite::Result<DevAutoRun> {
    let num = |v: Option<i64>| v.unwrap_or(0).max(0) as u32;
    Ok(DevAutoRun {
        id: row.get("id")?,
        project_id: row.get("project_id").unwrap_or(None),
        status: row
            .get::<_, Option<String>>("status")?
            .unwrap_or_else(|| "running".to_string()),
        snapshot_size: num(row.get("snapshot_size")?),
        completed: num(row.get("completed")?),
        failed: num(row.get("failed")?),
        skipped: num(row.get("skipped")?),
        iterations: num(row.get("iterations")?),
        termination_reason: row.get("termination_reason").unwrap_or(None),
        started_at: row.get("started_at").unwrap_or(None),
        finished_at: row.get("finished_at").unwrap_or(None),
    })
}

/// Record the start of an auto-run. Best-effort by contract at the call site:
/// a failed bookkeeping write must never abort the run itself.
pub fn start_auto_run(
    pool: &DbPool,
    run_id: &str,
    project_id: &str,
    snapshot_size: u32,
) -> Result<(), AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::start_auto_run", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT OR REPLACE INTO dev_auto_runs
                (id, project_id, status, snapshot_size, completed, failed, skipped, iterations, termination_reason, started_at, finished_at)
             VALUES (?1, ?2, 'running', ?3, 0, 0, 0, 0, NULL, ?4, NULL)",
            params![
                run_id,
                project_id,
                snapshot_size,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    })
}

#[allow(clippy::too_many_arguments)]
pub fn finish_auto_run(
    pool: &DbPool,
    run_id: &str,
    status: &str,
    completed: u32,
    failed: u32,
    skipped: u32,
    iterations: u32,
    termination_reason: &str,
) -> Result<(), AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::finish_auto_run", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_auto_runs
                SET status = ?2, completed = ?3, failed = ?4, skipped = ?5,
                    iterations = ?6, termination_reason = ?7, finished_at = ?8
              WHERE id = ?1",
            params![
                run_id,
                status,
                completed,
                failed,
                skipped,
                iterations,
                termination_reason,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    })
}

/// Flip only the status of an auto-run row (cancel / panic arms), leaving the
/// tallies for the completion arm to fill in if it still gets to run. A panic
/// or a cancel that never reaches completion must not leave the row `running`
/// forever — a stuck `running` row is what makes the banner lie after restart.
pub fn set_auto_run_status(pool: &DbPool, run_id: &str, status: &str) -> Result<(), AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::set_auto_run_status", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_auto_runs SET status = ?2, finished_at = COALESCE(finished_at, ?3) WHERE id = ?1",
            params![run_id, status, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    })
}

/// Most recent auto-run row, optionally scoped to a project.
pub fn latest_auto_run(
    pool: &DbPool,
    project_id: Option<&str>,
) -> Result<Option<DevAutoRun>, AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::latest_auto_run", {
        let conn = pool.get()?;
        let row = match project_id {
            Some(pid) => conn
                .query_row(
                    "SELECT * FROM dev_auto_runs WHERE project_id = ?1 ORDER BY started_at DESC LIMIT 1",
                    params![pid],
                    row_to_auto_run,
                )
                .optional()?,
            None => conn
                .query_row(
                    "SELECT * FROM dev_auto_runs ORDER BY started_at DESC LIMIT 1",
                    [],
                    row_to_auto_run,
                )
                .optional()?,
        };
        Ok(row)
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

use crate::models::{ContextHealthSnapshot, DevPipeline};

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

use crate::models::{
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
                // Scanner batch — not a sensor finding.
                origin: None,
                use_case_id: None,
                evidence: None,
                dedup_key: None,
                verify_state: None,
                verify_checked_at: None,
                verify_evidence: None,
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

        entries.sort_by_key(|e| std::cmp::Reverse(e.project_count));
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
) -> Result<Vec<crate::models::DevStrategyStats>, AppError> {
    use crate::models::DevStrategyStats;
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
    use super::{
        days_between, goal_status_is_ongoing, normalize_goal_status, parse_deadline, parse_stamp,
    };

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
        let project =
            super::create_project(&pool, "P", "/tmp/goal-door", None, None, None, None, None)
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

// ============================================================================
// KPIs (outcome layer above goals — docs/plans/kpi-driven-orchestration.md)
// ============================================================================

pub fn row_to_kpi(row: &Row) -> rusqlite::Result<DevKpi> {
    Ok(DevKpi {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        context_group_id: row.get("context_group_id")?,
        context_id: row.get("context_id").unwrap_or(None),
        use_case_id: row.get("use_case_id").unwrap_or(None),
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
        last_skip_at: row.get("last_skip_at").unwrap_or(None),
        last_skip_rationale: row.get("last_skip_rationale").unwrap_or(None),
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
        env: row.get("env")?,
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
        let mut sql = String::from("SELECT * FROM dev_kpis WHERE project_id = ?1");
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
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_kpi(pool: &DbPool, id: &str) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::get_kpi", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_kpis WHERE id = ?1",
            params![id],
            row_to_kpi,
        )
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
    use_case_id: Option<&str>,
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
                created_by, rationale, needed_connector, metric_type, context_id, use_case_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
            params![
                id,
                project_id,
                context_group_id,
                name.trim(),
                description,
                category,
                measure_kind,
                measure_config,
                unit,
                direction,
                baseline_value,
                target_value,
                target_date,
                cadence,
                status.unwrap_or("proposed"),
                created_by,
                rationale,
                needed_connector,
                metric_type,
                context_id,
                use_case_id
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
    use_case_id: Option<Option<&str>>,
) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::update_kpi", {
        let conn = pool.get()?;
        // Build SET clause field-by-field (small N; clarity over cleverness).
        let mut sets: Vec<String> = vec!["updated_at = datetime('now')".into()];
        let mut vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let push = |sets: &mut Vec<String>,
                    col: &str,
                    v: Box<dyn rusqlite::types::ToSql>,
                    vals: &mut Vec<Box<dyn rusqlite::types::ToSql>>| {
            vals.push(v);
            sets.push(format!("{col} = ?{}", vals.len()));
        };
        if let Some(v) = name {
            push(&mut sets, "name", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = description {
            push(
                &mut sets,
                "description",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = context_group_id {
            push(
                &mut sets,
                "context_group_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = context_id {
            push(
                &mut sets,
                "context_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = use_case_id {
            push(
                &mut sets,
                "use_case_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = category {
            push(&mut sets, "category", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = measure_kind {
            push(
                &mut sets,
                "measure_kind",
                Box::new(v.to_string()),
                &mut vals,
            );
        }
        if let Some(v) = measure_config {
            push(
                &mut sets,
                "measure_config",
                Box::new(v.to_string()),
                &mut vals,
            );
        }
        if let Some(v) = unit {
            push(&mut sets, "unit", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = direction {
            push(&mut sets, "direction", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = baseline_value {
            push(&mut sets, "baseline_value", Box::new(v), &mut vals);
        }
        if let Some(v) = target_value {
            push(&mut sets, "target_value", Box::new(v), &mut vals);
        }
        if let Some(v) = target_date {
            push(
                &mut sets,
                "target_date",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = cadence {
            push(&mut sets, "cadence", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = status {
            push(&mut sets, "status", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = needed_connector {
            push(
                &mut sets,
                "needed_connector",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = metric_type {
            push(
                &mut sets,
                "metric_type",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = tier {
            push(&mut sets, "tier", Box::new(v.to_string()), &mut vals);
        }
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
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
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
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::list_kpi_measurements_bulk",
        {
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
            let mut params: Vec<&dyn rusqlite::types::ToSql> = kpi_ids
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();
            params.push(&per_kpi);
            let rows =
                stmt.query_map(rusqlite::params_from_iter(params), row_to_kpi_measurement)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
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
        let rows = stmt.query_map(
            params![kpi_id, limit.unwrap_or(100)],
            row_to_kpi_measurement,
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
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
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::record_kpi_measurement",
        {
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
        }
    )
}

/// Record a SIMULATED measurement (docs/plans/kpi-simulation-skill.md).
/// Deliberately does NOT roll `current_value`/`last_measured_at` forward —
/// simulated values are advisory series points and must never drive pace,
/// off-track derivation, or autopilot. `env` is restricted to the
/// non-production channels: a simulation never claims production.
pub fn record_kpi_simulation_measurement(
    pool: &DbPool,
    kpi_id: &str,
    value: f64,
    env: &str,
    evidence: Option<&str>,
    note: Option<&str>,
) -> Result<DevKpiMeasurement, AppError> {
    if !matches!(env, "local" | "test") {
        return Err(AppError::Validation(format!(
            "Simulation env must be 'local' or 'test', got '{env}' — simulated values never claim production"
        )));
    }
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::record_kpi_simulation_measurement",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence, note)
             VALUES (?1,?2,?3,'simulation',?4,?5,?6)",
                params![id, kpi_id, value, env, evidence, note],
            )?;
            conn.query_row(
                "SELECT * FROM dev_kpi_measurements WHERE id = ?1",
                params![id],
                row_to_kpi_measurement,
            )
            .map_err(AppError::Database)
        }
    )
}

/// Record an AI-COMPOSED measurement — the reading a Factory "measurement
/// setup" compose run produced by ACTUALLY RUNNING the command it had just
/// written.
///
/// Its own door, for the same reason `record_kpi_simulation_measurement` has
/// one: the class of a value is a property of the WRITER, not of a string the
/// caller happens to pass. Two invariants the generic recorder cannot enforce:
///
///  * `evidence` is REQUIRED. An evidence-free composed value is exactly the
///    row `ingest_kpi_sim` refuses; the compose run always holds the cmd/parse/
///    output that produced the number, so there is no honest case for dropping
///    it on the floor.
///  * `env` is written EXPLICITLY. The column defaults to `'production'`, so a
///    composed reading used to claim production by omission instead of by
///    decision. The command really did run against the project's working tree,
///    so `'production'` is the right answer — it is now stated rather than
///    inherited.
///
/// Unlike the simulation door this DOES roll `current_value` /
/// `last_measured_at` forward: it is a real measurement of the real repo, the
/// same act the evaluator performs.
pub fn record_kpi_compose_measurement(
    pool: &DbPool,
    kpi_id: &str,
    value: f64,
    evidence: &str,
    note: Option<&str>,
) -> Result<DevKpiMeasurement, AppError> {
    if !value.is_finite() {
        return Err(AppError::Validation(
            "AI-composed measurement value is not a finite number".into(),
        ));
    }
    if evidence.trim().is_empty() {
        return Err(AppError::Validation(
            "An AI-composed measurement must carry evidence — a value without provenance is refused"
                .into(),
        ));
    }
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::record_kpi_compose_measurement",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence, note)
                 VALUES (?1,?2,?3,'ai-compose','production',?4,?5)",
                params![id, kpi_id, value, evidence, note],
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
        }
    )
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
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
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
            params![
                id,
                kpi_id,
                credential_id,
                service_type,
                procedure,
                composed_by
            ],
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

pub fn set_kpi_binding_status(
    pool: &DbPool,
    binding_id: &str,
    status: &str,
) -> Result<(), AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::set_kpi_binding_status", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_kpi_bindings SET status = ?1 WHERE id = ?2",
            params![status, binding_id],
        )?;
        Ok(())
    })
}

// ============================================================================
// Use cases (behavioral slice layer — docs/plans/use-case-slice-layer.md)
// ============================================================================

const USE_CASE_KINDS: [&str; 4] = ["user_flow", "capability", "integration", "ops"];
const USE_CASE_STATUSES: [&str; 3] = ["proposed", "active", "archived"];

/// Normalize a human name into the stable join key: lowercase, every run of
/// non-alphanumerics collapsed to a single `-`, trimmed. Also the function that
/// normalizes an observability pinpoint's use-case name before matching, so
/// `"Checkout Conversion"`, `"checkout_conversion"` and `"checkout-conversion"`
/// all resolve to the same use case.
pub fn slugify_use_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending_sep = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_sep && !out.is_empty() {
                out.push('-');
            }
            pending_sep = false;
            out.extend(ch.to_lowercase());
        } else {
            pending_sep = true;
        }
    }
    out
}

fn row_to_use_case(row: &Row) -> rusqlite::Result<DevUseCase> {
    Ok(DevUseCase {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        slug: row.get("slug")?,
        description: row.get("description")?,
        kind: row.get("kind")?,
        primary_context_id: row.get("primary_context_id")?,
        status: row.get("status")?,
        created_by: row.get("created_by")?,
        pinned: row.get::<_, i64>("pinned").unwrap_or(0) != 0,
        rationale: row.get("rationale")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        context_ids: Vec::new(),
    })
}

/// Attach each use case's context slice in one query (no N+1).
fn hydrate_use_case_contexts(
    conn: &rusqlite::Connection,
    use_cases: &mut [DevUseCase],
) -> Result<(), AppError> {
    if use_cases.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; use_cases.len()].join(",");
    let sql = format!(
        "SELECT use_case_id, context_id FROM dev_use_case_contexts
          WHERE use_case_id IN ({placeholders})"
    );
    let ids: Vec<&str> = use_cases.iter().map(|u| u.id.as_str()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut by_id: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (uc_id, ctx_id) = row?;
        by_id.entry(uc_id).or_default().push(ctx_id);
    }
    drop(stmt);
    for uc in use_cases.iter_mut() {
        uc.context_ids = by_id.remove(&uc.id).unwrap_or_default();
    }
    Ok(())
}

/// List a project's use cases, optionally filtered by status. Active first,
/// then the proposal queue, then archived; alphabetical within each band.
pub fn list_use_cases(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevUseCase>, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::list_use_cases", {
        let conn = pool.get()?;
        let mut sql = String::from("SELECT * FROM dev_use_cases WHERE project_id = ?1");
        if status.is_some() {
            sql.push_str(" AND status = ?2");
        }
        sql.push_str(
            " ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, name",
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = match status {
            Some(st) => stmt.query_map(params![project_id, st], row_to_use_case)?,
            None => stmt.query_map(params![project_id], row_to_use_case)?,
        };
        let mut out: Vec<DevUseCase> = rows.collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        hydrate_use_case_contexts(&conn, &mut out)?;
        Ok(out)
    })
}

pub fn get_use_case(pool: &DbPool, id: &str) -> Result<DevUseCase, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::get_use_case", {
        let conn = pool.get()?;
        let mut uc = conn
            .query_row(
                "SELECT * FROM dev_use_cases WHERE id = ?1",
                params![id],
                row_to_use_case,
            )
            .map_err(|_| AppError::NotFound(format!("Use case {id} not found")))?;
        hydrate_use_case_contexts(&conn, std::slice::from_mut(&mut uc))?;
        Ok(uc)
    })
}

/// Every non-archived use case whose slice includes `context_id` — powers the
/// Context Map's per-context use-case list.
pub fn list_use_cases_for_context(
    pool: &DbPool,
    context_id: &str,
) -> Result<Vec<DevUseCase>, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::list_for_context", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT u.* FROM dev_use_cases u
               JOIN dev_use_case_contexts ucc ON ucc.use_case_id = u.id
              WHERE ucc.context_id = ?1 AND u.status != 'archived'
              ORDER BY u.name",
        )?;
        let rows = stmt.query_map(params![context_id], row_to_use_case)?;
        let mut out: Vec<DevUseCase> = rows.collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        hydrate_use_case_contexts(&conn, &mut out)?;
        Ok(out)
    })
}

/// Replace a use case's context slice wholesale. Unknown context ids are
/// ignored rather than erroring — a caller resolving names against a map that
/// just changed should not lose the whole write.
fn write_use_case_contexts(
    conn: &rusqlite::Connection,
    use_case_id: &str,
    context_ids: &[String],
) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM dev_use_case_contexts WHERE use_case_id = ?1",
        params![use_case_id],
    )?;
    for cid in context_ids {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO dev_use_case_contexts (use_case_id, context_id) VALUES (?1, ?2)",
            params![use_case_id, cid],
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn create_use_case(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    description: Option<&str>,
    kind: &str,
    primary_context_id: Option<&str>,
    context_ids: &[String],
    status: Option<&str>,
    created_by: &str,
    rationale: Option<&str>,
) -> Result<DevUseCase, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Use case name cannot be empty".into()));
    }
    let slug = slugify_use_case(name);
    if slug.is_empty() {
        return Err(AppError::Validation(
            "Use case name must contain at least one alphanumeric character".into(),
        ));
    }
    let kind = if USE_CASE_KINDS.contains(&kind) {
        kind
    } else {
        "capability"
    };
    let status = status
        .filter(|s| USE_CASE_STATUSES.contains(s))
        .unwrap_or("active");
    timed_query!("dev_use_cases", "dev_use_cases::create_use_case", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_use_cases (id, project_id, name, slug, description, kind,
                primary_context_id, status, created_by, rationale)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                id,
                project_id,
                name,
                slug,
                description,
                kind,
                primary_context_id,
                status,
                created_by,
                rationale
            ],
        )
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(err, _)
                if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
            {
                AppError::Validation(format!("A use case named \"{name}\" already exists"))
            }
            other => AppError::Database(other),
        })?;
        write_use_case_contexts(&conn, &id, context_ids)?;
        drop(conn);
        get_use_case(pool, &id)
    })
}

/// Field-wise update; `Option<Option<...>>` distinguishes "leave unchanged" from
/// "set NULL". `context_ids: Some(..)` replaces the whole slice.
#[allow(clippy::too_many_arguments)]
pub fn update_use_case(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    kind: Option<&str>,
    primary_context_id: Option<Option<&str>>,
    status: Option<&str>,
    pinned: Option<bool>,
    context_ids: Option<&[String]>,
) -> Result<DevUseCase, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::update_use_case", {
        let conn = pool.get()?;
        let mut sets: Vec<String> = vec!["updated_at = datetime('now')".into()];
        let mut vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let push = |sets: &mut Vec<String>,
                    col: &str,
                    v: Box<dyn rusqlite::types::ToSql>,
                    vals: &mut Vec<Box<dyn rusqlite::types::ToSql>>| {
            vals.push(v);
            sets.push(format!("{col} = ?{}", vals.len()));
        };
        if let Some(v) = name {
            let v = v.trim();
            if v.is_empty() {
                return Err(AppError::Validation("Use case name cannot be empty".into()));
            }
            push(&mut sets, "name", Box::new(v.to_string()), &mut vals);
            // The join key follows the display name — a rename re-points
            // telemetry matching at the new label.
            push(&mut sets, "slug", Box::new(slugify_use_case(v)), &mut vals);
        }
        if let Some(v) = description {
            push(
                &mut sets,
                "description",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = kind.filter(|k| USE_CASE_KINDS.contains(k)) {
            push(&mut sets, "kind", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = primary_context_id {
            push(
                &mut sets,
                "primary_context_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = status.filter(|s| USE_CASE_STATUSES.contains(s)) {
            push(&mut sets, "status", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = pinned {
            push(&mut sets, "pinned", Box::new(v as i64), &mut vals);
        }
        let sql = format!(
            "UPDATE dev_use_cases SET {} WHERE id = ?{}",
            sets.join(", "),
            vals.len() + 1
        );
        vals.push(Box::new(id.to_string()));
        let n = conn.execute(
            &sql,
            rusqlite::params_from_iter(vals.iter().map(|b| b.as_ref())),
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("Use case {id} not found")));
        }
        if let Some(ids) = context_ids {
            write_use_case_contexts(&conn, id, ids)?;
        }
        drop(conn);
        get_use_case(pool, id)
    })
}

pub fn delete_use_case(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::delete_use_case", {
        let conn = pool.get()?;
        let n = conn.execute("DELETE FROM dev_use_cases WHERE id = ?1", params![id])?;
        Ok(n > 0)
    })
}

// ---------------------------------------------------------------------------
// Rescan survival: snapshot before, reconcile after, keyed by context NAME.
//
// A full rescan DELETEs unpinned `dev_contexts` rows and recreates them under
// fresh ids. With `PRAGMA foreign_keys = ON` that (a) cascade-deletes the
// use-case slice and (b) NULLs `dev_kpis.context_id` — the latter a silent
// data-loss bug that predates this layer. Contexts are re-emitted under stable
// kebab names, so the name is the natural reconciliation key.
// ---------------------------------------------------------------------------

/// The context links that a full rescan would destroy, captured by name.
#[derive(Debug, Default, Clone)]
pub struct ContextLinkSnapshot {
    /// (use_case_id, context_name) — the slice.
    pub use_case_contexts: Vec<(String, String)>,
    /// (use_case_id, context_name) — each use case's primary context.
    pub use_case_primary: Vec<(String, String)>,
    /// (kpi_id, context_name) — context-scoped KPIs.
    pub kpi_contexts: Vec<(String, String)>,
}

impl ContextLinkSnapshot {
    pub fn is_empty(&self) -> bool {
        self.use_case_contexts.is_empty()
            && self.use_case_primary.is_empty()
            && self.kpi_contexts.is_empty()
    }
}

/// How reconciliation went: links restored vs links whose context is gone.
#[derive(Debug, Default, Clone, Copy)]
pub struct ReconcileReport {
    pub relinked: usize,
    pub dropped: usize,
}

pub fn snapshot_context_links(
    pool: &DbPool,
    project_id: &str,
) -> Result<ContextLinkSnapshot, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::snapshot_context_links", {
        let conn = pool.get()?;
        let collect = |sql: &str| -> Result<Vec<(String, String)>, AppError> {
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        };
        Ok(ContextLinkSnapshot {
            use_case_contexts: collect(
                "SELECT ucc.use_case_id, c.name
                   FROM dev_use_case_contexts ucc
                   JOIN dev_contexts c ON c.id = ucc.context_id
                   JOIN dev_use_cases u ON u.id = ucc.use_case_id
                  WHERE u.project_id = ?1",
            )?,
            use_case_primary: collect(
                "SELECT u.id, c.name
                   FROM dev_use_cases u
                   JOIN dev_contexts c ON c.id = u.primary_context_id
                  WHERE u.project_id = ?1",
            )?,
            kpi_contexts: collect(
                "SELECT k.id, c.name
                   FROM dev_kpis k
                   JOIN dev_contexts c ON c.id = k.context_id
                  WHERE k.project_id = ?1",
            )?,
        })
    })
}

/// Re-resolve a snapshot's context names against the freshly-written map and
/// restore every link that still has a home. Idempotent, so a delta rescan
/// (which never deletes contexts) is a cheap no-op. Links whose context
/// genuinely disappeared are dropped honestly and counted.
///
/// Restores are conservative: `primary_context_id` / `dev_kpis.context_id` are
/// only written when currently NULL, so a user edit made during the scan wins.
pub fn reconcile_context_links(
    pool: &DbPool,
    project_id: &str,
    snap: &ContextLinkSnapshot,
) -> Result<ReconcileReport, AppError> {
    if snap.is_empty() {
        return Ok(ReconcileReport::default());
    }
    timed_query!("dev_use_cases", "dev_use_cases::reconcile_context_links", {
        let conn = pool.get()?;
        let by_name: HashMap<String, String> = {
            let mut stmt =
                conn.prepare("SELECT id, name FROM dev_contexts WHERE project_id = ?1")?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok((
                    r.get::<_, String>(1)?.to_lowercase(),
                    r.get::<_, String>(0)?,
                ))
            })?;
            rows.collect::<Result<HashMap<_, _>, _>>()?
        };
        let mut report = ReconcileReport::default();

        for (uc_id, ctx_name) in &snap.use_case_contexts {
            match by_name.get(&ctx_name.to_lowercase()) {
                Some(ctx_id) => {
                    let n = conn.execute(
                        "INSERT OR IGNORE INTO dev_use_case_contexts (use_case_id, context_id)
                         VALUES (?1, ?2)",
                        params![uc_id, ctx_id],
                    )?;
                    report.relinked += n;
                }
                None => report.dropped += 1,
            }
        }
        for (uc_id, ctx_name) in &snap.use_case_primary {
            if let Some(ctx_id) = by_name.get(&ctx_name.to_lowercase()) {
                report.relinked += conn.execute(
                    "UPDATE dev_use_cases SET primary_context_id = ?1
                      WHERE id = ?2 AND primary_context_id IS NULL",
                    params![ctx_id, uc_id],
                )?;
            }
        }
        for (kpi_id, ctx_name) in &snap.kpi_contexts {
            match by_name.get(&ctx_name.to_lowercase()) {
                Some(ctx_id) => {
                    // Restoring the context also restores the documented
                    // invariant that context_group_id is its parent group.
                    report.relinked += conn.execute(
                        "UPDATE dev_kpis
                            SET context_id = ?1,
                                context_group_id = COALESCE(
                                    (SELECT group_id FROM dev_contexts WHERE id = ?1),
                                    context_group_id)
                          WHERE id = ?2 AND context_id IS NULL",
                        params![ctx_id, kpi_id],
                    )?;
                }
                None => report.dropped += 1,
            }
        }
        Ok(report)
    })
}

/// A backfilled use case must span at least this many contexts.
///
/// Measured on a real 263-context map: 179 of 184 distinct `business_feature`
/// labels covered exactly ONE context, and 89 of them were literally the
/// context's own kebab name — the model's own doc says the label "often equals
/// the context name". Promoting those 1:1 would mint a use case per context:
/// the degenerate "use case == context" model this whole layer exists to avoid,
/// and ~49 junk proposals for a single project. A deterministic pass cannot tell
/// a genuine single-context behavior from a context's title, so it only claims
/// the labels that demonstrably cut across contexts. The LLM scan makes the
/// judgement calls.
const MIN_BACKFILL_CONTEXTS: usize = 2;
/// Backstop so a pathological map cannot flood the triage queue.
const MAX_BACKFILL_USE_CASES: usize = 25;

/// Deterministic seed for the layer: promote each `dev_contexts.business_feature`
/// label that spans **two or more** contexts into a `proposed` use case sliced
/// across them. No LLM. Existing slugs are skipped, so a re-run only adds what is
/// new. Primary context = the one with most files.
///
/// Returning an empty list is a normal, correct outcome: it means no label in
/// this map describes anything larger than a single context, and the use cases
/// have to come from the scan (or a human) instead.
pub fn backfill_use_cases_from_business_features(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevUseCase>, AppError> {
    let contexts = list_contexts_by_project(pool, project_id, None)?;
    let existing: HashSet<String> = list_use_cases(pool, project_id, None)?
        .into_iter()
        .map(|u| u.slug)
        .collect();

    // business_feature label → contexts carrying it (insertion-ordered).
    let mut buckets: Vec<(String, Vec<DevContext>)> = Vec::new();
    for ctx in contexts {
        let Some(label) = ctx
            .business_feature
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let label = label.to_string();
        match buckets
            .iter_mut()
            .find(|(l, _)| l.eq_ignore_ascii_case(&label))
        {
            Some((_, list)) => list.push(ctx),
            None => buckets.push((label, vec![ctx])),
        }
    }

    let mut created = Vec::new();
    for (label, ctxs) in buckets {
        if created.len() >= MAX_BACKFILL_USE_CASES {
            break;
        }
        // A label on one context is that context's title, not a slice through
        // contexts. Leave it to the scan.
        if ctxs.len() < MIN_BACKFILL_CONTEXTS {
            continue;
        }
        if existing.contains(&slugify_use_case(&label)) {
            continue;
        }
        let file_count = |c: &DevContext| {
            serde_json::from_str::<Vec<String>>(&c.file_paths)
                .map(|v| v.len())
                .unwrap_or(0)
        };
        let primary = ctxs
            .iter()
            .max_by_key(|c| file_count(c))
            .map(|c| c.id.clone());
        let ids: Vec<String> = ctxs.iter().map(|c| c.id.clone()).collect();
        let rationale = format!(
            "Promoted from the business_feature label on {} context{}.",
            ids.len(),
            if ids.len() == 1 { "" } else { "s" }
        );
        match create_use_case(
            pool,
            project_id,
            &label,
            None,
            "capability",
            primary.as_deref(),
            &ids,
            Some("proposed"),
            "backfill",
            Some(&rationale),
        ) {
            Ok(uc) => created.push(uc),
            // A concurrent writer took the slug — skip, don't fail the batch.
            Err(AppError::Validation(_)) => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(created)
}

// ============================================================================
// Milestones (Ship layer — convergence cuts; see dev_milestones migration)
// ============================================================================

fn row_to_milestone(row: &Row) -> rusqlite::Result<DevMilestone> {
    Ok(DevMilestone {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        goal: row.get("goal")?,
        status: row.get("status")?,
        order_index: row.get("order_index")?,
        target_date: row.get("target_date")?,
        cut_at: row.get("cut_at")?,
        shipped_at: row.get("shipped_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_milestone_item(row: &Row) -> rusqlite::Result<DevMilestoneItem> {
    Ok(DevMilestoneItem {
        milestone_id: row.get("milestone_id")?,
        item_kind: row.get("item_kind")?,
        item_id: row.get("item_id")?,
        bucket: row.get("bucket")?,
        added_after_cut: row.get::<_, i64>("added_after_cut")? != 0,
        order_index: row.get("order_index")?,
        created_at: row.get("created_at")?,
        description: row.get("description")?,
        rating: row.get("rating")?,
    })
}

pub fn list_milestones_by_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevMilestone>, AppError> {
    timed_query!("dev_milestones", "dev_milestones::list_by_project", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_milestones WHERE project_id = ?1 ORDER BY order_index, created_at",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_milestone)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn create_milestone(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    goal: Option<&str>,
    status: Option<&str>,
    target_date: Option<&str>,
) -> Result<DevMilestone, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation(
            "Milestone name cannot be empty".into(),
        ));
    }
    let status = status.unwrap_or("planned");
    if !["planned", "active", "shipped"].contains(&status) {
        return Err(AppError::Validation(format!(
            "Invalid milestone status `{status}`"
        )));
    }
    // A milestone cannot be BORN shipped. `update_milestone` already refuses
    // the planned → shipped jump, but creation was only checking enum
    // membership — so the management HTTP API, a Fleet dispatch or the A2A
    // gateway could mint a 'shipped' row with `cut_at` NULL (the INSERT's CASE
    // only stamps for 'active') and `shipped_at` never set. That row is
    // invisible to velocity, which reads `shipped_at`, and reports 'setup' on
    // scope-frozen because it has no cut. Ship is a TRANSITION, not a state
    // you can start in.
    if status == "shipped" {
        return Err(AppError::Validation(
            "A milestone cannot be created shipped; create it active (cut) and then ship it".into(),
        ));
    }

    timed_query!("dev_milestones", "dev_milestones::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let order_index: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) + 1 FROM dev_milestones WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        // `cut_at` is stamped in the SAME insert when the milestone is born
        // 'active'. It is the scope-creep baseline, and a milestone created
        // directly active (the seeded "Onboard to Personas" one, and any
        // milestone the management API / a Fleet dispatch creates active)
        // never passes through `update_milestone`'s → 'active' transition —
        // so without this its `cut_at` would stay NULL forever and every item
        // added later would report `added_after_cut = false`.
        conn.execute(
            "INSERT INTO dev_milestones (id, project_id, name, goal, status, order_index, target_date, cut_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CASE WHEN ?5 = 'active' THEN ?8 ELSE NULL END, ?8, ?8)",
            params![id, project_id, name.trim(), goal, status, order_index, target_date, now],
        )?;
        drop(conn);
        get_milestone_by_id(pool, &id)
    })
}

pub fn get_milestone_by_id(pool: &DbPool, id: &str) -> Result<DevMilestone, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_milestones WHERE id = ?1",
        params![id],
        row_to_milestone,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Milestone {id}")),
        other => AppError::Database(other),
    })
}

/// Patch-style update. Status transitions stamp their timestamps: → 'active'
/// stamps `cut_at` (first time only — the scope-creep baseline), → 'shipped'
/// stamps `shipped_at`.
#[allow(clippy::too_many_arguments)]
pub fn update_milestone(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    goal: Option<&str>,
    status: Option<&str>,
    target_date: Option<&str>,
    order_index: Option<i32>,
) -> Result<DevMilestone, AppError> {
    timed_query!("dev_milestones", "dev_milestones::update", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        if let Some(name) = name {
            if name.trim().is_empty() {
                return Err(AppError::Validation(
                    "Milestone name cannot be empty".into(),
                ));
            }
            conn.execute(
                "UPDATE dev_milestones SET name = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, name.trim(), now],
            )?;
        }
        if let Some(goal) = goal {
            conn.execute(
                "UPDATE dev_milestones SET goal = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, goal, now],
            )?;
        }
        if let Some(status) = status {
            if !["planned", "active", "shipped"].contains(&status) {
                return Err(AppError::Validation(format!(
                    "Invalid milestone status `{status}`"
                )));
            }
            // A milestone must be CUT before it can ship. The exit-criteria
            // check lives client-side (a `disabled` attribute), which means
            // the management HTTP API, a Fleet dispatch or the A2A gateway
            // could otherwise mark a never-cut milestone shipped. Read the
            // current status on the same connection and refuse the jump.
            let current: String = conn
                .query_row(
                    "SELECT status FROM dev_milestones WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => {
                        AppError::NotFound(format!("Milestone {id}"))
                    }
                    other => AppError::Database(other),
                })?;
            if status == "shipped" && current == "planned" {
                return Err(AppError::Validation(
                    "A milestone must be cut (set active) before it can be shipped".into(),
                ));
            }
            conn.execute(
                "UPDATE dev_milestones SET status = ?2, updated_at = ?3,
                    cut_at = CASE WHEN ?2 = 'active' AND cut_at IS NULL THEN ?3 ELSE cut_at END,
                    shipped_at = CASE WHEN ?2 = 'shipped' THEN ?3 ELSE shipped_at END
                 WHERE id = ?1",
                params![id, status, now],
            )?;
        }
        if let Some(target_date) = target_date {
            conn.execute(
                "UPDATE dev_milestones SET target_date = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, target_date, now],
            )?;
        }
        if let Some(order_index) = order_index {
            conn.execute(
                "UPDATE dev_milestones SET order_index = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, order_index, now],
            )?;
        }
        drop(conn);
        get_milestone_by_id(pool, id)
    })
}

/// ONE grouped read for the WHOLE L1 passport wall.
///
/// The wall used to fan three per-project calls out (`list_contexts_by_project`
/// + `list_kpis` + `list_milestones_by_project`), so drawing N covers cost 3N
/// IPC round trips and 3N queries. This is one query per table with a single
/// `WHERE project_id IN (…)`, then a client-side regroup — 1 IPC call and 3
/// queries regardless of N.
///
/// Projects with no contexts / no active KPIs / no milestones still get a row
/// (zeroed / empty), and rows come back in the caller's `project_ids` order so
/// the wall never has to reconcile ordering. Unknown ids yield an empty row
/// rather than an error — the wall must not fail because one project was
/// deregistered mid-session.
pub fn project_wall_summaries(
    pool: &DbPool,
    project_ids: &[String],
) -> Result<Vec<DevProjectWallSummary>, AppError> {
    if project_ids.is_empty() {
        return Ok(Vec::new());
    }
    // SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 32766; a wall of that many
    // projects is not a real shape, but refuse rather than emit invalid SQL.
    if project_ids.len() > 5_000 {
        return Err(AppError::Validation(
            "Too many projects in one wall-summary request (max 5000)".into(),
        ));
    }

    timed_query!("dev_projects", "dev_projects::wall_summaries", {
        let conn = pool.get()?;
        let placeholders = vec!["?"; project_ids.len()].join(",");
        let binds: Vec<&dyn rusqlite::ToSql> = project_ids
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();

        let mut contexts_count: HashMap<String, i32> = HashMap::new();
        {
            let mut stmt = conn.prepare(&format!(
                "SELECT project_id, COUNT(*) FROM dev_contexts
                 WHERE project_id IN ({placeholders}) GROUP BY project_id",
            ))?;
            let rows = stmt.query_map(binds.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            })?;
            for row in rows {
                let (project_id, count) = row.map_err(AppError::Database)?;
                contexts_count.insert(project_id, count);
            }
        }

        let mut active_kpis: HashMap<String, Vec<DevKpi>> = HashMap::new();
        {
            // Same ordering as `list_kpis` for the active slice (created_at
            // DESC) so a cover's KPI set is identical to the detail view's.
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM dev_kpis
                 WHERE project_id IN ({placeholders}) AND status = 'active'
                 ORDER BY created_at DESC",
            ))?;
            let rows = stmt.query_map(binds.as_slice(), row_to_kpi)?;
            for row in rows {
                let kpi = row.map_err(AppError::Database)?;
                active_kpis
                    .entry(kpi.project_id.clone())
                    .or_default()
                    .push(kpi);
            }
        }

        let mut milestones: HashMap<String, Vec<DevMilestone>> = HashMap::new();
        {
            // Mirrors `list_milestones_by_project`'s ORDER BY exactly — the
            // roadmap strip is positional, so a different order is a different
            // picture.
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM dev_milestones
                 WHERE project_id IN ({placeholders})
                 ORDER BY order_index, created_at",
            ))?;
            let rows = stmt.query_map(binds.as_slice(), row_to_milestone)?;
            for row in rows {
                let m = row.map_err(AppError::Database)?;
                milestones.entry(m.project_id.clone()).or_default().push(m);
            }
        }

        Ok(project_ids
            .iter()
            .map(|project_id| DevProjectWallSummary {
                project_id: project_id.clone(),
                contexts_count: contexts_count.get(project_id).copied().unwrap_or(0),
                // `cloned`, not `remove`: a duplicated id in the request must
                // still answer both slots rather than silently emptying one.
                active_kpis: active_kpis.get(project_id).cloned().unwrap_or_default(),
                milestones: milestones.get(project_id).cloned().unwrap_or_default(),
            })
            .collect())
    })
}

pub fn delete_milestone(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let affected = conn.execute("DELETE FROM dev_milestones WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("Milestone {id}")));
    }
    Ok(())
}

pub fn list_milestone_items(
    pool: &DbPool,
    milestone_id: &str,
) -> Result<Vec<DevMilestoneItem>, AppError> {
    timed_query!("dev_milestones", "dev_milestones::list_items", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_milestone_items WHERE milestone_id = ?1
             ORDER BY bucket, order_index, created_at",
        )?;
        let rows = stmt.query_map(params![milestone_id], row_to_milestone_item)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Upsert a scope member. `added_after_cut` is derived here, not passed in:
/// a NEW membership created while the milestone is already 'active' (cut) is
/// scope creep by definition; re-bucketing an existing member keeps its flag.
///
/// `description` and `rating` follow this file's nullable-patch convention
/// (`update_kpi` / `update_goal`): the outer `Option` is "was this field sent
/// at all" and the inner one is the value, so `None` leaves the column
/// untouched and `Some(None)` clears it. That distinction matters most for
/// `rating` — NULL is UNRATED, which is not the same judgement as a 1.
#[allow(clippy::too_many_arguments)]
pub fn set_milestone_item(
    pool: &DbPool,
    milestone_id: &str,
    item_kind: &str,
    item_id: &str,
    bucket: &str,
    description: Option<Option<&str>>,
    rating: Option<Option<i32>>,
) -> Result<DevMilestoneItem, AppError> {
    if !["use_case", "goal"].contains(&item_kind) {
        return Err(AppError::Validation(format!(
            "Invalid milestone item kind `{item_kind}`"
        )));
    }
    if !["core", "later", "never"].contains(&bucket) {
        return Err(AppError::Validation(format!(
            "Invalid milestone bucket `{bucket}`"
        )));
    }
    // Guard in the repo as well as the column CHECK: the CHECK protects the
    // file, this returns a message the caller can show.
    if let Some(Some(r)) = rating {
        if !(1..=5).contains(&r) {
            return Err(AppError::Validation(format!(
                "Milestone item rating must be between 1 and 5, got {r}"
            )));
        }
    }

    timed_query!("dev_milestones", "dev_milestones::set_item", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let after_cut: bool = conn
            .query_row(
                "SELECT cut_at IS NOT NULL FROM dev_milestones WHERE id = ?1",
                params![milestone_id],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Milestone {milestone_id}"))
                }
                other => AppError::Database(other),
            })?;
        // The conflict arm updates `bucket` unconditionally and the two new
        // columns ONLY when the caller sent them — an omitted field must not
        // be written back as NULL. `added_after_cut` is never in the SET, so
        // re-bucketing or annotating an existing member keeps the flag it was
        // born with.
        let mut sets: Vec<&str> = vec!["bucket = excluded.bucket"];
        if description.is_some() {
            sets.push("description = excluded.description");
        }
        if rating.is_some() {
            sets.push("rating = excluded.rating");
        }
        let sql = format!(
            "INSERT INTO dev_milestone_items (milestone_id, item_kind, item_id, bucket, added_after_cut, created_at, description, rating)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(milestone_id, item_kind, item_id)
             DO UPDATE SET {}",
            sets.join(", ")
        );
        conn.execute(
            &sql,
            params![
                milestone_id,
                item_kind,
                item_id,
                bucket,
                after_cut as i64,
                now,
                description.flatten(),
                rating.flatten(),
            ],
        )?;
        conn.query_row(
            "SELECT * FROM dev_milestone_items
             WHERE milestone_id = ?1 AND item_kind = ?2 AND item_id = ?3",
            params![milestone_id, item_kind, item_id],
            row_to_milestone_item,
        )
        .map_err(AppError::Database)
    })
}

pub fn remove_milestone_item(
    pool: &DbPool,
    milestone_id: &str,
    item_kind: &str,
    item_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM dev_milestone_items
         WHERE milestone_id = ?1 AND item_kind = ?2 AND item_id = ?3",
        params![milestone_id, item_kind, item_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod milestone_tests {
    use super::*;

    #[test]
    fn milestone_lifecycle_and_scope_creep_flag() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp", None, None, None, None, None).unwrap();

        let m = create_milestone(
            &pool,
            &project.id,
            "v1 — First Ship",
            Some("Core value"),
            None,
            Some("2026-08-15"),
        )
        .unwrap();
        assert_eq!(m.status, "planned");
        assert!(m.cut_at.is_none());

        // Members added before the cut are not creep.
        let a = set_milestone_item(&pool, &m.id, "use_case", "uc-a", "core", None, None).unwrap();
        assert!(!a.added_after_cut);

        // Activating stamps cut_at once.
        let m = update_milestone(&pool, &m.id, None, None, Some("active"), None, None).unwrap();
        assert!(m.cut_at.is_some());

        // New membership after the cut IS creep; re-bucketing an old one isn't.
        let b = set_milestone_item(&pool, &m.id, "use_case", "uc-b", "later", None, None).unwrap();
        assert!(b.added_after_cut);
        let a2 = set_milestone_item(&pool, &m.id, "use_case", "uc-a", "later", None, None).unwrap();
        assert!(!a2.added_after_cut, "re-bucketing keeps the original flag");

        // Goals bind through the same table.
        set_milestone_item(&pool, &m.id, "goal", "g-1", "core", None, None).unwrap();
        let items = list_milestone_items(&pool, &m.id).unwrap();
        assert_eq!(items.len(), 3);

        // Shipping stamps shipped_at; delete cascades members.
        let m = update_milestone(&pool, &m.id, None, None, Some("shipped"), None, None).unwrap();
        assert!(m.shipped_at.is_some());
        delete_milestone(&pool, &m.id).unwrap();
        assert!(list_milestone_items(&pool, &m.id).unwrap().is_empty());
    }

    #[test]
    fn milestone_validation_rejects_bad_enums() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp2", None, None, None, None, None).unwrap();
        assert!(create_milestone(&pool, &project.id, "  ", None, None, None).is_err());
        assert!(create_milestone(&pool, &project.id, "M", None, Some("bogus"), None).is_err());
        let m = create_milestone(&pool, &project.id, "M", None, None, None).unwrap();
        assert!(
            set_milestone_item(&pool, &m.id, "context", "c-1", "core", None, None).is_err(),
            "contexts are never members"
        );
        assert!(
            set_milestone_item(&pool, &m.id, "use_case", "u-1", "someday", None, None).is_err()
        );
    }

    /// The batched wall read must answer EVERY requested project — including
    /// ones with nothing to report and ids that no longer exist — in the
    /// caller's order, and must return full milestone rows (the roadmap
    /// builder consumes `DevMilestone[]`, not a projection).
    #[test]
    fn wall_summaries_answer_every_requested_project_in_order() {
        let pool = crate::init_test_db().unwrap();
        let a = create_project(&pool, "A", "/tmp/wa", None, None, None, None, None).unwrap();
        let b = create_project(&pool, "B", "/tmp/wb", None, None, None, None, None).unwrap();

        create_context(
            &pool,
            &a.id,
            "ctx-1",
            None,
            None,
            Some(r#"["a.ts"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        create_context(
            &pool,
            &a.id,
            "ctx-2",
            None,
            None,
            Some(r#"["b.ts"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        create_milestone(&pool, &a.id, "v1", None, Some("active"), None).unwrap();
        create_milestone(&pool, &a.id, "v2", None, None, None).unwrap();

        let mk_kpi = |name: &str, status: &str| {
            create_kpi(
                &pool,
                &a.id,
                name,
                None,
                None,
                "quality",
                "manual",
                "{}",
                "%",
                "up",
                Some(0.0),
                Some(100.0),
                None,
                "weekly",
                Some(status),
                "user",
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        };
        mk_kpi("live", "active");
        mk_kpi("shelved", "paused");

        // b has nothing; "ghost" was never registered at all.
        let rows =
            project_wall_summaries(&pool, &[b.id.clone(), a.id.clone(), "ghost".to_string()])
                .unwrap();

        assert_eq!(rows.len(), 3, "every requested id gets a row");
        assert_eq!(rows[0].project_id, b.id, "order mirrors the request");
        assert_eq!(rows[0].contexts_count, 0);
        assert!(rows[0].milestones.is_empty());

        assert_eq!(rows[1].project_id, a.id);
        assert_eq!(rows[1].contexts_count, 2);
        assert_eq!(rows[1].milestones.len(), 2);
        assert_eq!(rows[1].active_kpis.len(), 1, "only ACTIVE KPIs count");
        assert_eq!(rows[1].active_kpis[0].name, "live");
        // Full rows, ordered exactly like list_milestones_by_project.
        let listed = list_milestones_by_project(&pool, &a.id).unwrap();
        assert_eq!(
            rows[1].milestones.iter().map(|m| &m.id).collect::<Vec<_>>(),
            listed.iter().map(|m| &m.id).collect::<Vec<_>>(),
        );
        assert!(
            rows[1].milestones[0].cut_at.is_some(),
            "cut_at survives the batch read"
        );

        assert_eq!(
            rows[2].project_id, "ghost",
            "an unknown id is empty, not an error"
        );
        assert_eq!(rows[2].contexts_count, 0);

        assert!(project_wall_summaries(&pool, &[]).unwrap().is_empty());
    }

    /// A milestone created directly 'active' — the shape `seedOnboarding.ts`
    /// writes for every project — must carry a `cut_at` from birth, otherwise
    /// the scope-creep baseline never exists on the one milestone most
    /// projects will ever have.
    #[test]
    fn milestone_created_active_is_cut_at_birth() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp3", None, None, None, None, None).unwrap();

        let m = create_milestone(
            &pool,
            &project.id,
            "Onboard to Personas",
            None,
            Some("active"),
            None,
        )
        .unwrap();
        assert_eq!(m.status, "active");
        assert!(m.cut_at.is_some(), "a milestone born active must be cut");

        // …and the creep flag therefore fires on anything joined afterwards.
        let item =
            set_milestone_item(&pool, &m.id, "use_case", "uc-late", "core", None, None).unwrap();
        assert!(item.added_after_cut, "items added after the cut are creep");

        // A milestone born 'planned' is still uncut.
        let p = create_milestone(&pool, &project.id, "Later", None, Some("planned"), None).unwrap();
        assert!(p.cut_at.is_none());
    }

    /// Shipping is a server-side gated transition: a milestone must pass
    /// through 'active' (be cut) first. The client's exit-criteria check is a
    /// `disabled` attribute — it does not bind the management API, Fleet
    /// dispatch, or the A2A gateway.
    #[test]
    fn milestone_cannot_ship_without_being_cut() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp4", None, None, None, None, None).unwrap();

        let m = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();
        assert_eq!(m.status, "planned");
        let err = update_milestone(&pool, &m.id, None, None, Some("shipped"), None, None);
        assert!(
            matches!(err, Err(AppError::Validation(_))),
            "planned → shipped must be rejected, got {err:?}"
        );
        // Rejected means UNCHANGED, not partially applied.
        let still = get_milestone_by_id(&pool, &m.id).unwrap();
        assert_eq!(still.status, "planned");
        assert!(still.shipped_at.is_none());

        // The legal path stamps both timestamps.
        let m = update_milestone(&pool, &m.id, None, None, Some("active"), None, None).unwrap();
        assert!(m.cut_at.is_some());
        let m = update_milestone(&pool, &m.id, None, None, Some("shipped"), None, None).unwrap();
        assert!(m.cut_at.is_some(), "cut_at survives the ship transition");
        assert!(m.shipped_at.is_some());
    }

    /// Ship is a transition, not a birth state. A milestone created 'shipped'
    /// would carry `cut_at` NULL (the INSERT's CASE only stamps for 'active')
    /// and `shipped_at` NULL, so it would be invisible to velocity and read
    /// 'setup' on scope-frozen. Refuse it, and leave NO row behind.
    #[test]
    fn milestone_cannot_be_created_shipped() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp5", None, None, None, None, None).unwrap();

        let err = create_milestone(&pool, &project.id, "v1", None, Some("shipped"), None);
        assert!(
            matches!(err, Err(AppError::Validation(_))),
            "creating shipped must be rejected, got {err:?}"
        );
        // Rejected means nothing was written, not a half-created row.
        assert!(
            list_milestones_by_project(&pool, &project.id)
                .unwrap()
                .is_empty(),
            "a refused creation must leave no row"
        );

        // The legal shapes still work.
        let planned = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();
        assert_eq!(planned.status, "planned");
        let active =
            create_milestone(&pool, &project.id, "v2", None, Some("active"), None).unwrap();
        assert_eq!(active.status, "active");
        assert!(active.shipped_at.is_none());
    }

    /// `description` / `rating` round-trip through the upsert, follow the
    /// absent-vs-explicit-null patch convention, and never disturb the
    /// scope-creep flag an existing member was born with.
    #[test]
    fn milestone_item_description_and_rating_round_trip() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp6", None, None, None, None, None).unwrap();
        let m = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();

        // Born before the cut, with both annotations.
        let a = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-a",
            "core",
            Some(Some("The one flow that proves the product")),
            Some(Some(5)),
        )
        .unwrap();
        assert_eq!(
            a.description.as_deref(),
            Some("The one flow that proves the product")
        );
        assert_eq!(a.rating, Some(5));
        assert!(!a.added_after_cut);

        // Cut the milestone, then re-bucket WITHOUT sending either field:
        // both must survive untouched, and so must the creep flag.
        update_milestone(&pool, &m.id, None, None, Some("active"), None, None).unwrap();
        let a = set_milestone_item(&pool, &m.id, "use_case", "uc-a", "later", None, None).unwrap();
        assert_eq!(a.bucket, "later");
        assert_eq!(
            a.description.as_deref(),
            Some("The one flow that proves the product")
        );
        assert_eq!(a.rating, Some(5), "an omitted field is left unchanged");
        assert!(
            !a.added_after_cut,
            "annotating never rewrites the creep flag"
        );

        // Patch only the rating; the description stays.
        let a = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-a",
            "later",
            None,
            Some(Some(2)),
        )
        .unwrap();
        assert_eq!(a.rating, Some(2));
        assert!(a.description.is_some());

        // Explicit null CLEARS — and unrated is not rated-1.
        let a = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-a",
            "later",
            Some(None),
            Some(None),
        )
        .unwrap();
        assert!(a.description.is_none());
        assert!(a.rating.is_none(), "cleared means unrated, not 1");
        assert!(!a.added_after_cut);

        // A member created after the cut is still creep, annotations or not.
        let b = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-b",
            "core",
            Some(Some("late idea")),
            Some(Some(3)),
        )
        .unwrap();
        assert!(b.added_after_cut);
        assert_eq!(b.rating, Some(3));

        // The list read carries them too (it is a `SELECT *` → row mapper).
        let items = list_milestone_items(&pool, &m.id).unwrap();
        let listed_b = items.iter().find(|i| i.item_id == "uc-b").unwrap();
        assert_eq!(listed_b.description.as_deref(), Some("late idea"));
        assert_eq!(listed_b.rating, Some(3));
    }

    /// Rating bounds are enforced twice: the repo returns a Validation error
    /// with a message, and the column CHECK is the backstop for any writer
    /// that bypasses the repo.
    #[test]
    fn milestone_item_rating_bounds_are_enforced() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp7", None, None, None, None, None).unwrap();
        let m = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();

        for bad in [0, 6, -1, 99] {
            let err = set_milestone_item(
                &pool,
                &m.id,
                "use_case",
                "uc-a",
                "core",
                None,
                Some(Some(bad)),
            );
            assert!(
                matches!(err, Err(AppError::Validation(_))),
                "rating {bad} must be rejected, got {err:?}"
            );
        }
        // A rejected write leaves no row.
        assert!(list_milestone_items(&pool, &m.id).unwrap().is_empty());

        // Bounds are inclusive.
        for good in 1..=5 {
            let it = set_milestone_item(
                &pool,
                &m.id,
                "use_case",
                "uc-a",
                "core",
                None,
                Some(Some(good)),
            )
            .unwrap();
            assert_eq!(it.rating, Some(good));
        }

        // The DB CHECK itself refuses an out-of-range write that skips the repo.
        set_milestone_item(&pool, &m.id, "use_case", "uc-b", "core", None, None).unwrap();
        let conn = pool.get().unwrap();
        let direct = conn.execute(
            "UPDATE dev_milestone_items SET rating = 9
             WHERE milestone_id = ?1 AND item_kind = 'use_case' AND item_id = 'uc-b'",
            params![m.id],
        );
        assert!(direct.is_err(), "the column CHECK must reject rating 9");
        // …but NULL is always legal: unrated is a real state.
        conn.execute(
            "UPDATE dev_milestone_items SET rating = NULL
             WHERE milestone_id = ?1 AND item_kind = 'use_case' AND item_id = 'uc-b'",
            params![m.id],
        )
        .unwrap();
    }
}

#[cfg(test)]
mod use_case_tests {
    use super::*;

    fn ctx(pool: &DbPool, project_id: &str, name: &str, files: &str) -> DevContext {
        create_context(
            pool,
            project_id,
            name,
            None,
            None,
            Some(files),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    }

    #[test]
    fn slugify_normalizes_casing_separators_and_punctuation() {
        assert_eq!(
            slugify_use_case("Checkout Conversion"),
            "checkout-conversion"
        );
        assert_eq!(
            slugify_use_case("checkout_conversion"),
            "checkout-conversion"
        );
        assert_eq!(
            slugify_use_case("  Checkout — Conversion!  "),
            "checkout-conversion"
        );
        assert_eq!(slugify_use_case("LLM Overview v2"), "llm-overview-v2");
        assert_eq!(slugify_use_case("!!!"), "");
    }

    /// The load-bearing invariant: a FULL rescan deletes unpinned contexts,
    /// which cascades away the use-case slice and NULLs context-scoped KPIs.
    /// Snapshot-then-reconcile must restore both by context name, and must drop
    /// exactly the links whose context genuinely disappeared.
    #[test]
    fn reconcile_restores_slice_and_kpi_scope_across_a_full_rescan() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();

        let checkout_ui = ctx(&pool, &project.id, "checkout-ui", r#"["a.tsx"]"#);
        let checkout_api = ctx(&pool, &project.id, "checkout-api", r#"["b.rs"]"#);
        let doomed = ctx(&pool, &project.id, "legacy-widget", r#"["c.ts"]"#);

        let uc = create_use_case(
            &pool,
            &project.id,
            "Checkout conversion",
            None,
            "user_flow",
            Some(&checkout_ui.id),
            &[
                checkout_ui.id.clone(),
                checkout_api.id.clone(),
                doomed.id.clone(),
            ],
            Some("active"),
            "user",
            None,
        )
        .unwrap();
        assert_eq!(uc.context_ids.len(), 3);

        let kpi = create_kpi(
            &pool,
            &project.id,
            "p95 latency",
            None,
            None,
            "technical",
            "codebase",
            "{}",
            "ms",
            "down",
            None,
            None,
            None,
            "weekly",
            Some("active"),
            "user",
            None,
            None,
            None,
            Some(&checkout_api.id),
            None,
        )
        .unwrap();
        assert_eq!(kpi.context_id.as_deref(), Some(checkout_api.id.as_str()));

        // --- what a full rescan does -------------------------------------
        let snapshot = snapshot_context_links(&pool, &project.id).unwrap();
        assert_eq!(snapshot.use_case_contexts.len(), 3);
        assert_eq!(snapshot.kpi_contexts.len(), 1);

        clear_project_context_map(&pool, &project.id).unwrap();
        assert!(get_use_case(&pool, &uc.id).unwrap().context_ids.is_empty());
        assert!(get_kpi(&pool, &kpi.id).unwrap().context_id.is_none());

        // The scan re-emits the surviving features under fresh ids; the legacy
        // context is gone for good.
        let new_ui = ctx(&pool, &project.id, "checkout-ui", r#"["a.tsx"]"#);
        let new_api = ctx(&pool, &project.id, "checkout-api", r#"["b.rs"]"#);

        // --- reconcile ----------------------------------------------------
        let report = reconcile_context_links(&pool, &project.id, &snapshot).unwrap();
        // 2 slice links + 1 primary + 1 KPI restored; the legacy slice link and
        // nothing else dropped.
        assert_eq!(report.dropped, 1, "only the vanished context's link drops");

        let healed = get_use_case(&pool, &uc.id).unwrap();
        assert_eq!(healed.context_ids.len(), 2);
        assert!(healed.context_ids.contains(&new_ui.id));
        assert!(healed.context_ids.contains(&new_api.id));
        assert_eq!(
            healed.primary_context_id.as_deref(),
            Some(new_ui.id.as_str())
        );

        let healed_kpi = get_kpi(&pool, &kpi.id).unwrap();
        assert_eq!(healed_kpi.context_id.as_deref(), Some(new_api.id.as_str()));

        // Idempotent: a delta rescan re-runs this with nothing to do.
        let again = reconcile_context_links(&pool, &project.id, &snapshot).unwrap();
        assert_eq!(again.relinked, 0);
        assert_eq!(get_use_case(&pool, &uc.id).unwrap().context_ids.len(), 2);
    }

    #[test]
    fn backfill_promotes_only_multi_context_features_and_is_idempotent() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();

        // Two contexts share a business feature; the bigger one becomes primary.
        create_context(
            &pool,
            &project.id,
            "checkout-ui",
            None,
            None,
            Some(r#"["a.tsx"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("Checkout"),
        )
        .unwrap();
        let big = create_context(
            &pool,
            &project.id,
            "checkout-api",
            None,
            None,
            Some(r#"["b.rs","c.rs"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("Checkout"),
        )
        .unwrap();
        // A label on exactly ONE context is that context's title, not a slice.
        // On a real 263-context map, 179 of 184 labels looked like this.
        create_context(
            &pool,
            &project.id,
            "billing",
            None,
            None,
            Some(r#"["d.rs"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("Billing"),
        )
        .unwrap();
        // No business_feature → contributes no use case.
        ctx(&pool, &project.id, "unlabelled", r#"["e.rs"]"#);

        let created = backfill_use_cases_from_business_features(&pool, &project.id).unwrap();
        assert_eq!(
            created.len(),
            1,
            "only the label spanning >= 2 contexts is promoted"
        );

        let checkout = &created[0];
        assert_eq!(checkout.slug, "checkout");
        assert_eq!(checkout.context_ids.len(), 2);
        assert_eq!(
            checkout.primary_context_id.as_deref(),
            Some(big.id.as_str())
        );
        assert_eq!(
            checkout.status, "proposed",
            "backfill lands in the triage queue"
        );
        assert_eq!(checkout.created_by, "backfill");

        // Re-running adds nothing.
        let again = backfill_use_cases_from_business_features(&pool, &project.id).unwrap();
        assert!(again.is_empty());
        assert_eq!(list_use_cases(&pool, &project.id, None).unwrap().len(), 1);
    }

    /// The real-world shape: every label names exactly one context. The backfill
    /// must create NOTHING rather than mint a use case per context.
    #[test]
    fn backfill_creates_nothing_when_every_label_names_one_context() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        for (name, label) in [("agent-editor", "Agent Editor"), ("vault", "Vault")] {
            create_context(
                &pool,
                &project.id,
                name,
                None,
                None,
                Some(r#"["a.rs"]"#),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(label),
            )
            .unwrap();
        }
        let created = backfill_use_cases_from_business_features(&pool, &project.id).unwrap();
        assert!(
            created.is_empty(),
            "1:1 labels are context titles, not use cases"
        );
    }
}

// Phase 1 backlog memory spine tests (docs/plans/backlog-memory-loop.md) live in
// their own file for size; `#[path]` keeps them a child module of this one, so
// `use super::*` still reaches the repo's private items.
#[cfg(test)]
#[path = "dev_tools_backlog_tests.rs"]
mod backlog_memory_tests;

// Keyset-pagination + retry-lineage tests for the unified Backlog / Run Desk.
// Same `#[path]` arrangement as the backlog tests above.
#[cfg(test)]
#[path = "dev_tools_page_tests.rs"]
mod page_tests;

#[cfg(test)]
mod pending_counts_tests {
    use super::*;

    /// The badge's whole purpose is that the number equals what the deck will
    /// deal. These assert the two ways that can silently stop being true: a
    /// source counting a settled row, and `total` drifting from its parts.
    #[test]
    fn counts_only_rows_that_still_owe_a_human_a_decision() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/pc", None, None, None, None, None).unwrap();

        // Two awaiting acceptance, one already settled.
        create_goal(
            &pool,
            &project.id,
            "A",
            None,
            None,
            Some("awaiting_acceptance"),
            None,
            None,
        )
        .unwrap();
        create_goal(
            &pool,
            &project.id,
            "B",
            None,
            None,
            Some("awaiting_acceptance"),
            None,
            None,
        )
        .unwrap();
        create_goal(
            &pool,
            &project.id,
            "C",
            None,
            None,
            Some("done"),
            None,
            None,
        )
        .unwrap();

        let counts = pending_counts(&pool).unwrap();
        assert_eq!(
            counts.goal_acceptance, 2,
            "a done goal is not awaiting anyone"
        );
        assert_eq!(
            counts.total,
            counts.goal_acceptance
                + counts.manual_reviews
                + counts.ideas
                + counts.practices
                + counts.policy_proposals
                + counts.promotion_proposals,
            "total must be the sum of its parts, or the badge lies about which queue is full",
        );
    }

    #[test]
    fn an_empty_database_counts_zero_rather_than_erroring() {
        // Every source is queried unconditionally, so a fresh install must not
        // fail the badge on a table that happens to be empty.
        let pool = crate::init_test_db().unwrap();
        let counts = pending_counts(&pool).unwrap();
        assert_eq!(counts.total, 0);
        assert_eq!(counts.practices, 0);
        assert_eq!(counts.promotion_proposals, 0);
    }
}

/// The staleness engine across all three record types. Repo-level (not
/// command-level) because there is no fixture that builds a Tauri `State`.
#[cfg(test)]
mod attention_queue_tests {
    use super::*;

    fn ago(days: i64, hours: i64) -> String {
        (chrono::Utc::now() - chrono::Duration::days(days) - chrono::Duration::hours(hours))
            .to_rfc3339()
    }

    fn set(pool: &DbPool, sql: &str, args: &[&dyn rusqlite::types::ToSql]) {
        pool.get().unwrap().execute(sql, args).unwrap();
    }

    fn idea(pool: &DbPool, project: &str, title: &str, status: &str) -> DevIdea {
        create_idea(
            pool,
            Some(project),
            None,
            "scan",
            None,
            title,
            None,
            None,
            Some(status),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    }

    fn kinds<'a>(q: &'a AttentionQueue, kind: &str) -> Vec<&'a AttentionItem> {
        q.items.iter().filter(|i| i.kind == kind).collect()
    }

    // ---------------------------------------------------------------- C2 ----

    #[test]
    fn an_accepted_idea_is_undispatched_only_while_it_has_no_task() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/undisp", None, None, None, None, None).unwrap();

        let dispatched = idea(&pool, &p.id, "has a task", "accepted");
        let forgotten = idea(&pool, &p.id, "never dispatched", "accepted");
        create_task(
            &pool,
            Some(&p.id),
            "work",
            None,
            Some(&dispatched.id),
            None,
            None,
            None,
        )
        .unwrap();

        let rows = list_undispatched_ideas(&pool, None, None).unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![forgotten.id.as_str()],
            "only the accepted idea with NO dev_tasks row is undispatched",
        );
        assert!(
            rows[0].age_hours.is_some(),
            "a freshly-written stamp must yield a real age, not None",
        );
        assert_eq!(rows[0].project_name.as_deref(), Some("P"));
    }

    #[test]
    fn an_unaccepted_idea_is_never_reported_however_old() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/settled", None, None, None, None, None).unwrap();

        // Every non-accepted status, all task-less and all ancient.
        for status in ["pending", "rejected", "archived", "done"] {
            let i = idea(&pool, &p.id, status, status);
            set(
                &pool,
                "UPDATE dev_ideas SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
                &[&ago(90, 0), &i.id],
            );
        }

        assert!(
            list_undispatched_ideas(&pool, None, None)
                .unwrap()
                .is_empty(),
            "undispatched means ACCEPTED-and-unbuilt; a rejected or archived idea owes nobody work",
        );
        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        assert_eq!(q.undispatched_ideas, 0);
    }

    #[test]
    fn undispatched_ideas_come_back_oldest_first_and_scope_to_a_project() {
        let pool = crate::init_test_db().unwrap();
        let a = create_project(&pool, "A", "/tmp/a", None, None, None, None, None).unwrap();
        let b = create_project(&pool, "B", "/tmp/b", None, None, None, None, None).unwrap();

        let recent = idea(&pool, &a.id, "recent", "accepted");
        let ancient = idea(&pool, &a.id, "ancient", "accepted");
        let elsewhere = idea(&pool, &b.id, "other project", "accepted");
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(40, 0), &ancient.id],
        );
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(1, 0), &recent.id],
        );

        let scoped = list_undispatched_ideas(&pool, Some(&a.id), None).unwrap();
        assert_eq!(
            scoped.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
            vec!["ancient", "recent"],
            "the most-forgotten decision leads",
        );
        assert!(scoped[0].age_hours.unwrap() > scoped[1].age_hours.unwrap());
        assert!(
            !scoped.iter().any(|r| r.id == elsewhere.id),
            "project scoping must exclude other projects",
        );
        assert_eq!(list_undispatched_ideas(&pool, None, None).unwrap().len(), 3);
        assert_eq!(
            list_undispatched_ideas(&pool, None, Some(1)).unwrap().len(),
            1,
            "limit caps the list",
        );
    }

    // ---------------------------------------------------------------- C3 ----

    #[test]
    fn the_queue_flags_an_accepted_idea_only_once_it_is_past_the_threshold() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/thresh", None, None, None, None, None).unwrap();

        let fresh = idea(&pool, &p.id, "accepted this morning", "accepted");
        let recent = idea(&pool, &p.id, "accepted two days ago", "accepted");
        let stale = idea(&pool, &p.id, "accepted last week", "accepted");
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(7, 0), &stale.id],
        );
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(2, 0), &recent.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let flagged = kinds(&q, "undispatched_idea");
        assert_eq!(q.undispatched_ideas, 1);
        assert_eq!(flagged.len(), 1);
        assert_eq!(flagged[0].entity_id, stale.id);
        assert_eq!(flagged[0].entity_kind, "idea");
        assert_eq!(flagged[0].rank, 4);
        assert!(
            flagged[0].progress.is_none(),
            "an idea has no progress — 0 would read as 'started, got nowhere'",
        );
        assert!(
            flagged[0].detail.contains("no task"),
            "{}",
            flagged[0].detail
        );
        for quiet in [&fresh.id, &recent.id] {
            assert!(
                !q.items.iter().any(|i| &i.entity_id == quiet),
                "a decision younger than the 3-day default is not yet a staleness signal",
            );
        }

        // Thresholds are parameters: a caller with a tighter opinion sees more.
        let tight = attention_queue(
            &pool,
            AttentionThresholds {
                idea_dispatch_days: 1,
                ..AttentionThresholds::default()
            },
        )
        .unwrap();
        assert_eq!(
            tight.undispatched_ideas, 2,
            "a 1-day window catches the 2-day-old decision the 3-day default let through",
        );
        assert!(
            !tight.items.iter().any(|i| i.entity_id == fresh.id),
            "…but not one accepted minutes ago",
        );
        assert_eq!(tight.thresholds.idea_dispatch_days, 1);
        assert_eq!(
            tight.thresholds.stale_goal_days, 7,
            "the goal window keeps its shipped default when only one is overridden",
        );
    }

    #[test]
    fn a_running_task_is_stuck_when_its_heartbeat_goes_quiet_not_when_it_is_merely_long() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/stuck", None, None, None, None, None).unwrap();

        let chatty = create_task(
            &pool,
            Some(&p.id),
            "chatty",
            None,
            None,
            None,
            Some("running"),
            None,
        )
        .unwrap();
        let quiet = create_task(
            &pool,
            Some(&p.id),
            "quiet",
            None,
            None,
            None,
            Some("running"),
            None,
        )
        .unwrap();
        // Both started 3 days ago; only `quiet` has stopped reporting.
        set(
            &pool,
            "UPDATE dev_tasks SET started_at = ?1, created_at = ?1 WHERE id IN (?2, ?3)",
            &[&ago(3, 0), &chatty.id, &quiet.id],
        );
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(0, 0), &chatty.id],
        );
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(0, 9), &quiet.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let stuck = kinds(&q, "stuck_task");
        assert_eq!(q.stuck_tasks, 1);
        assert_eq!(stuck.len(), 1);
        assert_eq!(
            stuck[0].entity_id, quiet.id,
            "a 3-day run that reported a minute ago is alive; the silent one is stuck",
        );
        assert_eq!(stuck[0].entity_kind, "task");
        assert_eq!(stuck[0].rank, 5);
        assert!(stuck[0].age_hours.unwrap() >= 9);
    }

    #[test]
    fn a_queued_task_past_its_window_is_reported_and_a_settled_one_never_is() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/queued", None, None, None, None, None).unwrap();

        let waiting = create_task(
            &pool,
            Some(&p.id),
            "waiting",
            None,
            None,
            None,
            Some("queued"),
            None,
        )
        .unwrap();
        let just_queued = create_task(
            &pool,
            Some(&p.id),
            "just queued",
            None,
            None,
            None,
            Some("queued"),
            None,
        )
        .unwrap();
        for status in ["completed", "failed", "cancelled"] {
            let t = create_task(
                &pool,
                Some(&p.id),
                status,
                None,
                None,
                None,
                Some(status),
                None,
            )
            .unwrap();
            set(
                &pool,
                "UPDATE dev_tasks SET created_at = ?1, updated_at = ?1, started_at = ?1, completed_at = ?1 WHERE id = ?2",
                &[&ago(30, 0), &t.id],
            );
        }
        set(
            &pool,
            "UPDATE dev_tasks SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
            &[&ago(4, 0), &waiting.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let stale = kinds(&q, "stale_queued_task");
        assert_eq!(q.stale_queued_tasks, 1);
        assert_eq!(stale.len(), 1);
        assert_eq!(stale[0].entity_id, waiting.id);
        assert_eq!(stale[0].rank, 6);
        assert!(
            !q.items.iter().any(|i| i.entity_id == just_queued.id),
            "a task queued moments ago is a working queue, not a stalled one",
        );
        assert_eq!(
            q.stuck_tasks, 0,
            "completed / failed / cancelled tasks are settled and must never be reported",
        );
        assert!(
            !q.items.iter().any(|i| i.status == "completed"),
            "a settled row leaked into the queue",
        );
    }

    #[test]
    fn the_four_goal_categories_and_their_ranks_are_unchanged() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/goals", None, None, None, None, None).unwrap();
        let day = |n: i64| {
            (chrono::Utc::now() - chrono::Duration::days(n))
                .date_naive()
                .to_string()
        };

        let late =
            create_goal(&pool, &p.id, "late", None, None, None, Some(&day(3)), None).unwrap();
        let due_today = create_goal(
            &pool,
            &p.id,
            "due today",
            None,
            None,
            None,
            Some(&day(0)),
            None,
        )
        .unwrap();
        let quiet = create_goal(&pool, &p.id, "quiet", None, None, None, None, None).unwrap();
        let fresh = create_goal(&pool, &p.id, "fresh", None, None, None, None, None).unwrap();
        let finished = create_goal(
            &pool,
            &p.id,
            "finished",
            None,
            None,
            Some("done"),
            None,
            None,
        )
        .unwrap();
        set(
            &pool,
            "UPDATE dev_goals SET updated_at = ?1 WHERE id IN (?2, ?3)",
            &[&ago(30, 0), &quiet.id, &finished.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();

        assert_eq!(q.overdue, 1);
        assert_eq!(kinds(&q, "overdue")[0].entity_id, late.id);
        assert_eq!(kinds(&q, "overdue")[0].rank, 1);
        assert_eq!(
            kinds(&q, "overdue")[0].goal_id.as_deref(),
            Some(late.id.as_str()),
            "a goal row still carries goal_id, not only the generic entity_id",
        );
        assert!(
            !q.items
                .iter()
                .any(|i| i.kind == "overdue" && i.entity_id == due_today.id),
            "a goal due TODAY is not overdue — the raw-string compare said it was",
        );

        assert_eq!(q.stalled, 1);
        assert_eq!(kinds(&q, "stalled")[0].entity_id, quiet.id);
        assert_eq!(kinds(&q, "stalled")[0].rank, 2);

        // Unstaffed stays goal-only and still covers every ongoing goal with no
        // team assignment — including ones already reported as overdue/stalled.
        assert_eq!(q.unstaffed, 4);
        assert!(kinds(&q, "unstaffed").iter().all(|i| i.rank == 3));
        assert!(
            !q.items.iter().any(|i| i.entity_id == finished.id),
            "a done goal is settled — stale timestamps and all",
        );

        assert_eq!(q.awaiting_review, 0);
        let ranks: Vec<i32> = q.items.iter().map(|i| i.rank).collect();
        let mut sorted = ranks.clone();
        sorted.sort_unstable();
        assert_eq!(ranks, sorted, "items must stay ordered by rank");
    }

    #[test]
    fn an_empty_database_yields_an_empty_queue_rather_than_erroring() {
        let pool = crate::init_test_db().unwrap();
        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        assert!(q.items.is_empty());
        assert_eq!(
            q.undispatched_ideas + q.stuck_tasks + q.stale_queued_tasks,
            0
        );
        assert_eq!(q.thresholds.task_running_hours, 4);
    }

    // ------------------------------------------------------- KPI supply ----

    /// A KPI whose measurement stops reporting takes goal derivation down with
    /// it, and nothing used to say so. These pin the four states apart.
    fn kpi(
        pool: &DbPool,
        project: &str,
        name: &str,
        cadence: &str,
        status: &str,
    ) -> crate::models::DevKpi {
        create_kpi(
            pool,
            project,
            name,
            None,
            None,
            "technical",
            "codebase",
            "{}",
            "%",
            "up",
            None,
            None,
            None,
            cadence,
            Some(status),
            "user",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    }

    fn measured(pool: &DbPool, kpi_id: &str, days_ago: i64) {
        set(
            pool,
            "UPDATE dev_kpis SET current_value = 50.0, last_measured_at = ?1 WHERE id = ?2",
            &[&ago(days_ago, 0), &kpi_id],
        );
    }

    #[test]
    fn a_kpi_that_went_dark_is_reported_and_says_derivation_has_stopped() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(
            &pool,
            "P",
            "/tmp/kpi-dark",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();

        // Weekly window is 14d: 3d ago is fresh, 30d ago is dark.
        let fresh = kpi(&pool, &p.id, "fresh weekly", "weekly", "active");
        measured(&pool, &fresh.id, 3);
        let dark = kpi(&pool, &p.id, "dark weekly", "weekly", "active");
        measured(&pool, &dark.id, 30);

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let reported = kinds(&q, "kpi_gone_dark");
        assert_eq!(
            reported.len(),
            1,
            "only the KPI past its own window is reported"
        );
        assert_eq!(reported[0].entity_id, dark.id);
        assert_eq!(reported[0].entity_kind, "kpi");
        assert_eq!(reported[0].rank, 7);
        assert_eq!(
            reported[0].project_name.as_deref(),
            Some("P"),
            "the row must name the project so the queue can route it",
        );
        assert!(
            reported[0].progress.is_none(),
            "a KPI has no progress; 0 would read as 'measured, at zero'",
        );
        assert!(
            reported[0].detail.contains("derivation"),
            "the signal must say WHY it matters, not just that the number is old: {}",
            reported[0].detail,
        );
        assert!(reported[0].age_hours.unwrap() >= 29 * 24);
    }

    #[test]
    fn the_staleness_window_follows_the_kpis_own_cadence() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(
            &pool,
            "P",
            "/tmp/kpi-cadence",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();

        // 5 days without a reading: past a DAILY KPI's 2-day window, well
        // inside a WEEKLY one's 14-day window. One global cutoff cannot say
        // both, which is the whole point.
        let daily = kpi(&pool, &p.id, "daily", "daily", "active");
        measured(&pool, &daily.id, 5);
        let weekly = kpi(&pool, &p.id, "weekly", "weekly", "active");
        measured(&pool, &weekly.id, 5);

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let ids: Vec<&str> = kinds(&q, "kpi_gone_dark")
            .iter()
            .map(|i| i.entity_id.as_str())
            .collect();
        assert_eq!(ids, vec![daily.id.as_str()]);
    }

    #[test]
    fn never_measured_is_a_different_signal_from_gone_dark() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(
            &pool,
            "P",
            "/tmp/kpi-never",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();

        let never = kpi(&pool, &p.id, "never wired up", "weekly", "active");
        set(
            &pool,
            "UPDATE dev_kpis SET created_at = ?1 WHERE id = ?2",
            &[&ago(30, 0), &never.id],
        );
        // Activated moments ago and not yet measured: not an accusation, just
        // a KPI that has not had its window.
        let brand_new = kpi(&pool, &p.id, "just activated", "weekly", "active");

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let reported = kinds(&q, "kpi_never_measured");
        assert_eq!(reported.len(), 1);
        assert_eq!(reported[0].entity_id, never.id);
        assert_eq!(reported[0].rank, 8, "a different rank from gone-dark");
        assert!(reported[0].detail.contains("never measured"));
        assert!(
            kinds(&q, "kpi_gone_dark").is_empty(),
            "a KPI with no reading at all has not 'gone dark' — it never started",
        );
        assert!(
            !q.items.iter().any(|i| i.entity_id == brand_new.id),
            "a freshly activated KPI is not yet overdue for its first reading",
        );
    }

    #[test]
    fn kpis_that_are_silent_on_purpose_or_unowned_stay_out_of_the_queue() {
        let pool = crate::init_test_db().unwrap();
        let owned = create_project(
            &pool,
            "Owned",
            "/tmp/kpi-owned",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();
        let teamless = create_project(
            &pool,
            "Teamless",
            "/tmp/kpi-teamless",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        for status in ["paused", "archived", "proposed"] {
            let k = kpi(&pool, &owned.id, status, "weekly", status);
            measured(&pool, &k.id, 60);
        }
        // Active + ancient, but nobody derives goals for a team-less project,
        // so claiming derivation stopped would be false.
        let orphan = kpi(&pool, &teamless.id, "orphan", "weekly", "active");
        measured(&pool, &orphan.id, 60);

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        assert!(
            !q.items.iter().any(|i| i.entity_kind == "kpi"),
            "paused/archived/proposed KPIs are silent on purpose, and a team-less \
             project never derived anything to stop: {:?}",
            q.items.iter().map(|i| &i.entity_title).collect::<Vec<_>>(),
        );
    }

    // ---------------------------------------------------------------- C1 ----

    #[test]
    fn every_task_mutation_stamps_updated_at() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/stamp", None, None, None, None, None).unwrap();

        let created = create_task(&pool, Some(&p.id), "t", None, None, None, None, None).unwrap();
        let first = created
            .updated_at
            .clone()
            .expect("create_task must stamp updated_at");
        assert_eq!(first, created.created_at);

        // Backdate, then mutate: the write must move the stamp forward.
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(5, 0), &created.id],
        );
        let ran = update_task(
            &pool,
            &created.id,
            None,
            None,
            Some("running"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let after = ran
            .updated_at
            .clone()
            .expect("update_task must stamp updated_at");
        assert!(
            parse_stamp(&after).unwrap() > parse_stamp(&ago(1, 0)).unwrap(),
            "a status write must refresh the heartbeat (got {after})",
        );

        // A no-op update changes nothing, so it must NOT forge a heartbeat.
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(5, 0), &created.id],
        );
        let noop = update_task(
            &pool,
            &created.id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            parse_stamp(&noop.updated_at.unwrap()).unwrap().date_naive(),
            parse_stamp(&ago(5, 0)).unwrap().date_naive(),
            "an all-None update mutates nothing and must not look like activity",
        );

        // A retry is a new row and starts its own clock.
        let retried = retry_task(&pool, &created.id).unwrap();
        assert!(
            retried.updated_at.is_some(),
            "retry_task must stamp updated_at"
        );
    }

    #[test]
    fn the_migration_backfills_updated_at_instead_of_leaving_it_null() {
        // Simulate a pre-migration row: NULL updated_at with real lifecycle
        // stamps. The backfill rule (COALESCE(completed_at, started_at,
        // created_at)) is what readers COALESCE onto, so a legacy row must not
        // read as either "never touched" or "touched now".
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/backfill", None, None, None, None, None).unwrap();
        let t = create_task(
            &pool,
            Some(&p.id),
            "legacy",
            None,
            None,
            None,
            Some("running"),
            None,
        )
        .unwrap();
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = NULL, started_at = ?1, created_at = ?1 WHERE id = ?2",
            &[&ago(2, 0), &t.id],
        );

        let read = get_task_by_id(&pool, &t.id).unwrap();
        assert!(read.updated_at.is_none(), "the NULL must survive the read");

        // …and the queue still judges it, falling back to started_at.
        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let stuck = kinds(&q, "stuck_task");
        assert_eq!(
            stuck.len(),
            1,
            "a NULL updated_at must not hide a stuck task"
        );
        assert!(stuck[0].age_hours.unwrap() >= 47);

        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE dev_tasks SET updated_at = COALESCE(completed_at, started_at, created_at)
             WHERE updated_at IS NULL",
            [],
        )
        .unwrap();
        let filled = get_task_by_id(&pool, &t.id).unwrap();
        assert_eq!(
            filled.updated_at.as_deref(),
            filled.started_at.as_deref(),
            "backfill must take the row's most recent real stamp",
        );
    }
}
