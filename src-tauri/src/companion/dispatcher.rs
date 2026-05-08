//! Op dispatcher — extracts `{"op": ...}` JSON proposals from Athena's
//! reply text, validates them against the allowed set, and creates rows
//! in `companion_approval` for the UI to render as approval cards.
//!
//! Phase 3 op set (write-only proposals; read-only inspection comes from
//! the observability digest):
//!   - propose_action { action: "run_persona", params: { persona_id, input? }, rationale }
//!   - propose_action { action: "resolve_human_review", params: { review_id, decision, comment? }, rationale }
//!
//! Discipline: ops are message-level. The dispatcher scans the finalized
//! assistant text after the turn ends — no agentic mid-turn loop. The
//! assistant text Athena renders is the *cleaned* text with the JSON
//! lines stripped; approval cards render in their place.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::UserDbPool;
use crate::error::AppError;

/// Outcome of dispatching one assistant message.
#[derive(Debug, Default)]
pub struct Dispatched {
    /// Assistant text with op JSON lines stripped, safe to display.
    pub cleaned_text: String,
    /// Newly-created approval rows. The UI listens for these and renders
    /// inline cards per turn.
    pub approvals: Vec<CreatedApproval>,
    /// UI-only navigations Athena fired this turn (`open_route`). These
    /// bypass the approval pipeline by design — the user wants direct,
    /// chat-driven navigation that doesn't interrupt the conversation.
    /// Each entry is the validated sidebar route name.
    pub navigations: Vec<String>,
    /// UI-only "open this persona's lab tab" requests Athena fired
    /// (`open_lab`). Bypasses approval like `open_route`. Each entry
    /// is `(persona_id, mode)` where mode is one of the lab modes
    /// (`arena`, `ab`, `versions`, etc.).
    pub lab_opens: Vec<(String, String)>,
    /// `compose_dashboard` payloads — already-serialized JSON spec
    /// strings, one per op. session.rs persists each via
    /// `dashboard::save_dashboard` and emits a navigate event. Auto-fire
    /// (no approval) because the user already asked for the dashboard;
    /// the click would just be friction.
    pub dashboards: Vec<String>,
    /// Quick-reply option labels Athena offered for this turn. Each entry
    /// is the literal user message that gets sent on click. Not persisted
    /// — the UI shows them on the latest assistant bubble until the next
    /// turn fires, then clears.
    pub quick_replies: Vec<String>,
    /// Spoken-version of the reply Athena emitted via a `TTS:` line —
    /// short (1-3 sentences), conversational, suited for ElevenLabs
    /// playback. None when Athena didn't emit one (voice off, or she
    /// chose to skip it for this turn). Frontend sets it as the latest
    /// `pendingPlayback` if voice playback is on.
    pub tts_text: Option<String>,
    /// Any malformed op blocks we encountered. Logged but otherwise
    /// silent — never block the turn for a syntax error.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApproval {
    pub id: String,
    pub action: String,
    pub params_json: String,
    pub rationale: String,
}

/// Allowed approval-creating actions. `open_route` is *not* listed here
/// — it's handled specially below (auto-fires a navigation event, no
/// approval card). The user wants chat-driven navigation to be smooth,
/// not gated by an explicit click each time.
const ALLOWED_ACTIONS: &[&str] = &[
    "run_persona",
    "resolve_human_review",
    "update_identity",
    "write_fact",
    "delete_fact",
    // Phase D — procedurals/goals/rituals/backlog.
    "write_procedural",
    "delete_procedural",
    "write_goal",
    "update_goal_status",
    "delete_goal",
    "write_ritual",
    "set_ritual_active",
    "delete_ritual",
    "write_backlog_item",
    "resolve_backlog_item",
    // Phase F — advanced UI control.
    "prefill_persona_create",
    "run_arena",
    // `compose_dashboard` is auto-fire — handled below alongside
    // `open_route` / `open_lab`. No approval card; the user already
    // asked for the dashboard, the click is friction.
    // `use_connector` is intentionally NOT here — it auto-fires
    // through the background-job worker (no approval card) so
    // connector calls don't block the chat. See the special-case
    // match arm below alongside `open_route` / `compose_dashboard`.
    // Phase G — project registry + background jobs.
    "register_project",
    "enqueue_dev_job",
];

/// Lab modes valid for `open_lab`. Mirrors the `lab-mode-*` testids in
/// `src/features/agents/sub_lab/components/shared/LabTab.tsx`.
const ALLOWED_LAB_MODES: &[&str] = &[
    "arena",
    "ab",
    "matrix",
    "breed",
    "evolve",
    "versions",
    "regression",
];

/// Allowed sidebar routes for `open_route`. Mirrors the SidebarSection
/// type on the frontend; mismatches get rejected with a warning so a
/// hallucinated route doesn't crash the navigation handler.
const ALLOWED_ROUTES: &[&str] = &[
    "home",
    "overview",
    "personas",
    "events",
    "credentials",
    "design-reviews",
    "plugins",
    "schedules",
    "settings",
];

/// Scan assistant text for op JSON blocks, persist them as approval rows,
/// and return cleaned text + the list of created approvals.
///
/// We accept two formats:
///   - One JSON object per line, prefixed with `OP:` for readability:
///       `OP: {"op": "propose_action", ...}`
///   - Bare lines that start with `{"op":` are also accepted.
/// Both forms get stripped from the cleaned text. Markdown code fences
/// containing JSON are not parsed (those are display-only).
pub fn dispatch(
    pool: &UserDbPool,
    session_id: &str,
    assistant_text: &str,
) -> Result<Dispatched, AppError> {
    let mut out = Dispatched::default();
    let mut cleaned_lines: Vec<&str> = Vec::with_capacity(assistant_text.lines().count());

    for line in assistant_text.lines() {
        let trimmed = line.trim_start();

        // TTS line: `TTS: "..."` — a short, spoken-friendly version of
        // this turn's reply. We accept either a JSON-quoted string or
        // a bare-text rest (more forgiving for short lines). Stripped
        // from display so the user sees only the visual reply.
        if let Some(rest) = trimmed.strip_prefix("TTS:") {
            let rest = rest.trim();
            // Try JSON-string parse first (handles escapes); fall back
            // to surrounding-quote strip; otherwise take rest as-is.
            let candidate = serde_json::from_str::<String>(rest)
                .ok()
                .unwrap_or_else(|| {
                    rest.trim_matches(|c: char| c == '"' || c == '\'')
                        .to_string()
                });
            let trimmed_text = candidate.trim().to_string();
            if !trimmed_text.is_empty() {
                // First TTS line wins; ignore subsequent ones to keep
                // the spoken version a single coherent utterance.
                if out.tts_text.is_none() {
                    out.tts_text = Some(trimmed_text);
                } else {
                    out.warnings
                        .push("multiple TTS lines, keeping first".into());
                }
            }
            continue;
        }

        // Quick-reply line: `QR: [...]` — list of preset user-message
        // labels Athena offers. Stripped from display, surfaced as
        // chip buttons on the assistant bubble.
        if let Some(rest) = trimmed.strip_prefix("QR:") {
            match serde_json::from_str::<Vec<String>>(rest.trim()) {
                Ok(opts) => {
                    for opt in opts {
                        let opt = opt.trim().to_string();
                        if !opt.is_empty() && out.quick_replies.len() < 6 {
                            out.quick_replies.push(opt);
                        }
                    }
                }
                Err(e) => {
                    out.warnings.push(format!("QR parse error: {e}"));
                    cleaned_lines.push(line);
                }
            }
            continue;
        }

        let payload = if let Some(rest) = trimmed.strip_prefix("OP:") {
            rest.trim()
        } else if trimmed.starts_with("{\"op\"") {
            trimmed
        } else {
            cleaned_lines.push(line);
            continue;
        };

        match serde_json::from_str::<OpEnvelope>(payload) {
            // open_route bypasses the approval flow: validate the route
            // and queue a navigation event. No card, no click. The chat
            // panel stays open; the sidebar switches behind it.
            // open_lab also bypasses approval — pure UI navigation
            // (jump to a persona's editor + select a lab mode).
            // compose_dashboard auto-fires too: validate the widgets
            // array, build a JSON spec body, queue it for session.rs
            // to persist + emit a navigate event. The dashboard write
            // is a small idempotent overwrite — friction-free.
            Ok(env) if env.op == "propose_action" && env.action == "compose_dashboard" => {
                let widgets = env.params.get("widgets");
                let widgets_arr = widgets.and_then(|v| v.as_array());
                if widgets_arr.is_none() || widgets_arr.unwrap().is_empty() {
                    out.warnings
                        .push("compose_dashboard: `widgets` must be a non-empty array".into());
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Athena dashboard");
                let now = chrono::Utc::now().to_rfc3339();
                let spec = serde_json::json!({
                    "title": title,
                    "widgets": widgets,
                    "updated_at": now,
                });
                out.dashboards.push(spec.to_string());
            }
            Ok(env) if env.op == "propose_action" && env.action == "open_lab" => {
                let persona_id = env
                    .params
                    .get("persona_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let mode = env
                    .params
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if persona_id.is_empty() || mode.is_empty() {
                    out.warnings
                        .push("open_lab: missing `persona_id` or `mode`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !ALLOWED_LAB_MODES.contains(&mode) {
                    out.warnings.push(format!(
                        "rejected lab mode `{mode}` (expected one of {ALLOWED_LAB_MODES:?})"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.lab_opens
                    .push((persona_id.to_string(), mode.to_string()));
            }
            // Phase F/G: `use_connector` auto-fires through the
            // background-job worker. No approval card — friction the
            // user explicitly rejected. Validation happens here so a
            // hallucinated connector/capability surfaces as a warning
            // (Athena reads it next turn) instead of a wasted job
            // queue slot.
            Ok(env) if env.op == "propose_action" && env.action == "use_connector" => {
                let connector_name = env
                    .params
                    .get("connector_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let capability = env
                    .params
                    .get("capability")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if connector_name.is_empty() || capability.is_empty() {
                    out.warnings
                        .push("use_connector: missing `connector_name` or `capability`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                // Verify the connector is pinned + enabled in the
                // sidebar before queuing — saves the worker from
                // running with no credentials accessible.
                match crate::companion::connectors::list(pool) {
                    Ok(active) => {
                        let row = active.iter().find(|c| c.connector_name == connector_name);
                        match row {
                            Some(r) if !r.enabled => {
                                out.warnings.push(format!(
                                    "use_connector: `{connector_name}` is pinned but disabled — toggle it on first"
                                ));
                                cleaned_lines.push(line);
                                continue;
                            }
                            None => {
                                out.warnings.push(format!(
                                    "use_connector: `{connector_name}` is not pinned in the sidebar"
                                ));
                                cleaned_lines.push(line);
                                continue;
                            }
                            _ => {} // pinned + enabled — proceed.
                        }
                    }
                    Err(e) => {
                        out.warnings
                            .push(format!("use_connector: connector list failed: {e}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
                // Validate capability against the registry.
                let caps = crate::companion::connectors::capabilities_for(connector_name);
                let known = caps.is_some_and(|cs| cs.iter().any(|c| c.slug == capability));
                if !known {
                    let known_list: Vec<&str> = caps
                        .map(|cs| cs.iter().map(|c| c.slug).collect())
                        .unwrap_or_default();
                    out.warnings.push(format!(
                        "use_connector: capability `{capability}` not in `{connector_name}` registry. Known: {known_list:?}"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                // Enqueue. Job worker picks it up within seconds and
                // appends a system episode with the result; chat is
                // never blocked.
                let job_params = serde_json::json!({
                    "connector_name": connector_name,
                    "capability": capability,
                    "args": env.params.get("args").cloned().unwrap_or(serde_json::json!({})),
                });
                if let Err(e) =
                    crate::companion::jobs::enqueue(pool, "connector_use", &job_params, None)
                {
                    out.warnings
                        .push(format!("use_connector: enqueue failed: {e}"));
                    cleaned_lines.push(line);
                    continue;
                }
                // Strip the OP line from display — Athena's prose
                // around it remains. Don't push to cleaned_lines.
            }
            Ok(env) if env.op == "propose_action" && env.action == "open_route" => {
                let route = env
                    .params
                    .get("route")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if route.is_empty() {
                    out.warnings.push("open_route: missing `route`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !ALLOWED_ROUTES.contains(&route) {
                    out.warnings.push(format!("rejected route `{route}`"));
                    cleaned_lines.push(line);
                    continue;
                }
                out.navigations.push(route.to_string());
            }
            Ok(env) if env.op == "propose_action" => {
                if !ALLOWED_ACTIONS.contains(&env.action.as_str()) {
                    out.warnings
                        .push(format!("rejected unknown action `{}`", env.action));
                    cleaned_lines.push(line);
                    continue;
                }
                // Anti-hallucination guard: a write_fact proposal without
                // any source episodes is rejected at parse time. Athena
                // sees the warning in the next turn's system context and
                // can re-propose with proper provenance.
                if env.action == "write_fact" || env.action == "write_procedural" {
                    let has_sources = env
                        .params
                        .get("sources")
                        .and_then(|v| v.as_array())
                        .is_some_and(|arr| {
                            arr.iter()
                                .any(|x| x.as_str().is_some_and(|s| !s.is_empty()))
                        });
                    if !has_sources {
                        out.warnings.push(format!(
                            "rejected {action}: `sources` (episode_id list) must be non-empty",
                            action = env.action
                        ));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
                match insert_approval(pool, session_id, &env) {
                    Ok(created) => out.approvals.push(created),
                    Err(e) => {
                        out.warnings.push(format!("approval insert failed: {e}"));
                        cleaned_lines.push(line);
                    }
                }
            }
            Ok(env) => {
                out.warnings
                    .push(format!("ignored op `{}` (not in v1)", env.op));
                cleaned_lines.push(line);
            }
            Err(e) => {
                out.warnings.push(format!("op parse error: {e}"));
                cleaned_lines.push(line);
            }
        }
    }

    out.cleaned_text = cleaned_lines.join("\n");
    // Trim the trailing whitespace introduced by stripped lines.
    while out.cleaned_text.ends_with(['\n', ' ']) {
        out.cleaned_text.pop();
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct OpEnvelope {
    op: String,
    #[serde(default)]
    action: String,
    #[serde(default)]
    params: serde_json::Value,
    #[serde(default)]
    rationale: String,
}

fn insert_approval(
    pool: &UserDbPool,
    session_id: &str,
    env: &OpEnvelope,
) -> Result<CreatedApproval, AppError> {
    let id = format!("appr_{}", short_random());
    let params_json = env.params.to_string();
    let payload = serde_json::json!({
        "action": env.action,
        "params": env.params,
        "rationale": env.rationale,
    })
    .to_string();
    // For resolve_human_review, surface the review_id at the top level
    // for cross-link queries (Overview panel can find approvals attached
    // to a specific review without parsing the payload JSON).
    let human_review_id: Option<String> = if env.action == "resolve_human_review" {
        env.params
            .get("review_id")
            .and_then(|v| v.as_str())
            .map(String::from)
    } else {
        None
    };

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', ?4, datetime('now'))",
        params![id, session_id, payload, human_review_id],
    )?;

    Ok(CreatedApproval {
        id,
        action: env.action.clone(),
        params_json,
        rationale: env.rationale.clone(),
    })
}

fn short_random() -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(10)
        .collect()
}
