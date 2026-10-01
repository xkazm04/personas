//! Database -> card: the training record (SPEC.md 7) and the evidence block
//! (SPEC.md 8).
//!
//! `qa` is every answered setup step of both stages, plus the answers the
//! legacy Training Studio recorded only as `training` communications (with a
//! `training_qa` facts blob) that no answered step already carries: the
//! setup engine writes BOTH for a training answer, so the step wins and the
//! communication is the duplicate. Legacy answers carry no kind (`null`),
//! which is also how an importer tells them apart and restores them as the
//! communications they were.
//!
//! Every `answered_at` is whole-second UTC: the setup tables keep seconds,
//! so that is what survives a round trip.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Deserialize;

use super::build::cap;
use super::stamp;
use super::types::{
    CardEvidence, CardGoal, CardIdentity, CardObservation, CardQa, CardTraining, CardVoice,
    CoveragePermille, QA_MAX, RENDERER,
};
use crate::db::models::{SetupGoal, TwinProfile, TwinStyle, TwinTone};
use crate::db::repos::twin as twin_repo;
use crate::db::repos::twin_setup::{self as setup_repo, StepOrder};
use crate::db::DbPool;
use crate::engine::twin_prompt::DEFAULT_CHANNEL;
use crate::error::AppError;

/// The bio length at which identity reads as fully drawn
/// (`blueprint/blueprintModel.ts` `BIO_TARGET`).
const BIO_TARGET: usize = 50;
/// Approved memories at which knowledge reads as fully drawn
/// (`blueprint/sectionMetrics.ts` `KNOWLEDGE_FULL_AT`).
const KNOWLEDGE_FULL_AT: usize = 5;
/// The setup slots a goal may name besides `training:<topic>`.
const SETUP_SLOTS: [&str; 4] = ["identity", "tone", "channels", "memories"];

/// The training record as card data, plus what the evidence block derives
/// from it.
#[derive(Debug, Clone)]
pub(super) struct TrainingRecord {
    pub part: CardTraining,
    /// The plan's goals as stored (coverage as 0..1), for the evidence.
    pub goals: Vec<SetupGoal>,
}

/// Read the training record. Goals keep the plan's order, answers run oldest
/// first, observations best-supported first.
pub(super) fn read_record(
    pool: &DbPool,
    twin_id: &str,
    warnings: &mut Vec<String>,
) -> Result<TrainingRecord, AppError> {
    let goals = setup_repo::list_goals(pool, twin_id)?;
    let slot_of: HashMap<&str, &str> = goals
        .iter()
        .map(|g| (g.id.as_str(), g.slot.as_str()))
        .collect();

    let mut card_goals = Vec::new();
    for goal in &goals {
        if is_goal_slot(&goal.slot) {
            card_goals.push(CardGoal {
                slot: goal.slot.clone(),
                title: goal.title.clone(),
                intent: Some(goal.intent.clone()).filter(|i| !i.is_empty()),
                criteria: goal.criteria.clone(),
                state: goal.state.clone(),
                coverage_permille: permille(goal.coverage),
                answered: u32::try_from(goal.answered.max(0)).unwrap_or(u32::MAX),
            });
        } else {
            warnings.push(format!(
                "The training goal \"{}\" was left out: its slot \"{}\" is not one a card knows.",
                goal.title, goal.slot
            ));
        }
    }

    let mut qa: Vec<CardQa> = Vec::new();
    let mut carried: HashSet<(String, String)> = HashSet::new();
    let mut undated = 0usize;
    let steps = setup_repo::list_steps(
        pool,
        twin_id,
        &["answered"],
        StepOrder::Recent,
        i64::try_from(QA_MAX).unwrap_or(i64::MAX),
    )?;
    for step in steps {
        let Some(answer) = step.answer.filter(|a| !a.trim().is_empty()) else {
            continue;
        };
        let Some(answered_at) = step.answered_at.as_deref().and_then(stamp::to_card_secs) else {
            undated += 1;
            continue;
        };
        carried.insert(pair_key(&step.question, &answer));
        qa.push(CardQa {
            slot: step
                .goal_id
                .as_deref()
                .and_then(|id| slot_of.get(id))
                .map(|slot| (*slot).to_string()),
            question: step.question,
            answer,
            kind: Some(step.kind),
            incoming: step.incoming,
            answered_at,
        });
    }
    let comms = twin_repo::list_communications(
        pool,
        twin_id,
        Some("training"),
        i32::try_from(QA_MAX).unwrap_or(i32::MAX),
    )?;
    for comm in comms.iter().filter(|c| {
        c.direction == "out"
            && !c
                .contact_handle
                .as_deref()
                .is_some_and(|h| !h.trim().is_empty())
    }) {
        let Some((topic, pairs)) = legacy_pairs(comm.key_facts_json.as_deref()) else {
            continue;
        };
        let Some(answered_at) = stamp::to_card_secs(&comm.occurred_at) else {
            undated += 1;
            continue;
        };
        for pair in pairs {
            if pair.q.trim().is_empty() || pair.a.trim().is_empty() {
                continue;
            }
            if !carried.insert(pair_key(&pair.q, &pair.a)) {
                continue;
            }
            qa.push(CardQa {
                question: pair.q,
                answer: pair.a,
                kind: None,
                slot: topic.as_ref().map(|t| format!("training:{t}")),
                incoming: None,
                answered_at: answered_at.clone(),
            });
        }
    }
    if undated > 0 {
        warnings.push(format!(
            "{undated} training {} left out because {} date could not be read.",
            if undated == 1 {
                "answer was"
            } else {
                "answers were"
            },
            if undated == 1 { "its" } else { "their" }
        ));
    }
    // Oldest first by instant; the sort is stable, so steps keep their own
    // order and come before legacy answers of the same second.
    qa.sort_by_key(|item| stamp::parse_any(&item.answered_at));
    if qa.len() > QA_MAX {
        warnings.push(format!(
            "Only the {QA_MAX} most recent of {} training answers fit in a card.",
            qa.len()
        ));
        qa.drain(..qa.len() - QA_MAX);
    }

    let mut observations: Vec<CardObservation> = setup_repo::list_observations(pool, twin_id)?
        .into_iter()
        .map(|o| CardObservation {
            text: o.text,
            evidence: u32::try_from(o.evidence.max(0)).unwrap_or(u32::MAX),
        })
        .collect();
    cap(&mut observations, QA_MAX, "observations", warnings);

    Ok(TrainingRecord {
        part: CardTraining {
            goals: card_goals,
            qa,
            observations,
        },
        goals,
    })
}

/// The evidence block. Coverage uses the blueprint's formulas
/// (`src/features/plugins/twin/blueprint/sectionMetrics.ts`), expressed as
/// integers: identity = bio length against its target (0.8) + any language
/// (0.2); voice = share of channels with written directions, half credit for
/// a stored style without them, over `generic` plus every channel with a tone
/// row or a binding; knowledge = approved memories against 5; training = mean
/// coverage of the goals not dropped, `null` with none.
pub(super) fn evidence_part(
    pool: &DbPool,
    profile: &TwinProfile,
    tones: &[TwinTone],
    identity: &CardIdentity,
    voice: &CardVoice,
    record: &TrainingRecord,
) -> Result<CardEvidence, AppError> {
    let exemplars_per_channel: BTreeMap<String, u32> = voice
        .channels
        .iter()
        .map(|c| {
            (
                c.channel.clone(),
                u32::try_from(c.exemplars.len()).unwrap_or(u32::MAX),
            )
        })
        .collect();

    // JS string length (UTF-16 units), as the blueprint measures the bio.
    let bio_units = profile
        .bio
        .as_deref()
        .map(str::trim)
        .map_or(0, |bio| bio.encode_utf16().count());
    let bio_fill = (bio_units as f64 / BIO_TARGET as f64).min(1.0);
    let language_fill = if identity.languages.is_empty() {
        0.0
    } else {
        0.2
    };
    let identity_permille = permille(bio_fill * 0.8 + language_fill);

    let bound = twin_repo::list_channels(pool, &profile.id)?;
    let mut channel_ids: Vec<&str> = vec![DEFAULT_CHANNEL];
    for id in tones
        .iter()
        .map(|t| t.channel.as_str())
        .chain(bound.iter().map(|c| c.channel_type.as_str()))
    {
        if !channel_ids.contains(&id) {
            channel_ids.push(id);
        }
    }
    let half_credits: usize = channel_ids
        .iter()
        .map(|id| {
            tones
                .iter()
                .find(|t| t.channel == *id)
                .map_or(0, voice_credit)
        })
        .sum();
    let voice_permille = permille(half_credits as f64 / (2 * channel_ids.len()) as f64);

    let approved = twin_repo::list_pending_memories(pool, &profile.id, Some("approved"), None)?;
    let knowledge_permille = permille(approved.len() as f64 / KNOWLEDGE_FULL_AT as f64);

    let live: Vec<f64> = record
        .goals
        .iter()
        .filter(|g| g.state != "dropped")
        .map(|g| g.coverage.clamp(0.0, 1.0))
        .collect();
    let training_permille =
        (!live.is_empty()).then(|| permille(live.iter().sum::<f64>() / live.len() as f64));

    let readiness_percent = setup_repo::get_plan(pool, &profile.id)?
        .and_then(|plan| plan.readiness)
        .map(|r| {
            let halves: u32 = [&r.identity, &r.tone, &r.channels, &r.memories]
                .iter()
                .map(|status| match status.as_str() {
                    "set" => 2,
                    "partial" => 1,
                    _ => 0,
                })
                .sum();
            // Four slots, two halves each: 8 halves = 100 %.
            (f64::from(halves) * 12.5).round() as u32
        });

    Ok(CardEvidence {
        exemplars_per_channel,
        coverage_permille: CoveragePermille {
            identity: Some(identity_permille),
            voice: Some(voice_permille),
            knowledge: Some(knowledge_permille),
            training: training_permille,
        },
        readiness_percent,
        answers: u32::try_from(record.part.qa.len()).unwrap_or(u32::MAX),
        last_trained_at: record.part.qa.last().map(|q| q.answered_at.clone()),
        renderer: RENDERER.to_string(),
    })
}

/// 0..1 as an integer per-mille, clamped.
fn permille(fraction: f64) -> u32 {
    // INVARIANT: clamped to 0..=1000 first, so the cast cannot truncate.
    (fraction.clamp(0.0, 1.0) * 1000.0).round() as u32
}

/// A tone's voice credit in halves: 2 with written directions, 1 for a
/// stored style alone (the blueprint's `storedStyleOf`), else 0.
fn voice_credit(tone: &TwinTone) -> usize {
    if !tone.voice_directives.trim().is_empty() {
        return 2;
    }
    let styled = tone
        .style_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<TwinStyle>(raw).ok())
        .is_some_and(|s| matches!(s.source.as_str(), "preset" | "rolled" | "learned"));
    usize::from(styled)
}

/// `^(identity|tone|channels|memories|training:[a-z_]+)$`.
fn is_goal_slot(slot: &str) -> bool {
    SETUP_SLOTS.contains(&slot) || slot.strip_prefix("training:").is_some_and(is_topic_id)
}

/// `[a-z_]+`: a topic id a slot may carry.
pub(super) fn is_topic_id(topic: &str) -> bool {
    !topic.is_empty() && topic.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

fn pair_key(question: &str, answer: &str) -> (String, String) {
    (question.trim().to_string(), answer.trim().to_string())
}

/// One question and answer in a legacy `training_qa` facts blob.
#[derive(Debug, Deserialize)]
struct LegacyPair {
    q: String,
    a: String,
}

/// The two shapes `trainingQaFacts` (and `session::training_qa_facts`)
/// write: tagged with a topic, or a bare list of pairs.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum LegacyFacts {
    Tagged {
        kind: String,
        #[serde(default)]
        topic: Option<String>,
        pairs: Vec<LegacyPair>,
    },
    Bare(Vec<LegacyPair>),
}

/// The topic (when it is one a slot can carry) and the pairs of a legacy
/// training answer, or `None` when the blob is anything else.
fn legacy_pairs(raw: Option<&str>) -> Option<(Option<String>, Vec<LegacyPair>)> {
    match serde_json::from_str::<LegacyFacts>(raw?).ok()? {
        LegacyFacts::Tagged { kind, topic, pairs } if kind == "training_qa" => {
            Some((topic.filter(|t| is_topic_id(t)), pairs))
        }
        LegacyFacts::Tagged { .. } => None,
        LegacyFacts::Bare(pairs) => Some((None, pairs)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goal_slots_follow_the_schema() {
        assert!(is_goal_slot("identity"));
        assert!(is_goal_slot("training:opinions"));
        assert!(is_goal_slot("training:day_job"));
        assert!(!is_goal_slot("training:"));
        assert!(!is_goal_slot("training:Day-Job"));
        assert!(!is_goal_slot("voice"));
    }

    #[test]
    fn legacy_blobs_in_both_shapes_and_nothing_else() {
        let tagged = r#"{"kind":"training_qa","topic":"values","pairs":[{"q":"Q","a":"A"}]}"#;
        let (topic, pairs) = legacy_pairs(Some(tagged)).expect("tagged");
        assert_eq!(topic.as_deref(), Some("values"));
        assert_eq!(pairs.len(), 1);
        let (topic, pairs) = legacy_pairs(Some(r#"[{"q":"Q","a":"A"}]"#)).expect("bare");
        assert_eq!((topic, pairs.len()), (None, 1));
        assert!(legacy_pairs(Some(r#"{"kind":"other","pairs":[]}"#)).is_none());
        assert!(legacy_pairs(Some("not json")).is_none());
        assert!(legacy_pairs(None).is_none());
    }

    #[test]
    fn permille_rounds_and_clamps() {
        assert_eq!(permille(0.35), 350);
        assert_eq!(permille(0.6666), 667);
        assert_eq!(permille(1.4), 1000);
        assert_eq!(permille(-0.2), 0);
    }
}
