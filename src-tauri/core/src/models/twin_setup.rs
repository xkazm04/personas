//! The twin setup plan — wire types for the planned guided setup.
//!
//! `twin_setup_turn` produced one question per call and kept no state; the
//! plan keeps the conversation durable (migration `e47_twin_setup_plan`): a
//! plan per twin, the goals it works toward, a queue of steps, the offers each
//! answer produced and what the engine has observed about the person.
//!
//! Every command in `commands::infrastructure::twin_setup` returns the whole
//! [`SetupSessionSnapshot`], so the client never merges partial state. Strings
//! stay strings on the wire; each field's vocabulary is named in its doc
//! comment and enforced by a CHECK in the migration — keep the two identical.
//!
//! Optionals serialize as `null` (TS `T | null`), lists are never null.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::SetupSuggestion;

/// One thing the plan is trying to learn about the person.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupGoal {
    pub id: String,
    /// `identity` | `tone` | `channels` | `memories` | `training:<presetId>`.
    pub slot: String,
    pub title: String,
    /// One line on why the goal matters; `""` when the planner gave none.
    pub intent: String,
    /// What "covered" means for this goal, one criterion per entry.
    pub criteria: Vec<String>,
    /// `open` | `covered` | `dropped`.
    pub state: String,
    /// The operator pinned it: a re-plan must keep it.
    pub pinned: bool,
    /// 0.0 – 1.0, how much of the goal the answers so far cover.
    #[ts(type = "number")]
    pub coverage: f64,
    #[ts(type = "number")]
    pub position: i64,
    /// Steps answered against this goal.
    #[ts(type = "number")]
    pub answered: i64,
}

/// One question in the plan — queued, live, or in the transcript.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupStep {
    pub id: String,
    pub goal_id: Option<String>,
    /// `setup` | `training`.
    pub stage: String,
    /// `opener` | `plan` | `follow_up` | `handoff`.
    pub origin: String,
    /// `scene` | `opinion` | `reply_drill` | `fact` | `rule` | `preference`.
    pub kind: String,
    pub question: String,
    /// `pick` (choose among `suggestions`) | `write` (the answer IS a writing
    /// sample, `suggestions` is empty by contract).
    pub answer_mode: String,
    /// For a `write` step, the message being replied to, verbatim.
    pub incoming: Option<String>,
    /// Tone channel id the step is about, when it is about one.
    pub tone_channel: Option<String>,
    pub suggestions: Vec<SetupSuggestion>,
    /// `queued` | `live` | `answered` | `skipped` | `obsolete`.
    pub status: String,
    pub answer: Option<String>,
    #[ts(type = "number")]
    pub position: i64,
    pub asked_at: Option<String>,
    pub answered_at: Option<String>,
    /// The engine has folded this answer into offers and observations.
    pub reconciled: bool,
}

/// A typed value proposed for a real field. Nothing writes the field until the
/// operator accepts (or edits) the offer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupOffer {
    pub id: String,
    /// The answered step this offer came from.
    pub step_id: String,
    /// `reconcile` (derived from an answer) | `sample` (the person's own words
    /// offered as a tone example).
    pub origin: String,
    /// `bio` | `role` | `tone`.
    pub kind: String,
    /// For `kind == "tone"`: `voice` | `examples` | `constraints`; else `null`.
    pub part: Option<String>,
    /// Tone channel id for `kind == "tone"`; else `null`.
    pub channel: Option<String>,
    pub value: String,
    /// Reply-length guidance, only meaningful for a tone offer.
    pub length_hint: Option<String>,
    /// One line saying why this is offered; `""` when none was given.
    pub reason: String,
    /// `open` | `accepted` | `edited` | `dismissed`.
    pub status: String,
}

/// Something the engine noticed about the person across answers.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupObservation {
    pub id: String,
    pub text: String,
    /// How many answers support it (starts at 1).
    #[ts(type = "number")]
    pub evidence: i64,
    pub updated_at: String,
}

/// The client's readiness reading, handed to the planner so it plans against
/// what is actually filled in. Each value is `set` | `partial` | `empty`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupReadiness {
    pub identity: String,
    pub tone: String,
    pub channels: String,
    pub memories: String,
}

/// A question the client asks first, before any plan exists, so the opening
/// wait is filled with something real.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupOpener {
    /// Same vocabulary as [`SetupGoal::slot`].
    pub slot: String,
    pub question: String,
}

/// The whole setup session as the client renders it. Every twin-setup command
/// returns one.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupSessionSnapshot {
    pub twin_id: String,
    /// `setup` | `training`.
    pub stage: String,
    pub topic_preset: Option<String>,
    /// Same vocabulary as [`SetupGoal::slot`].
    pub focus_slot: Option<String>,
    /// `building` | `ready` | `failed`. A twin with no plan yet reads
    /// `building` with `plan_version == 0` and `planning == false`.
    pub plan_status: String,
    #[ts(type = "number")]
    pub plan_version: i64,
    pub plan_error: Option<String>,
    /// One line on what the last re-plan changed, for the client to announce.
    pub change_note: Option<String>,
    /// Ordered by position.
    pub goals: Vec<SetupGoal>,
    /// The one live step, if any.
    pub live: Option<SetupStep>,
    /// Up to 5 queued steps, by position.
    pub upcoming: Vec<SetupStep>,
    /// The last 50 answered or skipped steps, oldest first.
    pub transcript: Vec<SetupStep>,
    /// Open offers, plus offers resolved since the live step was asked.
    pub offers: Vec<SetupOffer>,
    /// Ids of the offers produced by the most recent answered step.
    pub last_answer_offer_ids: Vec<String>,
    pub observations: Vec<SetupObservation>,
    /// The plan is being (re)built.
    pub planning: bool,
    /// Some answered step has not been reconciled yet.
    pub reconciling: bool,
}

/// Payload of `twin-setup-updated` (`event_name::TWIN_SETUP_UPDATED`): the
/// background engine changed the session; the client refetches the snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupUpdatedEvent {
    pub twin_id: String,
    /// `plan_ready` | `plan_failed` | `reconciled` | `refilled`.
    pub reason: String,
    #[ts(type = "number")]
    pub plan_version: i64,
}

/// How one step kind performs across ALL twins — the planner's prior for
/// which kinds of question are worth asking.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupKindStat {
    /// Same vocabulary as [`SetupStep::kind`].
    pub kind: String,
    /// Answered + skipped.
    #[ts(type = "number")]
    pub asked: i64,
    #[ts(type = "number")]
    pub skipped: i64,
    #[ts(type = "number")]
    pub offers_made: i64,
    #[ts(type = "number")]
    pub offers_accepted: i64,
    /// Mean `coverage_gain` over steps that recorded one; 0 when none did.
    #[ts(type = "number")]
    pub mean_gain: f64,
}

/// An operator's steering of the plan. Internally tagged on `action`:
/// `{"action":"dropGoal","goalId":"g1"}`, `{"action":"redeal"}`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum SetupSteer {
    #[serde(rename_all = "camelCase")]
    DropGoal { goal_id: String },
    #[serde(rename_all = "camelCase")]
    PinGoal { goal_id: String, pinned: bool },
    #[serde(rename_all = "camelCase")]
    RestoreGoal { goal_id: String },
    /// Make this queued step the next one asked.
    #[serde(rename_all = "camelCase")]
    AskNext { step_id: String },
    /// `stage` is `setup` | `training`.
    #[serde(rename_all = "camelCase")]
    SetStage { stage: String },
    #[serde(rename_all = "camelCase")]
    SetTopic {
        preset_id: Option<String>,
        prompt: Option<String>,
    },
    /// `slot` uses the [`SetupGoal::slot`] vocabulary.
    #[serde(rename_all = "camelCase")]
    FocusSlot { slot: String },
    /// Questions handed over from elsewhere, asked verbatim.
    #[serde(rename_all = "camelCase")]
    EnqueueHandoff { questions: Vec<String> },
    /// Throw away the queued steps and plan fresh ones.
    Redeal {},
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The steer wire shape is internally tagged, camelCase in both the tag
    /// value and the fields, and a field-less variant is just its tag.
    #[test]
    fn twin_setup_steer_wire_shape_round_trips() -> Result<(), serde_json::Error> {
        let drop = SetupSteer::DropGoal {
            goal_id: "g1".into(),
        };
        assert_eq!(
            serde_json::to_string(&drop)?,
            r#"{"action":"dropGoal","goalId":"g1"}"#
        );
        assert_eq!(
            serde_json::to_string(&SetupSteer::Redeal {})?,
            r#"{"action":"redeal"}"#
        );

        let parsed: SetupSteer = serde_json::from_str(r#"{"action":"redeal"}"#)?;
        assert!(matches!(parsed, SetupSteer::Redeal {}));
        let parsed: SetupSteer = serde_json::from_str(r#"{"action":"dropGoal","goalId":"g1"}"#)?;
        assert!(matches!(parsed, SetupSteer::DropGoal { ref goal_id } if goal_id == "g1"));
        let parsed: SetupSteer =
            serde_json::from_str(r#"{"action":"setTopic","presetId":null,"prompt":"travel"}"#)?;
        assert!(matches!(
            parsed,
            SetupSteer::SetTopic { preset_id: None, prompt: Some(ref p) } if p == "travel"
        ));
        let parsed: SetupSteer =
            serde_json::from_str(r#"{"action":"enqueueHandoff","questions":["a","b"]}"#)?;
        assert!(
            matches!(parsed, SetupSteer::EnqueueHandoff { ref questions } if questions.len() == 2)
        );
        Ok(())
    }

    /// Optionals serialize as `null`, never omitted.
    #[test]
    fn twin_setup_optionals_serialize_as_null() -> Result<(), serde_json::Error> {
        let obs = SetupUpdatedEvent {
            twin_id: "t".into(),
            reason: "plan_ready".into(),
            plan_version: 1,
        };
        assert_eq!(
            serde_json::to_string(&obs)?,
            r#"{"twinId":"t","reason":"plan_ready","planVersion":1}"#
        );
        let opener = serde_json::to_value(SetupStep {
            id: "s".into(),
            goal_id: None,
            stage: "setup".into(),
            origin: "opener".into(),
            kind: "fact".into(),
            question: "q".into(),
            answer_mode: "pick".into(),
            incoming: None,
            tone_channel: None,
            suggestions: vec![],
            status: "live".into(),
            answer: None,
            position: 0,
            asked_at: None,
            answered_at: None,
            reconciled: false,
        })?;
        assert!(opener.get("goalId").is_some_and(|v| v.is_null()));
        assert!(opener.get("answeredAt").is_some_and(|v| v.is_null()));
        Ok(())
    }
}
