//! Tolerant JSONL parser for Claude Code transcripts.
//!
//! Reads a transcript file written by Claude Code CLI and extracts
//! the user/assistant message turns into a flat `Vec<TranscriptTurn>`.
//! Skips noisy or sensitive line categories (tool_use, tool_result,
//! thinking, queue-operation) so the prompt block stays focused on
//! "what was said."
//!
//! # Tolerance posture
//!
//! Claude Code's transcript format is undocumented and may drift
//! between versions. This parser is intentionally lenient:
//! - Unrecognized line types are silently skipped.
//! - Lines that fail to parse as JSON are skipped (with a debug log).
//! - Missing fields (no `message`, no `content`) skip the line.
//! - Truncated/empty content lines skip.
//! - On any error, the parser continues — never aborts the run.
//!
//! # Format observed (Claude Code 2.x)
//!
//! User line: `{"type":"user","message":{"role":"user","content":"<string>"}}`
//! Assistant line: `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."},{"type":"thinking",...},{"type":"tool_use",...}]}}`
//!
//! Other line types observed (all skipped): `queue-operation`,
//! `system`, `summary`. The parser doesn't enumerate these — anything
//! that isn't `user`/`assistant` with extractable text is dropped.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

/// Maximum characters per turn in the rendered output.
/// Conversations can paste long code/logs; we cap so the prompt
/// block stays bounded. Truncated turns get a `…` suffix.
pub const TURN_MAX_CHARS: usize = 500;

/// One conversation turn extracted from the transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptTurn {
    /// `"user"` or `"assistant"`.
    pub role: String,
    /// Concatenated visible text from the turn. For assistant turns
    /// with multiple text blocks (rare), they're joined with `\n`.
    /// Already truncated to `TURN_MAX_CHARS` if oversize.
    pub text: String,
}

/// Read up to `max_turns` of the most recent user/assistant turns
/// from a Claude Code transcript file.
///
/// Returns turns in **chronological order** (oldest first within
/// the slice), so the renderer can present them naturally with
/// "newest last" framing. If the file has fewer than `max_turns`
/// turns, returns all of them.
///
/// Returns an empty Vec on any I/O error reading the file —
/// failures are non-fatal by design (per Phase 5 v1's "the prompt
/// degrades gracefully" posture).
pub fn read_recent_turns(path: &Path, max_turns: usize) -> Vec<TranscriptTurn> {
    if max_turns == 0 {
        return Vec::new();
    }

    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            tracing::debug!(
                error = %e,
                path = ?path,
                "cli_session_awareness: failed to open transcript"
            );
            return Vec::new();
        }
    };

    let reader = BufReader::new(file);
    let mut turns: Vec<TranscriptTurn> = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        if let Some(turn) = parse_turn(&line) {
            turns.push(turn);
        }
    }

    // Tail to last `max_turns`. The file is read fully because
    // JSONL doesn't permit reverse seeking efficiently, but the
    // memory cost is bounded — we only retain extracted text, and
    // we bound each turn's text via parse_turn's truncation.
    if turns.len() > max_turns {
        let drop = turns.len() - max_turns;
        turns.drain(0..drop);
    }
    turns
}

/// Parse a single JSONL line into a TranscriptTurn, or None if the
/// line isn't a user/assistant message we want to surface.
fn parse_turn(line: &str) -> Option<TranscriptTurn> {
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return None,
    };

    let line_type = v.get("type")?.as_str()?;
    if line_type != "user" && line_type != "assistant" {
        return None;
    }

    let message = v.get("message")?;
    let role = message
        .get("role")
        .and_then(|r| r.as_str())
        .unwrap_or(line_type)
        .to_string();
    let content = message.get("content")?;

    let raw_text = match content {
        // User content is a string most of the time.
        Value::String(s) => s.clone(),
        // Assistant content is an array of typed blocks.
        Value::Array(blocks) => extract_text_blocks(blocks),
        _ => return None,
    };

    if raw_text.trim().is_empty() {
        return None;
    }

    Some(TranscriptTurn {
        role,
        text: truncate_for_prompt(&raw_text),
    })
}

/// Concatenate the `text` field of all `{"type":"text"}` blocks in
/// an assistant content array. Skips `thinking`, `tool_use`,
/// `tool_result`, and any unrecognized block types.
fn extract_text_blocks(blocks: &[Value]) -> String {
    let parts: Vec<&str> = blocks
        .iter()
        .filter_map(|b| {
            let kind = b.get("type")?.as_str()?;
            if kind != "text" {
                return None;
            }
            b.get("text")?.as_str()
        })
        .collect();
    parts.join("\n")
}

/// Truncate text to `TURN_MAX_CHARS`, appending `…` if cut. Char-
/// boundary safe (uses char_indices rather than byte slicing).
fn truncate_for_prompt(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= TURN_MAX_CHARS {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(TURN_MAX_CHARS).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn scratch_file(content: &str) -> std::path::PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let mut p = std::env::temp_dir();
        p.push(format!("personas_cli_tx_test_{pid}_{id}.jsonl"));
        let mut f = File::create(&p).expect("create scratch jsonl");
        f.write_all(content.as_bytes()).expect("write");
        p
    }

    #[test]
    fn returns_empty_on_missing_file() {
        let p = std::env::temp_dir().join("definitely_not_a_real_transcript_xyz.jsonl");
        let turns = read_recent_turns(&p, 10);
        assert!(turns.is_empty());
    }

    #[test]
    fn extracts_user_string_content() {
        let f = scratch_file(
            r#"{"type":"user","message":{"role":"user","content":"hello there"}}
"#,
        );
        let turns = read_recent_turns(&f, 10);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].role, "user");
        assert_eq!(turns[0].text, "hello there");
    }

    #[test]
    fn extracts_assistant_text_blocks_skipping_thinking_and_tools() {
        let f = scratch_file(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"internal monologue"},{"type":"text","text":"visible reply"},{"type":"tool_use","name":"bash","input":{}},{"type":"tool_result","content":"output"}]}}
"#,
        );
        let turns = read_recent_turns(&f, 10);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].role, "assistant");
        assert_eq!(turns[0].text, "visible reply");
        assert!(!turns[0].text.contains("internal monologue"));
        assert!(!turns[0].text.contains("output"));
    }

    #[test]
    fn skips_queue_operation_and_system_lines() {
        let f = scratch_file(
            r#"{"type":"queue-operation","content":"setup"}
{"type":"system","subtype":"init"}
{"type":"user","message":{"role":"user","content":"real turn"}}
"#,
        );
        let turns = read_recent_turns(&f, 10);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].text, "real turn");
    }

    #[test]
    fn skips_malformed_lines_without_aborting() {
        let f = scratch_file(
            "this is not json\n{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"good\"}}\n{partial json\n",
        );
        let turns = read_recent_turns(&f, 10);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].text, "good");
    }

    #[test]
    fn skips_empty_content() {
        let f = scratch_file(
            r#"{"type":"user","message":{"role":"user","content":""}}
{"type":"user","message":{"role":"user","content":"   "}}
{"type":"user","message":{"role":"user","content":"actual"}}
"#,
        );
        let turns = read_recent_turns(&f, 10);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].text, "actual");
    }

    #[test]
    fn returns_chronological_order_with_max_cap() {
        let mut content = String::new();
        for i in 0..20 {
            content.push_str(&format!(
                r#"{{"type":"user","message":{{"role":"user","content":"turn {i}"}}}}"#
            ));
            content.push('\n');
        }
        let f = scratch_file(&content);
        let turns = read_recent_turns(&f, 5);
        // Expect last 5 turns in chronological order: turn 15..=19.
        assert_eq!(turns.len(), 5);
        assert_eq!(turns[0].text, "turn 15");
        assert_eq!(turns[4].text, "turn 19");
    }

    #[test]
    fn truncates_oversized_content_with_ellipsis() {
        let big = "x".repeat(TURN_MAX_CHARS + 100);
        let line = format!(
            r#"{{"type":"user","message":{{"role":"user","content":"{big}"}}}}"#
        );
        let f = scratch_file(&format!("{line}\n"));
        let turns = read_recent_turns(&f, 1);
        assert_eq!(turns.len(), 1);
        assert!(turns[0].text.ends_with('…'));
        // Trailing ellipsis is one char; the truncated head should
        // be exactly TURN_MAX_CHARS chars.
        let head_chars = turns[0].text.chars().count() - 1;
        assert_eq!(head_chars, TURN_MAX_CHARS);
    }

    #[test]
    fn max_turns_zero_returns_empty() {
        let f = scratch_file(
            r#"{"type":"user","message":{"role":"user","content":"hi"}}
"#,
        );
        let turns = read_recent_turns(&f, 0);
        assert!(turns.is_empty());
    }

    #[test]
    fn handles_multibyte_truncation_safely() {
        // Build a string where chars and bytes diverge — emoji + cjk.
        let unit = "🌟漢字"; // 3 chars
        let big = unit.repeat(TURN_MAX_CHARS); // way more chars than the cap
        let line = format!(
            r#"{{"type":"user","message":{{"role":"user","content":"{big}"}}}}"#
        );
        let f = scratch_file(&format!("{line}\n"));
        let turns = read_recent_turns(&f, 1);
        assert_eq!(turns.len(), 1);
        // Must not panic on byte-boundary slicing — the assertion is
        // implicit in not panicking; spot-check that we ended cleanly.
        assert!(turns[0].text.chars().count() <= TURN_MAX_CHARS + 1);
        assert!(turns[0].text.ends_with('…'));
    }
}
