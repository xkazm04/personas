//! Self-Evolving Team v1 — the learning ledger.
//!
//! Two tables:
//! - `assignment_outcomes` — one structured learning record per TERMINAL
//!   assignment (`UNIQUE(assignment_id)`; the first terminal transition wins,
//!   so restarts / duplicate hooks are idempotent).
//! - `team_member_trust` — per-(team, persona) Brier-updated trust the
//!   matcher overlays on the persona's global `trust_score`. The updater
//!   itself (decay + floor) lives in `engine::team_assignment_learning`;
//!   this repo only persists.
//!
//! Also hosts the read-side of lesson retrieval (`list_team_lessons`) so the
//! teams-learning machinery doesn't have to widen the shared `team_memories`
//! repo surface: it queries the same table with a tag filter.

use rusqlite::{params, OptionalExtension, Row};

use crate::models::{AssignmentOutcome, TeamMemberTrust, TeamMemory};
use crate::DbPool;
use personas_core::error::AppError;

fn row_to_outcome(row: &Row) -> rusqlite::Result<AssignmentOutcome> {
    Ok(AssignmentOutcome {
        id: row.get("id")?,
        assignment_id: row.get("assignment_id")?,
        team_id: row.get("team_id")?,
        status: row.get("status")?,
        steps_total: row.get("steps_total")?,
        steps_done: row.get("steps_done")?,
        steps_failed: row.get("steps_failed")?,
        steps_skipped: row.get("steps_skipped")?,
        review_interventions: row.get("review_interventions")?,
        duration_secs: row.get("duration_secs")?,
        outcome_json: row.get("outcome_json")?,
        retro_deliberation_id: row.get("retro_deliberation_id")?,
        retro_skipped_reason: row.get("retro_skipped_reason")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_trust(row: &Row) -> rusqlite::Result<TeamMemberTrust> {
    Ok(TeamMemberTrust {
        team_id: row.get("team_id")?,
        persona_id: row.get("persona_id")?,
        trust: row.get("trust")?,
        samples: row.get("samples")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Fields the terminal hook computes for the outcome record. `id` and
/// `created_at` are generated at insert time.
pub struct RecordOutcomeInput<'a> {
    pub assignment_id: &'a str,
    pub team_id: &'a str,
    pub status: &'a str,
    pub steps_total: i32,
    pub steps_done: i32,
    pub steps_failed: i32,
    pub steps_skipped: i32,
    pub review_interventions: i32,
    pub duration_secs: Option<i64>,
    pub outcome_json: &'a str,
}

/// Insert the learning record for a terminal assignment. Returns `true` when
/// this call created the row, `false` when one already existed (the terminal
/// hook can fire more than once across restarts — only the first write learns).
pub fn record_outcome(pool: &DbPool, input: &RecordOutcomeInput) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let id = format!("aout-{}", uuid::Uuid::new_v4());
    let inserted = conn
        .execute(
            "INSERT OR IGNORE INTO assignment_outcomes
                (id, assignment_id, team_id, status, steps_total, steps_done,
                 steps_failed, steps_skipped, review_interventions, duration_secs,
                 outcome_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'))",
            params![
                id,
                input.assignment_id,
                input.team_id,
                input.status,
                input.steps_total,
                input.steps_done,
                input.steps_failed,
                input.steps_skipped,
                input.review_interventions,
                input.duration_secs,
                input.outcome_json,
            ],
        )
        .map_err(AppError::Database)?;
    Ok(inserted > 0)
}

pub fn get_by_assignment(
    pool: &DbPool,
    assignment_id: &str,
) -> Result<Option<AssignmentOutcome>, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM assignment_outcomes WHERE assignment_id = ?1",
        params![assignment_id],
        row_to_outcome,
    )
    .optional()
    .map_err(AppError::Database)
}

pub fn list_for_team(
    pool: &DbPool,
    team_id: &str,
    limit: i64,
) -> Result<Vec<AssignmentOutcome>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM assignment_outcomes WHERE team_id = ?1
         ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![team_id, limit.clamp(1, 200)], row_to_outcome)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Stamp the retrospective linkage (or the honest skip reason) onto an
/// existing outcome record.
pub fn set_retro(
    pool: &DbPool,
    assignment_id: &str,
    retro_deliberation_id: Option<&str>,
    retro_skipped_reason: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE assignment_outcomes
         SET retro_deliberation_id = ?2, retro_skipped_reason = ?3
         WHERE assignment_id = ?1",
        params![assignment_id, retro_deliberation_id, retro_skipped_reason],
    )
    .map_err(AppError::Database)?;
    Ok(())
}

/// Replace the evidence JSON (the terminal hook enriches it with per-step
/// trust deltas after the updater runs).
pub fn set_outcome_json(
    pool: &DbPool,
    assignment_id: &str,
    outcome_json: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE assignment_outcomes SET outcome_json = ?2 WHERE assignment_id = ?1",
        params![assignment_id, outcome_json],
    )
    .map_err(AppError::Database)?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Team-scoped trust
// ----------------------------------------------------------------------------

pub fn get_trust(
    pool: &DbPool,
    team_id: &str,
    persona_id: &str,
) -> Result<Option<TeamMemberTrust>, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM team_member_trust WHERE team_id = ?1 AND persona_id = ?2",
        params![team_id, persona_id],
        row_to_trust,
    )
    .optional()
    .map_err(AppError::Database)
}

pub fn list_trust_for_team(pool: &DbPool, team_id: &str) -> Result<Vec<TeamMemberTrust>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM team_member_trust WHERE team_id = ?1 ORDER BY trust DESC",
    )?;
    let rows = stmt.query_map(params![team_id], row_to_trust)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn upsert_trust(
    pool: &DbPool,
    team_id: &str,
    persona_id: &str,
    trust: f64,
    samples: i64,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO team_member_trust (team_id, persona_id, trust, samples, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(team_id, persona_id)
         DO UPDATE SET trust = excluded.trust, samples = excluded.samples,
                       updated_at = datetime('now')",
        params![team_id, persona_id, trust, samples],
    )
    .map_err(AppError::Database)?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Lesson retrieval (reads team_memories with a tag filter)
// ----------------------------------------------------------------------------

/// Team lessons for prompt injection / the learning panel: `team_memories`
/// rows whose tags include `lesson`, most important first. The retrospective
/// distiller writes these; QA bounce lessons (category `constraint`) keep
/// their own existing injection path and are NOT duplicated here.
pub fn list_team_lessons(
    pool: &DbPool,
    team_id: &str,
    limit: i64,
) -> Result<Vec<TeamMemory>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM team_memories
         WHERE team_id = ?1
           AND (',' || COALESCE(tags, '') || ',') LIKE '%,lesson,%'
         ORDER BY importance DESC, created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![team_id, limit.clamp(1, 50)], |row| {
        Ok(TeamMemory {
            id: row.get("id")?,
            team_id: row.get("team_id")?,
            run_id: row.get("run_id")?,
            member_id: row.get("member_id")?,
            persona_id: row.get("persona_id")?,
            title: row.get("title")?,
            content: row.get("content")?,
            category: row.get("category")?,
            importance: row.get("importance")?,
            tags: row.get("tags")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}
