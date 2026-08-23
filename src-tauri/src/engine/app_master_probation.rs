//! **App master probation review** (P4 / kp `docs/concepts/app-master.md` §4.5).
//!
//! An App master starts on probation with the project on `suggest` autopilot.
//! At `tenure.probationDays` a human decides: **activate** (`suggest → full`),
//! **extend** the probation, or **retire**. This module raises that decision as
//! a manual review, and carries the human's answer back to the autopilot mode
//! and to kp.
//!
//! # The rule this file exists to keep
//!
//! > The performance score is a **deterministic backbone** that an LLM narrates
//! > and never rescores.
//!
//! So [`build_packet`] reads counts, rates and flags out of ledgers that already
//! exist and renders them verbatim. The narration under `narration` is a
//! **deterministic rendering of those same numbers** — it restates them in
//! sentences, and it cannot disagree with them because it is generated from
//! them. It is stamped `narrationSource: "deterministic"` so nobody later reads
//! it as a model's judgement.
//!
//! What is NOT here, stated rather than faked: no LLM narrates this packet yet.
//! An LLM pass would add reading, not scoring — and the honest way to add it is
//! as a labelled second field, never by letting it rewrite a number.
//!
//! # Why an unmeasured field stays unmeasured
//!
//! The packet ships whatever the rollup ships, `None`s included (see
//! [`crate::engine::kp_reporter::KpAppMasterRollup`]). A reviewer looking at
//! "proposals merged: not measured" is being told the truth about this build;
//! a reviewer looking at "proposals merged: 0" would be told the App master
//! merged nothing, which nobody established.

use std::time::Duration;

use crate::db::DbPool;

use super::subscription::ReactiveSubscription;

/// How often to look for a probation window that has closed. A probation
/// boundary is a day-scale event, so a 15-minute tick is already an order of
/// magnitude finer than it needs to be — and the tick is a single prefix query
/// when no project carries a mandate.
const TICK: Duration = Duration::from_secs(900);

/// The `context_data.source` the packet is stamped with. `director` is what the
/// manual-review learning path already recognises (`manual_reviews::update_status`
/// sniffs for it), so a probation decision produces the same synthesized
/// memory an ordinary Director verdict does.
pub(crate) const PACKET_SOURCE: &str = "director";

/// Marks the packet as an App master probation review, so the resolution hook
/// can tell one from an ordinary Director coaching review.
pub(crate) const PACKET_KIND: &str = "app_master_probation";

/// Actions offered on the review card. `extend_30` is spelled with its number
/// because the reviewer is choosing a length, not a mode.
pub(crate) const ACTION_ACTIVATE: &str = "activate";
pub(crate) const ACTION_EXTEND_30: &str = "extend_30";
pub(crate) const ACTION_RETIRE: &str = "retire";

/// Days added by [`ACTION_EXTEND_30`].
pub(crate) const EXTEND_DAYS: i64 = 30;

// ---------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------

/// Render the deterministic backbone + its narration for one App master.
pub(crate) fn build_packet(
    pool: &DbPool,
    persona_id: &str,
    persona_name: &str,
    record: &personas_engine::app_master::MandateRecord,
) -> (String, String, String) {
    let persona = crate::db::repos::core::personas::get_by_id(pool, persona_id).ok();
    let design_context = persona.as_ref().and_then(|p| p.design_context.clone());
    let (runs, cost_usd) =
        crate::db::repos::execution::executions::get_monthly_rollup(pool, persona_id)
            .map(|r| (r.runs, r.cost_usd))
            .unwrap_or((0, 0.0));

    let backbone = crate::engine::kp_reporter::app_master_rollup(
        pool,
        design_context.as_deref(),
        runs,
        cost_usd,
    );
    let backbone_json = backbone
        .as_ref()
        .and_then(|b| serde_json::to_value(b).ok())
        .unwrap_or(serde_json::Value::Null);

    let narration = narrate(persona_name, record, backbone.as_ref(), runs);

    let context_data = serde_json::json!({
        "source": PACKET_SOURCE,
        "kind": PACKET_KIND,
        "personaId": persona_id,
        "projectId": record.project_id,
        "probationEndsAt": record.probation_ends_at,
        "mandate": {
            "scopeRung": record.mandate.scope_rung,
            "scopeRungLabel": personas_engine::app_master::rung_label(record.mandate.scope_rung),
            "owner": record.mandate.owner,
            "forbiddenClasses": record.mandate.forbidden_classes
                .iter().map(|c| c.as_str()).collect::<Vec<_>>(),
            "approvalGates": record.mandate.approval_gates,
        },
        "retireCriteria": record.retire_criteria,
        // The deterministic record. Scored in kp by `backbone_score()`; never
        // rescored here and never rescored by whatever reads `narration`.
        "backbone": backbone_json,
        "narration": narration,
        "narrationSource": "deterministic",
    })
    .to_string();

    let suggested_actions = serde_json::json!({
        "actions": [ACTION_ACTIVATE, ACTION_EXTEND_30, ACTION_RETIRE],
    })
    .to_string();

    let title = format!("App master probation review: {persona_name}");
    (title, context_data, suggested_actions)
}

/// Restate the backbone in sentences. Generated FROM the numbers, so it cannot
/// contradict them; every unmeasured input is said to be unmeasured.
fn narrate(
    persona_name: &str,
    record: &personas_engine::app_master::MandateRecord,
    b: Option<&crate::engine::kp_reporter::KpAppMasterRollup>,
    runs: i64,
) -> String {
    let mut out = format!(
        "{persona_name} has reached the end of its probation window (ended {}). \
         It holds rung {} ({}) on project {}.\n\n",
        record.probation_ends_at,
        record.mandate.scope_rung,
        personas_engine::app_master::rung_label(record.mandate.scope_rung),
        record.project_id,
    );
    let Some(b) = b else {
        out.push_str(
            "NO BACKBONE COULD BE READ. The persona carries no App master link, so none of \
             the performance record below exists for it. Treat this as a coverage gap in the \
             hire, not as a poor result.",
        );
        return out;
    };

    out.push_str(&format!("Executions in the current month: {runs}.\n"));
    match b.proposals_opened {
        Some(n) => out.push_str(&format!(
            "Proposals opened: {n} unattended fix session(s) dispatched under the branch-only \
             guardrail.\n"
        )),
        None => out.push_str(
            "Proposals opened: NOT MEASURED — the overnight engine has not run for this \
             project in the window, so there is no dispatch ledger to read.\n",
        ),
    }
    // P5a: these three now come from real ledgers (the proposal reconciler and
    // the gate-run recorder). The narration still has to distinguish a MEASURED
    // zero from an ABSENT reading in words — "nothing merged" and "nobody was
    // watching" are opposite findings that look identical in a number.
    match (b.proposals_merged, b.proposals_reverted) {
        (Some(m), Some(r)) => out.push_str(&format!(
            "Proposals merged: {m}. Proposals reverted: {r}. Both are readings from the \
             proposal ledger: a branch counts as merged when its tip is an ancestor of the \
             project's main branch, and as reverted when a later main-branch commit says so \
             about one of its own commits. A squash merge rewrites the commits and is NOT \
             detected, so this under-reports rather than over-reports delivery.\n"
        )),
        _ => out.push_str(
            "Proposals merged / reverted: NOT MEASURED — no proposal branch has ever been \
             recorded for this project, so there is nothing that could have merged or been \
             reverted. A hole in the instrument, not a zero.\n",
        ),
    }
    match b.gate_pass_rate {
        Some(rate) => out.push_str(&format!(
            "Gate pass rate: {:.0}% on the repository's OWN declared gate commands, run \
             against the proposal branches themselves. A command that timed out or could not \
             be spawned was recorded DID NOT RUN and counted in neither half of the ratio.\n",
            rate * 100.0
        )),
        None => out.push_str(
            "Gate pass rate: NOT MEASURED — no declared gate command actually ran in the \
             window. Either the mandate declares none (which is `not configured`, and not a \
             pass) or every attempt failed to run. With no denominator there is no rate.\n",
        ),
    }
    match b.forbidden_class_violations {
        Some(0) => out.push_str(
            "Forbidden-class violations: 0. This IS a reading — the violation ledger was \
             queried and it is empty.\n",
        ),
        Some(n) => out.push_str(&format!(
            "Forbidden-class violations: {n}. Each was BLOCKED at dispatch and recorded with \
             the matched rule and path; none was silently rewritten. A non-zero count here is \
             the disqualifying signal the mandate exists to surface — read the events before \
             activating.\n"
        )),
        None => out.push_str("Forbidden-class violations: could not be read.\n"),
    }

    match b.kpi_deltas.as_ref() {
        Some(deltas) if !deltas.is_empty() => {
            let measured = deltas.iter().filter(|d| d.measured).count();
            out.push_str(&format!(
                "\nObjectives: {} of {} were measured in the window.\n",
                measured,
                deltas.len()
            ));
            for d in deltas {
                if !d.measured {
                    out.push_str(&format!(
                        "- {}: UNMEASURED — nobody read the meter. A coverage gap, not a \
                         missed target.\n",
                        d.kpi_key
                    ));
                    continue;
                }
                let from = d
                    .baseline
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "an unmeasured baseline".into());
                let now = d
                    .current
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "?".into());
                let target = match d.target {
                    Some(t) => format!(
                        ", target {} {t}",
                        if d.direction == "lte" { "≤" } else { "≥" }
                    ),
                    None => ", no target set".into(),
                };
                out.push_str(&format!(
                    "- {}: {from} → {now}{target} (over {} days)\n",
                    d.kpi_key, d.window_days
                ));
            }
        }
        _ => out.push_str(
            "\nObjectives: none are bound to this project, so there is no value ledger to \
             judge against. That is a gap in the hire.\n",
        ),
    }

    out.push_str("\nBudget: ");
    if b.budget_unmeasured {
        out.push_str(
            "UNMEASURED. Runs were recorded but the engine reported $0 — subscription auth \
             does not meter spend. Do not read this as free.\n",
        );
    } else {
        match (b.budget_reserved_usd, b.budget_settled_usd) {
            (Some(r), Some(s)) => {
                out.push_str(&format!("reserved ${r:.2} at launch, settled ${s:.2}.\n"))
            }
            (None, Some(s)) => out.push_str(&format!(
                "settled ${s:.2}. No reservation was taken — the overnight governor did not \
                 run for this project in the window.\n"
            )),
            _ => out.push_str("could not be read.\n"),
        }
    }

    match b.ledger_consistent {
        Some(true) => out.push_str(
            "Ledger consistency: every dispatched session the night-run ledger claims has a \
             matching task row. The self-report checks out.\n",
        ),
        Some(false) => out.push_str(
            "Ledger consistency: FAILED — the night-run ledger claims a dispatched session \
             that has no task row. The activity record and the proposal record disagree; \
             investigate before activating.\n",
        ),
        None => out.push_str(
            "Ledger consistency: nothing was dispatched in the window, so there is nothing \
             to cross-check.\n",
        ),
    }
    out.push_str(&format!(
        "Autopilot mode right now: {}.\n",
        b.autopilot_mode
    ));

    if !record.retire_criteria.is_empty() {
        out.push_str("\nRetirement criteria written at hire:\n");
        for c in &record.retire_criteria {
            out.push_str(&format!("- {c}\n"));
        }
    }
    out.push_str(
        "\nThese numbers are computed, not judged. Approving activates the App master \
         (autopilot suggest → full); choosing `extend_30` adds 30 days of probation; \
         rejecting, or choosing `retire`, stops it.",
    );
    out
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/// Raise a probation review for every mandate whose window has closed and whose
/// decision has not been taken, exactly once each.
pub(crate) fn probation_tick(pool: &DbPool) {
    let mandates = personas_engine::app_master::load_mandates(pool);
    if mandates.is_empty() {
        return; // one prefix query and out — the overwhelmingly common case.
    }
    let now = chrono::Utc::now();

    for (project_id, mut record) in mandates {
        // Already decided, or a packet is already sitting in the inbox waiting
        // for the human. Raising a second one every 15 minutes would bury the
        // first under copies of itself.
        if record.probation_decided_at.is_some() || record.probation_review_id.is_some() {
            continue;
        }
        let Ok(ends) = chrono::DateTime::parse_from_rfc3339(&record.probation_ends_at) else {
            tracing::warn!(
                project_id,
                probation_ends_at = %record.probation_ends_at,
                "app_master: unparseable probation end; no review can be scheduled"
            );
            continue;
        };
        if now < ends.with_timezone(&chrono::Utc) {
            continue;
        }

        let Ok(persona) = crate::db::repos::core::personas::get_by_id(pool, &record.persona_id)
        else {
            tracing::warn!(
                project_id,
                persona_id = %record.persona_id,
                "app_master: probation is due but the persona is gone; no review raised"
            );
            continue;
        };

        // `persona_manual_reviews.execution_id` is NOT NULL with an FK onto
        // `persona_executions`, so a review needs a run to hang off. An App
        // master that has never executed cannot be filed against one. Deferring
        // is the honest handling: the tick retries, and the operator sees a
        // probation that has not been reviewed rather than a review that
        // silently never happened.
        let latest_execution = crate::db::repos::execution::executions::get_by_persona_id(
            pool,
            &record.persona_id,
            Some(1),
        )
        .ok()
        .and_then(|v| v.into_iter().next());
        let Some(exec) = latest_execution else {
            tracing::warn!(
                project_id,
                persona_id = %record.persona_id,
                "app_master: probation window closed but the App master has never executed — \
                 the review is DEFERRED (a manual review requires an execution to anchor to). \
                 It will be raised as soon as the persona runs once."
            );
            continue;
        };

        let (title, context_data, suggested_actions) =
            build_packet(pool, &record.persona_id, &persona.name, &record);
        match crate::engine::director::create_probation_review(
            pool,
            &record.persona_id,
            &exec.id,
            &title,
            &context_data,
            &suggested_actions,
        ) {
            Ok(review_id) => {
                record.probation_review_id = Some(review_id.clone());
                if let Err(e) = personas_engine::app_master::set_mandate(pool, &record) {
                    // The review exists but the record does not know it. Next
                    // tick would raise a duplicate, so say so loudly.
                    tracing::error!(
                        project_id, review_id, error = %e,
                        "app_master: raised a probation review but could not record it on the \
                         mandate — the next tick may raise a duplicate"
                    );
                }
                tracing::info!(
                    project_id,
                    persona_id = %record.persona_id,
                    review_id,
                    "app_master: raised the probation review"
                );
            }
            Err(e) => tracing::warn!(
                project_id, error = %e,
                "app_master: could not raise the probation review; will retry next tick"
            ),
        }
    }
}

/// Periodic probation-window check. Registered beside the other lifecycle
/// subscriptions in `engine::background::lifecycle`.
pub struct AppMasterProbationSubscription {
    pub pool: DbPool,
}

#[async_trait::async_trait]
impl ReactiveSubscription for AppMasterProbationSubscription {
    fn name(&self) -> &'static str {
        "app_master_probation"
    }

    fn interval(&self) -> Duration {
        TICK
    }

    fn initial_delay(&self) -> Duration {
        // Let launch settle. A probation boundary that passed while the app was
        // closed is still there five minutes later.
        Duration::from_secs(300)
    }

    async fn tick(&self) {
        // The tick is synchronous rusqlite work. It is almost always one empty
        // prefix query, but a hire with a due review reads executions and KPIs,
        // so it goes to the blocking pool rather than parking a runtime worker.
        let pool = self.pool.clone();
        if let Err(e) = tokio::task::spawn_blocking(move || probation_tick(&pool)).await {
            tracing::warn!(error = %e, "app_master_probation: tick task failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::kp_reporter::{KpAppMasterRollup, KpKpiDelta};
    use personas_engine::app_master::{Mandate, MandateRecord};

    fn record() -> MandateRecord {
        MandateRecord {
            persona_id: "p1".into(),
            project_id: "proj1".into(),
            mandate: Mandate {
                scope_rung: 2,
                owner: "ana@example.com".into(),
                ..Default::default()
            },
            probation_ends_at: "2026-09-22T00:00:00+00:00".into(),
            review_cadence_days: 30,
            retire_criteria: vec!["no merged proposal in two windows".into()],
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: None,
        }
    }

    fn backbone() -> KpAppMasterRollup {
        KpAppMasterRollup {
            proposals_opened: Some(7),
            proposals_merged: None,
            proposals_reverted: None,
            gate_pass_rate: None,
            forbidden_class_violations: Some(0),
            kpi_deltas: Some(vec![
                KpKpiDelta {
                    kpi_key: "gate_pass_rate".into(),
                    baseline: Some(0.82),
                    current: Some(0.9),
                    target: Some(0.95),
                    direction: "gte",
                    window_days: 30,
                    measured: true,
                },
                KpKpiDelta {
                    kpi_key: "p95_build_s".into(),
                    baseline: None,
                    current: None,
                    target: Some(120.0),
                    direction: "lte",
                    window_days: 14,
                    measured: false,
                },
            ]),
            budget_reserved_usd: Some(6.0),
            budget_settled_usd: Some(3.5),
            budget_unmeasured: false,
            ledger_consistent: Some(true),
            autopilot_mode: "suggest",
        }
    }

    #[test]
    fn the_narration_never_reports_an_unmeasured_field_as_zero() {
        // The fixture backbone leaves the P5a fields absent — a project whose
        // reconciler has never seen a proposal branch and whose gates have
        // never run. Those must read as holes, not as zeros.
        let n = narrate("kp App Master", &record(), Some(&backbone()), 12);
        assert!(
            n.contains("Proposals merged / reverted: NOT MEASURED"),
            "{n}"
        );
        assert!(n.contains("Gate pass rate: NOT MEASURED"), "{n}");
        assert!(n.contains("hole in the instrument, not a zero"), "{n}");
        // A measured zero is explicitly distinguished from an absent one.
        assert!(
            n.contains("Forbidden-class violations: 0. This IS a reading"),
            "{n}"
        );
        // An unmeasured objective is a coverage gap, not a miss.
        assert!(n.contains("p95_build_s: UNMEASURED"), "{n}");
        assert!(n.contains("not a missed target"), "{n}");
        // A measured objective quotes both ends.
        assert!(n.contains("gate_pass_rate: 0.82 → 0.9"), "{n}");
        assert!(n.contains("1 of 2 were measured"), "{n}");
    }

    #[test]
    fn a_measured_zero_merge_rate_is_narrated_as_a_reading_not_a_hole() {
        // P5a: a project whose reconciler HAS seen proposals and none merged.
        // "0 merged" and "nobody watched" must not read the same.
        let mut b = backbone();
        b.proposals_merged = Some(0);
        b.proposals_reverted = Some(0);
        b.gate_pass_rate = Some(0.0);
        let n = narrate("kp App Master", &record(), Some(&b), 12);
        assert!(
            n.contains("Proposals merged: 0. Proposals reverted: 0."),
            "{n}"
        );
        assert!(
            !n.contains("Proposals merged / reverted: NOT MEASURED"),
            "{n}"
        );
        assert!(n.contains("Gate pass rate: 0%"), "{n}");
        assert!(!n.contains("Gate pass rate: NOT MEASURED"), "{n}");
        // The squash-merge blind spot is stated, not hidden.
        assert!(n.contains("squash merge"), "{n}");
    }

    #[test]
    fn an_unmetered_window_is_narrated_as_unmeasured_not_free() {
        let mut b = backbone();
        b.budget_unmeasured = true;
        b.budget_settled_usd = Some(0.0);
        let n = narrate("x", &record(), Some(&b), 9);
        assert!(n.contains("Budget: UNMEASURED"), "{n}");
        assert!(n.contains("Do not read this as free"), "{n}");
        assert!(!n.contains("settled $0.00"), "{n}");
    }

    #[test]
    fn a_violation_is_narrated_as_the_disqualifying_signal_it_is() {
        let mut b = backbone();
        b.forbidden_class_violations = Some(3);
        let n = narrate("x", &record(), Some(&b), 9);
        assert!(n.contains("Forbidden-class violations: 3"), "{n}");
        assert!(n.contains("BLOCKED at dispatch"), "{n}");
        assert!(n.contains("none was silently rewritten"), "{n}");
        assert!(n.contains("before activating"), "{n}");
    }

    #[test]
    fn a_disagreeing_ledger_is_surfaced_not_smoothed() {
        let mut b = backbone();
        b.ledger_consistent = Some(false);
        let n = narrate("x", &record(), Some(&b), 9);
        assert!(n.contains("Ledger consistency: FAILED"), "{n}");
        assert!(n.contains("disagree"), "{n}");
    }

    #[test]
    fn a_missing_backbone_reads_as_a_coverage_gap_not_a_bad_result() {
        let n = narrate("x", &record(), None, 0);
        assert!(n.contains("NO BACKBONE COULD BE READ"), "{n}");
        assert!(
            n.contains("coverage gap in the hire, not as a poor result"),
            "{n}"
        );
    }

    #[test]
    fn the_narration_states_the_mandate_and_the_three_outcomes() {
        let n = narrate("kp App Master", &record(), Some(&backbone()), 12);
        assert!(n.contains("rung 2 (open branch/PR)"), "{n}");
        assert!(n.contains("no merged proposal in two windows"), "{n}");
        assert!(n.contains("computed, not judged"), "{n}");
        assert!(n.contains("suggest → full"), "{n}");
        assert!(n.contains("extend_30"), "{n}");
        assert!(n.contains("retire"), "{n}");
    }
}
