//! Director's Lab — the verdict→experiment compiler (batch-3, moonshot
//! `agent-quality-governance.md` #2, v1 slice).
//!
//! The Director's coaching verdicts can carry a typed hypothesis
//! ([`super::director::DirectorHypothesis`]). Once the user APPROVES such a
//! verdict in the review queue, this module compiles it into a registered
//! `lab_ab_experiments` row:
//!
//! 1. **Budget ledger first** — per-week evolution spend (the
//!    `dev_llm_spend` rows the genome-critique pass already records) is
//!    checked against a weekly budget, allocated across the starred roster by
//!    attention (lower Director score ⇒ larger share). A dry ledger is an
//!    honest, visible refusal: the experiment row is registered as
//!    `declined_budget`, never silently dropped.
//! 2. **Variant materialization via EXISTING genome/critique APIs only** —
//!    `PersonaGenome::from_persona` + `genome_critique::mutate_via_critique`
//!    (call-only; those files belong to the evolution machinery). When that
//!    surface cannot produce a variant (no failure gradient, CLI failure, or
//!    no API to persist a variant as a version without touching the live
//!    persona), the row is registered `awaiting_variant` with the hypothesis
//!    + provenance intact — the experiment is real, the variant is pending.
//! 3. **Provenance-stamped** — every row records the verdict it came from,
//!    the evidence rationale, and the ledger state at commission time.
//!
//! The production canary/promotion loop is deferred (it rides the evolution
//! promotion-proposal path later); v1 ends at a registered, evidenced,
//! budget-capped experiment.

use std::collections::HashMap;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::LabAbExperiment;
use crate::db::repos::core::{personas, settings};
use crate::db::repos::lab::ab;
use crate::db::settings_keys::{
    DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD, DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD_DEFAULT,
};
use crate::db::DbPool;
use crate::error::AppError;

use super::director::{parse_hypothesis, DirectorHypothesis};
use super::genome::PersonaGenome;
use super::genome_critique;

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

pub const STATUS_AWAITING_VARIANT: &str = "awaiting_variant";
pub const STATUS_VARIANT_READY: &str = "variant_ready";
pub const STATUS_DECLINED_BUDGET: &str = "declined_budget";
const STATUS_RUNNING: &str = "running";

/// The `dev_llm_spend.trigger_kind` the genome-critique pass records under —
/// the Lab's materialization spend and the evolution engine's critique spend
/// share this ledger, which is exactly the "per-week evolution spend" the
/// budget governs.
const SPEND_TRIGGER_KIND: &str = "genome_critique";

// ---------------------------------------------------------------------------
// Weekly ledger
// ---------------------------------------------------------------------------

/// The Director's weekly experiment ledger — budget, spend so far this ISO
/// week (Mon 00:00 UTC), and what's left.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorLabLedger {
    /// Monday 00:00 UTC of the running week (SQLite datetime format).
    pub week_start: String,
    pub budget_usd: f64,
    pub spent_usd: f64,
    pub remaining_usd: f64,
}

/// Monday 00:00:00 UTC of the week containing `now`, in SQLite's
/// `datetime('now')` format (`YYYY-MM-DD HH:MM:SS`) so it string-compares
/// against `dev_llm_spend.created_at` / `lab_ab_experiments.created_at`.
fn week_start_utc(now: chrono::DateTime<chrono::Utc>) -> String {
    use chrono::Datelike;
    let days_from_monday = now.weekday().num_days_from_monday() as i64;
    let monday = (now - chrono::Duration::days(days_from_monday)).date_naive();
    format!("{monday} 00:00:00")
}

/// Configured weekly budget (settings), defaulting to the evolution ceiling.
fn weekly_budget_usd(pool: &DbPool) -> f64 {
    settings::get(pool, DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD_DEFAULT)
}

/// Evolution spend recorded this week, optionally scoped to one persona.
/// Reads the `dev_llm_spend` ledger (genome-critique rows) — real recorded
/// cost, never an estimate.
fn weekly_spend_usd(pool: &DbPool, week_start: &str, persona_id: Option<&str>) -> f64 {
    let run = || -> Result<f64, AppError> {
        let conn = pool.get()?;
        let spent: f64 = match persona_id {
            Some(pid) => conn.query_row(
                "SELECT COALESCE(SUM(cost_usd), 0.0) FROM dev_llm_spend
                  WHERE trigger_kind = ?1 AND created_at >= ?2 AND persona_id = ?3",
                params![SPEND_TRIGGER_KIND, week_start, pid],
                |r| r.get(0),
            )?,
            None => conn.query_row(
                "SELECT COALESCE(SUM(cost_usd), 0.0) FROM dev_llm_spend
                  WHERE trigger_kind = ?1 AND created_at >= ?2",
                params![SPEND_TRIGGER_KIND, week_start],
                |r| r.get(0),
            )?,
        };
        Ok(spent)
    };
    run().unwrap_or(0.0)
}

/// Assemble the running week's ledger.
pub fn weekly_ledger(pool: &DbPool) -> Result<DirectorLabLedger, AppError> {
    let week_start = week_start_utc(chrono::Utc::now());
    let budget_usd = weekly_budget_usd(pool);
    let spent_usd = weekly_spend_usd(pool, &week_start, None);
    Ok(DirectorLabLedger {
        week_start,
        budget_usd,
        spent_usd,
        remaining_usd: (budget_usd - spent_usd).max(0.0),
    })
}

// ---------------------------------------------------------------------------
// Attention allocation (pure)
// ---------------------------------------------------------------------------

/// Split `total_usd` across the roster by attention: weight `6 - latest_score`
/// (an unreviewed persona gets the maximum weight 6 — it needs the Director's
/// attention most). Personas the Director scored 5/5 still get weight 1, so a
/// healthy roster shares the budget rather than starving.
///
/// Empty roster or non-positive total ⇒ empty map (nothing to allocate — the
/// caller treats a missing share as "fall back to the global remainder").
pub fn allocate_attention_budget(
    total_usd: f64,
    roster: &[(String, Option<i64>)],
) -> HashMap<String, f64> {
    if roster.is_empty() || !(total_usd > 0.0) {
        return HashMap::new();
    }
    let weight = |score: &Option<i64>| -> f64 {
        match score {
            Some(s) => (6 - (*s).clamp(0, 5)) as f64,
            None => 6.0,
        }
    };
    let total_weight: f64 = roster.iter().map(|(_, s)| weight(s)).sum();
    if total_weight <= 0.0 {
        return HashMap::new();
    }
    roster
        .iter()
        .map(|(pid, s)| (pid.clone(), total_usd * weight(s) / total_weight))
        .collect()
}

/// The starred roster with each persona's latest Director score, shaped for
/// [`allocate_attention_budget`].
fn attention_roster(pool: &DbPool) -> Result<Vec<(String, Option<i64>)>, AppError> {
    let starred = personas::get_starred(pool)?;
    let ids: Vec<String> = starred.iter().map(|p| p.id.clone()).collect();
    let trends = super::director::list_score_trends(pool, &ids, 1)?;
    Ok(ids
        .into_iter()
        .map(|id| {
            let latest = trends.get(&id).and_then(|v| v.last().copied());
            (id, latest)
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Verdict → experiment compiler
// ---------------------------------------------------------------------------

/// The approved Director verdict a commission starts from.
// `Debug` is required by the `#[cfg(test)]` block below, which calls
// `.unwrap()`/`.unwrap_err()` on `Result<ApprovedVerdict, _>`. Without it
// app_lib's TEST targets do not compile at all — invisible in normal work
// because `cargo check --lib` skips test targets and app_lib's test binary
// cannot launch on this host (see CLAUDE.md, STATUS_ENTRYPOINT_NOT_FOUND).
#[derive(Debug)]
struct ApprovedVerdict {
    review_id: String,
    persona_id: String,
    title: String,
    category: String,
    rationale: Option<String>,
    hypothesis: DirectorHypothesis,
}

/// Load + validate the review row: must exist, be Director-sourced, be
/// APPROVED (proposed-not-imposed: only a human approval compiles), and carry
/// a well-formed hypothesis block.
fn load_approved_verdict(pool: &DbPool, review_id: &str) -> Result<ApprovedVerdict, AppError> {
    let conn = pool.get()?;
    let row: Option<(String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT persona_id, title, status, context_data
               FROM persona_manual_reviews WHERE id = ?1",
            params![review_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(AppError::Database(other)),
        })?;

    let Some((persona_id, title, status, context_data)) = row else {
        return Err(AppError::NotFound(format!("Director verdict {review_id}")));
    };

    let ctx: serde_json::Value = context_data
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or(serde_json::Value::Null);

    if ctx.get("source").and_then(|v| v.as_str()) != Some("director") {
        return Err(AppError::Validation(
            "Review is not a Director verdict".into(),
        ));
    }
    if status != "approved" {
        return Err(AppError::Validation(format!(
            "Verdict must be approved before it can be commissioned (status: {status})"
        )));
    }
    let Some(hypothesis) = ctx.get("hypothesis").and_then(parse_hypothesis) else {
        return Err(AppError::Validation(
            "Verdict carries no testable hypothesis block".into(),
        ));
    };

    Ok(ApprovedVerdict {
        review_id: review_id.to_string(),
        persona_id,
        title,
        category: ctx
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("usefulness")
            .to_string(),
        rationale: ctx
            .get("rationale")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        hypothesis,
    })
}

/// Provenance snapshot stamped onto the experiment row: what evidence produced
/// it, and what the ledger looked like when the Director decided.
fn provenance_json(v: &ApprovedVerdict, ledger: &DirectorLabLedger) -> String {
    serde_json::json!({
        "reviewId": v.review_id,
        "verdictTitle": v.title,
        "category": v.category,
        "rationale": v.rationale,
        "ledgerAtCommission": ledger,
        "commissionedAt": chrono::Utc::now().to_rfc3339(),
    })
    .to_string()
}

/// Compile an approved hypothesis-bearing verdict into a registered
/// `lab_ab_experiments` row.
///
/// Outcomes (all of them are rows — refusals are visible, never silent):
/// - `declined_budget` — the weekly ledger (or this persona's attention share
///   of it) is dry; `status_detail` says exactly which and by how much.
/// - `variant_ready` — the critique surface produced a candidate prompt,
///   stored on the row (`variant_source: genome_critique`).
/// - `awaiting_variant` — the existing genome/critique surface could not
///   materialize a variant (`status_detail` carries the reason).
///
/// A re-commission of an already-compiled verdict errors — EXCEPT a
/// `declined_budget` row, which retries in place once the ledger refills.
pub async fn commission_experiment(
    pool: &DbPool,
    review_id: &str,
) -> Result<LabAbExperiment, AppError> {
    let verdict = load_approved_verdict(pool, review_id)?;

    // One experiment per verdict; a declined row is retryable in place.
    let existing = ab::get_experiment_by_review(pool, review_id)?;
    if let Some(e) = &existing {
        if e.status != STATUS_DECLINED_BUDGET {
            return Err(AppError::Validation(format!(
                "An experiment for this verdict already exists (status: {})",
                e.status
            )));
        }
    }

    let hypothesis_json = serde_json::to_string(&verdict.hypothesis)?;
    let ledger = weekly_ledger(pool)?;
    let provenance = provenance_json(&verdict, &ledger);

    // -- Budget gate: honest, visible refusal -------------------------------
    let decline_detail = if ledger.remaining_usd <= 0.0 {
        Some(format!(
            "Weekly ledger is dry: ${:.2} of ${:.2} already spent this week",
            ledger.spent_usd, ledger.budget_usd
        ))
    } else {
        // Attention allocation: this persona's share of the weekly budget.
        let roster = attention_roster(pool)?;
        let shares = allocate_attention_budget(ledger.budget_usd, &roster);
        match shares.get(&verdict.persona_id) {
            Some(share) => {
                let spent =
                    weekly_spend_usd(pool, &ledger.week_start, Some(&verdict.persona_id));
                if spent >= *share {
                    Some(format!(
                        "This persona's attention share is exhausted: ${spent:.2} spent of a ${share:.2} weekly share"
                    ))
                } else {
                    None
                }
            }
            // Not on the starred roster (or empty roster) — the global
            // remainder already passed, so allow.
            None => None,
        }
    };

    if let Some(detail) = decline_detail {
        tracing::info!(review_id, persona_id = %verdict.persona_id, %detail,
            "Director's Lab: declining to commission — ledger dry");
        let declined = match existing {
            Some(e) => ab::update_experiment_outcome(
                pool,
                &e.id,
                STATUS_DECLINED_BUDGET,
                Some(&detail),
                None,
                None,
                e.spend_usd,
            )?,
            None => ab::create_experiment(
                pool,
                &ab::CreateExperimentInput {
                    persona_id: verdict.persona_id.clone(),
                    review_id: Some(verdict.review_id.clone()),
                    hypothesis_json,
                    provenance_json: Some(provenance),
                    status: STATUS_DECLINED_BUDGET.into(),
                    status_detail: Some(detail),
                    variant_prompt: None,
                    variant_source: None,
                    spend_usd: 0.0,
                },
            )?,
        };
        return Ok(declined);
    }

    // -- Materialize a variant via EXISTING genome/critique APIs (call-only) --
    let persona = personas::get_by_id(pool, &verdict.persona_id)?;
    let tool_ids: Vec<String> =
        crate::db::repos::resources::tools::get_tools_for_persona(pool, &persona.id)
            .map(|defs| defs.into_iter().map(|d| d.id).collect())
            .unwrap_or_default();
    let incumbent = PersonaGenome::from_persona(&persona, tool_ids);

    let spend_before = weekly_spend_usd(pool, &ledger.week_start, Some(&persona.id));
    let critique = genome_critique::mutate_via_critique(pool, &persona, &incumbent).await;
    let spend_after = weekly_spend_usd(pool, &ledger.week_start, Some(&persona.id));
    let spend_delta = (spend_after - spend_before).max(0.0);

    let (status, status_detail, variant_prompt, variant_source) = match critique {
        Ok(mutated) => {
            let prompt = mutated.reassemble_prompt();
            if prompt.trim().is_empty() {
                (
                    STATUS_AWAITING_VARIANT,
                    Some("Critique returned an empty variant prompt".to_string()),
                    None,
                    None,
                )
            } else {
                (
                    STATUS_VARIANT_READY,
                    None,
                    Some(prompt),
                    Some("genome_critique".to_string()),
                )
            }
        }
        // The existing surface can't produce a variant (e.g. no failure
        // gradient). Honest registration: the experiment exists, the variant
        // is pending — no functions were added to the evolution zone to force
        // one.
        Err(reason) => (STATUS_AWAITING_VARIANT, Some(reason), None, None),
    };

    let experiment = match existing {
        Some(e) => ab::update_experiment_outcome(
            pool,
            &e.id,
            status,
            status_detail.as_deref(),
            variant_prompt.as_deref(),
            variant_source.as_deref(),
            e.spend_usd + spend_delta,
        )?,
        None => ab::create_experiment(
            pool,
            &ab::CreateExperimentInput {
                persona_id: verdict.persona_id.clone(),
                review_id: Some(verdict.review_id.clone()),
                hypothesis_json,
                provenance_json: Some(provenance),
                status: status.into(),
                status_detail,
                variant_prompt,
                variant_source,
                spend_usd: spend_delta,
            },
        )?,
    };

    tracing::info!(
        review_id,
        persona_id = %verdict.persona_id,
        status = %experiment.status,
        spend_usd = experiment.spend_usd,
        "Director's Lab: experiment registered",
    );
    Ok(experiment)
}

// ---------------------------------------------------------------------------
// Campaign report
// ---------------------------------------------------------------------------

/// The Director tab's minimal campaign report: hypotheses seen, experiments by
/// state, and the weekly ledger. All counts are real rows — an empty report is
/// an honest "the Director hasn't commissioned anything yet".
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorCampaignReport {
    /// Director verdicts (all time) that carried a typed hypothesis.
    #[ts(type = "number")]
    pub hypotheses_emitted: i64,
    #[ts(type = "number")]
    pub experiments_total: i64,
    #[ts(type = "number")]
    pub variant_ready: i64,
    #[ts(type = "number")]
    pub awaiting_variant: i64,
    #[ts(type = "number")]
    pub declined_budget: i64,
    /// Reserved for the deferred canary loop — 0 in v1 unless rows were
    /// advanced externally.
    #[ts(type = "number")]
    pub running: i64,
    pub ledger: DirectorLabLedger,
    pub generated_at: String,
}

pub fn campaign_report(pool: &DbPool) -> Result<DirectorCampaignReport, AppError> {
    let hypotheses_emitted: i64 = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT COUNT(*) FROM persona_manual_reviews
              WHERE context_data LIKE '%\"source\":\"director\"%'
                AND context_data LIKE '%\"hypothesis\":{%'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };

    let counts = ab::experiment_status_counts(pool)?;
    let count_of = |status: &str| -> i64 {
        counts
            .iter()
            .find(|(s, _)| s == status)
            .map(|(_, n)| *n)
            .unwrap_or(0)
    };
    let experiments_total: i64 = counts.iter().map(|(_, n)| n).sum();

    Ok(DirectorCampaignReport {
        hypotheses_emitted,
        experiments_total,
        variant_ready: count_of(STATUS_VARIANT_READY),
        awaiting_variant: count_of(STATUS_AWAITING_VARIANT),
        declined_budget: count_of(STATUS_DECLINED_BUDGET),
        running: count_of(STATUS_RUNNING),
        ledger: weekly_ledger(pool)?,
        generated_at: chrono::Utc::now().to_rfc3339(),
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    // -- allocation ---------------------------------------------------------

    #[test]
    fn allocation_empty_roster_or_zero_total_is_empty() {
        assert!(allocate_attention_budget(2.0, &[]).is_empty());
        assert!(
            allocate_attention_budget(0.0, &[("a".into(), Some(3))]).is_empty(),
            "nothing to allocate from an empty budget"
        );
    }

    #[test]
    fn allocation_sums_to_total_and_favors_low_scores() {
        let roster = vec![
            ("struggling".to_string(), Some(1)), // weight 5
            ("healthy".to_string(), Some(5)),    // weight 1
            ("unreviewed".to_string(), None),    // weight 6
        ];
        let shares = allocate_attention_budget(2.4, &roster);
        let sum: f64 = shares.values().sum();
        assert!((sum - 2.4).abs() < 1e-9, "shares sum to the total, got {sum}");
        assert!(
            shares["struggling"] > shares["healthy"],
            "lower score ⇒ larger share"
        );
        assert!(
            shares["unreviewed"] > shares["struggling"],
            "never-reviewed gets the most attention"
        );
        // Healthy still gets a non-zero share — no starvation.
        assert!(shares["healthy"] > 0.0);
    }

    #[test]
    fn allocation_clamps_out_of_range_scores() {
        let roster = vec![
            ("weird-high".to_string(), Some(99)), // clamps to 5 → weight 1
            ("weird-low".to_string(), Some(-3)),  // clamps to 0 → weight 6
        ];
        let shares = allocate_attention_budget(7.0, &roster);
        assert!((shares["weird-high"] - 1.0).abs() < 1e-9);
        assert!((shares["weird-low"] - 6.0).abs() < 1e-9);
    }

    // -- week start ---------------------------------------------------------

    #[test]
    fn week_start_is_monday_midnight_sqlite_format() {
        // 2026-07-30 is a Thursday → week starts Monday 2026-07-27.
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-30T15:30:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(week_start_utc(now), "2026-07-27 00:00:00");
        // A Monday is its own week start.
        let monday = chrono::DateTime::parse_from_rfc3339("2026-07-27T00:00:01Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(week_start_utc(monday), "2026-07-27 00:00:00");
    }

    // -- ledger + report ----------------------------------------------------

    #[test]
    fn ledger_defaults_and_report_empty_state_are_honest() {
        let pool = init_test_db().unwrap();
        let ledger = weekly_ledger(&pool).unwrap();
        assert!((ledger.budget_usd - DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD_DEFAULT).abs() < 1e-9);
        assert_eq!(ledger.spent_usd, 0.0);
        assert!((ledger.remaining_usd - ledger.budget_usd).abs() < 1e-9);

        let report = campaign_report(&pool).unwrap();
        assert_eq!(report.hypotheses_emitted, 0);
        assert_eq!(report.experiments_total, 0);
        assert_eq!(report.variant_ready, 0);
        assert_eq!(report.awaiting_variant, 0);
        assert_eq!(report.declined_budget, 0);
    }

    #[test]
    fn ledger_reads_configured_budget_and_recorded_spend() {
        let pool = init_test_db().unwrap();
        settings::set(&pool, DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD, "5.50").unwrap();

        // A genome-critique spend row inside the running week.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO dev_llm_spend (id, source, trigger_kind, cost_usd, persona_id)
                 VALUES ('s1', 'evaluator', 'genome_critique', 1.25, 'p-1')",
                [],
            )
            .unwrap();
            // Unrelated trigger kinds don't count.
            conn.execute(
                "INSERT INTO dev_llm_spend (id, source, trigger_kind, cost_usd)
                 VALUES ('s2', 'evaluator', 'eval_judge', 9.0)",
                [],
            )
            .unwrap();
        }

        let ledger = weekly_ledger(&pool).unwrap();
        assert!((ledger.budget_usd - 5.5).abs() < 1e-9);
        assert!((ledger.spent_usd - 1.25).abs() < 1e-9);
        assert!((ledger.remaining_usd - 4.25).abs() < 1e-9);
    }

    // -- experiment repo round-trip ----------------------------------------

    #[test]
    fn experiment_rows_round_trip_and_count_by_status() {
        let pool = init_test_db().unwrap();
        let created = ab::create_experiment(
            &pool,
            &ab::CreateExperimentInput {
                persona_id: "p-1".into(),
                review_id: Some("rev-1".into()),
                hypothesis_json: "{\"proposedChange\":\"x\",\"successMetric\":\"y\"}".into(),
                provenance_json: Some("{\"reviewId\":\"rev-1\"}".into()),
                status: STATUS_AWAITING_VARIANT.into(),
                status_detail: Some("No actionable failure signal".into()),
                variant_prompt: None,
                variant_source: None,
                spend_usd: 0.0,
            },
        )
        .unwrap();
        assert_eq!(created.status, STATUS_AWAITING_VARIANT);

        let by_review = ab::get_experiment_by_review(&pool, "rev-1").unwrap().unwrap();
        assert_eq!(by_review.id, created.id);
        assert!(ab::get_experiment_by_review(&pool, "rev-missing").unwrap().is_none());

        let updated = ab::update_experiment_outcome(
            &pool,
            &created.id,
            STATUS_VARIANT_READY,
            None,
            Some("Rewritten prompt"),
            Some("genome_critique"),
            0.02,
        )
        .unwrap();
        assert_eq!(updated.status, STATUS_VARIANT_READY);
        assert_eq!(updated.variant_prompt.as_deref(), Some("Rewritten prompt"));

        let counts = ab::experiment_status_counts(&pool).unwrap();
        assert_eq!(counts, vec![(STATUS_VARIANT_READY.to_string(), 1)]);

        let listed = ab::list_experiments(&pool, Some("p-1"), 10).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(ab::list_experiments(&pool, Some("p-other"), 10).unwrap().is_empty());
    }

    // -- commission gates (no LLM spawned in any of these) -------------------

    fn mk_persona(pool: &DbPool, name: &str) -> String {
        use crate::db::models::CreatePersonaInput;
        personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn mk_director_review(
        pool: &DbPool,
        persona_id: &str,
        with_hypothesis: bool,
        status: crate::db::models::ManualReviewStatus,
    ) -> String {
        use crate::db::models::CreateManualReviewInput;
        use crate::db::repos::communication::manual_reviews;
        use crate::db::repos::execution::executions;

        let exec = executions::create(pool, persona_id, None, None, None, None).unwrap();
        let context = if with_hypothesis {
            r#"{"source":"director","category":"prompt","rationale":"12/20 failed","hypothesis":{"segmentTarget":"s","proposedChange":"c","successMetric":"m","metricSource":"assertions"}}"#
        } else {
            r#"{"source":"director","category":"prompt","hypothesis":null}"#
        };
        let review = manual_reviews::create(
            pool,
            CreateManualReviewInput {
                execution_id: exec.id,
                persona_id: persona_id.into(),
                title: "Tighten the done-line".into(),
                description: None,
                severity: None,
                context_data: Some(context.into()),
                suggested_actions: None,
                use_case_id: None,
                assignment_id: None,
                step_id: None,
            },
        )
        .unwrap();
        if !matches!(status, crate::db::models::ManualReviewStatus::Pending) {
            manual_reviews::update_status(pool, &review.id, status, None).unwrap();
        }
        review.id
    }

    #[test]
    fn load_approved_verdict_enforces_source_status_and_hypothesis() {
        use crate::db::models::ManualReviewStatus;
        let pool = init_test_db().unwrap();
        let pid = mk_persona(&pool, "Gate Target");

        // Pending (not approved) → refused: proposed, not imposed.
        let pending = mk_director_review(&pool, &pid, true, ManualReviewStatus::Pending);
        let err = load_approved_verdict(&pool, &pending).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "pending must not compile");

        // Approved but no hypothesis → refused (plain coaching).
        let plain = mk_director_review(&pool, &pid, false, ManualReviewStatus::Approved);
        let err = load_approved_verdict(&pool, &plain).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "no hypothesis, no experiment");

        // Approved + hypothesis → loads with provenance fields intact.
        let good = mk_director_review(&pool, &pid, true, ManualReviewStatus::Approved);
        let v = load_approved_verdict(&pool, &good).unwrap();
        assert_eq!(v.persona_id, pid);
        assert_eq!(v.hypothesis.proposed_change, "c");
        assert_eq!(v.category, "prompt");

        // Missing row → NotFound.
        assert!(matches!(
            load_approved_verdict(&pool, "nope").unwrap_err(),
            AppError::NotFound(_)
        ));
    }

    /// Dry ledger ⇒ the commission is REGISTERED as a visible
    /// `declined_budget` row (honest refusal), and no LLM call is attempted
    /// (budget 0 short-circuits before materialization).
    #[tokio::test]
    async fn dry_ledger_registers_a_visible_refusal() {
        use crate::db::models::ManualReviewStatus;
        let pool = init_test_db().unwrap();
        let pid = mk_persona(&pool, "Refused Target");
        let review = mk_director_review(&pool, &pid, true, ManualReviewStatus::Approved);

        settings::set(&pool, DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD, "0").unwrap();

        let exp = commission_experiment(&pool, &review).await.unwrap();
        assert_eq!(exp.status, STATUS_DECLINED_BUDGET);
        assert!(exp.status_detail.as_deref().unwrap_or("").contains("dry"));
        assert_eq!(exp.review_id.as_deref(), Some(review.as_str()));

        // The refusal shows up in the campaign report.
        let report = campaign_report(&pool).unwrap();
        assert_eq!(report.declined_budget, 1);
        assert_eq!(report.hypotheses_emitted, 1);
    }
}
