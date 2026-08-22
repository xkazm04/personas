use crate::models::{DevProject, DevWorkspace, WorkspaceImportItem};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};

use super::adoption::initial_adoption_state;

fn row_to_workspace(row: &Row) -> rusqlite::Result<DevWorkspace> {
    Ok(DevWorkspace {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        description: row.get("description")?,
        adopt_default_skills: row.get::<_, i64>("adopt_default_skills")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_workspaces(pool: &DbPool) -> Result<Vec<DevWorkspace>, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::list_workspaces", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM dev_workspaces ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], row_to_workspace)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_workspace_by_id(pool: &DbPool, id: &str) -> Result<DevWorkspace, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::get_workspace_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_workspaces WHERE id = ?1",
            params![id],
            row_to_workspace,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Workspace {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn create_workspace(
    pool: &DbPool,
    name: &str,
    color: Option<&str>,
    description: Option<&str>,
    adopt_default_skills: bool,
) -> Result<DevWorkspace, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation(
            "Workspace name cannot be empty".into(),
        ));
    }
    timed_query!("dev_workspaces", "dev_workspaces::create_workspace", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_workspaces (id, name, color, description, adopt_default_skills, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, name.trim(), color, description, adopt_default_skills as i64, now],
        )?;
        get_workspace_by_id(pool, &id)
    })
}

pub fn update_workspace(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    color: Option<Option<&str>>,
    description: Option<Option<&str>>,
) -> Result<DevWorkspace, AppError> {
    if let Some(n) = name {
        if n.trim().is_empty() {
            return Err(AppError::Validation(
                "Workspace name cannot be empty".into(),
            ));
        }
    }
    timed_query!("dev_workspaces", "dev_workspaces::update_workspace", {
        get_workspace_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(
            name.map(|s| s.trim().to_string()),
            "name",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            color.map(|o| o.map(|s| s.to_string())),
            "color",
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

        let sql = format!(
            "UPDATE dev_workspaces SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );
        param_values.push(Box::new(id.to_string()));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_workspace_by_id(pool, id)
    })
}

/// Delete a workspace. Member projects are unassigned — never deleted. The
/// workspace's knowledge and adoption rows go with it (explicit deletes:
/// SQLite FK cascade only fires with `PRAGMA foreign_keys=ON`, which we don't
/// rely on here).
pub fn delete_workspace(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::delete_workspace", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        // Membership is a dev_projects column, so unassigning members is that
        // repo's query, not this one's.
        crate::repos::dev::projects::clear_workspace_membership(&tx, id)?;
        tx.execute(
            "DELETE FROM workspace_practice_adoption WHERE practice_id IN
                 (SELECT id FROM workspace_knowledge WHERE workspace_id = ?1)",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM workspace_knowledge WHERE workspace_id = ?1",
            params![id],
        )?;
        let rows = tx.execute("DELETE FROM dev_workspaces WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Membership
// ============================================================================

/// Does a practice's applicability envelope match a project's tech stack?
///
/// Conservative-by-default: an item with no `languages`/`frameworks` filters
/// applies everywhere; when filters exist, the project's free-text
/// `tech_stack` must contain at least one entry (case-insensitive substring).
/// Arc-1 heuristic — richer RepoEvidence matching arrives with the harvest
/// engine.
pub fn applicability_matches(applicability: Option<&str>, tech_stack: Option<&str>) -> bool {
    let Some(raw) = applicability else {
        return true;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return true;
    };
    let mut filters: Vec<String> = Vec::new();
    for key in ["languages", "frameworks"] {
        if let Some(arr) = value.get(key).and_then(|v| v.as_array()) {
            filters.extend(
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_lowercase()),
            );
        }
    }
    if filters.is_empty() {
        return true;
    }
    let stack = tech_stack.unwrap_or("").to_lowercase();
    filters.iter().any(|f| !f.is_empty() && stack.contains(f))
}

/// Move a project into a workspace (or out of every one when `None`).
///
/// Keeps the adoption matrix consistent in the same transaction:
/// - leaving the old workspace deletes the project's adoption rows there,
/// - joining a workspace fans out its `adopted` practices as the project's
///   to-adopt queue (`proposed`, or `na` when applicability doesn't match).
pub fn assign_project(
    pool: &DbPool,
    project_id: &str,
    workspace_id: Option<&str>,
) -> Result<DevProject, AppError> {
    if let Some(ws) = workspace_id {
        get_workspace_by_id(pool, ws)?;
    }
    let project = crate::repos::dev_tools::get_project_by_id(pool, project_id)?;

    timed_query!("dev_workspaces", "dev_workspaces::assign_project", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        if let Some(old_ws) = project.workspace_id.as_deref() {
            if Some(old_ws) != workspace_id {
                tx.execute(
                    "DELETE FROM workspace_practice_adoption
                     WHERE project_id = ?1 AND practice_id IN
                         (SELECT id FROM workspace_knowledge WHERE workspace_id = ?2)",
                    params![project_id, old_ws],
                )?;
            }
        }

        crate::repos::dev::projects::set_workspace_membership(&tx, project_id, workspace_id, &now)?;

        if let Some(new_ws) = workspace_id {
            let adopted: Vec<(String, String, Option<String>)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, kind, applicability FROM workspace_knowledge
                     WHERE workspace_id = ?1 AND status = 'adopted'",
                )?;
                let rows = stmt
                    .query_map(params![new_ws], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            for (practice_id, kind, applicability) in adopted {
                let state = initial_adoption_state(
                    &kind,
                    applicability.as_deref(),
                    project.tech_stack.as_deref(),
                );
                tx.execute(
                    "INSERT OR IGNORE INTO workspace_practice_adoption
                         (practice_id, project_id, state, updated_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![practice_id, project_id, state, now],
                )?;
            }
        }

        tx.commit()?;
        crate::repos::dev_tools::get_project_by_id(pool, project_id)
    })
}

/// One-time import of the retired localStorage prototype. Idempotent on
/// workspace name (case-insensitive); unknown project ids are skipped
/// silently (the prototype may reference deleted projects).
pub fn import_local(
    pool: &DbPool,
    items: &[WorkspaceImportItem],
) -> Result<Vec<DevWorkspace>, AppError> {
    let mut imported = Vec::new();
    for item in items {
        if item.name.trim().is_empty() {
            continue;
        }
        let existing: Option<String> = {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT id FROM dev_workspaces WHERE name = ?1 COLLATE NOCASE",
                params![item.name.trim()],
                |r| r.get(0),
            )
            .optional()?
        };
        let ws = match existing {
            Some(id) => get_workspace_by_id(pool, &id)?,
            None => create_workspace(pool, &item.name, item.color.as_deref(), None, false)?,
        };
        for project_id in &item.project_ids {
            // Only assign projects that exist and aren't already in a workspace
            // (an explicit in-app assignment wins over the legacy prototype).
            let current: Option<Option<String>> = {
                let conn = pool.get()?;
                crate::repos::dev::projects::workspace_id_of(&conn, project_id)?
            };
            if matches!(current, Some(None)) {
                assign_project(pool, project_id, Some(&ws.id))?;
            }
        }
        imported.push(ws);
    }
    Ok(imported)
}

// ============================================================================
// Knowledge
// ============================================================================

/// Full member projects of a workspace (name-sorted). Used by harvest prepare
/// to compose the sibling roster.
pub fn list_workspace_projects(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<DevProject>, AppError> {
    timed_query!("dev_projects", "dev_workspaces::list_workspace_projects", {
        let conn = pool.get()?;
        crate::repos::dev::projects::list_by_workspace(&conn, workspace_id)
            .map_err(AppError::Database)
    })
}
