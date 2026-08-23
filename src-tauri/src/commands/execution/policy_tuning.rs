//! Self-Tuning Fabric v1 — IPC surface (batch-3, execution-engine moonshot #2).
//!
//! Four commands drive the whole loop, review-each only:
//! - `policy_tuning_generate` — aggregate evidence (read-only), run the pure
//!   generator, persist NEW proposals (answered questions are skipped), and
//!   report the honest declines (evidence floor / no challenger / hysteresis).
//! - `policy_tuning_list` — the proposals feed.
//! - `policy_tuning_apply` — the ONLY writer: applies one reviewed proposal
//!   (routing rule with full [`RuleProvenance`], or the monthly cost ceiling)
//!   and flips the row to `applied`. No auto-apply tiers exist in v1.
//! - `policy_tuning_decline` — records the operator's decline + reason as
//!   feedback; the generator will not re-propose an answered question.
//!
//! Reversibility: an applied routing rule is an ordinary rule in the editor
//! (delete = revert); the ceiling is an ordinary setting. Budget cap: this
//! loop contains no LLM call at all.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::model_routing::{self, RuleProvenance};
use crate::db::policy_tuning::{CandidateProposal, DeclinedCell, TuningThresholds};
use crate::db::repos::core::settings as settings_repo;
use crate::db::repos::execution::policy_evidence;
use crate::db::repos::execution::policy_proposals as repo;
use crate::db::settings_keys::MONTHLY_COST_CEILING_USD;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Result of one generation pass — created proposals plus the honest
/// "declined to propose" cells the UI must surface verbatim.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolicyTuningGenerationReport {
    pub created: Vec<repo::PolicyProposal>,
    /// Candidates skipped because an equal pending/declined proposal already
    /// exists (answered questions are not re-asked).
    #[ts(type = "number")]
    pub skipped_existing: i64,
    /// Cells the generator declined to propose on, with machine reasons.
    pub declined: Vec<DeclinedCell>,
    /// The floors that applied (so UI copy always states the real numbers).
    #[ts(type = "number")]
    pub evidence_floor_runs: i64,
    #[ts(type = "number")]
    pub min_lab_samples: i64,
    #[ts(type = "number")]
    pub min_spend_rows: i64,
    pub snapshot_id: String,
    #[ts(type = "number")]
    pub window_days: i64,
}

/// Aggregate evidence and generate proposals. Read-only except for inserting
/// new `policy_proposals` rows. `window_days` defaults to 30 (clamped 1..=365).
#[tauri::command]
pub fn policy_tuning_generate(
    state: State<'_, Arc<AppState>>,
    window_days: Option<i64>,
) -> Result<PolicyTuningGenerationReport, AppError> {
    require_auth_sync(&state)?;
    let cfg = TuningThresholds::default();
    let snapshot = policy_evidence::gather(&state.db, window_days)?;
    let current_rules = model_routing::load_rules(&state.db);
    let outcome = crate::db::policy_tuning::generate_proposals(&snapshot, &current_rules, &cfg);

    let mut created = Vec::new();
    let mut skipped_existing = 0i64;
    for candidate in &outcome.proposals {
        match candidate {
            CandidateProposal::Routing(r) => {
                if repo::exists_similar_routing(&state.db, r.category.as_deref(), &r.to_model)? {
                    skipped_existing += 1;
                    continue;
                }
                let id = repo::create(&state.db, repo::ProposalPayload::Routing(r), &snapshot)?;
                if let Some(p) = repo::get(&state.db, &id)? {
                    created.push(p);
                }
            }
            CandidateProposal::Budget(b) => {
                if repo::exists_open_budget(&state.db)? {
                    skipped_existing += 1;
                    continue;
                }
                let id = repo::create(&state.db, repo::ProposalPayload::Budget(b), &snapshot)?;
                if let Some(p) = repo::get(&state.db, &id)? {
                    created.push(p);
                }
            }
        }
    }

    Ok(PolicyTuningGenerationReport {
        created,
        skipped_existing,
        declined: outcome.declined,
        evidence_floor_runs: cfg.min_runs_per_cell,
        min_lab_samples: cfg.min_lab_samples,
        min_spend_rows: cfg.min_spend_rows,
        snapshot_id: snapshot.id,
        window_days: snapshot.window_days,
    })
}

/// The proposals feed (newest first). `only_pending` defaults to false so the
/// history (applied/declined, with provenance) stays auditable in the UI.
#[tauri::command]
pub fn policy_tuning_list(
    state: State<'_, Arc<AppState>>,
    only_pending: Option<bool>,
    limit: Option<u32>,
) -> Result<Vec<repo::PolicyProposal>, AppError> {
    require_auth_sync(&state)?;
    repo::list(
        &state.db,
        only_pending.unwrap_or(false),
        limit.unwrap_or(50).clamp(1, 200),
    )
}

/// Apply one reviewed proposal. Routing: upserts the category rule stamped
/// with [`RuleProvenance`] (proposal id + evidence snapshot id + claim), so
/// every active learned rule is auditable back to its evidence. Budget:
/// writes `monthly_cost_ceiling_usd`. The policy write happens BEFORE the
/// status flip so a failed write never strands an `applied` row.
#[tauri::command]
pub fn policy_tuning_apply(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<repo::PolicyProposal, AppError> {
    require_auth_sync(&state)?;
    let proposal = repo::get(&state.db, &id)?
        .ok_or_else(|| AppError::NotFound(format!("policy proposal {id}")))?;
    if proposal.status != "pending" {
        return Err(AppError::Validation(format!(
            "proposal {id} is '{}', not pending",
            proposal.status
        )));
    }

    match proposal.kind.as_str() {
        "routing_rule" => {
            let change = proposal
                .routing
                .as_ref()
                .ok_or_else(|| AppError::Internal("routing proposal without payload".into()))?;
            let mut rules = model_routing::load_rules(&state.db);
            // Replace any existing rule with the same category selector
            // (persona-id rules are untouched — more specific, still win).
            rules.retain(|r| {
                !(r.r#match.persona_id.is_none() && r.r#match.category == change.category)
            });
            rules.push(model_routing::ModelRoutingRule {
                r#match: model_routing::RoutingMatch {
                    persona_id: None,
                    category: change.category.clone(),
                },
                model: change.to_model.clone(),
                effort: None,
                provenance: Some(RuleProvenance {
                    proposal_id: proposal.id.clone(),
                    evidence_snapshot_id: proposal.evidence_snapshot_id.clone(),
                    applied_at: chrono::Utc::now().to_rfc3339(),
                    claim: format!(
                        "{} -> {}: -{:.0}% cost (~${:.2}/mo) at {:+.1}% quality ({} basis; {}+{} runs)",
                        change.from_model.as_deref().unwrap_or("?"),
                        change.to_model,
                        change.claim.saving_pct * 100.0,
                        change.claim.projected_monthly_saving_usd,
                        change.claim.quality_delta_pct * 100.0,
                        change.claim.quality_basis,
                        change.claim.incumbent_runs,
                        change.claim.challenger_runs,
                    ),
                }),
            });
            let diags = model_routing::validate(&rules);
            if !diags.is_empty() {
                return Err(AppError::Validation(diags.join("; ")));
            }
            let json =
                serde_json::to_string(&rules).map_err(|e| AppError::Internal(e.to_string()))?;
            settings_repo::set(&state.db, model_routing::MODEL_ROUTING_RULES_KEY, &json)?;
        }
        "budget_ceiling" => {
            let change = proposal
                .budget
                .as_ref()
                .ok_or_else(|| AppError::Internal("budget proposal without payload".into()))?;
            settings_repo::set(
                &state.db,
                MONTHLY_COST_CEILING_USD,
                &format!("{:.2}", change.proposed_ceiling_usd),
            )?;
        }
        other => {
            return Err(AppError::Validation(format!(
                "proposal kind '{other}' cannot be applied in v1"
            )));
        }
    }

    if !repo::mark_applied(&state.db, &id)? {
        return Err(AppError::Validation(format!(
            "proposal {id} was decided concurrently"
        )));
    }
    repo::get(&state.db, &id)?.ok_or_else(|| AppError::Internal("applied proposal vanished".into()))
}

/// Decline one proposal, recording the operator's reason as feedback. The
/// generator treats declined rows as answered and will not re-propose them.
#[tauri::command]
pub fn policy_tuning_decline(
    state: State<'_, Arc<AppState>>,
    id: String,
    reason: Option<String>,
) -> Result<repo::PolicyProposal, AppError> {
    require_auth_sync(&state)?;
    let trimmed = reason.as_deref().map(str::trim).filter(|r| !r.is_empty());
    if !repo::mark_declined(&state.db, &id, trimmed)? {
        return Err(AppError::Validation(format!(
            "proposal {id} is not pending"
        )));
    }
    repo::get(&state.db, &id)?.ok_or_else(|| AppError::NotFound(format!("policy proposal {id}")))
}
