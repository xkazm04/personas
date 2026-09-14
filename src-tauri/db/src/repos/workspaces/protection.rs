//! The never-delete tag, and the guards that make it mean something.
//!
//! Grand Simulation rule 10 (`docs/architecture/grand-simulation.md`): *"Never
//! delete data Personas considers the 'last working version' in the workspace"*.
//! The tag is [`crate::models::DevWorkspace::last_working_version`], a column on
//! `dev_workspaces` (migration `e24_workspace_protection`); this module is the
//! only place that reads it for a refusal, so every guarded door refuses with
//! the same sentence and there is one place to correct the rule.
//!
//! **Reachability is what a guard checks, not table membership.** A protected
//! workspace's data is not only its own row: a member project, that project's
//! team, and that team's personas' charters are all "data in the workspace",
//! and a delete that starts from a project id would otherwise never look at a
//! workspace at all. So there are two entry points —
//! [`ensure_workspace_deletable`] for a workspace id and
//! [`ensure_project_deletable`] for a project id — and the second resolves
//! membership itself rather than trusting a caller to have done it.
//!
//! **The guards live at the lowest door, not at the command.** They are called
//! from inside the repo functions that issue the `DELETE`, so a new caller
//! inherits the refusal instead of having to remember it. The cost is that a
//! test which deletes a project must not have put it in a protected workspace,
//! which is the intended shape of the rule.
//!
//! A guard is a **read**, and an unprotected workspace (the overwhelmingly
//! common case) costs one indexed primary-key lookup on a table with as many
//! rows as the user has workspaces.

use rusqlite::{params, Connection, OptionalExtension};

use personas_core::error::AppError;

use crate::DbPool;

/// Is this workspace tagged as the last working version?
///
/// A workspace id that names no row is **not** protected — a guard must not
/// invent a refusal out of a dangling reference, and the delete it guards will
/// find nothing to delete anyway.
pub fn is_workspace_protected(conn: &Connection, workspace_id: &str) -> Result<bool, AppError> {
    timed_query!("dev_workspaces", "protection::is_workspace_protected", {
        let flag: Option<i64> = conn
            .query_row(
                "SELECT last_working_version FROM dev_workspaces WHERE id = ?1",
                params![workspace_id],
                |r| r.get("last_working_version"),
            )
            .optional()?;
        Ok(flag.unwrap_or(0) != 0)
    })
}

/// The workspace a project belongs to, or `None` when it is unassigned or the
/// project does not exist.
pub fn workspace_of_project(
    conn: &Connection,
    project_id: &str,
) -> Result<Option<String>, AppError> {
    timed_query!("dev_projects", "protection::workspace_of_project", {
        let ws: Option<Option<String>> = conn
            .query_row(
                "SELECT workspace_id FROM dev_projects WHERE id = ?1",
                params![project_id],
                |r| r.get("workspace_id"),
            )
            .optional()?;
        Ok(ws.flatten())
    })
}

/// The workspace a persona team belongs to, through the project that owns it,
/// or `None` when the team is not a project's team.
pub fn workspace_of_team(conn: &Connection, team_id: &str) -> Result<Option<String>, AppError> {
    timed_query!("dev_projects", "protection::workspace_of_team", {
        let ws: Option<Option<String>> = conn
            .query_row(
                "SELECT workspace_id FROM dev_projects WHERE team_id = ?1",
                params![team_id],
                |r| r.get("workspace_id"),
            )
            .optional()?;
        Ok(ws.flatten())
    })
}

/// The one refusal sentence. Named here so every door says the same thing and
/// a caller can match on the cause rather than on the text.
fn refuse(workspace_name: &str) -> AppError {
    AppError::Validation(format!(
        "workspace {workspace_name} is protected as the last working version"
    ))
}

fn workspace_name(conn: &Connection, workspace_id: &str) -> Result<String, AppError> {
    timed_query!("dev_workspaces", "protection::workspace_name", {
        let name: Option<String> = conn
            .query_row(
                "SELECT name FROM dev_workspaces WHERE id = ?1",
                params![workspace_id],
                |r| r.get("name"),
            )
            .optional()?;
        Ok(name.unwrap_or_else(|| workspace_id.to_string()))
    })
}

/// Refuse when `workspace_id` is tagged as the last working version.
pub fn ensure_workspace_deletable(conn: &Connection, workspace_id: &str) -> Result<(), AppError> {
    if is_workspace_protected(conn, workspace_id)? {
        return Err(refuse(&workspace_name(conn, workspace_id)?));
    }
    Ok(())
}

/// Refuse when the project belongs to a workspace tagged as the last working
/// version. An unassigned project is never protected — the tag is a property
/// of a workspace, and a project outside every workspace is in none.
pub fn ensure_project_deletable(conn: &Connection, project_id: &str) -> Result<(), AppError> {
    let Some(ws) = workspace_of_project(conn, project_id)? else {
        return Ok(());
    };
    ensure_workspace_deletable(conn, &ws)
}

/// Refuse when the team is a protected workspace's project's team — the door
/// that reaches the personas' charters, since a charter hangs off a persona
/// that hangs off the team.
pub fn ensure_team_deletable(conn: &Connection, team_id: &str) -> Result<(), AppError> {
    let Some(ws) = workspace_of_team(conn, team_id)? else {
        return Ok(());
    };
    ensure_workspace_deletable(conn, &ws)
}

/// Set or clear the tag. Returns the workspace as it now stands.
pub fn set_workspace_protection(
    pool: &DbPool,
    workspace_id: &str,
    protected: bool,
) -> Result<crate::models::DevWorkspace, AppError> {
    // Reads through the org repo so a missing workspace is the same
    // `NotFound` every other workspace call produces.
    super::org::get_workspace_by_id(pool, workspace_id)?;
    timed_query!("dev_workspaces", "protection::set_workspace_protection", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_workspaces SET last_working_version = ?1, updated_at = ?2 WHERE id = ?3",
            params![protected as i64, now, workspace_id],
        )?;
        drop(conn);
        super::org::get_workspace_by_id(pool, workspace_id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::repos::workspaces::org;

    #[test]
    fn tag_defaults_off_and_round_trips() {
        let pool = init_test_db().unwrap();
        let ws = org::create_workspace(&pool, "Bank", None, None, false).unwrap();
        assert!(!ws.last_working_version, "a new workspace is not protected");

        let tagged = set_workspace_protection(&pool, &ws.id, true).unwrap();
        assert!(tagged.last_working_version);
        let listed = org::list_workspaces(&pool).unwrap();
        assert!(listed
            .iter()
            .any(|w| w.id == ws.id && w.last_working_version));

        let cleared = set_workspace_protection(&pool, &ws.id, false).unwrap();
        assert!(!cleared.last_working_version);
    }

    /// The guards, at the repo doors themselves — the `db`-crate half of the
    /// end-to-end coverage in
    /// `commands::infrastructure::project_scaffold`'s tests.
    #[test]
    fn the_tag_refuses_the_project_the_team_and_the_workspace_delete() {
        let pool = init_test_db().unwrap();
        let ws = org::create_workspace(&pool, "Bank", None, None, false).unwrap();
        let project = crate::repos::dev::projects::create_project(
            &pool,
            "bank-core",
            "/tmp/personas-protection-test",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        // The production door for the one-team-per-project invariant, so the
        // `dev_projects.team_id` edge the team guard follows is the real one.
        let project = crate::project_team::ensure_project_team(&pool, &project).unwrap();
        let team_id = project.team_id.clone().expect("a team");
        org::assign_project(&pool, &project.id, Some(&ws.id)).unwrap();

        // A project OUTSIDE every workspace is never protected — the tag is a
        // property of a workspace, and this must stay true after tagging.
        let loose = crate::repos::dev::projects::create_project(
            &pool,
            "loose",
            "/tmp/personas-protection-loose",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        set_workspace_protection(&pool, &ws.id, true).unwrap();

        for err in [
            crate::repos::dev::projects::delete_project(&pool, &project.id).unwrap_err(),
            crate::repos::resources::teams::delete(&pool, &team_id).unwrap_err(),
            org::delete_workspace(&pool, &ws.id).unwrap_err(),
        ] {
            assert!(
                matches!(err, AppError::Validation(_)),
                "a refusal is the caller's mistake, not a 500: {err:?}"
            );
            assert!(
                err.to_string()
                    .contains("workspace Bank is protected as the last working version"),
                "{err}"
            );
        }

        // Nothing was deleted on the way to those refusals.
        assert!(crate::repos::dev::projects::get_project_by_id(&pool, &project.id).is_ok());
        assert!(crate::repos::resources::teams::get_by_id(&pool, &team_id).is_ok());
        assert!(org::get_workspace_by_id(&pool, &ws.id).is_ok());

        // The unassigned project is untouched by the tag.
        assert!(crate::repos::dev::projects::delete_project(&pool, &loose.id).unwrap());
    }

    #[test]
    fn an_unknown_workspace_id_is_not_protected() {
        let pool = init_test_db().unwrap();
        let conn = crate::PoolExt::conn(&pool, "test:protection_unknown").unwrap();
        assert!(!is_workspace_protected(&conn, "no-such-workspace").unwrap());
        // …and the guard therefore does not refuse on a dangling reference.
        ensure_workspace_deletable(&conn, "no-such-workspace").unwrap();
    }
}
