//! Transcript content reader — the P0 "ingestion core" for Fleet's
//! "beyond the terminal" program.
//!
//! The sibling [`super::transcript`] watcher only looks at the **mtime** of
//! `~/.claude/projects/**/<sessionId>.jsonl` (an aliveness ping). This module
//! reads the file's **content** and rolls it up into a structured
//! [`FleetTranscriptSummary`] — tokens, tool usage, files touched, message
//! counts, timestamps. F2 (per-session intelligence), F3 (hibernate scrollback
//! rehydration), and F5 (recipe sequencing) all consume this.
//!
//! Robustness: Claude Code's JSONL shape drifts across versions, so every
//! field is extracted opportunistically from `serde_json::Value` (never fail
//! on a missing field); unparseable lines are counted, not fatal.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Token totals accumulated across a session's assistant turns. `i64` (→ TS
/// `bigint`) because cache-read counts can run into the tens of millions over
/// a long session; the frontend `Number()`s them for display.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetTokenTotals {
    pub input: i64,
    pub output: i64,
    pub cache_creation: i64,
    pub cache_read: i64,
}

/// One tool name + how many times it was invoked in the transcript.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetToolCount {
    pub name: String,
    pub count: i32,
}

/// Structured rollup of a single Claude Code session transcript.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetTranscriptSummary {
    /// Claude session id (the JSONL filename stem).
    pub claude_session_id: String,
    /// Absolute path to the parsed JSONL file.
    pub path: String,
    /// `cwd` recorded in the transcript (the project the session ran in).
    pub cwd: Option<String>,
    /// Genuine user prompts submitted (tool-result echoes are excluded).
    pub user_messages: i32,
    /// Assistant turns.
    pub assistant_messages: i32,
    /// Token totals across all assistant turns.
    pub tokens: FleetTokenTotals,
    /// Distinct models seen, in first-seen order.
    pub models: Vec<String>,
    /// Per-tool invocation counts, sorted by count desc then name.
    pub tools: Vec<FleetToolCount>,
    /// Distinct files modified (Edit/Write/MultiEdit/NotebookEdit), sorted.
    pub files_touched: Vec<String>,
    /// Earliest / latest entry timestamp (ISO-8601, sorts chronologically).
    pub first_timestamp: Option<String>,
    pub last_timestamp: Option<String>,
    /// JSONL lines that failed to parse (format-drift diagnostic).
    pub parse_errors: i32,
    /// Non-empty lines read.
    pub total_lines: i32,
}

/// File-mutating tools — their `input.file_path` / `input.notebook_path`
/// feed `files_touched`.
const EDIT_TOOLS: &[&str] = &["Edit", "Write", "MultiEdit", "NotebookEdit"];

/// Pure summarizer over already-read JSONL lines. Separated from the IO so it
/// can be unit-tested with synthetic transcripts.
pub fn summarize_lines(
    claude_session_id: &str,
    path: &str,
    lines: &[String],
) -> FleetTranscriptSummary {
    let mut user_messages = 0;
    let mut assistant_messages = 0;
    let mut tokens = FleetTokenTotals::default();
    let mut models: Vec<String> = Vec::new();
    let mut tool_counts: HashMap<String, i32> = HashMap::new();
    let mut files: BTreeSet<String> = BTreeSet::new();
    let mut cwd: Option<String> = None;
    let mut first_ts: Option<String> = None;
    let mut last_ts: Option<String> = None;
    let mut parse_errors = 0;
    let mut total_lines = 0;

    for raw in lines {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        total_lines += 1;

        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                parse_errors += 1;
                continue;
            }
        };

        if cwd.is_none() {
            if let Some(c) = v.get("cwd").and_then(|x| x.as_str()) {
                cwd = Some(c.to_string());
            }
        }
        if let Some(ts) = v.get("timestamp").and_then(|x| x.as_str()) {
            if first_ts.as_deref().map_or(true, |f| ts < f) {
                first_ts = Some(ts.to_string());
            }
            if last_ts.as_deref().map_or(true, |l| ts > l) {
                last_ts = Some(ts.to_string());
            }
        }

        let entry_type = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let message = v.get("message");

        match entry_type {
            "assistant" => {
                assistant_messages += 1;

                if let Some(m) = message
                    .and_then(|m| m.get("model"))
                    .and_then(|x| x.as_str())
                {
                    if !m.is_empty() && !models.iter().any(|x| x == m) {
                        models.push(m.to_string());
                    }
                }

                // usage lives under message.usage; fall back to a top-level usage.
                let usage = message.and_then(|m| m.get("usage")).or_else(|| v.get("usage"));
                if let Some(u) = usage {
                    let get = |k: &str| u.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
                    tokens.input += get("input_tokens");
                    tokens.output += get("output_tokens");
                    tokens.cache_creation += get("cache_creation_input_tokens");
                    tokens.cache_read += get("cache_read_input_tokens");
                }

                if let Some(content) = message
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for block in content {
                        if block.get("type").and_then(|x| x.as_str()) != Some("tool_use") {
                            continue;
                        }
                        let Some(name) = block.get("name").and_then(|x| x.as_str()) else {
                            continue;
                        };
                        *tool_counts.entry(name.to_string()).or_insert(0) += 1;
                        if EDIT_TOOLS.contains(&name) {
                            if let Some(input) = block.get("input") {
                                for key in ["file_path", "notebook_path"] {
                                    if let Some(fp) = input.get(key).and_then(|x| x.as_str()) {
                                        if !fp.is_empty() {
                                            files.insert(fp.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "user" => {
                if is_real_user_prompt(message) {
                    user_messages += 1;
                }
            }
            _ => {}
        }
    }

    let mut tools: Vec<FleetToolCount> = tool_counts
        .into_iter()
        .map(|(name, count)| FleetToolCount { name, count })
        .collect();
    tools.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));

    FleetTranscriptSummary {
        claude_session_id: claude_session_id.to_string(),
        path: path.to_string(),
        cwd,
        user_messages,
        assistant_messages,
        tokens,
        models,
        tools,
        files_touched: files.into_iter().collect(),
        first_timestamp: first_ts,
        last_timestamp: last_ts,
        parse_errors,
        total_lines,
    }
}

/// A `user`-type entry is a genuine prompt only if it carries real text —
/// Claude Code also records tool results as user-role entries whose content
/// is solely `tool_result` blocks.
fn is_real_user_prompt(message: Option<&serde_json::Value>) -> bool {
    let Some(content) = message.and_then(|m| m.get("content")) else {
        return false;
    };
    match content {
        serde_json::Value::String(s) => !s.trim().is_empty(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .any(|b| b.get("type").and_then(|x| x.as_str()) != Some("tool_result")),
        _ => false,
    }
}

/// `~/.claude/projects` — inlined (not borrowed from the desktop-gated
/// `transcript` module) so this module + its bindings compile on every profile.
fn projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

/// Locate `<claude_session_id>.jsonl` under `~/.claude/projects`. The real
/// layout is `projects/<encoded-project>/<id>.jsonl`; we also check a direct
/// child defensively.
fn find_transcript(claude_session_id: &str) -> Option<PathBuf> {
    let projects = projects_dir()?;
    let filename = format!("{claude_session_id}.jsonl");

    let direct = projects.join(&filename);
    if direct.is_file() {
        return Some(direct);
    }
    if let Ok(entries) = std::fs::read_dir(&projects) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let cand = p.join(&filename);
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }
    None
}

/// Read and summarize a session's transcript. `claude_session_id` is the
/// id bound from the SessionStart hook (`FleetSession.claudeSessionId`).
/// Errors if no transcript file exists for the id yet.
#[tauri::command]
pub async fn fleet_read_transcript(
    claude_session_id: String,
) -> Result<FleetTranscriptSummary, String> {
    // File read + parse can be sizeable (multi-MB transcripts) — keep it off
    // the async executor.
    tokio::task::spawn_blocking(move || {
        let path = find_transcript(&claude_session_id)
            .ok_or_else(|| format!("transcript not found for session {claude_session_id}"))?;
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("failed to read transcript: {e}"))?;
        let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
        Ok(summarize_lines(
            &claude_session_id,
            &path.to_string_lossy(),
            &lines,
        ))
    })
    .await
    .map_err(|e| format!("transcript read task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(raw: &[&str]) -> Vec<String> {
        raw.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn summarize_extracts_structured_rollup() {
        let raw = lines(&[
            r#"{"type":"user","cwd":"/proj","timestamp":"2026-05-31T10:00:00Z","message":{"role":"user","content":"do the thing"}}"#,
            r#"{"type":"assistant","timestamp":"2026-05-31T10:00:05Z","message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"ok"},{"type":"tool_use","name":"Edit","input":{"file_path":"/proj/a.rs"}},{"type":"tool_use","name":"Bash","input":{"command":"ls"}}],"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":2000}}}"#,
            r#"{"type":"user","timestamp":"2026-05-31T10:00:06Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"done"}]}}"#,
            r#"{"type":"assistant","timestamp":"2026-05-31T10:00:10Z","message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/proj/a.rs"}},{"type":"tool_use","name":"Write","input":{"file_path":"/proj/b.rs"}}],"usage":{"input_tokens":50,"output_tokens":10}}}"#,
            "   ",
            "{not valid json",
        ]);

        let s = summarize_lines("sess1", "/x.jsonl", &raw);

        assert_eq!(s.user_messages, 1, "tool_result user entry is not a prompt");
        assert_eq!(s.assistant_messages, 2);
        assert_eq!(s.tokens.input, 150);
        assert_eq!(s.tokens.output, 30);
        assert_eq!(s.tokens.cache_read, 2000);
        assert_eq!(s.models, vec!["claude-opus-4-8".to_string()]);
        // a.rs appears twice but is deduped; sorted.
        assert_eq!(
            s.files_touched,
            vec!["/proj/a.rs".to_string(), "/proj/b.rs".to_string()]
        );
        assert_eq!(s.cwd.as_deref(), Some("/proj"));
        assert_eq!(s.first_timestamp.as_deref(), Some("2026-05-31T10:00:00Z"));
        assert_eq!(s.last_timestamp.as_deref(), Some("2026-05-31T10:00:10Z"));
        assert_eq!(s.parse_errors, 1);
        // Edit invoked twice → leads the sorted tool list.
        assert_eq!(s.tools[0].name, "Edit");
        assert_eq!(s.tools[0].count, 2);
    }

    #[test]
    fn summarize_handles_empty_input() {
        let s = summarize_lines("empty", "/e.jsonl", &[]);
        assert_eq!(s.total_lines, 0);
        assert_eq!(s.assistant_messages, 0);
        assert_eq!(s.tokens.input, 0);
        assert!(s.files_touched.is_empty());
        assert!(s.first_timestamp.is_none());
    }
}
