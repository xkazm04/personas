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
    /// `compose_cockpit` payloads — same shape as `dashboards`. session.rs
    /// persists each via `cockpit::save_cockpit` and emits a navigate
    /// event to Home → Cockpit. Auto-fire for the same reason as dashboards:
    /// the user already asked for the surface.
    pub cockpits: Vec<String>,
    /// Inline chat cards from `show_persona_overview` / `show_connected_services`
    /// / `show_decisions`. Auto-fire (no approval) — companion uses these to
    /// surface contextual info inside the chat transcript when she judges it
    /// useful for the current turn. Each entry is `(kind, config_json)`.
    pub chat_cards: Vec<ChatCard>,
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
    /// True iff Athena emitted at least one `continue_autonomously` op
    /// in this turn. When the session is in autonomous mode AND this is
    /// set, the caller schedules a continuation tick. The op carries no
    /// payload beyond a `rationale` string — the dispatcher logs it but
    /// otherwise ignores the body.
    pub requests_continuation: bool,
    /// Any malformed op blocks we encountered. Logged but otherwise
    /// silent — never block the turn for a syntax error.
    pub warnings: Vec<String>,
}

/// One inline chat-card request. `config` is widget-specific JSON the
/// frontend forwards to the matching cockpit widget component.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCard {
    /// Widget kind: `persona_overview` | `connected_services` | `decisions_panel`.
    pub kind: String,
    /// Optional title override.
    pub title: Option<String>,
    /// Free-form config block — serialized verbatim for the frontend.
    pub config: serde_json::Value,
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
    // Athena's future check-in commitments. Goes through approval
    // because it puts a future obligation on the user's attention —
    // unlike connector calls (real-world action that runs once on
    // pinned credentials the user already greenlit), scheduling a
    // proactive ping needs explicit "yes, ping me about this then"
    // consent.
    "schedule_proactive",
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
            Ok(env)
                if env.op == "propose_action"
                    && matches!(
                        env.action.as_str(),
                        "show_persona_overview" | "show_connected_services" | "show_decisions"
                    ) =>
            {
                // Inline chat-cards. Map the action name to a cockpit widget kind
                // and forward the params blob as `config`. Auto-fire; no approval.
                let kind = match env.action.as_str() {
                    "show_persona_overview" => "persona_overview",
                    "show_connected_services" => "connected_services",
                    "show_decisions" => "decisions_panel",
                    _ => unreachable!(),
                };
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let config = env
                    .params
                    .get("config")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                out.chat_cards.push(ChatCard {
                    kind: kind.to_string(),
                    title,
                    config,
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_recent_decisions" =>
            {
                // Compact recall card — surfaces 1-5 of the most recent
                // saved decisions for a given persona_context as small
                // chips. Lighter than a full show_decision_log card;
                // intended for "by the way, you decided..." inline
                // reminders. Widget fetches the actual rows on mount
                // via companion_list_design_decisions.
                let persona_context = env
                    .params
                    .get("persona_context")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if persona_context.is_empty() {
                    out.warnings.push(
                        "show_recent_decisions: `persona_context` (persona id, build session id, or intent string) is required so the widget knows what to fetch"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let limit = env
                    .params
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3)
                    .clamp(1, 5);
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "recent_decisions".to_string(),
                    title,
                    config: serde_json::json!({
                        "persona_context": persona_context,
                        "limit": limit,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_design_capabilities" =>
            {
                // Onboarding-style card for the design-family. Athena
                // emits this when a user asks "what can you help me
                // design?" — surfaces her vocabulary (walkthrough, use
                // cases, triggers, model tier, observability, ready
                // recap) so the user knows what to ask for. Content is
                // mostly hardcoded in the widget; the op carries just an
                // optional intro line Athena composes for context.
                let intro = env
                    .params
                    .get("intro")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "design_capabilities".to_string(),
                    title,
                    config: serde_json::json!({ "intro": intro }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_persona_ready" =>
            {
                // End-of-design recap. Athena rolls up all the design
                // decisions (intent line, use cases, triggers, model
                // tier, observability) into one build-ready card with a
                // primary "Commit to build" button that fires the same
                // prefill flow as the walkthrough's build button.
                let intent_line = env
                    .params
                    .get("summary")
                    .and_then(|s| s.get("intent_line"))
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if intent_line.is_empty() {
                    out.warnings.push(
                        "show_persona_ready: summary.intent_line is required (the refined one-sentence persona purpose used for prefill)".into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let recommended = env
                    .params
                    .get("recommended_action")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("interactive");
                if !matches!(
                    recommended,
                    "build_oneshot" | "interactive" | "use_template"
                ) {
                    out.warnings.push(format!(
                        "show_persona_ready: recommended_action must be build_oneshot|interactive|use_template, got `{recommended}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let summary = env
                    .params
                    .get("summary")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "persona_ready".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "summary": summary,
                        "recommended_action": recommended,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_decision_log" =>
            {
                // Decision-log card — audit trail of design choices Athena
                // made during the current conversation. Each entry has a
                // label (what was decided), choice (what was picked), and
                // rationale (one sentence why). Helps the user retrace
                // reasoning later — "why did we pick Sonnet?" — without
                // re-running the conversation.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let decisions = env
                    .params
                    .get("decisions")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if decisions.is_empty() {
                    out.warnings.push(
                        "show_decision_log: `decisions` must be a non-empty array of {label, choice, rationale} objects"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                if decisions.len() > 12 {
                    out.warnings.push(format!(
                        "show_decision_log: {} decisions is too many — cap at 8 per card; split into multiple ops if needed",
                        decisions.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let mut missing_field: Option<&'static str> = None;
                for d in &decisions {
                    for field in ["label", "choice", "rationale"] {
                        if d
                            .get(field)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .is_none()
                        {
                            missing_field = Some(field);
                            break;
                        }
                    }
                    if missing_field.is_some() {
                        break;
                    }
                }
                if let Some(field) = missing_field {
                    out.warnings.push(format!(
                        "show_decision_log: every decision needs a non-empty `{field}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // Best-effort persist to companion_design_decision so
                // the audit trail survives session reloads. Errors are
                // logged but don't fail the dispatch — the chat-card
                // still renders even if the write doesn't land.
                let inputs: Vec<crate::companion::brain::decisions::DecisionInput<'_>> =
                    decisions
                        .iter()
                        .filter_map(|d| {
                            let label = d.get("label").and_then(|v| v.as_str())?;
                            let choice = d.get("choice").and_then(|v| v.as_str())?;
                            let rationale = d.get("rationale").and_then(|v| v.as_str())?;
                            let decision_timestamp =
                                d.get("timestamp").and_then(|v| v.as_str());
                            Some(crate::companion::brain::decisions::DecisionInput {
                                label,
                                choice,
                                rationale,
                                decision_timestamp,
                            })
                        })
                        .collect();
                // `intent` doubles as `persona_context` for now — it's
                // either a persona id, build session id, or the intent
                // string itself; all queryable for "decisions about X".
                let persona_context: Option<&str> = if intent.is_empty() {
                    None
                } else {
                    Some(intent)
                };
                if let Err(e) = crate::companion::brain::decisions::save_batch(
                    pool,
                    session_id,
                    persona_context,
                    &inputs,
                ) {
                    tracing::warn!(error = %e, "design-decision persist failed (chat-card still rendered)");
                }

                out.chat_cards.push(ChatCard {
                    kind: "decision_log".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "decisions": decisions,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_observability_plan" =>
            {
                // Observability plan card — the 7th readiness item from
                // cycle-6 doctrine. Two sections: error handling (what
                // escalates to manual review + how) and success metric
                // (which signal is tracked + target).
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let error_handling = env
                    .params
                    .get("error_handling")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                if !error_handling.is_object() {
                    out.warnings.push(
                        "show_observability_plan: `error_handling` must be an object {triggers: [string], escalation: string}"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let success_metric = env
                    .params
                    .get("success_metric")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                if !success_metric.is_object() {
                    out.warnings.push(
                        "show_observability_plan: `success_metric` must be an object {kind, description, target?}"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let metric_kind = success_metric
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !matches!(
                    metric_kind,
                    "count_by_status" | "cost_per_run" | "latency" | "custom"
                ) {
                    out.warnings.push(format!(
                        "show_observability_plan: success_metric.kind must be count_by_status|cost_per_run|latency|custom, got `{metric_kind}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "observability_plan".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "error_handling": error_handling,
                        "success_metric": success_metric,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_model_tier_choice" =>
            {
                // Model-tier recommendation card. Athena compares the
                // three tiers (haiku / sonnet / opus) for a specific
                // persona intent, marking one as recommended with the
                // rationale from cycle-6 doctrine's tier-selection
                // heuristics. Auto-fire (no approval) — it's an
                // explanation, not a write.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let recommended = env
                    .params
                    .get("recommended")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if !matches!(recommended, "haiku" | "sonnet" | "opus") {
                    out.warnings.push(format!(
                        "show_model_tier_choice: `recommended` must be haiku|sonnet|opus, got `{recommended}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let tiers = env
                    .params
                    .get("tiers")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if tiers.is_empty() {
                    out.warnings.push(
                        "show_model_tier_choice: `tiers` must be a non-empty array of {tier, rationale}"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                // Each tier entry needs a valid tier slug and a non-
                // empty rationale; the recommended one is identified
                // by matching `tier` against the top-level `recommended`
                // field (we don't trust per-row `recommended` booleans
                // to be self-consistent).
                let mut bad_tier: Option<String> = None;
                for t in &tiers {
                    let slug = t.get("tier").and_then(|v| v.as_str()).unwrap_or("");
                    if !matches!(slug, "haiku" | "sonnet" | "opus") {
                        bad_tier = Some(slug.to_string());
                        break;
                    }
                    let rationale = t
                        .get("rationale")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .unwrap_or("");
                    if rationale.is_empty() {
                        bad_tier = Some(format!("{slug} (empty rationale)"));
                        break;
                    }
                }
                if let Some(bad) = bad_tier {
                    out.warnings.push(format!(
                        "show_model_tier_choice: invalid tier entry `{bad}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "model_tier_choice".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "recommended": recommended,
                        "tiers": tiers,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_trigger_set" =>
            {
                // Trigger-decomposition card. Same family as use_case_set:
                // Athena composes 1-4 trigger configurations applying
                // cycle-6 doctrine's "one trigger condition → one persona
                // response shape" grain test. Each entry has label,
                // source, condition; optional grain + idempotency notes.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let triggers = env
                    .params
                    .get("triggers")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if triggers.is_empty() {
                    out.warnings.push(
                        "show_trigger_set: `triggers` must be a non-empty array of {label, source, condition} objects"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                if triggers.len() > 6 {
                    out.warnings.push(format!(
                        "show_trigger_set: {} triggers is too many — cap at 4 per card; split into multiple ops if needed",
                        triggers.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                // Validate each trigger has the required fields up front
                // so the widget renders cleanly.
                let mut missing: Option<&'static str> = None;
                for tr in &triggers {
                    for field in ["label", "source", "condition"] {
                        if tr
                            .get(field)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .is_none()
                        {
                            missing = Some(field);
                            break;
                        }
                    }
                    if missing.is_some() {
                        break;
                    }
                }
                if let Some(field) = missing {
                    out.warnings.push(format!(
                        "show_trigger_set: every trigger needs a non-empty `{field}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "trigger_set".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "triggers": triggers,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_use_case_set" =>
            {
                // Use-case decomposition card. Athena supplies an intent
                // + a list of 3-5 use cases tagged golden / variant /
                // out_of_scope, applying the use-case coverage rules
                // from the persona-design best-practices doctrine.
                // Auto-fire (no approval) — it's a structured suggestion
                // for the user to review.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let use_cases = env
                    .params
                    .get("use_cases")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if use_cases.is_empty() {
                    out.warnings.push(
                        "show_use_case_set: `use_cases` must be a non-empty array of {label, role, description} objects"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                if use_cases.len() > 8 {
                    out.warnings.push(format!(
                        "show_use_case_set: {} use cases is too many — cap at 5 per card; split into multiple ops if needed",
                        use_cases.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                // Validate role enum on every entry up front so a single
                // bad row doesn't slip through and confuse the widget.
                let mut bad_role: Option<String> = None;
                for uc in &use_cases {
                    let role = uc.get("role").and_then(|v| v.as_str()).unwrap_or("");
                    if !matches!(role, "golden" | "variant" | "out_of_scope") {
                        bad_role = Some(role.to_string());
                        break;
                    }
                }
                if let Some(role) = bad_role {
                    out.warnings.push(format!(
                        "show_use_case_set: `role` must be golden|variant|out_of_scope, got `{role}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "use_case_set".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "use_cases": use_cases,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_template_suggestions" =>
            {
                // Template-match card. Athena supplies the intent text; the
                // widget calls `companion_match_templates` on mount to
                // fetch the actual matches (we don't query the system DB
                // from here — dispatcher only has UserDbPool). Auto-fire,
                // no approval — the suggestions are a pointer, not an
                // action.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if intent.is_empty() {
                    out.warnings.push(
                        "show_template_suggestions: `intent` (the user's described persona purpose) is required"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let limit = env
                    .params
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3)
                    .clamp(1, 5);
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "template_suggestions".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "limit": limit,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_persona_walkthrough" =>
            {
                // Persona-design walkthrough — long-form markdown plan
                // Athena composes for a specific intent, pulling from the
                // `concepts/persona-design-best-practices.md` doctrine.
                // Auto-fire (no approval); it's a suggestion to read, not
                // an action to commit. Config is just `{ intent, content }`
                // — the widget renders the markdown as-is.
                let content = env
                    .params
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if content.is_empty() {
                    out.warnings
                        .push("show_persona_walkthrough: `content` (markdown) is required".into());
                    cleaned_lines.push(line);
                    continue;
                }
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "persona_walkthrough".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "content": content,
                    }),
                });
            }
            Ok(env) if env.op == "propose_action" && env.action == "compose_cockpit" => {
                let widgets = env.params.get("widgets");
                let widgets_arr = widgets.and_then(|v| v.as_array());
                if widgets_arr.is_none() || widgets_arr.unwrap().is_empty() {
                    out.warnings
                        .push("compose_cockpit: `widgets` must be a non-empty array".into());
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Cockpit");
                let now = chrono::Utc::now().to_rfc3339();
                let spec = serde_json::json!({
                    "title": title,
                    "widgets": widgets,
                    "updated_at": now,
                });
                out.cockpits.push(spec.to_string());
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
            // A2: autonomous continuation. Athena emits this when she
            // wants the system to give her another turn (after a short
            // delay) so she can keep working without user input. Only
            // honored when the session is in autonomous mode — session.rs
            // gates the actual schedule. We strip the line from display
            // either way so the user never sees the directive verbatim.
            Ok(env)
                if env.op == "propose_action" && env.action == "continue_autonomously" =>
            {
                let rationale = env
                    .params
                    .get("rationale")
                    .and_then(|v| v.as_str())
                    .unwrap_or("(no rationale)");
                tracing::debug!(rationale = %rationale, "athena: continue_autonomously requested");
                out.requests_continuation = true;
                // Don't push to cleaned_lines — strip the directive.
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

// ─────────────────────────────────────────────────────────────────────────
// Tests
//
// Coverage focuses on the new chat-card op variants added by /friend
// 2026-05-16 session 2: show_persona_walkthrough, show_template_suggestions,
// show_use_case_set, show_trigger_set, show_model_tier_choice,
// show_observability_plan, show_decision_log, show_persona_ready,
// show_design_capabilities, show_recent_decisions. All are auto-fire
// chat-card emitters that push to `out.chat_cards` on valid input and to
// `out.warnings` on bad input — no DB writes for any of them except
// show_decision_log (which best-effort persists to companion_design_decision).
//
// Tests build a small in-memory UserDbPool with the COMPANION_SCHEMA
// applied so the show_decision_log persist path doesn't fail; the rest
// of the dispatch surface doesn't touch the pool.
// ─────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::UserDbPool;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// Build an in-memory user db pool with the companion schema applied.
    /// Uses a file::memory: URI with shared cache so all pool connections
    /// see the same tables (per the pattern in db/repos/resources/
    /// db_schema.rs's in-memory comment).
    fn test_pool() -> UserDbPool {
        let manager = SqliteConnectionManager::file(
            "file::memory:?cache=shared",
        )
        .with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        );
        let pool = Pool::builder()
            .max_size(2)
            .build(manager)
            .expect("build in-memory pool");
        // Minimal schema — just the tables the dispatcher arms exercise.
        let conn = pool.get().expect("get conn");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS companion_approval (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL,
                human_review_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS companion_design_decision (
                id                  TEXT PRIMARY KEY,
                session_id          TEXT NOT NULL,
                persona_context     TEXT,
                label               TEXT NOT NULL,
                choice              TEXT NOT NULL,
                rationale           TEXT NOT NULL,
                decision_timestamp  TEXT,
                created_at          TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .expect("apply schema");
        pool
    }

    fn dispatch_op(op_json: &str) -> Dispatched {
        let pool = test_pool();
        let text = format!("Some prose.\nOP: {op_json}\nMore prose.");
        dispatch(&pool, "default", &text).expect("dispatch ok")
    }

    // ── show_persona_walkthrough ────────────────────────────────────────

    #[test]
    fn show_persona_walkthrough_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_persona_walkthrough","params":{"intent":"triage tickets","content":"## Plan\n\nbody"}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "persona_walkthrough");
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn show_persona_walkthrough_rejects_empty_content() {
        let op = r###"{"op":"propose_action","action":"show_persona_walkthrough","params":{"intent":"x","content":""}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("content")));
    }

    // ── show_template_suggestions ───────────────────────────────────────

    #[test]
    fn show_template_suggestions_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":"triage support tickets","limit":3}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "template_suggestions");
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn show_template_suggestions_rejects_empty_intent() {
        let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":""}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("intent")));
    }

    #[test]
    fn show_template_suggestions_clamps_limit_into_1_to_5() {
        let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":"x","limit":99}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        let limit = out.chat_cards[0]
            .config
            .get("limit")
            .and_then(|v| v.as_u64())
            .expect("limit field");
        assert!((1..=5).contains(&limit), "limit clamped to 1..=5, got {limit}");
    }

    // ── show_use_case_set ───────────────────────────────────────────────

    #[test]
    fn show_use_case_set_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"intent":"x","use_cases":[{"label":"Golden","role":"golden","description":"d"},{"label":"Variant","role":"variant","description":"d"},{"label":"Outscope","role":"out_of_scope","description":"d"}]}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "use_case_set");
    }

    #[test]
    fn show_use_case_set_rejects_empty_array() {
        let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"use_cases":[]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("use_cases")));
    }

    #[test]
    fn show_use_case_set_rejects_invalid_role() {
        let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"use_cases":[{"label":"X","role":"surprise","description":"d"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("role")));
    }

    #[test]
    fn show_use_case_set_rejects_oversize_array() {
        let mut entries = Vec::new();
        for i in 0..9 {
            entries.push(format!(
                r###"{{"label":"L{i}","role":"variant","description":"d"}}"###
            ));
        }
        let op = format!(
            r###"{{"op":"propose_action","action":"show_use_case_set","params":{{"use_cases":[{}]}}}}"###,
            entries.join(",")
        );
        let out = dispatch_op(&op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("too many")));
    }

    // ── show_trigger_set ────────────────────────────────────────────────

    #[test]
    fn show_trigger_set_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_trigger_set","params":{"intent":"x","triggers":[{"label":"L","source":"S","condition":"C"}]}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "trigger_set");
    }

    #[test]
    fn show_trigger_set_rejects_missing_field() {
        let op = r###"{"op":"propose_action","action":"show_trigger_set","params":{"triggers":[{"label":"L","source":"","condition":"C"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("source")));
    }

    // ── show_model_tier_choice ──────────────────────────────────────────

    #[test]
    fn show_model_tier_choice_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"sonnet","tiers":[{"tier":"haiku","rationale":"a"},{"tier":"sonnet","rationale":"b"},{"tier":"opus","rationale":"c"}]}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "model_tier_choice");
    }

    #[test]
    fn show_model_tier_choice_rejects_unknown_recommended() {
        let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"galactus","tiers":[{"tier":"sonnet","rationale":"x"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("recommended")));
    }

    #[test]
    fn show_model_tier_choice_rejects_bad_tier_slug() {
        let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"sonnet","tiers":[{"tier":"haiku","rationale":"a"},{"tier":"jellyfish","rationale":"b"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("invalid tier")));
    }

    // ── show_observability_plan ─────────────────────────────────────────

    #[test]
    fn show_observability_plan_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"error_handling":{"triggers":["tool timeout"],"escalation":"manual_reviews"},"success_metric":{"kind":"count_by_status","description":"weekly rollup"}}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "observability_plan");
    }

    #[test]
    fn show_observability_plan_rejects_missing_error_handling() {
        let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"success_metric":{"kind":"latency","description":"x"}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("error_handling")));
    }

    #[test]
    fn show_observability_plan_rejects_unknown_metric_kind() {
        let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"error_handling":{"triggers":["a"],"escalation":"e"},"success_metric":{"kind":"vibes","description":"x"}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("kind")));
    }

    // ── show_decision_log ───────────────────────────────────────────────

    #[test]
    fn show_decision_log_emits_chat_card_and_persists() {
        let pool = test_pool();
        let op = r###"{"op":"propose_action","action":"show_decision_log","params":{"intent":"persona_abc","decisions":[{"label":"Model tier","choice":"Sonnet","rationale":"right balance"},{"label":"Triggers","choice":"Slack only","rationale":"scope"}]}}"###;
        let text = format!("Some prose.\nOP: {op}");
        let out = dispatch(&pool, "default", &text).expect("dispatch ok");
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "decision_log");

        // Verify rows landed in companion_design_decision.
        let conn = pool.get().expect("get conn");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM companion_design_decision WHERE persona_context = 'persona_abc'",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(count, 2);
    }

    #[test]
    fn show_decision_log_rejects_missing_rationale() {
        let op = r###"{"op":"propose_action","action":"show_decision_log","params":{"decisions":[{"label":"X","choice":"Y","rationale":""}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("rationale")));
    }

    // ── show_persona_ready ──────────────────────────────────────────────

    #[test]
    fn show_persona_ready_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"interactive","summary":{"intent_line":"Triage tickets","model_tier":"sonnet"}}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "persona_ready");
    }

    #[test]
    fn show_persona_ready_rejects_missing_intent_line() {
        let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"interactive","summary":{}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("intent_line")));
    }

    #[test]
    fn show_persona_ready_rejects_unknown_recommended_action() {
        let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"explode","summary":{"intent_line":"x"}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("recommended_action")));
    }

    // ── show_design_capabilities ────────────────────────────────────────

    #[test]
    fn show_design_capabilities_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_design_capabilities","params":{"intro":"Here's the menu."}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "design_capabilities");
    }

    #[test]
    fn show_design_capabilities_tolerates_empty_intro() {
        let op = r###"{"op":"propose_action","action":"show_design_capabilities","params":{}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
    }

    // ── show_recent_decisions ───────────────────────────────────────────

    #[test]
    fn show_recent_decisions_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{"persona_context":"persona_abc","limit":3}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "recent_decisions");
    }

    #[test]
    fn show_recent_decisions_rejects_missing_context() {
        let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("persona_context")));
    }

    #[test]
    fn show_recent_decisions_clamps_limit() {
        let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{"persona_context":"x","limit":42}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        let limit = out.chat_cards[0]
            .config
            .get("limit")
            .and_then(|v| v.as_u64())
            .expect("limit field");
        assert!((1..=5).contains(&limit));
    }
}

