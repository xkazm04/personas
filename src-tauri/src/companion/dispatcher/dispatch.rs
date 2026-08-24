//! The dispatch path itself: scan the finalized assistant text, parse each
//! op line, validate it against [`super::catalog`], and either auto-fire it
//! or persist an approval card.
//!
//! Moved verbatim out of the former single-file `dispatcher.rs`. The two
//! entry points and the ordered sequence of arms inside `dispatch_with_sys`
//! are byte-for-byte what they were before the split — ordering there is
//! behaviour.

use super::approvals::{insert_approval, note_dispatcher_rejection};
use super::canvas_control::validate_canvas_control;
use super::catalog::{
    ALLOWED_ACTIONS, ALLOWED_LAB_MODES, ALLOWED_ROUTES, ANCHOR_IDS, COMPOSE_MAX_STEPS,
    COMPOSE_MIN_STEPS, GUIDED_TOPICS, READ_OPS, READ_OPS_QUERY_OPTIONAL, READ_OP_QUERY_MAX,
};
use super::envelope::{repair_op_json, OpEnvelope};
use super::read_ops::{
    describe_context, describe_persona, describe_skill, list_runner_tasks, list_teams,
    note_read_op_result,
};
use super::types::{
    CanvasControlDispatch, CanvasPanelCompose, ChatCard, ComposedWalkthrough, Dispatched, PointAt,
    CANVAS_CONTROL_MAX_PER_TURN, CANVAS_PANEL_MAX_BLOCKS, CANVAS_PANEL_SPEC_VERSION,
};
use crate::db::UserDbPool;
use crate::error::AppError;

/// Scan assistant text for op JSON blocks, persist them as approval rows,
/// and return cleaned text + the list of created approvals.
///
/// We accept two formats:
///   - One JSON object per line, prefixed with `OP:` for readability:
///     `OP: {"op": "propose_action", ...}`
///   - Bare lines that start with `{"op":` are also accepted.
///     Both forms get stripped from the cleaned text. Markdown code fences
///     containing JSON are not parsed (those are display-only).
pub fn dispatch(
    pool: &UserDbPool,
    session_id: &str,
    assistant_text: &str,
) -> Result<Dispatched, AppError> {
    dispatch_with_sys(pool, None, session_id, assistant_text)
}

/// Same as [`dispatch`], plus a handle on the *system* DB so the read-only
/// `describe_*` / `list_teams` ops can answer from the tables that actually
/// hold personas, dev contexts and teams. `sys_db: None` keeps every other
/// arm working exactly as before and makes the four read ops report that
/// the lookup surface is unavailable (the bench harness path, which builds
/// only a user DB).
pub fn dispatch_with_sys(
    pool: &UserDbPool,
    sys_db: Option<&crate::db::DbPool>,
    session_id: &str,
    assistant_text: &str,
) -> Result<Dispatched, AppError> {
    let mut out = Dispatched::default();
    let mut cleaned_lines: Vec<&str> = Vec::with_capacity(assistant_text.lines().count());

    for line in assistant_text.lines() {
        let trimmed = line.trim_start();

        // PROGRESS line: `PROGRESS: <short update>` — a live narration beat
        // Athena emits mid-turn (Variant B in
        // docs/features/companion/conversation-orchestration.md). The
        // frontend detects + speaks these the instant their line completes
        // in the stream; here we only strip them from the persisted reply so
        // they never appear in the final bubble.
        if let Some(beat) = trimmed.strip_prefix("PROGRESS:") {
            let beat = beat.trim();
            if !beat.is_empty() {
                out.progress_beats.push(beat.to_string());
            }
            continue;
        }

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

        // Extract an op payload. Accept `OP:` at line start, a bare `{"op"` line,
        // OR an `OP: {…}` marker that appears mid-line — Athena sometimes prefixes
        // a word on the same line ("Building it. OP: {…}"), which would otherwise be
        // silently dropped. In the mid-line case the prose before the marker is kept
        // for display so only the op JSON is stripped.
        let payload = if let Some(rest) = trimmed.strip_prefix("OP:") {
            rest.trim()
        } else if trimmed.starts_with("{\"op\"") {
            trimmed
        } else if let Some(idx) = trimmed.find("OP:") {
            let after = trimmed[idx + 3..].trim_start();
            if after.starts_with('{') {
                let before = trimmed[..idx].trim_end();
                if !before.is_empty() {
                    cleaned_lines.push(before);
                }
                after
            } else {
                cleaned_lines.push(line);
                continue;
            }
        } else {
            cleaned_lines.push(line);
            continue;
        };

        // Parse the op JSON — with a bounded brace-completion fallback.
        // LLMs occasionally drop trailing `}`s on long single-line op JSON
        // (observed live 2026-07-04: an 1100-char `dev_improve` op missing
        // exactly its final envelope brace — the assistant prose claimed a
        // dispatch that never landed, the op vanished as a parse warning).
        // `repair_op_json` appends only the missing closing braces, only
        // when the line doesn't end inside a string literal — a syntactic
        // completion, never a semantic guess. Anything unrepairable keeps
        // the original parse error.
        let parsed = serde_json::from_str::<OpEnvelope>(payload).or_else(|orig_err| {
            match repair_op_json(payload) {
                Some(fixed) => serde_json::from_str::<OpEnvelope>(&fixed).map_err(|_| orig_err),
                None => Err(orig_err),
            }
        });
        match parsed {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_recent_decisions" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_design_capabilities" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_persona_ready" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_decision_log" => {
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
                        if d.get(field)
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
                let inputs: Vec<crate::companion::brain::decisions::DecisionInput<'_>> = decisions
                    .iter()
                    .filter_map(|d| {
                        let label = d.get("label").and_then(|v| v.as_str())?;
                        let choice = d.get("choice").and_then(|v| v.as_str())?;
                        let rationale = d.get("rationale").and_then(|v| v.as_str())?;
                        let decision_timestamp = d.get("timestamp").and_then(|v| v.as_str());
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
            Ok(env) if env.op == "propose_action" && env.action == "show_observability_plan" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_model_tier_choice" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_trigger_set" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_use_case_set" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_browser_test_report" => {
                // Browser-test verdict card (Athena × browser tester arc,
                // Phase 3). Emitted at the END of a browser-test turn so the
                // result lands as a structured, scannable artifact instead of
                // prose-only. Auto-fire — the test itself was the gated act;
                // the report is just its output.
                let url = env
                    .params
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let steps = env
                    .params
                    .get("steps")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if steps.is_empty() || steps.len() > 12 {
                    out.warnings.push(format!(
                        "show_browser_test_report: `steps` must be 1-12 {{label, result, evidence?}} rows, got {}",
                        steps.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let mut bad_result: Option<String> = None;
                for s in &steps {
                    let r = s.get("result").and_then(|v| v.as_str()).unwrap_or("");
                    if !matches!(r, "pass" | "fail" | "warn") {
                        bad_result = Some(r.to_string());
                        break;
                    }
                }
                if let Some(r) = bad_result {
                    out.warnings.push(format!(
                        "show_browser_test_report: `result` must be pass|fail|warn, got `{r}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let defects = env
                    .params
                    .get("defects")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if defects.len() > 8 {
                    out.warnings.push(format!(
                        "show_browser_test_report: cap `defects` at 8, got {}",
                        defects.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let console_errors = env
                    .params
                    .get("console_errors")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().take(20).cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                let security_notes = env
                    .params
                    .get("security_notes")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().take(5).cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "browser_test_report".to_string(),
                    title,
                    config: serde_json::json!({
                        "url": url,
                        "project_name": env.params.get("project_name").and_then(|v| v.as_str()).unwrap_or(""),
                        // Goal-UAT linkage: when this report is a goal's acceptance
                        // gate, the directive injects goal_id so the card can close
                        // the gate on a clean pass.
                        "goal_id": env.params.get("goal_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "steps": steps,
                        "defects": defects,
                        "console_errors": console_errors,
                        "security_notes": security_notes,
                    }),
                });
            }
            Ok(env) if env.op == "propose_action" && env.action == "show_template_suggestions" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "show_persona_walkthrough" => {
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
            Ok(env) if env.op == "propose_action" && env.action == "explain_in_cockpit" => {
                // Ephemeral explanation overlay (orb decision `0` flow). Unlike
                // compose_cockpit, widget kinds are validated here: an
                // explanation with a hallucinated kind renders as an error box
                // at the worst possible moment (the user just asked for help),
                // so unknown kinds are dropped with a warning instead.
                const EXPLAIN_KINDS: &[&str] = &[
                    "verdict",
                    "flow_steps",
                    "comparison_cards",
                    "timeline",
                    "stat_grid",
                    "log_excerpt",
                    "text_callout",
                    "metric_spark",
                    "issue_list",
                ];
                let widgets_arr = env
                    .params
                    .get("widgets")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let mut kept: Vec<serde_json::Value> = Vec::new();
                for w in widgets_arr {
                    let kind = w.get("kind").and_then(|k| k.as_str()).unwrap_or("");
                    if EXPLAIN_KINDS.contains(&kind) {
                        kept.push(w);
                    } else {
                        out.warnings.push(format!(
                            "explain_in_cockpit: dropped unknown widget kind `{kind}`"
                        ));
                    }
                }
                if kept.is_empty() {
                    out.warnings.push(
                        "explain_in_cockpit: `widgets` must be a non-empty array of known kinds"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Explanation");
                let decision_id = env
                    .params
                    .get("decision_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let now = chrono::Utc::now().to_rfc3339();
                let spec = serde_json::json!({
                    "title": title,
                    "decision_id": decision_id,
                    "widgets": kept,
                    "updated_at": now,
                });
                out.explain_cockpits.push(spec.to_string());
            }
            // ─────────────────────────────────────────────────────────────
            // WP3 — composing a panel beside the Mastermind canvas.
            //
            // The canvas is the artifact she acts IN, so a composed surface
            // docks there rather than becoming another chat card. Auto-fire,
            // no approval: a SurfaceSpec renders information and PROPOSES
            // actions, and every one of those is consent-gated at click time
            // by SurfaceRenderer. What gets validated here is the two things
            // the frontend cannot re-check: that the slug is an island she
            // actually read out of the published scene (not a demo island,
            // not an invention), and that the spec is a v1 envelope with
            // blocks in it.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "compose_canvas_panel" => {
                let slug = env
                    .params
                    .get("slug")
                    .or_else(|| env.params.get("project"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                // Without the system DB there is no published scene to check
                // the slug against, and an unvalidated slug is exactly what
                // this op exists to prevent. Fail closed.
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "compose_canvas_panel could not be validated: the canvas snapshot is \
                         not reachable from this turn. Tell the user rather than composing."
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                };
                let slug = match crate::companion::canvas::resolve_scene_slug(db, slug) {
                    Ok(s) => s,
                    Err(reason) => {
                        out.warnings.push(format!("compose_canvas_panel: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                };
                let spec = env.params.get("spec");
                let blocks = spec
                    .and_then(|s| s.get("blocks"))
                    .and_then(|v| v.as_array());
                let envelope_ok =
                    spec.and_then(|s| s.get("surface")).and_then(|v| v.as_str()) == Some("v1");
                match (envelope_ok, blocks) {
                    (true, Some(b)) if !b.is_empty() && b.len() <= CANVAS_PANEL_MAX_BLOCKS => {
                        out.canvas_panels.push(CanvasPanelCompose {
                            slug,
                            spec_version: CANVAS_PANEL_SPEC_VERSION,
                            spec: spec.map(|s| s.to_string()).unwrap_or_default(),
                        });
                    }
                    (_, Some(b)) if b.len() > CANVAS_PANEL_MAX_BLOCKS => {
                        out.warnings.push(format!(
                            "compose_canvas_panel: {} blocks exceeds the cap of \
                             {CANVAS_PANEL_MAX_BLOCKS}. Compose the ones that matter.",
                            b.len()
                        ));
                        cleaned_lines.push(line);
                    }
                    _ => {
                        out.warnings.push(
                            "compose_canvas_panel: `spec` must be a SurfaceSpec v1 envelope — \
                             {\"surface\":\"v1\",\"title\":…,\"blocks\":[…]} with at least one block."
                                .into(),
                        );
                        cleaned_lines.push(line);
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────
            // WP4 — steering the Mastermind canvas (`canvas_control`).
            //
            // The v2 door onto the frontend's canvas action grammar
            // (`canvasActionStore`): camera verbs plus the zoom-gated popover
            // opens. Auto-fire, no approval: every accepted kind is
            // reversible VIEW state and mutates nothing — the same consent
            // posture as compose. Rust validates what the frontend cannot:
            // that any slug names an island in the PUBLISHED scene, that the
            // kind is one the grammar speaks, and that bands / numbers are
            // well-formed. The settled result (band, camera, refusal) comes
            // back through `companion_canvas_control_result` as a System
            // episode on the next turn.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "canvas_control" => {
                if out.canvas_controls.len() >= CANVAS_CONTROL_MAX_PER_TURN {
                    out.warnings.push(format!(
                        "canvas_control: more than {CANVAS_CONTROL_MAX_PER_TURN} steering \
                         actions in one turn is camera thrash; the extras were dropped."
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "canvas_control could not be validated: the canvas snapshot is not \
                         reachable from this turn. Tell the user rather than steering blind."
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                };
                match validate_canvas_control(db, &env.params) {
                    Ok(action_json) => out.canvas_controls.push(CanvasControlDispatch {
                        action: action_json,
                    }),
                    Err(reason) => {
                        out.warnings.push(format!("canvas_control: {reason}"));
                        cleaned_lines.push(line);
                    }
                }
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
            // Phase F/G: `use_connector` is gated PER CAPABILITY (see the
            // `cap.requires_approval` branch near the end of this arm):
            // read-only capabilities auto-fire through the background-job
            // worker (no approval card — friction the user explicitly
            // rejected for list/get calls); write/mutation capabilities route
            // through an approval card instead. Validation happens here so a
            // hallucinated connector/capability surfaces as a system episode
            // (Athena reads it next turn) instead of a wasted job queue slot.
            //
            // Rejection visibility: every rejection path below also
            // writes a System episode via `note_dispatcher_rejection`
            // so Athena's *next* turn knows her last `use_connector`
            // got dropped — closes the silent-prod-no-op pattern the
            // 2026-05-27 stress run surfaced (5 turns claimed action
            // but produced no job because the dispatcher silently
            // stripped the OP).
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
                    note_dispatcher_rejection(
                        pool,
                        session_id,
                        connector_name,
                        capability,
                        "missing `connector_name` or `capability` field",
                    );
                    out.warnings
                        .push("use_connector: missing `connector_name` or `capability`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                // Verify the connector is pinned + enabled in the
                // sidebar before queuing — saves the worker from
                // running with no credentials accessible. Always-active
                // builtins (local_drive, personas_database, codebase,
                // …) bypass this check: they have no credentials to
                // pin and the user doesn't need to opt in.
                let bypass_pin_gate =
                    crate::companion::connectors::is_always_active_builtin(connector_name);
                if !bypass_pin_gate {
                    match crate::companion::connectors::list(pool) {
                        Ok(active) => {
                            let row = active.iter().find(|c| c.connector_name == connector_name);
                            match row {
                                Some(r) if !r.enabled => {
                                    let reason = format!(
                                        "`{connector_name}` is pinned but disabled — ask the user to toggle it on, or pivot to a wired+enabled connector"
                                    );
                                    note_dispatcher_rejection(
                                        pool,
                                        session_id,
                                        connector_name,
                                        capability,
                                        &reason,
                                    );
                                    out.warnings.push(format!("use_connector: {reason}"));
                                    cleaned_lines.push(line);
                                    continue;
                                }
                                None => {
                                    let reason = format!(
                                        "`{connector_name}` is not pinned in the sidebar — ask the user to pin it via the vault, or pivot to a wired connector"
                                    );
                                    note_dispatcher_rejection(
                                        pool,
                                        session_id,
                                        connector_name,
                                        capability,
                                        &reason,
                                    );
                                    out.warnings.push(format!("use_connector: {reason}"));
                                    cleaned_lines.push(line);
                                    continue;
                                }
                                _ => {} // pinned + enabled — proceed.
                            }
                        }
                        Err(e) => {
                            let reason =
                                format!("connector list query failed ({e}) — internal DB issue");
                            note_dispatcher_rejection(
                                pool,
                                session_id,
                                connector_name,
                                capability,
                                &reason,
                            );
                            out.warnings
                                .push(format!("use_connector: connector list failed: {e}"));
                            cleaned_lines.push(line);
                            continue;
                        }
                    }
                }
                // Validate capability against the registry.
                let caps = crate::companion::connectors::capabilities_for(connector_name);
                let cap_match = caps.and_then(|cs| cs.iter().find(|c| c.slug == capability));
                let Some(cap) = cap_match else {
                    let known_list: Vec<&str> = caps
                        .map(|cs| cs.iter().map(|c| c.slug).collect())
                        .unwrap_or_default();
                    let reason = format!(
                        "capability `{capability}` not in `{connector_name}` registry; known capabilities: {known_list:?}"
                    );
                    note_dispatcher_rejection(
                        pool,
                        session_id,
                        connector_name,
                        capability,
                        &reason,
                    );
                    out.warnings.push(format!("use_connector: {reason}"));
                    cleaned_lines.push(line);
                    continue;
                };

                // Approval-gated capabilities (writes to user-visible
                // external surfaces — post a message, send an email,
                // run a mutation) route through the approval card path
                // instead of auto-firing. Read-only capabilities
                // (list_*, get_*) auto-fire as before. The flag is
                // declared on `ConnectorCapability::requires_approval`.
                if cap.requires_approval {
                    match insert_approval(pool, session_id, &env) {
                        Ok(created) => out.approvals.push(created),
                        Err(e) => {
                            let reason = format!(
                                "approval-card insert for `{connector_name}.{capability}` failed: {e}"
                            );
                            note_dispatcher_rejection(
                                pool,
                                session_id,
                                connector_name,
                                capability,
                                &reason,
                            );
                            out.warnings.push(format!("use_connector: {reason}"));
                        }
                    }
                    // Strip the OP line from display; the approval
                    // card now carries the action.
                    continue;
                }

                // Auto-fire path: enqueue. Job worker picks it up within
                // seconds and appends a system episode with the result;
                // chat is never blocked.
                let job_params = serde_json::json!({
                    "connector_name": connector_name,
                    "capability": capability,
                    "args": env.params.get("args").cloned().unwrap_or(serde_json::json!({})),
                });
                let task_title = format!("Calling {connector_name}");
                if let Err(e) = crate::companion::jobs::enqueue_task(
                    pool,
                    "connector_use",
                    &job_params,
                    None,
                    Some(&task_title),
                    None, // parent_turn_id threaded in phase 2 (episode id not yet known here)
                    Some(session_id), // owning conversation (multiconv P1)
                ) {
                    let reason = format!(
                        "background-job enqueue failed for `{connector_name}.{capability}`: {e}"
                    );
                    note_dispatcher_rejection(
                        pool,
                        session_id,
                        connector_name,
                        capability,
                        &reason,
                    );
                    out.warnings.push(format!("use_connector: {reason}"));
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
            Ok(env) if env.op == "propose_action" && env.action == "continue_autonomously" => {
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
            // ─────────────────────────────────────────────────────────────
            // WP2 — the editable multi-session fleet plan.
            //
            // Athena drafts what she would start (typed turn or spoken turn —
            // voice reaches the same `send()` path, so nothing here may assume
            // a typed origin), the CHAT card lets the user edit and confirm,
            // and only then does anything spawn. Auto-fire, no approval card:
            // the card itself IS the consent surface.
            //
            // Everything is validated HERE, at the door, against the same
            // boundaries `fleet_dispatch` enforces at fire time — so a plan
            // that renders is a plan that can actually run. Rejection follows
            // the arm convention: a warning Athena reads next turn, and the op
            // line stripped from the visible reply.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "show_fleet_plan" => {
                let intent = env
                    .params
                    .get("operation_intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let rows = env
                    .params
                    .get("rows")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                // The cwd rule needs the system DB (`dev_projects`). Without it
                // we cannot prove containment, so we fail CLOSED rather than
                // render an unvalidated plan whose Confirm button spawns
                // permission-skipping terminals.
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "show_fleet_plan could not be validated: the project registry is not \
                         reachable from this turn. Tell the user rather than proposing a plan."
                            .into(),
                    );
                    continue;
                };
                match crate::commands::companion::approvals::validate_fleet_plan(db, intent, &rows)
                {
                    Ok((intent, plan)) => {
                        let rows_json: Vec<serde_json::Value> = plan
                            .iter()
                            .map(|r| {
                                serde_json::json!({
                                    "cwd": r.cwd,
                                    "objective": r.objective,
                                    "skill": r.skill,
                                    "label": r.label,
                                    "model": r.model,
                                    "effort": r.effort,
                                })
                            })
                            .collect();
                        out.chat_cards.push(ChatCard {
                            kind: "fleet_plan".to_string(),
                            title: env
                                .params
                                .get("title")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            config: serde_json::json!({
                                "operation_intent": intent,
                                "rows": rows_json,
                            }),
                        });
                    }
                    Err(reason) => {
                        out.warnings
                            .push(format!("rejected show_fleet_plan: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────
            // WP3 — the editable ship milestone.
            //
            // The same contract as `show_fleet_plan` one arm up, aimed at the
            // Ship layer instead of the fleet: Athena proposes a WHOLE
            // milestone (name, goal, scope members), the chat card is where
            // the operator edits and drops rows, and nothing is written until
            // Confirm. Auto-fire, no approval card — the card IS the consent
            // surface — and NOT an `ALLOWED_ACTIONS` entry, so there is no
            // executor arm and no second list to drift.
            //
            // Every id is resolved HERE against the real registry, by the same
            // validator the confirm path re-runs. A milestone whose members
            // do not exist is not a milestone.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "show_ship_milestone" => {
                let project_slug = env
                    .params
                    .get("project_slug")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let name = env
                    .params
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let goal = env
                    .params
                    .get("goal")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                // `goal` is the milestone's TITLE and is length-bounded as one;
                // the prose belongs here. Splitting them is what stops a
                // paragraph rendering where a heading goes — see
                // SHIP_MILESTONE_GOAL_MAX.
                let description = env
                    .params
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let rows = env
                    .params
                    .get("rows")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                // Resolving a project, its use cases and its goals all need the
                // system DB. Without it there is no way to tell a real id from
                // an invented one, so we fail CLOSED rather than render a card
                // whose Confirm button would write a milestone full of
                // hallucinated members.
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "show_ship_milestone could not be validated: the project registry is \
                         not reachable from this turn. Tell the user rather than proposing a \
                         milestone."
                            .into(),
                    );
                    continue;
                };
                match crate::commands::companion::approvals::validate_ship_milestone(
                    db,
                    project_slug,
                    name,
                    goal,
                    description,
                    &rows,
                ) {
                    Ok(plan) => {
                        let rows_json: Vec<serde_json::Value> = plan
                            .rows
                            .iter()
                            .map(|r| {
                                serde_json::json!({
                                    "item_kind": r.item_kind,
                                    "item_id": r.item_id,
                                    "description": r.description,
                                })
                            })
                            .collect();
                        out.chat_cards.push(ChatCard {
                            kind: "ship_milestone".to_string(),
                            title: env
                                .params
                                .get("title")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            config: serde_json::json!({
                                "project_id": plan.project_id,
                                "name": plan.name,
                                "goal": plan.goal,
                                "rows": rows_json,
                            }),
                        });
                    }
                    Err(reason) => {
                        out.warnings
                            .push(format!("rejected show_ship_milestone: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_persona_creation_offer" =>
            {
                // Offer card: "Build it for me" vs "Show me how to build it".
                // Athena emits this when a user describes a persona they want.
                // Auto-fire — the user picks from the two buttons; the widget
                // owns the build-prefill / walkthrough-trigger wiring on click.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if intent.is_empty() {
                    out.warnings
                        .push("show_persona_creation_offer: missing `intent`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                out.chat_cards.push(ChatCard {
                    kind: "persona_creation_offer".to_string(),
                    title: None,
                    config: serde_json::json!({ "intent": intent }),
                });
            }
            Ok(env) if env.op == "propose_action" && env.action == "show_walkthrough_offer" => {
                // Generalized "Show me / Just tell me" offer for any guided
                // walkthrough (E3). Auto-fire; the widget owns the click wiring.
                // `topic` must be a real, allow-listed walkthrough.
                let topic = env
                    .params
                    .get("topic")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let summary = env
                    .params
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if topic.is_empty() {
                    out.warnings
                        .push("show_walkthrough_offer: missing `topic`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                // Generative Tours: a topic OUTSIDE the static registry is no
                // longer rejected — it is offered as a *generative* walkthrough
                // ("Show me" composes a tour via `compose_tour` instead of
                // playing a registry script). Sanitize free-text topics hard:
                // they render in the widget and seed the compose prompt.
                let is_static = GUIDED_TOPICS.contains(&topic);
                if !is_static && topic.len() > 120 {
                    out.warnings.push(format!(
                        "rejected walkthrough offer topic (too long: {} chars)",
                        topic.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.chat_cards.push(ChatCard {
                    kind: "walkthrough_offer".to_string(),
                    title: None,
                    config: serde_json::json!({
                        "topic": topic,
                        "summary": summary,
                        "generative": !is_static,
                    }),
                });
            }
            Ok(env) if env.op == "propose_action" && env.action == "start_guided_walkthrough" => {
                // Auto-fire: launch a registry-defined guided walkthrough (orb
                // glides + element glow + narration). The step content lives in
                // the frontend registry (`guidance/walkthroughs.ts`); Athena
                // only names a topic, which we validate against the allow-list.
                let topic = env
                    .params
                    .get("topic")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if topic.is_empty() {
                    out.warnings
                        .push("start_guided_walkthrough: missing `topic`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !GUIDED_TOPICS.contains(&topic) {
                    out.warnings.push(format!(
                        "rejected guided walkthrough topic `{topic}` (expected one of {GUIDED_TOPICS:?})"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.guide_walkthroughs.push(topic.to_string());
            }
            Ok(env) if env.op == "propose_action" && env.action == "point_at" => {
                // Auto-fire: ring one allow-listed UI anchor + narrate it (no
                // pre-authored topic). The anchor names a stable target from the
                // shared catalog; narration is the line Athena wrote this turn.
                let anchor = env
                    .params
                    .get("anchor")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let narration = env
                    .params
                    .get("narration")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                if anchor.is_empty() || narration.is_empty() {
                    out.warnings
                        .push("point_at: missing `anchor` or `narration`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !ANCHOR_IDS.contains(&anchor) {
                    out.warnings.push(format!(
                        "rejected point_at anchor `{anchor}` (expected one of {ANCHOR_IDS:?})"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.point_ats.push(PointAt {
                    anchor: anchor.to_string(),
                    narration: narration.to_string(),
                });
            }
            Ok(env) if env.op == "propose_action" && env.action == "compose_walkthrough" => {
                // Auto-fire: a runtime-assembled multi-step tour over catalog
                // anchors. Validate every step (anchor in catalog + non-empty
                // narration) and the overall length; reject the whole tour on
                // any bad step so a half-broken walkthrough never runs.
                let raw_steps = env.params.get("steps").and_then(|v| v.as_array());
                let Some(raw_steps) = raw_steps else {
                    out.warnings
                        .push("compose_walkthrough: missing `steps` array".into());
                    cleaned_lines.push(line);
                    continue;
                };
                if raw_steps.len() < COMPOSE_MIN_STEPS || raw_steps.len() > COMPOSE_MAX_STEPS {
                    out.warnings.push(format!(
                        "rejected compose_walkthrough: {} steps (expected {COMPOSE_MIN_STEPS}-{COMPOSE_MAX_STEPS})",
                        raw_steps.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let mut steps = Vec::with_capacity(raw_steps.len());
                let mut bad: Option<String> = None;
                for s in raw_steps {
                    let anchor = s.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
                    let narration = s
                        .get("narration")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    if anchor.is_empty() || narration.is_empty() {
                        bad = Some("a step is missing `anchor` or `narration`".into());
                        break;
                    }
                    if !ANCHOR_IDS.contains(&anchor) {
                        bad = Some(format!("unknown anchor `{anchor}`"));
                        break;
                    }
                    steps.push(PointAt {
                        anchor: anchor.to_string(),
                        narration: narration.to_string(),
                    });
                }
                if let Some(reason) = bad {
                    out.warnings
                        .push(format!("rejected compose_walkthrough: {reason}"));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                out.composed_walkthroughs
                    .push(ComposedWalkthrough { title, steps });
            }
            Ok(env) if env.op == "propose_action" && env.action == "compose_tour" => {
                // Generative Tours: a full persisted tour (vs the ephemeral
                // `compose_walkthrough` above). Every step is proven against
                // the generated tour-anchor manifest — an unknown spotlight
                // anchor, sidebar section, or sub-tab setter rejects the
                // WHOLE tour with a warning Athena sees next turn. Valid
                // specs are persisted by session.rs via `tours::save_tour`
                // and surface in the Learning timeline with the
                // composed-by-Athena badge.
                let topic = env
                    .params
                    .get("topic")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty() && s.len() <= 120)
                    .unwrap_or("walkthrough");
                match crate::companion::tours::validate_tour_spec(&env.params) {
                    Ok((title, description, steps)) => {
                        out.composed_tours.push(
                            serde_json::json!({
                                "topic": topic,
                                "title": title,
                                "description": description,
                                "steps": steps,
                            })
                            .to_string(),
                        );
                    }
                    Err(reason) => {
                        out.warnings
                            .push(format!("rejected compose_tour: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────
            // Detail-on-demand read ops (auto-fire, read-only, no approval).
            //
            // The prompt carries a BOUNDED index of personas / dev contexts
            // / skills (see `prompt::format_persona_index` and friends).
            // These four ops are the other half of that contract: the index
            // is deliberately truncated, so Athena needs a cheap way to pull
            // one full record — and `assign_team` needs a `team_id` that the
            // always-on index does not carry at all.
            //
            // They are special-case arms rather than ALLOWED_ACTIONS entries
            // on purpose: an entry there requires a matching executor, and
            // the two lists have diverged before. An arm that does the whole
            // job here cannot diverge from anything. Nothing mutates; the
            // result is appended as a System episode so it lands in the next
            // turn's recall, the same channel `note_dispatcher_rejection`
            // uses.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && READ_OPS.contains(&env.action.as_str()) => {
                let query = env
                    .params
                    .get("query")
                    .and_then(|v| v.as_str())
                    .or_else(|| env.params.get("persona_id").and_then(|v| v.as_str()))
                    .or_else(|| env.params.get("context_id").and_then(|v| v.as_str()))
                    .or_else(|| env.params.get("name").and_then(|v| v.as_str()))
                    .or_else(|| env.params.get("slug").and_then(|v| v.as_str()))
                    .map(str::trim)
                    .unwrap_or("");
                let action = env.action.as_str();
                if query.is_empty() && !READ_OPS_QUERY_OPTIONAL.contains(&action) {
                    let reason =
                        format!("`{action}` needs a `query` param (the name or id to look up)");
                    note_read_op_result(pool, session_id, action, query, &reason);
                    out.warnings.push(format!("{action}: missing `query`"));
                    continue;
                }
                if query.len() > READ_OP_QUERY_MAX {
                    let reason = format!(
                        "`{action}` query was {} chars; keep it to a name or id (max {READ_OP_QUERY_MAX})",
                        query.len()
                    );
                    note_read_op_result(pool, session_id, action, "", &reason);
                    out.warnings.push(format!("{action}: query too long"));
                    continue;
                }
                let body = match action {
                    "describe_skill" => describe_skill(sys_db, query),
                    _ => match sys_db {
                        Some(db) => match action {
                            "describe_persona" => describe_persona(db, query),
                            "describe_context" => describe_context(db, query),
                            "describe_canvas_project" => {
                                crate::companion::canvas::describe_canvas_project(db, query)
                            }
                            "describe_canvas_freshness" => {
                                crate::companion::canvas::describe_canvas_freshness(db, query)
                            }
                            "list_runner_tasks" => list_runner_tasks(db, query),
                            "describe_skill_fleet" => {
                                crate::companion::knowledge_ops::describe_skill_fleet(db, query)
                            }
                            "describe_knowledge" => {
                                crate::companion::knowledge_ops::describe_knowledge(db, query)
                            }
                            "describe_ship_milestone" => {
                                crate::companion::ship_ops::describe_ship_milestone(db, query)
                            }
                            _ => list_teams(db, query),
                        },
                        None => format!(
                            "`{action}` could not run: the app database is not \
                             reachable from this turn. Tell the user rather \
                             than guessing an id."
                        ),
                    },
                };
                note_read_op_result(pool, session_id, action, query, &body);
            }
            Ok(mut env) if env.op == "propose_action" => {
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
                // A backlog-triage batch with no items would render an
                // actionable card whose Approve button applies nothing. Reject
                // it at parse time rather than persisting a no-op consent
                // surface (same reasoning as the blank-action skip in
                // `companion_list_pending_approvals`).
                if env.action == "backlog_apply_triage" {
                    let has_items = env
                        .params
                        .get("items")
                        .and_then(|v| v.as_array())
                        .is_some_and(|arr| !arr.is_empty());
                    if !has_items {
                        out.warnings.push(
                            "rejected backlog_apply_triage: `items` must be a non-empty array"
                                .to_string(),
                        );
                        cleaned_lines.push(line);
                        continue;
                    }
                }
                // Identity diffs (F1): structurally validate the anchored-diff
                // batch before it becomes an approval card. The full
                // anchor-exists check happens at execute time (partial-failure
                // reporting). `content`-mode (intake first draft) is unchecked.
                if env.action == "update_identity" {
                    if let Some(arr) = env.params.get("diffs").and_then(|v| v.as_array()) {
                        use crate::companion::brain::identity::{IdentityDiff, MAX_DIFFS_PER_OP};
                        if arr.is_empty() || arr.len() > MAX_DIFFS_PER_OP {
                            out.warnings.push(format!(
                                "rejected update_identity: 1..={MAX_DIFFS_PER_OP} diffs required, got {}",
                                arr.len()
                            ));
                            cleaned_lines.push(line);
                            continue;
                        }
                        if let Some(err) = arr.iter().find_map(|d| IdentityDiff::from_json(d).err())
                        {
                            out.warnings
                                .push(format!("rejected update_identity: {err}"));
                            cleaned_lines.push(line);
                            continue;
                        }
                    }
                }
                // Session-targeting fleet actions: resolve the target (Athena
                // may hold the claude_session_id rather than the fleet id —
                // either form resolves), normalize `session_id` to the fleet
                // id, and stamp the session's human label into the params and
                // the rationale — the approval card renders both, so the user
                // sees WHICH session is being typed into / closed instead of
                // a bare UUID.
                if matches!(
                    env.action.as_str(),
                    "fleet_send_input" | "fleet_intervene" | "fleet_kill"
                ) {
                    let raw = env
                        .params
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    if let Some(raw) = raw {
                        let registry = crate::commands::fleet::registry::registry();
                        if let Some(fleet_id) = registry.resolve_session_id(&raw) {
                            let label = registry.try_lookup_label(&fleet_id);
                            if let Some(obj) = env.params.as_object_mut() {
                                if fleet_id != raw {
                                    obj.insert(
                                        "session_id".into(),
                                        serde_json::Value::String(fleet_id.clone()),
                                    );
                                }
                                if let Some(label) = label.as_deref() {
                                    obj.insert(
                                        "session_label".into(),
                                        serde_json::Value::String(label.to_string()),
                                    );
                                }
                            }
                            if let Some(label) = label {
                                if !env.rationale.contains(&label) {
                                    env.rationale = if env.rationale.trim().is_empty() {
                                        format!("Session: {label}")
                                    } else {
                                        format!("{} — session: {label}", env.rationale.trim())
                                    };
                                }
                            }
                        }
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
                // The line was op-shaped (matched the OP:/`{"op"` grammar)
                // but names an op we don't handle. It's machine grammar,
                // not prose — drop it from display so the user never sees
                // a raw directive. The warning records it for Athena's
                // next-turn context and for dev logs. (Any prose that
                // preceded a mid-line `OP:` was already pushed separately.)
                out.warnings
                    .push(format!("ignored op `{}` (not in v1)", env.op));
            }
            Err(e) => {
                // Malformed op JSON (e.g. Athena pretty-printed it across
                // lines, or a typo). Still op-shaped — drop it from display
                // rather than leaking raw/broken JSON into the bubble and
                // the persisted episode. The warning carries the parse
                // error for diagnosis.
                out.warnings.push(format!("op parse error: {e}"));
            }
        }
    }

    out.cleaned_text = cleaned_lines.join("\n");

    // Residual machine-grammar safety net. Per-op rejection paths above
    // (connector not pinned, capability not in registry, approval-insert
    // failure, …) push the original `line` back onto `cleaned_lines` so
    // the surrounding prose survives — but that also re-admits the raw
    // `OP:` / `{"op"` directive into the persisted episode, which then
    // renders to the user and pollutes future-turn recall. Strip any
    // line that is still an op directive here, regardless of which
    // branch kept it. Prose virtually never starts with `OP:` or `{"op"`,
    // so this is safe; the frontend `stripModelDirectives` mirrors it as
    // a display-layer backstop.
    if out.cleaned_text.contains("OP:") || out.cleaned_text.contains("{\"op\"") {
        let kept: Vec<&str> = out
            .cleaned_text
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !(t.starts_with("OP:") || t.starts_with("{\"op\""))
            })
            .collect();
        out.cleaned_text = kept.join("\n");
    }

    // Trim the trailing whitespace introduced by stripped lines.
    while out.cleaned_text.ends_with(['\n', ' ']) {
        out.cleaned_text.pop();
    }
    Ok(out)
}
