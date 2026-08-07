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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::Manager;

use crate::db::models::{BuildPhase, UpdateBuildSession};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::error::AppError;
use crate::{ActiveProcessRegistry, AppState};

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
    cancel_flag: Arc<AtomicBool>,
    registry: Arc<ActiveProcessRegistry>,
) {
    // NOTE (2026-07-28 audit): this is keyed by `session_id` rather than a
    // per-attempt id, which is the same shape as the setup.rs bug (a second
    // concurrent call for the same key would steal the first's cancellation
    // flag via `RunGuard::drop`'s `unregister_run`). Left as-is deliberately:
    // `build_session::mod.rs::cancel_session` cancels this run by calling
    // `registry.cancel_run("build_session_oneshot", session_id)` — cancel-by-
    // session-id is load-bearing for the one confirmed caller. Only one call
    // path invokes `run_post_draft` today (the runner, once per session
    // reaching `DraftReady`), so there is no confirmed double-invocation
    // exploiting this. If a future resume/retry path re-enters
    // `run_post_draft` for the SAME session before the prior `RunGuard`
    // drops, it would silently share this slot exactly like the setup.rs
    // bug — keying by a per-attempt id here would require `cancel_session`
    // to look up "the current attempt id for this session" first (e.g. via
    // `registry.get_id`/a small session→attempt map), which is a real design
    // change, not a one-line key swap. Do that work if/when such a path is
    // added; don't force it speculatively.
    let (oneshot_cancel_flag, _oneshot_guard) =
        registry.register_run_guarded("build_session_oneshot", &session_id);

    // `state::<T>()` returns the registered State guard. AppState is set
    // up at app boot (lib.rs `manage(...)`), so by the time a build
    // reaches DraftReady the state is always present.
    let state: Arc<AppState> = app_handle.state::<Arc<AppState>>().inner().clone();

    tracing::info!(
        session_id = %session_id,
        persona_id = %persona_id,
        "OneShot: starting post-draft orchestrator (test → promote)"
    );

    if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
        return;
    }

    // Phase: Testing
    if let Err(e) = update_phase(&state, &session_id, BuildPhase::Testing).await {
        tracing::warn!(
            session_id = %session_id,
            error = %e,
            "OneShot: failed to mark Testing — continuing anyway"
        );
    }

    let mut attempts: u32 = 0;
    let mut next_agent_ir: Option<crate::db::models::AgentIr> = None;

    loop {
        if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
            return;
        }

        attempts += 1;

        match run_test_pass(
            &state,
            &app_handle,
            &session_id,
            &persona_id,
            next_agent_ir.take(),
        )
        .await
        {
            Ok(TestPassOutcome::Passed) => {
                if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                    return;
                }
                tracing::info!(
                    session_id = %session_id,
                    attempts,
                    "OneShot: test pass succeeded — promoting"
                );
                break;
            }
            Ok(TestPassOutcome::Held { reason }) => {
                if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                    return;
                }
                // A hold is not a failure the fix pass can chase. Either the
                // report was unreadable, or tools were counted without ever
                // being called — neither is corrected by rewriting the
                // agent_ir, and the fix-pass LLM would burn the full retry
                // budget arriving back here. Terminate loudly on the first
                // hold, with the reason on the phase row, the OS
                // notification and the companion episode.
                tracing::warn!(
                    session_id = %session_id,
                    attempts,
                    reason = %reason,
                    "OneShot: promotion HELD — refusing to promote an unverified build"
                );
                emit_progress(&app_handle, &session_id, "Promotion held", Some(reason.clone()));
                finalize_failed(
                    &state,
                    &app_handle,
                    &session_id,
                    &persona_id,
                    Some(reason),
                )
                .await;
                return;
            }
            Ok(TestPassOutcome::Failed { summary }) => {
                if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                    return;
                }
                tracing::warn!(
                    session_id = %session_id,
                    attempts,
                    summary_bytes = summary.len(),
                    "OneShot: test pass failed (tool tests reported failures)"
                );
                let failure_label = short_failure_label(&summary);

                if attempts >= MAX_TEST_RETRIES {
                    tracing::warn!(
                        session_id = %session_id,
                        attempts,
                        "OneShot: exhausted MAX_TEST_RETRIES — finalizing as Failed"
                    );
                    finalize_failed(
                        &state,
                        &app_handle,
                        &session_id,
                        &persona_id,
                        Some(failure_label),
                    )
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
                    Ok(corrected_ir) => {
                        if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                            return;
                        }
                        next_agent_ir = Some(corrected_ir);
                        // Push phase back to Testing for the next loop
                        // iteration so the UI's read-only progress reflects
                        // what's actually happening. The corrected IR is fed
                        // directly into the next test pass while the persisted
                        // session row remains the recovery source of truth.
                        let _ = update_phase(&state, &session_id, BuildPhase::Testing).await;
                    }
                    Err(fix_err) => {
                        if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                            return;
                        }
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
                        finalize_failed(
                            &state,
                            &app_handle,
                            &session_id,
                            &persona_id,
                            Some(format!(
                                "Test failures couldn't be auto-corrected: {fix_err}"
                            )),
                        )
                        .await;
                        return;
                    }
                }
            }
            Err(e) => {
                if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                    return;
                }
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
    if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
        return;
    }
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
            if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                return;
            }
            tracing::info!(
                session_id = %session_id,
                persona_id = %persona_id,
                "OneShot: promoted successfully"
            );
            finalize_promoted(&state, &app_handle, &session_id, &persona_id).await;
        }
        Err(e) => {
            if is_cancelled(&cancel_flag, &oneshot_cancel_flag, &session_id) {
                return;
            }
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

fn is_cancelled(
    session_cancel_flag: &AtomicBool,
    oneshot_cancel_flag: &AtomicBool,
    session_id: &str,
) -> bool {
    let cancelled =
        session_cancel_flag.load(Ordering::Acquire) || oneshot_cancel_flag.load(Ordering::Acquire);
    if cancelled {
        tracing::info!(
            session_id = %session_id,
            "OneShot: cancellation requested — stopping post-draft orchestrator"
        );
    }
    cancelled
}

/// Result of a single tool-test run inside the autonomous loop.
///
/// `Passed` covers both the "all green" case AND the "no tools to test"
/// edge (a behavior-only persona with zero tool definitions). `Failed`
/// carries a model-friendly summary of what broke so the fix pass can
/// pinpoint the issue. `Held` is neither: nothing failed, but nothing was
/// proven either — see [`evaluate_promote_gate`].
enum TestPassOutcome {
    Passed,
    Failed {
        summary: String,
    },
    /// Promotion is refused and the fix-pass loop is skipped. `reason` is a
    /// single user-facing line (it becomes `error_message`, the OS
    /// notification body and the companion-chat episode); the full detail
    /// stays in the persona's `last_test_report`.
    Held {
        reason: String,
    },
}

/// The promote gate's verdict on a tool-test report.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PromoteGate {
    /// Everything that could be exercised was, and nothing failed.
    Pass,
    /// Real tool failures — a fix pass may be able to correct the agent_ir.
    Failed,
    /// Refuse to promote, and don't spend fix passes on it.
    Held { reason: String },
}

/// Decide whether a tool-test report may promote a build.
///
/// This is the single predicate that arms a persona: promotion sets it
/// `active`, computes `next_trigger_at`, arms the scheduler, and auto-creates
/// webhook ingress + secrets, all against the user's real credentials. It used
/// to be one line —
///
/// ```ignore
/// report.get("tools_failed").and_then(|v| v.as_u64()).unwrap_or(0) == 0
/// ```
///
/// — which failed OPEN on every malformed shape: a missing key, `null`, the
/// string `"2"`, a float, or a report that was not an object at all all
/// collapsed to `0` and promoted. This version fails CLOSED. A report that
/// cannot be read as a verdict is not a passing verdict.
///
/// Three rules, in order:
///
/// 1. **Shape.** `tools_failed` and `tools_unverified` must both be present
///    and whole non-negative numbers; `results` if present must be an array of
///    objects with string `status`es. Anything else holds.
/// 2. **Integrity.** The declared counts must not undercount what `results`
///    actually contains. A report claiming `tools_failed: 0` while carrying a
///    failed entry is lying about itself and holds.
/// 3. **Verdict.** Failures fail; unverified entries — counted, never called —
///    hold. Only a report with neither passes.
fn evaluate_promote_gate(report: &serde_json::Value) -> PromoteGate {
    const MALFORMED_PREFIX: &str =
        "Promotion held: the tool-test report could not be read as a verdict";

    let Some(obj) = report.as_object() else {
        return PromoteGate::Held {
            reason: format!("{MALFORMED_PREFIX} (it is not a JSON object). Nothing was confirmed to have run, so the build was not promoted."),
        };
    };

    // ---- 1. Shape -------------------------------------------------------
    let read_count = |field: &str| -> Result<u64, String> {
        match obj.get(field) {
            None => Err(format!("`{field}` is missing")),
            Some(v) => v
                .as_u64()
                .ok_or_else(|| format!("`{field}` is not a whole number (got `{v}`)")),
        }
    };

    let tools_failed = match read_count("tools_failed") {
        Ok(n) => n,
        Err(why) => {
            return PromoteGate::Held {
                reason: format!("{MALFORMED_PREFIX}: {why}. Nothing was confirmed to have run, so the build was not promoted."),
            }
        }
    };
    let tools_unverified = match read_count("tools_unverified") {
        Ok(n) => n,
        Err(why) => {
            return PromoteGate::Held {
                reason: format!("{MALFORMED_PREFIX}: {why}. Nothing was confirmed to have run, so the build was not promoted."),
            }
        }
    };

    let statuses: Vec<&str> = match obj.get("results") {
        None => Vec::new(),
        Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::Array(items)) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                match item.get("status").and_then(|s| s.as_str()) {
                    Some(s) => out.push(s),
                    None => {
                        return PromoteGate::Held {
                            reason: format!("{MALFORMED_PREFIX}: a tool result carries no readable `status`. Nothing was confirmed to have run, so the build was not promoted."),
                        }
                    }
                }
            }
            out
        }
        Some(_) => {
            return PromoteGate::Held {
                reason: format!("{MALFORMED_PREFIX}: `results` is not a list. Nothing was confirmed to have run, so the build was not promoted."),
            }
        }
    };

    // ---- 2. Integrity ---------------------------------------------------
    // Anything that is not an explicit pass, skip or unverified is a failure,
    // matching how `run_tool_tests` counts an executed curl.
    let observed_failed = statuses
        .iter()
        .filter(|s| {
            !matches!(
                **s,
                "passed" | "skipped" | super::tool_tests::STATUS_UNVERIFIED
            )
        })
        .count() as u64;
    let observed_unverified = statuses
        .iter()
        .filter(|s| **s == super::tool_tests::STATUS_UNVERIFIED)
        .count() as u64;

    if tools_failed < observed_failed || tools_unverified < observed_unverified {
        return PromoteGate::Held {
            reason: format!(
                "Promotion held: the tool-test report contradicts itself — it reports {tools_failed} failed and {tools_unverified} unverified, but lists {observed_failed} failed and {observed_unverified} unverified tools. A report that miscounts itself cannot clear a build for promotion."
            ),
        };
    }

    // ---- 3. Verdict -----------------------------------------------------
    if tools_failed > 0 {
        return PromoteGate::Failed;
    }

    if tools_unverified > 0 {
        let named = unverified_subjects(report);
        let detail = if named.is_empty() {
            String::new()
        } else {
            format!(" ({named})")
        };
        return PromoteGate::Held {
            reason: format!(
                "Promotion held: {tools_unverified} tool(s) were reported as available but never actually called{detail}. Nothing was executed against them, so this build was not verified and was not promoted automatically."
            ),
        };
    }

    PromoteGate::Pass
}

/// Name the tools a hold is about, so the notification body is actionable
/// rather than a bare count. Bounded — a runaway report must not produce a
/// notification the OS truncates into meaninglessness.
fn unverified_subjects(report: &serde_json::Value) -> String {
    const MAX_NAMED: usize = 4;
    let mut names: Vec<String> = Vec::new();

    if let Some(reasons) = report.get("unverified_reasons").and_then(|v| v.as_array()) {
        for r in reasons {
            if let Some(n) = r
                .get("connector")
                .and_then(|v| v.as_str())
                .or_else(|| r.get("tool_name").and_then(|v| v.as_str()))
            {
                if !n.is_empty() && !names.iter().any(|e| e == n) {
                    names.push(n.to_string());
                }
            }
        }
    }

    if names.is_empty() {
        if let Some(results) = report.get("results").and_then(|v| v.as_array()) {
            for r in results {
                if r.get("status").and_then(|v| v.as_str())
                    != Some(super::tool_tests::STATUS_UNVERIFIED)
                {
                    continue;
                }
                if let Some(n) = r.get("tool_name").and_then(|v| v.as_str()) {
                    if !n.is_empty() && !names.iter().any(|e| e == n) {
                        names.push(n.to_string());
                    }
                }
            }
        }
    }

    if names.is_empty() {
        return String::new();
    }
    let extra = names.len().saturating_sub(MAX_NAMED);
    names.truncate(MAX_NAMED);
    if extra > 0 {
        format!("{} and {extra} more", names.join(", "))
    } else {
        names.join(", ")
    }
}

async fn run_test_pass(
    state: &Arc<AppState>,
    app_handle: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    agent_ir_override: Option<crate::db::models::AgentIr>,
) -> Result<TestPassOutcome, AppError> {
    // Re-load the session for adoption answers and as the recovery source
    // when the caller does not have an in-memory corrected IR from a fix pass.
    let session = build_session_repo::get_by_id(&state.db, session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    let mut agent_ir = match agent_ir_override {
        Some(ir) => ir,
        None => {
            let agent_ir_str = session.agent_ir.clone().ok_or_else(|| {
                AppError::Validation(
                    "OneShot: build session reached DraftReady without agent_ir — cannot test"
                        .to_string(),
                )
            })?;

            serde_json::from_str::<crate::db::models::AgentIr>(&agent_ir_str)
                .map_err(|e| AppError::Validation(format!("OneShot agent_ir parse error: {e}")))?
        }
    };

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

    match evaluate_promote_gate(&report) {
        PromoteGate::Pass => Ok(TestPassOutcome::Passed),
        PromoteGate::Failed => Ok(TestPassOutcome::Failed {
            summary: build_failure_summary(&report),
        }),
        PromoteGate::Held { reason } => Ok(TestPassOutcome::Held { reason }),
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
    let res = build_session_repo::update(
        &state.db,
        session_id,
        &UpdateBuildSession {
            phase: Some(phase.as_str().to_string()),
            ..Default::default()
        },
    );
    // Telemetry (build-orchestration Phase 0): per-phase timestamp, best-effort.
    let _ = build_session_repo::append_phase_timing(
        &state.db,
        session_id,
        phase.as_str(),
        &chrono::Utc::now().to_rfc3339(),
    );
    res
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

// =============================================================================
// Tests — the promote path had none. These are the ones that decide promotion.
// =============================================================================
//
// `run_post_draft` itself needs an `AppHandle`, a DbPool and a live CLI, so it
// is not unit-testable. Everything it uses to DECIDE is, and that is what is
// covered here: the four rows of the decision table (direction
// `a-checkmark-that-means-something`), driven from the real producers in
// `tool_tests` through `evaluate_promote_gate` — the single predicate that
// arms a persona — plus the fail-open shapes that used to slip past it.
//
// Run with: node scripts/build/run-rust-tests.mjs -- build_session
// (`cargo test -p personas-desktop` dies at load on Windows; see the script.)

#[cfg(test)]
mod tests {
    use super::super::tool_tests::{build_no_plan_fallback, empty_tool_report, ToolTestTally};
    use super::*;
    use serde_json::json;

    fn held_reason(gate: &PromoteGate) -> &str {
        match gate {
            PromoteGate::Held { reason } => reason,
            other => panic!("expected the gate to HOLD, got {other:?}"),
        }
    }

    // ── The decision table — one test per row ────────────────────────────
    //
    //   | plan entry                          | verdict    |
    //   |-------------------------------------|------------|
    //   | persona has zero tools              | promotes   |
    //   | empty `curl`, no `cli_native` claim | promotes   |
    //   | `cli_native: true`                  | HOLDS      |
    //   | no parseable plan → cred substring  | HOLDS      |

    /// Row 1 — INTENTIONAL PASS. A persona with no tools has nothing to
    /// exercise. This is the one "nothing ran" case that is genuinely
    /// defensible, and it is a carve-out, not an accident: if this test ever
    /// fails, someone tightened the gate past what was agreed.
    #[test]
    fn zero_tool_persona_still_promotes() {
        let report = empty_tool_report();
        assert_eq!(report["tools_failed"], json!(0));
        assert_eq!(report["tools_unverified"], json!(0));
        assert_eq!(
            evaluate_promote_gate(&report),
            PromoteGate::Pass,
            "a behaviour-only persona with zero tools must still promote"
        );
    }

    /// Row 2 — INTENTIONAL PASS. The test prompt explicitly invites these
    /// ("Non-testable (write-only or no endpoint) — emit an entry with empty
    /// curl"), so an empty-curl entry with no `cli_native` claim stays
    /// `skipped` and non-blocking. Also a carve-out, not an accident.
    #[test]
    fn empty_curl_entry_is_skipped_and_still_promotes() {
        let mut tally = ToolTestTally::default();
        let result = tally
            .record_planned_entry(&json!({
                "tool_name": "crm_create_lead",
                "connector": "salesforce",
                "curl": "",
                "description": "Write-only endpoint — nothing safe to read back",
            }))
            .expect("an empty-curl entry is decided without a call");

        assert_eq!(result.status, "skipped");
        assert_eq!(tally.skipped, 1);
        assert_eq!(tally.unverified, 0, "a skip is not an unverified claim");

        tally.results.push(json!({ "status": "skipped" }));
        let report = tally.into_report();
        assert_eq!(report["tools_skipped"], json!(1));
        assert_eq!(
            evaluate_promote_gate(&report),
            PromoteGate::Pass,
            "skipped entries must not block promotion"
        );
    }

    /// Row 3 — NOW HOLDS. `cli_native` is a boolean the build model writes
    /// about its own work; nothing is called. It used to count toward
    /// `tools_passed`, so a persona whose every tool was `cli_native` promoted
    /// to `active` — scheduler armed, webhook live — with zero calls made.
    #[test]
    fn cli_native_claim_holds_promotion() {
        let mut tally = ToolTestTally::default();
        let result = tally
            .record_planned_entry(&json!({
                "tool_name": "web_search",
                "connector": null,
                "curl": "",
                "cli_native": true,
                "description": "Uses Claude CLI built-in web search — auto-verified",
            }))
            .expect("a cli_native entry is decided without a call");

        assert_eq!(result.status, "unverified");
        assert_eq!(tally.passed, 0, "an uncalled tool is not a pass");
        assert_eq!(tally.skipped, 0, "and it must not hide in the skip bucket");
        assert_eq!(tally.unverified, 1);

        tally.results.push(json!({ "status": "unverified" }));
        let report = tally.into_report();
        assert_eq!(report["tools_failed"], json!(0));
        assert_eq!(report["tools_unverified"], json!(1));

        let gate = evaluate_promote_gate(&report);
        let reason = held_reason(&gate);
        assert!(
            reason.contains("never actually called"),
            "the hold must say what is wrong, got: {reason}"
        );
        assert!(
            reason.contains("web_search"),
            "the hold must name the tool so the user can act on it, got: {reason}"
        );
    }

    /// Row 4 — NOW HOLDS. When the build model returns no parseable plan, the
    /// fallback used to fuzzy-substring-match connector names against vault
    /// service types and stamp the winners "Credential available — connector
    /// verified". A vault row sharing a substring with a connector name is not
    /// a test, and the word "verified" has no business being there.
    #[test]
    fn no_plan_credential_substring_holds_promotion() {
        let report = build_no_plan_fallback(
            &["http_request".to_string()],
            &[("alpha_vantage".to_string(), true)],
        );

        assert_eq!(report["tools_unverified"], json!(1));
        assert_eq!(report["tools_failed"], json!(0));
        assert_eq!(
            report["test_plan_parsed"],
            json!(false),
            "the degraded path must say it is degraded"
        );

        let serialised = serde_json::to_string(&report).unwrap();
        assert!(
            !serialised.contains("connector verified"),
            "nothing ran, so nothing may be called verified: {serialised}"
        );

        let gate = evaluate_promote_gate(&report);
        let reason = held_reason(&gate);
        assert!(
            reason.contains("alpha_vantage"),
            "the hold must name the connector, got: {reason}"
        );
    }

    // ── The fail-open shapes ─────────────────────────────────────────────
    //
    // `report.get("tools_failed").and_then(as_u64).unwrap_or(0)` turned every
    // one of these into `0` — i.e. into a promote.

    #[test]
    fn missing_tools_failed_holds_instead_of_promoting() {
        let gate = evaluate_promote_gate(&json!({ "results": [], "tools_unverified": 0 }));
        assert!(held_reason(&gate).contains("`tools_failed` is missing"));
    }

    #[test]
    fn null_tools_failed_holds_instead_of_promoting() {
        let gate = evaluate_promote_gate(&json!({ "tools_failed": null, "tools_unverified": 0 }));
        assert!(held_reason(&gate).contains("tools_failed"));
    }

    #[test]
    fn stringly_typed_tools_failed_holds_instead_of_promoting() {
        // The old predicate read `"2"` as 0 and promoted a build with two
        // failing tools.
        let gate = evaluate_promote_gate(&json!({ "tools_failed": "2", "tools_unverified": 0 }));
        assert!(held_reason(&gate).contains("not a whole number"));
    }

    #[test]
    fn float_and_negative_tools_failed_hold_instead_of_promoting() {
        for bad in [json!(0.0), json!(-1), json!(1.5)] {
            let gate = evaluate_promote_gate(&json!({ "tools_failed": bad, "tools_unverified": 0 }));
            assert!(
                matches!(gate, PromoteGate::Held { .. }),
                "expected a hold for tools_failed={bad}"
            );
        }
    }

    #[test]
    fn non_object_report_holds_instead_of_promoting() {
        for bad in [json!(null), json!("all good"), json!([]), json!(0)] {
            let gate = evaluate_promote_gate(&bad);
            assert!(
                matches!(gate, PromoteGate::Held { .. }),
                "expected a hold for report={bad}"
            );
        }
    }

    #[test]
    fn missing_tools_unverified_holds_instead_of_promoting() {
        // A producer that forgets the unverified accounting cannot be trusted
        // to have done it — hold rather than assume zero.
        let gate = evaluate_promote_gate(&json!({ "tools_failed": 0, "results": [] }));
        assert!(held_reason(&gate).contains("`tools_unverified` is missing"));
    }

    // ── Integrity: the counts must match what the report actually lists ───

    #[test]
    fn report_that_undercounts_its_own_failures_holds() {
        let report = json!({
            "tools_failed": 0,
            "tools_unverified": 0,
            "results": [
                { "status": "passed" },
                { "status": "failed" },
            ],
        });
        assert!(held_reason(&evaluate_promote_gate(&report)).contains("contradicts itself"));
    }

    #[test]
    fn report_that_undercounts_its_own_unverified_holds() {
        let report = json!({
            "tools_failed": 0,
            "tools_unverified": 0,
            "results": [{ "status": "unverified" }],
        });
        assert!(held_reason(&evaluate_promote_gate(&report)).contains("contradicts itself"));
    }

    #[test]
    fn result_without_a_readable_status_holds() {
        let report = json!({
            "tools_failed": 0,
            "tools_unverified": 0,
            "results": [{ "tool_name": "gmail" }],
        });
        assert!(held_reason(&evaluate_promote_gate(&report)).contains("no readable `status`"));
    }

    #[test]
    fn results_that_is_not_a_list_holds() {
        let report = json!({
            "tools_failed": 0,
            "tools_unverified": 0,
            "results": "everything went fine",
        });
        assert!(held_reason(&evaluate_promote_gate(&report)).contains("not a list"));
    }

    // ── Verdicts that must NOT change ────────────────────────────────────

    #[test]
    fn real_failures_are_failed_not_held_so_the_fix_pass_still_runs() {
        // A hold skips the fix-pass loop by design. Genuine tool failures must
        // keep routing to it, or the autonomous build loses its self-repair.
        let report = json!({
            "tools_failed": 1,
            "tools_unverified": 0,
            "results": [{ "status": "credential_missing" }],
        });
        assert_eq!(evaluate_promote_gate(&report), PromoteGate::Failed);
    }

    #[test]
    fn a_clean_executed_pass_still_promotes() {
        let mut tally = ToolTestTally::default();
        let executed = crate::engine::tool_runner::ToolTestResult {
            tool_name: "raw".to_string(),
            status: "passed".to_string(),
            http_status: Some(200),
            latency_ms: 12,
            error: None,
            connector: None,
            output_preview: Some("{\"ok\":true}".to_string()),
        };
        let r = tally.record_executed("alpha_vantage", Some("alpha_vantage".into()), executed);
        assert_eq!(r.tool_name, "alpha_vantage");
        tally.results.push(json!({ "status": "passed" }));

        assert_eq!(
            evaluate_promote_gate(&tally.into_report()),
            PromoteGate::Pass
        );
    }

    #[test]
    fn platform_builtins_still_promote_without_being_called() {
        // The carve-out on `cli_native`: recognition from THIS backend's fixed
        // allow-list, with no external service or user credential behind it.
        let mut tally = ToolTestTally::default();
        for name in ["personas_database", "messaging", "file_read"] {
            let r = tally
                .record_planned_entry(&json!({
                    "tool_name": name,
                    "curl": "",
                    "cli_native": true,
                    "description": "Built-in platform connector",
                }))
                .expect("decided without a call");
            assert_eq!(r.status, "passed", "{name} must stay a pass");
            tally.results.push(json!({ "status": "passed" }));
        }
        assert_eq!(tally.unverified, 0);
        assert_eq!(
            evaluate_promote_gate(&tally.into_report()),
            PromoteGate::Pass
        );
    }

    // ── The hold must be loud ────────────────────────────────────────────

    #[test]
    fn hold_reasons_are_single_line_and_notification_sized() {
        // The reason becomes `error_message`, the OS notification body and the
        // companion-chat episode. `short_failure_label` cuts at 280 chars, so
        // a reason that needs more than that loses the actionable half.
        let mut tally = ToolTestTally::default();
        for name in ["web_search", "web_fetch", "summarise", "translate", "rank"] {
            tally.record_planned_entry(&json!({
                "tool_name": name, "curl": "", "cli_native": true,
            }));
            tally.results.push(json!({ "status": "unverified" }));
        }
        let gate = evaluate_promote_gate(&tally.into_report());
        let reason = held_reason(&gate);

        assert!(!reason.contains('\n'), "a hold reason must be one line");
        assert!(
            reason.chars().count() <= 280,
            "hold reason is {} chars, past the notification cut",
            reason.chars().count()
        );
        assert!(reason.contains("and 1 more"), "5 tools, 4 named: {reason}");
    }

    #[test]
    fn a_held_report_names_subjects_even_without_unverified_reasons() {
        // Older/other producers may carry `results` but no `unverified_reasons`.
        let report = json!({
            "tools_failed": 0,
            "tools_unverified": 1,
            "results": [{ "status": "unverified", "tool_name": "notion" }],
        });
        assert!(held_reason(&evaluate_promote_gate(&report)).contains("notion"));
    }
}
