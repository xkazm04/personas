//! Self-Evolving Team v1 — the nervous system between assignments and the
//! team's future behaviour.
//!
//! When an assignment reaches a terminal status the orchestrator calls
//! `on_assignment_terminal`, which:
//!
//! 1. **Records** a structured `assignment_outcome` (per-step persona,
//!    strategy, confidence, duration, result, review interventions) — the raw
//!    learning signal, idempotent per assignment.
//! 2. **Updates trust** per matched persona with a Brier-style updater: the
//!    persona's team-scoped trust moves toward `1 - (confidence - outcome)²`
//!    under an EMA (the decay), hard-clamped at [`TRUST_FLOOR`], so a few
//!    unlucky runs can NEVER death-spiral a persona off the roster (unit
//!    tested below). `team_assignment_matching` overlays this score when
//!    routing future steps for the same team.
//! 3. **Convenes a retrospective** — a `team_deliberation` seeded with the
//!    outcome record and a failed/reviewed-step agenda, run to a SMALL fixed
//!    budget ([`RETRO_BUDGET_USD`] + [`RETRO_MAX_ROUNDS`]) via the existing
//!    moderator tick. Skipped (honestly, with a recorded reason) for trivial
//!    runs: fewer than 3 steps and zero failures/interventions.
//! 4. **Distills lessons** — the retro's resolved agenda items land in
//!    `team_memories` tagged `lesson,retrospective` with provenance, and the
//!    matching prompt retrieves them as a "team lessons" section.
//!
//! ## Feedback-loop hygiene
//! The outcome record is written BEFORE the retrospective convenes, so retro
//! turns can never appear in their own evidence. Retro turns are ordinary
//! deliberation turns (`consumer='display'`) — they are never injected into
//! persona step prompts. The retro deliberation is tagged
//! `created_by='retrospective'` so any future evidence miner can exclude it.

use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::db::models::{CreateDeliberationInput, CreateTeamMemoryInput, TeamAssignmentStep};
use crate::db::repos::orchestration::assignment_outcomes as outcome_repo;
use crate::db::repos::orchestration::assignment_outcomes::RecordOutcomeInput;
use crate::db::repos::orchestration::team_assignments as assignment_repo;
use crate::db::repos::resources::deliberation as delib_repo;
use crate::db::repos::resources::team_channel as channel_repo;
use crate::db::repos::resources::team_memories as team_memory_repo;
use crate::db::DbPool;

// ----------------------------------------------------------------------------
// Tunables
// ----------------------------------------------------------------------------

/// EMA weight of ONE new step outcome on the persona's team trust. 0.25 means
/// old evidence decays with a half-life of ~2.4 samples — recent behaviour
/// dominates, but no single run can move the score more than a quarter of the
/// way to its sample score.
pub const TRUST_ALPHA: f64 = 0.25;

/// Hard floor on team-scoped trust. A persona that fails repeatedly converges
/// here and NO LOWER — it stays matchable (trust informs routing; eligibility
/// is governed separately by `trust_level`/enabled), and a couple of good runs
/// lift it back. This is the anti-death-spiral guarantee.
pub const TRUST_FLOOR: f64 = 0.15;

/// Neutral prior for a persona with no team trust history and no usable
/// global trust score.
pub const TRUST_DEFAULT: f64 = 0.5;

/// Hard cost cap on one retrospective deliberation (moderator + persona
/// turns). The deliberation engine's own floor-breach check enforces it.
pub const RETRO_BUDGET_USD: f64 = 0.5;

/// Maximum moderated rounds the terminal hook drives synchronously. After the
/// cap the retro is finalized with whatever the agenda resolved — a retro
/// must never outlive its assignment's news cycle.
pub const RETRO_MAX_ROUNDS: usize = 3;

/// Retrospectives are skipped for trivial runs: fewer than this many steps
/// AND zero failures/interventions.
pub const RETRO_MIN_STEPS: usize = 3;

/// At most this many lessons are distilled from one retrospective.
pub const RETRO_MAX_LESSONS: usize = 3;

/// At most this many failed/reviewed steps become agenda items (plus the
/// standing "what do we change" item).
const RETRO_MAX_AGENDA_STEPS: usize = 4;

// ----------------------------------------------------------------------------
// Pure logic (unit-tested)
// ----------------------------------------------------------------------------

/// Brier-style trust update with decay and a floor.
///
/// The sample score is `1 - (confidence - outcome)²` — an OVERCONFIDENT
/// failure (c≈1, o=0) scores near 0, a calibrated-uncertain failure (c≈0.5)
/// scores 0.75, a confident success scores near 1. The new trust is an EMA of
/// the previous trust and the sample score (`TRUST_ALPHA` = decay), clamped
/// to `[TRUST_FLOOR, 1.0]`.
pub fn brier_trust_update(prev: f64, confidence: Option<f64>, success: bool) -> f64 {
    let c = confidence.unwrap_or(TRUST_DEFAULT).clamp(0.0, 1.0);
    let outcome = if success { 1.0 } else { 0.0 };
    let sample_score = 1.0 - (c - outcome).powi(2);
    let prev = prev.clamp(TRUST_FLOOR, 1.0);
    (prev * (1.0 - TRUST_ALPHA) + sample_score * TRUST_ALPHA).clamp(TRUST_FLOOR, 1.0)
}

/// Should this run get a retrospective? Trivial runs — short AND clean — are
/// skipped so the team doesn't spend tokens deliberating about nothing.
pub fn retrospective_needed(steps_total: usize, steps_failed: usize, interventions: usize) -> bool {
    steps_total >= RETRO_MIN_STEPS || steps_failed > 0 || interventions > 0
}

/// Seed trust for a persona's first team-scoped sample: reuse the global
/// trust score when it carries signal, else the neutral prior.
pub fn seed_trust(global_trust_score: f64) -> f64 {
    if global_trust_score > 0.0 && global_trust_score <= 1.0 {
        global_trust_score.clamp(TRUST_FLOOR, 1.0)
    } else {
        TRUST_DEFAULT
    }
}

fn step_duration_secs(step: &TeamAssignmentStep) -> Option<i64> {
    let start = step.started_at.as_deref()?;
    let end = step.completed_at.as_deref()?;
    let parse = |s: &str| {
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
            .ok()
    };
    Some((parse(end)? - parse(start)?).num_seconds().max(0))
}

/// A step that demanded human/QA attention: it failed, or it went through at
/// least one retry/rework round.
fn step_was_reviewed(step: &TeamAssignmentStep) -> bool {
    step.status == "failed" || step.retry_count > 0
}

/// Build the per-step evidence array for `outcome_json`.
pub fn build_step_evidence(steps: &[TeamAssignmentStep], strategy: &str) -> Vec<serde_json::Value> {
    steps
        .iter()
        .map(|s| {
            json!({
                "stepId": s.id,
                "title": s.title,
                "personaId": s.assigned_persona_id,
                "strategy": strategy,
                "confidence": s.match_confidence,
                "durationSecs": step_duration_secs(s),
                "result": s.status,
                "retryCount": s.retry_count,
            })
        })
        .collect()
}

// ----------------------------------------------------------------------------
// The terminal hook
// ----------------------------------------------------------------------------

/// Fire-and-forget entry point for the orchestrator: record + learn + retro.
/// Never fails the caller — every error is logged and swallowed.
pub fn spawn_on_terminal(
    pool: Arc<DbPool>,
    app: AppHandle,
    assignment_id: String,
    final_status: String,
) {
    tokio::spawn(async move {
        if let Err(e) = on_assignment_terminal(&pool, &app, &assignment_id, &final_status).await {
            tracing::warn!(
                assignment_id = %assignment_id,
                error = %e,
                "team learning: terminal hook failed"
            );
        }
    });
}

async fn on_assignment_terminal(
    pool: &Arc<DbPool>,
    app: &AppHandle,
    assignment_id: &str,
    final_status: &str,
) -> Result<(), crate::error::AppError> {
    let assignment = assignment_repo::get_by_id(pool, assignment_id)?;
    let steps = assignment_repo::list_steps(pool, assignment_id)?;

    let steps_total = steps.len();
    let steps_done = steps.iter().filter(|s| s.status == "done").count();
    let steps_failed = steps.iter().filter(|s| s.status == "failed").count();
    let steps_skipped = steps.iter().filter(|s| s.status == "skipped").count();
    let interventions = steps.iter().filter(|s| step_was_reviewed(s)).count();

    let duration_secs = match (
        assignment.started_at.as_deref(),
        assignment.completed_at.as_deref(),
    ) {
        (Some(start), Some(end)) => {
            let parse = |s: &str| {
                chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                    .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
                    .ok()
            };
            match (parse(start), parse(end)) {
                (Some(a), Some(b)) => Some((b - a).num_seconds().max(0)),
                _ => None,
            }
        }
        _ => None,
    };

    let mut step_evidence = build_step_evidence(&steps, &assignment.match_strategy);
    let outcome_json =
        json!({ "steps": serde_json::Value::Array(step_evidence.clone()) }).to_string();

    // 1. Record — idempotent. If the row already exists this terminal
    // transition already learned (or a restart re-fired the hook): stop, so
    // trust is never double-counted.
    let inserted = outcome_repo::record_outcome(
        pool,
        &RecordOutcomeInput {
            assignment_id,
            team_id: &assignment.team_id,
            status: final_status,
            steps_total: steps_total as i32,
            steps_done: steps_done as i32,
            steps_failed: steps_failed as i32,
            steps_skipped: steps_skipped as i32,
            review_interventions: interventions as i32,
            duration_secs,
            outcome_json: &outcome_json,
        },
    )?;
    if !inserted {
        tracing::debug!(
            assignment_id,
            "team learning: outcome already recorded — skipping"
        );
        return Ok(());
    }
    let _ = assignment_repo::insert_event(
        pool,
        assignment_id,
        None,
        "outcome_recorded",
        Some(
            &json!({
                "status": final_status,
                "stepsTotal": steps_total,
                "stepsFailed": steps_failed,
                "reviewInterventions": interventions,
            })
            .to_string(),
        ),
    );

    // 2. Trust feedback — one Brier sample per terminal step with a matched
    // persona. Skipped steps carry no outcome signal.
    for (idx, step) in steps.iter().enumerate() {
        let Some(pid) = step.assigned_persona_id.as_deref() else {
            continue;
        };
        let success = match step.status.as_str() {
            "done" => true,
            "failed" => false,
            _ => continue,
        };
        let (prev, samples) = match outcome_repo::get_trust(pool, &assignment.team_id, pid)? {
            Some(t) => (t.trust, t.samples),
            None => {
                let global = crate::db::repos::core::personas::get_by_id(pool, pid)
                    .map(|p| p.trust_score)
                    .unwrap_or(0.0);
                (seed_trust(global), 0)
            }
        };
        let next = brier_trust_update(prev, step.match_confidence, success);
        outcome_repo::upsert_trust(pool, &assignment.team_id, pid, next, samples + 1)?;
        if let Some(ev) = step_evidence.get_mut(idx) {
            ev["trustBefore"] = json!((prev * 1000.0).round() / 1000.0);
            ev["trustAfter"] = json!((next * 1000.0).round() / 1000.0);
        }
    }
    // Enrich the stored evidence with the trust deltas (the UI's evidence drawer).
    let _ = outcome_repo::set_outcome_json(
        pool,
        assignment_id,
        &json!({ "steps": serde_json::Value::Array(step_evidence) }).to_string(),
    );

    // 3. Retrospective — skipped honestly for trivial or aborted runs.
    if final_status == "aborted" {
        outcome_repo::set_retro(pool, assignment_id, None, Some("aborted"))?;
        return Ok(());
    }
    if !retrospective_needed(steps_total, steps_failed, interventions) {
        outcome_repo::set_retro(pool, assignment_id, None, Some("trivial_run"))?;
        return Ok(());
    }
    run_retrospective(
        pool,
        app,
        &assignment.team_id,
        assignment_id,
        &assignment.title,
        &steps,
    )
    .await
}

async fn run_retrospective(
    pool: &Arc<DbPool>,
    app: &AppHandle,
    team_id: &str,
    assignment_id: &str,
    assignment_title: &str,
    steps: &[TeamAssignmentStep],
) -> Result<(), crate::error::AppError> {
    // The DB enforces one active deliberation per team — if the slot is taken
    // the retro is skipped (recorded, not silently dropped).
    let delib = match delib_repo::create(
        pool,
        CreateDeliberationInput {
            team_id: team_id.to_string(),
            topic: format!("Retrospective: {assignment_title}"),
            goal: Some(
                "Distill 1-3 concrete, reusable lessons from this assignment's outcome — \
                 what should this team do differently on the next one?"
                    .into(),
            ),
            created_by: Some("retrospective".into()),
            cost_budget_usd: Some(RETRO_BUDGET_USD),
            idle_deadline: None,
            parent_id: None,
            roster_ids: None,
        },
    ) {
        Ok(d) => d,
        Err(e) => {
            tracing::info!(
                assignment_id,
                error = %e,
                "team learning: retrospective skipped — could not open deliberation (likely an active one holds the team slot)"
            );
            outcome_repo::set_retro(pool, assignment_id, None, Some("active_deliberation"))?;
            return Ok(());
        }
    };
    outcome_repo::set_retro(pool, assignment_id, Some(&delib.id), None)?;

    // Agenda: each failed/reviewed step (capped) + the standing improvement item.
    let mut problem_steps = 0usize;
    for s in steps.iter().filter(|s| step_was_reviewed(s)) {
        if problem_steps >= RETRO_MAX_AGENDA_STEPS {
            break;
        }
        let label = match s.status.as_str() {
            "failed" => format!(
                "Step failed: \"{}\" — why, and how do we prevent it?",
                s.title
            ),
            _ => format!(
                "Step \"{}\" needed {} rework round(s) — what caused the bounce?",
                s.title, s.retry_count
            ),
        };
        let _ = delib_repo::add_agenda_item(pool, &delib.id, &label, Some("moderator"));
        problem_steps += 1;
    }
    let _ = delib_repo::add_agenda_item(
        pool,
        &delib.id,
        "What is the ONE change that most improves the team's next assignment?",
        Some("moderator"),
    );

    // Seed turn: the outcome record, in prose the roster can deliberate over.
    // Tagged RETROSPECTIVE and posted AFTER the outcome row exists — retro
    // turns can never enter their own evidence.
    let done = steps.iter().filter(|s| s.status == "done").count();
    let failed = steps.iter().filter(|s| s.status == "failed").count();
    let mut seed = format!(
        "RETROSPECTIVE (auto) — assignment \"{}\" finished: {}/{} steps done, {} failed.\n",
        assignment_title,
        done,
        steps.len(),
        failed,
    );
    for s in steps {
        seed.push_str(&format!(
            "- [{}] {}{}{}\n",
            s.status,
            s.title,
            s.match_confidence
                .map(|c| format!(" (match confidence {c:.2})"))
                .unwrap_or_default(),
            if s.retry_count > 0 {
                format!(" — {} rework round(s)", s.retry_count)
            } else {
                String::new()
            },
        ));
    }
    seed.push_str("Resolve each agenda item with a concrete lesson the team can apply next time.");
    let _ = channel_repo::post_deliberation_turn(pool, &delib.id, team_id, "system", None, &seed);

    // Drive a bounded number of moderated rounds. The deliberation engine's
    // own cost floor also guards each round; whichever cap hits first wins.
    let user_db = app
        .try_state::<Arc<crate::AppState>>()
        .map(|s| s.user_db.clone());
    if let Some(user_db) = user_db {
        for _ in 0..RETRO_MAX_ROUNDS {
            let Ok(current) = delib_repo::get(pool, &delib.id) else {
                break;
            };
            if !matches!(current.status.as_str(), "open" | "converging") {
                break;
            }
            if let Err(e) =
                crate::engine::deliberation::advance_one_deliberation(pool, &user_db, &current)
                    .await
            {
                tracing::warn!(deliberation_id = %delib.id, error = %e, "retrospective: round failed");
                break;
            }
        }
    } else {
        tracing::warn!(deliberation_id = %delib.id, "retrospective: AppState unavailable — skipping rounds");
    }

    // Whatever state the rounds reached, the retro must not squat on the
    // team's single active-deliberation slot: finalize if still live.
    if let Ok(current) = delib_repo::get(pool, &delib.id) {
        if matches!(
            current.status.as_str(),
            "open" | "converging" | "escalated" | "paused"
        ) {
            let _ = delib_repo::finalize(
                pool,
                &delib.id,
                "resolved",
                Some(
                    &json!({ "kind": "retrospective", "assignment_id": assignment_id }).to_string(),
                ),
                None,
            );
        }
    }

    distill_lessons(pool, team_id, assignment_id, &delib.id);
    Ok(())
}

/// Write the retro's resolved agenda items to the team ledger as `lesson`
/// memories with provenance. Honest when empty: no resolutions → no lessons →
/// a system turn says so.
fn distill_lessons(pool: &Arc<DbPool>, team_id: &str, assignment_id: &str, deliberation_id: &str) {
    let resolved: Vec<(String, String)> = delib_repo::list_agenda(pool, deliberation_id)
        .map(|items| {
            items
                .into_iter()
                .filter(|a| a.status == "resolved")
                .filter_map(|a| {
                    let res = a.resolution?.trim().to_string();
                    if res.is_empty() {
                        None
                    } else {
                        Some((a.item, res))
                    }
                })
                .take(RETRO_MAX_LESSONS)
                .collect()
        })
        .unwrap_or_default();

    let mut written = 0usize;
    for (item, resolution) in &resolved {
        let title: String = format!("Lesson: {item}").chars().take(120).collect();
        let content = format!(
            "TEAM LESSON (from the auto-retrospective of assignment {assignment_id}, \
             deliberation {deliberation_id}).\nQuestion: {item}\nLesson: {resolution}",
        );
        let input = CreateTeamMemoryInput {
            team_id: team_id.to_string(),
            run_id: None,
            member_id: None,
            persona_id: None,
            title,
            content,
            category: Some("lesson".into()),
            importance: Some(7),
            tags: Some("lesson,retrospective".into()),
        };
        match team_memory_repo::create(pool, input) {
            Ok(_) => written += 1,
            Err(e) => {
                tracing::warn!(deliberation_id, error = %e, "retrospective: lesson write failed");
            }
        }
    }
    let note = if written > 0 {
        format!(
            "Distilled {written} lesson(s) into the team ledger — future matching will read them."
        )
    } else {
        "No agenda items resolved into lessons this time — nothing was written to the team ledger."
            .to_string()
    };
    let _ =
        channel_repo::post_deliberation_turn(pool, deliberation_id, team_id, "system", None, &note);
    let _ = assignment_repo::insert_event(
        pool,
        assignment_id,
        None,
        "retrospective_distilled",
        Some(&json!({ "deliberationId": deliberation_id, "lessons": written }).to_string()),
    );
}

// ----------------------------------------------------------------------------
// Lesson retrieval for the matching prompt
// ----------------------------------------------------------------------------

/// Max lessons injected into the matching prompt, each capped in length.
pub const MATCH_LESSONS_LIMIT: i64 = 5;
const MATCH_LESSON_MAX_CHARS: usize = 300;

/// Fetch and format the team's lessons for the matching prompt's
/// "Team lessons" section. Empty vec = the section is omitted (sparse-data
/// honesty — no stretched inference from nothing).
pub fn team_lessons_for_matching(pool: &DbPool, team_id: &str) -> Vec<String> {
    outcome_repo::list_team_lessons(pool, team_id, MATCH_LESSONS_LIMIT)
        .map(|memories| {
            memories
                .into_iter()
                .map(|m| {
                    // Strip the provenance preamble for the prompt: the model
                    // needs the lesson, not the ledger bookkeeping.
                    let gist = m
                        .content
                        .split("Lesson: ")
                        .nth(1)
                        .map(str::to_string)
                        .unwrap_or(m.content);
                    let mut line: String = gist.chars().take(MATCH_LESSON_MAX_CHARS).collect();
                    if line.len() < gist.len() {
                        line.push('…');
                    }
                    line
                })
                .collect()
        })
        .unwrap_or_default()
}

// ----------------------------------------------------------------------------
// Tests — the pure logic
// ----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// THE hard bar: a persona cannot death-spiral off the roster from a few
    /// unlucky runs. Ten consecutive overconfident failures floor at
    /// TRUST_FLOOR — never zero, never below.
    #[test]
    fn trust_cannot_death_spiral() {
        let mut trust = 0.9;
        for _ in 0..10 {
            trust = brier_trust_update(trust, Some(0.95), false);
        }
        assert!(trust >= TRUST_FLOOR, "trust fell below the floor: {trust}");
        assert!(trust > 0.0);
        // And recovery is possible: a few good runs lift it back meaningfully.
        for _ in 0..4 {
            trust = brier_trust_update(trust, Some(0.9), true);
        }
        assert!(trust > TRUST_FLOOR + 0.2, "trust did not recover: {trust}");
    }

    /// Decay: one failure after a long success streak dents but does not
    /// crater the score (bounded by alpha).
    #[test]
    fn single_failure_is_bounded_by_alpha() {
        let before = 0.9;
        let after = brier_trust_update(before, Some(0.9), false);
        // Max possible drop in one step is alpha * (prev - sample_score).
        assert!(
            after >= before - TRUST_ALPHA,
            "one run moved trust too far: {after}"
        );
        assert!(after < before);
    }

    /// Calibration matters: an overconfident failure hurts more than an
    /// honest-uncertainty failure; a confident success helps more than an
    /// unconfident one.
    #[test]
    fn brier_rewards_calibration() {
        let overconfident_fail = brier_trust_update(0.5, Some(0.95), false);
        let humble_fail = brier_trust_update(0.5, Some(0.55), false);
        assert!(humble_fail > overconfident_fail);

        let confident_win = brier_trust_update(0.5, Some(0.95), true);
        let unsure_win = brier_trust_update(0.5, Some(0.55), true);
        assert!(confident_win > unsure_win);
    }

    #[test]
    fn trust_stays_in_bounds() {
        for prev in [0.0, 0.15, 0.5, 1.0, 1.5, -3.0] {
            for conf in [None, Some(-1.0), Some(0.0), Some(0.5), Some(1.0), Some(9.0)] {
                for success in [true, false] {
                    let t = brier_trust_update(prev, conf, success);
                    assert!((TRUST_FLOOR..=1.0).contains(&t), "out of bounds: {t}");
                }
            }
        }
    }

    /// Retro gating: skipped ONLY when the run is short AND clean.
    #[test]
    fn retrospective_skips_trivial_runs_only() {
        assert!(!retrospective_needed(2, 0, 0), "short clean run must skip");
        assert!(!retrospective_needed(0, 0, 0));
        assert!(
            retrospective_needed(3, 0, 0),
            "3+ steps retro even when clean"
        );
        assert!(retrospective_needed(1, 1, 0), "any failure retros");
        assert!(retrospective_needed(2, 0, 1), "any intervention retros");
    }

    #[test]
    fn seed_trust_uses_global_when_meaningful() {
        assert_eq!(seed_trust(0.0), TRUST_DEFAULT); // no history → neutral
        assert_eq!(seed_trust(0.8), 0.8);
        assert_eq!(seed_trust(0.05), TRUST_FLOOR); // floored
        assert_eq!(seed_trust(50.0), TRUST_DEFAULT); // legacy 0-100 scale → neutral
    }
}
