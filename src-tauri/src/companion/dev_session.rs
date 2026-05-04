//! Phase 4: self-improve loop. The "wrench-send" button on the composer
//! pipes user feedback into a separate Claude CLI coding session at the
//! repo root.
//!
//! ## Why detached + file-based
//!
//! The improvement run almost always edits something under `src-tauri/`,
//! which makes Tauri's dev server rebuild and restart the parent app.
//! That kills any in-flight Tauri command future, so a naïve "spawn and
//! wait inline" pattern leaves the conversation stuck — the user sees
//! the panel reload with no outcome, and the original `await` rejects.
//!
//! We dodge this by:
//!   1. Writing a marker file at `~/.personas/companion-brain/improvements/<id>.json`
//!      containing `{ feedback, pid, stream_path, stderr_path, started_at }`.
//!   2. Spawning Claude CLI as a detached subprocess (Windows:
//!      `CREATE_NEW_PROCESS_GROUP`) with its stdout/stderr redirected to
//!      the files referenced in the marker. Detach means the child
//!      keeps running even if Tauri kills the parent.
//!   3. The parent still waits inline (happy path) and writes the
//!      outcome episode normally.
//!   4. If the parent dies mid-wait: the CLI continues, files persist.
//!      `recover_orphan_improvements` (called on every `companion_init`
//!      and at the start of each `send_turn`) scans the marker dir,
//!      checks each PID, and finalizes any whose process has exited.
//!
//! Beta-gated by `cfg!(debug_assertions)`. Never runs in release builds.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Hard ceiling: a coding session that takes longer than 10 minutes is
/// either stuck or doing something we don't want anyway.
const IMPROVE_TIMEOUT: Duration = Duration::from_secs(600);

/// Files matching any of these substrings get flagged in the outcome
/// episode + UI as "critical touched". Soft signal, not blocking.
const CRITICAL_FILE_NEEDLES: &[&str] = &[
    "package.json",
    "package-lock.json",
    "Cargo.toml",
    "Cargo.lock",
    ".cargo/config.toml",
    "tauri.conf.json",
    "src-tauri/src/db/migrations/",
    ".env",
    ".gitignore",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImprovementOutcome {
    pub success: bool,
    pub summary: String,
    pub files_modified: Vec<String>,
    pub critical_files: Vec<String>,
    pub elapsed_seconds: u64,
    pub error: Option<String>,
}

/// On-disk record so the parent can recover an improvement that was
/// in-flight when the dev server killed it. Stored next to the stream
/// log files in the pending-improvements dir.
#[derive(Debug, Serialize, Deserialize)]
struct ImprovementMarker {
    id: String,
    feedback: String,
    started_at: String,
    pid: u32,
    stream_path: String,
    stderr_path: String,
    /// Marker schema version — bump if the shape changes so older
    /// orphans don't silently mis-parse.
    #[serde(default = "marker_v1")]
    version: u32,
}

fn marker_v1() -> u32 {
    1
}

fn ensure_pending_dir() -> Result<PathBuf, AppError> {
    let root = crate::companion::disk::brain_root()?;
    let dir = root.join("improvements");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// ── public entry points ─────────────────────────────────────────────────

/// Run a self-improve turn. Spawns Claude CLI detached at the repo root
/// with its output redirected to disk, waits for completion (happy
/// path), and writes the outcome as a system episode in Athena's
/// transcript. If the parent process dies during the wait, the CLI
/// continues and `recover_orphan_improvements` later picks up the
/// outcome.
#[cfg(feature = "ml")]
pub async fn run_improvement(
    user_db: &UserDbPool,
    embedder: Option<&std::sync::Arc<EmbeddingManager>>,
    feedback: String,
) -> Result<ImprovementOutcome, AppError> {
    let id = short_random();
    let dir = ensure_pending_dir()?;
    let marker_path = dir.join(format!("{id}.json"));
    let stream_path = dir.join(format!("{id}.stream.jsonl"));
    let stderr_path = dir.join(format!("{id}.stderr.txt"));
    let prompt_path = std::env::temp_dir().join(format!("athena-improve-{id}.md"));
    std::fs::write(&prompt_path, IMPROVE_SYSTEM_PROMPT)?;

    let started = std::time::Instant::now();
    let started_iso = chrono::Utc::now().to_rfc3339();

    let spawn_outcome = spawn_detached(
        &feedback,
        &prompt_path,
        &stream_path,
        &stderr_path,
        &marker_path,
        &id,
        &started_iso,
    )
    .await;

    let mut child = match spawn_outcome {
        Ok(c) => c,
        Err(e) => {
            // No marker was written — nothing to recover, return failure.
            let _ = std::fs::remove_file(&prompt_path);
            return Ok(failure_outcome(format!("spawn: {e}"), started));
        }
    };

    // Pipe feedback in via stdin so Claude CLI sees it as the user message.
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(feedback.as_bytes()).await {
            tracing::warn!(error = %e, "self-improve: write stdin failed (CLI may still recover from cached prompt)");
        }
        drop(stdin);
    }

    // Wait. If parent dies mid-await, the detached child continues.
    let status = match timeout(IMPROVE_TIMEOUT, child.wait()).await {
        Ok(Ok(s)) => Some(s),
        Ok(Err(_)) => None,
        Err(_) => {
            // Soft cancel — let the detached process keep running. Recovery
            // on next startup will pick up whatever it did finish.
            tracing::warn!("self-improve: parent timed out waiting; orphan will be recovered");
            None
        }
    };

    let outcome = finalize_from_disk(
        &feedback,
        &stream_path,
        &stderr_path,
        status.map(|s| s.success()).unwrap_or(false),
        started,
    );

    log_outcome_episode(user_db, embedder, &feedback, &outcome).await;

    let _ = std::fs::remove_file(&marker_path);
    let _ = std::fs::remove_file(&stream_path);
    let _ = std::fs::remove_file(&stderr_path);
    let _ = std::fs::remove_file(&prompt_path);

    Ok(outcome)
}

#[cfg(not(feature = "ml"))]
pub async fn run_improvement(
    user_db: &UserDbPool,
    feedback: String,
) -> Result<ImprovementOutcome, AppError> {
    // Same pipeline minus embedding. Kept symmetric for cross-feature builds.
    let id = short_random();
    let dir = ensure_pending_dir()?;
    let marker_path = dir.join(format!("{id}.json"));
    let stream_path = dir.join(format!("{id}.stream.jsonl"));
    let stderr_path = dir.join(format!("{id}.stderr.txt"));
    let prompt_path = std::env::temp_dir().join(format!("athena-improve-{id}.md"));
    std::fs::write(&prompt_path, IMPROVE_SYSTEM_PROMPT)?;
    let started = std::time::Instant::now();
    let started_iso = chrono::Utc::now().to_rfc3339();
    let spawn_outcome = spawn_detached(
        &feedback,
        &prompt_path,
        &stream_path,
        &stderr_path,
        &marker_path,
        &id,
        &started_iso,
    )
    .await;
    let mut child = match spawn_outcome {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&prompt_path);
            return Ok(failure_outcome(format!("spawn: {e}"), started));
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(feedback.as_bytes()).await;
        drop(stdin);
    }
    let status = match timeout(IMPROVE_TIMEOUT, child.wait()).await {
        Ok(Ok(s)) => Some(s),
        _ => None,
    };
    let outcome = finalize_from_disk(
        &feedback,
        &stream_path,
        &stderr_path,
        status.map(|s| s.success()).unwrap_or(false),
        started,
    );
    let episode_text = format_episode(&feedback, &outcome);
    let _ = episodic::append_episode(
        user_db,
        DEFAULT_SESSION_ID,
        EpisodeRole::System,
        &episode_text,
    );
    let _ = std::fs::remove_file(&marker_path);
    let _ = std::fs::remove_file(&stream_path);
    let _ = std::fs::remove_file(&stderr_path);
    let _ = std::fs::remove_file(&prompt_path);
    Ok(outcome)
}

/// Walk the pending-improvements dir. For each marker whose PID has
/// exited, parse its stream file, write the outcome episode, and clean
/// up the on-disk artifacts. Markers whose PID is still alive are
/// left untouched (the run is still going).
///
/// Returns the number of orphans recovered. Best-effort: a parse error
/// on one orphan doesn't stop the others.
#[cfg(feature = "ml")]
pub async fn recover_orphan_improvements(
    user_db: &UserDbPool,
    embedder: Option<&std::sync::Arc<EmbeddingManager>>,
) -> Result<usize, AppError> {
    let dir = match ensure_pending_dir() {
        Ok(d) => d,
        Err(_) => return Ok(0),
    };
    let mut recovered = 0_usize;
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let marker: ImprovementMarker = match std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            Some(m) => m,
            None => {
                // Garbage marker, drop it so it doesn't keep tripping us.
                let _ = std::fs::remove_file(&path);
                continue;
            }
        };
        if pid_alive(marker.pid) {
            continue;
        }
        let stream_path = PathBuf::from(&marker.stream_path);
        let stderr_path = PathBuf::from(&marker.stderr_path);
        let started_proxy = std::time::Instant::now();
        let outcome = finalize_from_disk(
            &marker.feedback,
            &stream_path,
            &stderr_path,
            // We don't know exit status post-mortem. Treat presence of
            // `result` event as success; absence as failure-ish.
            true, // placeholder; overridden by stream parse below
            started_proxy,
        );
        let outcome = correct_post_mortem_status(outcome, &marker.started_at);

        log_outcome_episode(
            user_db,
            embedder,
            &format!("{} (recovered post-restart)", marker.feedback),
            &outcome,
        )
        .await;

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&stream_path);
        let _ = std::fs::remove_file(&stderr_path);
        recovered += 1;
        tracing::info!(id = %marker.id, "self-improve: recovered orphan run after parent restart");
    }
    Ok(recovered)
}

#[cfg(not(feature = "ml"))]
pub async fn recover_orphan_improvements(
    user_db: &UserDbPool,
) -> Result<usize, AppError> {
    let dir = match ensure_pending_dir() {
        Ok(d) => d,
        Err(_) => return Ok(0),
    };
    let mut recovered = 0_usize;
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let marker: ImprovementMarker = match std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            Some(m) => m,
            None => {
                let _ = std::fs::remove_file(&path);
                continue;
            }
        };
        if pid_alive(marker.pid) {
            continue;
        }
        let stream_path = PathBuf::from(&marker.stream_path);
        let stderr_path = PathBuf::from(&marker.stderr_path);
        let outcome = finalize_from_disk(
            &marker.feedback,
            &stream_path,
            &stderr_path,
            true,
            std::time::Instant::now(),
        );
        let outcome = correct_post_mortem_status(outcome, &marker.started_at);
        let episode_text = format_episode(
            &format!("{} (recovered post-restart)", marker.feedback),
            &outcome,
        );
        let _ = episodic::append_episode(
            user_db,
            DEFAULT_SESSION_ID,
            EpisodeRole::System,
            &episode_text,
        );
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&stream_path);
        let _ = std::fs::remove_file(&stderr_path);
        recovered += 1;
    }
    Ok(recovered)
}

// ── internals ───────────────────────────────────────────────────────────

async fn spawn_detached(
    _feedback: &str,
    prompt_path: &PathBuf,
    stream_path: &PathBuf,
    stderr_path: &PathBuf,
    marker_path: &PathBuf,
    id: &str,
    started_iso: &str,
) -> Result<tokio::process::Child, AppError> {
    let stdout_file = std::fs::File::create(stream_path)
        .map_err(|e| AppError::Internal(format!("create stream file: {e}")))?;
    let stderr_file = std::fs::File::create(stderr_path)
        .map_err(|e| AppError::Internal(format!("create stderr file: {e}")))?;

    let repo_root = resolve_repo_root();
    let (cmd_program, mut argv) = if cfg!(windows) {
        ("cmd".to_string(), vec!["/C".to_string(), "claude.cmd".to_string()])
    } else {
        ("claude".to_string(), Vec::new())
    };
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--append-system-prompt-file".into(),
        prompt_path.to_string_lossy().to_string(),
    ]);

    let mut cmd = Command::new(&cmd_program);
    cmd.args(&argv)
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));

    // Detach so the child keeps running if the parent dies (Tauri dev
    // restart). On Windows: `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS`.
    // On Unix: `setsid` via pre_exec. The `kill_on_drop(false)` is also
    // important — without it tokio would SIGKILL the child when the
    // Child handle drops on parent exit.
    cmd.kill_on_drop(false);
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude (improve): {e}")))?;
    let pid = child.id().unwrap_or(0);

    // Marker is written AFTER spawn so we have an accurate PID. If the
    // parent dies between spawn and marker-write, the detached child
    // is unrecoverable — but that's a vanishingly small window.
    let marker = ImprovementMarker {
        id: id.to_string(),
        feedback: _feedback.to_string(),
        started_at: started_iso.to_string(),
        pid,
        stream_path: stream_path.to_string_lossy().to_string(),
        stderr_path: stderr_path.to_string_lossy().to_string(),
        version: marker_v1(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&marker) {
        let _ = std::fs::write(marker_path, json);
    }

    Ok(child)
}

/// Parse the on-disk stream-json + stderr files into an outcome. Used
/// both inline (after parent waited) and post-mortem (recovery).
fn finalize_from_disk(
    feedback: &str,
    stream_path: &PathBuf,
    stderr_path: &PathBuf,
    inline_success_hint: bool,
    started: std::time::Instant,
) -> ImprovementOutcome {
    let _ = feedback; // currently unused here; reserved for future correlation
    let stream = std::fs::read_to_string(stream_path).unwrap_or_default();
    let stderr_text = std::fs::read_to_string(stderr_path).unwrap_or_default();

    let mut summary = String::new();
    let mut files: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut saw_result_event = false;
    let mut result_was_error = false;

    let repo_root = resolve_repo_root();
    for line in stream.lines() {
        let value = match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match value.get("type").and_then(|v| v.as_str()) {
            Some("assistant") => {
                if let Some(content) = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for block in content {
                        match block.get("type").and_then(|v| v.as_str()) {
                            Some("text") => {
                                if let Some(text) =
                                    block.get("text").and_then(|v| v.as_str())
                                {
                                    if !summary.is_empty() {
                                        summary.push('\n');
                                    }
                                    summary.push_str(text);
                                }
                            }
                            Some("tool_use") => {
                                let name =
                                    block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                if matches!(name, "Edit" | "Write" | "MultiEdit") {
                                    if let Some(fp) = block
                                        .get("input")
                                        .and_then(|i| i.get("file_path"))
                                        .and_then(|v| v.as_str())
                                    {
                                        files.insert(normalize_repo_path(fp, &repo_root));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            Some("result") => {
                saw_result_event = true;
                result_was_error = value
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
            }
            _ => {}
        }
    }

    let files_modified: Vec<String> = files.into_iter().collect();
    let critical_files: Vec<String> = files_modified
        .iter()
        .filter(|p| {
            let p_norm = p.replace('\\', "/");
            CRITICAL_FILE_NEEDLES.iter().any(|n| p_norm.contains(n))
        })
        .cloned()
        .collect();

    let success = saw_result_event && !result_was_error && inline_success_hint;
    let elapsed = started.elapsed().as_secs();

    if !success {
        let trimmed = if stderr_text.len() > 500 {
            format!("{}…", &stderr_text[..500])
        } else {
            stderr_text.clone()
        };
        return ImprovementOutcome {
            success: false,
            summary: if summary.is_empty() {
                "Improvement run produced no summary text.".into()
            } else {
                summary
            },
            files_modified,
            critical_files,
            elapsed_seconds: elapsed,
            error: Some(if trimmed.is_empty() {
                "Run did not finish cleanly".into()
            } else {
                trimmed
            }),
        };
    }

    ImprovementOutcome {
        success: true,
        summary,
        files_modified,
        critical_files,
        elapsed_seconds: elapsed,
        error: None,
    }
}

/// Recovery's `inline_success_hint` is just a guess — we re-derive
/// success purely from the stream file contents (presence of a clean
/// `result` event). Also recompute elapsed from the marker's start.
fn correct_post_mortem_status(
    mut outcome: ImprovementOutcome,
    started_iso: &str,
) -> ImprovementOutcome {
    if let Ok(started) = chrono::DateTime::parse_from_rfc3339(started_iso) {
        let now = chrono::Utc::now();
        let elapsed = now.signed_duration_since(started.with_timezone(&chrono::Utc));
        if elapsed.num_seconds() > 0 {
            outcome.elapsed_seconds = elapsed.num_seconds() as u64;
        }
    }
    outcome
}

fn failure_outcome(error: String, started: std::time::Instant) -> ImprovementOutcome {
    ImprovementOutcome {
        success: false,
        summary: String::new(),
        files_modified: Vec::new(),
        critical_files: Vec::new(),
        elapsed_seconds: started.elapsed().as_secs(),
        error: Some(error),
    }
}

#[cfg(feature = "ml")]
async fn log_outcome_episode(
    user_db: &UserDbPool,
    embedder: Option<&std::sync::Arc<EmbeddingManager>>,
    feedback: &str,
    outcome: &ImprovementOutcome,
) {
    let text = format_episode(feedback, outcome);
    let result = match embedder {
        Some(emb) => {
            episodic::append_episode_and_embed(
                user_db,
                emb,
                DEFAULT_SESSION_ID,
                EpisodeRole::System,
                &text,
            )
            .await
        }
        None => episodic::append_episode(
            user_db,
            DEFAULT_SESSION_ID,
            EpisodeRole::System,
            &text,
        ),
    };
    if let Err(e) = result {
        tracing::warn!(error = %e, "self-improve: failed to log outcome episode");
    }
}

// ── PID liveness ────────────────────────────────────────────────────────

fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        use std::process::Command as StdCommand;
        match StdCommand::new("tasklist")
            .args([
                "/FI",
                &format!("PID eq {pid}"),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
        {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout);
                // tasklist with /NH prints "INFO: No tasks..." to stdout
                // when nothing matches. A live row contains the quoted
                // PID. Match on the PID specifically to be robust.
                s.lines()
                    .any(|l| l.contains(&format!("\"{pid}\"")))
            }
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        use std::process::Command as StdCommand;
        StdCommand::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

// ── helpers ─────────────────────────────────────────────────────────────

const IMPROVE_SYSTEM_PROMPT: &str = "\
You are a coding agent for the Personas desktop app. The user has just
hit friction while using the app and asked for a specific change. Your
job is to implement that change — focused, minimal, and aligned with the
existing patterns in this repo. Work at the repo root.

Discipline:
- Read the relevant file(s) before editing.
- Keep changes scoped to what was asked. No surrounding refactors.
- Follow project conventions in CLAUDE.md if present.
- After changing code, briefly summarize what you did (1–3 sentences).
- If the request is unclear or risky, say so and propose a smaller
  first step rather than guessing.
- Don't run the test suite or rebuild the app — the dev server will
  pick up your changes via hot reload.
";

fn resolve_repo_root() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
}

fn normalize_repo_path(input: &str, repo_root: &PathBuf) -> String {
    let p = std::path::Path::new(input);
    if let Ok(rel) = p.strip_prefix(repo_root) {
        return rel.to_string_lossy().replace('\\', "/");
    }
    input.replace('\\', "/")
}

fn format_episode(feedback: &str, outcome: &ImprovementOutcome) -> String {
    let mut s = String::new();
    s.push_str("[Athena self-improve]\n\n");
    s.push_str("**User asked:** ");
    s.push_str(feedback.trim());
    s.push_str("\n\n");
    s.push_str(&format!(
        "**Outcome:** {} ({}s elapsed)\n\n",
        if outcome.success { "success" } else { "failed" },
        outcome.elapsed_seconds
    ));
    if let Some(err) = &outcome.error {
        s.push_str(&format!("**Error:** {err}\n\n"));
    }
    if !outcome.summary.is_empty() {
        s.push_str("**Summary:**\n");
        s.push_str(outcome.summary.trim());
        s.push_str("\n\n");
    }
    if !outcome.files_modified.is_empty() {
        s.push_str(&format!(
            "**Files modified ({})**\n",
            outcome.files_modified.len()
        ));
        for f in &outcome.files_modified {
            s.push_str(&format!("- `{f}`\n"));
        }
        s.push('\n');
    }
    if !outcome.critical_files.is_empty() {
        s.push_str(&format!(
            "⚠️ **Critical files touched ({}):**\n",
            outcome.critical_files.len()
        ));
        for f in &outcome.critical_files {
            s.push_str(&format!("- `{f}`\n"));
        }
        s.push('\n');
    }
    s
}

fn short_random() -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(10)
        .collect()
}
