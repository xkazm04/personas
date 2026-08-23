use crate::models::WorkspacePracticeAdoption;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

use super::knowledge::get_knowledge_by_id;
use super::knowledge::validate_one_of;
use super::org::applicability_matches;

pub const ADOPTION_STATES: [&str; 6] = [
    "na",
    "proposed",
    "to_process",
    "dispatched",
    "adopted",
    "diverged",
];

/// Kinds whose adoption implies WORK inside a member repo rather than a note
/// to carry: a `pitfall` names something to remove, a `pattern` names
/// something to converge on. `decision` / `howto` / `fact` are reference
/// material — they reach the repo through the memory projection
/// (`project_practices`) and need no execution.
pub const ACTIONABLE_KINDS: [&str; 2] = ["pitfall", "pattern"];

pub fn is_actionable_kind(kind: &str) -> bool {
    ACTIONABLE_KINDS.contains(&kind)
}

/// Seed state for a per-project adoption cell the moment a practice becomes
/// canon: `na` when the practice cannot apply to that stack at all, otherwise
/// `proposed`.
///
/// **`to_process` is deliberately NOT seeded here.** The first design keyed it
/// on `kind`, reasoning that a pitfall or pattern names work a repo owes. The
/// 2026-07-27 twelve-territory scan falsified that: 302 of 330 harvested items
/// (91.5%) are pitfall-or-pattern, and 288 are also `durable` and non-`macro`,
/// so no refinement of the authored metadata rescues it. A queue holding 90% of
/// the library is a synonym for "adopted", not a queue.
///
/// The error was conceptual, not a threshold: `kind` describes the SHAPE of a
/// practice, never whether THIS repo violates it. A pattern the repo already
/// follows is not work. Only evidence can answer that, and the app already
/// gathers it — the verify pass reads the repo and rules on each practice. So
/// `to_process` is now entered from a verdict (see `adoption_state_after_verdict`),
/// never from a guess at adoption time. `is_actionable_kind` survives as the
/// pre-filter for WHICH practices are worth spending a verification on.
pub fn initial_adoption_state(
    kind: &str,
    applicability: Option<&str>,
    tech_stack: Option<&str>,
) -> &'static str {
    let _ = kind;
    if applicability_matches(applicability, tech_stack) {
        "proposed"
    } else {
        "na"
    }
}

/// Where a cell lands after the verify pass rules on it.
///
/// The prior state carries the meaning, so the same verdict means different
/// things in different places:
/// - a practice this repo had ADOPTED that no longer holds has **drifted** →
///   `diverged` (a regression; someone changed the code out from under canon)
/// - a practice this repo has NOT applied that does not hold is **work owed**
///   → `to_process` (the executor queue, now sized by real gaps)
/// - a practice that HOLDS is satisfied here, whether or not anyone ever
///   "adopted" it → `adopted`. A repo that already complies should not sit at
///   `proposed` forever; that understated liquidity is why the pillar read low.
/// `applies == false` means the practice targets a stack or concern this repo
/// does not have. That is a different answer from "the code does not do this",
/// and conflating them files real work against a repo that should never do it —
/// the first real verify run queued seven Next.js practices against a Tauri
/// desktop app exactly that way. The static `applicability` envelope cannot
/// catch it (it fails open and most harvested practices carry none), so the
/// verifier, which actually reads the repo, gets the final say.
pub fn adoption_state_after_verdict(prior: &str, holds: bool, applies: bool) -> &'static str {
    if !applies {
        return "na";
    }
    match (prior, holds) {
        (_, true) => "adopted",
        ("adopted", false) => "diverged",
        // `na` is a stack judgement, not a code judgement — a verdict on a
        // practice that cannot apply here does not resurrect the cell.
        ("na", false) => "na",
        (_, false) => "to_process",
    }
}

fn row_to_adoption(row: &Row) -> rusqlite::Result<WorkspacePracticeAdoption> {
    Ok(WorkspacePracticeAdoption {
        practice_id: row.get("practice_id")?,
        project_id: row.get("project_id")?,
        state: row.get("state")?,
        fleet_key: row.get("fleet_key")?,
        note: row.get("note")?,
        last_verified_at: row.get("last_verified_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_adoption(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<WorkspacePracticeAdoption>, AppError> {
    timed_query!(
        "workspace_practice_adoption",
        "dev_workspaces::list_adoption",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT a.* FROM workspace_practice_adoption a
             JOIN workspace_knowledge k ON k.id = a.practice_id
             WHERE k.workspace_id = ?1
             ORDER BY a.updated_at DESC",
            )?;
            let rows = stmt.query_map(params![workspace_id], row_to_adoption)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn set_adoption(
    pool: &DbPool,
    practice_id: &str,
    project_id: &str,
    state: &str,
    note: Option<&str>,
    fleet_key: Option<&str>,
) -> Result<WorkspacePracticeAdoption, AppError> {
    validate_one_of(state, &ADOPTION_STATES, "state")?;
    get_knowledge_by_id(pool, practice_id)?;
    timed_query!(
        "workspace_practice_adoption",
        "dev_workspaces::set_adoption",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO workspace_practice_adoption
                 (practice_id, project_id, state, note, fleet_key, last_verified_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?3 = 'adopted' THEN ?6 ELSE NULL END, ?6)
             ON CONFLICT(practice_id, project_id) DO UPDATE SET
                 state = excluded.state,
                 note = COALESCE(excluded.note, note),
                 fleet_key = COALESCE(excluded.fleet_key, fleet_key),
                 last_verified_at = CASE WHEN excluded.state = 'adopted'
                                         THEN excluded.updated_at
                                         ELSE last_verified_at END,
                 updated_at = excluded.updated_at",
                params![practice_id, project_id, state, note, fleet_key, now],
            )?;
            conn.query_row(
            "SELECT * FROM workspace_practice_adoption WHERE practice_id = ?1 AND project_id = ?2",
            params![practice_id, project_id],
            row_to_adoption,
        )
        .map_err(AppError::Database)
        }
    )
}

// ============================================================================
// Materialization — adopted practice → Backlog ideas (plan 1C)
// ============================================================================
