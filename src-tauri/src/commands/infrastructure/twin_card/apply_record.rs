//! The personal parts of an import, inside the caller's transaction: the
//! approved memories and self-facts (`knowledge`), and the training record
//! under a fresh `ready` plan (goals, answers, observations).
//!
//! Each write keeps what the card carries, so a re-export reproduces it:
//! memories keep their observed time, facts their order (decreasing stamps),
//! answers their seconds, and a legacy answer (no kind) goes back to being the
//! training communication it was exported from. An answer whose slot names no
//! imported goal keeps no slot: a step stores its goal, not a slot.

use std::collections::HashMap;

use chrono::{Duration, SecondsFormat, Utc};
use rusqlite::Connection;

use super::build_training::is_topic_id;
use super::stamp;
use super::types::{CardKnowledge, CardTraining};
use crate::db::repos::twin::{self as twin_repo, ImportedMemory};
use crate::db::repos::twin_setup::{self as setup_repo, AnsweredStep, ImportedGoal, PlanRow};
use crate::engine::twin_setup::session::training_qa_facts;
use crate::error::AppError;

/// Approved memories (observed time kept as `created_at`) and self-facts
/// citing the card (`twin-card:<card_id>`), in card order.
pub(super) fn apply_knowledge(
    conn: &Connection,
    twin_id: &str,
    knowledge: &CardKnowledge,
    card_id: &str,
    warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    let mut undated = 0usize;
    for memory in &knowledge.memories {
        let Some(observed_at) = stamp::rfc3339_verbatim(&memory.observed_at) else {
            undated += 1;
            continue;
        };
        twin_repo::insert_approved_memory_on(
            conn,
            twin_id,
            &ImportedMemory {
                channel: memory.source.as_deref(),
                content: &memory.content,
                title: memory.title.as_deref(),
                importance: i32::from(memory.importance),
                observed_at: &observed_at,
            },
        )?;
    }
    if undated > 0 {
        warnings.push(format!(
            "{undated} {} without a readable date not imported.",
            if undated == 1 {
                "memory was"
            } else {
                "memories were"
            }
        ));
    }
    // Facts of equal importance read back newest `last_seen_at` first, so
    // each next fact is stamped one millisecond earlier: the card's order
    // survives.
    let base = Utc::now();
    for (i, fact) in knowledge.facts.iter().enumerate() {
        let seen_at = (base - Duration::milliseconds(i64::try_from(i).unwrap_or(i64::MAX)))
            .to_rfc3339_opts(SecondsFormat::Millis, true);
        twin_repo::insert_card_fact_on(
            conn,
            twin_id,
            &fact.content,
            i32::from(fact.importance),
            card_id,
            &seen_at,
        )?;
    }
    Ok(())
}

/// The training record under a fresh `ready` plan. An empty record writes
/// nothing, not even the plan.
pub(super) fn apply_training(
    conn: &Connection,
    twin_id: &str,
    training: &CardTraining,
    warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    if training.goals.is_empty() && training.qa.is_empty() && training.observations.is_empty() {
        return Ok(());
    }
    const PLAN_VERSION: i64 = 1;
    let any_training = training
        .goals
        .iter()
        .map(|g| g.slot.as_str())
        .chain(training.qa.iter().filter_map(|q| q.slot.as_deref()))
        .any(|slot| slot.starts_with("training:"));
    setup_repo::upsert_plan_on(
        conn,
        &PlanRow {
            status: "ready".to_string(),
            version: PLAN_VERSION,
            stage: if any_training { "training" } else { "setup" }.to_string(),
            ..PlanRow::fresh(twin_id)
        },
    )?;

    let mut goal_for_slot: HashMap<&str, String> = HashMap::new();
    for goal in &training.goals {
        let id = setup_repo::insert_imported_goal_on(
            conn,
            twin_id,
            &ImportedGoal {
                slot: &goal.slot,
                title: &goal.title,
                intent: goal.intent.as_deref().unwrap_or_default(),
                criteria: &goal.criteria,
                state: &goal.state,
                coverage: f64::from(goal.coverage_permille) / 1000.0,
                answered: i64::from(goal.answered),
            },
        )?;
        goal_for_slot.entry(goal.slot.as_str()).or_insert(id);
    }

    let mut undated = 0usize;
    for qa in &training.qa {
        match qa.kind.as_deref() {
            Some(kind) => {
                let Some(answered_at) = stamp::to_sqlite(&qa.answered_at) else {
                    undated += 1;
                    continue;
                };
                let slot = qa.slot.as_deref();
                setup_repo::insert_answered_step_on(
                    conn,
                    twin_id,
                    &AnsweredStep {
                        goal_id: slot.and_then(|s| goal_for_slot.get(s)).map(String::as_str),
                        stage: if slot.is_some_and(|s| s.starts_with("training:")) {
                            "training"
                        } else {
                            "setup"
                        },
                        kind,
                        question: &qa.question,
                        answer: &qa.answer,
                        incoming: qa.incoming.as_deref(),
                        answered_at: &answered_at,
                        plan_version: PLAN_VERSION,
                    },
                )?;
            }
            None => {
                // A legacy Training Studio answer: restored as the training
                // communication it was exported from.
                let Some(occurred_at) = stamp::rfc3339_verbatim(&qa.answered_at) else {
                    undated += 1;
                    continue;
                };
                let topic = qa
                    .slot
                    .as_deref()
                    .and_then(|s| s.strip_prefix("training:"))
                    .filter(|t| is_topic_id(t));
                twin_repo::insert_training_answer_on(
                    conn,
                    twin_id,
                    &qa.question,
                    &qa.answer,
                    &training_qa_facts(&qa.question, &qa.answer, topic),
                    &occurred_at,
                )?;
            }
        }
    }
    if undated > 0 {
        warnings.push(format!(
            "{undated} training {} without a readable date not imported.",
            if undated == 1 {
                "answer was"
            } else {
                "answers were"
            }
        ));
    }

    // One stamp for every observation: equal evidence then keeps card order.
    let noted_at = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    for observation in &training.observations {
        setup_repo::insert_observation_on(
            conn,
            twin_id,
            &observation.text,
            i64::from(observation.evidence),
            &noted_at,
        )?;
    }
    Ok(())
}
