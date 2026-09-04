//! Shared plumbing for ephemeral one-shot Claude CLI calls used by the
//! brain's backend computations (consolidation, reflection, recall
//! synthesis). Each of these spawns a fresh `claude -p -` process, pipes
//! a focused prompt on stdin, collects the streamed assistant-text
//! deltas, and returns the assembled text (or a JSON envelope parsed by
//! the caller) — no `--resume`, no system-prompt file, no UI streaming.
//!
//! ## Every leg through here is metered (L1a)
//!
//! Until 2026-08-08 this module drained stdout for assistant-text deltas and
//! **threw the terminal `result` event away**, so the seven legs below reached
//! neither spend ledger: not `companion_turn` (no user-db handle here) and not
//! `dev_llm_spend` (nothing wrote it). Their cost was invisible in both, which
//! mattered because this is exactly the machinery the L1 sleep cycle runs on —
//! the cycle's own price could not be measured
//! (`docs/plans/athena-longevity.md`, Part I §7).
//!
//! So [`call_claude_text`] now takes a `UserDbPool` and writes one
//! `companion_turn` row per invocation with `origin='maintenance'` and the
//! [`leg`] name in `trigger_kind`. There is deliberately **no unmetered public
//! entry point**: a future leg cannot be added without a pool, which is the
//! structural version of the rule rather than a comment asking for it.
//!
//! One row per invocation, success or failure. A leg whose CLI ran fine but
//! whose *reply* failed to parse (`extract_json_span`, an empty reflection)
//! still has exactly one row, flagged however the CLI itself reported: the row
//! records the CLI leg that was paid for, and the caller's parse verdict is a
//! separate concern — the same split `cli_text_tracked` has always had.
//!
//! The row shape and the failure taxonomy are NOT re-implemented here. They
//! come from `turn_ledger::{record_cli_leg, record_failed_leg}`, shared with
//! `athena_reaction`'s headless decision legs, and the `result`-event parser is
//! `turn_ledger::CliUsage::from_line` — the same one the tracked path feeds
//! every stdout line to. Two parsers or two row shapes would drift, and both
//! feed one `companion_get_health` number.
//!
//! ## Why this module exists
//!
//! Three call sites (`consolidation::call_claude_oneshot`,
//! `reflection::call_claude_oneshot`, `recall_synthesis::call_claude_oneshot`)
//! independently implemented the same ~120-line spawn/stdin/stdout-delta
//! collect/stderr-buffer/wait/timeout sequence, plus `extract_assistant_text`,
//! `strip_code_fence`, `preview`, and a tolerant first-`{`/last-`}` JSON-span
//! extraction. They drifted: `recall_synthesis::preview` sliced a
//! multi-byte UTF-8 string at a raw byte index with no char-boundary
//! backoff (`&s[..n]`), which can panic; `recall_synthesis::strip_code_fence`
//! required a closing fence while `consolidation`'s tolerated a missing
//! one. All three call sites now share this single implementation.
//!
//! ## `kill_on_drop`
//!
//! `tokio::process::Child` does **not** kill the child process on drop by
//! default (unlike `std::process::Child`). The timeout branch below
//! `?`-returns before `child.wait()`, which used to drop the `Child` and
//! leak a live `claude.exe` (plus its in-flight model call) per timed-out
//! invocation. This is fixed two ways, belt-and-suspenders: the spawned
//! `Command` has `.kill_on_drop(true)` set before `spawn()`, and the
//! timeout branch additionally calls `child.kill().await` explicitly so
//! the reap is deterministic rather than relying purely on drop.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

use crate::companion::session::base_cli_invocation;
use crate::companion::turn_ledger::{self, CliUsage};
use crate::db::UserDbPool;
use crate::error::AppError;

/// The maintenance legs that run through this module, as the low-cardinality
/// tokens written to `companion_turn.trigger_kind`.
///
/// One token per leg, used for BOTH the ledger label and the error-message tag
/// — so `GROUP BY origin, trigger_kind` and a `tracing` line can never name the
/// same leg two different ways. Snake_case because these are query keys, not
/// prose.
pub mod leg {
    pub const CONSOLIDATION: &str = "consolidation";
    pub const REFLECTION: &str = "reflection";
    /// Its one call site (`recall_synthesis::call_claude_oneshot`) is
    /// `ml`-gated and the shipping build has no `ml`, so on that build this
    /// really is unused — like the rest of that module, which carries the same
    /// dead-code warnings today. Named here anyway so the leg has a token the
    /// moment the vector lane compiles, rather than a string invented later
    /// that fails to match this one.
    #[cfg_attr(not(feature = "ml"), allow(dead_code))]
    pub const RECALL_SYNTHESIS: &str = "recall_synthesis";
    pub const BRIEFING: &str = "briefing";
    pub const NIGHT_PLANNER: &str = "night_planner";
    pub const NIGHT_UNATTENDED: &str = "night_unattended";
    pub const TOURS: &str = "tours";
    /// Phase A of the sleep cycle: conversation → candidate facts/procedurals.
    /// The cycle's dominant cost, and the reason L1a metered this module at all
    /// — `GROUP BY trigger_kind` over `origin='maintenance'` is what makes "what
    /// does a night of sleep cost" an answerable question.
    pub const CYCLE_COMPRESS: &str = "cycle_compress";
    /// Phase B of the sleep cycle: supersede / contradiction judgement over the
    /// active fact set.
    pub const CYCLE_RECONCILE: &str = "cycle_reconcile";
}

/// Spawn a one-shot `claude -p -` call, pipe `prompt` as stdin, collect
/// the streamed assistant-text deltas, **record the spend**, and return the
/// assembled text.
///
/// `leg` is one of the [`leg`] constants: it tags the ledger row
/// (`companion_turn.trigger_kind`, with `origin='maintenance'`) and is folded
/// into error messages so failures are traceable back to the caller.
///
/// Metering is best-effort and never changes the call's result — an insert
/// failure is a `tracing::warn!` inside the ledger, and a leg whose CLI emitted
/// no `result` event records a row with NULL usage. What must not happen is a
/// leg with no row at all; that was the state this replaced.
///
/// No `--resume`, no system-prompt file (callers put everything in the
/// user prompt for total control), no stream events to the UI — this is
/// a backend computation, not a chat turn.
pub async fn call_claude_text(
    pool: &UserDbPool,
    prompt: &str,
    model: &str,
    leg: &str,
    call_timeout: Duration,
) -> Result<String, AppError> {
    match run_oneshot(prompt, model, leg, call_timeout).await {
        Ok(run) => {
            // `timed_out` is always false on this path: unlike
            // `athena_reaction::cli_text_inner` (whose 180s cap returns `Ok`
            // with a partial blob), a timeout here `?`-returns below, so it
            // arrives as an `Err` and is classified as `timeout` by
            // `record_failed_leg`. There is no clean-looking timed-out row to
            // guard against.
            turn_ledger::record_cli_leg(
                pool,
                turn_ledger::ORIGIN_MAINTENANCE,
                leg,
                model,
                run.usage,
                false,
            );
            Ok(run.text)
        }
        Err(e) => {
            turn_ledger::record_failed_leg(pool, turn_ledger::ORIGIN_MAINTENANCE, leg, model, &e);
            Err(e)
        }
    }
}

/// What one maintenance leg produced: the assembled assistant text plus the
/// terminal `result` event's usage (`None` when the CLI emitted none, which is
/// what a crashed or very old CLI looks like).
struct OneshotRun {
    text: String,
    usage: Option<CliUsage>,
}

/// Spawn + drain. Split from [`call_claude_text`] so the ledger write has
/// exactly one success path and one failure path to wrap, rather than being
/// threaded through every `?` in the body.
async fn run_oneshot(
    prompt: &str,
    model: &str,
    label: &str,
    call_timeout: Duration,
) -> Result<OneshotRun, AppError> {
    let cwd = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let (cmd_program, mut argv) = base_cli_invocation();
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        model.to_string(),
    ]);

    let mut cmd = Command::new(&cmd_program);
    cmd.args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    // Subscription-only — never the API account.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);
    // No console window on Windows (desktop-heap / 0xC0000142 guard).
    crate::companion::session::apply_no_console_window(&mut cmd);
    // Tokio does NOT kill children on drop by default: the timeout branch
    // below `?`-returns before `wait()`, which would otherwise drop the
    // `Child` and leak a live claude.exe (plus its model call) per
    // timed-out invocation. `kill_on_drop` is the primary guard; the
    // explicit `child.kill().await` on the timeout branch is the
    // belt-and-suspenders backstop for a deterministic reap.
    cmd.kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude ({label}): {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write stdin ({label}): {e}")))?;
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal(format!("claude stdout missing ({label})")))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal(format!("claude stderr missing ({label})")))?;

    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    // Reuse the streaming JSON parser to extract assistant text deltas.
    let mut assistant_text = String::new();
    let mut usage: Option<CliUsage> = None;
    let mut reader = BufReader::new(stdout).lines();

    let collect = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| AppError::Internal(format!("read stdout ({label}): {e}")))?
        {
            if let Some(delta) = extract_assistant_text(&line) {
                assistant_text.push_str(&delta);
            }
            // The terminal `result` event carries this leg's real cost / token
            // usage / duration. Draining stdout without reading it is what made
            // every maintenance leg free-looking for 77 days. Same parser the
            // tracked headless path feeds — one implementation, no drift.
            if let Some(u) = CliUsage::from_line(&line) {
                usage = Some(u);
            }
        }
        Ok::<(), AppError>(())
    };

    if let Err(_elapsed) = timeout(call_timeout, collect).await {
        // Deterministic reap: don't rely purely on kill_on_drop-on-drop
        // ordering — kill explicitly before surfacing the timeout error.
        let _ = child.kill().await;
        return Err(AppError::Internal(format!(
            "{label} timed out after {call_timeout:?}"
        )));
    }

    let _ = stderr_handle.await;
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("await claude ({label}): {e}")))?;
    if !status.success() {
        let err = stderr_buf.lock().await.clone();
        return Err(AppError::Internal(format!(
            "claude {label} exited {}: {}",
            status.code().map(|c| c.to_string()).unwrap_or("?".into()),
            err
        )));
    }

    Ok(OneshotRun {
        text: assistant_text,
        usage,
    })
}

/// Strip stream-json wrapping and pull text deltas. Matches the
/// extractor on the frontend (extractAssistantText in CompanionPanel).
pub fn extract_assistant_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let blocks = v.get("message")?.get("content")?.as_array()?;
    let mut out = String::new();
    for b in blocks {
        if b.get("type").and_then(|x| x.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Strip a leading/trailing markdown code fence (```` ```json ```` or
/// ```` ``` ````) if present. Tolerant of a missing closing fence —
/// Claude sometimes truncates or omits it despite explicit instructions
/// not to fence at all; being lenient here can only help, never hurt.
pub fn strip_code_fence(s: &str) -> Option<&str> {
    let mut s = s;
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else {
        let rest = s.strip_prefix("```")?;
        s = rest;
    }
    let s = s.trim_start_matches('\n');
    if let Some(end) = s.rfind("```") {
        Some(s[..end].trim())
    } else {
        Some(s.trim())
    }
}

/// Truncate `s` to at most `n` bytes for error-message previews,
/// backing off to the nearest earlier char boundary so multi-byte UTF-8
/// text is never sliced mid-codepoint (which would panic).
pub fn preview(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        let mut end = n;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

/// Find the first `{` and last `}` in `text` to be tolerant of a
/// preface/suffix or code fence Claude added despite instructions not
/// to. `context_label` is folded into error messages (e.g.
/// `"consolidation reply"`, `"recall synthesis reply"`).
pub fn extract_json_span<'a>(text: &'a str, context_label: &str) -> Result<&'a str, AppError> {
    let trimmed = text.trim();
    let raw = strip_code_fence(trimmed).unwrap_or(trimmed);
    let start = raw.find('{').ok_or_else(|| {
        AppError::Internal(format!(
            "{context_label} missing JSON object; got: {}",
            preview(raw, 200)
        ))
    })?;
    let end = raw.rfind('}').ok_or_else(|| {
        AppError::Internal(format!(
            "{context_label} missing closing `}}`; got: {}",
            preview(raw, 200)
        ))
    })?;
    if end <= start {
        return Err(AppError::Internal(format!(
            "{context_label} has no valid JSON span; got: {}",
            preview(raw, 200)
        )));
    }
    Ok(&raw[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_code_fence_tolerates_missing_closing_fence() {
        let s = "```json\n{\"a\":1}";
        assert_eq!(strip_code_fence(s), Some("{\"a\":1}"));
    }

    #[test]
    fn strip_code_fence_strips_closing_fence_when_present() {
        let s = "```json\n{\"a\":1}\n```";
        assert_eq!(strip_code_fence(s), Some("{\"a\":1}"));
    }

    #[test]
    fn strip_code_fence_returns_none_when_absent() {
        assert_eq!(strip_code_fence("{\"a\":1}"), None);
    }

    #[test]
    fn preview_returns_whole_string_when_short() {
        assert_eq!(preview("hello", 10), "hello");
    }

    #[test]
    fn preview_truncates_ascii() {
        assert_eq!(preview("hello world", 5), "hello…");
    }

    #[test]
    fn preview_does_not_panic_on_multibyte_boundary() {
        // "café" — 'é' is 2 bytes (0xC3 0xA9), so byte index 4 lands
        // mid-codepoint. Must not panic and must back off to a valid
        // char boundary.
        let s = "café résumé";
        let out = preview(s, 4);
        assert!(out.starts_with("caf"));
    }

    #[test]
    fn extract_json_span_tolerates_preface_and_suffix() {
        let s = "Here is the result:\n{\"x\":1}\nthanks";
        let span = extract_json_span(s, "test reply").unwrap();
        assert_eq!(span, "{\"x\":1}");
    }

    #[test]
    fn extract_json_span_errors_on_missing_object() {
        let s = "no json here";
        assert!(extract_json_span(s, "test reply").is_err());
    }

    #[test]
    fn extract_assistant_text_extracts_text_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}"#;
        assert_eq!(extract_assistant_text(line), Some("hi".to_string()));
    }

    #[test]
    fn extract_assistant_text_ignores_non_assistant_lines() {
        let line = r#"{"type":"system","message":{}}"#;
        assert_eq!(extract_assistant_text(line), None);
    }
}
