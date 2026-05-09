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

/// Tauri event channel for approval-card creation (Phase 3). Fires once
/// per turn that produced any new approvals.
pub const APPROVALS_EVENT: &str = "companion://approvals";

/// Tauri event channel for direct sidebar navigations triggered by
/// Athena's `open_route` op. Fires once per navigation. Frontend
/// listens and calls `setSidebarSection(route)` without collapsing
/// the chat panel — chat-driven nav is meant to feel transparent.
pub const NAVIGATE_EVENT: &str = "companion://navigate";

/// Tauri event for "open this persona's lab tab and select mode X" —
/// Athena's `open_lab` op. Payload: `{ personaId, mode }`. Bypasses
/// approval like NAVIGATE_EVENT; the persona editor reads this and
/// jumps the user there.
pub const OPEN_LAB_EVENT: &str = "companion://open-lab";

/// Tauri event for `compose_dashboard` auto-fire. Payload is empty —
/// the spec is already persisted server-side; the frontend just needs
/// to navigate to the Companion → Dashboard tab so the user sees it.
pub const COMPOSE_DASHBOARD_EVENT: &str = "companion://compose-dashboard";

/// What `send_turn` returns to the chat command. The IDs let the UI
/// reconcile the optimistic bubble with persisted episodes; the
/// `quick_replies` carry Athena's QR offerings for this specific turn
/// (transient — UI shows them on the latest assistant bubble until the
/// next send fires); `tts_text` carries her spoken-version line if she
/// emitted one (frontend feeds this into ElevenLabs playback).
#[derive(Debug, Clone)]
pub struct TurnResult {
    pub user_episode_id: String,
    pub assistant_episode_id: String,
    pub quick_replies: Vec<String>,
    pub tts_text: Option<String>,
}

/// Hard ceiling per turn — Athena is designed to run long background
/// tasks (codebase scans, idea generation, multi-step reasoning).
/// 15 minutes is enough for the longest realistic flow without
/// holding a stuck CLI forever. Mirrors the frontend's
/// `COMPANION_TURN_TIMEOUT_MS`; if you change one, change the other.
const TURN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

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
    voice_enabled: bool,
) -> Result<TurnResult, AppError> {
    let session_id = DEFAULT_SESSION_ID.to_string();
    let turn_id = format!("turn_{}", short_random());

    // Sweep any orphaned self-improve runs so their outcome shows up in
    // this turn's transcript (the detached CLI may have finished after
    // the previous parent-restart). Best-effort: a failure here doesn't
    // block the chat turn.
    #[cfg(feature = "ml")]
    {
        let _ =
            crate::companion::dev_session::recover_orphan_improvements(&user_db, embedder.as_ref())
                .await;
    }
    #[cfg(not(feature = "ml"))]
    {
        let _ = crate::companion::dev_session::recover_orphan_improvements(&user_db).await;
    }

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

    // Recall synthesis is OFF by default; the parameter exists so the
    // backend is ready when a UI surface lights up the toggle. To opt in
    // for testing today, hardcode `true` here and rebuild — synthesis
    // fires only on dense recall (above SYNTHESIS_TOKEN_THRESHOLD), so
    // the typical small-recall turn still goes raw at no extra cost.
    // TODO(recall-synthesis-ui): wire this through `companion_send_message`
    // IPC alongside `voice_enabled` once a settings toggle ships.
    let recall_synthesis_enabled = false;

    let system_prompt = {
        #[cfg(feature = "ml")]
        {
            prompt::build_system_prompt(
                &user_db,
                &sys_db,
                embedder.as_ref(),
                &session_id,
                &user_message,
                voice_enabled,
                recall_synthesis_enabled,
            )
            .await?
        }
        #[cfg(not(feature = "ml"))]
        {
            prompt::build_system_prompt(
                &user_db,
                &sys_db,
                &session_id,
                &user_message,
                voice_enabled,
                recall_synthesis_enabled,
            )
            .await?
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
                    app,
                    &turn_id,
                    &session_id,
                    None,
                    &system_prompt,
                    &user_message,
                    &user_db,
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

    // Phase 3: extract any `{"op":...}` proposals from Athena's reply,
    // persist them as approval rows, and strip them from the displayed
    // text. The episode stores the cleaned text — what the user sees in
    // the chat — so future turns' transcript is clean too.
    let dispatched =
        match crate::companion::dispatcher::dispatch(&user_db, &session_id, &assistant_text) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "companion dispatcher failed; using raw text");
                crate::companion::dispatcher::Dispatched {
                    cleaned_text: assistant_text.clone(),
                    approvals: Vec::new(),
                    navigations: Vec::new(),
                    lab_opens: Vec::new(),
                    dashboards: Vec::new(),
                    quick_replies: Vec::new(),
                    tts_text: None,
                    warnings: vec![format!("dispatcher error: {e}")],
                }
            }
        };
    let display_text = if dispatched.cleaned_text.trim().is_empty() {
        // The whole reply was ops with no prose. Don't render an empty
        // bubble — replace with a tiny placeholder.
        "(proposing actions — see cards below)".to_string()
    } else {
        dispatched.cleaned_text.clone()
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
                        &display_text,
                    )
                    .await?
                }
                None => episodic::append_episode(
                    &user_db,
                    &session_id,
                    EpisodeRole::Assistant,
                    &display_text,
                )?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(&user_db, &session_id, EpisodeRole::Assistant, &display_text)?
        }
    };

    if !dispatched.approvals.is_empty() {
        if let Err(e) = app.emit(APPROVALS_EVENT, &dispatched.approvals) {
            tracing::warn!(error = %e, "companion approvals event emit failed");
        }
    }

    // Fire navigation events for any open_route ops Athena emitted.
    // The frontend handles them inline (sidebar switch, panel stays
    // open). One event per navigation in case Athena ever chains them
    // (rare, but supported).
    for route in &dispatched.navigations {
        if let Err(e) = app.emit(NAVIGATE_EVENT, route) {
            tracing::warn!(error = %e, route = %route, "companion navigate event emit failed");
        }
    }

    // Phase F: open_lab ops — fire one event per (persona_id, mode).
    // The persona editor listens and switches tabs without nagging the
    // user with an approval card, same UX as open_route.
    for (persona_id, mode) in &dispatched.lab_opens {
        let payload = serde_json::json!({
            "personaId": persona_id,
            "mode": mode,
        });
        if let Err(e) = app.emit(OPEN_LAB_EVENT, payload) {
            tracing::warn!(error = %e, "companion open_lab event emit failed");
        }
    }

    // Phase F: compose_dashboard auto-fire. Persist each spec, then
    // emit a compose-dashboard event so the frontend navigates the
    // user straight to the Dashboard tab. If multiple specs landed in
    // one turn (rare — Athena should pick the latest), we save and
    // emit for each, but the singleton write naturally collapses.
    for spec_json in &dispatched.dashboards {
        if let Err(e) = crate::companion::brain::dashboard::save_dashboard(&user_db, spec_json) {
            tracing::warn!(error = %e, "companion compose_dashboard save failed");
            continue;
        }
        if let Err(e) = app.emit(COMPOSE_DASHBOARD_EVENT, serde_json::json!({})) {
            tracing::warn!(error = %e, "companion compose_dashboard event emit failed");
        }
    }

    emit(
        app,
        StreamEvent {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            kind: StreamEventKind::Finished,
            payload: assistant_ep_id.clone(),
        },
    );

    Ok(TurnResult {
        user_episode_id: user_ep_id,
        assistant_episode_id: assistant_ep_id,
        quick_replies: dispatched.quick_replies,
        tts_text: dispatched.tts_text,
    })
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
    msg.contains("no conversation found")
        || msg.contains("session id")
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

/// Wipe the conversation transcript so Athena starts fresh.
///
/// Scope (deliberate):
///   - SQL: deletes episode rows from `companion_node`, plus their
///     companion_fts and companion_embedding entries. **Doctrine, identity,
///     and any other node kinds are preserved** — earlier versions of this
///     function blindly truncated all FTS / vec0 rows, which silently
///     wiped doctrine and forced a full re-ingest on the next start.
///   - Disk: renames `<brain>/episodes/` to `<brain>/episodes-archive-<ts>/`
///     so the markdown source-of-truth isn't actually destroyed (no-data-
///     loss principle), but the next turn sees an empty episodes dir.
///     A fresh empty `episodes/` is recreated.
///   - Identity, constitution, doctrine, semantic facts: untouched.
pub fn wipe_transcript(pool: &UserDbPool) -> Result<(), AppError> {
    let conn = pool.get()?;

    // Collect episode IDs first; we need them for the FTS + vec0 deletes
    // before we drop the parent node rows.
    let episode_ids: Vec<String> =
        match conn.prepare("SELECT id FROM companion_node WHERE kind = 'episode'") {
            Ok(mut stmt) => stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };

    if !episode_ids.is_empty() {
        let placeholders = episode_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let p: Vec<&dyn rusqlite::ToSql> = episode_ids
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();

        let _ = conn.execute(
            &format!("DELETE FROM companion_fts WHERE node_id IN ({placeholders})"),
            p.as_slice(),
        );
        // vec0 table is created lazily; this is best-effort.
        let _ = conn.execute(
            &format!("DELETE FROM companion_embedding WHERE node_id IN ({placeholders})"),
            p.as_slice(),
        );
        let _ = conn.execute(
            &format!("DELETE FROM companion_node WHERE id IN ({placeholders})"),
            p.as_slice(),
        );
    }

    // Archive the on-disk episodes folder. Failure here is non-fatal —
    // SQL has already been wiped, which is what the UI binds to.
    if let Ok(root) = crate::companion::disk::brain_root() {
        let episodes = root.join("episodes");
        if episodes.exists() {
            let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
            let archived = root.join(format!("episodes-archive-{stamp}"));
            if std::fs::rename(&episodes, &archived).is_ok() {
                let _ = std::fs::create_dir_all(&episodes);
                tracing::info!(archive = %archived.display(), "companion: wiped episodes — old set archived");
            }
        }
    }

    Ok(())
}

fn write_temp_prompt(content: &str) -> Result<std::path::PathBuf, AppError> {
    let path = std::env::temp_dir().join(format!("athena-prompt-{}.md", short_random()));
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("write prompt file: {e}")))?;
    Ok(path)
}

/// Resolve the platform-correct invocation for the Claude CLI.
/// On Windows we go via `cmd.exe /C claude.cmd` because the CLI is a
/// .cmd shim and a direct spawn doesn't see PATH the way the shell does.
/// On Unix the binary itself is on PATH.
///
/// Public so the consolidation + reflection one-shots can reuse the
/// same invocation pattern instead of duplicating the platform check.
pub fn base_cli_invocation() -> (String, Vec<String>) {
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
