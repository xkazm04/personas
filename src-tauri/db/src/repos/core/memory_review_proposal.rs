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

use crate::models::CreatePersonaResponsibilityInput;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

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
    /// `delete` | `keep` | `update_importance` — curation review;
    /// `synthesize` | `archive` — reflection pass (Memory Engine v2).
    pub action: String,
    /// Set when action is `update_importance` (curation) or `synthesize`
    /// (importance of the new insight). Range 1..=5.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub new_importance: Option<i32>,
    /// `synthesize` only: title of the new insight memory.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub new_title: Option<String>,
    /// `synthesize` only: content of the new insight memory.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub new_content: Option<String>,
    /// `synthesize` only: category of the new insight memory.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub new_category: Option<String>,
    /// `synthesize` only: ids of the source memories the insight is derived
    /// from. On apply they are archived (never deleted; `core` is skipped)
    /// and recorded as the insight's `derived_from` provenance.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_ids: Option<Vec<String>>,
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
    /// Set when this proposal came from a TEAM reflection pass — the
    /// consolidation spans memories from multiple members and applied
    /// insights become team-shared (`home_team_id`) memories. `None`
    /// for persona-scoped curation/reflection proposals.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub team_id: Option<String>,
    /// Proposal family: `memory_curation` (default, the original review
    /// pipeline) — the living-agent consolidation adds further kinds.
    #[serde(default = "default_proposal_kind")]
    pub kind: String,
    /// `responsibility_draft` only: the charter the agent proposes minting.
    /// `entries` is empty for this kind (the payload is an object, not a
    /// `ProposalEntry` array), so without this field the inbox has nothing
    /// to render. Parsed leniently — a payload that no longer deserializes
    /// leaves `None` and the row still lists with its `summary`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub draft: Option<CreatePersonaResponsibilityInput>,
}

fn default_proposal_kind() -> String {
    "memory_curation".to_string()
}

/// Input to `create` — the proposal data without timestamps/status,
/// which the repo fills in.
pub struct CreateProposalInput<'a> {
    pub persona_id: Option<&'a str>,
    pub threshold: i32,
    pub instructions: Option<&'a str>,
    pub entries: &'a [ProposalEntry],
    pub summary: Option<&'a str>,
    /// Team reflection only; `None` everywhere else.
    pub team_id: Option<&'a str>,
    /// Proposal family; `None` = 'memory_curation' (the column default).
    pub kind: Option<&'a str>,
}

pub fn create(pool: &DbPool, input: CreateProposalInput<'_>) -> Result<String, AppError> {
    let id = format!("memprop_{}", Uuid::new_v4().simple());
    let entries_json = serde_json::to_string(input.entries)
        .map_err(|e| AppError::Internal(format!("serialize proposal entries: {e}")))?;
    let reviewed_count = input.entries.len() as i32;
    let proposed_changes = input.entries.iter().filter(|e| e.action != "keep").count() as i32;

    let conn = pool.conn("memory_review_proposal::create")?;
    conn.execute(
        "INSERT INTO persona_memory_review_proposal
            (id, persona_id, threshold, instructions, proposal_json,
             summary, reviewed_count, proposed_changes, status, created_at, team_id, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending_review',
                 datetime('now'), ?9, COALESCE(?10, 'memory_curation'))",
        params![
            id,
            input.persona_id,
            input.threshold,
            input.instructions,
            entries_json,
            input.summary,
            reviewed_count,
            proposed_changes,
            input.team_id,
            input.kind,
        ],
    )?;
    Ok(id)
}

/// Input to [`create_raw`] — living-agent proposal families whose
/// `proposal_json` is NOT a `ProposalEntry` array (today: `self_model_diff`,
/// whose payload is `{"diffs":[...],"rationale":"..."}`). `threshold` is a
/// curation concept and is stored as 0; `reviewed_count` mirrors
/// `proposed_changes` (each diff is one reviewable change).
pub struct CreateRawProposalInput<'a> {
    pub persona_id: &'a str,
    /// Must satisfy the column CHECK ('memory_curation' | 'self_model_diff').
    pub kind: &'a str,
    pub proposal_json: &'a str,
    pub summary: Option<&'a str>,
    pub proposed_changes: i32,
}

pub fn create_raw(pool: &DbPool, input: CreateRawProposalInput<'_>) -> Result<String, AppError> {
    timed_query!(
        "persona_memory_review_proposal",
        "memory_review_proposal::create_raw",
        {
            let id = format!("memprop_{}", Uuid::new_v4().simple());
            let conn = pool.conn("memory_review_proposal::create_raw")?;
            conn.execute(
                "INSERT INTO persona_memory_review_proposal
                    (id, persona_id, threshold, instructions, proposal_json,
                     summary, reviewed_count, proposed_changes, status, created_at, team_id, kind)
                 VALUES (?1, ?2, 0, NULL, ?3, ?4, ?5, ?5, 'pending_review',
                         datetime('now'), NULL, ?6)",
                params![
                    id,
                    input.persona_id,
                    input.proposal_json,
                    input.summary,
                    input.proposed_changes,
                    input.kind,
                ],
            )?;
            Ok(id)
        }
    )
}

/// The raw row for families whose payload is not a `ProposalEntry` array —
/// [`get`]'s `map_row` would silently parse such a payload to `[]` (its
/// `unwrap_or_default`), which is exactly right for LIST surfaces and exactly
/// wrong for the apply path, which needs the payload bytes.
#[derive(Debug, Clone)]
pub struct RawProposal {
    pub id: String,
    pub persona_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub proposal_json: String,
}

pub fn get_raw(pool: &DbPool, id: &str) -> Result<Option<RawProposal>, AppError> {
    timed_query!(
        "persona_memory_review_proposal",
        "memory_review_proposal::get_raw",
        {
            let conn = pool.conn("memory_review_proposal::get_raw")?;
            let row = conn
                .query_row(
                    "SELECT id, persona_id, kind, status, proposal_json
                     FROM persona_memory_review_proposal WHERE id = ?1",
                    params![id],
                    |r| {
                        Ok(RawProposal {
                            id: r.get("id")?,
                            persona_id: r.get("persona_id")?,
                            kind: r.get("kind")?,
                            status: r.get("status")?,
                            proposal_json: r.get("proposal_json")?,
                        })
                    },
                )
                .optional()?;
            Ok(row)
        }
    )
}

pub fn get(pool: &DbPool, id: &str) -> Result<Option<MemoryReviewProposal>, AppError> {
    let conn = pool.conn("memory_review_proposal::get")?;
    let row = conn
        .query_row(
            "SELECT id, persona_id, threshold, instructions, proposal_json,
                    summary, reviewed_count, proposed_changes, status,
                    created_at, decided_at, team_id, kind
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
    let conn = pool.conn("memory_review_proposal::list")?;
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
                created_at, decided_at, team_id, kind
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

/// Proposals of one `kind` still awaiting a decision for one persona — the
/// manifest view's `pending_proposals` badge.
pub fn count_pending_for_persona(
    pool: &DbPool,
    persona_id: &str,
    kind: &str,
) -> Result<i64, AppError> {
    let conn = pool.conn("memory_review_proposal::count_pending_for_persona")?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) AS n FROM persona_memory_review_proposal
         WHERE persona_id = ?1 AND kind = ?2 AND status = 'pending_review'",
        params![persona_id, kind],
        |r| r.get("n"),
    )?;
    Ok(n)
}

/// Proposals (any kind) a human DISCARDED since `since` (RFC-3339 / SQLite
/// datetime text, compared on `decided_at`) — the dashboard's rejected-drafts
/// signal: how often the agent's proposals are being thrown out.
pub fn count_discarded_since(
    pool: &DbPool,
    persona_id: &str,
    since: &str,
) -> Result<i64, AppError> {
    let conn = pool.conn("memory_review_proposal::count_discarded_since")?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) AS n FROM persona_memory_review_proposal
         WHERE persona_id = ?1 AND status = 'discarded'
           AND decided_at IS NOT NULL AND decided_at >= ?2",
        params![persona_id, since],
        |r| r.get("n"),
    )?;
    Ok(n)
}

/// Mark a proposal as `applied`. Caller is responsible for executing
/// the proposal's mutations against the live memory table — this
/// function only flips the status so the proposal can't be re-applied.
/// Returns true if the row transitioned (was `pending_review`).
pub fn mark_applied(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.conn("memory_review_proposal::mark_applied")?;
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
    let conn = pool.conn("memory_review_proposal::mark_discarded")?;
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
    let kind: String = row.get("kind")?;
    // The payload column carries a `ProposalEntry` array for the curation
    // kinds and a single object for `responsibility_draft`; decode the
    // object only for the kind that writes one.
    let draft: Option<CreatePersonaResponsibilityInput> = if kind == "responsibility_draft" {
        serde_json::from_str(&entries_json).ok()
    } else {
        None
    };
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
        team_id: row.get(11)?,
        // By name, not position — this column joined the projection late
        // (e16) and a named read cannot shift under a future ALTER.
        kind,
        draft,
    })
}
