//! The one-group-per-workspace invariant.
//!
//! **The decision (2026-09-20).** A dev workspace automatically owns exactly
//! one *cross-project group*: a `persona_teams` row with no `project_id`, which
//! holds the personas whose charters span every project in that workspace (the
//! Architect is the archetype). A project's team is its roster one level down;
//! this is the roster for the work that sits above all of them.
//!
//! **Where the link lives.** `persona_teams.workspace_id` is the authority, and
//! it has been since `e41_workspace_team_binding`. Before that column existed
//! the link was the *formatted name string* — `app_master_adopt.rs` minted
//! `"{workspace} — cross-project"` and then found it again by scanning every
//! team for that exact name. Two consequences, both silent: renaming a
//! workspace orphaned its group, and the next adoption minted a duplicate
//! beside it. A real column has neither failure mode, and the partial unique
//! index `idx_persona_teams_workspace_group` makes the duplicate
//! unrepresentable rather than merely unlikely.
//!
//! **The name is still derived, but it is no longer the key.**
//! [`workspace_group_name`] is the single definition of that format — the live
//! door, the backfill and the rename path all call it, so a backfilled group is
//! indistinguishable from an eagerly-created one. It survives as a *label*
//! because the legacy team surfaces (Channels, the pipeline canvas, the Fleet
//! dispatch picker) display `persona_teams.name` and a group has to read as
//! something in them.
//!
//! **Two doors, one invariant.** [`ensure_workspace_team`] is the live door
//! (every workspace-bound adoption calls it, so a workspace can never leave
//! that path groupless); the migration step `e41_workspace_team_binding` is the
//! backfill door for workspaces that existed before this rule did, and probes
//! the same postcondition. The pairing mirrors [`crate::project_team`], which
//! does this job one level down.

use personas_core::error::AppError;
use personas_core::models::{PersonaTeam, UpdateTeamInput};

use crate::repos::resources::teams as team_repo;
use crate::DbPool;

/// Mirrors `teams::MAX_TEAM_NAME_LEN` — a workspace name is unbounded, a team
/// name is not, so the derived name is clipped rather than rejected. Without
/// this, a long workspace name made `teams::create_workspace_group` refuse the
/// group and the workspace silently stayed groupless.
const MAX_TEAM_NAME_LEN: usize = 200;

/// What the derived name says a group IS. Kept as a constant so the clip below
/// can reason about the budget the suffix leaves the workspace name.
const GROUP_NAME_SUFFIX: &str = " — cross-project";

/// The canonical name a workspace's cross-project group carries.
///
/// **The exact format is load-bearing, em dash included.** Groups minted before
/// `workspace_id` existed carry this string and nothing else, so the backfill
/// adopts them BY it; changing the format would orphan every live group and
/// mint a duplicate beside it, which is the very defect this module retires.
///
/// Falls back to a non-empty literal because the creator refuses an empty
/// name and a workspace whose name is whitespace-only must still get a group.
pub fn workspace_group_name(workspace_name: &str) -> String {
    let trimmed = workspace_name.trim();
    let base = if trimmed.is_empty() {
        "Workspace"
    } else {
        trimmed
    };
    let budget = MAX_TEAM_NAME_LEN.saturating_sub(GROUP_NAME_SUFFIX.len());
    if base.len() > budget {
        // Clip on a char boundary — a multi-byte name must not panic here.
        let mut end = budget;
        while end > 0 && !base.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}{GROUP_NAME_SUFFIX}", &base[..end])
    } else {
        format!("{base}{GROUP_NAME_SUFFIX}")
    }
}

/// The description a workspace's group carries. Shared with the backfill step
/// so a converged row is byte-identical to a live-door one; `pub(crate)`
/// because only the migration needs it from outside this module.
pub(crate) fn workspace_group_description(workspace_name: &str) -> String {
    format!("Personas whose charters span every project in the {workspace_name} workspace.")
}

/// The workspace's cross-project group, or `None` when it has none yet.
///
/// Resolves through `workspace_id`, never through the name — that is the whole
/// point of this module.
pub fn group_for_workspace(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Option<PersonaTeam>, AppError> {
    team_repo::get_by_workspace_id(pool, workspace_id)
}

/// Guarantee `workspace_id` owns a live cross-project group, and return that
/// group's team id.
///
/// Idempotent, and idempotent in the way that matters: a workspace that already
/// carries a group from the name-keyed era is **adopted** (its existing row is
/// stamped with `workspace_id`, keeping its members, its channel history and
/// its id) rather than shadowed by a fresh one. Adoption before creation is the
/// single most important behaviour here — the alternative duplicates a group
/// the operator already populated.
pub fn ensure_workspace_team(
    pool: &DbPool,
    workspace_id: &str,
    workspace_name: &str,
) -> Result<String, AppError> {
    if let Some(existing) = group_for_workspace(pool, workspace_id)? {
        return Ok(existing.id);
    }

    let name = workspace_group_name(&personas_core::validation::strip_html_tags(workspace_name));

    // The name-keyed era's row: project-less, unbound, named exactly what this
    // workspace's group is named. Stamp it rather than mint beside it.
    if let Some(orphan) = team_repo::find_unbound_group_by_name(pool, &name)? {
        team_repo::set_workspace_id(pool, &orphan.id, Some(workspace_id))?;
        tracing::info!(
            workspace_id = %workspace_id,
            team_id = %orphan.id,
            "adopted an existing cross-project group for the workspace"
        );
        return Ok(orphan.id);
    }

    // One INSERT, through the narrow creator: `teams::create` deliberately has
    // no `workspace_id`, so this module is the only way a team becomes a group.
    // The creator writes no `project_id` — a group's whole meaning is that its
    // members answer to the workspace instead of to one project.
    match team_repo::create_workspace_group(
        pool,
        workspace_id,
        &name,
        Some(&workspace_group_description(workspace_name)),
    ) {
        Ok(team) => {
            tracing::info!(
                workspace_id = %workspace_id,
                team_id = %team.id,
                "created the workspace's cross-project group"
            );
            Ok(team.id)
        }
        // `idx_persona_teams_workspace_group` is a UNIQUE index, so a racing
        // caller that won loses us the INSERT and not the invariant. Re-read
        // rather than propagate: the postcondition this function promises is
        // satisfied, just not by us.
        Err(e) => match group_for_workspace(pool, workspace_id)? {
            Some(winner) => Ok(winner.id),
            None => Err(e),
        },
    }
}

/// Keep the group's name equal to the workspace's after a rename.
///
/// A workspace with no group is a no-op — [`ensure_workspace_team`] owns that
/// repair, not this function. Mirrors [`crate::project_team::sync_team_name`].
pub fn sync_group_name(
    pool: &DbPool,
    workspace_id: &str,
    new_workspace_name: &str,
) -> Result<(), AppError> {
    let Some(group) = group_for_workspace(pool, workspace_id)? else {
        return Ok(());
    };
    let name = workspace_group_name(&personas_core::validation::strip_html_tags(
        new_workspace_name,
    ));
    if group.name == name {
        return Ok(());
    }
    team_repo::update(
        pool,
        &group.id,
        UpdateTeamInput {
            name: Some(name),
            description: Some(Some(workspace_group_description(new_workspace_name))),
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
    use personas_core::models::CreateTeamInput;

    fn make_workspace(pool: &DbPool, id: &str, name: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        crate::PoolExt::conn(pool, "test:make_workspace")
            .unwrap()
            .execute(
                "INSERT INTO dev_workspaces (id, name, color, description, created_at, updated_at)
                 VALUES (?1, ?2, NULL, NULL, ?3, ?3)",
                rusqlite::params![id, name, now],
            )
            .unwrap();
    }

    /// Reads the count BY NAME through the crate's instrumented `PoolExt::conn`
    /// — the same two rules production code follows.
    fn team_count(pool: &DbPool) -> i64 {
        crate::PoolExt::conn(pool, "test:team_count")
            .unwrap()
            .query_row("SELECT COUNT(*) AS n FROM persona_teams", [], |r| {
                r.get("n")
            })
            .unwrap()
    }

    #[test]
    fn the_derived_name_is_the_format_the_name_keyed_era_wrote() {
        assert_eq!(workspace_group_name("Bank"), "Bank — cross-project");
        assert_eq!(workspace_group_name("  Bank  "), "Bank — cross-project");
        assert_eq!(workspace_group_name("   "), "Workspace — cross-project");
        assert!(workspace_group_name(&"x".repeat(500)).len() <= 200);
    }

    #[test]
    fn ensure_creates_a_group_named_after_the_workspace() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-1", "Core");
        assert!(group_for_workspace(&pool, "ws-1").unwrap().is_none());

        let team_id = ensure_workspace_team(&pool, "ws-1", "Core").unwrap();
        let group = group_for_workspace(&pool, "ws-1").unwrap().expect("group");
        assert_eq!(group.id, team_id);
        assert_eq!(group.name, "Core — cross-project");
        assert_eq!(group.project_id, None);
        assert_eq!(group.workspace_id.as_deref(), Some("ws-1"));
    }

    #[test]
    fn ensure_is_idempotent() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-2", "Core");
        let before = team_count(&pool);
        let first = ensure_workspace_team(&pool, "ws-2", "Core").unwrap();
        let second = ensure_workspace_team(&pool, "ws-2", "Core").unwrap();
        assert_eq!(first, second);
        assert_eq!(
            team_count(&pool),
            before + 1,
            "a second ensure must not mint a second group"
        );
    }

    /// The behaviour the whole module exists for: a group minted in the
    /// name-keyed era keeps its id (and therefore its members) instead of being
    /// shadowed by a duplicate.
    #[test]
    fn ensure_adopts_a_name_matching_unbound_group_instead_of_duplicating_it() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-3", "Bank");
        let legacy = team_repo::create(
            &pool,
            CreateTeamInput {
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

        let adopted = ensure_workspace_team(&pool, "ws-3", "Bank").unwrap();
        assert_eq!(adopted, legacy.id, "the legacy row must be adopted by id");
        assert_eq!(
            team_count(&pool),
            before,
            "adoption must not create a second group"
        );
        assert_eq!(
            group_for_workspace(&pool, "ws-3")
                .unwrap()
                .unwrap()
                .workspace_id
                .as_deref(),
            Some("ws-3")
        );
    }

    /// A project's team carries the same name by coincidence — it must NOT be
    /// adopted, because it is that project's roster and not the workspace's.
    #[test]
    fn ensure_never_adopts_a_project_bound_team() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-4", "Bank");
        team_repo::create(
            &pool,
            CreateTeamInput {
                name: "Bank — cross-project".into(),
                project_id: Some("some-project".into()),
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

        let created = ensure_workspace_team(&pool, "ws-4", "Bank").unwrap();
        assert_eq!(team_count(&pool), before + 1, "a new group must be minted");
        assert_eq!(
            group_for_workspace(&pool, "ws-4").unwrap().unwrap().id,
            created
        );
    }

    /// Two workspaces named the same must not fight over one group: the first
    /// adopts the unbound row, the second gets its own.
    #[test]
    fn two_workspaces_of_the_same_name_get_separate_groups() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-5a", "Twin");
        make_workspace(&pool, "ws-5b", "Twin");
        let a = ensure_workspace_team(&pool, "ws-5a", "Twin").unwrap();
        let b = ensure_workspace_team(&pool, "ws-5b", "Twin").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn sync_renames_the_group_and_is_a_no_op_without_one() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-6", "Old Name");
        // No group yet — the rename must not create one.
        sync_group_name(&pool, "ws-6", "New Name").unwrap();
        assert!(group_for_workspace(&pool, "ws-6").unwrap().is_none());

        let team_id = ensure_workspace_team(&pool, "ws-6", "Old Name").unwrap();
        sync_group_name(&pool, "ws-6", "New Name").unwrap();
        let group = group_for_workspace(&pool, "ws-6").unwrap().unwrap();
        assert_eq!(group.id, team_id, "a rename keeps the group's identity");
        assert_eq!(group.name, "New Name — cross-project");
    }

    /// The property the name key could not hold: after a rename the group is
    /// still found, and `ensure` does not mint a second one.
    #[test]
    fn a_renamed_workspace_still_resolves_to_its_group() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-7", "Before");
        let original = ensure_workspace_team(&pool, "ws-7", "Before").unwrap();
        sync_group_name(&pool, "ws-7", "After").unwrap();
        let after = ensure_workspace_team(&pool, "ws-7", "After").unwrap();
        assert_eq!(original, after);
    }

    /// The partial unique index is the structural half of the invariant: with
    /// `workspace_id` set and `project_id` NULL, a second row is refused by the
    /// database rather than by a convention.
    #[test]
    fn the_unique_index_refuses_a_second_group_for_one_workspace() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-8", "Core");
        ensure_workspace_team(&pool, "ws-8", "Core").unwrap();
        let second = team_repo::create_workspace_group(
            &pool,
            "ws-8",
            "Core — cross-project (impostor)",
            None,
        );
        assert!(second.is_err(), "the index must refuse the duplicate");
    }

    /// The declared parent fate, exercised rather than assumed: deleting the
    /// workspace must UNBIND the group, not refuse the delete (which is what an
    /// omitted `ON DELETE` would have done on SQLite) and not destroy the team.
    #[test]
    fn deleting_a_workspace_unbinds_its_group_and_keeps_the_team() {
        let pool = init_test_db().unwrap();
        make_workspace(&pool, "ws-9", "Doomed");
        let team_id = ensure_workspace_team(&pool, "ws-9", "Doomed").unwrap();

        crate::PoolExt::conn(&pool, "test:delete_workspace")
            .unwrap()
            .execute("DELETE FROM dev_workspaces WHERE id = ?1", ["ws-9"])
            .expect("the delete must not be refused by the foreign key");

        let team = team_repo::get_by_id(&pool, &team_id).expect("the team survives");
        assert_eq!(team.workspace_id, None, "the binding is cleared");
        assert!(group_for_workspace(&pool, "ws-9").unwrap().is_none());
    }

    /// `set_workspace_id` is aimed at one primary key, so a vanished team is a
    /// `NotFound` rather than a silent success.
    #[test]
    fn binding_a_team_that_does_not_exist_is_not_found() {
        let pool = init_test_db().unwrap();
        let err = team_repo::set_workspace_id(&pool, "no-such-team", Some("ws-x")).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
    }
}
