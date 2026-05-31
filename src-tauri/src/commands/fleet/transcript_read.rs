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
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

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
    /// Approximate current context-window size: the most recent assistant
    /// turn's `input_tokens + cache_read_input_tokens` (each turn re-sends the
    /// whole conversation, so this ≈ "how big the conversation has grown").
    /// Drives the CLI-header efficiency indicator. 0 if no usage was seen.
    pub last_context_tokens: i64,
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
    let mut last_context_tokens = 0i64;
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
                    // Latest turn wins (chronological file order) → current
                    // context size ≈ this turn's input + cache-read.
                    last_context_tokens = get("input_tokens") + get("cache_read_input_tokens");
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
        last_context_tokens,
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

/// File size (bytes) of a session's transcript, or `None` if no transcript
/// exists yet. The staleness ticker polls this to detect *real* log growth
/// (a more reliable "is it actually working" signal than hook timing or
/// mtime touches).
pub fn transcript_size(claude_session_id: &str) -> Option<u64> {
    let path = find_transcript(claude_session_id)?;
    std::fs::metadata(&path).ok().map(|m| m.len())
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

/// Collect `(mtime, path)` for every `*.jsonl` directly under `projects` and
/// one level down (`projects/<encoded-project>/*.jsonl` — the real layout).
fn collect_transcript_files(projects: &Path) -> Vec<(SystemTime, PathBuf)> {
    fn push_jsonl(dir: &Path, out: &mut Vec<(SystemTime, PathBuf)>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                continue;
            }
            if let Ok(mtime) = e.metadata().and_then(|m| m.modified()) {
                out.push((mtime, p));
            }
        }
    }

    let mut out = Vec::new();
    push_jsonl(projects, &mut out);
    if let Ok(entries) = std::fs::read_dir(projects) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                push_jsonl(&p, &mut out);
            }
        }
    }
    out
}

/// Cheap read of the `cwd` recorded in a transcript — scans the first handful
/// of JSONL lines for a `"cwd"` field (it's almost always line 1). Avoids
/// parsing the whole (possibly multi-MB) file.
pub fn read_transcript_cwd(path: &Path) -> Option<String> {
    use std::io::{BufRead, BufReader};
    let file = std::fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().take(30).map_while(Result::ok) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(c) = v.get("cwd").and_then(|x| x.as_str()) {
                return Some(c.to_string());
            }
        }
    }
    None
}

/// Normalize a path for tolerant comparison: forward slashes, no trailing
/// separator, lowercased (Windows cwds are case-insensitive).
pub fn normalize_cwd(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_ascii_lowercase()
}

/// The most-recently-active `claude_session_id` whose transcript records the
/// given working directory — i.e. the conversation to `--resume` when
/// re-adopting an orphaned process rooted at `cwd`. Returns the transcript's
/// file stem (the session id), or `None` if nothing matches. Matches on the
/// recorded `cwd` (not the encoded dir name) so it's robust to encoding quirks.
pub fn latest_session_for_cwd(cwd: &str) -> Option<String> {
    let projects = projects_dir()?;
    let target = normalize_cwd(cwd);
    let mut files = collect_transcript_files(&projects);
    files.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    for (_mtime, path) in files {
        if read_transcript_cwd(&path).map(|c| normalize_cwd(&c)).as_deref() == Some(target.as_str()) {
            return path.file_stem().map(|s| s.to_string_lossy().into_owned());
        }
    }
    None
}

/// Summarize the most recently-active transcripts across all projects — the
/// data source for Fleet's cross-session activity feed (F2 / P2.2). Scans
/// `~/.claude/projects`, keeps `*.jsonl` modified within `within_days`
/// (default 7), and summarizes the `limit` (default 50) most-recent via the
/// same parser as [`fleet_read_transcript`]. Newest first.
#[tauri::command]
pub async fn fleet_recent_transcripts(
    within_days: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<FleetTranscriptSummary>, String> {
    let within = within_days.unwrap_or(7) as u64;
    let limit = limit.unwrap_or(50) as usize;

    tokio::task::spawn_blocking(move || {
        let Some(projects) = projects_dir() else {
            return Ok(Vec::new());
        };
        if !projects.is_dir() {
            return Ok(Vec::new());
        }

        let cutoff = SystemTime::now().checked_sub(Duration::from_secs(within * 86_400));
        let mut files = collect_transcript_files(&projects);
        // Newest first so the cutoff + limit can short-circuit cleanly.
        files.sort_by(|a, b| b.0.cmp(&a.0));

        let mut summaries = Vec::new();
        for (mtime, path) in files {
            if summaries.len() >= limit {
                break;
            }
            // Sorted desc → once we pass the cutoff every remaining file is older.
            if let Some(c) = cutoff {
                if mtime < c {
                    break;
                }
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if let Ok(content) = std::fs::read_to_string(&path) {
                let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
                summaries.push(summarize_lines(&id, &path.to_string_lossy(), &lines));
            }
        }
        Ok(summaries)
    })
    .await
    .map_err(|e| format!("recent transcripts task failed: {e}"))?
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
        // Latest assistant turn's input(50) + cache_read(0) = current context.
        assert_eq!(s.last_context_tokens, 50);
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

    #[test]
    fn normalize_cwd_is_separator_and_case_insensitive() {
        // The watcher's cwd-binding (transcript.rs) relies on this so a
        // transcript cwd ("C:\\Users\\x\\ascent") matches a Fleet session cwd
        // stored with forward slashes / different case / a trailing slash.
        let a = normalize_cwd(r"C:\Users\kazda\kiro\ascent");
        assert_eq!(a, normalize_cwd("C:/Users/kazda/kiro/ascent"));
        assert_eq!(a, normalize_cwd(r"c:\users\kazda\kiro\ascent\"));
        assert_ne!(a, normalize_cwd(r"C:\Users\kazda\kiro\personas"));
    }
}
