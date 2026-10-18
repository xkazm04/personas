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

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
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

    let mut file = match File::open(path) {
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

    // Read from the END. A live Claude Code transcript reaches hundreds of
    // MB (tool results ride in it) and this runs on every CLI-aware persona
    // execution, so parsing the whole file to keep its last eight turns was
    // the cost of the feature. Start with a tail window and widen it only
    // when the window holds fewer than `max_turns` turns.
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut window = TAIL_WINDOW_START_BYTES;
    loop {
        let start = len.saturating_sub(window);
        let turns = read_turns_from(&mut file, start, max_turns);
        if turns.len() >= max_turns || start == 0 {
            return turns;
        }
        window = window.saturating_mul(4);
    }
}

/// First tail window `read_recent_turns` parses; each retry quadruples it.
const TAIL_WINDOW_START_BYTES: u64 = 256 * 1024;

/// The last `max_turns` turns found between byte `start` and end of file,
/// oldest first. When `start` is not 0 the first (partial) line is skipped:
/// it is either a fragment or older than everything after it, and the caller
/// widens the window when that matters.
fn read_turns_from(file: &mut File, start: u64, max_turns: usize) -> Vec<TranscriptTurn> {
    if file.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut reader = BufReader::new(file);
    let mut buf: Vec<u8> = Vec::new();
    if start > 0 && reader.read_until(b'\n', &mut buf).is_err() {
        return Vec::new();
    }
    let mut turns: VecDeque<TranscriptTurn> = VecDeque::with_capacity(max_turns + 1);
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        // A line that is not UTF-8 (a half-written multi-byte char at the
        // end of a file the CLI is still appending to) is skipped, not the
        // end of the read: `lines().map_while(Result::ok)` stopped there.
        let Ok(line) = std::str::from_utf8(&buf) else {
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(turn) = parse_turn(line) {
            turns.push_back(turn);
            if turns.len() > max_turns {
                turns.pop_front();
            }
        }
    }
    turns.into()
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

    /// A scratch transcript that deletes itself when the test ends. Returning a
    /// bare path left one `personas_cli_tx_test_*.jsonl` in the system temp dir
    /// per test run (423 of them on 2026-09-14).
    struct ScratchFile(std::path::PathBuf);

    impl std::ops::Deref for ScratchFile {
        type Target = std::path::Path;
        fn deref(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl AsRef<std::path::Path> for ScratchFile {
        fn as_ref(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for ScratchFile {
        fn drop(&mut self) {
            // Best-effort: a leftover file is untidy, a panic in Drop would hide
            // which assertion actually failed.
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn scratch_file(content: &str) -> ScratchFile {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let mut p = std::env::temp_dir();
        p.push(format!("personas_cli_tx_test_{pid}_{id}.jsonl"));
        let mut f = File::create(&p).expect("create scratch jsonl");
        f.write_all(content.as_bytes()).expect("write");
        ScratchFile(p)
    }

    /// The pre-2026-10-18 reader: parse every line, keep the tail. Kept as the
    /// oracle the tail-window reader must agree with.
    fn full_scan(path: &std::path::Path, max_turns: usize) -> Vec<TranscriptTurn> {
        let text = std::fs::read(path).expect("read transcript");
        let mut turns: Vec<TranscriptTurn> = String::from_utf8_lossy(&text)
            .lines()
            .filter_map(parse_turn)
            .collect();
        let drop = turns.len().saturating_sub(max_turns);
        turns.drain(0..drop);
        turns
    }

    fn big_transcript(turns: usize, filler_bytes: usize) -> String {
        let filler = "x".repeat(filler_bytes);
        let mut out = String::new();
        for i in 0..turns {
            out.push_str(&format!(
                "{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"question {i}\"}}}}\n"
            ));
            // A tool_result line the reader must skip; this is what makes
            // real transcripts large.
            out.push_str(&format!(
                "{{\"type\":\"tool_result\",\"content\":\"{filler}\"}}\n"
            ));
            out.push_str(&format!(
                "{{\"type\":\"assistant\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"text\",\"text\":\"answer {i}\"}}]}}}}\n"
            ));
        }
        out
    }

    #[test]
    fn tail_window_agrees_with_a_full_scan_across_window_sizes() {
        // filler 0 -> everything fits the first window; 200 KB -> each turn
        // pair straddles windows; 1 MB -> the window must widen several times.
        for filler in [0usize, 200 * 1024, 1024 * 1024] {
            let p = scratch_file(&big_transcript(12, filler));
            for max in [1usize, 3, 8, 30] {
                assert_eq!(
                    read_recent_turns(&p, max),
                    full_scan(&p, max),
                    "filler={filler} max={max}"
                );
            }
        }
    }

    #[test]
    fn a_half_written_last_line_does_not_hide_the_turns_before_it() {
        // The CLI is appending to an ACTIVE session; the newest line can end
        // mid-character. Every complete turn before it must still be read.
        let mut bytes = big_transcript(3, 0).into_bytes();
        bytes.extend_from_slice(b"{\"type\":\"user\",\"message\":{\"content\":\"caf\xC3");
        let p = scratch_file("");
        std::fs::write(&p, &bytes).expect("write");
        let turns = read_recent_turns(&p, 8);
        assert_eq!(turns.len(), 6);
        assert_eq!(turns[5].text, "answer 2");
    }

    /// Timing probe against a real transcript:
    /// `PERSONAS_BENCH_TRANSCRIPT=<path> ... -- --ignored --nocapture tail_read_timing`
    #[test]
    #[ignore]
    fn tail_read_timing() {
        let Ok(path) = std::env::var("PERSONAS_BENCH_TRANSCRIPT") else {
            return;
        };
        let p = std::path::Path::new(&path);
        let t0 = std::time::Instant::now();
        let old = full_scan(p, 8);
        let full = t0.elapsed();
        let t1 = std::time::Instant::now();
        let new = read_recent_turns(p, 8);
        let tail = t1.elapsed();
        assert_eq!(new, old);
        println!(
            "full_scan={full:?} tail_window={tail:?} turns={}",
            new.len()
        );
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
        let line = format!(r#"{{"type":"user","message":{{"role":"user","content":"{big}"}}}}"#);
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
        let line = format!(r#"{{"type":"user","message":{{"role":"user","content":"{big}"}}}}"#);
        let f = scratch_file(&format!("{line}\n"));
        let turns = read_recent_turns(&f, 1);
        assert_eq!(turns.len(), 1);
        // Must not panic on byte-boundary slicing — the assertion is
        // implicit in not panicking; spot-check that we ended cleanly.
        assert!(turns[0].text.chars().count() <= TURN_MAX_CHARS + 1);
        assert!(turns[0].text.ends_with('…'));
    }
}
