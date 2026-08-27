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

use tauri::Manager;

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

/// Collect the deterministic backbone for one App master, and the execution
/// count its narration quotes.
///
/// Factored out of [`build_packet`] because the headless anchorless decision
/// ([`headless_probation_sweep`]) has no packet to read a backbone out of and
/// must nevertheless read the SAME numbers — a second collection would be a
/// second thing to keep in sync, and the first time they disagreed the bench
/// and the review card would be deciding different hires.
pub(crate) fn collect_backbone(
    pool: &DbPool,
    persona_id: &str,
) -> (Option<crate::engine::kp_reporter::KpAppMasterRollup>, i64) {
    let persona = crate::db::repos::core::personas::get_by_id(pool, persona_id).ok();
    let design_context = persona.as_ref().and_then(|p| p.design_context.clone());
    let (runs, cost_usd) =
        crate::db::repos::execution::executions::get_monthly_rollup(pool, persona_id)
            .map(|r| (r.runs, r.cost_usd))
            .unwrap_or((0, 0.0));

    // Same call, same window: the packet's numbers are the reporter's numbers,
    // bounded to THIS holder's tenure by the one helper both sides go through
    // (`personas_engine::app_master::tenure_window`). A second collection here
    // would be a second thing to keep in sync — and the first time they
    // disagreed, the review card and the bench would be judging different
    // hires on the same project.
    let backbone = crate::engine::kp_reporter::app_master_rollup(
        pool,
        persona_id,
        design_context.as_deref(),
        runs,
        cost_usd,
    );
    (backbone, runs)
}

/// Render the deterministic backbone + its narration for one App master.
pub(crate) fn build_packet(
    pool: &DbPool,
    persona_id: &str,
    persona_name: &str,
    record: &personas_engine::app_master::MandateRecord,
) -> (String, String, String) {
    let (backbone, runs) = collect_backbone(pool, persona_id);
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

/// A sha as a human reads it. Bounded to 12 characters, and never padded — a
/// short sha stays exactly as short as it was recorded.
fn short_sha(sha: &str) -> &str {
    let sha = sha.trim();
    match sha.char_indices().nth(12) {
        Some((idx, _)) => &sha[..idx],
        None => sha,
    }
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
            "Proposals opened: {n}. This counts proposal BRANCHES the reconciler observed in \
             the window carrying at least one commit ahead of the main branch — work that \
             exists. A dispatched session that authored nothing, and a branch with no commits \
             on it, are both excluded.\n"
        )),
        None => out.push_str(
            "Proposals opened: NOT MEASURED — no proposal branch has ever been recorded for \
             this holder, so there is no ledger to read. A hole in the instrument, not a \
             zero.\n",
        ),
    }
    match b.sessions_dispatched {
        Some(n) => out.push_str(&format!(
            "Sessions dispatched: {n} unattended fix session(s) launched under the branch-only \
             guardrail. This is a LAUNCH count and no part of the delivery reading — a gap \
             against proposals opened means either a session that delivered nothing or a \
             reconcile that has not settled the night yet.\n"
        )),
        None => out.push_str(
            "Sessions dispatched: NOT MEASURED — the overnight engine has not run for this \
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
            "Gate pass rate: {:.0}% on the gates this holder is ANSWERABLE for — the \
             repository's own declared gate commands, run against the proposal branches \
             themselves. Counted in neither half of the ratio: a command that timed out or \
             could not be spawned (DID NOT RUN), and a command that was already failing on the \
             main branch before the proposal existed (INHERITED RED).\n",
            rate * 100.0
        )),
        None => out.push_str(
            "Gate pass rate: NOT MEASURED — no declared gate command this holder is answerable \
             for actually ran in the window. Either the mandate declares none (which is `not \
             configured`, and not a pass), or every attempt failed to run, or every one that \
             failed was already red on the main branch. With no denominator there is no rate.\n",
        ),
    }
    // The debt does not disappear because it was excluded from the rate above.
    match b.baseline_gate_health.as_ref() {
        Some(h) => out.push_str(&format!(
            "The repository's OWN gates on its main branch (tip {}, read {}): {} of {} green, \
             {} red, {} could not be run. A proposal is judged against this, not against zero \
             — and a red one here is the repository's debt to fix, not the holder's record.\n",
            short_sha(&h.tip_sha),
            h.ran_at,
            h.passed,
            h.commands,
            h.failed,
            h.commands - h.passed - h.failed,
        )),
        None => out.push_str(
            "The repository's OWN gates on its main branch: NOT MEASURED — no baseline sweep \
             has run for this project, so nothing was excluded from the rate above and every \
             gate failure in it was attributed to the holder.\n",
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

/// What one probation pass did. Returned so the headless bridge's on-demand
/// tick (`docs/architecture/cloud-integration-bridge.md` §13) can report the
/// reviews it raised AND the ones it deliberately did not — a deferred review
/// (the App master has never executed) is a finding, not a no-op.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProbationSummary {
    /// Projects carrying a mandate.
    pub mandates: usize,
    /// Probation windows that had closed and had no decision yet.
    pub due: usize,
    /// Review packets filed this pass.
    pub raised: usize,
    /// Due, but no packet could be filed (no persona, no execution to anchor
    /// to, an unparseable end date). Each carries its reason in `notes`.
    pub deferred: usize,
    pub notes: Vec<String>,
}

/// Raise a probation review for every mandate whose window has closed and whose
/// decision has not been taken, exactly once each.
pub(crate) fn probation_tick(pool: &DbPool) {
    let _ = probation_tick_summary(pool);
}

/// [`probation_tick`], counted.
pub(crate) fn probation_tick_summary(pool: &DbPool) -> ProbationSummary {
    probation_tick_summary_with(pool, false, ProbationScope::default())
}

/// `force_due` (headless bench only — the tick endpoint's `forceProbation`)
/// treats every undecided mandate as due NOW, so a test can exercise the
/// probation decision without waiting out `probationDays` of wall clock.
/// Everything else — the no-double-raise guard, the needs-an-execution
/// deferral, the decision policy — is exactly the production path.
/// Scope for a bench tick: when either field is set, FORCING and DECIDING are
/// confined to the matching mandate — a scenario's forced probation must never
/// decide another project's hire. Sweep #21 (2026-08-26): personas-self's
/// forced final phase retired the KP project's fresh hire (streak 1→2) and the
/// driver mis-attributed the decision. `None`/`None` = unscoped (the
/// background tick), which forces nothing and decides whatever is naturally
/// due or raised.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct ProbationScope<'a> {
    pub project_id: Option<&'a str>,
    pub persona_id: Option<&'a str>,
}

impl ProbationScope<'_> {
    fn matches(&self, project_id: &str, persona_id: &str) -> bool {
        match (self.project_id, self.persona_id) {
            (None, None) => true,
            (p, pe) => p == Some(project_id) || pe == Some(persona_id),
        }
    }
    fn scoped(&self) -> bool {
        self.project_id.is_some() || self.persona_id.is_some()
    }
}

pub(crate) fn probation_tick_summary_with(
    pool: &DbPool,
    force_due: bool,
    scope: ProbationScope<'_>,
) -> ProbationSummary {
    let mut summary = ProbationSummary::default();
    let mandates = personas_engine::app_master::load_mandates(pool);
    if mandates.is_empty() {
        return summary; // one prefix query and out — the common case.
    }
    summary.mandates = mandates.len();
    let now = chrono::Utc::now();

    for (project_id, mut record) in mandates {
        // Already decided, or a packet is already sitting in the inbox waiting
        // for the human. Raising a second one every 15 minutes would bury the
        // first under copies of itself.
        if record.probation_decided_at.is_some() || record.probation_review_id.is_some() {
            continue;
        }
        if scope.scoped() && !scope.matches(&project_id, &record.persona_id) {
            continue; // another project's hire — not this tick's business
        }
        let Ok(ends) = chrono::DateTime::parse_from_rfc3339(&record.probation_ends_at) else {
            tracing::warn!(
                project_id,
                probation_ends_at = %record.probation_ends_at,
                "app_master: unparseable probation end; no review can be scheduled"
            );
            summary.deferred += 1;
            summary.notes.push(format!(
                "{project_id}: unparseable probation end `{}`",
                record.probation_ends_at
            ));
            continue;
        };
        let forced = force_due && scope.matches(&project_id, &record.persona_id);
        if !forced && now < ends.with_timezone(&chrono::Utc) {
            continue;
        }
        summary.due += 1;

        let Ok(persona) = crate::db::repos::core::personas::get_by_id(pool, &record.persona_id)
        else {
            tracing::warn!(
                project_id,
                persona_id = %record.persona_id,
                "app_master: probation is due but the persona is gone; no review raised"
            );
            summary.deferred += 1;
            summary.notes.push(format!(
                "{project_id}: persona {} is gone",
                record.persona_id
            ));
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
            summary.deferred += 1;
            summary.notes.push(format!(
                "{project_id}: DEFERRED — the App master has never executed, and a manual                  review needs an execution to anchor to"
            ));
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
                summary.raised += 1;
                tracing::info!(
                    project_id,
                    persona_id = %record.persona_id,
                    review_id,
                    "app_master: raised the probation review"
                );
            }
            Err(e) => {
                summary.deferred += 1;
                summary
                    .notes
                    .push(format!("{project_id}: could not raise the review: {e}"));
                tracing::warn!(
                    project_id, error = %e,
                    "app_master: could not raise the probation review; will retry next tick"
                );
            }
        }
    }
    summary
}

// ---------------------------------------------------------------------------
// The headless-bridge decision sweep (test mode)
// ---------------------------------------------------------------------------

/// One review this sweep answered.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HeadlessProbationOutcome {
    pub project_id: String,
    pub persona_id: String,
    /// The review this decision answered. `None` on the anchorless path, where
    /// there deliberately is no review row — see `anchor`.
    pub review_id: Option<String>,
    /// What the decision hung off: `review` (a raised packet a human could have
    /// read) or `none` (the backbone directly, because the persona has never
    /// executed and `persona_manual_reviews.execution_id` cannot be satisfied).
    /// A bench must be able to tell those apart without inferring it from a
    /// null id.
    pub anchor: &'static str,
    /// kp's three-valued verdict over the packet's own backbone.
    pub verdict: String,
    /// `activated` | `extended` | `retired`.
    pub decision: String,
    /// Consecutive `incomplete` extensions before this decision.
    pub prior_incomplete_streak: u32,
    /// Which of the six backbone rules had no reading. An `incomplete` verdict
    /// is only actionable if the operator can see WHAT was not measured.
    pub unmeasured: Vec<String>,
}

/// Answer every raised-but-undecided probation review, deterministically, with
/// no human in the loop. Caller must have checked
/// `personas_engine::headless::enabled()`.
///
/// The decision is taken from the packet's **own** backbone — the same numbers
/// the human would read — through `personas_engine::headless::backbone_verdict`,
/// a verdict-only port of kp's `backbone_score`. It is then applied through
/// `react_to_app_master_probation`, the same function the human's click
/// reaches, so the headless mode changes *who decides*, never *what a decision
/// does*.
///
/// Termination: `incomplete` extends, and an extension ends nothing. The second
/// consecutive `incomplete` therefore retires
/// (`headless::headless_probation_decision`), and the streak is recorded on the
/// mandate by the carry-out itself (which reloads the record, so writing it
/// from here would be silently clobbered).
///
/// Two paths, one decision policy:
///
/// * **anchored** — a review row exists; it is answered on the human path's own
///   transition and then carried out.
/// * **anchorless** — no review row exists and none ever can, because the App
///   master has never executed and `persona_manual_reviews.execution_id` is NOT
///   NULL with an FK onto `persona_executions`. That is a legitimate probation
///   state: an Overnight that dispatched nothing leaves exactly this record.
///   Production defers it, honestly. Headless decides it from the backbone
///   directly ([`anchorless_probation_sweep`]) — otherwise every bench
///   probation returns no decision and the loop it exists to prove never
///   closes.
pub(crate) fn headless_probation_sweep(
    app: &tauri::AppHandle,
    pool: &DbPool,
    force_due: bool,
    scope: ProbationScope<'_>,
) -> Vec<HeadlessProbationOutcome> {
    use personas_engine::headless;

    let mut out = Vec::new();
    for (project_id, record) in personas_engine::app_master::load_mandates(pool) {
        if record.probation_decided_at.is_some() {
            continue;
        }
        if scope.scoped() && !scope.matches(&project_id, &record.persona_id) {
            continue; // out of this tick's scope — never decide another hire
        }
        let Some(review_id) = record.probation_review_id.clone() else {
            continue; // nothing has been raised for this hire yet
        };
        let review =
            match crate::db::repos::communication::manual_reviews::get_by_id(pool, &review_id) {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!(project_id, review_id, error = %e,
                    "headless bridge: probation review row unreadable; leaving it undecided");
                    continue;
                }
            };
        if !matches!(
            review.status,
            crate::db::models::ManualReviewStatus::Pending
        ) {
            continue; // somebody already answered it
        }

        let ctx: serde_json::Value = review
            .context_data
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);
        let backbone = ctx
            .get("backbone")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let reading = headless::backbone_reading_from_json(&backbone);
        let verdict = headless::backbone_verdict(&reading);
        let unmeasured: Vec<String> = headless::unmeasured_rules(&reading)
            .into_iter()
            .map(str::to_string)
            .collect();
        let decision =
            headless::headless_probation_decision(verdict, record.headless_incomplete_streak);

        tracing::warn!(
            project_id,
            review_id,
            verdict = verdict.as_str(),
            decision = decision.outcome(),
            streak = record.headless_incomplete_streak,
            actor = headless::ACTOR,
            "HEADLESS BRIDGE: deciding an App master probation review with NO human in the loop"
        );

        // Mark the review answered on the same path a human answers it, then
        // apply the decision through the shared carry-out.
        if let Err(e) = crate::db::repos::communication::manual_reviews::update_status(
            pool,
            &review_id,
            crate::db::models::ManualReviewStatus::Approved,
            Some(format!(
                "{}: chose action `{}` from a `{}` backbone verdict",
                headless::ACTOR,
                decision.action(),
                verdict.as_str()
            )),
        ) {
            tracing::warn!(project_id, review_id, error = %e,
                "headless bridge: could not resolve the probation review; not applying a decision");
            continue;
        }
        let review =
            match crate::db::repos::communication::manual_reviews::get_by_id(pool, &review_id) {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!(project_id, review_id, error = %e,
                    "headless bridge: probation review vanished mid-decision");
                    continue;
                }
            };
        let state = app.state::<std::sync::Arc<crate::AppState>>();
        let applied = crate::commands::design::reviews::react_to_app_master_probation(
            &state,
            &review,
            Some(decision.action()),
            // The streak rides through to the carry-out, which is the one place
            // that writes it — it reloads the mandate record, so anything
            // stamped here beforehand would be clobbered.
            Some(match verdict {
                headless::BackboneVerdict::Incomplete => record.headless_incomplete_streak + 1,
                _ => 0,
            }),
        );
        if !applied {
            tracing::warn!(
                project_id,
                review_id,
                "headless bridge: the probation packet was not recognised; nothing applied"
            );
            continue;
        }

        out.push(HeadlessProbationOutcome {
            project_id: project_id.clone(),
            persona_id: record.persona_id.clone(),
            review_id: Some(review_id),
            anchor: headless::ANCHOR_REVIEW,
            verdict: verdict.as_str().to_string(),
            decision: decision.outcome().to_string(),
            prior_incomplete_streak: record.headless_incomplete_streak,
            unmeasured,
        });
    }

    out.extend(anchorless_probation_sweep(app, pool, force_due, scope));
    out
}

/// Decide the mandates the review path can never reach: due (or forced) and
/// **never executed**, so no `persona_manual_reviews` row can be filed against
/// them at all.
///
/// The gate is `headless::anchorless_probation_allowed` — one predicate, unit
/// tested in `personas-engine`, that refuses this behaviour outside the bridge,
/// refuses it for a persona that HAS an execution (that one is anchorable, so
/// it must be anchored) and refuses it while the window is still open unless
/// the bench forced it.
///
/// Everything downstream of the verdict is the shared carry-out, so an
/// anchorless decision and a human's click change exactly the same things. What
/// it does NOT do is invent a review row: no packet is written, no learned
/// memory is synthesised, and the kp lifecycle note says in words that no human
/// read it.
fn anchorless_probation_sweep(
    app: &tauri::AppHandle,
    pool: &DbPool,
    force_due: bool,
    scope: ProbationScope<'_>,
) -> Vec<HeadlessProbationOutcome> {
    use personas_engine::headless;

    let mut out = Vec::new();
    let now = chrono::Utc::now();
    for (project_id, record) in personas_engine::app_master::load_mandates(pool) {
        if record.probation_decided_at.is_some() {
            continue;
        }
        if scope.scoped() && !scope.matches(&project_id, &record.persona_id) {
            continue; // out of this tick's scope — never decide another hire
        }
        let window_closed = chrono::DateTime::parse_from_rfc3339(&record.probation_ends_at)
            .map(|ends| now >= ends.with_timezone(&chrono::Utc))
            .unwrap_or(false);
        // Re-checked here rather than inferred from the raise pass's `notes`: a
        // deferral reason parsed out of a log line is not a fact about the
        // database.
        let has_execution = crate::db::repos::execution::executions::get_by_persona_id(
            pool,
            &record.persona_id,
            Some(1),
        )
        .map(|rows| !rows.is_empty())
        .unwrap_or(true); // unreadable ⇒ assume anchorable, and decide nothing
        if !headless::anchorless_probation_allowed(
            headless::enabled(),
            force_due,
            window_closed,
            record.probation_review_id.is_some(),
            has_execution,
        ) {
            continue;
        }
        // The raise path defers a vanished persona too; so does this one.
        let Ok(persona) = crate::db::repos::core::personas::get_by_id(pool, &record.persona_id)
        else {
            continue;
        };

        let (backbone, _runs) = collect_backbone(pool, &record.persona_id);
        let backbone_json = backbone
            .as_ref()
            .and_then(|b| serde_json::to_value(b).ok())
            .unwrap_or(serde_json::Value::Null);
        let reading = headless::backbone_reading_from_json(&backbone_json);
        let verdict = headless::backbone_verdict(&reading);
        let unmeasured: Vec<String> = headless::unmeasured_rules(&reading)
            .into_iter()
            .map(str::to_string)
            .collect();
        let decision =
            headless::headless_probation_decision(verdict, record.headless_incomplete_streak);

        tracing::warn!(
            project_id,
            persona_id = %record.persona_id,
            persona = %persona.name,
            verdict = verdict.as_str(),
            decision = decision.outcome(),
            streak = record.headless_incomplete_streak,
            actor = headless::ACTOR,
            anchor = headless::ANCHOR_NONE,
            "HEADLESS BRIDGE: deciding an App master probation with NO human in the loop AND NO \
             review row — the persona has never executed, so no review could be anchored to one"
        );

        let state = app.state::<std::sync::Arc<crate::AppState>>();
        let applied = crate::commands::design::reviews::apply_app_master_probation_decision(
            &state,
            crate::commands::design::reviews::ProbationCarryOut {
                project_id: &project_id,
                decision: decision.outcome(),
                note: Some(headless::anchorless_probation_note(
                    decision.outcome(),
                    verdict.as_str(),
                )),
                headless_incomplete_streak: Some(match verdict {
                    headless::BackboneVerdict::Incomplete => record.headless_incomplete_streak + 1,
                    _ => 0,
                }),
                review_id: None,
            },
        );
        if !applied {
            tracing::warn!(
                project_id,
                "headless bridge: the mandate vanished mid-decision; nothing applied"
            );
            continue;
        }

        out.push(HeadlessProbationOutcome {
            project_id: project_id.clone(),
            persona_id: record.persona_id.clone(),
            review_id: None,
            anchor: headless::ANCHOR_NONE,
            verdict: verdict.as_str().to_string(),
            decision: decision.outcome().to_string(),
            prior_incomplete_streak: record.headless_incomplete_streak,
            unmeasured,
        });
    }
    out
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
            hired_at: "2026-08-23T00:00:00+00:00".into(),
            review_cadence_days: 30,
            budget_monthly_usd: None,
            retire_criteria: vec!["no merged proposal in two windows".into()],
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: None,
            headless_incomplete_streak: 0,
        }
    }

    fn backbone() -> KpAppMasterRollup {
        KpAppMasterRollup {
            proposals_opened: Some(7),
            sessions_dispatched: Some(9),
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
            // No baseline sweep has run for this fixture's project — which the
            // narration must say, because it means nothing was excluded from
            // the rate on the holder's behalf.
            baseline_gate_health: None,
            // M3b: the probation narration says nothing about memory, so the
            // fixture leaves it unmeasured rather than asserting a shape the
            // narrator does not read.
            memory: None,
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

    /// Sweep #25: the repository's own gate debt is narrated beside the
    /// holder's rate — and its ABSENCE is narrated too, because "nothing was
    /// excluded" changes how the rate above should be read.
    #[test]
    fn the_repositorys_own_gate_debt_is_narrated_beside_the_holders_rate() {
        let mut b = backbone();
        b.gate_pass_rate = Some(1.0);
        b.baseline_gate_health = Some(personas_engine::app_master_gates::BaselineGateHealth {
            commands: 9,
            passed: 7,
            failed: 2,
            tip_sha: "abc1234def5678901234".into(),
            ran_at: "2026-08-26T21:00:00+00:00".into(),
        });
        let n = narrate("kp App Master", &record(), Some(&b), 12);
        assert!(n.contains("7 of 9 green, 2 red, 0 could not be run"), "{n}");
        // Long shas are shortened for a human, and not padded.
        assert!(n.contains("tip abc1234def56"), "{n}");
        assert!(n.contains("the repository's debt to fix"), "{n}");
        // The exclusion is disclosed on the rate line itself.
        assert!(n.contains("INHERITED RED"), "{n}");

        // With no baseline, the packet says so rather than implying one.
        let n = narrate("kp App Master", &record(), Some(&backbone()), 12);
        assert!(n.contains("gates on its main branch: NOT MEASURED"), "{n}");
        assert!(
            n.contains("every gate failure in it was attributed to the holder"),
            "{n}"
        );
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
