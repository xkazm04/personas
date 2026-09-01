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
    /// Background shells the session launched over its lifetime — `Bash`
    /// tool uses carrying `run_in_background: true`. A foreground Bash blocks
    /// the turn and is gone by the time anyone looks; a backgrounded one keeps
    /// running, which is the number an operator watching a fleet cares about.
    pub bg_procs_launched: i32,
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

/// The shell tool, and the input flag that makes one of its runs detach.
const BASH_TOOL: &str = "Bash";
const RUN_IN_BACKGROUND: &str = "run_in_background";

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
    bg_procs_launched: i32,
    cwd: Option<String>,
    first_ts: Option<String>,
    last_ts: Option<String>,
    last_context_tokens: i64,
    parse_errors: i32,
    total_lines: i32,
    /// `message.id` of the assistant record folded last — the de-duplication
    /// key. See [`RollupAcc::fold_line`]'s assistant arm for why one slot is
    /// enough (and why a `HashSet` would be the wrong shape here: this
    /// accumulator lives for the whole life of a session in the incremental
    /// `ingest_delta` path, so its memory must not grow with turn count).
    last_message_id: Option<String>,
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
                // ── ONE TURN, MANY RECORDS ────────────────────────────────
                // Claude Code writes one JSONL record PER CONTENT BLOCK of an
                // assistant turn: a turn of [thinking, tool_use] lands as two
                // records, and every one of them repeats the same `message.id`
                // AND a byte-identical `message.usage`. Summing usage per
                // record therefore counts a turn once per block it happened to
                // contain, which is not a rounding error: measured over the 60
                // newest transcripts on this machine, 57 of them carry
                // duplicated ids and the inflation runs from 8% to 62% of the
                // token sum. Against the one ground truth a transcript carries
                // — its own trailing `cost-state.modelUsage` — the naive sum
                // read 2.62x the real output-token count and the de-duplicated
                // sum reads 1.00x.
                //
                // Duplicate records are always CONTIGUOUS (0 non-contiguous
                // reappearances across 7,656 turns in those 60 files), so one
                // remembered id is enough and this stays O(1) — which the
                // incremental `ingest_delta` path requires, since one
                // accumulator lives for the whole session.
                //
                // The CONTENT is still folded on every record. Each record
                // carries only its OWN block, and no `tool_use` id was ever
                // seen twice, so tool counts / files touched / background
                // shells must NOT be de-duplicated — only the per-turn facts
                // (the turn count and its usage) may be.
                let message_id = message
                    .and_then(|m| m.get("id"))
                    .and_then(|x| x.as_str())
                    .map(str::to_string);
                let same_turn = message_id.is_some() && message_id == self.last_message_id;
                if !same_turn {
                    self.last_message_id = message_id;
                    self.assistant_messages += 1;
                }

                if let Some(m) = message
                    .and_then(|m| m.get("model"))
                    .and_then(|x| x.as_str())
                {
                    if !m.is_empty() && !self.models.iter().any(|x| x == m) {
                        self.models.push(m.to_string());
                    }
                }

                // usage lives under message.usage; fall back to a top-level usage.
                let usage = message
                    .and_then(|m| m.get("usage"))
                    .or_else(|| v.get("usage"));
                if let Some(u) = usage {
                    let get = |k: &str| u.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
                    if !same_turn {
                        self.tokens.input += get("input_tokens");
                        self.tokens.output += get("output_tokens");
                        self.tokens.cache_creation += get("cache_creation_input_tokens");
                        self.tokens.cache_read += get("cache_read_input_tokens");
                    }
                    // Latest turn wins (chronological file order) → current
                    // context size ≈ this turn's input + cache-read. This one
                    // was ALREADY correct under duplication — it assigns rather
                    // than accumulates, and the duplicates carry identical
                    // values — so the fix does not move it.
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
                        if name == BASH_TOOL
                            && block
                                .get("input")
                                .and_then(|i| i.get(RUN_IN_BACKGROUND))
                                .and_then(|x| x.as_bool())
                                == Some(true)
                        {
                            self.bg_procs_launched += 1;
                        }
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
            "user" if is_real_user_prompt(message) => {
                self.user_messages += 1;
            }
            _ => {}
        }
    }

    fn to_summary(&self, claude_session_id: &str, path: &str) -> FleetTranscriptSummary {
        let mut tools: Vec<FleetToolCount> = self
            .tool_counts
            .iter()
            .map(|(name, count)| FleetToolCount {
                name: name.clone(),
                count: *count,
            })
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
            bg_procs_launched: self.bg_procs_launched,
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

/// How much of the transcript tail the parked-state classifier reads. A few
/// records is all it needs (the trailing assistant message and whether its
/// tool calls resolved); anything larger is pure cost on a 30s ticker.
pub const TAIL_BYTES: u64 = 4 * 1024;

/// Read the last complete JSONL records of a session's transcript.
///
/// This is the classifier's window into what a parked session was DOING when
/// it stopped — the thing "stale" never looked at, which is why a finished
/// run, a run waiting on a question, and a genuinely hung run all landed in
/// one amber bucket. Returns `None` when there is no transcript yet.
///
/// A byte-offset seek does not land on a record boundary, so the first
/// (partial) line is dropped and the bytes are decoded lossily.
pub fn tail_lines(claude_session_id: &str) -> Option<Vec<String>> {
    let path = find_transcript(claude_session_id)?;
    Some(tail_lines_of(&path, TAIL_BYTES)?.0)
}

/// Read the last `max_bytes` of `path` as complete JSONL records.
///
/// Returns the records and whether the read was TRUNCATED (i.e. the file was
/// larger than the window, so anything older than it was not seen). That flag
/// is not decoration: a caller that reports "no summary found" must be able to
/// tell "there is none" from "I did not look that far back".
fn tail_lines_of(path: &Path, max_bytes: u64) -> Option<(Vec<String>, bool)> {
    let mut f = std::fs::File::open(path).ok()?;
    let size = f.metadata().ok()?.len();
    let from = size.saturating_sub(max_bytes);
    f.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = Vec::new();
    f.take(max_bytes).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<String> = text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    // Drop the leading partial record — unless we read the whole file, in
    // which case the first line is genuinely the first record.
    if from > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    Some((lines, from > 0))
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
        .or_insert_with(|| IngestState {
            offset: 0,
            acc: RollupAcc::default(),
        });
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

/// Blocking convenience for callers that already run on a blocking thread:
/// catch up on appended bytes and return the rollup for one session, or `None`
/// when no transcript exists yet. Same delta path as `fleet_session_metadata`;
/// extracted so the run-harvest fold can reuse it without duplicating the
/// find + ingest + read dance.
pub fn summary_for_session(claude_session_id: &str) -> Option<FleetTranscriptSummary> {
    let path = find_transcript(claude_session_id)?;
    ingest_delta(claude_session_id, &path);
    metadata_for(claude_session_id, &path.to_string_lossy())
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
    p.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
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
    files.sort_by_key(|b| std::cmp::Reverse(b.0)); // newest first
    for (_mtime, path) in files {
        if read_transcript_cwd(&path)
            .map(|c| normalize_cwd(&c))
            .as_deref()
            == Some(target.as_str())
        {
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
        files.sort_by_key(|b| std::cmp::Reverse(b.0));

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

// ── Session recap — "what is this one doing", without an xterm ─────────────
//
// A session tile's only affordance was "open the full terminal", which mounts
// an xterm and takes a live PTY subscription. At 20+ live fleets that is the
// wrong price for a question the transcript can already answer, and the answer
// is ALREADY ON DISK: Claude Code writes its own session recap.
//
// Measured over the 60 newest transcripts in `~/.claude/projects` on this
// machine:
//   {"type":"system","subtype":"away_summary","content":"Goal was … Next: …"}  43/60
//   {"type":"ai-title","aiTitle":"…"}                                          32/60
//   {"type":"last-prompt","lastPrompt":"…"}                                    59/60
//   {"type":"summary", …}                                                       0/60
// The last line is the load-bearing one: `summary` is STALE on this Claude Code
// version. Nothing here parses it.

/// How much of the transcript tail a recap reads.
///
/// Chosen from measured distance-from-EOF over those same 60 files: the last
/// `ai-title` sits a median 15 KB from the end (p90 31 KB), the last
/// `last-prompt` 9 KB (p90 29 KB), and the last `away_summary` 2 KB. 256 KB
/// clears all three with room to spare while still being a bounded read against
/// a median 1.6 MB (max 6.3 MB) transcript — which is the whole point of a
/// recap that is cheaper than a terminal.
///
/// The p90 for `away_summary` is 484 KB, and that is deliberately NOT covered:
/// an away-summary buried half a megabyte back belongs to a session that
/// resumed and kept working afterwards, where the trailing assistant text is
/// the truer answer to "what is this one doing" anyway.
///
/// This is separate from [`TAIL_BYTES`] (4 KB) on purpose. That window belongs
/// to the parked-state classifier, which runs for EVERY session on a 30s
/// ticker; widening it 64× to serve an on-demand click would be paid by every
/// session forever.
pub const RECAP_TAIL_BYTES: u64 = 256 * 1024;

/// Longest recap field carried to the UI. The panel is a modal, not a reader.
const RECAP_TEXT_MAX: usize = 600;

/// Claude Code appends this hint to its own away summaries. It is chrome for
/// the CLI's UI, addressed to a reader who is looking at the CLI — it is not
/// part of the summary, and it appeared on ~52% of the away summaries measured.
const AWAY_SUMMARY_HINT: &str = "(disable recaps in /config)";

/// What a session was doing, read from its transcript instead of its terminal.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetSessionRecap {
    pub claude_session_id: String,
    /// Claude Code's OWN recap of the session (`system` / `away_summary`) —
    /// the best answer when present, because the model wrote it about itself.
    pub away_summary: Option<String>,
    /// The model-generated session title (`ai-title`).
    pub ai_title: Option<String>,
    /// The operator's most recent prompt (`last-prompt`) — a dedicated record,
    /// so no message walking is needed to find it.
    pub last_prompt: Option<String>,
    /// Trailing assistant prose. The fallback when there is no away summary.
    pub last_assistant_text: Option<String>,
    /// Name of a `tool_use` that no `tool_result` has closed — i.e. what the
    /// session is in the middle of right now — and the timestamp it started.
    pub pending_tool: Option<String>,
    pub pending_tool_since: Option<String>,
    /// Latest timestamp seen in the window.
    pub last_timestamp: Option<String>,
    /// The window did not reach the start of the file. See [`tail_lines_of`].
    pub truncated: bool,
}

/// Clip to [`RECAP_TEXT_MAX`] on a char boundary, and drop empties.
fn recap_text(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if s.chars().count() <= RECAP_TEXT_MAX {
        return Some(s.to_string());
    }
    let mut out: String = s.chars().take(RECAP_TEXT_MAX).collect();
    out.push('…');
    Some(out)
}

/// Pure recap fold over already-read JSONL lines. Separated from the IO so it
/// can be unit-tested with synthetic transcripts, exactly like
/// [`summarize_lines`].
pub fn recap_from_lines(
    claude_session_id: &str,
    lines: &[String],
    truncated: bool,
) -> FleetSessionRecap {
    let mut r = FleetSessionRecap {
        claude_session_id: claude_session_id.to_string(),
        truncated,
        ..Default::default()
    };
    // The open tool call, if any. A `tool_result` (or a real user turn) closes
    // it — the same pairing `classify::classify_parked` does, kept local
    // because this fold also has to carry the timestamp out.
    let mut open_tool: Option<(String, Option<String>)> = None;

    for raw in lines {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(raw.trim()) else {
            continue;
        };
        let ts = v
            .get("timestamp")
            .and_then(|x| x.as_str())
            .map(str::to_string);
        if let Some(ts) = ts.clone() {
            if r.last_timestamp.as_deref().is_none_or(|l| ts.as_str() > l) {
                r.last_timestamp = Some(ts);
            }
        }

        match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            "system" if v.get("subtype").and_then(|x| x.as_str()) == Some("away_summary") => {
                if let Some(c) = v.get("content").and_then(|x| x.as_str()) {
                    r.away_summary = recap_text(c.replace(AWAY_SUMMARY_HINT, "").trim());
                }
            }
            "ai-title" => {
                if let Some(s) = v.get("aiTitle").and_then(|x| x.as_str()) {
                    r.ai_title = recap_text(s);
                }
            }
            "last-prompt" => {
                if let Some(s) = v.get("lastPrompt").and_then(|x| x.as_str()) {
                    r.last_prompt = recap_text(s);
                }
            }
            "assistant" => {
                let blocks = v
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array());
                let Some(blocks) = blocks else { continue };
                for b in blocks {
                    match b.get("type").and_then(|x| x.as_str()) {
                        Some("text") => {
                            if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                                if let Some(t) = recap_text(t) {
                                    r.last_assistant_text = Some(t);
                                }
                            }
                        }
                        Some("tool_use") => {
                            if let Some(n) = b.get("name").and_then(|x| x.as_str()) {
                                open_tool = Some((n.to_string(), ts.clone()));
                            }
                        }
                        _ => {}
                    }
                }
            }
            "user" => {
                // A tool_result closes the outstanding call; so does any real
                // user turn, which means the session moved past it.
                open_tool = None;
            }
            _ => {}
        }
    }

    if let Some((name, since)) = open_tool {
        r.pending_tool = Some(name);
        r.pending_tool_since = since;
    }
    r
}

/// Read a session's recap from the tail of its transcript.
///
/// `Ok(None)` means there is no transcript for this id yet — a session that has
/// not started writing one, or one whose id was never bound. That is a normal
/// state, not an error, and the UI says so rather than showing a blank panel.
#[tauri::command]
pub async fn fleet_session_recap(
    claude_session_id: String,
) -> Result<Option<FleetSessionRecap>, String> {
    // The handle is BOUND rather than awaited inline, and a panic is separated
    // from a cancellation below. The other commands in this module flatten
    // `JoinError` with a `map_err`, which makes "the blocking read panicked"
    // and "the runtime shut the task down" the same string — the condition
    // `panic-isolation.md` is about. This one does not.
    let task = tokio::task::spawn_blocking(move || {
        let Some(path) = find_transcript(&claude_session_id) else {
            return Ok(None);
        };
        let Some((lines, truncated)) = tail_lines_of(&path, RECAP_TAIL_BYTES) else {
            return Ok(None);
        };
        Ok(Some(recap_from_lines(
            &claude_session_id,
            &lines,
            truncated,
        )))
    });
    match task.await {
        Ok(result) => result,
        Err(e) if e.is_panic() => Err("recap read panicked while parsing the transcript".into()),
        Err(e) => Err(format!("recap task failed: {e}")),
    }
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
    fn counts_only_backgrounded_bash_runs() {
        let raw = lines(&[
            // Backgrounded — the only shape that counts.
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm run dev","run_in_background":true}}]}}"#,
            // Explicitly foreground.
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls","run_in_background":false}}]}}"#,
            // Flag absent (the common case) — foreground.
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}"#,
            // Another tool carrying the flag must not be counted as a shell.
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Task","input":{"run_in_background":true}}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"tail -f log","run_in_background":true}}]}}"#,
        ]);
        let s = summarize_lines("bg", "/x.jsonl", &raw);
        assert_eq!(s.bg_procs_launched, 2);
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
        let a = summarize_lines(
            "a",
            "/a.jsonl",
            &lines(&[
                r#"{"type":"assistant","message":{"model":"m","content":[],"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":2000}}}"#,
            ]),
        );
        // Session B: bloated context (200000 input, > CONTEXT_BLOAT_TOKENS).
        let b = summarize_lines(
            "b",
            "/b.jsonl",
            &lines(&[
                r#"{"type":"assistant","message":{"model":"m","content":[],"usage":{"input_tokens":200000,"output_tokens":50}}}"#,
            ]),
        );

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

    // ── Fixtures ──────────────────────────────────────────────────────────
    //
    // CAPTURED, NOT INVENTED. These three files hold real records lifted
    // verbatim out of transcripts under `~/.claude/projects`; only free text
    // (prompt bodies, assistant prose, shell commands, paths, branch names) was
    // replaced with `REDACTED`. Every structural field — key names, nesting,
    // `message.id`, and the whole `usage` object with its real numbers — is
    // byte-for-byte what Claude Code wrote.
    //
    // That distinction is the point (`model-output-streaming.md`): a fixture
    // typed out by the same author as the parser can only assert what the
    // parser already assumes. The duplicate-`message.id` shape these tests turn
    // on is exactly the kind of thing an invented fixture would have missed —
    // it did, for as long as this module has existed.
    //
    // The one hand-set value is the away-summary's `content`, whose real text
    // is the operator's; its trailing `(disable recaps in /config)` is kept
    // because that is a CLI constant (observed on 208 of 400 real away
    // summaries), not prose, and the parser strips it.
    const FIXTURE_TURN_SPLIT: &str = include_str!("testdata/turn_split_across_records.jsonl");
    const FIXTURE_RECAP: &str = include_str!("testdata/recap_records.jsonl");
    const FIXTURE_TOOL_PAIR: &str = include_str!("testdata/tool_open_then_closed.jsonl");

    fn fixture(raw: &str) -> Vec<String> {
        raw.lines()
            .filter(|l| !l.trim().is_empty())
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn one_turn_split_across_records_is_counted_once() {
        // Two REAL consecutive records of ONE assistant turn: block [text] and
        // block [tool_use: Bash], sharing `message.id` and carrying a
        // byte-identical `usage`. Summing per record double-counts every field.
        let raw = fixture(FIXTURE_TURN_SPLIT);
        assert_eq!(raw.len(), 2, "fixture is the two records of one turn");
        let s = summarize_lines("dedup", "/x.jsonl", &raw);

        // ONE turn, not two records.
        assert_eq!(s.assistant_messages, 1);
        // Usage counted once. Naively summed these would each be doubled —
        // which is the defect, measured at a median 2.22x against the
        // transcripts' own trailing `cost-state` ground truth.
        assert_eq!(s.tokens.input, 2);
        assert_eq!(s.tokens.output, 361);
        assert_eq!(s.tokens.cache_creation, 45_235);
        assert_eq!(s.tokens.cache_read, 28_517);
        // …but CONTENT is folded from EVERY record: each carries its own block,
        // and no `tool_use` is ever repeated, so nothing here may be deduped.
        assert_eq!(s.tools.len(), 1);
        assert_eq!(s.tools[0].name, "Bash");
        assert_eq!(s.tools[0].count, 1, "the turn's one tool call survives");
        // Assign-not-accumulate, so this was already right and must not move.
        assert_eq!(s.last_context_tokens, 2 + 28_517);
    }

    #[test]
    fn records_without_a_message_id_are_never_merged() {
        // Older / drifted transcripts carry no `message.id`. Absent an id there
        // is no evidence two records are one turn, so each stands alone — the
        // pre-fix behaviour, preserved. Built by STRIPPING the id out of the
        // captured pair rather than by typing a new record.
        let raw: Vec<String> = fixture(FIXTURE_TURN_SPLIT)
            .iter()
            .map(|l| {
                let mut v: serde_json::Value = serde_json::from_str(l).unwrap();
                v["message"].as_object_mut().unwrap().remove("id");
                v.to_string()
            })
            .collect();
        let s = summarize_lines("noid", "/x.jsonl", &raw);
        assert_eq!(s.assistant_messages, 2);
        assert_eq!(s.tokens.input, 4, "no id, no merge — both counted");
        assert_eq!(s.tokens.output, 722);
    }

    #[test]
    fn recap_prefers_claude_s_own_away_summary() {
        // Captured `last-prompt`, `ai-title`, an assistant text turn, and the
        // `system`/`away_summary` record — the four shapes the recap reads.
        let r = recap_from_lines("s1", &fixture(FIXTURE_RECAP), false);
        // The CLI's own trailing hint is chrome, not summary.
        assert_eq!(r.away_summary.as_deref(), Some("REDACTED. Next: REDACTED."));
        assert_eq!(r.ai_title.as_deref(), Some("REDACTED"));
        assert_eq!(r.last_prompt.as_deref(), Some("REDACTED"));
        assert_eq!(r.last_assistant_text.as_deref(), Some("REDACTED"));
        assert_eq!(
            r.last_timestamp.as_deref(),
            Some("2026-08-30T20:19:46.699Z")
        );
        assert!(r.pending_tool.is_none(), "no tool left open in this window");
        assert!(!r.truncated);
    }

    #[test]
    fn recap_reports_an_unclosed_tool_and_forgets_a_closed_one() {
        // The captured pair: a real `tool_use` and the real `tool_result` that
        // closes it. Whole pair → nothing pending.
        let pair = fixture(FIXTURE_TOOL_PAIR);
        assert_eq!(pair.len(), 2);
        assert!(recap_from_lines("s", &pair, false).pending_tool.is_none());

        // First record ALONE → the call is still open, and its age is the fact
        // the operator actually needs.
        let r = recap_from_lines("s", &pair[..1], false);
        assert_eq!(r.pending_tool.as_deref(), Some("Bash"));
        assert_eq!(
            r.pending_tool_since.as_deref(),
            Some("2026-08-30T19:34:26.982Z")
        );
    }

    #[test]
    fn recap_of_an_empty_or_unreadable_window_is_empty_not_an_error() {
        // A session whose transcript exists but holds nothing this fold
        // recognises must still produce a recap — the UI degrades visibly on
        // the empty fields rather than on an error.
        let r = recap_from_lines("s", &[], true);
        assert_eq!(r.claude_session_id, "s");
        assert!(r.away_summary.is_none());
        assert!(r.last_assistant_text.is_none());
        assert!(r.truncated, "a truncated window says so");
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
