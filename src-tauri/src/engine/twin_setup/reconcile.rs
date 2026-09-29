//! Per-answer reconcile: ASSESS (coverage, offers, one follow-up, an
//! observation) and REFILL (top the queue up) run CONCURRENTLY on
//! OPUS_5_5 @ low, then both results are applied in one transaction.
//!
//! Failure policy: an assessment that fails bumps the step's
//! `reconcile_attempts`; the second failure marks it reconciled with no offers,
//! so a step can never loop. A refill that fails twice in a row wants a deep
//! pass instead. A declined step is assessed without an LLM (coverage
//! unchanged, no offers) and still reconciled.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, TransactionBehavior};

use crate::commands::infrastructure::twin_voice::uses_dashes;
use crate::db::models::{SetupGoal, SetupKindStat, SetupObservation, SetupStep};
use crate::db::repos::twin_setup::{
    self as repo, NewOffer, NewStep, Placement, PlanRow, StepOrder,
};
use crate::db::DbPool;
use crate::error::AppError;

use super::jobs::{call_with_repair, db, note_refill, JobCtx};
use super::llm::TwinCall;
use super::parse::{parse_assess, parse_refill, AssessOut, RefillOut};
use super::plan::{insert_drafts, OBSERVATIONS_MAX};
use super::prompts::{
    build_assess_prompt, build_refill_prompt, AssessInput, OnFile, RefillInput, RECENT_EXCHANGES,
};
use super::queue;
use super::skeleton::{COVERED_AT, QUEUE_DEPTH, STALL_GAIN, STALL_LIMIT};

/// An assessment gets this many tries before the step is let go.
const ASSESS_ATTEMPTS: i64 = 2;
/// Goals a refill is asked to write for.
const REFILL_TARGETS: usize = 3;

/// What one reconcile iteration reads.
struct ReconcileData {
    plan: PlanRow,
    on_file: OnFile,
    goals: Vec<SetupGoal>,
    stalls: HashMap<String, i64>,
    /// The step being reconciled (None for a refill-only pass).
    step: Option<SetupStep>,
    /// Up to six exchanges before the step, oldest first.
    earlier: Vec<SetupStep>,
    /// Up to six exchanges including the step, oldest first.
    recent: Vec<SetupStep>,
    queue: Vec<SetupStep>,
    targets: Vec<SetupGoal>,
    need: i64,
    observations: Vec<SetupObservation>,
    kind_stats: Vec<SetupKindStat>,
}

fn gather(
    pool: &DbPool,
    twin_id: &str,
    skip: &HashSet<String>,
    with_step: bool,
) -> Result<Option<ReconcileData>, AppError> {
    let conn = pool.get()?;
    let Some(plan) = repo::get_plan_on(&conn, twin_id)? else {
        return Ok(None);
    };
    let step = if with_step {
        match repo::unreconciled_on(&conn, twin_id)?
            .into_iter()
            .find(|(s, _)| !skip.contains(&s.id))
        {
            Some((step, _)) => Some(step),
            None => return Ok(None),
        }
    } else {
        None
    };
    let goals = repo::list_goals_on(&conn, twin_id)?;
    let stalls = repo::goal_stalls_on(&conn, twin_id)?;
    let history = repo::list_steps_on(
        &conn,
        twin_id,
        &["answered", "skipped"],
        StepOrder::Recent,
        RECENT_EXCHANGES as i64 + 1,
    )?;
    let recent: Vec<SetupStep> = history
        .iter()
        .rev()
        .take(RECENT_EXCHANGES)
        .rev()
        .cloned()
        .collect();
    let before: Vec<&SetupStep> = history
        .iter()
        .filter(|s| step.as_ref().map_or(true, |st| st.id != s.id))
        .collect();
    let earlier: Vec<SetupStep> = before[before.len().saturating_sub(RECENT_EXCHANGES)..]
        .iter()
        .map(|s| (*s).clone())
        .collect();
    let queue: Vec<SetupStep> =
        repo::list_steps_on(&conn, twin_id, &["queued"], StepOrder::Position, 20)?
            .into_iter()
            .filter(|s| s.stage == plan.stage)
            .collect();
    let need = QUEUE_DEPTH - queue.len() as i64;
    let targets = queue::refill_targets(&plan, &goals, &stalls, REFILL_TARGETS);
    let observations = repo::list_observations_on(&conn, twin_id)?;
    drop(conn);
    let on_file = OnFile::load(pool, twin_id, plan.locale.as_deref())?;
    let kind_stats = repo::kind_stats(pool)?;
    Ok(Some(ReconcileData {
        plan,
        on_file,
        goals,
        stalls,
        step,
        earlier,
        recent,
        queue,
        targets,
        need,
        observations,
        kind_stats,
    }))
}

fn refill_input<'a>(data: &'a ReconcileData, topic_prompt: Option<&'a str>) -> RefillInput<'a> {
    RefillInput {
        on_file: &data.on_file,
        readiness: data.plan.readiness.as_ref(),
        goals: &data.goals,
        stalls: &data.stalls,
        targets: &data.targets,
        queue: &data.queue,
        recent: &data.recent,
        observations: &data.observations,
        kind_stats: &data.kind_stats,
        stage: &data.plan.stage,
        topic: data.plan.topic_preset.as_deref(),
        topic_prompt,
        focus: data.plan.focus_slot.as_deref(),
        need: data.need,
    }
}

/// Whether a refill is worth a call: the queue is short AND some goal of the
/// stage can still take questions. Nothing left to ask means nothing asked.
fn refill_due(data: &ReconcileData) -> bool {
    data.need > 0 && !data.targets.is_empty()
}

/// Reconcile every answered or skipped step not yet folded in, oldest first.
pub(crate) async fn run(ctx: &JobCtx, twin_id: &str) -> Result<(), AppError> {
    let mut skip: HashSet<String> = HashSet::new();
    loop {
        let id = twin_id.to_string();
        let skip_now = skip.clone();
        let Some(data) = db(&ctx.pool, move |pool| gather(pool, &id, &skip_now, true)).await?
        else {
            return Ok(());
        };
        let Some(step) = data.step.clone() else {
            return Ok(());
        };
        let topic_prompt = super::jobs::topic_prompt(twin_id);
        let dashes = uses_dashes(data.recent.iter().filter_map(|s| s.answer.as_deref()));
        let answered = step.status == "answered";

        let assess = async {
            if !answered {
                return None;
            }
            let input = AssessInput {
                on_file: &data.on_file,
                readiness: data.plan.readiness.as_ref(),
                goals: &data.goals,
                step: &step,
                recent: &data.earlier,
            };
            Some(
                call_with_repair(
                    ctx,
                    TwinCall::SETUP_ASSESS,
                    |repair| build_assess_prompt(&input, repair),
                    |raw| parse_assess(raw, dashes),
                )
                .await,
            )
        };
        let refill = async {
            if !refill_due(&data) {
                return None;
            }
            let input = refill_input(&data, topic_prompt.as_deref());
            Some(
                call_with_repair(
                    ctx,
                    TwinCall::SETUP_REFILL,
                    |repair| build_refill_prompt(&input, repair),
                    |raw| parse_refill(raw, dashes),
                )
                .await,
            )
        };
        let (assess, refill) = tokio::join!(assess, refill);

        let assess_failed = matches!(assess, Some(Err(_)));
        if let Some(Err(reason)) = &assess {
            tracing::warn!(twin_id = %twin_id, step_id = %step.id, %reason, "twin setup assess failed");
        }
        if let Some(result) = &refill {
            if let Err(reason) = result {
                tracing::warn!(twin_id = %twin_id, %reason, "twin setup refill failed");
            }
            note_refill(twin_id, result.is_ok());
        }

        let id = twin_id.to_string();
        let applied_step = step.clone();
        let reconciled = db(&ctx.pool, move |pool| {
            apply(
                pool,
                &id,
                Some(&applied_step),
                assess,
                refill.and_then(Result::ok),
            )
        })
        .await?;
        if assess_failed && !reconciled {
            // Retried on the next job loop, not in this one.
            skip.insert(step.id.clone());
        }
        ctx.announce(twin_id, "reconciled", data.plan.version);
    }
}

/// Top the current stage's queue up without an answer to reconcile (after a
/// steer, a redeal, or an open that found the queue drained).
pub(crate) async fn refill_only(ctx: &JobCtx, twin_id: &str) -> Result<(), AppError> {
    let id = twin_id.to_string();
    let Some(data) = db(&ctx.pool, move |pool| {
        gather(pool, &id, &HashSet::new(), false)
    })
    .await?
    else {
        return Ok(());
    };
    if !refill_due(&data) {
        // Still promote: the queue may already hold a fitting step.
        let id = twin_id.to_string();
        db(&ctx.pool, move |pool| apply(pool, &id, None, None, None)).await?;
        ctx.announce(twin_id, "refilled", data.plan.version);
        return Ok(());
    }
    let topic_prompt = super::jobs::topic_prompt(twin_id);
    let dashes = uses_dashes(data.recent.iter().filter_map(|s| s.answer.as_deref()));
    let input = refill_input(&data, topic_prompt.as_deref());
    let result = call_with_repair(
        ctx,
        TwinCall::SETUP_REFILL,
        |repair| build_refill_prompt(&input, repair),
        |raw| parse_refill(raw, dashes),
    )
    .await;
    if let Err(reason) = &result {
        tracing::warn!(twin_id = %twin_id, %reason, "twin setup refill failed");
    }
    note_refill(twin_id, result.is_ok());
    let id = twin_id.to_string();
    db(&ctx.pool, move |pool| {
        apply(pool, &id, None, None, result.ok())
    })
    .await?;
    ctx.announce(twin_id, "refilled", data.plan.version);
    Ok(())
}

/// Apply one iteration in one transaction. Returns whether `step` ended
/// reconciled (always, except a first failed assessment).
pub(crate) fn apply(
    pool: &DbPool,
    twin_id: &str,
    step: Option<&SetupStep>,
    assess: Option<Result<AssessOut, String>>,
    refill: Option<RefillOut>,
) -> Result<bool, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let reconciled = match step {
        Some(step) => apply_assess(&tx, twin_id, step, assess)?,
        None => true,
    };
    if let Some(out) = refill {
        apply_refill(&tx, twin_id, &out)?;
    }
    queue::ensure_live(&tx, twin_id)?;
    tx.commit()?;
    Ok(reconciled)
}

fn apply_assess(
    conn: &Connection,
    twin_id: &str,
    step: &SetupStep,
    assess: Option<Result<AssessOut, String>>,
) -> Result<bool, AppError> {
    let goals = repo::list_goals_on(conn, twin_id)?;
    let stalls = repo::goal_stalls_on(conn, twin_id)?;
    let own_goal = step
        .goal_id
        .as_deref()
        .and_then(|id| goals.iter().find(|g| g.id == id));

    let out = match assess {
        // Declined: coverage unchanged, no offers — but no gain either, so the
        // goal's stall counter moves.
        None => {
            if let Some(goal) = own_goal {
                let stall = stalls.get(&goal.id).copied().unwrap_or(0) + 1;
                repo::set_goal_progress_on(
                    conn,
                    twin_id,
                    &goal.id,
                    goal.coverage,
                    &goal.state,
                    stall,
                )?;
            }
            repo::mark_reconciled_on(conn, &step.id, None)?;
            return Ok(true);
        }
        Some(Err(_)) => {
            let attempts = repo::bump_reconcile_attempts_on(conn, &step.id)?;
            if attempts >= ASSESS_ATTEMPTS {
                repo::mark_reconciled_on(conn, &step.id, None)?;
                return Ok(true);
            }
            return Ok(false);
        }
        Some(Ok(out)) => out,
    };

    // Coverage: absolute readings, clamped by the door; `covered` is a
    // steering state only and never touches readiness.
    let mut gain: Option<f64> = None;
    let mut own_state: Option<(String, i64)> =
        own_goal.map(|g| (g.state.clone(), stalls.get(&g.id).copied().unwrap_or(0)));
    for (goal_id, coverage) in &out.coverage {
        let Some(goal) = goals.iter().find(|g| &g.id == goal_id) else {
            continue;
        };
        if goal.state == "dropped" {
            continue;
        }
        let coverage = coverage.clamp(0.0, 1.0);
        let state = if coverage >= COVERED_AT {
            "covered"
        } else {
            "open"
        };
        let mut stall = stalls.get(&goal.id).copied().unwrap_or(0);
        if own_goal.is_some_and(|g| g.id == goal.id) {
            let delta = coverage - goal.coverage;
            gain = Some(delta);
            stall = if delta <= STALL_GAIN { stall + 1 } else { 0 };
            own_state = Some((state.to_string(), stall));
        }
        repo::set_goal_progress_on(conn, twin_id, &goal.id, coverage, state, stall)?;
    }
    if let Some(goal) = own_goal {
        if gain.is_none() {
            // The assessor did not touch the step's own goal: no gain.
            gain = Some(0.0);
            let stall = stalls.get(&goal.id).copied().unwrap_or(0) + 1;
            repo::set_goal_progress_on(conn, twin_id, &goal.id, goal.coverage, &goal.state, stall)?;
            own_state = Some((goal.state.clone(), stall));
        }
    }

    // Offers: setup answers only — a training answer never changes a field.
    if step.stage == "setup" {
        for offer in &out.offers {
            repo::insert_offer_on(
                conn,
                twin_id,
                &NewOffer {
                    step_id: &step.id,
                    origin: "reconcile",
                    kind: &offer.kind,
                    part: offer.part.as_deref(),
                    channel: offer.channel.as_deref(),
                    value: &offer.value,
                    length_hint: offer.length_hint.as_deref(),
                    reason: &offer.reason,
                },
            )?;
        }
    }

    // One follow-up at the head, unless the goal is done, dropped or stalled.
    if let Some(follow) = &out.follow_up {
        let goal_open = match &own_state {
            Some((state, stall)) => state == "open" && *stall < STALL_LIMIT,
            None => true,
        };
        if goal_open && !repo::question_seen_on(conn, twin_id, &follow.question)? {
            let plan_version = repo::get_plan_on(conn, twin_id)?
                .map(|p| p.version)
                .unwrap_or(0);
            repo::insert_step_on(
                conn,
                twin_id,
                &NewStep {
                    goal_id: step.goal_id.as_deref(),
                    stage: &step.stage,
                    origin: "follow_up",
                    kind: &follow.kind,
                    question: &follow.question,
                    answer_mode: &follow.answer_mode,
                    incoming: follow.incoming.as_deref(),
                    tone_channel: follow.tone_channel.as_deref(),
                    suggestions: &follow.suggestions,
                    plan_version,
                },
                "queued",
                Placement::Head,
            )?;
        }
    }

    if let Some(text) = out.observation.as_deref() {
        repo::note_observation_on(conn, twin_id, text, OBSERVATIONS_MAX as i64)?;
    }
    repo::mark_reconciled_on(conn, &step.id, if own_goal.is_some() { gain } else { None })?;
    Ok(true)
}

fn apply_refill(conn: &Connection, twin_id: &str, out: &RefillOut) -> Result<(), AppError> {
    for id in &out.obsolete {
        let queued = repo::step_on(conn, twin_id, id)?
            .is_some_and(|s| s.status == "queued" && s.origin != "handoff");
        if queued {
            repo::obsolete_step_on(conn, twin_id, id)?;
        }
    }
    let Some(plan) = repo::get_plan_on(conn, twin_id)? else {
        return Ok(());
    };
    insert_drafts(
        conn,
        twin_id,
        &out.steps,
        &[],
        Some(&plan.stage),
        plan.version,
    )?;
    Ok(())
}
