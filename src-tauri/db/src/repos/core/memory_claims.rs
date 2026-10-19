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

use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

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
        id: row.get("id")?,
        memory_id: row.get("memory_id")?,
        verdict: row.get("verdict")?,
        note: row.get("note")?,
        source: row.get("source")?,
        created_at: row.get("created_at")?,
        resolution: row.get("resolution")?,
        resolution_note: row.get("resolution_note")?,
        resolved_at: row.get("resolved_at")?,
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
        return Err(AppError::Validation(format!(
            "invalid claim verdict: {verdict}"
        )));
    }
    let conn = pool.conn("memory_claims::file_claim")?;
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
        return Err(AppError::Validation(format!(
            "invalid claim resolution: {resolution}"
        )));
    }
    let conn = pool.conn("memory_claims::resolve_memory_claims")?;
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
    let conn = pool.conn("memory_claims::list_claims")?;
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {CLAIM_COLS} FROM memory_claims WHERE memory_id = ?1 ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map(params![memory_id], row_to_claim)?;
    Ok(rows.flatten().collect())
}

/// How many of one persona's memories carry at least one OPEN negative claim
/// — the Brain dashboard's `open_disputes` cell. Reads the denormalized
/// counter this module maintains, so it is one indexed scan.
pub fn count_disputed_for_persona(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    timed_query!(
        "persona_memories",
        "memory_claims::count_disputed_for_persona",
        {
            let conn = pool.conn("memory_claims::count_disputed_for_persona")?;
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) AS n FROM persona_memories
                 WHERE persona_id = ?1 AND open_claim_count > 0",
                params![persona_id],
                |r| r.get("n"),
            )?;
            Ok(n)
        }
    )
}

/// Disputed memories (open negatives > 0) projected onto dev projects: a
/// memory reaches a project when its authoring persona serves the project's
/// team (roster = persona_team_members ∪ personas.home_team_id ∪ the memory's
/// own home_team_id anchor). The `memory_disputed` findings sensor.
pub fn disputed_overview(pool: &DbPool) -> Result<Vec<DisputedMemoryRow>, AppError> {
    let conn = pool.conn("memory_claims::disputed_overview")?;
    let mut stmt = conn.prepare_cached(
        "SELECT dp.id AS project_id, m.id AS memory_id, m.title AS memory_title,
                m.persona_id AS persona_id, p.name AS persona_name,
                m.open_claim_count AS open_claims,
                (SELECT c.verdict FROM memory_claims c
                  WHERE c.memory_id = m.id AND c.resolution IS NULL AND c.verdict != 'helpful'
                  ORDER BY c.created_at DESC LIMIT 1) AS latest_verdict,
                (SELECT c.note FROM memory_claims c
                  WHERE c.memory_id = m.id AND c.resolution IS NULL AND c.verdict != 'helpful'
                  ORDER BY c.created_at DESC LIMIT 1) AS latest_note,
                (SELECT MAX(c.created_at) FROM memory_claims c WHERE c.memory_id = m.id)
                  AS last_claim_at
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
            project_id: r.get("project_id")?,
            memory_id: r.get("memory_id")?,
            memory_title: r.get("memory_title")?,
            persona_id: r.get("persona_id")?,
            persona_name: r.get("persona_name")?,
            open_claims: r.get("open_claims")?,
            latest_verdict: r.get("latest_verdict")?,
            latest_note: r.get("latest_note")?,
            last_claim_at: r.get("last_claim_at")?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// The claim projection and the disputed overview's aliased projection
    /// both map by name; an alias that drifted from its field would fail here
    /// instead of silently emptying the findings sensor.
    #[test]
    fn claim_and_overview_reads_map_every_column_by_name() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let conn = pool.get()?;
        conn.execute_batch(
            "INSERT INTO persona_teams (id, name, created_at, updated_at)
               VALUES ('mc_t', 'Team', datetime('now'), datetime('now'));
             INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
               VALUES ('mc_p', 'Echo', 'sp', datetime('now'), datetime('now'));
             INSERT INTO persona_memories (id, persona_id, title, content, home_team_id, created_at, updated_at)
               VALUES ('mc_m', 'mc_p', 'Fact', 'c', 'mc_t', datetime('now'), datetime('now'));
             INSERT INTO dev_projects (id, name, root_path, team_id)
               VALUES ('mc_dp', 'Proj', '/tmp/mc_dp', 'mc_t');",
        )?;
        drop(conn);

        let filed = file_claim(&pool, "mc_m", "wrong", Some("stale"), "test")?;
        let listed = list_claims(&pool, "mc_m")?;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, filed.id);
        assert_eq!(
            (
                listed[0].verdict.as_str(),
                listed[0].note.as_deref(),
                listed[0].source.as_str()
            ),
            ("wrong", Some("stale"), "test")
        );

        let overview = disputed_overview(&pool)?;
        assert_eq!(overview.len(), 1);
        let o = &overview[0];
        assert_eq!(
            (
                o.project_id.as_str(),
                o.memory_id.as_str(),
                o.memory_title.as_str()
            ),
            ("mc_dp", "mc_m", "Fact")
        );
        assert_eq!(
            (o.persona_id.as_str(), o.persona_name.as_str()),
            ("mc_p", "Echo")
        );
        assert_eq!(o.open_claims, 1);
        assert_eq!(
            (o.latest_verdict.as_deref(), o.latest_note.as_deref()),
            (Some("wrong"), Some("stale"))
        );
        assert!(o.last_claim_at.is_some());
        Ok(())
    }
}
