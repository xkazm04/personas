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
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
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
    let mut acc = RollupAcc::default();
    for raw in lines {
        acc.fold_line(raw);
    }
    acc.to_summary(claude_session_id, path)
}

/// Mutable accumulator folded one JSONL line at a time. The same fold powers
/// the full-file [`summarize_lines`] AND the incremental delta-ingest
/// ([`ingest_delta`]) — so a long session's metadata is maintained by parsing
/// only newly-appended bytes, never re-reading the whole (multi-MB) file, and
/// the raw output is never retained (only these compact counters).
#[derive(Default, Clone)]
struct RollupAcc {
    user_messages: i32,
    assistant_messages: i32,
    tokens: FleetTokenTotals,
    models: Vec<String>,
    tool_counts: HashMap<String, i32>,
    files: BTreeSet<String>,
    cwd: Option<String>,
    first_ts: Option<String>,
    last_ts: Option<String>,
    last_context_tokens: i64,
    parse_errors: i32,
    total_lines: i32,
}

impl RollupAcc {
    fn fold_line(&mut self, raw: &str) {
        let line = raw.trim();
        if line.is_empty() {
            return;
        }
        self.total_lines += 1;

        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                self.parse_errors += 1;
                return;
            }
        };

        if self.cwd.is_none() {
            if let Some(c) = v.get("cwd").and_then(|x| x.as_str()) {
                self.cwd = Some(c.to_string());
            }
        }
        if let Some(ts) = v.get("timestamp").and_then(|x| x.as_str()) {
            if self.first_ts.as_deref().map_or(true, |f| ts < f) {
                self.first_ts = Some(ts.to_string());
            }
            if self.last_ts.as_deref().map_or(true, |l| ts > l) {
                self.last_ts = Some(ts.to_string());
            }
        }

        let entry_type = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let message = v.get("message");

        match entry_type {
            "assistant" => {
                self.assistant_messages += 1;

                if let Some(m) = message.and_then(|m| m.get("model")).and_then(|x| x.as_str()) {
                    if !m.is_empty() && !self.models.iter().any(|x| x == m) {
                        self.models.push(m.to_string());
                    }
                }

                // usage lives under message.usage; fall back to a top-level usage.
                let usage = message.and_then(|m| m.get("usage")).or_else(|| v.get("usage"));
                if let Some(u) = usage {
                    let get = |k: &str| u.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
                    self.tokens.input += get("input_tokens");
                    self.tokens.output += get("output_tokens");
                    self.tokens.cache_creation += get("cache_creation_input_tokens");
                    self.tokens.cache_read += get("cache_read_input_tokens");
                    // Latest turn wins (chronological file order) → current
                    // context size ≈ this turn's input + cache-read.
                    self.last_context_tokens = get("input_tokens") + get("cache_read_input_tokens");
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
                        *self.tool_counts.entry(name.to_string()).or_insert(0) += 1;
                        if EDIT_TOOLS.contains(&name) {
                            if let Some(input) = block.get("input") {
                                for key in ["file_path", "notebook_path"] {
                                    if let Some(fp) = input.get(key).and_then(|x| x.as_str()) {
                                        if !fp.is_empty() {
                                            self.files.insert(fp.to_string());
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
                    self.user_messages += 1;
                }
            }
            _ => {}
        }
    }

    fn to_summary(&self, claude_session_id: &str, path: &str) -> FleetTranscriptSummary {
        let mut tools: Vec<FleetToolCount> = self
            .tool_counts
            .iter()
            .map(|(name, count)| FleetToolCount { name: name.clone(), count: *count })
            .collect();
        tools.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));

        FleetTranscriptSummary {
            claude_session_id: claude_session_id.to_string(),
            path: path.to_string(),
            cwd: self.cwd.clone(),
            user_messages: self.user_messages,
            assistant_messages: self.assistant_messages,
            tokens: self.tokens.clone(),
            last_context_tokens: self.last_context_tokens,
            models: self.models.clone(),
            tools,
            files_touched: self.files.iter().cloned().collect(),
            first_timestamp: self.first_ts.clone(),
            last_timestamp: self.last_ts.clone(),
            parse_errors: self.parse_errors,
            total_lines: self.total_lines,
        }
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

// ── Incremental per-session metadata rollup — the (B) abstraction ──────────
// Maintain a compact rollup per `claude_session_id` by folding ONLY the bytes
// appended since the last ingest. Driven by the transcript watcher on each
// append and caught up on demand by `fleet_session_metadata`. The raw output
// stays on disk; only the rollup (tokens / tool counts / message counts) lives
// in memory — so 10+ parallel sessions never each re-parse a multi-MB file.

struct IngestState {
    /// Byte offset through the last *complete* line already folded.
    offset: u64,
    acc: RollupAcc,
}

fn ingest_map() -> &'static Mutex<HashMap<String, IngestState>> {
    static M: OnceLock<Mutex<HashMap<String, IngestState>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fold any newly-appended bytes of `path` into the session's running rollup.
/// Reads only `[offset, EOF)`, folds complete lines (a half-written trailing
/// line is left for next time), and discards the raw text. Cheap + idempotent
/// — safe to call on every transcript append. Seeking always lands on a
/// newline boundary, so the delta is valid UTF-8.
pub fn ingest_delta(claude_session_id: &str, path: &Path) {
    let Ok(size) = std::fs::metadata(path).map(|m| m.len()) else {
        return;
    };
    let mut map = ingest_map().lock().unwrap_or_else(|e| e.into_inner());
    let st = map
        .entry(claude_session_id.to_string())
        .or_insert_with(|| IngestState { offset: 0, acc: RollupAcc::default() });
    if size <= st.offset {
        return; // no growth (or truncated/rotated — leave the rollup as-is)
    }
    let Ok(mut f) = std::fs::File::open(path) else {
        return;
    };
    if f.seek(SeekFrom::Start(st.offset)).is_err() {
        return;
    }
    let mut buf = String::new();
    if f.take(size - st.offset).read_to_string(&mut buf).is_err() {
        return;
    }
    // Fold only through the last newline; keep a partial trailing line for next time.
    let consumed = buf.rfind('\n').map(|i| i + 1).unwrap_or(0);
    for line in buf[..consumed].lines() {
        st.acc.fold_line(line);
    }
    st.offset += consumed as u64;
}

/// Current rollup for a session, if any bytes have been ingested.
pub fn metadata_for(claude_session_id: &str, path: &str) -> Option<FleetTranscriptSummary> {
    let map = ingest_map().lock().unwrap_or_else(|e| e.into_inner());
    map.get(claude_session_id)
        .map(|st| st.acc.to_summary(claude_session_id, path))
}

/// Live per-session metadata rollup — the (B) abstraction. Catches up on any
/// appended bytes (a cheap delta read; full only on the first call for a
/// session) and returns the compact summary WITHOUT re-reading the whole
/// transcript or holding raw output. `None` if no transcript exists yet.
#[tauri::command]
pub async fn fleet_session_metadata(
    claude_session_id: String,
) -> Result<Option<FleetTranscriptSummary>, String> {
    tokio::task::spawn_blocking(move || {
        let Some(path) = find_transcript(&claude_session_id) else {
            return Ok(None);
        };
        ingest_delta(&claude_session_id, &path);
        Ok(metadata_for(&claude_session_id, &path.to_string_lossy()))
    })
    .await
    .map_err(|e| format!("metadata task failed: {e}"))?
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

// ── Fleet-wide token aggregate — the efficiency bar's data source ───────────
// Per-session rollups answer "how heavy is THIS session"; the aggregate answers
// "how is the whole fleet doing" so an operator running many CLIs can see total
// burn, cache efficiency, and how many sessions are bloated enough to compact.

/// Context size (tokens) above which a session counts as "bloated" — re-sending
/// a heavy conversation on every turn. MUST stay in sync with the red threshold
/// in `src/features/plugins/fleet/sub_grid/FleetContextPill.tsx`.
pub const CONTEXT_BLOAT_TOKENS: i64 = 150_000;

/// Fleet-wide rollup summed across the bound sessions the caller passes in.
/// Powers the grid's fleet-efficiency bar — the aggregate companion to the
/// per-session [`FleetTranscriptSummary`] / `FleetContextPill`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetTokenAggregate {
    /// Sessions that had a readable transcript and were folded into the sums.
    pub session_count: i32,
    /// Summed token totals across every included session.
    pub tokens: FleetTokenTotals,
    /// Sum of each session's current context size (`last_context_tokens`) — the
    /// combined per-turn re-send cost of the whole fleet.
    pub total_context_tokens: i64,
    /// Sessions whose current context exceeds [`CONTEXT_BLOAT_TOKENS`] — the
    /// "red zone" ones worth compacting. Mirrors `FleetContextPill`'s red bucket.
    pub bloated_count: i32,
}

/// Pure aggregation over already-read summaries — separated from IO so it can be
/// unit-tested with synthetic rollups.
pub fn aggregate_summaries(summaries: &[FleetTranscriptSummary]) -> FleetTokenAggregate {
    let mut agg = FleetTokenAggregate::default();
    for s in summaries {
        agg.session_count += 1;
        agg.tokens.input += s.tokens.input;
        agg.tokens.output += s.tokens.output;
        agg.tokens.cache_creation += s.tokens.cache_creation;
        agg.tokens.cache_read += s.tokens.cache_read;
        agg.total_context_tokens += s.last_context_tokens;
        if s.last_context_tokens > CONTEXT_BLOAT_TOKENS {
            agg.bloated_count += 1;
        }
    }
    agg
}

/// Aggregate token totals + cache efficiency across the given bound sessions.
/// The caller (the grid) passes the `claudeSessionId`s it already holds from the
/// registry snapshot, so this stays decoupled from the registry and folds only
/// newly-appended transcript bytes per session (same cheap delta path as
/// [`fleet_session_metadata`]). Sessions without a transcript yet are skipped.
#[tauri::command]
pub async fn fleet_token_summary(
    claude_session_ids: Vec<String>,
) -> Result<FleetTokenAggregate, String> {
    tokio::task::spawn_blocking(move || {
        let mut summaries = Vec::new();
        for id in &claude_session_ids {
            let Some(path) = find_transcript(id) else {
                continue;
            };
            ingest_delta(id, &path);
            if let Some(s) = metadata_for(id, &path.to_string_lossy()) {
                summaries.push(s);
            }
        }
        Ok::<FleetTokenAggregate, String>(aggregate_summaries(&summaries))
    })
    .await
    .map_err(|e| format!("token summary task failed: {e}"))?
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
    fn aggregate_sums_tokens_and_flags_bloated() {
        // Session A: small context (100 input + 2000 cache_read = 2100).
        let a = summarize_lines("a", "/a.jsonl", &lines(&[
            r#"{"type":"assistant","message":{"model":"m","content":[],"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":2000}}}"#,
        ]));
        // Session B: bloated context (200000 input, > CONTEXT_BLOAT_TOKENS).
        let b = summarize_lines("b", "/b.jsonl", &lines(&[
            r#"{"type":"assistant","message":{"model":"m","content":[],"usage":{"input_tokens":200000,"output_tokens":50}}}"#,
        ]));

        let agg = aggregate_summaries(&[a, b]);
        assert_eq!(agg.session_count, 2);
        assert_eq!(agg.tokens.input, 200_100);
        assert_eq!(agg.tokens.output, 70);
        assert_eq!(agg.tokens.cache_read, 2000);
        assert_eq!(agg.tokens.cache_creation, 0);
        assert_eq!(agg.total_context_tokens, 202_100);
        // Only B exceeds the bloat threshold.
        assert_eq!(agg.bloated_count, 1);
    }

    #[test]
    fn aggregate_empty_is_zero() {
        let agg = aggregate_summaries(&[]);
        assert_eq!(agg.session_count, 0);
        assert_eq!(agg.tokens.input, 0);
        assert_eq!(agg.bloated_count, 0);
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
