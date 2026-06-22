//! Build-turn parsing for web-build turns (P3+). Athena emits structured
//! trailing lines in a build turn's reply — `BUILD_PLAN: {json}` (her plan) and
//! `NEEDS_INPUT: <question>` (a decision she needs the user to make). We parse
//! both out (so the user never sees the raw markers), surface the phases in the
//! checklist drawer, and surface the question so autonomous mode can pause.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One phase of a project's build plan (Spine → Dynamic Tail; see the web-build
/// doctrine). `status` is `"done" | "active" | "pending"` (kept as a string so a
/// hallucinated value degrades gracefully rather than failing the whole parse).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WebBuildPhase {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub note: Option<String>,
}

/// Result of a build turn: Athena's cleaned reply, an optional updated plan, and
/// an optional question she needs answered before proceeding (`NEEDS_INPUT`).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BuildTurnResult {
    pub reply: String,
    pub phases: Option<Vec<WebBuildPhase>>,
    pub question: Option<String>,
    /// Clickable options for the question (A1). Empty = free-text answer.
    #[serde(default)]
    pub options: Vec<String>,
    /// Coarse preview region the question is about (A3): "top"|"middle"|"bottom".
    pub area: Option<String>,
    /// CSS selector of the element the question is about (A3 precise pointer).
    pub selector: Option<String>,
}

#[derive(Deserialize)]
struct PlanEnvelope {
    phases: Vec<WebBuildPhase>,
}

/// Structured `NEEDS_INPUT` payload (A1): a question plus clickable options.
/// Parsing falls back to a plain-text question when the marker isn't JSON.
#[derive(Deserialize)]
struct DecisionEnvelope {
    question: String,
    #[serde(default)]
    options: Vec<String>,
    #[serde(default)]
    area: Option<String>,
    #[serde(default)]
    selector: Option<String>,
}

/// Extract trailing `BUILD_PLAN: {json}` and `NEEDS_INPUT: <question>` lines from
/// the assistant text. Returns the cleaned reply (markers stripped — never show
/// raw markers) plus the parsed phases and question when present. Malformed
/// markers are still stripped so they never leak into the reply.
pub fn extract_build_turn(
    assistant_text: &str,
) -> (
    String,
    Option<Vec<WebBuildPhase>>,
    Option<String>,
    Vec<String>,
    Option<String>,
    Option<String>,
) {
    let mut phases: Option<Vec<WebBuildPhase>> = None;
    let mut question: Option<String> = None;
    let mut options: Vec<String> = Vec::new();
    let mut area: Option<String> = None;
    let mut selector: Option<String> = None;
    let mut kept: Vec<&str> = Vec::with_capacity(assistant_text.lines().count());
    for line in assistant_text.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("BUILD_PLAN:") {
            if phases.is_none() {
                if let Ok(env) = serde_json::from_str::<PlanEnvelope>(rest.trim()) {
                    if !env.phases.is_empty() {
                        phases = Some(env.phases);
                    }
                }
            }
            continue; // strip either way — never surface raw JSON
        }
        if let Some(rest) = trimmed.strip_prefix("NEEDS_INPUT:") {
            if question.is_none() {
                let raw = rest.trim();
                if !raw.is_empty() {
                    // Structured {question, options} (A1), else plain-text fallback.
                    if let Ok(env) = serde_json::from_str::<DecisionEnvelope>(raw) {
                        if !env.question.trim().is_empty() {
                            question = Some(env.question.trim().to_string());
                            options = env
                                .options
                                .into_iter()
                                .map(|o| o.trim().to_string())
                                .filter(|o| !o.is_empty())
                                .collect();
                            area = env
                                .area
                                .map(|a| a.trim().to_lowercase())
                                .filter(|a| matches!(a.as_str(), "top" | "middle" | "bottom"));
                            selector = env
                                .selector
                                .map(|s| s.trim().to_string())
                                .filter(|s| !s.is_empty() && s.len() <= 200);
                        }
                    } else {
                        question = Some(raw.to_string());
                    }
                }
            }
            continue;
        }
        kept.push(line);
    }
    (kept.join("\n").trim().to_string(), phases, question, options, area, selector)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plan_and_question_and_strips_them() {
        let txt = "Set up the hero.\nNEEDS_INPUT: Should the palette be warm or cool?\nBUILD_PLAN: {\"phases\":[{\"id\":\"foundation\",\"title\":\"Foundation\",\"status\":\"active\"}]}";
        let (reply, phases, question, _options, _area, _selector) = extract_build_turn(txt);
        assert_eq!(reply, "Set up the hero.");
        assert_eq!(phases.expect("phases").len(), 1);
        assert_eq!(question.as_deref(), Some("Should the palette be warm or cool?"));
    }

    #[test]
    fn no_markers_returns_text_unchanged() {
        let (reply, phases, question, _options, _area, _selector) =
            extract_build_turn("Just a summary.");
        assert_eq!(reply, "Just a summary.");
        assert!(phases.is_none());
        assert!(question.is_none());
    }

    #[test]
    fn malformed_plan_is_stripped_without_phases() {
        let (reply, phases, _, _, _, _) = extract_build_turn("Done.\nBUILD_PLAN: not json");
        assert_eq!(reply, "Done.");
        assert!(phases.is_none());
    }

    #[test]
    fn parses_structured_decision_options() {
        let txt = "Pick a vibe.\nNEEDS_INPUT: {\"question\":\"Warm or cool?\",\"options\":[\"Warm\",\"Cool\"],\"area\":\"top\",\"selector\":\".hero h1\"}";
        let (reply, _, question, options, area, selector) = extract_build_turn(txt);
        assert_eq!(reply, "Pick a vibe.");
        assert_eq!(question.as_deref(), Some("Warm or cool?"));
        assert_eq!(options, vec!["Warm".to_string(), "Cool".to_string()]);
        assert_eq!(area.as_deref(), Some("top"));
        assert_eq!(selector.as_deref(), Some(".hero h1"));
    }

    #[test]
    fn plain_text_needs_input_has_no_options() {
        let (_, _, question, options, _area, _selector) =
            extract_build_turn("NEEDS_INPUT: What's your business name?");
        assert_eq!(question.as_deref(), Some("What's your business name?"));
        assert!(options.is_empty());
    }
}
