//! CLI session orchestration for Athena.
//!
//! Each turn: spawn `claude --print --output-format stream-json` (with
//! `--resume <id>` if we already have one), pipe the user message into
//! stdin, parse stream-json lines from stdout, emit them as Tauri events
//! for the panel UI, accumulate the assistant's final text, persist the
//! turn as episodes, and update the persistent claude_session_id pointer.
//!
//! Phase 1: minimal viable loop. Approval cards / op dispatch / dev
//! feedback land in later phases. The companion_session row holds a single
//! `id='default'` pointer; multi-companion support is deferred.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::prompt;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// The single-instance companion session id (Phase 1).
pub const DEFAULT_SESSION_ID: &str = "default";

/// Tauri event channel that streams every CLI line to the frontend.
pub const STREAM_EVENT: &str = "companion://stream";

/// Hard ceiling per turn — Opus is slow but should never sit forever.
const TURN_TIMEOUT: Duration = Duration::from_secs(300);

/// One streamed event sent to the frontend. The JSON `payload` is the raw
/// stream-json line so the UI can render thinking/tool-use/text indicators
/// as they arrive without a server-side state machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub session_id: String,
    pub turn_id: String,
    pub kind: StreamEventKind,
    /// Raw stream-json line for `kind=Cli`, free-form text otherwise.
    pub payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamEventKind {
    /// Spawn started, persisted user episode id is in payload.
    Started,
    /// One stream-json line from the CLI.
    Cli,
    /// Final assistant episode persisted, payload is the assistant episode id.
    Finished,
    /// Anything that prevented finishing.
    Error,
}

/// Run one full turn: persist the user message, call Claude, stream events,
/// persist the assistant reply. Returns (user_episode_id, assistant_episode_id).
///
/// Streams progress via Tauri events on `STREAM_EVENT` so the UI updates
/// incrementally. The final returned ids let the caller link UI state to
/// persisted episodes.
pub async fn send_turn(
    app: &AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    user_message: String,
) -> Result<(String, String), AppError> {
    let session_id = DEFAULT_SESSION_ID.to_string();
    let turn_id = format!("turn_{}", short_random());

    // Persist the user turn (with embedding if embedder is available).
    let user_ep_id = {
        #[cfg(feature = "ml")]
        {
            match &embedder {
                Some(emb) => {
                    episodic::append_episode_and_embed(
                        &user_db,
                        emb,
                        &session_id,
                        EpisodeRole::User,
                        &user_message,
                    )
                    .await?
                }
                None => episodic::append_episode(
                    &user_db,
                    &session_id,
                    EpisodeRole::User,
                    &user_message,
                )?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(&user_db, &session_id, EpisodeRole::User, &user_message)?
        }
    };

    emit(
        app,
        StreamEvent {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            kind: StreamEventKind::Started,
            payload: user_ep_id.clone(),
        },
    );

    // Read the prior claude session id (if any) for --resume.
    let claude_session_id = read_claude_session_id(&user_db, &session_id)?;

    let system_prompt = {
        #[cfg(feature = "ml")]
        {
            prompt::build_system_prompt(
                &user_db,
                &sys_db,
                embedder.as_ref(),
                &session_id,
                &user_message,
            )
            .await?
        }
        #[cfg(not(feature = "ml"))]
        {
            prompt::build_system_prompt(&user_db, &sys_db, &session_id, &user_message).await?
        }
    };

    let assistant_text = match timeout(
        TURN_TIMEOUT,
        run_cli(
            app,
            &turn_id,
            &session_id,
            claude_session_id.as_deref(),
            &system_prompt,
            &user_message,
            &user_db,
        ),
    )
    .await
    {
        Ok(Ok(text)) => text,
        // Self-heal: if Claude can't find the resumed session id (deleted,
        // expired, or never existed), clear the stale pointer and retry
        // once with a fresh session. Every prior episode is still in the
        // system prompt via retrieval, so context isn't lost — only the
        // CLI's internal session continuity is.
        Ok(Err(e)) if is_stale_session_error(&e) && claude_session_id.is_some() => {
            tracing::warn!(
                stale_id = ?claude_session_id,
                "companion: --resume failed (stale session), retrying with fresh CLI session"
            );
            clear_claude_session_id(&user_db, &session_id)?;
            match timeout(
                TURN_TIMEOUT,
                run_cli(
                    app, &turn_id, &session_id, None, &system_prompt, &user_message, &user_db,
                ),
            )
            .await
            {
                Ok(Ok(text)) => text,
                Ok(Err(e2)) => {
                    emit_error(app, &session_id, &turn_id, &e2.to_string());
                    return Err(e2);
                }
                Err(_) => {
                    let msg = "Turn exceeded 5-minute timeout (after session reset)";
                    emit_error(app, &session_id, &turn_id, msg);
                    return Err(AppError::Internal(msg.into()));
                }
            }
        }
        Ok(Err(e)) => {
            emit_error(app, &session_id, &turn_id, &e.to_string());
            return Err(e);
        }
        Err(_) => {
            let msg = "Turn exceeded 5-minute timeout";
            emit_error(app, &session_id, &turn_id, msg);
            return Err(AppError::Internal(msg.into()));
        }
    };

    let assistant_ep_id = {
        #[cfg(feature = "ml")]
        {
            match &embedder {
                Some(emb) => {
                    episodic::append_episode_and_embed(
                        &user_db,
                        emb,
                        &session_id,
                        EpisodeRole::Assistant,
                        &assistant_text,
                    )
                    .await?
                }
                None => episodic::append_episode(
                    &user_db,
                    &session_id,
                    EpisodeRole::Assistant,
                    &assistant_text,
                )?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(
                &user_db,
                &session_id,
                EpisodeRole::Assistant,
                &assistant_text,
            )?
        }
    };

    emit(
        app,
        StreamEvent {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            kind: StreamEventKind::Finished,
            payload: assistant_ep_id.clone(),
        },
    );

    Ok((user_ep_id, assistant_ep_id))
}

async fn run_cli(
    app: &AppHandle,
    turn_id: &str,
    session_id: &str,
    claude_session_id: Option<&str>,
    system_prompt: &str,
    user_message: &str,
    pool: &UserDbPool,
) -> Result<String, AppError> {
    let (cmd_program, mut argv) = base_cli_invocation();

    // Resume if we have a session id, otherwise fresh.
    if let Some(sid) = claude_session_id {
        argv.extend(["--resume".into(), sid.into()]);
    }

    // Write the system prompt to a temp file. Inline `--system-prompt`
    // works on small prompts but breaks at the OS arg-length limit
    // (Windows ~32k); the prompt grows fast once retrieval kicks in.
    // The file is removed after the CLI exits.
    let prompt_file = write_temp_prompt(system_prompt)?;

    // --system-prompt-file fully replaces Claude Code's default identity
    // prompt. We avoid `--bare` because it disables OAuth/keychain auth
    // and would force the user to set ANTHROPIC_API_KEY explicitly.
    // Default Claude Code framework loads, but our prompt dominates.
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        "claude-opus-4-7".into(),
        "--system-prompt-file".into(),
        prompt_file.to_string_lossy().to_string(),
    ]);

    // Spawn from the user's home directory (or a benign fallback) so we
    // don't auto-pick up the Personas project's CLAUDE.md as context.
    let cwd = dirs::home_dir().unwrap_or_else(|| std::env::temp_dir());

    let mut child = Command::new(&cmd_program)
        .args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .env("CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "1")
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude: {e}")))?;

    // Pipe the user message in via stdin.
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(user_message.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write claude stdin: {e}")))?;
        // Closing stdin signals end-of-prompt.
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("claude stdout missing".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    // Drain stderr concurrently into a buffer so we can include it in
    // any failure message. Without this, exit-1 produces a useless
    // "claude exited with status 1" with no diagnostic context.
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("claude stderr missing".into()))?;
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

    let mut assistant_text = String::new();
    let mut new_claude_session_id: Option<String> = None;

    while let Some(line) = reader
        .next_line()
        .await
        .map_err(|e| AppError::Internal(format!("read claude stdout: {e}")))?
    {
        // Forward every line to the UI as-is.
        emit(
            app,
            StreamEvent {
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                kind: StreamEventKind::Cli,
                payload: line.clone(),
            },
        );

        // Accumulate text + capture session id from parsable JSON.
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            // The "system" init event carries session_id (Claude Code stream-json schema).
            if value.get("type").and_then(|v| v.as_str()) == Some("system") {
                if let Some(sid) = value.get("session_id").and_then(|v| v.as_str()) {
                    new_claude_session_id = Some(sid.to_string());
                }
            }
            // Assistant content blocks: extract any text.
            if value.get("type").and_then(|v| v.as_str()) == Some("assistant") {
                if let Some(content) = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for block in content {
                        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                if !assistant_text.is_empty() {
                                    assistant_text.push('\n');
                                }
                                assistant_text.push_str(text);
                            }
                        }
                    }
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("wait claude: {e}")))?;
    let _ = stderr_handle.await;
    let stderr_text = stderr_buf.lock().await.clone();
    // Best-effort: clean up the temp prompt file. Failure is harmless.
    let _ = std::fs::remove_file(&prompt_file);
    if !status.success() {
        let trimmed = if stderr_text.len() > 600 {
            format!("{}…", &stderr_text[..600])
        } else {
            stderr_text.clone()
        };
        return Err(AppError::Internal(format!(
            "claude exited with status {status}: {trimmed}"
        )));
    }

    // Persist the (possibly new) claude session id for next turn's --resume.
    if let Some(sid) = new_claude_session_id {
        upsert_claude_session_id(pool, session_id, &sid)?;
    }

    if assistant_text.is_empty() {
        return Err(AppError::Internal(
            "claude produced no assistant text".into(),
        ));
    }

    Ok(assistant_text)
}

/// Was this CLI failure caused by an expired/missing --resume session id?
/// We match liberally on the known message patterns the CLI emits so this
/// keeps working across CLI version drift.
fn is_stale_session_error(e: &AppError) -> bool {
    let msg = e.to_string().to_lowercase();
    msg.contains("no conversation found") || msg.contains("session id")
        && (msg.contains("not found") || msg.contains("does not exist"))
}

/// Clear the persisted claude_session_id so the next turn starts a fresh
/// CLI session. The episodic transcript is untouched — every prior turn is
/// still on disk and re-enters the prompt via retrieval.
pub fn clear_claude_session_id(pool: &UserDbPool, session_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_session SET claude_session_id = NULL, last_active_at = datetime('now') WHERE id = ?1",
        params![session_id],
    )?;
    Ok(())
}

/// Wipe the conversation transcript: clear `companion_node` (episode rows),
/// the FTS index, and the vec0 index. The markdown source-of-truth on disk
/// is preserved by design — episodic is append-only and recoverable. After
/// wipe, the next turn sees an empty transcript but identity + observability
/// still apply.
pub fn wipe_transcript(pool: &UserDbPool) -> Result<(), AppError> {
    let conn = pool.get()?;
    // Order matters: clear FTS first to avoid leaving orphan rows.
    let _ = conn.execute_batch(
        "DELETE FROM companion_fts;
         DELETE FROM companion_node WHERE kind = 'episode';",
    );
    // Best-effort vec0 wipe — table is created lazily so may not exist yet.
    let _ = conn.execute_batch("DELETE FROM companion_embedding");
    Ok(())
}

fn write_temp_prompt(content: &str) -> Result<std::path::PathBuf, AppError> {
    let path = std::env::temp_dir().join(format!("athena-prompt-{}.md", short_random()));
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("write prompt file: {e}")))?;
    Ok(path)
}

fn base_cli_invocation() -> (String, Vec<String>) {
    if cfg!(windows) {
        ("cmd".into(), vec!["/C".into(), "claude.cmd".into()])
    } else {
        ("claude".into(), vec![])
    }
}

fn read_claude_session_id(pool: &UserDbPool, session_id: &str) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let val = conn
        .query_row(
            "SELECT claude_session_id FROM companion_session WHERE id = ?1",
            params![session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    Ok(val.flatten())
}

fn upsert_claude_session_id(
    pool: &UserDbPool,
    session_id: &str,
    claude_session_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_session (id, claude_session_id, last_active_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           claude_session_id = excluded.claude_session_id,
           last_active_at    = datetime('now')",
        params![session_id, claude_session_id],
    )?;
    Ok(())
}

fn emit(app: &AppHandle, ev: StreamEvent) {
    if let Err(e) = app.emit(STREAM_EVENT, &ev) {
        tracing::warn!(error = %e, "companion stream emit failed");
    }
}

fn emit_error(app: &AppHandle, session_id: &str, turn_id: &str, msg: &str) {
    emit(
        app,
        StreamEvent {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            kind: StreamEventKind::Error,
            payload: msg.to_string(),
        },
    );
}

fn short_random() -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}
