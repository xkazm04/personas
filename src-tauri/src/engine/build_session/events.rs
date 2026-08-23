//! Tauri-channel + DB-update glue for build-session events.
//!
//! Keeps IPC, persistence, and process-registry bookkeeping out of the
//! run_session event loop. Every outbound build event goes through
//! `dual_emit` so listeners on BOTH the per-component Channel and the
//! global Tauri event bus receive it.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::Emitter;

use crate::db::models::{BuildEvent, BuildPhase, LlmSpendInsert, UpdateBuildSession};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::llm_spend;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ActiveProcessRegistry;

use super::super::event_registry::event_name;
use super::SessionHandle;

/// Payload emitted on `build-oneshot-terminal` when an autonomous build
/// reaches `Promoted` or `Failed`. Frontend listener (eventBridge.ts)
/// converts this into a notification-bell entry with a deep-link back to
/// the persona's draft.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOneShotTerminalPayload {
    pub session_id: String,
    pub persona_id: String,
    pub persona_name: Option<String>,
    /// Either `"promoted"` or `"failed"` — matches `BuildPhase::as_str()`.
    pub phase: String,
    pub success: bool,
    pub error_message: Option<String>,
}

/// Update the session phase in the database.
pub(super) fn update_phase(
    pool: &DbPool,
    session_id: &str,
    phase: BuildPhase,
) -> Result<(), AppError> {
    let res = build_session_repo::update(
        pool,
        session_id,
        &UpdateBuildSession {
            phase: Some(phase.as_str().to_string()),
            ..Default::default()
        },
    );
    // Telemetry (build-orchestration Phase 0): stamp a per-phase timestamp so
    // build-bench can reconstruct per-phase wall-clock. Best-effort — never
    // fail a phase transition on a timing write.
    let _ = build_session_repo::append_phase_timing(
        pool,
        session_id,
        phase.as_str(),
        &chrono::Utc::now().to_rfc3339(),
    );
    res
}

/// Update the session phase to Failed and store the error message.
pub(super) fn update_phase_with_error(
    pool: &DbPool,
    session_id: &str,
    error: &str,
) -> Result<(), AppError> {
    let res = build_session_repo::update(
        pool,
        session_id,
        &UpdateBuildSession {
            phase: Some(BuildPhase::Failed.as_str().to_string()),
            error_message: Some(Some(error.to_string())),
            cli_pid: Some(None),
            ..Default::default()
        },
    );
    let _ = build_session_repo::append_phase_timing(
        pool,
        session_id,
        BuildPhase::Failed.as_str(),
        &chrono::Utc::now().to_rfc3339(),
    );
    res
}

/// Telemetry (build-orchestration Phase 0): persist cumulative build CLI
/// cost/tokens + turn count on the session row. Best-effort — a failed write
/// is logged by the repo layer and never affects the build.
pub(super) fn record_build_usage(
    pool: &DbPool,
    session_id: &str,
    cost_usd: f64,
    input_tokens: i64,
    output_tokens: i64,
    num_turns: i64,
) {
    let _ = build_session_repo::update(
        pool,
        session_id,
        &UpdateBuildSession {
            total_cost_usd: Some(Some(cost_usd)),
            input_tokens: Some(Some(input_tokens)),
            output_tokens: Some(Some(output_tokens)),
            num_turns: Some(Some(num_turns)),
            ..Default::default()
        },
    );
}

// =============================================================================
// Central LLM-spend ledger (`dev_llm_spend`)
// =============================================================================
//
// `record_build_usage` above is the *session-local* sink: a cumulative
// overwrite of `build_sessions.total_cost_usd` that `tools/test-mcp/
// run_build_bench.py` reads directly. It is NOT on the LLM-spend dashboard —
// that surface only ever reads `dev_llm_spend`, which until now carried zero
// build rows (`select source, count(*) from dev_llm_spend group by 1` returned
// only `scanner` and `evaluator` on the operator's live DB, while 68 build
// sessions had booked $45.92 into the column nobody aggregates).
//
// So the two sinks are complementary, not duplicates:
//   * session column  — cumulative, overwritten per turn, one row per session.
//   * `dev_llm_spend` — append-only, ONE row per CLI `result` envelope.
// A turn therefore appears exactly once on the dashboard. Never book the
// accumulator (`acc_cost_usd`) into the ledger — that would re-book every
// prior turn on each pass.

/// Ledger `source` tier for every LLM leg of a design-wizard build. Matches
/// the `LlmSpendInsert::source` taxonomy (`scanner` | `evaluator` | `design` |
/// `kpi`); the build wizard is a design surface.
pub(super) const BUILD_SPEND_SOURCE: &str = "design";

/// `trigger_kind` for the main resolution turns driven by `runner::run_session`.
pub(super) const SPEND_RESOLUTION: &str = "build_resolution";

/// `trigger_kind` for the one-shot tool-test leg (`tool_tests::run_tool_tests`)
/// — the CLI pass that composes the per-tool test plan.
pub(super) const SPEND_TOOL_TEST: &str = "build_tool_test";

/// `trigger_kind` for the plain-language test-report leg
/// (`tool_tests::generate_test_summary`).
pub(super) const SPEND_TEST_SUMMARY: &str = "build_test_summary";

/// `trigger_kind` for the one-shot LLM correction leg
/// (`fix_pass::run_fix_pass`), which can run up to `MAX_TEST_RETRIES` times.
pub(super) const SPEND_FIX_PASS: &str = "build_fix_pass";

/// Decide whether `line` is a CLI `result` envelope worth booking, and if so
/// build the ledger row for it. Pure — split out from [`record_build_spend`]
/// so the booking rules are unit-testable without a database.
///
/// Returns `None` (book nothing) for anything that is not a complete `result`
/// envelope. That is deliberate: a leg whose stream was cut mid-flight (the
/// `...[timeout]` / `...[truncated]` partials `read_line_limited` hands back)
/// has an unknown cost, and inserting a zero-cost row would assert on the
/// dashboard that the leg was free. A `result` envelope with `is_error: true`
/// DOES book — a failed turn still costs money.
pub(super) fn build_spend_entry(
    persona_id: Option<&str>,
    trigger_kind: &str,
    model: Option<&str>,
    line: &str,
) -> Option<LlmSpendInsert> {
    // Cheap pre-filter so feeding this every stdout line stays ~free: only a
    // JSON object can be a `result` envelope.
    let trimmed = line.trim_start();
    if !trimmed.starts_with('{') {
        return None;
    }
    llm_spend::parse_result_line(
        &llm_spend::SpendCtx {
            source: BUILD_SPEND_SOURCE,
            trigger_kind,
            model,
            persona_id,
            project_id: None,
        },
        trimmed,
    )
}

/// Book one build-session CLI leg into the central `dev_llm_spend` ledger.
/// Best-effort (the repo layer logs + swallows insert failures) — spend
/// recording must never break a build. Returns `true` when a row was written.
///
/// `model` is only a fallback: `parse_result_line` prefers the model the CLI
/// itself reported in the envelope.
pub(super) fn record_build_spend(
    pool: &DbPool,
    persona_id: Option<&str>,
    trigger_kind: &str,
    model: Option<&str>,
    line: &str,
) -> bool {
    match build_spend_entry(persona_id, trigger_kind, model, line) {
        Some(entry) => {
            llm_spend::record(pool, &entry);
            true
        }
        None => false,
    }
}

/// Dual-emit a BuildEvent via both Channel (component-scoped) and Tauri events (global).
/// Channel delivers to the attached component; Tauri event reaches the global listener.
///
/// Returns `false` when the component Channel is dropped. The runner treats
/// that as cancellation because the user can no longer observe progress.
pub(super) fn dual_emit(
    pool: &DbPool,
    channel: &Channel<Value>,
    app: &tauri::AppHandle,
    event: &BuildEvent,
) -> bool {
    let (session_id, variant) = event_meta(event);
    let payload = match serde_json::to_value(event) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                event_variant = variant,
                error = ?error,
                "BuildSession dual_emit: failed to serialize build event"
            );
            return true;
        }
    };

    let channel_result = channel.send(payload.clone());
    if let Err(error) = &channel_result {
        warn_emit_failure_once(
            session_id,
            "channel",
            variant,
            format_args!("{error:?}"),
            "BuildSession dual_emit: component Channel send failed",
        );
        if let Err(touch_error) = build_session_repo::update(pool, session_id, &Default::default())
        {
            tracing::warn!(
                session_id = %session_id,
                event_variant = variant,
                error = ?touch_error,
                "BuildSession dual_emit: failed to stamp session after Channel send error"
            );
        }
        return false;
    }

    let emit_result = app.emit(event_name::BUILD_SESSION_EVENT, &payload);
    if let Err(error) = &emit_result {
        warn_emit_failure_once(
            session_id,
            "tauri",
            variant,
            format_args!("{error:?}"),
            "BuildSession dual_emit: global Tauri emit failed",
        );
        if let Err(touch_error) = build_session_repo::update(pool, session_id, &Default::default())
        {
            tracing::warn!(
                session_id = %session_id,
                event_variant = variant,
                error = ?touch_error,
                "BuildSession dual_emit: failed to stamp session after Tauri emit error"
            );
        }
    }
    true
}

fn warn_emit_failure_once(
    session_id: &str,
    channel: &str,
    variant: &'static str,
    error: std::fmt::Arguments<'_>,
    message: &'static str,
) {
    // Bound the dedupe set so a long-running app instance with thousands of
    // build sessions cannot slowly leak memory through this static. When the
    // bound is reached we drop the set and start over — the worst case is a
    // duplicated warning for an old session, which is preferable to a leak.
    const WARNED_MAX_ENTRIES: usize = 512;

    static WARNED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let key = format!("{session_id}:{channel}");
    let mut warned = WARNED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if warned.len() >= WARNED_MAX_ENTRIES {
        warned.clear();
    }
    if !warned.insert(key) {
        return;
    }
    tracing::warn!(
        session_id = %session_id,
        event_variant = variant,
        emit_channel = channel,
        error = %error,
        "{}",
        message
    );
}

/// Extract `(session_id, variant_token)` from a `BuildEvent` for diagnostic
/// logging. Variant tokens match the serde `snake_case` tag used on the wire.
fn event_meta(event: &BuildEvent) -> (&str, &'static str) {
    match event {
        BuildEvent::CellUpdate { session_id, .. } => (session_id, "cell_update"),
        BuildEvent::Question { session_id, .. } => (session_id, "question"),
        BuildEvent::Progress { session_id, .. } => (session_id, "progress"),
        BuildEvent::Error { session_id, .. } => (session_id, "error"),
        BuildEvent::SessionStatus { session_id, .. } => (session_id, "session_status"),
        BuildEvent::BehaviorCoreUpdate { session_id, .. } => (session_id, "behavior_core_update"),
        BuildEvent::CapabilityEnumerationUpdate { session_id, .. } => {
            (session_id, "capability_enumeration_update")
        }
        BuildEvent::CapabilityResolutionUpdate { session_id, .. } => {
            (session_id, "capability_resolution_update")
        }
        BuildEvent::PersonaResolutionUpdate { session_id, .. } => {
            (session_id, "persona_resolution_update")
        }
        BuildEvent::ClarifyingQuestionV3 { session_id, .. } => {
            (session_id, "clarifying_question_v3")
        }
    }
}

/// Emit a SessionStatus event via Channel + Tauri.
pub(super) fn emit_session_status(
    pool: &DbPool,
    channel: &Channel<Value>,
    app: &tauri::AppHandle,
    session_id: &str,
    phase: BuildPhase,
    resolved_count: usize,
    total_count: usize,
) -> bool {
    let event = BuildEvent::SessionStatus {
        session_id: session_id.to_string(),
        phase: phase.as_str().to_string(),
        resolved_count,
        total_count,
    };
    dual_emit(pool, channel, app, &event)
}

/// Emit an Error event via Channel + Tauri.
pub(super) fn emit_error(
    pool: &DbPool,
    channel: &Channel<Value>,
    app: &tauri::AppHandle,
    session_id: &str,
    message: &str,
    retryable: bool,
) -> bool {
    let event = BuildEvent::Error {
        session_id: session_id.to_string(),
        cell_key: None,
        message: message.to_string(),
        retryable,
    };
    dual_emit(pool, channel, app, &event)
}

/// Fire the one-shot terminal notification trio: OS notification (via
/// tauri-plugin-notification), in-app bell entry (via the
/// `build-oneshot-terminal` event listened to by eventBridge), and a
/// `SessionStatus` build event so any open Glyph view also flips state.
///
/// Best-effort: any send error is logged but does not bubble — terminal
/// state is already persisted in the DB by the orchestrator.
pub(super) fn send_terminal_notification(
    app: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    persona_name: Option<String>,
    phase: BuildPhase,
    error_message: Option<String>,
) {
    let success = matches!(phase, BuildPhase::Promoted);

    let title = if success {
        "Build complete".to_string()
    } else {
        "Build failed".to_string()
    };
    let display_name = persona_name
        .clone()
        .unwrap_or_else(|| "Your draft".to_string());
    let body = if success {
        format!("'{display_name}' is ready. Click to review and run it.")
    } else if let Some(ref err) = error_message {
        format!("'{display_name}' didn't land: {err}")
    } else {
        format!("'{display_name}' didn't land. Click to inspect what went wrong.")
    };

    crate::notifications::send(app, &title, &body);

    let payload = BuildOneShotTerminalPayload {
        session_id: session_id.to_string(),
        persona_id: persona_id.to_string(),
        persona_name,
        phase: phase.as_str().to_string(),
        success,
        error_message,
    };
    let _ = app.emit(event_name::BUILD_ONESHOT_TERMINAL, &payload);
}

/// Remove the session handle from the in-memory map and unregister from
/// the process registry.
pub(super) fn cleanup_session(
    sessions_map: &Arc<Mutex<HashMap<String, SessionHandle>>>,
    registry: &ActiveProcessRegistry,
    session_id: &str,
    generation: u64,
) {
    let should_remove = {
        let mut sessions = sessions_map.lock().unwrap_or_else(|e| e.into_inner());
        let should_remove = sessions
            .get(session_id)
            .is_some_and(|handle| handle.generation == generation);
        if should_remove {
            sessions.remove(session_id);
        }
        should_remove
    };
    // Only unregister the process-registry entry when this task actually owns
    // the current generation — otherwise a stale predecessor generation's
    // cleanup could unregister a newer generation's live PID (see finding
    // "cleanup_session unregisters without the generation guard").
    if should_remove {
        registry.unregister_run("build_session", session_id);
    }
}

// =============================================================================
// Tests — pin the ledger booking rules (build-cost-in-the-ledger).
// =============================================================================

#[cfg(test)]
mod spend_tests {
    use super::*;

    /// A realistic stream-json `result` envelope.
    fn result_line(cost: f64, is_error: bool) -> String {
        format!(
            r#"{{"type":"result","subtype":"success","is_error":{is_error},"duration_ms":41234,"num_turns":3,"total_cost_usd":{cost},"model":"claude-sonnet-4-6","usage":{{"input_tokens":1200,"output_tokens":840,"cache_read_input_tokens":9000,"cache_creation_input_tokens":150}}}}"#
        )
    }

    #[test]
    fn resolution_turn_books_once_under_its_own_kind() {
        let entry = build_spend_entry(
            Some("persona-1"),
            SPEND_RESOLUTION,
            None,
            &result_line(0.37, false),
        )
        .expect("a result envelope must book");
        assert_eq!(entry.source, BUILD_SPEND_SOURCE);
        assert_eq!(entry.trigger_kind, SPEND_RESOLUTION);
        assert_eq!(entry.cost_usd, Some(0.37));
        assert_eq!(entry.input_tokens, Some(1200));
        assert_eq!(entry.output_tokens, Some(840));
        assert_eq!(entry.cache_read_tokens, Some(9000));
        assert_eq!(entry.persona_id.as_deref(), Some("persona-1"));
        assert!(!entry.is_error);

        // Every other line of the same turn's stream books nothing, so the
        // turn lands on the dashboard exactly once.
        for other in [
            r#"{"type":"system","subtype":"init","session_id":"s"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta"}}"#,
            "plain verbose text line",
            "",
        ] {
            assert!(
                build_spend_entry(Some("persona-1"), SPEND_RESOLUTION, None, other).is_none(),
                "non-result line booked a spend row: {other}"
            );
        }
    }

    #[test]
    fn each_oneshot_leg_books_under_its_own_kind() {
        for kind in [SPEND_TOOL_TEST, SPEND_TEST_SUMMARY, SPEND_FIX_PASS] {
            let entry = build_spend_entry(Some("persona-1"), kind, None, &result_line(0.11, false))
                .expect("a result envelope must book");
            assert_eq!(entry.trigger_kind, kind);
            assert_eq!(entry.source, BUILD_SPEND_SOURCE);
            assert_ne!(
                entry.trigger_kind, SPEND_RESOLUTION,
                "one-shot legs must be distinguishable from resolution turns"
            );
        }
    }

    #[test]
    fn failed_leg_still_books_its_cost() {
        let entry = build_spend_entry(
            Some("persona-1"),
            SPEND_FIX_PASS,
            None,
            &result_line(0.52, true),
        )
        .expect("an errored turn still cost money and must book");
        assert!(entry.is_error);
        assert_eq!(entry.cost_usd, Some(0.52));
    }

    #[test]
    fn partial_blob_from_a_stalled_leg_does_not_book_as_free() {
        // `read_line_limited` hands back the buffered prefix with a marker
        // suffix when its watchdog fires or the line blows the size cap.
        // Neither is a complete envelope: booking it would post a $0 row and
        // the dashboard would report a stalled leg as free.
        let partial = r#"{"type":"result","subtype":"success","total_cost_usd":0.9"#;
        for suffix in ["...[timeout]", "...[truncated]", ""] {
            let line = format!("{partial}{suffix}");
            assert!(
                build_spend_entry(Some("persona-1"), SPEND_TOOL_TEST, None, &line).is_none(),
                "a partial result blob must not book (suffix {suffix:?})"
            );
        }
    }

    #[test]
    fn envelope_model_wins_over_the_ctx_fallback() {
        let entry = build_spend_entry(
            None,
            SPEND_TEST_SUMMARY,
            Some("claude-haiku-4-5-20251001"),
            &result_line(0.01, false),
        )
        .expect("must book");
        assert_eq!(entry.model.as_deref(), Some("claude-sonnet-4-6"));

        // …and the ctx pin is used when the CLI omitted the model.
        let no_model = r#"{"type":"result","total_cost_usd":0.01,"usage":{"input_tokens":5,"output_tokens":2}}"#;
        let entry = build_spend_entry(
            None,
            SPEND_TEST_SUMMARY,
            Some("claude-haiku-4-5-20251001"),
            no_model,
        )
        .expect("must book");
        assert_eq!(entry.model.as_deref(), Some("claude-haiku-4-5-20251001"));
    }
}
