//! Morning Director — session-open briefing composition.
//!
//! The frontend promotes its "since you left" delta into a serializable
//! [`SessionDelta`] document and calls `companion_compose_briefing`. This
//! module owns the three safety properties of that pipeline:
//!
//! 1. **Delta gate** — [`delta_is_trivial`]: when nothing happened while
//!    the user was away, NO LLM call fires. The frontend also gates
//!    client-side; this is the backend's belt-and-suspenders check.
//! 2. **LLM composition** — [`compose_briefing`]: a one-shot Claude call
//!    (no chat session, no op grammar) that turns the delta into a
//!    cockpit-spec JSON body, prioritized broken > waiting-on-you >
//!    drifting > wins.
//! 3. **Enum validation** — [`sanitize_briefing_spec`]: action-carrying
//!    widgets composed by an LLM are a safety surface. Every widget kind
//!    must be on the briefing allowlist and every action must be (a) an
//!    enum kind, (b) legal for its widget kind, and (c) targeted at an
//!    id that actually appears in the delta document — the model can
//!    never invent a persona or approval to act on. Anything else is
//!    silently dropped; an empty result is an error so the caller falls
//!    back to the deterministic client-side composition (the
//!    `composeDefaultCockpit` model).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::companion::brain::oneshot::{self, call_claude_text, extract_json_span, preview};
use crate::companion::model_routing;
use crate::db::UserDbPool;
use crate::error::AppError;

/// One-shot compose budget. The briefing is latency-sensitive (session
/// open) — if the model can't answer inside this window the frontend's
/// deterministic fallback is the better experience.
const BRIEFING_TIMEOUT: Duration = Duration::from_secs(75);

/// Max widgets kept after sanitization — a briefing is a triage surface,
/// not a dashboard.
const MAX_WIDGETS: usize = 6;
/// Max actions per widget.
const MAX_ACTIONS: usize = 3;

/// Widget kinds a briefing may render. Mirrors the frontend cockpit
/// registry subset that is safe/meaningful for a session-open triage
/// surface (all display kinds; actions are validated separately).
const BRIEFING_WIDGET_KINDS: &[&str] = &[
    "text_callout",
    "stat_grid",
    "issue_list",
    "verdict",
    "persona_overview",
];

/// The action enum. These are the ONLY verbs a briefing widget can carry;
/// the frontend maps them onto existing IPC (execute_persona,
/// companion_approve_action / companion_reject_action, update_persona
/// ToggleEnabled) behind an explicit-click + confirm-if-spendy grammar.
const ACTION_KINDS: &[&str] = &[
    "rerun_persona",
    "approve_approval",
    "decline_approval",
    "pause_persona",
];

/// Which action kinds are legal on which widget kinds.
fn action_allowed_on(widget_kind: &str, action_kind: &str) -> bool {
    match action_kind {
        "rerun_persona" => matches!(widget_kind, "issue_list"),
        "pause_persona" => matches!(widget_kind, "issue_list" | "persona_overview"),
        "approve_approval" | "decline_approval" => widget_kind == "verdict",
        _ => false,
    }
}

// ── Session-delta document ─────────────────────────────────────────────

/// A persona that failed at least one run since the user left. Carried
/// in the delta so the model can reference it — and so persona-targeted
/// actions can be validated against a closed id set.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaPersona {
    pub id: String,
    pub name: String,
    pub failed_count: u32,
    /// False when the persona is already paused — pause actions against
    /// it are dropped as pointless.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// A fired alert summary since the user left.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaAlert {
    pub rule_name: String,
    pub severity: String,
    pub message: String,
    #[serde(default)]
    pub persona_id: Option<String>,
}

/// A companion approval currently waiting on the user.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaApproval {
    pub id: String,
    pub action: String,
    pub rationale: String,
}

/// Serializable "what happened while you were away" document, computed
/// client-side from the Overview spine (`sinceLeftBriefing` maths) plus
/// the pending-approvals list. Everything the composer may reference —
/// and everything an action may target — is inside this doc.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDelta {
    /// ISO timestamp of the previous session's end (the last-seen anchor).
    pub since: String,
    pub runs: u32,
    pub failed_runs: u32,
    pub alerts: u32,
    pub approvals_waiting: u32,
    /// Open audit incidents (current state, NOC feed).
    #[serde(default)]
    pub open_incidents: u32,
    #[serde(default)]
    pub failed_personas: Vec<DeltaPersona>,
    #[serde(default)]
    pub alert_summaries: Vec<DeltaAlert>,
    #[serde(default)]
    pub pending_approvals: Vec<DeltaApproval>,
}

/// The delta gate: true when nothing happened while the user was away
/// and nothing is waiting on them — no LLM call may fire.
/// `open_incidents` is deliberately excluded: an old open incident the
/// user already saw yesterday shouldn't re-trigger a "morning briefing"
/// on every launch (it still renders inside a briefing composed for
/// real deltas).
pub fn delta_is_trivial(d: &SessionDelta) -> bool {
    d.runs == 0 && d.failed_runs == 0 && d.alerts == 0 && d.approvals_waiting == 0
}

// ── Composition ────────────────────────────────────────────────────────

/// Compose a briefing spec from the delta via a one-shot LLM call, then
/// sanitize it. Returns the serialized cockpit-spec body JSON
/// (`{title, widgets, updated_at}`) ready for the frontend to render.
///
/// Errors (model unavailable, timeout, unparseable/empty result) are the
/// caller's cue to fall back to the deterministic client-side briefing.
/// The gate is enforced here too: composing a trivial delta is an error,
/// never a model call.
pub async fn compose_briefing(pool: &UserDbPool, delta: &SessionDelta) -> Result<String, AppError> {
    if delta_is_trivial(delta) {
        return Err(AppError::Internal(
            "briefing delta gate: nothing happened — refusing to compose".into(),
        ));
    }
    let prompt = build_prompt(delta)?;
    // Structured JSON authoring with no op grammar — the ASIDE tier
    // (awareness-heavy, latency-friendly) is the right cost point.
    let text = call_claude_text(
        pool,
        &prompt,
        model_routing::ASIDE.model,
        oneshot::leg::BRIEFING,
        BRIEFING_TIMEOUT,
    )
    .await?;
    sanitize_briefing_spec(&text, delta)
}

fn build_prompt(delta: &SessionDelta) -> Result<String, AppError> {
    let delta_json = serde_json::to_string_pretty(delta)
        .map_err(|e| AppError::Internal(format!("serialize session delta: {e}")))?;
    let mut p = String::new();
    p.push_str(
        "You are Athena, the operations companion inside the Personas desktop app. \
         The user just opened the app after being away. Compose their MORNING BRIEFING \
         as a cockpit widget spec (JSON).\n\n\
         Voice: first-person, brief, operational (\"3 runs failed overnight — Alpha needs a rerun\"). \
         Never cutesy. Prioritize strictly: broken > waiting-on-you > drifting > wins.\n\n\
         # What happened while they were away (session delta)\n",
    );
    p.push_str(&delta_json);
    p.push_str(
        "\n\n# Output contract\n\
         Emit ONE JSON object, nothing else. No prose, no code fences. Shape:\n\
         {\"title\": string, \"widgets\": [Widget, ...]}\n\
         2 to 5 widgets. Widget = {\"id\": string, \"kind\": Kind, \"title\": string, \
         \"span\": 1-12 (use 12), \"config\": object, \"actions\": [Action, ...] (optional)}\n\n\
         Allowed kinds and their config:\n\
         - text_callout: {\"body\": string, \"intent\": \"info\"|\"good\"|\"warn\"|\"bad\"} — \
           your one-paragraph headline read of the night. Put this FIRST.\n\
         - stat_grid: {\"columns\": 4, \"stats\": [{\"label\": string, \"value\": number|string, \
           \"unit\"?: string, \"intent\"?: \"default\"|\"good\"|\"warn\"|\"bad\"}]} — the numbers.\n\
         - issue_list: {\"items\": [{\"id\": string, \"title\": string, \"sublabel\"?: string, \
           \"severity\"?: \"info\"|\"good\"|\"warn\"|\"bad\"}]} — broken things, one row per failing persona \
           (use the persona id from failedPersonas as the item id).\n\
         - verdict: {\"headline\": string, \"reasoning\": string, \"intent\": \"info\"|\"good\"|\"warn\"|\"bad\", \
           \"confidence\"?: \"high\"|\"medium\"|\"low\", \"caveat\"?: string} — ONE pending approval \
           you recommend resolving, with your recommendation as the headline.\n\
         - persona_overview: {\"limit\": 6, \"filter\": \"active\"} — fleet roster (only if useful).\n\n\
         Actions (optional, max 3 per widget) let the user act with one click. \
         Allowed Action shapes — use ONLY ids present in the delta above:\n\
         - {\"kind\": \"rerun_persona\", \"personaId\": <failedPersonas[].id>, \"label\": short verb phrase} — on issue_list only.\n\
         - {\"kind\": \"pause_persona\", \"personaId\": <failedPersonas[].id>, \"label\": ...} — on issue_list or persona_overview; \
           only for personas with enabled=true.\n\
         - {\"kind\": \"approve_approval\", \"approvalId\": <pendingApprovals[].id>, \"label\": ...} — on verdict only.\n\
         - {\"kind\": \"decline_approval\", \"approvalId\": <pendingApprovals[].id>, \"label\": ...} — on verdict only.\n\
         Do not invent widgets for data the delta doesn't contain. If a section is empty, omit it. \
         Start with `{` and end with `}`.\n",
    );
    Ok(p)
}

// ── Sanitization ───────────────────────────────────────────────────────

/// Parse + validate a model-authored briefing reply against the delta
/// document. Unknown widget kinds, unknown/misplaced action kinds, and
/// actions targeting ids not present in the delta are dropped. Returns
/// the serialized `{title, widgets, updated_at}` body, or an error when
/// nothing valid survives (caller falls back deterministically).
pub fn sanitize_briefing_spec(raw: &str, delta: &SessionDelta) -> Result<String, AppError> {
    let json = extract_json_span(raw, "briefing reply")?;
    let spec: serde_json::Value = serde_json::from_str(json).map_err(|e| {
        AppError::Internal(format!(
            "briefing reply not valid JSON: {e}; got: {}",
            preview(json, 300)
        ))
    })?;

    let title = spec
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Briefing")
        .to_string();

    let widgets_in = spec
        .get("widgets")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let persona_ids: Vec<&str> = delta
        .failed_personas
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    let pausable_ids: Vec<&str> = delta
        .failed_personas
        .iter()
        .filter(|p| p.enabled)
        .map(|p| p.id.as_str())
        .collect();
    let approval_ids: Vec<&str> = delta
        .pending_approvals
        .iter()
        .map(|a| a.id.as_str())
        .collect();

    let mut kept: Vec<serde_json::Value> = Vec::new();
    for (i, w) in widgets_in.into_iter().enumerate() {
        if kept.len() >= MAX_WIDGETS {
            break;
        }
        let kind = w.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if !BRIEFING_WIDGET_KINDS.contains(&kind) {
            continue;
        }
        let kind = kind.to_string();
        let id = w
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("brief-{i}"));
        let title_w = w
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let span = w
            .get("span")
            .and_then(|v| v.as_u64())
            .unwrap_or(12)
            .clamp(1, 12);
        let config = w.get("config").cloned().unwrap_or(serde_json::json!({}));

        let mut actions_out: Vec<serde_json::Value> = Vec::new();
        if let Some(actions) = w.get("actions").and_then(|v| v.as_array()) {
            for a in actions {
                if actions_out.len() >= MAX_ACTIONS {
                    break;
                }
                let a_kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                if !ACTION_KINDS.contains(&a_kind) || !action_allowed_on(&kind, a_kind) {
                    continue;
                }
                let label = a.get("label").and_then(|v| v.as_str()).unwrap_or("");
                let valid = match a_kind {
                    "rerun_persona" => a
                        .get("personaId")
                        .and_then(|v| v.as_str())
                        .is_some_and(|id| persona_ids.contains(&id)),
                    "pause_persona" => a
                        .get("personaId")
                        .and_then(|v| v.as_str())
                        .is_some_and(|id| pausable_ids.contains(&id)),
                    "approve_approval" | "decline_approval" => a
                        .get("approvalId")
                        .and_then(|v| v.as_str())
                        .is_some_and(|id| approval_ids.contains(&id)),
                    _ => false,
                };
                if !valid {
                    continue;
                }
                let mut out = serde_json::Map::new();
                out.insert("kind".into(), serde_json::json!(a_kind));
                if let Some(pid) = a.get("personaId").and_then(|v| v.as_str()) {
                    out.insert("personaId".into(), serde_json::json!(pid));
                }
                if let Some(aid) = a.get("approvalId").and_then(|v| v.as_str()) {
                    out.insert("approvalId".into(), serde_json::json!(aid));
                }
                if !label.is_empty() {
                    out.insert("label".into(), serde_json::json!(label));
                }
                actions_out.push(serde_json::Value::Object(out));
            }
        }

        let mut widget = serde_json::Map::new();
        widget.insert("id".into(), serde_json::json!(id));
        widget.insert("kind".into(), serde_json::json!(kind));
        if let Some(t) = title_w {
            widget.insert("title".into(), serde_json::json!(t));
        }
        widget.insert("span".into(), serde_json::json!(span));
        widget.insert("config".into(), config);
        if !actions_out.is_empty() {
            widget.insert("actions".into(), serde_json::Value::Array(actions_out));
        }
        kept.push(serde_json::Value::Object(widget));
    }

    if kept.is_empty() {
        return Err(AppError::Internal(
            "briefing reply contained no valid widgets after sanitization".into(),
        ));
    }

    let body = serde_json::json!({
        "title": title,
        "widgets": kept,
        "updated_at": chrono::Utc::now().to_rfc3339(),
    });
    Ok(body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delta() -> SessionDelta {
        SessionDelta {
            since: "2026-07-29T22:00:00Z".into(),
            runs: 12,
            failed_runs: 3,
            alerts: 1,
            approvals_waiting: 1,
            open_incidents: 0,
            failed_personas: vec![DeltaPersona {
                id: "p1".into(),
                name: "Alpha".into(),
                failed_count: 3,
                enabled: true,
            }],
            alert_summaries: vec![],
            pending_approvals: vec![DeltaApproval {
                id: "ap1".into(),
                action: "run_persona".into(),
                rationale: "retry the failed sync".into(),
            }],
        }
    }

    #[test]
    fn gate_trivial_when_nothing_happened() {
        let d = SessionDelta {
            since: "x".into(),
            runs: 0,
            failed_runs: 0,
            alerts: 0,
            approvals_waiting: 0,
            open_incidents: 2,
            failed_personas: vec![],
            alert_summaries: vec![],
            pending_approvals: vec![],
        };
        assert!(delta_is_trivial(&d));
        assert!(!delta_is_trivial(&delta()));
    }

    #[test]
    fn sanitize_keeps_valid_widgets_and_actions() {
        let raw = r#"{"title":"Morning","widgets":[
            {"id":"a","kind":"issue_list","title":"Broken","span":12,
             "config":{"items":[{"id":"p1","title":"Alpha"}]},
             "actions":[{"kind":"rerun_persona","personaId":"p1","label":"Rerun Alpha"}]}
        ]}"#;
        let out = sanitize_briefing_spec(raw, &delta()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let widgets = v["widgets"].as_array().unwrap();
        assert_eq!(widgets.len(), 1);
        assert_eq!(widgets[0]["actions"][0]["kind"], "rerun_persona");
    }

    #[test]
    fn sanitize_drops_unknown_kinds_actions_and_foreign_ids() {
        let raw = r#"{"title":"Morning","widgets":[
            {"id":"x","kind":"log_excerpt","config":{}},
            {"id":"a","kind":"issue_list","config":{"items":[]},
             "actions":[
               {"kind":"delete_everything","personaId":"p1"},
               {"kind":"rerun_persona","personaId":"NOT_IN_DELTA"},
               {"kind":"approve_approval","approvalId":"ap1"},
               {"kind":"rerun_persona","personaId":"p1"}
             ]}
        ]}"#;
        let out = sanitize_briefing_spec(raw, &delta()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let widgets = v["widgets"].as_array().unwrap();
        // log_excerpt dropped
        assert_eq!(widgets.len(), 1);
        // only the valid rerun survives: delete_everything = unknown kind,
        // NOT_IN_DELTA = foreign id, approve_approval = wrong widget kind.
        let actions = widgets[0]["actions"].as_array().unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0]["kind"], "rerun_persona");
        assert_eq!(actions[0]["personaId"], "p1");
    }

    #[test]
    fn sanitize_drops_pause_on_disabled_persona() {
        let mut d = delta();
        d.failed_personas[0].enabled = false;
        let raw = r#"{"title":"M","widgets":[
            {"id":"a","kind":"issue_list","config":{"items":[]},
             "actions":[{"kind":"pause_persona","personaId":"p1"}]}
        ]}"#;
        let out = sanitize_briefing_spec(raw, &d).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v["widgets"][0].get("actions").is_none());
    }

    #[test]
    fn sanitize_errors_when_nothing_survives() {
        let raw = r#"{"title":"M","widgets":[{"id":"x","kind":"nope","config":{}}]}"#;
        assert!(sanitize_briefing_spec(raw, &delta()).is_err());
    }

    #[test]
    fn sanitize_tolerates_code_fences_and_generates_ids() {
        let raw = "```json\n{\"widgets\":[{\"kind\":\"text_callout\",\"config\":{\"body\":\"hi\",\"intent\":\"info\"}}]}\n```";
        let out = sanitize_briefing_spec(raw, &delta()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["title"], "Briefing");
        assert_eq!(v["widgets"][0]["id"], "brief-0");
        assert_eq!(v["widgets"][0]["span"], 12);
    }
}
