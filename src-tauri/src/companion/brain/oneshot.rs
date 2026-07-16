//! Shared plumbing for ephemeral one-shot Claude CLI calls used by the
//! brain's backend computations (consolidation, reflection, recall
//! synthesis). Each of these spawns a fresh `claude -p -` process, pipes
//! a focused prompt on stdin, collects the streamed assistant-text
//! deltas, and returns the assembled text (or a JSON envelope parsed by
//! the caller) — no `--resume`, no system-prompt file, no UI streaming.
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
use crate::error::AppError;

/// Spawn a one-shot `claude -p -` call, pipe `prompt` as stdin, collect
/// the streamed assistant-text deltas, and return the assembled text.
///
/// `label` is a short human-readable tag (e.g. `"consolidation"`,
/// `"reflection"`, `"recall synthesis"`) folded into error messages so
/// failures are traceable back to the caller without each call site
/// hand-rolling its own error strings.
///
/// No `--resume`, no system-prompt file (callers put everything in the
/// user prompt for total control), no stream events to the UI — this is
/// a backend computation, not a chat turn.
pub async fn call_claude_text(
    prompt: &str,
    model: &str,
    label: &str,
    call_timeout: Duration,
) -> Result<String, AppError> {
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

    Ok(assistant_text)
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
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest;
    } else {
        return None;
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
