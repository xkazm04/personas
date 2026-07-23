//! Memory dispute claims (Brainiac-adoption P3 — docs/plans/brainiac-adoption-
//! skills-memory-docs.md).
//!
//! Brainiac's `memory_feedback`, localized: anyone who was served a memory can
//! assert `helpful`, `wrong` or `outdated` against it. A NEGATIVE claim is a
//! claim against the corpus — it stays OPEN until a human answers
//! `reverified` / `deprecated` / `dismissed`. Open negatives:
//!   • sink the memory in recall via the denormalized
//!     `persona_memories.open_claim_count` (this module is its ONLY writer —
//!     claim filing and resolution update it in the same transaction);
//!   • surface as `memory_disputed` findings in the triage spine.
//! Resolution is memory-level (one human decision answers every open claim on
//! the row, mirroring Brainiac's flagged-queue), and `deprecated` archives the
//! memory — the sanctioned outcome, never automatic.

use rusqlite::params;
use serde::Serialize;

use crate::db::DbPool;
use crate::error::AppError;

pub const CLAIM_VERDICTS: [&str; 3] = ["helpful", "wrong", "outdated"];
pub const CLAIM_RESOLUTIONS: [&str; 3] = ["reverified", "deprecated", "dismissed"];

#[derive(Debug, Clone, Serialize)]
pub struct MemoryClaim {
    pub id: String,
    pub memory_id: String,
    pub verdict: String,
    pub note: Option<String>,
    pub source: String,
    pub created_at: String,
    pub resolution: Option<String>,
    pub resolution_note: Option<String>,
    pub resolved_at: Option<String>,
}

/// One disputed memory (open negatives > 0), mapped onto every dev project
/// whose team the authoring persona serves — the findings sweep's sensor row.
#[derive(Debug, Clone, Serialize)]
pub struct DisputedMemoryRow {
    pub project_id: String,
    pub memory_id: String,
    pub memory_title: String,
    pub persona_id: String,
    pub persona_name: String,
    pub open_claims: i64,
    pub latest_verdict: Option<String>,
    pub latest_note: Option<String>,
    pub last_claim_at: Option<String>,
}

fn row_to_claim(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryClaim> {
    Ok(MemoryClaim {
        id: row.get(0)?,
        memory_id: row.get(1)?,
        verdict: row.get(2)?,
        note: row.get(3)?,
        source: row.get(4)?,
        created_at: row.get(5)?,
        resolution: row.get(6)?,
        resolution_note: row.get(7)?,
        resolved_at: row.get(8)?,
    })
}

const CLAIM_COLS: &str =
    "id, memory_id, verdict, note, source, created_at, resolution, resolution_note, resolved_at";

/// File a claim. Negative verdicts bump the memory's open counter in the same
/// transaction; `helpful` asserts nothing to fix and never opens.
pub fn file_claim(
    pool: &DbPool,
    memory_id: &str,
    verdict: &str,
    note: Option<&str>,
    source: &str,
) -> Result<MemoryClaim, AppError> {
    if !CLAIM_VERDICTS.contains(&verdict) {
        return Err(AppError::Validation(format!("invalid claim verdict: {verdict}")));
    }
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    // FK enforcement is belt-and-suspenders here — a claim on a vanished
    // memory must fail loudly, not dangle.
    let exists: bool = tx
        .query_row(
            "SELECT 1 FROM persona_memories WHERE id = ?1",
            params![memory_id],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !exists {
        return Err(AppError::NotFound(format!("memory not found: {memory_id}")));
    }
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO memory_claims (id, memory_id, verdict, note, source) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, memory_id, verdict, note, source],
    )?;
    if verdict != "helpful" {
        tx.execute(
            "UPDATE persona_memories
             SET open_claim_count = open_claim_count + 1, updated_at = datetime('now')
             WHERE id = ?1",
            params![memory_id],
        )?;
    }
    let claim = tx.query_row(
        &format!("SELECT {CLAIM_COLS} FROM memory_claims WHERE id = ?1"),
        params![id],
        row_to_claim,
    )?;
    tx.commit()?;
    Ok(claim)
}

/// Answer EVERY open negative claim on a memory with one decision (Brainiac's
/// per-memory flagged-queue semantics). Resets the open counter; `deprecated`
/// additionally archives the memory — the sanctioned human-initiated retire.
/// Returns the number of claims resolved (0 = nothing was open).
pub fn resolve_memory_claims(
    pool: &DbPool,
    memory_id: &str,
    resolution: &str,
    note: Option<&str>,
) -> Result<i64, AppError> {
    if !CLAIM_RESOLUTIONS.contains(&resolution) {
        return Err(AppError::Validation(format!("invalid claim resolution: {resolution}")));
    }
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    let resolved = tx.execute(
        "UPDATE memory_claims
         SET resolution = ?2, resolution_note = ?3, resolved_at = datetime('now')
         WHERE memory_id = ?1 AND resolution IS NULL AND verdict != 'helpful'",
        params![memory_id, resolution, note],
    )? as i64;
    tx.execute(
        "UPDATE persona_memories
         SET open_claim_count = 0, updated_at = datetime('now')
         WHERE id = ?1",
        params![memory_id],
    )?;
    if resolution == "deprecated" {
        tx.execute(
            "UPDATE persona_memories
             SET tier = 'archive', updated_at = datetime('now')
             WHERE id = ?1",
            params![memory_id],
        )?;
    }
    tx.commit()?;
    Ok(resolved)
}

/// Every claim on a memory, newest first — the detail modal's dispute history.
pub fn list_claims(pool: &DbPool, memory_id: &str) -> Result<Vec<MemoryClaim>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {CLAIM_COLS} FROM memory_claims WHERE memory_id = ?1 ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map(params![memory_id], row_to_claim)?;
    Ok(rows.flatten().collect())
}

/// Disputed memories (open negatives > 0) projected onto dev projects: a
/// memory reaches a project when its authoring persona serves the project's
/// team (roster = persona_team_members ∪ personas.home_team_id ∪ the memory's
/// own home_team_id anchor). The `memory_disputed` findings sensor.
pub fn disputed_overview(pool: &DbPool) -> Result<Vec<DisputedMemoryRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare_cached(
        "SELECT dp.id, m.id, m.title, m.persona_id, p.name, m.open_claim_count,
                (SELECT c.verdict FROM memory_claims c
                  WHERE c.memory_id = m.id AND c.resolution IS NULL AND c.verdict != 'helpful'
                  ORDER BY c.created_at DESC LIMIT 1),
                (SELECT c.note FROM memory_claims c
                  WHERE c.memory_id = m.id AND c.resolution IS NULL AND c.verdict != 'helpful'
                  ORDER BY c.created_at DESC LIMIT 1),
                (SELECT MAX(c.created_at) FROM memory_claims c WHERE c.memory_id = m.id)
         FROM persona_memories m
         JOIN personas p ON p.id = m.persona_id
         JOIN dev_projects dp ON dp.team_id IS NOT NULL AND (
              dp.team_id = m.home_team_id
           OR dp.team_id = p.home_team_id
           OR dp.team_id IN (SELECT ptm.team_id FROM persona_team_members ptm
                              WHERE ptm.persona_id = m.persona_id)
         )
         WHERE m.open_claim_count > 0
         ORDER BY m.open_claim_count DESC, m.updated_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DisputedMemoryRow {
            project_id: r.get(0)?,
            memory_id: r.get(1)?,
            memory_title: r.get(2)?,
            persona_id: r.get(3)?,
            persona_name: r.get(4)?,
            open_claims: r.get(5)?,
            latest_verdict: r.get(6)?,
            latest_note: r.get(7)?,
            last_claim_at: r.get(8)?,
        })
    })?;
    Ok(rows.flatten().collect())
}
