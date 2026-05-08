//! One-shot build orchestrator: drives a build session from `DraftReady`
//! through `Testing` → `TestComplete` → `Promoted` (or `Failed`) without any
//! user interaction.
//!
//! Triggered by [`super::runner::run_session`] when it reaches `DraftReady`
//! and the session was started with `mode: Some("one_shot")`. The runner
//! returns immediately after spawning this orchestrator so the build CLI
//! subprocess is freed.
//!
//! Lifecycle (V2 — test → fix-pass → retest → promote, with bounded fix
//! passes):
//!
//! ```text
//! DraftReady ──▶ Testing ──▶ TestComplete ──▶ Promoted        (success path)
//!                  │  ▲
//!                  ▼  │  fix_pass updates agent_ir
//!               Resolving (LLM correction)
//!                  │
//!                  └──▶ Failed                                 (after MAX_TEST_RETRIES)
//! ```
//!
//! On each test pass:
//!   1. `run_test_pass` runs the real tool tests and returns the report.
//!   2. If `tools_failed > 0` (or the test itself errored), we capture a
//!      failure summary, kick the phase back to `Resolving`, and call
//!      [`super::fix_pass::run_fix_pass`] to ask the LLM for a corrected
//!      `agent_ir`. The fix is persisted to the session row.
//!   3. We then loop back to step 1. After [`MAX_TEST_RETRIES`] attempts
//!      without a clean pass, the session flips to `Failed` and the
//!      terminal notification fires.
//!
//! Both terminal transitions (`Promoted`, `Failed`) emit:
//!   - A `tauri-plugin-notification` OS notification (header + body).
//!   - A `BuildEvent::SessionStatus` so any open Glyph view updates.
//!   - The notifications-store `titlebar-notification` event with a
//!     persona deep-link so the in-app bell badge updates.

use std::sync::Arc;

use tauri::Manager;

use crate::db::models::{BuildPhase, UpdateBuildSession};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::error::AppError;
use crate::AppState;

/// Maximum LLM-driven fix passes to attempt on test failure. After this,
/// the session is marked `Failed` and the user is notified.
///
/// Why 3 (not awareness-aware): per the V2 spec the user wants a fixed
/// budget — a chattier intent does not earn extra retries. If a build
/// can't survive three correction passes, the failure is structural
/// (missing credential, intent semantically impossible) and another
/// retry is unlikely to help.
const MAX_TEST_RETRIES: u32 = 3;

/// Drive a one-shot session from `DraftReady` to a terminal phase.
///
/// Spawned as a tokio task by the runner; takes ownership of the
/// `AppHandle` and looks up `AppState` itself. Does not return until the
/// session reaches `Promoted` or `Failed`.
pub(super) async fn run_post_draft(
    app_handle: tauri::AppHandle,
    session_id: String,
    persona_id: String,
) {
    // `state::<T>()` returns the registered State guard. AppState is set
    // up at app boot (lib.rs `manage(...)`), so by the time a build
    // reaches DraftReady the state is always present.
    let state: Arc<AppState> = app_handle.state::<Arc<AppState>>().inner().clone();

    tracing::info!(
        session_id = %session_id,
        persona_id = %persona_id,
        "OneShot: starting post-draft orchestrator (test → promote)"
    );

    // Phase: Testing
    if let Err(e) = update_phase(&state, &session_id, BuildPhase::Testing).await {
        tracing::warn!(
            session_id = %session_id,
            error = %e,
            "OneShot: failed to mark Testing — continuing anyway"
        );
    }

    let mut last_error: Option<String> = None;
    let mut attempts: u32 = 0;

    loop {
        attempts += 1;

        match run_test_pass(&state, &app_handle, &session_id, &persona_id).await {
            Ok(TestPassOutcome::Passed) => {
                tracing::info!(
                    session_id = %session_id,
                    attempts,
                    "OneShot: test pass succeeded — promoting"
                );
                break;
            }
            Ok(TestPassOutcome::Failed { summary }) => {
                tracing::warn!(
                    session_id = %session_id,
                    attempts,
                    summary_bytes = summary.len(),
                    "OneShot: test pass failed (tool tests reported failures)"
                );
                last_error = Some(short_failure_label(&summary));

                if attempts >= MAX_TEST_RETRIES {
                    tracing::warn!(
                        session_id = %session_id,
                        attempts,
                        "OneShot: exhausted MAX_TEST_RETRIES — finalizing as Failed"
                    );
                    finalize_failed(&state, &app_handle, &session_id, &persona_id, last_error)
                        .await;
                    return;
                }

                // Fix-pass: ask the LLM to correct the agent_ir given the
                // failure context. Phase flips to Resolving so the read-only
                // Glyph view shows progress instead of looking frozen on
                // Testing → DraftReady alternations.
                let _ = update_phase(&state, &session_id, BuildPhase::Resolving).await;
                emit_progress(
                    &app_handle,
                    &session_id,
                    "Correcting build…",
                    Some(format!(
                        "Test pass {attempts} failed — asking the model to fix it (attempt {} of {MAX_TEST_RETRIES}).",
                        attempts + 1
                    )),
                );

                match super::fix_pass::run_fix_pass(&state, &session_id, &summary, attempts).await {
                    Ok(_) => {
                        // Push phase back to Testing for the next loop
                        // iteration so the UI's read-only progress reflects
                        // what's actually happening.
                        let _ = update_phase(&state, &session_id, BuildPhase::Testing).await;
                    }
                    Err(fix_err) => {
                        tracing::error!(
                            session_id = %session_id,
                            attempts,
                            error = %fix_err,
                            "OneShot: fix-pass failed — bailing out"
                        );
                        // The fix pass itself failed (CLI error, parse fail,
                        // or LLM declined to emit IR). Treat as terminal —
                        // burning retries on a fix pass that can't even
                        // produce a candidate is wasteful.
                        last_error = Some(format!(
                            "Test failures couldn't be auto-corrected: {fix_err}"
                        ));
                        finalize_failed(&state, &app_handle, &session_id, &persona_id, last_error)
                            .await;
                        return;
                    }
                }
            }
            Err(e) => {
                // Catastrophic test failure (DB error, missing agent_ir,
                // adoption-answers parse error, etc.). Not something a fix
                // pass can address — surface to the user immediately.
                tracing::error!(
                    session_id = %session_id,
                    attempts,
                    error = %e,
                    "OneShot: catastrophic test_pass error — finalizing as Failed"
                );
                finalize_failed(
                    &state,
                    &app_handle,
                    &session_id,
                    &persona_id,
                    Some(e.to_string()),
                )
                .await;
                return;
            }
        }
    }

    // Test complete → promote
    if let Err(e) = update_phase(&state, &session_id, BuildPhase::TestComplete).await {
        tracing::warn!(
            session_id = %session_id,
            error = %e,
            "OneShot: failed to mark TestComplete — continuing to promote anyway"
        );
    }

    match crate::commands::design::build_sessions::promote_build_draft_inner(
        &state,
        session_id.clone(),
        persona_id.clone(),
        Vec::new(),
    )
    .await
    {
        Ok(_) => {
            tracing::info!(
                session_id = %session_id,
                persona_id = %persona_id,
                "OneShot: promoted successfully"
            );
            finalize_promoted(&state, &app_handle, &session_id, &persona_id).await;
        }
        Err(e) => {
            tracing::error!(
                session_id = %session_id,
                error = %e,
                "OneShot: promote failed"
            );
            finalize_failed(
                &state,
                &app_handle,
                &session_id,
                &persona_id,
                Some(e.to_string()),
            )
            .await;
        }
    }
}

/// Result of a single tool-test run inside the autonomous loop.
///
/// `Passed` covers both the "all green" case AND the "no tools to test"
/// edge (a behavior-only persona with zero tool definitions). `Failed`
/// carries a model-friendly summary of what broke so the fix pass can
/// pinpoint the issue.
enum TestPassOutcome {
    Passed,
    Failed { summary: String },
}

async fn run_test_pass(
    state: &Arc<AppState>,
    app_handle: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
) -> Result<TestPassOutcome, AppError> {
    // Re-load the session so we get the latest agent_ir (the fix pass
    // may have just written a corrected one).
    let session = build_session_repo::get_by_id(&state.db, session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    let agent_ir_str = session.agent_ir.clone().ok_or_else(|| {
        AppError::Validation(
            "OneShot: build session reached DraftReady without agent_ir — cannot test".to_string(),
        )
    })?;

    let mut agent_ir: crate::db::models::AgentIr = serde_json::from_str(&agent_ir_str)
        .map_err(|e| AppError::Validation(format!("OneShot agent_ir parse error: {e}")))?;

    // Apply adoption questionnaire answers if present (mirrors test_build_draft).
    // Fail loudly on parse error rather than silently testing against raw template placeholders —
    // see test_build_draft for the full rationale.
    if let Some(ref raw_answers) = session.adoption_answers {
        match serde_json::from_str::<crate::engine::adoption_answers::AdoptionAnswers>(raw_answers)
        {
            Ok(answers) => {
                crate::engine::adoption_answers::substitute_variables(&mut agent_ir, &answers);
                crate::engine::adoption_answers::inject_configuration_section(
                    &mut agent_ir,
                    &answers,
                );
                crate::engine::adoption_answers::apply_credential_bindings_to_connectors(
                    &mut agent_ir,
                    &answers,
                );
            }
            Err(e) => {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "OneShot: failed to parse build_sessions.adoption_answers — refusing to run test against template placeholders"
                );
                return Err(AppError::Validation(format!(
                    "OneShot: build_sessions.adoption_answers is corrupt and could not be parsed ({e}). \
                     Re-run the adoption questionnaire to regenerate the answers, or clear the \
                     field if you intend to test without user values."
                )));
            }
        }
    }

    let report =
        super::run_tool_tests(&state.db, app_handle, session_id, persona_id, &agent_ir).await?;

    // Persist last_test_report so the post-promote modal can render it,
    // even if this attempt later fails (every report up to the final one
    // is overwritten — by design, the modal only ever shows the latest).
    if let Ok(report_json) = serde_json::to_string(&report) {
        let _ = persona_repo::update(
            &state.db,
            persona_id,
            crate::db::models::UpdatePersonaInput {
                last_test_report: Some(Some(report_json)),
                ..Default::default()
            },
        );
    }

    let tools_failed = report
        .get("tools_failed")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if tools_failed == 0 {
        Ok(TestPassOutcome::Passed)
    } else {
        Ok(TestPassOutcome::Failed {
            summary: build_failure_summary(&report),
        })
    }
}

/// Render the test-report into a model-readable failure breakdown.
/// Includes per-tool name, status, HTTP code, and error string so the
/// fix-pass LLM has enough to make a targeted correction. Truncates
/// individual error strings to keep the prompt under control on
/// runaway-error days.
fn build_failure_summary(report: &serde_json::Value) -> String {
    let mut out = String::new();
    let tools_passed = report
        .get("tools_passed")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let tools_failed = report
        .get("tools_failed")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let tools_skipped = report
        .get("tools_skipped")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    out.push_str(&format!(
        "Tool test results: {tools_passed} passed, {tools_failed} failed, {tools_skipped} skipped.\n\n"
    ));

    if let Some(results) = report.get("results").and_then(|v| v.as_array()) {
        out.push_str("### Per-tool detail\n\n");
        for result in results {
            let status = result.get("status").and_then(|v| v.as_str()).unwrap_or("?");
            if status == "passed" {
                continue;
            }
            let name = result
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let connector = result
                .get("connector")
                .and_then(|v| v.as_str())
                .unwrap_or("(no connector)");
            let http_status = result
                .get("http_status")
                .and_then(|v| v.as_u64())
                .map(|s| format!(" HTTP {s}"))
                .unwrap_or_default();
            let raw_error = result
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("(no error message)");
            let trimmed = raw_error.chars().take(400).collect::<String>();
            out.push_str(&format!(
                "- **{name}** [{connector}]{http_status} → {status}: {trimmed}\n",
            ));
        }
        out.push('\n');
    }

    if let Some(creds) = report
        .get("credential_issues")
        .and_then(|v| v.as_array())
        .filter(|arr| !arr.is_empty())
    {
        out.push_str("### Credential issues\n\n");
        for issue in creds {
            if let Some(s) = issue.as_str() {
                out.push_str(&format!("- {s}\n"));
            } else if let Some(obj) = issue.as_object() {
                out.push_str(&format!(
                    "- {}\n",
                    serde_json::to_string(obj).unwrap_or_default()
                ));
            }
        }
        out.push('\n');
    }

    if let Some(summary) = report.get("summary").and_then(|v| v.as_str()) {
        out.push_str("### LLM-summarized verdict\n\n");
        out.push_str(summary);
        out.push('\n');
    }

    out
}

/// Shorten the failure summary into a single-line label suitable for
/// `error_message` and the user-facing notification body. The full
/// summary stays in the persona's `last_test_report` for inspection.
fn short_failure_label(summary: &str) -> String {
    summary
        .lines()
        .next()
        .unwrap_or("Test pass failed")
        .chars()
        .take(280)
        .collect()
}

/// Emit a `BuildEvent::Progress` so the read-only Glyph view in OneShot
/// mode reflects what the orchestrator is doing between test passes.
fn emit_progress(
    app_handle: &tauri::AppHandle,
    session_id: &str,
    message: &str,
    activity: Option<String>,
) {
    use tauri::Emitter;
    let event = crate::db::models::BuildEvent::Progress {
        session_id: session_id.to_string(),
        dimension: None,
        message: message.to_string(),
        percent: None,
        activity,
    };
    let _ = app_handle.emit(
        crate::engine::event_registry::event_name::BUILD_SESSION_EVENT,
        &event,
    );
}

async fn update_phase(
    state: &Arc<AppState>,
    session_id: &str,
    phase: BuildPhase,
) -> Result<(), AppError> {
    build_session_repo::update(
        &state.db,
        session_id,
        &UpdateBuildSession {
            phase: Some(phase.as_str().to_string()),
            ..Default::default()
        },
    )
}

async fn finalize_promoted(
    state: &Arc<AppState>,
    app_handle: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
) {
    let persona_name = resolve_persona_name(state, persona_id);
    super::events::send_terminal_notification(
        app_handle,
        session_id,
        persona_id,
        persona_name.clone(),
        BuildPhase::Promoted,
        None,
    );
    post_companion_episode(state, session_id, persona_name, true, None);
}

async fn finalize_failed(
    state: &Arc<AppState>,
    app_handle: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    error: Option<String>,
) {
    // Mark phase=Failed *before* notifying. If this DB write fails the
    // session row stays in Testing/Resolving — and a "Build failed" OS
    // notification + companion episode would lie to the user about
    // terminal state. On next launch BuildWatcher would see a non-terminal
    // session and try to resume an already-finalized run.
    //
    // Retry once to absorb transient SQLite lock contention, then bail
    // loudly without firing any user-visible notification if it still
    // fails. The orphaned non-terminal row is recoverable on next launch;
    // a contradictory notification is not.
    let update = || {
        build_session_repo::update(
            &state.db,
            session_id,
            &UpdateBuildSession {
                phase: Some(BuildPhase::Failed.as_str().to_string()),
                error_message: Some(error.clone()),
                ..Default::default()
            },
        )
    };

    if let Err(first_err) = update() {
        tracing::warn!(
            session_id = %session_id,
            error = %first_err,
            "OneShot finalize_failed: DB update failed — retrying once before claiming terminal state"
        );
        if let Err(retry_err) = update() {
            tracing::error!(
                session_id = %session_id,
                persona_id = %persona_id,
                first_error = %first_err,
                retry_error = %retry_err,
                "OneShot finalize_failed: DB update failed twice — refusing to emit terminal notification while session row is non-terminal. BuildWatcher will recover on next launch."
            );
            return;
        }
    }

    let persona_name = resolve_persona_name(state, persona_id);
    super::events::send_terminal_notification(
        app_handle,
        session_id,
        persona_id,
        persona_name.clone(),
        BuildPhase::Failed,
        error.clone(),
    );
    post_companion_episode(state, session_id, persona_name, false, error);
}

fn resolve_persona_name(state: &Arc<AppState>, persona_id: &str) -> Option<String> {
    persona_repo::get_by_id(&state.db, persona_id)
        .ok()
        .map(|p| p.name)
}

/// When the OneShot session was started from a Companion chat (the
/// session row carries `companion_session_id`), post a system episode
/// into that chat's log so the user sees the result the next time they
/// glance at the chat — independent of whether they were watching the
/// Glyph progress view.
///
/// Best-effort: a failure here is logged but never bubbled. The user
/// already got the OS notification + bell entry from
/// `send_terminal_notification`.
fn post_companion_episode(
    state: &Arc<AppState>,
    session_id: &str,
    persona_name: Option<String>,
    success: bool,
    error: Option<String>,
) {
    let session = match build_session_repo::get_by_id(&state.db, session_id) {
        Ok(Some(s)) => s,
        _ => return,
    };
    let chat_session = match session.companion_session_id {
        Some(s) => s,
        None => return,
    };

    let persona_name = persona_name.unwrap_or_else(|| "the draft".to_string());

    let body = if success {
        format!(
            "✅ One-shot build for **{persona_name}** landed. The persona is promoted and ready to run."
        )
    } else if let Some(err) = error {
        format!(
            "⚠️ One-shot build for **{persona_name}** didn't land: {err}\n\nThe draft is saved — you can open it from the personas page to see what was assumed and adjust.",
        )
    } else {
        format!(
            "⚠️ One-shot build for **{persona_name}** didn't land. The draft is saved — open it from the personas page to inspect."
        )
    };

    if let Err(e) = crate::companion::brain::episodic::append_episode(
        &state.user_db,
        &chat_session,
        crate::companion::brain::episodic::EpisodeRole::System,
        &body,
    ) {
        tracing::warn!(
            session_id = %session_id,
            chat_session = %chat_session,
            error = %e,
            "OneShot: failed to post terminal episode to companion chat (notification still fired)"
        );
    }
}
