//! Build-plan model + extraction for web-build build turns (P3 of the web-dev
//! companion). Athena emits her plan as a trailing `BUILD_PLAN: {json}` line in
//! a build turn's reply; we parse it out (so the user never sees the raw JSON)
//! and surface the phases in the Studio checklist drawer.

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

/// Result of a build turn: Athena's cleaned reply plus an optional updated plan
/// (present only on turns where she emitted/revised it).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BuildTurnResult {
    pub reply: String,
    pub phases: Option<Vec<WebBuildPhase>>,
}

#[derive(Deserialize)]
struct PlanEnvelope {
    phases: Vec<WebBuildPhase>,
}

/// Extract a trailing `BUILD_PLAN: {json}` line from the assistant text. Returns
/// the cleaned reply (the line stripped — never show the raw JSON) plus the
/// parsed phases when the line is present and valid. A malformed line is still
/// stripped (so it never leaks into the reply) but yields no phases.
pub fn extract_build_plan(assistant_text: &str) -> (String, Option<Vec<WebBuildPhase>>) {
    let mut phases: Option<Vec<WebBuildPhase>> = None;
    let mut kept: Vec<&str> = Vec::with_capacity(assistant_text.lines().count());
    for line in assistant_text.lines() {
        if let Some(rest) = line.trim_start().strip_prefix("BUILD_PLAN:") {
            if phases.is_none() {
                if let Ok(env) = serde_json::from_str::<PlanEnvelope>(rest.trim()) {
                    if !env.phases.is_empty() {
                        phases = Some(env.phases);
                    }
                }
            }
            // Strip the line either way — the model should never surface raw JSON.
            continue;
        }
        kept.push(line);
    }
    (kept.join("\n").trim().to_string(), phases)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_strips_plan() {
        let txt = "Replaced the hero with a centered heading.\nBUILD_PLAN: {\"phases\":[{\"id\":\"foundation\",\"title\":\"Foundation\",\"status\":\"active\"}]}";
        let (reply, phases) = extract_build_plan(txt);
        assert_eq!(reply, "Replaced the hero with a centered heading.");
        let phases = phases.expect("phases parsed");
        assert_eq!(phases.len(), 1);
        assert_eq!(phases[0].id, "foundation");
        assert_eq!(phases[0].status, "active");
        assert!(phases[0].note.is_none());
    }

    #[test]
    fn no_plan_returns_text_unchanged() {
        let (reply, phases) = extract_build_plan("Just a summary, no plan.");
        assert_eq!(reply, "Just a summary, no plan.");
        assert!(phases.is_none());
    }

    #[test]
    fn malformed_plan_is_stripped_without_phases() {
        let (reply, phases) = extract_build_plan("Done.\nBUILD_PLAN: not json");
        assert_eq!(reply, "Done.");
        assert!(phases.is_none());
    }
}
