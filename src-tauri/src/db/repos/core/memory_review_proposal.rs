//! Repository for `persona_memory_review_proposal` rows — the
//! review-and-discard candidate batch produced by
//! `commands::core::memories::review_memories_with_cli` when invoked
//! in proposal mode.
//!
//! Concept borrowed from Anthropic Managed Agents' dream pipeline
//! (immutable input + separate output store + explicit apply or
//! discard). Personas's primitive: a row that holds the structured
//! proposal until the user applies or discards it. Apply and discard
//! transitions live in `commands::core::memories` because they touch
//! the live `persona_memories` rows transactionally.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::DbPool;
use crate::error::AppError;

/// One memory's proposed disposition in a review batch. Matches the
/// shape produced by the LLM reviewer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProposalEntry {
    pub memory_id: String,
    pub title: String,
    pub score: i32,
    pub reason: String,
    /// `delete` | `keep` | `update_importance`
    pub action: String,
    /// Set when action is `update_importance`. Range 1..=5.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub new_importance: Option<i32>,
}

/// One row in `persona_memory_review_proposal`. Public type returned
/// to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReviewProposal {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub persona_id: Option<String>,
    pub threshold: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub instructions: Option<String>,
    pub entries: Vec<ProposalEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    pub reviewed_count: i32,
    pub proposed_changes: i32,
    /// `pending_review` | `applied` | `discarded`
    pub status: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub decided_at: Option<String>,
}

/// Input to `create` — the proposal data without timestamps/status,
/// which the repo fills in.
pub struct CreateProposalInput<'a> {
    pub persona_id: Option<&'a str>,
    pub threshold: i32,
    pub instructions: Option<&'a str>,
    pub entries: &'a [ProposalEntry],
    pub summary: Option<&'a str>,
}

pub fn create(pool: &DbPool, input: CreateProposalInput<'_>) -> Result<String, AppError> {
    let id = format!("memprop_{}", Uuid::new_v4().simple());
    let entries_json = serde_json::to_string(input.entries)
        .map_err(|e| AppError::Internal(format!("serialize proposal entries: {e}")))?;
    let reviewed_count = input.entries.len() as i32;
    let proposed_changes = input
        .entries
        .iter()
        .filter(|e| e.action != "keep")
        .count() as i32;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_memory_review_proposal
            (id, persona_id, threshold, instructions, proposal_json,
             summary, reviewed_count, proposed_changes, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending_review',
                 datetime('now'))",
        params![
            id,
            input.persona_id,
            input.threshold,
            input.instructions,
            entries_json,
            input.summary,
            reviewed_count,
            proposed_changes,
        ],
    )?;
    Ok(id)
}

pub fn get(pool: &DbPool, id: &str) -> Result<Option<MemoryReviewProposal>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, persona_id, threshold, instructions, proposal_json,
                    summary, reviewed_count, proposed_changes, status,
                    created_at, decided_at
             FROM persona_memory_review_proposal WHERE id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    Ok(row)
}

pub fn list(
    pool: &DbPool,
    persona_id: Option<&str>,
    only_pending: bool,
    limit: u32,
) -> Result<Vec<MemoryReviewProposal>, AppError> {
    let conn = pool.get()?;
    let mut clauses: Vec<&str> = Vec::new();
    if persona_id.is_some() {
        clauses.push("persona_id = ?1");
    }
    if only_pending {
        clauses.push("status = 'pending_review'");
    }
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let limit_idx = if persona_id.is_some() { "?2" } else { "?1" };
    let sql = format!(
        "SELECT id, persona_id, threshold, instructions, proposal_json,
                summary, reviewed_count, proposed_changes, status,
                created_at, decided_at
         FROM persona_memory_review_proposal
         {where_clause}
         ORDER BY created_at DESC
         LIMIT {limit_idx}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<MemoryReviewProposal> = if let Some(pid) = persona_id {
        stmt.query_map(params![pid, limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

/// Mark a proposal as `applied`. Caller is responsible for executing
/// the proposal's mutations against the live memory table — this
/// function only flips the status so the proposal can't be re-applied.
/// Returns true if the row transitioned (was `pending_review`).
pub fn mark_applied(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE persona_memory_review_proposal
         SET status = 'applied', decided_at = datetime('now')
         WHERE id = ?1 AND status = 'pending_review'",
        params![id],
    )?;
    Ok(updated > 0)
}

/// Mark a proposal as `discarded`. Idempotent: re-discarding a
/// `discarded` row returns false but does not error. Returns true if
/// the row transitioned from `pending_review`.
pub fn mark_discarded(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE persona_memory_review_proposal
         SET status = 'discarded', decided_at = datetime('now')
         WHERE id = ?1 AND status = 'pending_review'",
        params![id],
    )?;
    Ok(updated > 0)
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryReviewProposal> {
    let entries_json: String = row.get(4)?;
    let entries: Vec<ProposalEntry> = serde_json::from_str(&entries_json).unwrap_or_default();
    Ok(MemoryReviewProposal {
        id: row.get(0)?,
        persona_id: row.get(1)?,
        threshold: row.get(2)?,
        instructions: row.get(3)?,
        entries,
        summary: row.get(5)?,
        reviewed_count: row.get(6)?,
        proposed_changes: row.get(7)?,
        status: row.get(8)?,
        created_at: row.get(9)?,
        decided_at: row.get(10)?,
    })
}
