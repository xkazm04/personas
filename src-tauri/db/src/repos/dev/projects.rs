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
        // Absent on a pre-e32 row shape (e.g. a narrow SELECT): treat as on.
        enabled: row
            .get::<_, Option<i64>>("enabled")
            .unwrap_or(None)
            .is_none_or(|v| v != 0),
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

/// Re-point a project at a new folder. Only `crate::project_identity` calls
/// this, after the folder's `.personas/project.json` marker proved the move;
/// nothing in the UI edits `root_path` directly.
pub fn update_root_path(pool: &DbPool, id: &str, root_path: &str) -> Result<DevProject, AppError> {
    personas_core::validation::require_non_empty("Root path", root_path)?;
    timed_query!("dev_projects", "dev_projects::update_root_path", {
        get_project_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_projects SET root_path = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, root_path, now],
        )?;
        get_project_by_id(pool, id)
    })
}

/// Link (or unlink) the project's team. Narrow on purpose: the one-team-per-
/// project invariant in `crate::project_team` needs to write exactly this one
/// column, and routing it through `update_project` would mean threading
/// sixteen `None`s past a signature that is already at the argument limit.
pub fn set_team_id(pool: &DbPool, id: &str, team_id: Option<&str>) -> Result<DevProject, AppError> {
    timed_query!("dev_projects", "dev_projects::set_team_id", {
        get_project_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_projects SET team_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, team_id, now],
        )?;
        get_project_by_id(pool, id)
    })
}

/// Flip the project switch. Returns `Some(new)` when the value changed and
/// `None` when it already held it, read and written in one transaction so two
/// concurrent flips cannot both report a change.
pub fn set_enabled(pool: &DbPool, id: &str, enabled: bool) -> Result<Option<bool>, AppError> {
    timed_query!("dev_projects", "dev_projects::set_enabled", {
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current: Option<i64> = tx
            .query_row(
                "SELECT enabled FROM dev_projects WHERE id = ?1",
                params![id],
                |r| r.get("enabled"),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Project {id}")),
                other => other.into(),
            })?;
        if current.is_none_or(|v| v != 0) == enabled {
            tx.commit()?;
            return Ok(None);
        }
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE dev_projects SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, enabled as i64, now],
        )?;
        tx.commit()?;
        Ok(Some(enabled))
    })
}

/// SQL predicate: TRUE when persona `alias.id` is homed in a switched-off
/// project. Shared by the run gates and the trigger queries so the persona ->
/// project join (`personas.home_team_id = dev_projects.team_id`) is written once.
pub fn project_off_sql(persona_alias: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM dev_projects dp WHERE dp.team_id = {persona_alias}.home_team_id          AND dp.team_id IS NOT NULL AND dp.enabled = 0)"
    )
}

/// The switched-off project a persona belongs to, if any: `Some(project name)`
/// when the persona must not run, `None` otherwise (no project, or it is on).
pub fn persona_project_disabled(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<String>, AppError> {
    timed_query!("dev_projects", "dev_projects::persona_project_disabled", {
        let conn = pool.get()?;
        let name = conn
            .query_row(
                "SELECT dp.name AS name FROM personas p JOIN dev_projects dp                  ON dp.team_id = p.home_team_id AND dp.team_id IS NOT NULL                  WHERE p.id = ?1 AND dp.enabled = 0 LIMIT 1",
                params![persona_id],
                |r| r.get::<_, String>("name"),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        Ok(name)
    })
}

/// Ids of every persona homed in a switched-off project (the attention
/// preview reports them as disabled).
pub fn personas_in_disabled_projects(
    pool: &DbPool,
) -> Result<std::collections::HashSet<String>, AppError> {
    timed_query!(
        "dev_projects",
        "dev_projects::personas_in_disabled_projects",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT p.id AS id FROM personas p WHERE {}",
                project_off_sql("p")
            ))?;
            let ids = stmt
                .query_map([], |r| r.get::<_, String>("id"))?
                .collect::<Result<_, _>>()?;
            Ok(ids)
        }
    )
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

/// Delete a project row (and, through `foreign_keys = ON`, its ~21 cascaded
/// child families).
///
/// **Refuses** when the project belongs to a workspace tagged
/// `last_working_version` — the guard sits here rather than at the command so a
/// new caller inherits it (see
/// [`crate::repos::workspaces::protection`]).
pub fn delete_project(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_projects", "dev_projects::delete_project", {
        let conn = pool.get()?;
        crate::repos::workspaces::protection::ensure_project_deletable(&conn, id)?;
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

#[cfg(test)]
mod project_switch_tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::CreatePersonaInput;
    use crate::repos::core::personas as persona_repo;

    fn persona_in(pool: &DbPool, team_id: &str) -> String {
        let p = persona_repo::create(
            pool,
            CreatePersonaInput {
                name: "Switch Agent".into(),
                system_prompt: "Prompt.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();
        persona_repo::set_home_team(pool, &p.id, team_id).unwrap();
        p.id
    }

    #[test]
    fn switching_a_project_off_gates_its_personas_and_round_trips() {
        let pool = init_test_db().unwrap();
        let project = create_project(
            &pool,
            "Gated",
            "/tmp/project-switch-1",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let project = crate::project_team::ensure_project_team(&pool, &project).unwrap();
        assert!(project.enabled, "a new project starts switched on");
        let team_id = project.team_id.clone().expect("team linked");
        let persona_id = persona_in(&pool, &team_id);

        assert_eq!(persona_project_disabled(&pool, &persona_id).unwrap(), None);
        assert!(personas_in_disabled_projects(&pool).unwrap().is_empty());

        assert_eq!(set_enabled(&pool, &project.id, false).unwrap(), Some(false));
        assert_eq!(
            set_enabled(&pool, &project.id, false).unwrap(),
            None,
            "no-op flip reports no change"
        );
        assert!(!get_project_by_id(&pool, &project.id).unwrap().enabled);
        assert_eq!(
            persona_project_disabled(&pool, &persona_id)
                .unwrap()
                .as_deref(),
            Some("Gated")
        );
        assert!(personas_in_disabled_projects(&pool)
            .unwrap()
            .contains(&persona_id));
        // The persona's own switch is untouched by the project's.
        assert!(persona_repo::get_by_id(&pool, &persona_id).unwrap().enabled);

        assert_eq!(set_enabled(&pool, &project.id, true).unwrap(), Some(true));
        assert_eq!(persona_project_disabled(&pool, &persona_id).unwrap(), None);
    }

    #[test]
    fn a_persona_with_no_project_is_never_gated() {
        let pool = init_test_db().unwrap();
        let other = create_project(
            &pool,
            "Other",
            "/tmp/project-switch-2",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let other = crate::project_team::ensure_project_team(&pool, &other).unwrap();
        set_enabled(&pool, &other.id, false).unwrap();
        let lone = persona_repo::create(
            &pool,
            CreatePersonaInput {
                name: "Lone".into(),
                system_prompt: "Prompt.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();
        assert_eq!(persona_project_disabled(&pool, &lone.id).unwrap(), None);
    }

    #[test]
    fn set_enabled_on_a_missing_project_is_not_found() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            set_enabled(&pool, "nope", false),
            Err(AppError::NotFound(_))
        ));
    }
}
