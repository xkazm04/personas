use crate::models::{DevProject, DevWorkspace, WorkspaceImportItem};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};

fn row_to_workspace(row: &Row) -> rusqlite::Result<DevWorkspace> {
    Ok(DevWorkspace {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        description: row.get("description")?,
        adopt_default_skills: row.get::<_, i64>("adopt_default_skills")? != 0,
        last_working_version: row.get::<_, i64>("last_working_version")? != 0,
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
    let workspace = timed_query!("dev_workspaces", "dev_workspaces::create_workspace", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_workspaces (id, name, color, description, adopt_default_skills, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, name.trim(), color, description, adopt_default_skills as i64, now],
        )?;
        get_workspace_by_id(pool, &id)
    })?;

    // The live door for the one-group-per-workspace invariant: a workspace
    // owns exactly one cross-project group, and it owns it from the instant it
    // exists. Pairs with the backfill in `e42_workspace_team_binding` exactly
    // as `project_identity::register_project` pairs `ensure_project_team` with
    // `e14_project_team_invariant` one level down.
    //
    // NOT the same SQL transaction as the INSERT, and it cannot be:
    // [`crate::workspace_team::ensure_workspace_team`] takes a `&DbPool` and
    // checks out its own connection, so holding a write transaction here would
    // deadlock it against ourselves. The pair is made atomic the other way —
    // the workspace is rolled back when its group cannot be created, so a
    // caller never receives a groupless workspace.
    if let Err(e) =
        crate::workspace_team::ensure_workspace_team(pool, &workspace.id, &workspace.name)
    {
        tracing::error!(
            workspace_id = %workspace.id,
            error = %e,
            "could not create the workspace's cross-project group — rolling the workspace back"
        );
        if let Err(cleanup) = rollback_workspace_row(pool, &workspace.id) {
            // Nothing left to do but say so loudly: the workspace exists
            // without its group, which is the one state this design has no
            // representation for.
            tracing::error!(
                workspace_id = %workspace.id,
                error = %cleanup,
                "could not roll back the groupless workspace — it is now an orphan"
            );
        }
        return Err(e);
    }

    Ok(workspace)
}

/// Undo a just-created workspace whose group could not be created.
///
/// Deliberately a raw DELETE rather than [`delete_workspace`]: the row is
/// milliseconds old, has no members and no `last_working_version` tag, so the
/// protection check that door applies would only be able to REFUSE the
/// rollback of a workspace nobody has seen yet.
fn rollback_workspace_row(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!(
        "dev_workspaces",
        "dev_workspaces::rollback_workspace_row",
        {
            let conn = pool.get()?;
            conn.execute("DELETE FROM dev_workspaces WHERE id = ?1", params![id])?;
            Ok(())
        }
    )
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
    let updated = timed_query!("dev_workspaces", "dev_workspaces::update_workspace", {
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
    })?;

    // The rename door. A workspace's cross-project group is NAMED after the
    // workspace (the name is a label now, not the key — see
    // `crate::workspace_team`), so a rename here renames the group too.
    // Best-effort, exactly like `project_team::sync_team_name`'s call site in
    // `dev_tools::dev_tools_update_project`: the rename is already persisted,
    // and a stale group label must not turn it into a failed call.
    if name.is_some() {
        if let Err(e) = crate::workspace_team::sync_group_name(pool, id, &updated.name) {
            tracing::warn!(
                workspace_id = %id,
                error = %e,
                "could not sync the workspace's cross-project group name after rename"
            );
        }
    }

    Ok(updated)
}

/// Delete a workspace. Member projects are unassigned — never deleted.
///
/// **Refuses** when the workspace is tagged `last_working_version` (see
/// [`super::protection`]).
pub fn delete_workspace(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::delete_workspace", {
        let mut conn = pool.get()?;
        super::protection::ensure_workspace_deletable(&conn, id)?;
        let tx = conn.transaction()?;
        // Membership is a dev_projects column, so unassigning members is that
        // repo's query, not this one's.
        crate::repos::dev::projects::clear_workspace_membership(&tx, id)?;
        let rows = tx.execute("DELETE FROM dev_workspaces WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Membership
// ============================================================================

/// Move a project into a workspace (or out of every one when `None`).
pub fn assign_project(
    pool: &DbPool,
    project_id: &str,
    workspace_id: Option<&str>,
) -> Result<DevProject, AppError> {
    if let Some(ws) = workspace_id {
        get_workspace_by_id(pool, ws)?;
    }
    // Existence check: a missing project is a NotFound, not a silent no-op.
    crate::repos::dev_tools::get_project_by_id(pool, project_id)?;

    timed_query!("dev_workspaces", "dev_workspaces::assign_project", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        crate::repos::dev::projects::set_workspace_membership(&tx, project_id, workspace_id, &now)?;
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

/// Full member projects of a workspace (name-sorted).
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::repos::resources::teams as team_repo;

    /// Counts BY NAME through the crate's instrumented `PoolExt::conn` — the
    /// same two rules production code follows.
    fn team_count(pool: &DbPool) -> i64 {
        crate::PoolExt::conn(pool, "test:team_count")
            .unwrap()
            .query_row("SELECT COUNT(*) AS n FROM persona_teams", [], |r| {
                r.get("n")
            })
            .unwrap()
    }

    /// The live door: a workspace owns its group from the instant it exists,
    /// and owns exactly one.
    #[test]
    fn creating_a_workspace_creates_exactly_one_cross_project_group() {
        let pool = init_test_db().unwrap();
        let before = team_count(&pool);

        let ws = create_workspace(&pool, "Bank", None, None, false).unwrap();

        assert_eq!(
            team_count(&pool),
            before + 1,
            "exactly one group, no more and no less"
        );
        let group = crate::workspace_team::group_for_workspace(&pool, &ws.id)
            .unwrap()
            .expect("the new workspace has a group");
        assert_eq!(group.name, "Bank — cross-project");
        assert_eq!(group.project_id, None);
        assert_eq!(group.workspace_id.as_deref(), Some(ws.id.as_str()));
    }

    /// Two workspaces are two groups — the door is per-workspace, not global.
    #[test]
    fn each_workspace_gets_its_own_group() {
        let pool = init_test_db().unwrap();
        let before = team_count(&pool);
        let a = create_workspace(&pool, "Bank", None, None, false).unwrap();
        let b = create_workspace(&pool, "Aside", None, None, false).unwrap();
        assert_eq!(team_count(&pool), before + 2);
        assert_ne!(
            crate::workspace_team::group_for_workspace(&pool, &a.id)
                .unwrap()
                .unwrap()
                .id,
            crate::workspace_team::group_for_workspace(&pool, &b.id)
                .unwrap()
                .unwrap()
                .id
        );
    }

    /// The rename door: the group's name follows the workspace's, and keeps
    /// its identity (and therefore its members) while doing so.
    #[test]
    fn renaming_a_workspace_renames_its_group() {
        let pool = init_test_db().unwrap();
        let ws = create_workspace(&pool, "Old Name", None, None, false).unwrap();
        let group_id = crate::workspace_team::group_for_workspace(&pool, &ws.id)
            .unwrap()
            .unwrap()
            .id;
        let before = team_count(&pool);

        update_workspace(&pool, &ws.id, Some("New Name"), None, None).unwrap();

        let group = crate::workspace_team::group_for_workspace(&pool, &ws.id)
            .unwrap()
            .expect("the group survives the rename");
        assert_eq!(group.id, group_id, "a rename keeps the group's identity");
        assert_eq!(group.name, "New Name — cross-project");
        assert_eq!(
            team_count(&pool),
            before,
            "a rename must not mint a second group"
        );
    }

    /// A non-name edit must not touch the group at all.
    #[test]
    fn recolouring_a_workspace_leaves_the_group_alone() {
        let pool = init_test_db().unwrap();
        let ws = create_workspace(&pool, "Bank", None, None, false).unwrap();
        let before = crate::workspace_team::group_for_workspace(&pool, &ws.id)
            .unwrap()
            .unwrap();

        update_workspace(&pool, &ws.id, None, Some(Some("#ef4444")), None).unwrap();

        let after = crate::workspace_team::group_for_workspace(&pool, &ws.id)
            .unwrap()
            .unwrap();
        assert_eq!(after.id, before.id);
        assert_eq!(after.name, before.name);
    }

    /// The legacy row the Grand Simulation's Bank carries: created by hand in
    /// the name-keyed era, unbound. A workspace of that name ADOPTS it instead
    /// of minting a second group beside it.
    #[test]
    fn creating_a_workspace_adopts_a_name_matching_legacy_group() {
        let pool = init_test_db().unwrap();
        let legacy = team_repo::create(
            &pool,
            crate::models::CreateTeamInput {
                name: "Bank — cross-project".into(),
                project_id: None,
                parent_team_id: None,
                description: None,
                canvas_data: None,
                team_config: None,
                icon: None,
                color: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        let before = team_count(&pool);

        let ws = create_workspace(&pool, "Bank", None, None, false).unwrap();

        assert_eq!(team_count(&pool), before, "adoption, not duplication");
        assert_eq!(
            crate::workspace_team::group_for_workspace(&pool, &ws.id)
                .unwrap()
                .unwrap()
                .id,
            legacy.id
        );
    }

    /// The import path funnels through `create_workspace`, so imported
    /// workspaces get their groups on the same terms.
    #[test]
    fn the_legacy_import_gets_groups_too() {
        let pool = init_test_db().unwrap();
        let before = team_count(&pool);
        let imported = import_local(
            &pool,
            &[crate::models::WorkspaceImportItem {
                name: "Imported".into(),
                color: None,
                project_ids: vec![],
            }],
        )
        .unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(team_count(&pool), before + 1);
        assert!(
            crate::workspace_team::group_for_workspace(&pool, &imported[0].id)
                .unwrap()
                .is_some()
        );
    }
}
