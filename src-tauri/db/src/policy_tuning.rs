//! Self-Tuning Fabric v1 — pure proposal generation over lived evidence.
//!
//! The evidence aggregator (`repos::execution::policy_evidence`) joins
//! executions × spend × lab scores × healing effectiveness into a
//! [`PolicyEvidenceSnapshot`]. This module holds the *pure* generator that
//! turns a snapshot + the current routing rules into candidate policy
//! proposals — `ModelRoutingRule` diffs and budget-ceiling changes — each
//! carrying a quantified claim, or an honest [`DeclinedCell`] explaining why
//! no proposal could be made (evidence floor, no qualified challenger, saving
//! below the hysteresis threshold, quality regression).
//!
//! Learning grammar (batch-3): *evidenced* — every proposal embeds the
//! snapshot slice it was derived from; *proposed, not imposed* — nothing here
//! writes anything, apply is a separate review-each command; *provenance* —
//! applied rules carry [`crate::model_routing::RuleProvenance`];
//! *reversible* — a learned rule is an ordinary routing rule the operator can
//! delete; *budget-capped* — no LLM step exists in this loop at all (pure
//! SQL + arithmetic).
//!
//! Healing-strategy-weight proposals are deferred: healing effectiveness is
//! part of the evidence snapshot (visible in the drawer), but no engine
//! surface consumes per-strategy weights yet, so proposing them would be a
//! write without a reader.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model_routing::{resolve, ModelRoutingRule};
use crate::repos::execution::healing::HealingEffectivenessReport;

/// One aggregated `(category, model)` evidence cell from the trailing window.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceCell {
    /// Lowercased persona `template_category`; `"uncategorized"` when absent.
    pub category: String,
    /// `persona_executions.model_used`.
    pub model: String,
    /// Terminal executions in the window (completed + failed/incomplete/cancelled).
    #[ts(type = "number")]
    pub runs: i64,
    #[ts(type = "number")]
    pub completed: i64,
    #[ts(type = "number")]
    pub failed: i64,
    /// `completed / runs`, `0.0..=1.0`.
    pub success_rate: f64,
    pub avg_cost_usd: f64,
    pub total_cost_usd: f64,
    pub avg_duration_ms: f64,
    /// Scored lab results for this model (matrix runs, non-error, quality present).
    #[ts(type = "number")]
    pub lab_samples: i64,
    /// Mean `output_quality_score` (0-100) when `lab_samples > 0`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avg_lab_quality: Option<f64>,
}

/// The full evidence snapshot a generation pass runs over. Persisted (as a
/// per-proposal slice) so every proposal's raw evidence stays inspectable.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolicyEvidenceSnapshot {
    /// `polsnap_<uuid>` — referenced by proposals and applied-rule provenance.
    pub id: String,
    #[ts(type = "number")]
    pub window_days: i64,
    pub generated_at: String,
    pub cells: Vec<EvidenceCell>,
    /// Healing effectiveness over the same window (context evidence; no
    /// healing proposals are generated in v1 — see module docs).
    pub healing: HealingEffectivenessReport,
    /// Calendar-month spend from `dev_llm_spend` (budget-ceiling evidence).
    pub monthly_spend_usd: f64,
    /// Rows behind `monthly_spend_usd` — its own evidence floor.
    #[ts(type = "number")]
    pub monthly_spend_rows: i64,
    /// Current `monthly_cost_ceiling_usd` setting (`0` = no ceiling).
    pub monthly_ceiling_usd: f64,
}

/// Thresholds the generator enforces. Defaults are deliberately conservative
/// (high floor + hysteresis) so early sparse data yields honest declines, not
/// stretched inferences, and rules don't flap between models.
#[derive(Debug, Clone)]
pub struct TuningThresholds {
    /// Minimum terminal runs a `(category, model)` cell needs to count as
    /// evidence — for the incumbent AND any challenger.
    pub min_runs_per_cell: i64,
    /// Minimum scored lab samples (per model) for a lab-quality comparison.
    pub min_lab_samples: i64,
    /// Minimum relative cost saving before a routing diff is proposed
    /// (hysteresis against flapping).
    pub min_saving_pct: f64,
    /// Maximum execution success-rate drop a challenger may show.
    pub max_success_drop: f64,
    /// Maximum relative lab-quality drop a challenger may show.
    pub max_lab_quality_drop_pct: f64,
    /// Minimum `dev_llm_spend` rows this month before a ceiling proposal.
    pub min_spend_rows: i64,
}

impl Default for TuningThresholds {
    fn default() -> Self {
        Self {
            min_runs_per_cell: 10,
            min_lab_samples: 5,
            min_saving_pct: 0.15,
            max_success_drop: 0.02,
            max_lab_quality_drop_pct: 0.05,
            min_spend_rows: 20,
        }
    }
}

/// A candidate `ModelRoutingRule` diff with its quantified claim.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRuleChange {
    /// Category the rule targets (`None` would be a universal rule — the v1
    /// generator always proposes per-category, so this is always `Some`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub category: Option<String>,
    /// Model the category currently resolves to (rule or observed dominant).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub from_model: Option<String>,
    pub to_model: String,
    pub claim: RoutingClaim,
}

/// The quantified claim behind a routing diff. Every number is derived from
/// the embedded evidence snapshot — nothing is estimated beyond the linear
/// projection of window run-rate to 30 days.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RoutingClaim {
    pub projected_monthly_saving_usd: f64,
    /// Relative saving, `0.0..=1.0`.
    pub saving_pct: f64,
    /// `"lab"` when both models had enough scored lab samples, otherwise
    /// `"success_rate"` — the claim is explicit about its quality basis.
    pub quality_basis: String,
    /// Challenger quality relative to incumbent on that basis
    /// (negative = worse), e.g. `-0.02` = 2% below.
    pub quality_delta_pct: f64,
    #[ts(type = "number")]
    pub incumbent_runs: i64,
    #[ts(type = "number")]
    pub challenger_runs: i64,
    pub incumbent_success_rate: f64,
    pub challenger_success_rate: f64,
    pub incumbent_avg_cost_usd: f64,
    pub challenger_avg_cost_usd: f64,
}

/// A candidate budget-ceiling change with its evidence.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BudgetCeilingChange {
    /// `0` = currently no ceiling.
    pub current_ceiling_usd: f64,
    pub proposed_ceiling_usd: f64,
    pub observed_monthly_spend_usd: f64,
    #[ts(type = "number")]
    pub spend_rows: i64,
    /// `"introduce"` | `"raise"` | `"lower"` — token, translated in the UI.
    pub direction: String,
}

/// One candidate the generator emitted.
#[derive(Debug, Clone)]
pub enum CandidateProposal {
    Routing(RoutingRuleChange),
    Budget(BudgetCeilingChange),
}

/// An honest "I decline to propose here" record — surfaced verbatim in the
/// UI so sparse data reads as sparse data, not as silence.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeclinedCell {
    pub category: String,
    pub incumbent_model: String,
    /// Machine token: `below_evidence_floor` | `no_qualified_challenger` |
    /// `saving_below_threshold` | `quality_regression` | `already_routed`.
    pub reason: String,
    /// Runs backing the incumbent cell (context for the floor message).
    #[ts(type = "number")]
    pub runs: i64,
    /// The floor that applied.
    #[ts(type = "number")]
    pub floor: i64,
}

/// Everything a generation pass produced.
#[derive(Debug, Clone)]
pub struct GenerationOutcome {
    pub proposals: Vec<CandidateProposal>,
    pub declined: Vec<DeclinedCell>,
}

/// Quality of a cell on the chosen basis: lab quality (0-100 normalized to
/// 0-1) when both sides have enough samples, else execution success rate.
fn quality_pair(
    incumbent: &EvidenceCell,
    challenger: &EvidenceCell,
    cfg: &TuningThresholds,
) -> (String, f64, f64) {
    let lab_ok =
        |c: &EvidenceCell| c.lab_samples >= cfg.min_lab_samples && c.avg_lab_quality.is_some();
    if lab_ok(incumbent) && lab_ok(challenger) {
        (
            "lab".to_string(),
            incumbent.avg_lab_quality.unwrap_or(0.0) / 100.0,
            challenger.avg_lab_quality.unwrap_or(0.0) / 100.0,
        )
    } else {
        (
            "success_rate".to_string(),
            incumbent.success_rate,
            challenger.success_rate,
        )
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Generate candidate proposals from a snapshot + current rules. Pure —
/// no I/O, fully unit-tested. Emits at most one routing diff per category
/// (the best qualified challenger by cost) and at most one budget-ceiling
/// change.
#[must_use]
pub fn generate_proposals(
    snapshot: &PolicyEvidenceSnapshot,
    current_rules: &[ModelRoutingRule],
    cfg: &TuningThresholds,
) -> GenerationOutcome {
    let mut proposals = Vec::new();
    let mut declined = Vec::new();

    // -- Routing diffs, per category --------------------------------------
    let mut categories: Vec<&str> = snapshot.cells.iter().map(|c| c.category.as_str()).collect();
    categories.sort_unstable();
    categories.dedup();

    for category in categories {
        let cells: Vec<&EvidenceCell> = snapshot
            .cells
            .iter()
            .filter(|c| c.category == category)
            .collect();

        // Incumbent = the model this category currently resolves to via the
        // cascade (probe with a synthetic persona id so only category /
        // universal rules match), else the dominant model by observed runs.
        let routed =
            resolve(current_rules, "\u{0}policy-tuning-probe", Some(category)).map(|r| r.model);
        let Some(&dominant) = cells.iter().max_by_key(|c| c.runs) else {
            continue;
        };
        let incumbent: &EvidenceCell = routed
            .as_deref()
            .and_then(|m| cells.iter().find(|c| c.model == m).copied())
            .unwrap_or(dominant);

        if incumbent.runs < cfg.min_runs_per_cell {
            declined.push(DeclinedCell {
                category: category.to_string(),
                incumbent_model: incumbent.model.clone(),
                reason: "below_evidence_floor".to_string(),
                runs: incumbent.runs,
                floor: cfg.min_runs_per_cell,
            });
            continue;
        }

        // Qualified challengers: enough runs, cheaper by the hysteresis
        // margin, quality holds on the strongest available basis.
        let mut best: Option<(&EvidenceCell, String, f64, f64)> = None;
        let mut saw_challenger = false;
        let mut saw_saving = false;
        for cell in cells.iter().copied().filter(|c| c.model != incumbent.model) {
            if cell.runs < cfg.min_runs_per_cell {
                continue;
            }
            saw_challenger = true;
            if incumbent.avg_cost_usd <= 0.0 {
                continue;
            }
            let saving_pct = 1.0 - cell.avg_cost_usd / incumbent.avg_cost_usd;
            if saving_pct < cfg.min_saving_pct {
                continue;
            }
            saw_saving = true;
            let (basis, inc_q, ch_q) = quality_pair(incumbent, cell, cfg);
            let ok = if basis == "lab" {
                inc_q <= 0.0 || (ch_q >= inc_q * (1.0 - cfg.max_lab_quality_drop_pct))
            } else {
                ch_q >= inc_q - cfg.max_success_drop
            };
            if !ok {
                continue;
            }
            let better = match &best {
                Some((b, ..)) => cell.avg_cost_usd < b.avg_cost_usd,
                None => true,
            };
            if better {
                best = Some((cell, basis, inc_q, ch_q));
            }
        }

        match best {
            Some((challenger, basis, inc_q, ch_q)) => {
                // Already routed to the winner → nothing to propose.
                if routed.as_deref() == Some(challenger.model.as_str()) {
                    declined.push(DeclinedCell {
                        category: category.to_string(),
                        incumbent_model: challenger.model.clone(),
                        reason: "already_routed".to_string(),
                        runs: challenger.runs,
                        floor: cfg.min_runs_per_cell,
                    });
                    continue;
                }
                let per_run_saving = incumbent.avg_cost_usd - challenger.avg_cost_usd;
                let monthly_runs =
                    incumbent.runs as f64 * 30.0 / snapshot.window_days.max(1) as f64;
                let quality_delta = if inc_q > 0.0 { ch_q / inc_q - 1.0 } else { 0.0 };
                proposals.push(CandidateProposal::Routing(RoutingRuleChange {
                    category: Some(category.to_string()),
                    from_model: Some(incumbent.model.clone()),
                    to_model: challenger.model.clone(),
                    claim: RoutingClaim {
                        projected_monthly_saving_usd: round2(per_run_saving * monthly_runs),
                        saving_pct: round2(1.0 - challenger.avg_cost_usd / incumbent.avg_cost_usd),
                        quality_basis: basis,
                        quality_delta_pct: (quality_delta * 1000.0).round() / 1000.0,
                        incumbent_runs: incumbent.runs,
                        challenger_runs: challenger.runs,
                        incumbent_success_rate: incumbent.success_rate,
                        challenger_success_rate: challenger.success_rate,
                        incumbent_avg_cost_usd: incumbent.avg_cost_usd,
                        challenger_avg_cost_usd: challenger.avg_cost_usd,
                    },
                }));
            }
            None => {
                let reason = if !saw_challenger {
                    "no_qualified_challenger"
                } else if !saw_saving {
                    // A routed category where no challenger is meaningfully
                    // cheaper is already sitting on the best-evidenced model.
                    if routed.as_deref() == Some(incumbent.model.as_str()) {
                        "already_routed"
                    } else {
                        "saving_below_threshold"
                    }
                } else {
                    "quality_regression"
                };
                declined.push(DeclinedCell {
                    category: category.to_string(),
                    incumbent_model: incumbent.model.clone(),
                    reason: reason.to_string(),
                    runs: incumbent.runs,
                    floor: cfg.min_runs_per_cell,
                });
            }
        }
    }

    // -- Budget ceiling ----------------------------------------------------
    if snapshot.monthly_spend_rows >= cfg.min_spend_rows {
        let spend = snapshot.monthly_spend_usd;
        let ceiling = snapshot.monthly_ceiling_usd;
        let candidate = if ceiling <= 0.0 && spend > 0.0 {
            // No ceiling at all but real spend → propose introducing one.
            Some(("introduce", round2((spend * 1.5).max(1.0))))
        } else if ceiling > 0.0 && spend > ceiling * 0.9 {
            Some(("raise", round2(spend * 1.2)))
        } else if ceiling > 0.0 && spend < ceiling * 0.4 {
            let proposed = round2((spend * 1.5).max(1.0));
            (proposed < ceiling).then_some(("lower", proposed))
        } else {
            None
        };
        if let Some((direction, proposed)) = candidate {
            proposals.push(CandidateProposal::Budget(BudgetCeilingChange {
                current_ceiling_usd: ceiling,
                proposed_ceiling_usd: proposed,
                observed_monthly_spend_usd: round2(spend),
                spend_rows: snapshot.monthly_spend_rows,
                direction: direction.to_string(),
            }));
        }
    }

    GenerationOutcome {
        proposals,
        declined,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_routing::RoutingMatch;

    fn cell(
        category: &str,
        model: &str,
        runs: i64,
        success_rate: f64,
        avg_cost: f64,
        lab: Option<(i64, f64)>,
    ) -> EvidenceCell {
        EvidenceCell {
            category: category.into(),
            model: model.into(),
            runs,
            completed: (runs as f64 * success_rate).round() as i64,
            failed: runs - (runs as f64 * success_rate).round() as i64,
            success_rate,
            avg_cost_usd: avg_cost,
            total_cost_usd: avg_cost * runs as f64,
            avg_duration_ms: 1000.0,
            lab_samples: lab.map_or(0, |(n, _)| n),
            avg_lab_quality: lab.map(|(_, q)| q),
        }
    }

    fn snapshot(cells: Vec<EvidenceCell>) -> PolicyEvidenceSnapshot {
        PolicyEvidenceSnapshot {
            id: "polsnap_test".into(),
            window_days: 30,
            generated_at: "2026-07-30T00:00:00Z".into(),
            cells,
            healing: HealingEffectivenessReport {
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

    fn cat_rule(category: &str, model: &str) -> ModelRoutingRule {
        ModelRoutingRule {
            r#match: RoutingMatch {
                persona_id: None,
                category: Some(category.into()),
            },
            model: model.into(),
            effort: None,
            provenance: None,
        }
    }

    fn routing(outcome: &GenerationOutcome) -> Vec<&RoutingRuleChange> {
        outcome
            .proposals
            .iter()
            .filter_map(|p| match p {
                CandidateProposal::Routing(r) => Some(r),
                CandidateProposal::Budget(_) => None,
            })
            .collect()
    }

    #[test]
    fn declines_below_evidence_floor() {
        // 9 runs on the only model: below the 10-run floor → decline, honestly.
        let snap = snapshot(vec![cell("research", "opus", 9, 0.9, 0.5, None)]);
        let out = generate_proposals(&snap, &[], &TuningThresholds::default());
        assert!(out.proposals.is_empty());
        assert_eq!(out.declined.len(), 1);
        assert_eq!(out.declined[0].reason, "below_evidence_floor");
        assert_eq!(out.declined[0].runs, 9);
        assert_eq!(out.declined[0].floor, 10);
    }

    #[test]
    fn declines_when_challenger_is_under_floor() {
        // Challenger exists but with too few runs → no qualified challenger.
        let snap = snapshot(vec![
            cell("research", "opus", 50, 0.9, 0.5, None),
            cell("research", "haiku", 3, 1.0, 0.05, None),
        ]);
        let out = generate_proposals(&snap, &[], &TuningThresholds::default());
        assert!(out.proposals.is_empty());
        assert_eq!(out.declined[0].reason, "no_qualified_challenger");
    }

    #[test]
    fn proposes_cheaper_challenger_with_quantified_claim() {
        let snap = snapshot(vec![
            cell("research", "opus", 60, 0.90, 0.50, Some((10, 90.0))),
            cell("research", "sonnet", 30, 0.92, 0.20, Some((10, 88.0))),
        ]);
        let out = generate_proposals(&snap, &[], &TuningThresholds::default());
        let props = routing(&out);
        assert_eq!(props.len(), 1);
        let p = props[0];
        assert_eq!(p.category.as_deref(), Some("research"));
        assert_eq!(p.from_model.as_deref(), Some("opus"));
        assert_eq!(p.to_model, "sonnet");
        assert_eq!(p.claim.quality_basis, "lab");
        assert_eq!(p.claim.saving_pct, 0.6);
        // 60 runs / 30d window → 60 runs/month × $0.30 saved each = $18.
        assert!((p.claim.projected_monthly_saving_usd - 18.0).abs() < 0.01);
        assert!(p.claim.quality_delta_pct < 0.0); // 88 vs 90 → slightly worse, disclosed.
    }

    #[test]
    fn declines_on_quality_regression() {
        // Cheaper, but lab quality drops 20% — beyond the 5% tolerance.
        let snap = snapshot(vec![
            cell("research", "opus", 60, 0.90, 0.50, Some((10, 90.0))),
            cell("research", "haiku", 30, 0.90, 0.10, Some((10, 72.0))),
        ]);
        let out = generate_proposals(&snap, &[], &TuningThresholds::default());
        assert!(routing(&out).is_empty());
        assert_eq!(out.declined[0].reason, "quality_regression");
    }

    #[test]
    fn declines_when_saving_below_hysteresis() {
        // Only 8% cheaper — below the 15% flap guard.
        let snap = snapshot(vec![
            cell("dev", "sonnet", 40, 0.9, 0.50, None),
            cell("dev", "sonnet-mini", 40, 0.9, 0.46, None),
        ]);
        let out = generate_proposals(&snap, &[], &TuningThresholds::default());
        assert!(routing(&out).is_empty());
        assert_eq!(out.declined[0].reason, "saving_below_threshold");
    }

    #[test]
    fn success_rate_basis_when_lab_samples_missing() {
        let snap = snapshot(vec![
            cell("dev", "opus", 40, 0.90, 0.50, None),
            cell("dev", "haiku", 40, 0.89, 0.10, None), // within 0.02 drop
        ]);
        let out = generate_proposals(&snap, &[], &TuningThresholds::default());
        let props = routing(&out);
        assert_eq!(props.len(), 1);
        assert_eq!(props[0].claim.quality_basis, "success_rate");
    }

    #[test]
    fn respects_existing_rule_as_incumbent_and_skips_already_routed() {
        // Category already routed to the cheap winner → nothing to propose.
        let snap = snapshot(vec![
            cell("dev", "opus", 60, 0.90, 0.50, None),
            cell("dev", "haiku", 40, 0.90, 0.10, None),
        ]);
        let rules = vec![cat_rule("dev", "haiku")];
        let out = generate_proposals(&snap, &rules, &TuningThresholds::default());
        assert!(routing(&out).is_empty());
        assert_eq!(out.declined[0].reason, "already_routed");
    }

    #[test]
    fn budget_proposal_needs_spend_floor() {
        let mut snap = snapshot(vec![]);
        snap.monthly_spend_usd = 80.0;
        snap.monthly_spend_rows = 5; // below min_spend_rows=20
        snap.monthly_ceiling_usd = 0.0;
        let out = generate_proposals(&snap, &[], &TuningThresholds::default());
        assert!(out.proposals.is_empty());
    }

    #[test]
    fn budget_introduce_raise_lower() {
        let cfg = TuningThresholds::default();
        // No ceiling + real spend → introduce at 1.5×.
        let mut snap = snapshot(vec![]);
        snap.monthly_spend_usd = 40.0;
        snap.monthly_spend_rows = 25;
        let out = generate_proposals(&snap, &[], &cfg);
        match &out.proposals[0] {
            CandidateProposal::Budget(b) => {
                assert_eq!(b.direction, "introduce");
                assert!((b.proposed_ceiling_usd - 60.0).abs() < 0.01);
            }
            CandidateProposal::Routing(_) => panic!("expected budget proposal"),
        }
        // Spend at 95% of ceiling → raise.
        snap.monthly_ceiling_usd = 42.0;
        let out = generate_proposals(&snap, &[], &cfg);
        match &out.proposals[0] {
            CandidateProposal::Budget(b) => assert_eq!(b.direction, "raise"),
            CandidateProposal::Routing(_) => panic!("expected budget proposal"),
        }
        // Spend far below ceiling → lower, but never above the current one.
        snap.monthly_ceiling_usd = 500.0;
        let out = generate_proposals(&snap, &[], &cfg);
        match &out.proposals[0] {
            CandidateProposal::Budget(b) => {
                assert_eq!(b.direction, "lower");
                assert!(b.proposed_ceiling_usd < 500.0);
            }
            CandidateProposal::Routing(_) => panic!("expected budget proposal"),
        }
        // Mid-band spend (40%..90%) → no proposal (hysteresis dead zone).
        snap.monthly_ceiling_usd = 80.0;
        let out = generate_proposals(&snap, &[], &cfg);
        assert!(out.proposals.is_empty());
    }
}
