//! Repository for `policy_proposals` — the Self-Tuning Fabric's
//! review-each proposal ledger (mirrors the `memory_review_proposal`
//! shape: immutable evidence in, explicit apply or decline out).
//!
//! A row holds one proposed policy change (routing-rule diff or budget
//! ceiling), its quantified claim (inside the typed payload) and the
//! evidence-snapshot slice it was derived from, until the operator applies
//! or declines it. Apply-side mutations (writing the routing rule / the
//! ceiling setting) live in `commands::execution::policy_tuning` — this repo
//! only persists and transitions rows. Declines keep their reason on the row
//! as feedback; the generator treats pending AND declined rows as "already
//! answered" and will not re-propose the same change.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::policy_tuning::{BudgetCeilingChange, PolicyEvidenceSnapshot, RoutingRuleChange};
use crate::DbPool;
use personas_core::error::AppError;

/// One row in `policy_proposals`, hydrated for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolicyProposal {
    pub id: String,
    /// `routing_rule` | `budget_ceiling` (healing_strategy reserved).
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub category: Option<String>,
    /// Set when `kind == "routing_rule"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub routing: Option<RoutingRuleChange>,
    /// Set when `kind == "budget_ceiling"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub budget: Option<BudgetCeilingChange>,
    pub evidence_snapshot_id: String,
    /// The snapshot slice this proposal was derived from — the inspectable
    /// raw evidence behind the claim.
    pub evidence: PolicyEvidenceSnapshot,
    /// `pending` | `applied` | `declined`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub decline_reason: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub decided_at: Option<String>,
}

/// Typed payload for creation.
pub enum ProposalPayload<'a> {
    Routing(&'a RoutingRuleChange),
    Budget(&'a BudgetCeilingChange),
}

pub fn create(
    pool: &DbPool,
    payload: ProposalPayload<'_>,
    evidence: &PolicyEvidenceSnapshot,
) -> Result<String, AppError> {
    let id = format!("polprop_{}", Uuid::new_v4().simple());
    let (kind, category, payload_json) = match payload {
        ProposalPayload::Routing(r) => (
            "routing_rule",
            r.category.clone(),
            serde_json::to_string(r)?,
        ),
        ProposalPayload::Budget(b) => ("budget_ceiling", None, serde_json::to_string(b)?),
    };
    let evidence_json = serde_json::to_string(evidence)?;
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO policy_proposals
            (id, kind, category, payload_json, evidence_snapshot_id, evidence_json,
             status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', datetime('now'))",
        params![id, kind, category, payload_json, evidence.id, evidence_json],
    )?;
    Ok(id)
}

/// Does an open-or-declined proposal for the same change already exist?
/// (Hysteresis + decline-as-feedback: a declined routing diff is an answered
/// question — do not re-ask it.)
pub fn exists_similar_routing(
    pool: &DbPool,
    category: Option<&str>,
    to_model: &str,
) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM policy_proposals
         WHERE kind = 'routing_rule'
           AND status IN ('pending', 'declined')
           AND COALESCE(category, '') = COALESCE(?1, '')
           AND json_extract(payload_json, '$.toModel') = ?2",
        params![category, to_model],
        |row| row.get(0),
    )?;
    Ok(n > 0)
}

/// Same answered-question guard for budget-ceiling proposals (any open or
/// declined ceiling proposal blocks a new one — one budget question at a time).
pub fn exists_open_budget(pool: &DbPool) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM policy_proposals
         WHERE kind = 'budget_ceiling' AND status IN ('pending', 'declined')",
        [],
        |row| row.get(0),
    )?;
    Ok(n > 0)
}

pub fn get(pool: &DbPool, id: &str) -> Result<Option<PolicyProposal>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, kind, category, payload_json, evidence_snapshot_id,
                    evidence_json, status, decline_reason, created_at, decided_at
             FROM policy_proposals WHERE id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    Ok(row)
}

pub fn list(pool: &DbPool, only_pending: bool, limit: u32) -> Result<Vec<PolicyProposal>, AppError> {
    let conn = pool.get()?;
    let where_clause = if only_pending {
        "WHERE status = 'pending'"
    } else {
        ""
    };
    let sql = format!(
        "SELECT id, kind, category, payload_json, evidence_snapshot_id,
                evidence_json, status, decline_reason, created_at, decided_at
         FROM policy_proposals
         {where_clause}
         ORDER BY created_at DESC, id DESC
         LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![limit], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Flip `pending → applied`. The caller performs the actual policy write
/// (rule / setting) first, in the same command, so a failed write never
/// strands an "applied" row. Returns false when the row was not pending.
pub fn mark_applied(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE policy_proposals
         SET status = 'applied', decided_at = datetime('now')
         WHERE id = ?1 AND status = 'pending'",
        params![id],
    )?;
    Ok(updated > 0)
}

/// Flip `pending → declined`, recording the operator's reason as feedback.
pub fn mark_declined(pool: &DbPool, id: &str, reason: Option<&str>) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE policy_proposals
         SET status = 'declined', decline_reason = ?2, decided_at = datetime('now')
         WHERE id = ?1 AND status = 'pending'",
        params![id, reason],
    )?;
    Ok(updated > 0)
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PolicyProposal> {
    let kind: String = row.get(1)?;
    let payload_json: String = row.get(3)?;
    let evidence_json: String = row.get(5)?;
    let (routing, budget) = match kind.as_str() {
        "routing_rule" => (serde_json::from_str(&payload_json).ok(), None),
        "budget_ceiling" => (None, serde_json::from_str(&payload_json).ok()),
        _ => (None, None),
    };
    let evidence: PolicyEvidenceSnapshot = serde_json::from_str(&evidence_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(PolicyProposal {
        id: row.get(0)?,
        kind,
        category: row.get(2)?,
        routing,
        budget,
        evidence_snapshot_id: row.get(4)?,
        evidence,
        status: row.get(6)?,
        decline_reason: row.get(7)?,
        created_at: row.get(8)?,
        decided_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy_tuning::{RoutingClaim, TuningThresholds};
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:policy_proposals_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::migrations::run(&conn).expect("initial migrations");
            crate::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn sample_routing() -> RoutingRuleChange {
        RoutingRuleChange {
            category: Some("research".into()),
            from_model: Some("opus".into()),
            to_model: "sonnet".into(),
            claim: RoutingClaim {
                projected_monthly_saving_usd: 18.0,
                saving_pct: 0.6,
                quality_basis: "lab".into(),
                quality_delta_pct: -0.02,
                incumbent_runs: 60,
                challenger_runs: 30,
                incumbent_success_rate: 0.9,
                challenger_success_rate: 0.92,
                incumbent_avg_cost_usd: 0.5,
                challenger_avg_cost_usd: 0.2,
            },
        }
    }

    fn sample_evidence() -> PolicyEvidenceSnapshot {
        PolicyEvidenceSnapshot {
            id: "polsnap_x".into(),
            window_days: 30,
            generated_at: "2026-07-30T00:00:00Z".into(),
            cells: vec![],
            healing: crate::repos::execution::healing::HealingEffectivenessReport {
                window_days: 30,
                attempted: 0,
                confirmed: 0,
                reverted: 0,
                success_rate: 0.0,
                by_category: vec![],
            },
            monthly_spend_usd: 0.0,
            monthly_spend_rows: 0,
            monthly_ceiling_usd: 0.0,
        }
    }

    #[test]
    fn create_get_roundtrip_with_typed_payload() {
        let pool = test_pool();
        let routing = sample_routing();
        let id = create(&pool, ProposalPayload::Routing(&routing), &sample_evidence()).unwrap();
        let got = get(&pool, &id).unwrap().unwrap();
        assert_eq!(got.kind, "routing_rule");
        assert_eq!(got.status, "pending");
        assert_eq!(got.category.as_deref(), Some("research"));
        assert_eq!(got.evidence_snapshot_id, "polsnap_x");
        let r = got.routing.expect("typed routing payload");
        assert_eq!(r.to_model, "sonnet");
        assert!((r.claim.projected_monthly_saving_usd - 18.0).abs() < 1e-9);
        assert!(got.budget.is_none());
    }

    #[test]
    fn apply_and_decline_transitions_are_single_shot() {
        let pool = test_pool();
        let routing = sample_routing();
        let id = create(&pool, ProposalPayload::Routing(&routing), &sample_evidence()).unwrap();
        assert!(mark_applied(&pool, &id).unwrap());
        assert!(!mark_applied(&pool, &id).unwrap()); // no re-apply
        assert!(!mark_declined(&pool, &id, Some("late")).unwrap()); // no post-apply decline

        let id2 = create(&pool, ProposalPayload::Routing(&routing), &sample_evidence()).unwrap();
        assert!(mark_declined(&pool, &id2, Some("prefer opus quality")).unwrap());
        let got = get(&pool, &id2).unwrap().unwrap();
        assert_eq!(got.status, "declined");
        assert_eq!(got.decline_reason.as_deref(), Some("prefer opus quality"));
        assert!(got.decided_at.is_some());
    }

    #[test]
    fn declined_counts_as_answered_for_dedupe() {
        let pool = test_pool();
        let routing = sample_routing();
        assert!(!exists_similar_routing(&pool, Some("research"), "sonnet").unwrap());
        let id = create(&pool, ProposalPayload::Routing(&routing), &sample_evidence()).unwrap();
        assert!(exists_similar_routing(&pool, Some("research"), "sonnet").unwrap());
        // Different category or model → not similar.
        assert!(!exists_similar_routing(&pool, Some("dev"), "sonnet").unwrap());
        assert!(!exists_similar_routing(&pool, Some("research"), "haiku").unwrap());
        // Declined still counts as answered (feedback loop).
        mark_declined(&pool, &id, None).unwrap();
        assert!(exists_similar_routing(&pool, Some("research"), "sonnet").unwrap());
        // Applied rows stop blocking (a later re-proposal after evidence
        // changes is legitimate — the rule is live and `already_routed`
        // suppresses duplicates at generation time instead).
        let id3 = create(&pool, ProposalPayload::Routing(&routing), &sample_evidence()).unwrap();
        mark_applied(&pool, &id3).unwrap();
        // id (declined) still present → still true; drop it to isolate.
        let conn = pool.get().unwrap();
        conn.execute("DELETE FROM policy_proposals WHERE id = ?1", params![id])
            .unwrap();
        assert!(!exists_similar_routing(&pool, Some("research"), "sonnet").unwrap());
    }

    #[test]
    fn list_orders_and_filters_pending() {
        let pool = test_pool();
        let routing = sample_routing();
        let a = create(&pool, ProposalPayload::Routing(&routing), &sample_evidence()).unwrap();
        let b = create(&pool, ProposalPayload::Routing(&routing), &sample_evidence()).unwrap();
        mark_declined(&pool, &a, None).unwrap();
        let all = list(&pool, false, 10).unwrap();
        assert_eq!(all.len(), 2);
        let pending = list(&pool, true, 10).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, b);
    }

    #[test]
    fn thresholds_default_floor_matches_docs() {
        // Guard: the evidence floor the UI copy documents (10 runs / 5 lab
        // samples / 20 spend rows) is the code's actual default.
        let cfg = TuningThresholds::default();
        assert_eq!(cfg.min_runs_per_cell, 10);
        assert_eq!(cfg.min_lab_samples, 5);
        assert_eq!(cfg.min_spend_rows, 20);
    }
}
