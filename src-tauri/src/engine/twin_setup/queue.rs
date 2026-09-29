//! Queue rules shared by the operations and the background jobs: which goal
//! the plan is steering toward, which queued step goes live next, and which
//! goals a refill writes for.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::db::models::{SetupGoal, SetupReadiness, SetupStep};
use crate::db::repos::twin_setup::{self as repo, PlanRow, StepOrder};
use crate::error::AppError;

use super::skeleton::{self, STALL_LIMIT};

/// Upper bound on queued steps read when choosing the next one.
const QUEUE_SCAN: i64 = 200;

/// A goal can still receive questions: open, and not stalled.
pub(crate) fn askable(goal: &SetupGoal, stalls: &HashMap<String, i64>) -> bool {
    goal.state == "open" && stalls.get(&goal.id).copied().unwrap_or(0) < STALL_LIMIT
}

/// What the plan's steering asks the next question to be about.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Preference {
    /// No steering: the head of the stage's queue.
    Any,
    /// Only these goals (focus slot / chosen topic). A goal-less step — a
    /// hand-over, an opener's follow-up — always matches.
    Strict(Vec<String>),
    /// These goals first, else the head (training with no topic chosen).
    Soft(Vec<String>),
}

impl Preference {
    pub(crate) fn admits(&self, goal_id: Option<&str>) -> bool {
        match (self, goal_id) {
            (_, None) | (Preference::Any, _) => true,
            (Preference::Strict(ids) | Preference::Soft(ids), Some(id)) => {
                ids.iter().any(|g| g == id)
            }
        }
    }
}

/// The steering the plan row expresses, over the goals as they stand.
pub(crate) fn preference(
    plan: &PlanRow,
    goals: &[SetupGoal],
    stalls: &HashMap<String, i64>,
) -> Preference {
    let open_in = |slot: &str| -> Vec<String> {
        goals
            .iter()
            .filter(|g| g.slot == slot && askable(g, stalls))
            .map(|g| g.id.clone())
            .collect()
    };
    match plan.stage.as_str() {
        "setup" => match plan.focus_slot.as_deref() {
            Some(slot) => {
                let ids = open_in(slot);
                if ids.is_empty() {
                    Preference::Any
                } else {
                    Preference::Strict(ids)
                }
            }
            None => Preference::Any,
        },
        _ => match plan
            .topic_preset
            .as_deref()
            .filter(|t| skeleton::is_topic(t))
        {
            Some(topic) => {
                let ids = open_in(&skeleton::training_slot(topic));
                if ids.is_empty() {
                    Preference::Any
                } else {
                    Preference::Strict(ids)
                }
            }
            None => goals
                .iter()
                .filter(|g| skeleton::stage_of_slot(&g.slot) == "training" && askable(g, stalls))
                .min_by(|a, b| {
                    a.coverage
                        .total_cmp(&b.coverage)
                        .then(a.position.cmp(&b.position))
                })
                .map(|g| Preference::Soft(vec![g.id.clone()]))
                .unwrap_or(Preference::Any),
        },
    }
}

/// The queued step of the plan's stage that should go live next, if any.
pub(crate) fn pick_next(
    conn: &Connection,
    plan: &PlanRow,
    goals: &[SetupGoal],
    stalls: &HashMap<String, i64>,
) -> Result<Option<SetupStep>, AppError> {
    let queued: Vec<SetupStep> = repo::list_steps_on(
        conn,
        &plan.twin_id,
        &["queued"],
        StepOrder::Position,
        QUEUE_SCAN,
    )?
    .into_iter()
    .filter(|s| s.stage == plan.stage)
    .collect();
    let pref = preference(plan, goals, stalls);
    let matched = queued
        .iter()
        .find(|s| pref.admits(s.goal_id.as_deref()))
        .cloned();
    Ok(match pref {
        Preference::Soft(_) => matched.or_else(|| queued.first().cloned()),
        _ => matched,
    })
}

/// What [`ensure_live`] found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LiveState {
    /// A step was already live.
    HasLive,
    /// A queued step was promoted.
    Promoted,
    /// No live step and nothing fit to promote.
    Starved,
}

/// Make sure the twin has a live step: promote [`pick_next`] when none is.
pub(crate) fn ensure_live(conn: &Connection, twin_id: &str) -> Result<LiveState, AppError> {
    if repo::live_step_on(conn, twin_id)?.is_some() {
        return Ok(LiveState::HasLive);
    }
    let Some(plan) = repo::get_plan_on(conn, twin_id)? else {
        return Ok(LiveState::Starved);
    };
    let goals = repo::list_goals_on(conn, twin_id)?;
    let stalls = repo::goal_stalls_on(conn, twin_id)?;
    match pick_next(conn, &plan, &goals, &stalls)? {
        Some(step) if repo::make_live_on(conn, twin_id, &step.id)? => Ok(LiveState::Promoted),
        _ => Ok(LiveState::Starved),
    }
}

/// Push the live step back to the head of the queue when it no longer fits
/// the plan's stage or steering. Returns whether it moved.
pub(crate) fn requeue_if_off_target(conn: &Connection, twin_id: &str) -> Result<bool, AppError> {
    let Some(live) = repo::live_step_on(conn, twin_id)? else {
        return Ok(false);
    };
    let Some(plan) = repo::get_plan_on(conn, twin_id)? else {
        return Ok(false);
    };
    let goals = repo::list_goals_on(conn, twin_id)?;
    let stalls = repo::goal_stalls_on(conn, twin_id)?;
    let off_stage = live.stage != plan.stage;
    let off_steer = match preference(&plan, &goals, &stalls) {
        Preference::Strict(ids) => live
            .goal_id
            .as_deref()
            .is_some_and(|g| !ids.iter().any(|id| id == g)),
        _ => false,
    };
    if off_stage || off_steer {
        return repo::requeue_at_head_on(conn, twin_id, &live.id);
    }
    Ok(false)
}

/// Whether readiness shows `slot` as done. Training slots are never "set":
/// readiness does not measure them.
fn slot_is_set(readiness: Option<&SetupReadiness>, slot: &str) -> bool {
    let Some(r) = readiness else {
        return false;
    };
    let value = match slot {
        "identity" => &r.identity,
        "tone" => &r.tone,
        "channels" => &r.channels,
        "memories" => &r.memories,
        _ => return false,
    };
    value == "set"
}

/// The goals a refill writes for, best first: askable goals of the plan's
/// stage (narrowed to the steering's goals when it is strict), ordered pinned
/// first, then goals whose slot readiness does not show as set, then lowest
/// coverage, then position.
pub(crate) fn refill_targets(
    plan: &PlanRow,
    goals: &[SetupGoal],
    stalls: &HashMap<String, i64>,
    limit: usize,
) -> Vec<SetupGoal> {
    let pref = preference(plan, goals, stalls);
    let mut targets: Vec<SetupGoal> = goals
        .iter()
        .filter(|g| skeleton::stage_of_slot(&g.slot) == plan.stage && askable(g, stalls))
        .filter(|g| match &pref {
            Preference::Strict(ids) => ids.contains(&g.id),
            _ => true,
        })
        .cloned()
        .collect();
    let readiness = plan.readiness.as_ref();
    targets.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(slot_is_set(readiness, &a.slot).cmp(&slot_is_set(readiness, &b.slot)))
            .then(a.coverage.total_cmp(&b.coverage))
            .then(a.position.cmp(&b.position))
    });
    targets.truncate(limit);
    targets
}

#[cfg(test)]
mod tests {
    use super::*;

    fn goal(id: &str, slot: &str, coverage: f64, pinned: bool, state: &str) -> SetupGoal {
        SetupGoal {
            id: id.into(),
            slot: slot.into(),
            title: id.into(),
            intent: String::new(),
            criteria: vec![],
            state: state.into(),
            pinned,
            coverage,
            position: 0,
            answered: 0,
        }
    }

    #[test]
    fn twin_setup_refill_targets_order_pinned_unset_then_coverage() {
        let mut plan = PlanRow::fresh("t");
        plan.readiness = Some(SetupReadiness {
            identity: "set".into(),
            tone: "partial".into(),
            channels: "empty".into(),
            memories: "empty".into(),
        });
        let goals = vec![
            goal("id", "identity", 0.1, false, "open"),
            goal("tone", "tone", 0.5, false, "open"),
            goal("chan", "channels", 0.2, false, "open"),
            goal("pin", "memories", 0.9, true, "open"),
            goal("drop", "memories", 0.0, false, "dropped"),
            goal("stalled", "tone", 0.0, false, "open"),
            goal("train", "training:values", 0.0, false, "open"),
        ];
        let stalls = HashMap::from([("stalled".to_string(), 3)]);
        let ids: Vec<String> = refill_targets(&plan, &goals, &stalls, 10)
            .into_iter()
            .map(|g| g.id)
            .collect();
        assert_eq!(ids, ["pin", "chan", "tone", "id"]);

        plan.focus_slot = Some("tone".into());
        let ids: Vec<String> = refill_targets(&plan, &goals, &stalls, 10)
            .into_iter()
            .map(|g| g.id)
            .collect();
        assert_eq!(ids, ["tone"], "a focus narrows the targets to its slot");
    }

    #[test]
    fn twin_setup_training_without_topic_prefers_least_covered() {
        let mut plan = PlanRow::fresh("t");
        plan.stage = "training".into();
        let goals = vec![
            goal("a", "training:values", 0.6, false, "open"),
            goal("b", "training:personal", 0.1, false, "open"),
        ];
        assert_eq!(
            preference(&plan, &goals, &HashMap::new()),
            Preference::Soft(vec!["b".into()])
        );
        plan.topic_preset = Some("values".into());
        assert_eq!(
            preference(&plan, &goals, &HashMap::new()),
            Preference::Strict(vec!["a".into()])
        );
    }
}
