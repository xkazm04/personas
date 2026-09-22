//! Bind a workspace's cross-project group to the workspace by id, and give
//! every existing workspace one.
//!
//! A workspace owns exactly one cross-project group: a `persona_teams` row with
//! no `project_id`, holding the personas whose charters span every project in
//! it. That already half-existed — the adoption door minted a team named
//! `"{workspace} — cross-project"` and then found it again by scanning every
//! team for that exact string. A name is not a key: renaming the workspace
//! orphaned the group, and the next adoption minted a duplicate beside it,
//! both silently. `crate::workspace_team` holds the line from now on; this step
//! adds the column the binding lives in, the index that makes a duplicate
//! unrepresentable, and converges the workspaces written before the rule
//! existed.
//!
//! **Three steps, not one.** The column, the index and the backfill each probe
//! the object they themselves create, so a crash between any two of them
//! resumes rather than records a lie (census `unresumable-migration-step`
//! exists for the opposite shape: one probe guarding several DDL transactions).
//!
//! **The backfill probes its postcondition, not a schema artefact.**
//! [`every_workspace_owns_a_group`] answers "does every workspace already own a
//! group", which is what makes the step converge on replay — `run_step`
//! (`support.rs`) keeps no record of which ids have run and consults
//! `already_applied` alone, so a step that answers `false` re-runs on every
//! single boot. `e14_project_team_invariant` is the precedent this follows.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;
use crate::workspace_team::{workspace_group_description, workspace_group_name};

/// The partial unique index that makes "one group per workspace" a database
/// fact. Partial on both columns: an ordinary team has a NULL `workspace_id`
/// (and there are many of those), and a project's roster has a `project_id`.
const WORKSPACE_GROUP_INDEX: &str = "idx_persona_teams_workspace_group";

/// Workspaces with no cross-project group yet. The pair `(workspace_id set,
/// project_id NULL)` is exactly what the unique index is built on, so the probe
/// and the constraint cannot disagree about what a group is.
const UNGROUPED_WORKSPACES_SQL: &str = "SELECT w.id, w.name FROM dev_workspaces w
     WHERE NOT EXISTS (
         SELECT 1 FROM persona_teams t
         WHERE t.workspace_id = w.id AND t.project_id IS NULL
     )";

fn every_workspace_owns_a_group(conn: &Connection) -> Result<bool, AppError> {
    // Both tables and the column are created above this line in the chain, but
    // probe anyway rather than abort the whole boot with `no such column` if
    // the order ever shifts. `dev_workspaces` in particular is created by the
    // `c0*` composite chain, not by this one.
    if !has_table(conn, "dev_workspaces")?
        || !has_table(conn, "persona_teams")?
        || !has_column(conn, "persona_teams", "workspace_id")?
    {
        return Ok(true);
    }
    let count: i64 = conn.query_row(
        &format!("SELECT COUNT(*) AS ungrouped FROM ({UNGROUPED_WORKSPACES_SQL})"),
        [],
        |r| r.get("ungrouped"),
    )?;
    Ok(count == 0)
}

/// What one pass found and did. A backfill's completion is a claim about a
/// POPULATION, not a number: without `found` as the denominator, "converged",
/// "nothing was applicable" and "every row failed" are the same observation.
/// `adopted + created + failed == found` or the pass stopped early.
///
/// `adopted` and `created` are separate on purpose and it is the whole point of
/// this step: adopting the group the operator already populated preserves its
/// id, its members and its channel history, while creating one beside it is the
/// duplicate this migration exists to prevent. A single `handled` count would
/// hide which of the two happened.
#[derive(Debug, Default, PartialEq, Eq)]
struct WorkspaceGroupReceipt {
    found: usize,
    adopted: usize,
    created: usize,
    failed: usize,
}

/// A project-less, workspace-less team of exactly this name: the shape the
/// name-keyed era wrote. `project_id IS NULL` keeps a project's identically
/// named roster out of the adoption.
const ADOPTABLE_GROUP_SQL: &str = "SELECT id FROM persona_teams
     WHERE name = ?1 AND project_id IS NULL AND workspace_id IS NULL
     ORDER BY created_at ASC, id ASC
     LIMIT 1";

/// Give every groupless workspace a cross-project group, adopting the
/// name-matching row where one exists. Per-workspace failures are COUNTED, not
/// propagated: one pathological row must not abort the boot chain for
/// everything behind it, and the step's own postcondition probe means the next
/// launch simply tries again.
fn backfill_workspace_groups(conn: &Connection) -> Result<WorkspaceGroupReceipt, AppError> {
    let ungrouped: Vec<(String, String)> = {
        let mut stmt = conn.prepare(UNGROUPED_WORKSPACES_SQL)?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>("id")?, r.get::<_, String>("name")?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let now = chrono::Utc::now().to_rfc3339();
    let mut receipt = WorkspaceGroupReceipt {
        found: ungrouped.len(),
        ..Default::default()
    };

    for (workspace_id, workspace_name) in ungrouped {
        // Same derivation the live door uses, over the same sanitiser
        // `teams::create` applies, so a backfilled group is indistinguishable
        // from one minted by `ensure_workspace_team`.
        let clean = personas_core::validation::strip_html_tags(&workspace_name);
        let name = workspace_group_name(&clean);

        let adoptable: Option<String> = {
            let mut stmt = conn.prepare(ADOPTABLE_GROUP_SQL)?;
            let mut rows = stmt.query(rusqlite::params![name])?;
            match rows.next()? {
                Some(row) => Some(row.get::<_, String>("id")?),
                None => None,
            }
        };

        match adoptable {
            // Adopt: the operator's existing group keeps its id, and therefore
            // its members and its history. This is the branch that matters.
            Some(team_id) => {
                let stamped = conn.execute(
                    "UPDATE persona_teams SET workspace_id = ?2, updated_at = ?3 WHERE id = ?1",
                    rusqlite::params![team_id, workspace_id, now],
                );
                match stamped {
                    Ok(_) => {
                        receipt.adopted += 1;
                        tracing::info!(
                            workspace_id = %workspace_id,
                            team_id = %team_id,
                            "adopted the workspace's existing cross-project group"
                        );
                    }
                    Err(e) => {
                        receipt.failed += 1;
                        tracing::warn!(
                            workspace_id = %workspace_id,
                            team_id = %team_id,
                            error = %e,
                            "could not adopt the workspace's cross-project group — will retry next boot"
                        );
                    }
                }
            }
            None => {
                let team_id = uuid::Uuid::new_v4().to_string();
                let created = conn.execute(
                    "INSERT INTO persona_teams
                        (id, project_id, parent_team_id, name, description, canvas_data,
                         team_config, icon, color, enabled, workspace_id, created_at, updated_at)
                     VALUES (?1, NULL, NULL, ?2, ?3, NULL, NULL, NULL, '#6B7280', 1, ?4, ?5, ?5)",
                    rusqlite::params![
                        team_id,
                        name,
                        workspace_group_description(&clean),
                        workspace_id,
                        now
                    ],
                );
                match created {
                    Ok(_) => {
                        receipt.created += 1;
                        tracing::info!(
                            workspace_id = %workspace_id,
                            team_id = %team_id,
                            "created the workspace's cross-project group"
                        );
                    }
                    Err(e) => {
                        receipt.failed += 1;
                        tracing::warn!(
                            workspace_id = %workspace_id,
                            error = %e,
                            "could not create the workspace's cross-project group — will retry next boot"
                        );
                    }
                }
            }
        }
    }
    Ok(receipt)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_teams.workspace_id",
            description:
                "Bind a workspace's cross-project group by id instead of by its formatted name",
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_teams")?
                    || has_column(conn, "persona_teams", "workspace_id")?)
            },
            apply: |conn| {
                // Nullable and DEFAULT-less on purpose: most teams are a
                // project's roster and belong to no workspace, and a DEFAULT
                // without NOT NULL binds the writer while promising the reader
                // nothing (census `nullable-default-column`).
                //
                // `ON DELETE SET NULL`, stated rather than omitted: an omitted
                // fate is NO ACTION on SQLite, which REFUSES the workspace
                // delete rather than leaving the team alone — the opposite of
                // what is wanted here. A group records something that happened
                // TO the workspace and outlives it: when the workspace goes,
                // the team keeps its members and its history and simply stops
                // being anyone's group.
                ddl_step(
                    conn,
                    "ALTER TABLE persona_teams ADD COLUMN workspace_id TEXT
                     REFERENCES dev_workspaces(id) ON DELETE SET NULL;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_teams.workspace_group_unique_index",
            description:
                "One cross-project group per workspace, enforced by a partial unique index",
            already_applied: |conn| {
                Ok(!has_column(conn, "persona_teams", "workspace_id")?
                    || has_index(conn, WORKSPACE_GROUP_INDEX)?)
            },
            // Runs BEFORE the backfill, so the backfill's own writes are the
            // first thing the constraint sees. Every pre-existing row has a
            // NULL workspace_id and is excluded by the WHERE clause, so this
            // can never fail on live data at adoption time.
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_teams_workspace_group
                     ON persona_teams(workspace_id)
                     WHERE workspace_id IS NOT NULL AND project_id IS NULL;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_teams.workspace_group_backfill",
            description:
                "Give every workspace a cross-project group, adopting the name-matching one where it exists",
            already_applied: every_workspace_owns_a_group,
            apply: |conn| {
                let receipt = backfill_workspace_groups(conn)?;
                // The receipt is the observable — the step itself can only
                // report Ok/Err, and "0 found", "3 adopted" and "all 3 failed"
                // must not look the same in the log.
                tracing::info!(
                    found = receipt.found,
                    adopted = receipt.adopted,
                    created = receipt.created,
                    failed = receipt.failed,
                    "workspace cross-project group backfill pass"
                );
                Ok(())
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO dev_workspaces (id, name, color, description, created_at, updated_at)
             VALUES (?1, ?2, NULL, NULL, '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')",
            rusqlite::params![id, name],
        )
        .unwrap();
    }

    fn team_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) AS n FROM persona_teams", [], |r| {
            r.get("n")
        })
        .unwrap()
    }

    /// A database shaped like the live one: the chain has already run, so the
    /// column and index exist and only the backfill has anything to do.
    fn migrated_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::migrations::run(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        conn
    }

    #[test]
    fn the_column_and_the_index_exist_after_the_chain() {
        let conn = migrated_conn();
        assert!(has_column(&conn, "persona_teams", "workspace_id").unwrap());
        assert!(has_index(&conn, WORKSPACE_GROUP_INDEX).unwrap());
    }

    /// The live machine's shape: three workspaces, one of which already carries
    /// a hand-made group. The existing row must be ADOPTED, never duplicated.
    #[test]
    fn the_backfill_adopts_an_existing_group_and_creates_the_rest() {
        let conn = migrated_conn();
        workspace(&conn, "ws-core", "Core");
        workspace(&conn, "ws-sim", "sim-dryrun-202609081132");
        workspace(&conn, "ws-bank", "Bank");
        conn.execute(
            "INSERT INTO persona_teams
                (id, project_id, parent_team_id, name, description, canvas_data, team_config,
                 icon, color, enabled, created_at, updated_at)
             VALUES ('legacy-bank', NULL, NULL, 'Bank — cross-project', NULL, NULL, NULL,
                     NULL, '#6B7280', 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let before = team_count(&conn);

        let receipt = backfill_workspace_groups(&conn).unwrap();
        assert_eq!(
            receipt,
            WorkspaceGroupReceipt {
                found: 3,
                adopted: 1,
                created: 2,
                failed: 0,
            }
        );
        assert_eq!(team_count(&conn), before + 2, "only two rows were new");

        let bank_group: String = conn
            .query_row(
                "SELECT id FROM persona_teams WHERE workspace_id = 'ws-bank'",
                [],
                |r| r.get("id"),
            )
            .unwrap();
        assert_eq!(
            bank_group, "legacy-bank",
            "the operator's existing group must keep its id"
        );
    }

    #[test]
    fn the_backfill_converges_on_a_second_pass() {
        let conn = migrated_conn();
        workspace(&conn, "ws-core", "Core");
        workspace(&conn, "ws-bank", "Bank");

        let first = backfill_workspace_groups(&conn).unwrap();
        assert_eq!(first.found, 2);
        assert!(!every_workspace_owns_a_group(&conn).unwrap() || first.failed == 0);

        assert!(
            every_workspace_owns_a_group(&conn).unwrap(),
            "the postcondition must hold after one pass"
        );
        let second = backfill_workspace_groups(&conn).unwrap();
        assert_eq!(
            second,
            WorkspaceGroupReceipt::default(),
            "a converged population finds nothing to do"
        );
    }

    /// A project's roster that happens to carry the same name is not a group.
    #[test]
    fn the_backfill_never_adopts_a_project_bound_team() {
        let conn = migrated_conn();
        workspace(&conn, "ws-bank", "Bank");
        conn.execute(
            "INSERT INTO persona_teams
                (id, project_id, parent_team_id, name, description, canvas_data, team_config,
                 icon, color, enabled, created_at, updated_at)
             VALUES ('roster', 'some-project', NULL, 'Bank — cross-project', NULL, NULL, NULL,
                     NULL, '#6B7280', 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();

        let receipt = backfill_workspace_groups(&conn).unwrap();
        assert_eq!(receipt.adopted, 0);
        assert_eq!(receipt.created, 1);
        let bound: Option<String> = conn
            .query_row(
                "SELECT workspace_id FROM persona_teams WHERE id = 'roster'",
                [],
                |r| r.get("workspace_id"),
            )
            .unwrap();
        assert_eq!(bound, None, "a project's roster must stay unbound");
    }

    /// With no workspaces at all the step is not "done because it worked" — it
    /// is done because there was nothing to do, and the receipt says so.
    #[test]
    fn an_empty_population_is_distinguishable_from_a_converged_one() {
        let conn = migrated_conn();
        assert!(every_workspace_owns_a_group(&conn).unwrap());
        assert_eq!(
            backfill_workspace_groups(&conn).unwrap(),
            WorkspaceGroupReceipt::default()
        );
    }
}
