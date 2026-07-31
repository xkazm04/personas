//! Self-Wiring Fabric v1 — repository for mined automation suggestions.
//!
//! The table (`automation_suggestions`, migration id `automation_suggestions`)
//! is written by the pattern miner (`engine::pattern_miner`) and read by the
//! Studio patchbay ghost-cable surface. Status semantics:
//!
//! * `proposed`  — live ghost cable; the miner keeps its evidence fresh and
//!                 DELETES it when the pattern decays below threshold.
//! * `accepted`  — user wired it; `committed_trigger_id` is the mined-route
//!                 tag the miner uses to exclude the trigger's own traffic
//!                 from future evidence (no self-feeding loops).
//! * `rejected`  — user dismissed; the row is KEPT so the miner never
//!                 re-proposes the same (event_type, persona_id) pair.
//!
//! This module also owns the two read-side mining queries (events + manual
//! executions) so the SQL shape lives next to the table it feeds.

use rusqlite::params;

use crate::models::{
    AutomationSuggestion, AutomationSuggestionEvidence, AutomationSuggestionStatus,
};
use crate::DbPool;
use personas_core::error::AppError;

// ---------------------------------------------------------------------------
// Mining input rows (read-side)
// ---------------------------------------------------------------------------

/// A `persona_events` row projected down to what the co-occurrence miner
/// needs. Plain data — the pure mining fn lives in the app crate.
#[derive(Debug, Clone)]
pub struct MinedEvent {
    pub id: String,
    pub event_type: String,
    /// `source_id` of the publisher — a trigger id for trigger-published
    /// events. The miner drops events sourced from mined-route triggers.
    pub source_id: Option<String>,
    pub created_at: String,
}

/// A `persona_executions` row projected for mining. Only rows with
/// `trigger_id IS NULL` (manual runs) are returned by the query, but the
/// field is kept so the pure miner can double-enforce the exclusion.
#[derive(Debug, Clone)]
pub struct MinedExecution {
    pub id: String,
    pub persona_id: String,
    pub trigger_id: Option<String>,
    pub created_at: String,
}

/// Events eligible as co-occurrence antecedents: everything in the lookback
/// except dead-letter/discarded rows (dead-letter mining is a deferred,
/// separate lens). Ordered ascending so the miner's window scan is a single
/// forward pass; capped to bound per-tick memory.
pub fn mining_events(pool: &DbPool, since: &str, cap: i64) -> Result<Vec<MinedEvent>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, event_type, source_id, created_at
           FROM persona_events
          WHERE created_at >= ?1
            AND status NOT IN ('dead_letter', 'discarded')
          ORDER BY created_at ASC
          LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![since, cap], |row| {
        Ok(MinedEvent {
            id: row.get(0)?,
            event_type: row.get(1)?,
            source_id: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// Manual executions in the lookback: `trigger_id IS NULL` is the manual-run
/// signal (trigger-fired, chain and scheduled runs all carry a trigger id).
/// Ordered ascending for the forward window scan; capped.
pub fn mining_manual_executions(
    pool: &DbPool,
    since: &str,
    cap: i64,
) -> Result<Vec<MinedExecution>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, persona_id, trigger_id, created_at
           FROM persona_executions
          WHERE created_at >= ?1
            AND trigger_id IS NULL
          ORDER BY created_at ASC
          LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![since, cap], |row| {
        Ok(MinedExecution {
            id: row.get(0)?,
            persona_id: row.get(1)?,
            trigger_id: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

// ---------------------------------------------------------------------------
// Suggestion rows
// ---------------------------------------------------------------------------

fn row_to_suggestion(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationSuggestion> {
    let status_str: String = row.get(3)?;
    let evidence_json: String = row.get(9)?;
    let evidence: Vec<AutomationSuggestionEvidence> =
        serde_json::from_str(&evidence_json).unwrap_or_default();
    Ok(AutomationSuggestion {
        id: row.get(0)?,
        event_type: row.get(1)?,
        persona_id: row.get(2)?,
        status: AutomationSuggestionStatus::from_db(&status_str),
        occurrence_count: row.get::<_, i64>(4)?.max(0) as u32,
        manual_run_count: row.get::<_, i64>(5)?.max(0) as u32,
        support: row.get::<_, f64>(6)? as f32,
        window_seconds: row.get::<_, i64>(7)?.max(0) as u32,
        lookback_days: row.get::<_, i64>(8)?.max(0) as u32,
        evidence,
        committed_trigger_id: row.get(10)?,
        first_seen_at: row.get(11)?,
        last_seen_at: row.get(12)?,
        decided_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

const SELECT_COLS: &str = "id, event_type, persona_id, status, occurrence_count, \
     manual_run_count, support, window_seconds, lookback_days, evidence_json, \
     committed_trigger_id, first_seen_at, last_seen_at, decided_at, created_at, updated_at";

/// All suggestions, strongest signal first (proposed before decided, then by
/// support). The Studio feed filters client-side; the table stays small by
/// construction (unique per (event_type, persona_id)).
pub fn list(pool: &DbPool) -> Result<Vec<AutomationSuggestion>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM automation_suggestions
          ORDER BY CASE status WHEN 'proposed' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
                   support DESC, occurrence_count DESC",
    ))?;
    let rows = stmt.query_map([], |row| row_to_suggestion(row))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<AutomationSuggestion, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM automation_suggestions WHERE id = ?1",
    ))?;
    stmt.query_row([id], |row| row_to_suggestion(row))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("automation suggestion {id} not found"))
            }
            other => AppError::from(other),
        })
}

/// Miner upsert: insert a fresh `proposed` row or refresh an existing
/// PROPOSED row's evidence. Decided rows (accepted/rejected) are never
/// touched — a rejection is a do-not-renag memory, an acceptance is history.
#[allow(clippy::too_many_arguments)]
pub fn upsert_proposed(
    pool: &DbPool,
    event_type: &str,
    persona_id: &str,
    occurrence_count: u32,
    manual_run_count: u32,
    support: f32,
    window_seconds: u32,
    lookback_days: u32,
    evidence: &[AutomationSuggestionEvidence],
    first_seen_at: &str,
    last_seen_at: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let evidence_json = serde_json::to_string(evidence).unwrap_or_else(|_| "[]".into());
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO automation_suggestions (
            id, event_type, persona_id, status, occurrence_count, manual_run_count,
            support, window_seconds, lookback_days, evidence_json,
            first_seen_at, last_seen_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, 'proposed', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                   datetime('now'), datetime('now'))
         ON CONFLICT(event_type, persona_id) DO UPDATE SET
            occurrence_count = excluded.occurrence_count,
            manual_run_count = excluded.manual_run_count,
            support          = excluded.support,
            window_seconds   = excluded.window_seconds,
            lookback_days    = excluded.lookback_days,
            evidence_json    = excluded.evidence_json,
            first_seen_at    = excluded.first_seen_at,
            last_seen_at     = excluded.last_seen_at,
            updated_at       = datetime('now')
         WHERE automation_suggestions.status = 'proposed'",
        params![
            id,
            event_type,
            persona_id,
            occurrence_count as i64,
            manual_run_count as i64,
            support as f64,
            window_seconds as i64,
            lookback_days as i64,
            evidence_json,
            first_seen_at,
            last_seen_at,
        ],
    )?;
    Ok(())
}

/// Delete PROPOSED rows whose (event_type, persona_id) is no longer in the
/// miner's current above-threshold candidate set — evidence decayed out of
/// the lookback, so keeping the ghost cable would be a stretched inference.
pub fn prune_stale_proposed(
    pool: &DbPool,
    live_pairs: &[(String, String)],
) -> Result<u32, AppError> {
    let conn = pool.get()?;
    // Small table (unique pairs), so read-then-delete is fine and avoids
    // dynamic-SQL IN-list construction.
    let mut stmt = conn.prepare(
        "SELECT id, event_type, persona_id FROM automation_suggestions WHERE status = 'proposed'",
    )?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut deleted = 0u32;
    for (id, event_type, persona_id) in rows {
        let still_live = live_pairs
            .iter()
            .any(|(e, p)| *e == event_type && *p == persona_id);
        if !still_live {
            deleted += conn.execute(
                "DELETE FROM automation_suggestions WHERE id = ?1 AND status = 'proposed'",
                [&id],
            )? as u32;
        }
    }
    Ok(deleted)
}

/// Accept: stamp the created trigger id (the mined-route tag) + decided_at.
/// Only a `proposed` row can be accepted — returns NotFound otherwise so the
/// caller surfaces an honest error instead of silently double-accepting.
pub fn mark_accepted(pool: &DbPool, id: &str, trigger_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let n = conn.execute(
        "UPDATE automation_suggestions
            SET status = 'accepted', committed_trigger_id = ?2,
                decided_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?1 AND status = 'proposed'",
        params![id, trigger_id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!(
            "automation suggestion {id} is not in 'proposed' state"
        )));
    }
    Ok(())
}

/// Reject: log the decision and keep the row as a do-not-renag memory.
pub fn mark_rejected(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let n = conn.execute(
        "UPDATE automation_suggestions
            SET status = 'rejected', decided_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?1 AND status = 'proposed'",
        [id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!(
            "automation suggestion {id} is not in 'proposed' state"
        )));
    }
    Ok(())
}

/// Trigger ids of every accepted (mined-route) suggestion — the exclusion set
/// the miner applies to both sides of the evidence join.
pub fn committed_trigger_ids(pool: &DbPool) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT committed_trigger_id FROM automation_suggestions
          WHERE status = 'accepted' AND committed_trigger_id IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// (event_type, persona_id) pairs the miner must NOT re-propose: everything
/// already decided (accepted or rejected).
pub fn decided_pairs(pool: &DbPool) -> Result<Vec<(String, String)>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT event_type, persona_id FROM automation_suggestions
          WHERE status IN ('accepted', 'rejected')",
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}
