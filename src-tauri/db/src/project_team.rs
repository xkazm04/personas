//! The one-team-per-project invariant.
//!
//! **The decision (2026-08-26).** A dev project automatically owns exactly one
//! team, and that team IS the project's roster (0..x members). Teams are no
//! longer minted by hand and no longer carry an independent name — legacy
//! surfaces that display `persona_teams.name` (Channels, the pipeline canvas,
//! the Fleet dispatch picker) should show the project's own label, so the
//! honest name for a project's team is the project's name.
//!
//! **Where the link lives.** `dev_projects.team_id` is the authority, and it
//! has been since `e06_teams_and_sync`. `persona_teams.project_id` exists in
//! the schema but is written by nothing and read by nothing — deliberately
//! left alone here rather than turned into a second, unvalidated edge that
//! could disagree with the first. `teams::is_linked_to_dev_project` already
//! resolves the relationship through `dev_projects.team_id`.
//!
//! **Two doors, one invariant.** [`ensure_project_team`] is the live door
//! (`project_identity::register_project` calls it on every registration, so a
//! project can never leave that path teamless); the migration step
//! `e14_project_team_invariant` is the backfill door for rows written before
//! this rule existed, and probes the same postcondition.

use personas_core::error::AppError;
use personas_core::models::{CreateTeamInput, DevProject, UpdateTeamInput};

use crate::repos::dev::projects as project_repo;
use crate::repos::resources::teams as team_repo;
use crate::DbPool;

/// Mirrors `teams::MAX_TEAM_NAME_LEN` — a project name is unbounded, a team
/// name is not, so the derived name is clipped rather than rejected.
const MAX_TEAM_NAME_LEN: usize = 200;

/// The name a project's team carries. Falls back to a non-empty literal
/// because `teams::create` refuses an empty name and a project whose name is
/// whitespace-only must still end up with a team.
pub fn team_name_for_project(project_name: &str) -> String {
    let trimmed = project_name.trim();
    let base = if trimmed.is_empty() {
        "Project"
    } else {
        trimmed
    };
    if base.len() > MAX_TEAM_NAME_LEN {
        // Clip on a char boundary — a multi-byte name must not panic here.
        let mut end = MAX_TEAM_NAME_LEN;
        while end > 0 && !base.is_char_boundary(end) {
            end -= 1;
        }
        base[..end].to_string()
    } else {
        base.to_string()
    }
}

/// Guarantee `project` owns a live team, creating and linking one when its
/// `team_id` is absent or dangling. Returns the project as it now stands (the
/// re-read row when a link was written, the argument otherwise).
///
/// Idempotent: a project whose `team_id` resolves is returned untouched, so
/// this is safe on every registration of an already-registered repo.
pub fn ensure_project_team(pool: &DbPool, project: &DevProject) -> Result<DevProject, AppError> {
    if let Some(team_id) = project.team_id.as_deref() {
        if !team_id.trim().is_empty() {
            match team_repo::get_by_id(pool, team_id) {
                Ok(_) => return Ok(project.clone()),
                // Dangling link — the team was deleted out from under the
                // project. Fall through and mint a replacement rather than
                // leaving the project pointing at nothing.
                Err(AppError::NotFound(_)) => {
                    tracing::warn!(
                        project_id = %project.id,
                        team_id = %team_id,
                        "dev project points at a team that no longer exists — re-creating"
                    );
                }
                Err(e) => return Err(e),
            }
        }
    }

    let team = team_repo::create(
        pool,
        CreateTeamInput {
            name: team_name_for_project(&project.name),
            // Left None on purpose — see the module header.
            project_id: None,
            parent_team_id: None,
            description: None,
            canvas_data: None,
            team_config: None,
            icon: None,
            color: None,
            enabled: Some(true),
        },
    )?;
    tracing::info!(
        project_id = %project.id,
        team_id = %team.id,
        "created the project's team"
    );
    project_repo::set_team_id(pool, &project.id, Some(&team.id))
}

/// Keep the linked team's name equal to the project's after a rename.
/// A project with no (or a dangling) team link is a no-op — `ensure_project_team`
/// owns that repair, not this function.
pub fn sync_team_name(pool: &DbPool, project: &DevProject) -> Result<(), AppError> {
    let Some(team_id) = project.team_id.as_deref().filter(|s| !s.trim().is_empty()) else {
        return Ok(());
    };
    let name = team_name_for_project(&project.name);
    match team_repo::get_by_id(pool, team_id) {
        Ok(team) if team.name == name => return Ok(()),
        Ok(_) => {}
        Err(AppError::NotFound(_)) => return Ok(()),
        Err(e) => return Err(e),
    }
    team_repo::update(
        pool,
        team_id,
        UpdateTeamInput {
            name: Some(name),
            description: None,
            canvas_data: None,
            team_config: None,
            icon: None,
            color: None,
            enabled: None,
            shared_instructions: None,
            default_model_profile: None,
            default_max_budget_usd: None,
            default_max_turns: None,
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn make_project(pool: &DbPool, name: &str, path: &str) -> DevProject {
        project_repo::create_project(pool, name, path, None, None, None, None, None).unwrap()
    }

    #[test]
    fn ensure_creates_and_links_a_team_named_after_the_project() {
        let pool = init_test_db().unwrap();
        let p = make_project(&pool, "Personas", "/tmp/ensure-1");
        assert!(p.team_id.is_none(), "fixture must start teamless");

        let linked = ensure_project_team(&pool, &p).unwrap();
        let team_id = linked.team_id.clone().expect("team linked");
        let team = team_repo::get_by_id(&pool, &team_id).unwrap();
        assert_eq!(team.name, "Personas");
    }

    /// Checks out through the crate's instrumented `PoolExt::conn` and reads
    /// the count BY NAME — the same two rules production code follows.
    fn team_count(pool: &DbPool) -> i64 {
        crate::PoolExt::conn(pool, "test:team_count")
            .unwrap()
            .query_row("SELECT COUNT(*) AS n FROM persona_teams", [], |r| {
                r.get("n")
            })
            .unwrap()
    }

    #[test]
    fn ensure_is_idempotent() {
        let pool = init_test_db().unwrap();
        let p = make_project(&pool, "Personas", "/tmp/ensure-2");
        let first = ensure_project_team(&pool, &p).unwrap();
        let second = ensure_project_team(&pool, &first).unwrap();
        assert_eq!(first.team_id, second.team_id);
        assert_eq!(
            team_count(&pool),
            1,
            "a second ensure must not mint a second team"
        );
    }

    #[test]
    fn ensure_replaces_a_dangling_link() {
        let pool = init_test_db().unwrap();
        let p = make_project(&pool, "Ghost", "/tmp/ensure-3");
        let linked = ensure_project_team(&pool, &p).unwrap();
        let old = linked.team_id.clone().unwrap();
        team_repo::delete(&pool, &old).unwrap();

        let healed = ensure_project_team(&pool, &linked).unwrap();
        let new_id = healed.team_id.expect("re-linked");
        assert_ne!(new_id, old);
        assert_eq!(team_repo::get_by_id(&pool, &new_id).unwrap().name, "Ghost");
    }

    #[test]
    fn sync_renames_the_linked_team() {
        let pool = init_test_db().unwrap();
        let p = make_project(&pool, "Old Name", "/tmp/ensure-4");
        let linked = ensure_project_team(&pool, &p).unwrap();
        let team_id = linked.team_id.clone().unwrap();

        let renamed = DevProject {
            name: "New Name".into(),
            ..linked
        };
        sync_team_name(&pool, &renamed).unwrap();
        assert_eq!(
            team_repo::get_by_id(&pool, &team_id).unwrap().name,
            "New Name"
        );
    }

    #[test]
    fn a_whitespace_only_project_name_still_yields_a_valid_team_name() {
        assert_eq!(team_name_for_project("   "), "Project");
        assert_eq!(team_name_for_project(" Trimmed "), "Trimmed");
        assert_eq!(team_name_for_project(&"x".repeat(500)).len(), 200);
    }
}
