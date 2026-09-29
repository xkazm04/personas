//! The six operations behind the `twin_setup_*` commands.
//!
//! Every operation is synchronous database work in ONE immediate transaction
//! and returns the fresh snapshot plus the background work it wants
//! ([`Want`]). None of them waits on an LLM: the caller schedules the wants
//! on the per-twin job worker after the transaction commits.

use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;

use crate::db::models::{SetupOpener, SetupReadiness, SetupSessionSnapshot, SetupSteer, SetupStep};
use crate::db::repos::twin as twin_repo;
use crate::db::repos::twin_setup::{self as repo, NewOffer, NewStep, Placement, PlanRow};
use crate::db::DbPool;
use crate::error::AppError;

use super::queue::{self, LiveState};
use super::skeleton::{self, QUEUE_DEPTH};

/// A plan stuck in `building` longer than this is treated as failed.
pub(crate) const LEASE_STALE_SECS: i64 = 300;
/// A deep re-plan is due after this many answers since the last one.
pub(crate) const DEEP_PASS_EVERY: i64 = 5;

/// Background work an operation asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Want {
    /// The deep pass (exclusive).
    Plan,
    /// Assess ∥ refill for every unreconciled step.
    Reconcile,
    /// Top the current stage's queue up.
    Refill,
}

/// An operation's result: the snapshot to return and the work to schedule.
#[derive(Debug, Clone)]
pub(crate) struct Outcome {
    pub snapshot: SetupSessionSnapshot,
    pub wants: Vec<Want>,
}

fn push(wants: &mut Vec<Want>, want: Want) {
    if !wants.contains(&want) {
        wants.push(want);
    }
}

/// Run `f` inside one IMMEDIATE transaction (a read here always informs a
/// write), then read the snapshot in the same transaction.
fn in_tx(
    pool: &DbPool,
    twin_id: &str,
    f: impl FnOnce(&Connection) -> Result<Vec<Want>, AppError>,
) -> Result<Outcome, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let wants = f(&tx)?;
    let snapshot = repo::snapshot_on(&tx, twin_id)?;
    tx.commit()?;
    Ok(Outcome { snapshot, wants })
}

fn store_context(plan: &mut PlanRow, locale: Option<&str>, readiness: SetupReadiness) {
    if let Some(locale) = locale.map(str::trim).filter(|l| !l.is_empty()) {
        plan.locale = Some(locale.to_string());
    }
    plan.readiness = Some(readiness);
}

/// The plan row, created (`building`, version 0) when absent. The row must
/// exist before any step is inserted: a twin without one snapshots as empty.
fn plan_or_fresh(conn: &Connection, twin_id: &str) -> Result<(PlanRow, bool), AppError> {
    match repo::get_plan_on(conn, twin_id)? {
        Some(plan) => Ok((plan, true)),
        None => Ok((PlanRow::fresh(twin_id), false)),
    }
}

/// Stamp the planner lease so the snapshot reads `planning` at once.
fn start_plan(conn: &Connection, twin_id: &str, wants: &mut Vec<Want>) -> Result<(), AppError> {
    repo::take_lease_on(conn, twin_id)?;
    push(wants, Want::Plan);
    Ok(())
}

/// After a steer changed what should be asked: promote a fitting step, or ask
/// for a refill when nothing fits (unless a deep pass is already coming).
fn promote_or_refill(
    conn: &Connection,
    twin_id: &str,
    wants: &mut Vec<Want>,
) -> Result<(), AppError> {
    if queue::ensure_live(conn, twin_id)? == LiveState::Starved && !wants.contains(&Want::Plan) {
        push(wants, Want::Refill);
    }
    Ok(())
}

// ============================================================================
// open
// ============================================================================

/// Open (or resume) the session. `worker_running` is whether a job worker is
/// alive for this twin in this process: a `building` plan with no worker was
/// orphaned by a restart and is rebuilt without waiting out the lease.
pub(crate) fn open(
    pool: &DbPool,
    twin_id: &str,
    locale: Option<&str>,
    readiness: SetupReadiness,
    opener: Option<SetupOpener>,
    worker_running: bool,
) -> Result<Outcome, AppError> {
    in_tx(pool, twin_id, |conn| {
        let mut wants = Vec::new();
        let (mut plan, existed) = plan_or_fresh(conn, twin_id)?;
        let needs_plan = !existed
            || plan.status == "failed"
            || (plan.status == "building"
                && (!worker_running || repo::lease_is_stale_on(conn, twin_id, LEASE_STALE_SECS)?));
        store_context(&mut plan, locale, readiness);
        repo::upsert_plan_on(conn, &plan)?;
        if needs_plan {
            start_plan(conn, twin_id, &mut wants)?;
        }

        if queue::ensure_live(conn, twin_id)? == LiveState::Starved {
            let stage_empty = repo::count_queued_on(conn, twin_id, &plan.stage)? == 0;
            let opener = opener
                .as_ref()
                .map(|o| o.question.trim())
                .filter(|q| !q.is_empty());
            match opener {
                Some(question)
                    if stage_empty
                        && plan.stage == "setup"
                        && !repo::question_seen_on(conn, twin_id, question)? =>
                {
                    repo::insert_step_on(
                        conn,
                        twin_id,
                        &NewStep {
                            goal_id: None,
                            stage: "setup",
                            origin: "opener",
                            kind: "fact",
                            question,
                            answer_mode: "pick",
                            incoming: None,
                            tone_channel: None,
                            suggestions: &[],
                            plan_version: plan.version,
                        },
                        "live",
                        Placement::Tail,
                    )?;
                }
                _ if !wants.contains(&Want::Plan) => push(&mut wants, Want::Refill),
                _ => {}
            }
        }
        // Recovery: an answer the app closed on before it was folded in.
        if repo::has_unreconciled_on(conn, twin_id)? {
            push(&mut wants, Want::Reconcile);
        }
        Ok(wants)
    })
}

// ============================================================================
// answer
// ============================================================================

/// `key_facts_json` of a training answer — byte-for-byte the shape
/// `trainingQaFacts` (`sub_training/topicCoverage.ts`) writes: field order
/// `kind, topic, pairs` and `q, a`, which a struct keeps and a `json!` map
/// (sorted keys) would not.
#[derive(Serialize)]
struct QaPair<'a> {
    q: &'a str,
    a: &'a str,
}

#[derive(Serialize)]
struct TaggedQa<'a> {
    kind: &'static str,
    topic: &'a str,
    pairs: [QaPair<'a>; 1],
}

pub(crate) fn training_qa_facts(question: &str, answer: &str, topic: Option<&str>) -> String {
    let pair = QaPair {
        q: question,
        a: answer,
    };
    let json = match topic {
        Some(topic) => serde_json::to_string(&TaggedQa {
            kind: "training_qa",
            topic,
            pairs: [pair],
        }),
        None => serde_json::to_string(&[pair]),
    };
    // Serialising two string fields cannot fail; an empty column is the
    // honest fallback if it somehow did.
    json.unwrap_or_default()
}

/// The preset a training answer is tagged with: its goal's topic, else the
/// topic the plan runs under.
fn training_topic(
    conn: &Connection,
    twin_id: &str,
    step: &SetupStep,
    plan: &PlanRow,
) -> Result<Option<String>, AppError> {
    if let Some(goal_id) = step.goal_id.as_deref() {
        let goals = repo::list_goals_on(conn, twin_id)?;
        if let Some(topic) = goals
            .iter()
            .find(|g| g.id == goal_id)
            .and_then(|g| skeleton::topic_of_slot(&g.slot))
        {
            return Ok(Some(topic.to_string()));
        }
    }
    Ok(plan
        .topic_preset
        .as_deref()
        .filter(|t| skeleton::is_topic(t))
        .map(str::to_string))
}

/// Answer (or skip, `answer == None`) the LIVE step. Any other `step_id` is a
/// no-op that returns the snapshot unchanged — the one-verdict rule for every
/// path, hands-free voice included.
pub(crate) fn answer(
    pool: &DbPool,
    twin_id: &str,
    step_id: &str,
    answer: Option<&str>,
    locale: Option<&str>,
    readiness: SetupReadiness,
) -> Result<Outcome, AppError> {
    in_tx(pool, twin_id, |conn| {
        let mut wants = Vec::new();
        let Some(live) = repo::live_step_on(conn, twin_id)?.filter(|s| s.id == step_id) else {
            return Ok(wants);
        };
        let Some(mut plan) = repo::get_plan_on(conn, twin_id)? else {
            return Ok(wants);
        };
        store_context(&mut plan, locale, readiness);
        plan.answers_since_deep += 1;
        repo::upsert_plan_on(conn, &plan)?;

        // A blank answer is a skip; a skip is never stored as a value.
        let text = answer.map(str::trim).filter(|a| !a.is_empty());
        repo::finish_step_on(conn, twin_id, &live.id, text)?;

        if let Some(text) = text {
            if let Some(goal_id) = live.goal_id.as_deref() {
                repo::bump_goal_answered_on(conn, twin_id, goal_id)?;
            }
            if live.stage == "training" {
                let topic = training_topic(conn, twin_id, &live, &plan)?;
                twin_repo::record_interaction_on(
                    conn,
                    twin_id,
                    "training",
                    "out",
                    None,
                    text,
                    Some(&format!("Training Q&A: {}", live.question)),
                    Some(&training_qa_facts(&live.question, text, topic.as_deref())),
                    true,
                )?;
            } else if live.answer_mode == "write" {
                // The answer to a writing-sample question IS a sample: offer it
                // back, verbatim, for the channel it was written for.
                repo::insert_offer_on(
                    conn,
                    twin_id,
                    &NewOffer {
                        step_id: &live.id,
                        origin: "sample",
                        kind: "tone",
                        part: Some("examples"),
                        channel: Some(live.tone_channel.as_deref().unwrap_or("generic")),
                        value: text,
                        length_hint: None,
                        reason: "",
                    },
                )?;
            }
        }

        queue::ensure_live(conn, twin_id)?;
        push(&mut wants, Want::Reconcile);
        if plan.answers_since_deep >= DEEP_PASS_EVERY && plan.status != "building" {
            start_plan(conn, twin_id, &mut wants)?;
        }
        Ok(wants)
    })
}

// ============================================================================
// steer
// ============================================================================

fn require_goal(conn: &Connection, twin_id: &str, goal_id: &str) -> Result<(), AppError> {
    if repo::list_goals_on(conn, twin_id)?
        .iter()
        .any(|g| g.id == goal_id)
    {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("twin setup goal {goal_id}")))
    }
}

/// Insert hand-over questions at the head of the queue, in order, verbatim.
fn enqueue_handoff(
    conn: &Connection,
    twin_id: &str,
    plan: &PlanRow,
    questions: &[String],
) -> Result<usize, AppError> {
    let questions: Vec<&str> = questions
        .iter()
        .map(|q| q.trim())
        .filter(|q| !q.is_empty())
        .collect();
    // Head placement puts each insert BEFORE everything, so walk backwards to
    // leave the first question at the very head.
    for question in questions.iter().rev() {
        repo::insert_step_on(
            conn,
            twin_id,
            &NewStep {
                goal_id: None,
                stage: "training",
                origin: "handoff",
                kind: "fact",
                question,
                answer_mode: "pick",
                incoming: None,
                tone_channel: None,
                suggestions: &[],
                plan_version: plan.version,
            },
            "queued",
            Placement::Head,
        )?;
    }
    Ok(questions.len())
}

/// Apply one operator steer.
pub(crate) fn steer(
    pool: &DbPool,
    twin_id: &str,
    steer: SetupSteer,
    locale: Option<&str>,
    readiness: SetupReadiness,
) -> Result<Outcome, AppError> {
    in_tx(pool, twin_id, |conn| {
        let mut wants = Vec::new();
        let (mut plan, _) = plan_or_fresh(conn, twin_id)?;
        store_context(&mut plan, locale, readiness);

        match steer {
            SetupSteer::DropGoal { goal_id } => {
                require_goal(conn, twin_id, &goal_id)?;
                repo::upsert_plan_on(conn, &plan)?;
                repo::set_goal_state_on(conn, twin_id, &goal_id, "dropped")?;
                repo::obsolete_queued_on(conn, twin_id, Some(&goal_id), true)?;
                if repo::count_queued_on(conn, twin_id, &plan.stage)? < QUEUE_DEPTH {
                    push(&mut wants, Want::Refill);
                }
                queue::ensure_live(conn, twin_id)?;
            }
            SetupSteer::RestoreGoal { goal_id } => {
                require_goal(conn, twin_id, &goal_id)?;
                repo::upsert_plan_on(conn, &plan)?;
                repo::set_goal_state_on(conn, twin_id, &goal_id, "open")?;
            }
            SetupSteer::PinGoal { goal_id, pinned } => {
                require_goal(conn, twin_id, &goal_id)?;
                repo::upsert_plan_on(conn, &plan)?;
                repo::set_goal_pinned_on(conn, twin_id, &goal_id, pinned)?;
            }
            SetupSteer::AskNext { step_id } => {
                repo::upsert_plan_on(conn, &plan)?;
                let queued =
                    repo::step_on(conn, twin_id, &step_id)?.filter(|s| s.status == "queued");
                if queued.is_some() {
                    if let Some(live) = repo::live_step_on(conn, twin_id)? {
                        repo::requeue_at_head_on(conn, twin_id, &live.id)?;
                    }
                    repo::make_live_on(conn, twin_id, &step_id)?;
                }
            }
            SetupSteer::SetStage { stage } => {
                let stage = stage.trim().to_lowercase();
                if stage != "setup" && stage != "training" {
                    return Err(AppError::Validation(format!(
                        "twin_setup_steer: unknown stage '{stage}' (expected setup or training)"
                    )));
                }
                let changed = plan.stage != stage;
                plan.stage = stage;
                repo::upsert_plan_on(conn, &plan)?;
                if changed {
                    queue::requeue_if_off_target(conn, twin_id)?;
                    if plan.status != "building" {
                        start_plan(conn, twin_id, &mut wants)?;
                    }
                    promote_or_refill(conn, twin_id, &mut wants)?;
                }
            }
            SetupSteer::SetTopic { preset_id, prompt } => {
                let preset = skeleton::normalise_token(preset_id);
                if let Some(p) = preset.as_deref() {
                    if !skeleton::is_topic(p) {
                        return Err(AppError::Validation(format!(
                            "twin_setup_steer: unknown training topic '{p}'"
                        )));
                    }
                }
                plan.topic_preset = preset;
                repo::upsert_plan_on(conn, &plan)?;
                super::jobs::set_topic_prompt(
                    twin_id,
                    prompt
                        .map(|p| p.trim().to_string())
                        .filter(|p| !p.is_empty()),
                );
                if plan.stage == "training" {
                    queue::requeue_if_off_target(conn, twin_id)?;
                    promote_or_refill(conn, twin_id, &mut wants)?;
                }
            }
            SetupSteer::FocusSlot { slot } => {
                let slot = slot.trim().to_lowercase();
                if !skeleton::SETUP_SLOTS.contains(&slot.as_str()) {
                    return Err(AppError::Validation(format!(
                        "twin_setup_steer: '{slot}' is not a setup slot"
                    )));
                }
                plan.focus_slot = Some(slot);
                repo::upsert_plan_on(conn, &plan)?;
                if plan.stage == "setup" {
                    queue::requeue_if_off_target(conn, twin_id)?;
                    promote_or_refill(conn, twin_id, &mut wants)?;
                }
            }
            SetupSteer::EnqueueHandoff { questions } => {
                plan.stage = "training".to_string();
                repo::upsert_plan_on(conn, &plan)?;
                if enqueue_handoff(conn, twin_id, &plan, &questions)? > 0 {
                    // A setup-stage live step yields to the hand-over; a
                    // training one stays live and the hand-over is next.
                    queue::requeue_if_off_target(conn, twin_id)?;
                    queue::ensure_live(conn, twin_id)?;
                }
            }
            SetupSteer::Redeal {} => {
                repo::upsert_plan_on(conn, &plan)?;
                if let Some(live) = repo::live_step_on(conn, twin_id)? {
                    repo::obsolete_step_on(conn, twin_id, &live.id)?;
                }
                queue::ensure_live(conn, twin_id)?;
                push(&mut wants, Want::Refill);
            }
        }
        Ok(wants)
    })
}

// ============================================================================
// offer verdict / rebuild / get
// ============================================================================

/// Record the operator's verdict on an open offer, once.
pub(crate) fn offer_verdict(
    pool: &DbPool,
    twin_id: &str,
    offer_id: &str,
    verdict: &str,
) -> Result<Outcome, AppError> {
    let verdict = verdict.trim();
    if !matches!(verdict, "accepted" | "edited" | "dismissed") {
        return Err(AppError::Validation(format!(
            "twin_setup_offer_verdict: unknown verdict '{verdict}' (expected accepted, edited or dismissed)"
        )));
    }
    in_tx(pool, twin_id, |conn| {
        repo::resolve_offer_on(conn, twin_id, offer_id, verdict)?;
        Ok(Vec::new())
    })
}

/// A fresh deep pass over everything on file. Nothing is deleted.
pub(crate) fn rebuild(
    pool: &DbPool,
    twin_id: &str,
    locale: Option<&str>,
    readiness: SetupReadiness,
) -> Result<Outcome, AppError> {
    in_tx(pool, twin_id, |conn| {
        let mut wants = Vec::new();
        let (mut plan, _) = plan_or_fresh(conn, twin_id)?;
        store_context(&mut plan, locale, readiness);
        repo::upsert_plan_on(conn, &plan)?;
        start_plan(conn, twin_id, &mut wants)?;
        Ok(wants)
    })
}

/// The current session. Pure read.
pub(crate) fn get(pool: &DbPool, twin_id: &str) -> Result<SetupSessionSnapshot, AppError> {
    repo::snapshot(pool, twin_id)
}
