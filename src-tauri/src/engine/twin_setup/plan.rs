//! The deep pass: OPUS_5_5 @ medium writes (or revises) the goals, the
//! observations and the first stretch of the question path.
//!
//! Code owns the skeleton. An out-of-skeleton slot is rejected, a slot keeps
//! at most [`MAX_GOALS_PER_SLOT`] live goals, dropped and pinned goals are the
//! operator's and are never rewritten, deleted or unpinned, every slot ends
//! the pass with at least one goal (a code default when the model left it
//! empty), and the live step is never touched.

use std::collections::HashMap;

use rusqlite::{Connection, TransactionBehavior};

use crate::commands::infrastructure::twin_voice::uses_dashes;
use crate::db::models::{SetupGoal, SetupKindStat, SetupObservation, SetupStep};
use crate::db::repos::twin_setup::{self as repo, NewGoal, NewStep, Placement, PlanRow, StepOrder};
use crate::db::DbPool;
use crate::error::AppError;

use super::jobs::{call_with_repair, db, JobCtx};
use super::llm::TwinCall;
use super::parse::{parse_plan, DraftStep, PlanOut};
use super::prompts::{build_plan_prompt, OnFile, PlanInput, PLAN_TRANSCRIPT};
use super::queue;
use super::skeleton::{self, MAX_GOALS_PER_SLOT, QUEUE_DEPTH};

/// The most observations a twin keeps.
pub(crate) const OBSERVATIONS_MAX: usize = 8;

/// Everything the deep pass reads, gathered in one blocking hop.
struct PlanData {
    plan: PlanRow,
    on_file: OnFile,
    goals: Vec<SetupGoal>,
    stalls: HashMap<String, i64>,
    transcript: Vec<SetupStep>,
    offer_verdicts: String,
    observations: Vec<SetupObservation>,
    kind_stats: Vec<SetupKindStat>,
}

fn offer_verdicts_on(conn: &Connection, twin_id: &str) -> Result<String, AppError> {
    let mut stmt = conn.prepare(
        "SELECT kind, status, COUNT(id) AS n FROM twin_setup_offers
          WHERE twin_id = ?1 GROUP BY kind, status ORDER BY kind, status",
    )?;
    let rows = stmt.query_map(rusqlite::params![twin_id], |row| {
        Ok(format!(
            "{} {}: {}",
            row.get::<_, String>("kind")?,
            row.get::<_, String>("status")?,
            row.get::<_, i64>("n")?
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?.join(", "))
}

fn gather(pool: &DbPool, twin_id: &str) -> Result<PlanData, AppError> {
    let (plan, goals, stalls, transcript, offer_verdicts, observations) = {
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // The pass holds the lease from here: `building`, stamped now.
        repo::take_lease_on(&tx, twin_id)?;
        let plan = repo::get_plan_on(&tx, twin_id)?
            .ok_or_else(|| AppError::NotFound(format!("twin setup plan {twin_id}")))?;
        let out = (
            plan,
            repo::list_goals_on(&tx, twin_id)?,
            repo::goal_stalls_on(&tx, twin_id)?,
            repo::list_steps_on(
                &tx,
                twin_id,
                &["answered", "skipped"],
                StepOrder::Recent,
                PLAN_TRANSCRIPT,
            )?,
            offer_verdicts_on(&tx, twin_id)?,
            repo::list_observations_on(&tx, twin_id)?,
        );
        tx.commit()?;
        out
    };
    let on_file = OnFile::load(pool, twin_id, plan.locale.as_deref())?;
    let kind_stats = repo::kind_stats(pool)?;
    Ok(PlanData {
        plan,
        on_file,
        goals,
        stalls,
        transcript,
        offer_verdicts,
        observations,
        kind_stats,
    })
}

/// Run one deep pass for `twin_id` and announce `plan_ready` / `plan_failed`.
pub(crate) async fn run(ctx: &JobCtx, twin_id: &str) -> Result<(), AppError> {
    let id = twin_id.to_string();
    let data = match db(&ctx.pool, move |pool| gather(pool, &id)).await {
        Ok(data) => data,
        Err(e) => {
            fail(
                ctx,
                twin_id,
                &format!("could not read the plan inputs: {e}"),
            )
            .await;
            return Err(e);
        }
    };
    let topic_prompt = super::jobs::topic_prompt(twin_id);
    let dashes_are_theirs = uses_dashes(data.transcript.iter().filter_map(|s| s.answer.as_deref()));
    let input = PlanInput {
        on_file: &data.on_file,
        readiness: data.plan.readiness.as_ref(),
        stage: &data.plan.stage,
        topic: data.plan.topic_preset.as_deref(),
        topic_prompt: topic_prompt.as_deref(),
        focus: data.plan.focus_slot.as_deref(),
        goals: &data.goals,
        stalls: &data.stalls,
        transcript: &data.transcript,
        offer_verdicts: &data.offer_verdicts,
        observations: &data.observations,
        kind_stats: &data.kind_stats,
    };
    let result = call_with_repair(
        ctx,
        TwinCall::SETUP_PLAN,
        |repair| build_plan_prompt(&input, repair),
        |raw| parse_plan(raw, dashes_are_theirs),
    )
    .await;
    match result {
        Ok(out) => {
            let id = twin_id.to_string();
            match db(&ctx.pool, move |pool| apply_plan(pool, &id, &out)).await {
                Ok(version) => {
                    ctx.announce(twin_id, "plan_ready", version);
                    Ok(())
                }
                Err(e) => {
                    fail(ctx, twin_id, &format!("could not save the plan: {e}")).await;
                    Err(e)
                }
            }
        }
        Err(reason) => {
            fail(ctx, twin_id, &reason).await;
            Ok(())
        }
    }
}

/// Mark the plan failed with a short reason and announce it. The opener and
/// whatever queue is on screen stay usable.
async fn fail(ctx: &JobCtx, twin_id: &str, reason: &str) {
    let short: String = reason.chars().take(240).collect();
    let id = twin_id.to_string();
    let result = db(&ctx.pool, move |pool| {
        let conn = pool.get()?;
        repo::fail_plan_on(&conn, &id, &short)?;
        Ok(repo::get_plan_on(&conn, &id)?
            .map(|p| p.version)
            .unwrap_or(0))
    })
    .await;
    let version = match result {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(twin_id = %twin_id, error = %e, "twin setup: could not record the failed plan");
            0
        }
    };
    ctx.announce(twin_id, "plan_failed", version);
}

/// Resolve a drafted step's goal reference: an existing id, `new:<n>` (the
/// n-th goal of this pass), or a slot name (its first askable goal).
fn resolve_goal<'g>(
    goal_ref: Option<&str>,
    goals: &'g [SetupGoal],
    new_ids: &[Option<String>],
    stalls: &HashMap<String, i64>,
) -> Option<&'g SetupGoal> {
    let goal_ref = goal_ref?;
    if let Some(n) = goal_ref.strip_prefix("new:") {
        let id = new_ids.get(n.trim().parse::<usize>().ok()?)?.as_deref()?;
        return goals.iter().find(|g| g.id == id);
    }
    goals.iter().find(|g| g.id == goal_ref).or_else(|| {
        let slot = goal_ref.to_lowercase();
        goals
            .iter()
            .find(|g| g.slot == slot && queue::askable(g, stalls))
    })
}

/// Insert drafted steps for goals that can still take questions, until the
/// goal's stage holds [`QUEUE_DEPTH`] queued steps. Returns how many landed.
pub(crate) fn insert_drafts(
    conn: &Connection,
    twin_id: &str,
    drafts: &[DraftStep],
    new_ids: &[Option<String>],
    only_stage: Option<&str>,
    plan_version: i64,
) -> Result<usize, AppError> {
    let goals = repo::list_goals_on(conn, twin_id)?;
    let stalls = repo::goal_stalls_on(conn, twin_id)?;
    let mut inserted = 0;
    for draft in drafts {
        let Some(goal) = resolve_goal(draft.goal_ref.as_deref(), &goals, new_ids, &stalls) else {
            continue;
        };
        if !queue::askable(goal, &stalls) {
            continue;
        }
        let stage = skeleton::stage_of_slot(&goal.slot);
        if only_stage.is_some_and(|s| s != stage) {
            continue;
        }
        if repo::count_queued_on(conn, twin_id, stage)? >= QUEUE_DEPTH {
            continue;
        }
        if repo::question_seen_on(conn, twin_id, &draft.question)? {
            continue;
        }
        repo::insert_step_on(
            conn,
            twin_id,
            &NewStep {
                goal_id: Some(&goal.id),
                stage,
                origin: "plan",
                kind: &draft.kind,
                question: &draft.question,
                answer_mode: &draft.answer_mode,
                incoming: draft.incoming.as_deref(),
                tone_channel: draft.tone_channel.as_deref(),
                suggestions: &draft.suggestions,
                plan_version,
            },
            "queued",
            Placement::Tail,
        )?;
        inserted += 1;
    }
    Ok(inserted)
}

/// Apply a deep pass in one transaction. Returns the new plan version.
pub(crate) fn apply_plan(pool: &DbPool, twin_id: &str, out: &PlanOut) -> Result<i64, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let plan = repo::get_plan_on(&tx, twin_id)?
        .ok_or_else(|| AppError::NotFound(format!("twin setup plan {twin_id}")))?;
    let existing = repo::list_goals_on(&tx, twin_id)?;

    // Goals: rewrite the ones the model named (never a dropped or pinned
    // one), insert the new ones inside the skeleton and under the per-slot cap.
    let mut live_per_slot: HashMap<String, usize> = HashMap::new();
    for g in existing.iter().filter(|g| g.state != "dropped") {
        *live_per_slot.entry(g.slot.clone()).or_default() += 1;
    }
    let mut new_ids: Vec<Option<String>> = Vec::with_capacity(out.goals.len());
    for draft in &out.goals {
        let known = draft
            .id
            .as_deref()
            .and_then(|id| existing.iter().find(|g| g.id == id));
        if let Some(goal) = known {
            if goal.state != "dropped" && !goal.pinned {
                let intent = if draft.intent.is_empty() {
                    goal.intent.as_str()
                } else {
                    draft.intent.as_str()
                };
                let criteria = if draft.criteria.is_empty() {
                    &goal.criteria
                } else {
                    &draft.criteria
                };
                repo::update_goal_text_on(&tx, twin_id, &goal.id, &draft.title, intent, criteria)?;
            }
            new_ids.push(Some(goal.id.clone()));
            continue;
        }
        let count = live_per_slot.entry(draft.slot.clone()).or_default();
        if !skeleton::is_slot(&draft.slot) || *count >= MAX_GOALS_PER_SLOT {
            new_ids.push(None);
            continue;
        }
        *count += 1;
        let id = repo::insert_goal_on(
            &tx,
            twin_id,
            &NewGoal {
                slot: &draft.slot,
                title: &draft.title,
                intent: &draft.intent,
                criteria: &draft.criteria,
            },
        )?;
        new_ids.push(Some(id));
    }
    // Every skeleton slot keeps something to steer toward.
    let now = repo::list_goals_on(&tx, twin_id)?;
    for slot in skeleton::all_slots() {
        if !now.iter().any(|g| g.slot == slot) {
            let d = skeleton::default_goal(&slot);
            let criteria: Vec<String> = d.criteria.iter().map(|c| (*c).to_string()).collect();
            repo::insert_goal_on(
                &tx,
                twin_id,
                &NewGoal {
                    slot: &slot,
                    title: d.title,
                    intent: d.intent,
                    criteria: &criteria,
                },
            )?;
        }
    }

    let observations: Vec<String> = out
        .observations
        .iter()
        .take(OBSERVATIONS_MAX)
        .cloned()
        .collect();
    repo::replace_observations_on(&tx, twin_id, &observations)?;

    // The path: every queued step (hand-overs aside) gives way to the new one.
    repo::obsolete_queued_on(&tx, twin_id, None, false)?;
    insert_drafts(&tx, twin_id, &out.steps, &new_ids, None, plan.version + 1)?;

    let version = repo::finish_plan_on(&tx, twin_id, out.change_note.as_deref())?;
    queue::ensure_live(&tx, twin_id)?;
    tx.commit()?;
    Ok(version)
}
