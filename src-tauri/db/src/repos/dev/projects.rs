use crate::models::DevProject;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

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

// ============================================================================
// Projects
// ============================================================================

// ----------------------------------------------------------------------------
// Workspace membership
//
// `workspace_id` is a column on dev_projects, so every workspace-membership
// query is a dev_projects query. `repos::workspaces` used to run these five
// inline against its own connection, each carrying a foreign-table marker left by the
// Wave 1 split. They live here now, with the SQL unchanged to the byte.
//
// They take `&rusqlite::Connection` rather than `&DbPool` on purpose: three of
// the five callers are mid-transaction, and a pool-taking signature would have
// moved them onto a second connection — a behaviour change wearing a
// refactor's clothes. `Transaction` derefs to `Connection`, so one signature
// serves both.
// ----------------------------------------------------------------------------

/// Member projects of a workspace, projected to the two columns the knowledge
/// lanes need. Was inline in `workspaces::mining` and `workspaces::knowledge`.
pub(crate) fn workspace_members_with_tech_stack(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> rusqlite::Result<Vec<(String, Option<String>)>> {
    let mut stmt =
        conn.prepare("SELECT id, tech_stack FROM dev_projects WHERE workspace_id = ?1")?;
    let rows = stmt.query_map(params![workspace_id], |r| {
        Ok((r.get("id")?, r.get("tech_stack")?))
    })?;
    rows.collect()
}

/// Full member projects of a workspace, name-sorted. Was inline in
/// `workspaces::org::list_workspace_projects`, which already had to reach for
/// this module's `row_to_project` to read the result.
pub(crate) fn list_by_workspace(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> rusqlite::Result<Vec<DevProject>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM dev_projects WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![workspace_id], row_to_project)?;
    rows.collect()
}

/// The workspace a project belongs to. `Ok(None)` means no such project;
/// `Ok(Some(None))` means the project exists and is unassigned — the caller
/// distinguishes the two.
pub(crate) fn workspace_id_of(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> rusqlite::Result<Option<Option<String>>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT workspace_id FROM dev_projects WHERE id = ?1",
        params![project_id],
        |r| r.get("workspace_id"),
    )
    .optional()
}

/// Unassign every member of a workspace. Used when the workspace is deleted:
/// membership goes, the projects stay.
pub(crate) fn clear_workspace_membership(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE dev_projects SET workspace_id = NULL WHERE workspace_id = ?1",
        params![workspace_id],
    )
}

/// Move one project into a workspace, or out of every workspace when
/// `workspace_id` is `None`.
pub(crate) fn set_workspace_membership(
    conn: &rusqlite::Connection,
    project_id: &str,
    workspace_id: Option<&str>,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE dev_projects SET workspace_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![workspace_id, now, project_id],
    )
}

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
