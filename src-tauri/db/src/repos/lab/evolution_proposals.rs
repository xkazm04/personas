//! Repository for `evolution_promotion_proposals` — the human-gated promotion
//! queue produced by Darwin Mode evolution cycles.
//!
//! Mirrors the `memory_review_proposal` pattern (immutable evidence + explicit
//! apply-or-discard): a cycle whose challenger beats the incumbent by the
//! policy threshold FILES a row here and stops. The apply transition lives in
//! `commands::execution::evolution` because it touches the live persona row
//! transactionally (CAS on `base_updated_at` + `persona_change_log`). There is
//! deliberately NO code path that resolves a proposal without a human command.

use rusqlite::params;

use crate::models::{CreateEvolutionProposalInput, EvolutionPromotionProposal};
use crate::DbPool;
use personas_core::error::AppError;

row_mapper!(row_to_proposal -> EvolutionPromotionProposal {
    id, cycle_id, persona_id, status,
    winner_genome_json, new_prompt,
    incumbent_score, winner_score, improvement, threshold,
    fitness_source, evidence_json, base_updated_at,
    decision_note, created_at, decided_at,
});

/// File a new pending proposal. Only one PENDING proposal per persona is kept:
/// a newer cycle's proposal supersedes (rejects) any older pending one so the
/// review queue never accumulates stale head-to-heads against a moved target.
pub fn create(
    pool: &DbPool,
    input: &CreateEvolutionProposalInput,
) -> Result<EvolutionPromotionProposal, AppError> {
    timed_query!(
        "evolution_promotion_proposals",
        "evolution_promotion_proposals::create",
        {
            let id = format!("evoprop_{}", uuid::Uuid::new_v4().simple());
            let now = chrono::Utc::now().to_rfc3339();
            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;

            // Supersede any still-pending proposal for the same persona.
            tx.execute(
                "UPDATE evolution_promotion_proposals
                    SET status = 'rejected',
                        decision_note = 'superseded by a newer evolution cycle',
                        decided_at = ?1
                  WHERE persona_id = ?2 AND status = 'pending'",
                params![now, input.persona_id],
            )?;

            tx.execute(
                "INSERT INTO evolution_promotion_proposals
                    (id, cycle_id, persona_id, status, winner_genome_json, new_prompt,
                     incumbent_score, winner_score, improvement, threshold,
                     fitness_source, evidence_json, base_updated_at, created_at)
                 VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8, ?9, 'measured', ?10, ?11, ?12)",
                params![
                    id,
                    input.cycle_id,
                    input.persona_id,
                    input.winner_genome_json,
                    input.new_prompt,
                    input.incumbent_score,
                    input.winner_score,
                    input.improvement,
                    input.threshold,
                    input.evidence_json,
                    input.base_updated_at,
                    now,
                ],
            )?;
            tx.commit().map_err(AppError::Database)?;
            get_by_id(pool, &id)
        }
    )
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<EvolutionPromotionProposal, AppError> {
    timed_query!(
        "evolution_promotion_proposals",
        "evolution_promotion_proposals::get_by_id",
        {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT * FROM evolution_promotion_proposals WHERE id = ?1",
                params![id],
                row_to_proposal,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("EvolutionPromotionProposal {id}"))
                }
                other => AppError::Database(other),
            })
        }
    )
}

/// Newest-first proposals, optionally filtered by persona and/or status.
/// `limit` clamped to `[1, 200]`.
pub fn list(
    pool: &DbPool,
    persona_id: Option<&str>,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<EvolutionPromotionProposal>, AppError> {
    timed_query!(
        "evolution_promotion_proposals",
        "evolution_promotion_proposals::list",
        {
            let bounded = limit.clamp(1, 200);
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM evolution_promotion_proposals
                  WHERE (?1 IS NULL OR persona_id = ?1)
                    AND (?2 IS NULL OR status = ?2)
                  ORDER BY created_at DESC
                  LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![persona_id, status, bounded], row_to_proposal)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Transition a PENDING proposal to `approved` or `rejected`. Fails closed if
/// the proposal is missing or already decided (no re-decisions, no downgrades).
pub fn resolve(
    pool: &DbPool,
    id: &str,
    approved: bool,
    note: Option<&str>,
) -> Result<EvolutionPromotionProposal, AppError> {
    timed_query!(
        "evolution_promotion_proposals",
        "evolution_promotion_proposals::resolve",
        {
            let status = if approved { "approved" } else { "rejected" };
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            let rows = conn.execute(
                "UPDATE evolution_promotion_proposals
                    SET status = ?1, decision_note = ?2, decided_at = ?3
                  WHERE id = ?4 AND status = 'pending'",
                params![status, note, now, id],
            )?;
            if rows == 0 {
                return Err(AppError::Validation(format!(
                    "Proposal {id} is not pending (missing or already decided)"
                )));
            }
            get_by_id(pool, id)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(persona: &str) -> CreateEvolutionProposalInput {
        CreateEvolutionProposalInput {
            cycle_id: "cycle-1".into(),
            persona_id: persona.into(),
            winner_genome_json: "{}".into(),
            new_prompt: "improved prompt".into(),
            incumbent_score: 0.60,
            winner_score: 0.75,
            improvement: 0.15,
            threshold: 0.05,
            evidence_json: Some(r#"{"replays":5}"#.into()),
            base_updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn create_files_pending_and_resolve_is_terminal() {
        let pool = crate::init_test_db().unwrap();
        let p = create(&pool, &input("p1")).unwrap();
        assert_eq!(p.status, "pending");
        assert_eq!(p.fitness_source, "measured");

        let resolved = resolve(&pool, &p.id, true, Some("looks good")).unwrap();
        assert_eq!(resolved.status, "approved");
        assert!(resolved.decided_at.is_some());

        // A decided proposal can never be re-decided.
        let err = resolve(&pool, &p.id, false, None);
        assert!(err.is_err(), "re-deciding an approved proposal must fail");
    }

    #[test]
    fn newer_proposal_supersedes_pending_one() {
        let pool = crate::init_test_db().unwrap();
        let old = create(&pool, &input("p1")).unwrap();
        let new = create(&pool, &input("p1")).unwrap();

        let old_now = get_by_id(&pool, &old.id).unwrap();
        assert_eq!(
            old_now.status, "rejected",
            "older pending proposal must be superseded"
        );
        assert_eq!(get_by_id(&pool, &new.id).unwrap().status, "pending");

        // Other personas' pending proposals are untouched.
        let other = create(&pool, &input("p2")).unwrap();
        let _ = create(&pool, &input("p1")).unwrap();
        assert_eq!(get_by_id(&pool, &other.id).unwrap().status, "pending");
    }

    #[test]
    fn list_filters_by_persona_and_status() {
        let pool = crate::init_test_db().unwrap();
        let a = create(&pool, &input("p1")).unwrap();
        let _b = create(&pool, &input("p2")).unwrap();
        resolve(&pool, &a.id, false, None).unwrap();

        assert_eq!(list(&pool, Some("p1"), None, 50).unwrap().len(), 1);
        assert_eq!(
            list(&pool, Some("p1"), Some("rejected"), 50).unwrap().len(),
            1
        );
        assert_eq!(
            list(&pool, Some("p1"), Some("pending"), 50).unwrap().len(),
            0
        );
        assert_eq!(list(&pool, None, None, 50).unwrap().len(), 2);
    }
}
