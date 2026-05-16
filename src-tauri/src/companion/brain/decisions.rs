//! Design decisions — persisted rows mirroring `show_decision_log`
//! chat-card entries. Captured automatically by the dispatcher when
//! Athena emits the card, so the audit trail survives session reloads
//! and can be retrieved later (cross-conversation explainability).
//!
//! Storage: `companion_design_decision` in the user db. One row per
//! `{label, choice, rationale}` entry in a decision-log card.
//!
//! Read paths: `list_recent` (newest-first, all decisions) and
//! `list_by_context` (decisions tagged with a specific persona id /
//! build session id / intent string).

use chrono::Utc;
use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;

use crate::db::UserDbPool;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDecision {
    pub id: String,
    pub session_id: String,
    pub persona_context: Option<String>,
    pub label: String,
    pub choice: String,
    pub rationale: String,
    pub decision_timestamp: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct DecisionInput<'a> {
    pub label: &'a str,
    pub choice: &'a str,
    pub rationale: &'a str,
    pub decision_timestamp: Option<&'a str>,
}

/// Save a batch of decision entries from a single `show_decision_log`
/// emit. Returns the generated ids in input order so the caller (or
/// emitting op handler) can correlate back. Best-effort per row: a
/// single failed insert logs a warning but doesn't abort the rest of
/// the batch — chat shouldn't fail because the audit trail couldn't
/// write.
pub fn save_batch(
    pool: &UserDbPool,
    session_id: &str,
    persona_context: Option<&str>,
    decisions: &[DecisionInput<'_>],
) -> Result<Vec<String>, AppError> {
    if decisions.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let now = Utc::now().to_rfc3339();
    let mut ids = Vec::with_capacity(decisions.len());
    for d in decisions {
        let id = format!(
            "dec_{}",
            Uuid::new_v4().simple().to_string().chars().take(10).collect::<String>()
        );
        let result = conn.execute(
            "INSERT INTO companion_design_decision
             (id, session_id, persona_context, label, choice, rationale, decision_timestamp, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                session_id,
                persona_context,
                d.label,
                d.choice,
                d.rationale,
                d.decision_timestamp,
                now
            ],
        );
        match result {
            Ok(_) => ids.push(id),
            Err(e) => {
                tracing::warn!(error = %e, label = %d.label, "design decision insert failed; skipping row");
            }
        }
    }
    Ok(ids)
}

/// Read the most recent N decisions across all sessions. Used by the
/// frontend to show "everything Athena's ever decided" in a retrospective
/// list view.
pub fn list_recent(pool: &UserDbPool, limit: u32) -> Result<Vec<DesignDecision>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, session_id, persona_context, label, choice, rationale,
                decision_timestamp, created_at
         FROM companion_design_decision
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Read the most recent N decisions tagged with a specific persona
/// context (persona id, build session id, or free-form intent string).
/// Used when the user asks "why did we pick X for persona Y?"
pub fn list_by_context(
    pool: &UserDbPool,
    persona_context: &str,
    limit: u32,
) -> Result<Vec<DesignDecision>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, session_id, persona_context, label, choice, rationale,
                decision_timestamp, created_at
         FROM companion_design_decision
         WHERE persona_context = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![persona_context, limit], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DesignDecision> {
    Ok(DesignDecision {
        id: row.get(0)?,
        session_id: row.get(1)?,
        persona_context: row.get(2)?,
        label: row.get(3)?,
        choice: row.get(4)?,
        rationale: row.get(5)?,
        decision_timestamp: row.get(6)?,
        created_at: row.get(7)?,
    })
}
