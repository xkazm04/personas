//! Backfill the one-team-per-project invariant.
//!
//! A dev project automatically owns exactly one team (2026-08-26): the team IS
//! the project's roster, and it carries the project's own name because that is
//! the label the legacy team surfaces (Channels, the canvas) already display.
//! `crate::project_team::ensure_project_team` holds the line for every project
//! registered from now on; this step converges the rows written before the rule
//! existed.
//!
//! Two shapes need repair and both are the same defect from the reader's side:
//! `dev_projects.team_id` **NULL** (never linked) and **dangling** (linked to a
//! `persona_teams` row that has since been deleted — the column carries no FK,
//! so nothing stopped that). The probe therefore asks the postcondition
//! directly ("is there any dev project whose team_id does not resolve?") rather
//! than probing a schema artefact, which is what makes the step converge on a
//! replay: after it runs there is no such row, so the second boot short-circuits.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;
use crate::project_team::team_name_for_project;

/// Rows whose `team_id` is NULL, blank, or points at a missing team.
const UNLINKED_PROJECTS_SQL: &str = "SELECT p.id, p.name FROM dev_projects p
     WHERE p.team_id IS NULL
        OR TRIM(p.team_id) = ''
        OR NOT EXISTS (SELECT 1 FROM persona_teams t WHERE t.id = p.team_id)";

fn every_project_owns_a_team(conn: &Connection) -> Result<bool, AppError> {
    // A database old enough to predate `e06_teams_and_sync` has no `team_id`
    // column at all; that era module runs before this one, so the column is
    // present by the time we get here — but probe anyway rather than aborting
    // the whole boot chain with `no such column` if the order ever shifts.
    if !has_column(conn, "dev_projects", "team_id")? || !has_table(conn, "persona_teams")? {
        return Ok(true);
    }
    let count: i64 = conn.query_row(
        &format!("SELECT COUNT(*) AS unlinked FROM ({UNLINKED_PROJECTS_SQL})"),
        [],
        |r| r.get("unlinked"),
    )?;
    Ok(count == 0)
}

/// What one pass found and did. A backfill's completion is a claim about a
/// POPULATION, not a number: without `found` as the denominator, "converged",
/// "nothing was applicable" and "every row failed" are the same observation.
/// `linked + failed == found` or the pass stopped early.
#[derive(Debug, Default, PartialEq, Eq)]
struct BackfillReceipt {
    found: usize,
    linked: usize,
    failed: usize,
}

/// Give every unlinked project a team. Per-project failures are COUNTED, not
/// propagated: one pathological row must not abort the boot chain for
/// everything behind it, and the step's own postcondition probe means the next
/// launch simply tries again.
fn link_missing_project_teams(conn: &Connection) -> Result<BackfillReceipt, AppError> {
    let orphans: Vec<(String, String)> = {
        let mut stmt = conn.prepare(UNLINKED_PROJECTS_SQL)?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>("id")?, r.get::<_, String>("name")?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let now = chrono::Utc::now().to_rfc3339();
    let mut receipt = BackfillReceipt {
        found: orphans.len(),
        ..Default::default()
    };
    for (project_id, project_name) in orphans {
        let team_id = uuid::Uuid::new_v4().to_string();
        // Same derivation the live door uses, over the same sanitiser
        // `teams::create` applies, so a backfilled team is indistinguishable
        // from one minted by `ensure_project_team`.
        let name =
            team_name_for_project(&personas_core::validation::strip_html_tags(&project_name));
        let linked = conn
            .execute(
                "INSERT INTO persona_teams
                (id, project_id, parent_team_id, name, description, canvas_data,
                 team_config, icon, color, enabled, created_at, updated_at)
             VALUES (?1, NULL, NULL, ?2, NULL, NULL, NULL, NULL, '#6B7280', 1, ?3, ?3)",
                rusqlite::params![team_id, name, now],
            )
            .and_then(|_| {
                conn.execute(
                    "UPDATE dev_projects SET team_id = ?2, updated_at = ?3 WHERE id = ?1",
                    rusqlite::params![project_id, team_id, now],
                )
            });
        match linked {
            Ok(_) => {
                receipt.linked += 1;
                tracing::info!(
                    project_id = %project_id,
                    team_id = %team_id,
                    "backfilled the project's team"
                );
            }
            Err(e) => {
                receipt.failed += 1;
                tracing::warn!(
                    project_id = %project_id,
                    error = %e,
                    "could not backfill the project's team — will retry next boot"
                );
            }
        }
    }
    Ok(receipt)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects.one_team_per_project_backfill",
            description:
                "Give every dev project a team named after it and link dev_projects.team_id",
            already_applied: every_project_owns_a_team,
            apply: |conn| {
                let receipt = link_missing_project_teams(conn)?;
                // The receipt is the observable — the step itself can only
                // report Ok/Err, and "0 found" and "all 12 failed" must not
                // look the same in the log.
                tracing::info!(
                    found = receipt.found,
                    linked = receipt.linked,
                    failed = receipt.failed,
                    "one-team-per-project backfill pass"
                );
                Ok(())
            },
        },
    )
}
