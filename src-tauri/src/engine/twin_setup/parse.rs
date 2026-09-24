//! The three reply doors: `assess`, `refill`, `plan`.
//!
//! Each door takes the model's raw text, finds the JSON object in it, parses
//! it into private raw structs, then re-imposes what code owns: the kind and
//! answer-mode vocabularies, the `write`-step contract (no suggestions, an
//! incoming message), the offer vocabulary (a sample message is never the
//! model's to write), and the plain-voice post-checks on every question and
//! suggestion. A door returns `Err(reason)` only when the reply is unusable;
//! the reason feeds the ONE repair retry.

use serde::Deserialize;

use crate::commands::infrastructure::twin_voice::{
    reads_as_assistant, soften_dashes, strip_filler_opener,
};
use crate::db::models::SetupSuggestion;

/// The most suggestions a step carries (the table deals three cards).
pub(crate) const SUGGESTIONS_MAX: usize = 3;

/// The step kinds (mirrors the `kind` CHECK in `e47_twin_setup_plan`).
pub(crate) const KINDS: [&str; 6] = [
    "scene",
    "opinion",
    "reply_drill",
    "fact",
    "rule",
    "preference",
];

// ---------------------------------------------------------------------------
// Raw shapes — lenient on missing keys, strict on the shape of what is there
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSuggestion {
    text: String,
    reason: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawStep {
    goal_id: Option<String>,
    kind: String,
    question: String,
    answer_mode: String,
    incoming: Option<String>,
    tone_channel: Option<String>,
    suggestions: Vec<RawSuggestion>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawCoverage {
    goal_id: String,
    coverage: f64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawOffer {
    kind: String,
    part: Option<String>,
    channel: Option<String>,
    value: String,
    length_hint: Option<String>,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAssess {
    coverage: Vec<RawCoverage>,
    #[serde(default)]
    offers: Vec<RawOffer>,
    #[serde(default)]
    follow_up: Option<RawStep>,
    #[serde(default)]
    observation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRefill {
    steps: Vec<RawStep>,
    #[serde(default)]
    obsolete: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawGoal {
    id: Option<String>,
    slot: String,
    title: String,
    intent: String,
    criteria: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPlan {
    goals: Vec<RawGoal>,
    #[serde(default)]
    observations: Vec<String>,
    steps: Vec<RawStep>,
    #[serde(default)]
    change_note: String,
}

// ---------------------------------------------------------------------------
// Clean shapes
// ---------------------------------------------------------------------------

/// A question the model drafted, after the post-checks.
#[derive(Debug, Clone)]
pub(crate) struct DraftStep {
    /// As the model wrote it: an existing goal id, `new:<n>` (plan only), or a
    /// slot name. Resolved against the goals at apply time.
    pub goal_ref: Option<String>,
    pub kind: String,
    pub question: String,
    /// `pick` | `write`.
    pub answer_mode: String,
    pub incoming: Option<String>,
    pub tone_channel: Option<String>,
    pub suggestions: Vec<SetupSuggestion>,
}

/// A field value the assessor proposes.
#[derive(Debug, Clone)]
pub(crate) struct DraftOffer {
    /// `bio` | `role` | `tone`.
    pub kind: String,
    /// `voice` | `constraints` for a tone offer, else `None`.
    pub part: Option<String>,
    /// A tone offer's channel (default `generic`), else `None`.
    pub channel: Option<String>,
    pub value: String,
    pub length_hint: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AssessOut {
    /// `(goal id, coverage)`, coverage clamped to 0..=1.
    pub coverage: Vec<(String, f64)>,
    pub offers: Vec<DraftOffer>,
    pub follow_up: Option<DraftStep>,
    pub observation: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct RefillOut {
    pub steps: Vec<DraftStep>,
    pub obsolete: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct DraftGoal {
    pub id: Option<String>,
    pub slot: String,
    pub title: String,
    pub intent: String,
    pub criteria: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct PlanOut {
    pub goals: Vec<DraftGoal>,
    pub observations: Vec<String>,
    pub steps: Vec<DraftStep>,
    pub change_note: Option<String>,
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

fn parse_json<'de, T: Deserialize<'de>>(raw: &'de str, what: &str) -> Result<T, String> {
    let span = crate::companion::brain::oneshot::extract_json_span(raw, what)
        .map_err(|e| e.to_string())?;
    serde_json::from_str(span).map_err(|e| format!("invalid JSON: {e}"))
}

/// The `assess` door. `dashes_are_theirs`: the person's own answers use clause
/// dashes, so suggestions and values keep theirs.
pub(crate) fn parse_assess(raw: &str, dashes_are_theirs: bool) -> Result<AssessOut, String> {
    let parsed: RawAssess = parse_json(raw, "twin setup assess")?;
    let coverage = parsed
        .coverage
        .into_iter()
        .filter(|c| !c.goal_id.trim().is_empty() && c.coverage.is_finite())
        .map(|c| (c.goal_id.trim().to_string(), c.coverage.clamp(0.0, 1.0)))
        .collect();
    let offers = parsed
        .offers
        .into_iter()
        .filter_map(|o| clean_offer(o, dashes_are_theirs))
        .collect();
    let follow_up = parsed
        .follow_up
        .and_then(|s| clean_step(s, dashes_are_theirs));
    let observation = parsed
        .observation
        .map(|o| soften_dashes(o.trim()))
        .filter(|o| !o.is_empty());
    Ok(AssessOut {
        coverage,
        offers,
        follow_up,
        observation,
    })
}

/// The `refill` door.
pub(crate) fn parse_refill(raw: &str, dashes_are_theirs: bool) -> Result<RefillOut, String> {
    let parsed: RawRefill = parse_json(raw, "twin setup refill")?;
    Ok(RefillOut {
        steps: clean_steps(parsed.steps, dashes_are_theirs),
        obsolete: parsed
            .obsolete
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .collect(),
    })
}

/// The `plan` door. A plan with neither goals nor steps is unusable.
pub(crate) fn parse_plan(raw: &str, dashes_are_theirs: bool) -> Result<PlanOut, String> {
    let parsed: RawPlan = parse_json(raw, "twin setup plan")?;
    let goals: Vec<DraftGoal> = parsed
        .goals
        .into_iter()
        .filter_map(|g| {
            let title = soften_dashes(g.title.trim());
            if title.is_empty() {
                return None;
            }
            Some(DraftGoal {
                id: g
                    .id
                    .map(|id| id.trim().to_string())
                    .filter(|id| !id.is_empty()),
                slot: g.slot.trim().to_lowercase(),
                title,
                intent: soften_dashes(g.intent.trim()),
                criteria: g
                    .criteria
                    .iter()
                    .map(|c| soften_dashes(c.trim()))
                    .filter(|c| !c.is_empty())
                    .take(6)
                    .collect(),
            })
        })
        .collect();
    let steps = clean_steps(parsed.steps, dashes_are_theirs);
    if goals.is_empty() && steps.is_empty() {
        return Err("the plan had no usable goals and no usable steps".to_string());
    }
    let mut observations: Vec<String> = Vec::new();
    for o in parsed.observations {
        let o = soften_dashes(o.trim());
        if !o.is_empty() && !observations.iter().any(|x| x.eq_ignore_ascii_case(&o)) {
            observations.push(o);
        }
    }
    Ok(PlanOut {
        goals,
        observations,
        steps,
        change_note: Some(soften_dashes(parsed.change_note.trim())).filter(|n| !n.is_empty()),
    })
}

fn clean_steps(raw: Vec<RawStep>, dashes_are_theirs: bool) -> Vec<DraftStep> {
    let mut out: Vec<DraftStep> = Vec::new();
    for step in raw {
        if let Some(step) = clean_step(step, dashes_are_theirs) {
            if !out
                .iter()
                .any(|s| s.question.eq_ignore_ascii_case(&step.question))
            {
                out.push(step);
            }
        }
    }
    out
}

/// One drafted step through the post-checks; `None` when the question is empty.
fn clean_step(raw: RawStep, dashes_are_theirs: bool) -> Option<DraftStep> {
    let question = soften_dashes(&strip_filler_opener(&raw.question));
    let question = question.trim().to_string();
    if question.is_empty() {
        return None;
    }
    let write = raw.answer_mode.trim().eq_ignore_ascii_case("write");
    let kind = raw.kind.trim().to_lowercase();
    let kind = if KINDS.contains(&kind.as_str()) {
        kind
    } else if write {
        "reply_drill".to_string()
    } else {
        "fact".to_string()
    };
    let (answer_mode, incoming, suggestions) = if write {
        let incoming = raw
            .incoming
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        ("write".to_string(), incoming, Vec::new())
    } else {
        let mut seen: Vec<String> = Vec::new();
        let mut suggestions = Vec::new();
        for s in raw.suggestions {
            let text = their_voice(&s.text, dashes_are_theirs);
            let key = text.to_lowercase();
            if text.is_empty() || reads_as_assistant(&text) || seen.contains(&key) {
                continue;
            }
            seen.push(key);
            suggestions.push(SetupSuggestion {
                text,
                reason: soften_dashes(s.reason.trim()),
            });
            if suggestions.len() == SUGGESTIONS_MAX {
                break;
            }
        }
        ("pick".to_string(), None, suggestions)
    };
    Some(DraftStep {
        goal_ref: raw
            .goal_id
            .map(|g| g.trim().to_string())
            .filter(|g| !g.is_empty()),
        kind,
        question,
        answer_mode,
        incoming,
        tone_channel: raw
            .tone_channel
            .map(|c| c.trim().to_lowercase())
            .filter(|c| !c.is_empty()),
        suggestions,
    })
}

/// An offer through the validation the old per-turn setup parser gave proposals:
/// kind `bio` | `role` | `tone`, tone part `voice` | `constraints` — an
/// `examples` part is dropped, because a sample message is the person's own
/// words or it is nothing — and a tone channel defaulting to `generic`.
fn clean_offer(raw: RawOffer, dashes_are_theirs: bool) -> Option<DraftOffer> {
    let value = their_voice(&raw.value, dashes_are_theirs);
    if value.is_empty() {
        return None;
    }
    let kind = raw.kind.trim().to_lowercase();
    let reason = soften_dashes(raw.reason.trim());
    let length_hint = raw
        .length_hint
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty());
    match kind.as_str() {
        "bio" | "role" => Some(DraftOffer {
            kind,
            part: None,
            channel: None,
            value,
            length_hint: None,
            reason,
        }),
        "tone" => {
            let part = raw.part.as_deref().map(|s| s.trim().to_lowercase());
            let part = match part.as_deref() {
                None | Some("") | Some("voice") => "voice",
                Some("constraints") | Some("constraint") => "constraints",
                Some(_) => return None,
            };
            let channel = raw.channel.as_deref().map(str::trim).unwrap_or("");
            Some(DraftOffer {
                kind,
                part: Some(part.to_string()),
                channel: Some(if channel.is_empty() {
                    "generic".to_string()
                } else {
                    channel.to_string()
                }),
                value,
                length_hint,
                reason,
            })
        }
        _ => None,
    }
}

fn their_voice(text: &str, dashes_are_theirs: bool) -> String {
    let text = text.trim();
    if dashes_are_theirs {
        text.to_string()
    } else {
        soften_dashes(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn twin_setup_parse_assess_validates_offers_and_clamps() -> Result<(), String> {
        let raw = r#"Sure:
```json
{"coverage":[{"goalId":"g1","coverage":1.7,"why":"x"},{"goalId":"g2","coverage":-1}],
 "offers":[
   {"kind":"bio","part":"voice","channel":"slack","value":"I build things.","reason":"said so"},
   {"kind":"tone","part":"examples","channel":"slack","value":"sg","reason":"sample"},
   {"kind":"tone","part":null,"channel":"","value":"Lowercase, one line.","reason":"seen"},
   {"kind":"avatar","value":"x"}
 ],
 "followUp":{"question":"Great! Which is more you: a or b?","kind":"preference","answerMode":"pick",
   "suggestions":[{"text":"a","reason":"r"},{"text":"A","reason":"dup"},{"text":"I'd be happy to help","reason":"assistant"}]},
 "observation":"Writes short."}
```"#;
        let out = parse_assess(raw, false)?;
        assert_eq!(
            out.coverage,
            [("g1".to_string(), 1.0), ("g2".to_string(), 0.0)]
        );
        assert_eq!(
            out.offers.len(),
            2,
            "examples part and unknown kind dropped"
        );
        assert_eq!(out.offers[0].kind, "bio");
        assert_eq!(out.offers[0].part, None);
        assert_eq!(out.offers[1].part.as_deref(), Some("voice"));
        assert_eq!(out.offers[1].channel.as_deref(), Some("generic"));
        let follow = out.follow_up.ok_or("follow-up kept")?;
        assert_eq!(follow.question, "Which is more you: a or b?");
        assert_eq!(
            follow.suggestions.len(),
            1,
            "dedupe + assistant-speak dropped"
        );
        assert_eq!(out.observation.as_deref(), Some("Writes short."));
        Ok(())
    }

    #[test]
    fn twin_setup_parse_refill_clears_write_suggestions_and_drops_empty() -> Result<(), String> {
        let raw = r#"{"steps":[
            {"goalId":"g1","kind":"riddle","question":"Reply to this as you would.","answerMode":"write",
             "incoming":"  Can we move the call?  ","suggestions":[{"text":"sure","reason":"r"}]},
            {"goalId":"g1","kind":"fact","question":"   ","answerMode":"pick"},
            {"goalId":"g2","kind":"fact","question":"Where did you grow up — and why?","answerMode":"pick","incoming":"x"}
          ],"obsolete":["s1"," "]}"#;
        let out = parse_refill(raw, false)?;
        assert_eq!(out.steps.len(), 2);
        assert_eq!(out.steps[0].answer_mode, "write");
        assert_eq!(out.steps[0].kind, "reply_drill");
        assert!(out.steps[0].suggestions.is_empty());
        assert_eq!(
            out.steps[0].incoming.as_deref(),
            Some("Can we move the call?")
        );
        assert_eq!(
            out.steps[1].incoming, None,
            "only a write step carries incoming"
        );
        assert!(!out.steps[1].question.contains('—'), "dashes softened");
        assert_eq!(out.obsolete, ["s1"]);
        Ok(())
    }

    #[test]
    fn twin_setup_parse_plan_requires_content() -> Result<(), String> {
        let raw = r#"{"goals":[{"id":null,"slot":"Tone","title":"Slack voice","intent":"","criteria":["a",""]}],
            "observations":["Short replies","short replies"],"steps":[],"changeNote":"Added Slack."}"#;
        let out = parse_plan(raw, false)?;
        assert_eq!(out.goals[0].slot, "tone");
        assert_eq!(out.goals[0].criteria, ["a"]);
        assert_eq!(out.observations, ["Short replies"]);
        assert_eq!(out.change_note.as_deref(), Some("Added Slack."));
        assert!(parse_plan(r#"{"goals":[],"steps":[]}"#, false).is_err());
        assert!(parse_plan("no json here", false).is_err());
        assert!(
            parse_refill(r#"{"obsolete":[]}"#, false).is_err(),
            "steps is required"
        );
        Ok(())
    }
}
