//! Spawning the Claude CLI and reading its stream-json back: the process
//! invocation, the stdout loop, and the small helpers that shape the command.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::events::{emit, StreamEvent, StreamEventKind};
use super::interrupts::{clear_interrupt, was_interrupted};
use super::model::{
    companion_effort_override, companion_turn_model, BUILD_TURN_EFFORT, COMPANION_TURN_MODEL,
};
use super::stream::{persist_stream_progress, CliRunOutput};
use super::transcript::upsert_claude_session_id;
use crate::companion::turn_ledger::CliUsage;
use crate::db::UserDbPool;
use crate::error::AppError;

// `too_many_arguments`: this signature is wide and stays wide for now. The
// workspace already carries 159 site-level allows on functions of the same
// shape; these were simply the ones that never got one. Converting them to a
// parameter struct is a later wave's job, and the attribute is the marker
// that says so.
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_cli(
    app: &AppHandle,
    turn_id: &str,
    session_id: &str,
    claude_session_id: Option<&str>,
    system_prompt: &str,
    user_message: &str,
    pool: &UserDbPool,
    browser_tools: bool,
    // Working directory for the spawned CLI. `None` = the user's home dir (the
    // default — so a normal Athena turn doesn't auto-pick up the Personas
    // project's CLAUDE.md). `Some(path)` roots the turn in a project directory
    // (web-build build sessions — P2 of the web-dev companion).
    cwd_override: Option<&std::path::Path>,
    // Reasoning effort for build turns (cwd_override present). `None` → the
    // default `BUILD_TURN_EFFORT`. Ignored for non-build (companion-chat) turns.
    build_effort: Option<&str>,
    // Per-project MCP connectors to load on a build turn (C8). Empty = none.
    mcp: &[String],
    // Continuous informing (Variant B). When true, each `PROGRESS:` beat and
    // each confirmed-non-final prose segment is persisted as its own assistant
    // episode the instant it streams in — at its REAL emission time — instead
    // of being buffered for one end-of-turn flush (which stamped every beat /
    // segment within the same millisecond → the "long-pause-then-big-bang"). The
    // LAST prose segment is left un-persisted and returned so `send_turn` can
    // store it as the considered final reply. False for build turns and
    // fleet-orchestration (suppress_chat), which keep the prior behavior.
    persist_progress: bool,
    // Mirror of the terminal `result` usage, visible to the CALLER even when
    // this function returns `Err` or its future is dropped by the turn timeout
    // — both of which discard the local `result_usage` below. That is what
    // keeps cost capture best-effort on the failure path rather than
    // all-or-nothing. `None` for build turns, which have no ledger row.
    usage_sink: Option<&std::sync::Mutex<Option<CliUsage>>>,
) -> Result<CliRunOutput, AppError> {
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

    // Bench seam (B0.2, docs/plans/athena-live-conversation-layer.md):
    // PERSONAS_DUMP_PROMPT=1 snapshots the fully-composed system prompt +
    // user message per turn under ~/.personas/debug/prompts/ so the model
    // bench replays REAL prompts. Best-effort; never blocks the turn.
    if std::env::var("PERSONAS_DUMP_PROMPT").is_ok_and(|v| v == "1") {
        dump_prompt_snapshot(turn_id, session_id, system_prompt, user_message);
    }

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
        // Token-level streaming. With this flag the CLI additionally emits
        // `{"type":"stream_event", ...}` lines carrying `content_block_delta`
        // / `text_delta` chunks *before* the final whole `assistant` message.
        // The frontend renders those deltas live so Athena's reply flows in
        // token-by-token instead of appearing in whole-message jumps. Purely
        // additive on this side: the loop below already forwards every line
        // verbatim as a `Cli` event, and the final `assistant` message still
        // arrives unchanged to drive `assistant_text` accumulation /
        // persistence. Harmless on older CLIs that don't recognize the flag's
        // event type — they simply emit no `stream_event` lines.
        "--include-partial-messages".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        // Chat turns honor the bench/routing override seam; build turns stay
        // pinned to the canonical model regardless of env.
        if cwd_override.is_none() {
            companion_turn_model()
        } else {
            COMPANION_TURN_MODEL.to_string()
        },
        "--system-prompt-file".into(),
        prompt_file.to_string_lossy().to_string(),
    ]);

    // Build-session turns prioritise quality — pin reasoning effort. User-tunable
    // per turn via the effort knob (C1); defaults to the deepest level. Validated
    // against the known levels so we never inject an arbitrary flag value.
    if cwd_override.is_some() {
        let effort = match build_effort {
            Some(e) if matches!(e, "low" | "medium" | "high" | "xhigh") => e,
            _ => BUILD_TURN_EFFORT,
        };
        argv.push("--effort".into());
        argv.push(effort.into());
    } else if let Some(effort) = companion_effort_override().or_else(|| {
        crate::companion::model_routing::MAIN
            .effort
            .map(String::from)
    }) {
        // Chat turns run on the P4 routing tier's effort (Opus@low — bench:
        // identical accuracy to the default, 16% lower p50 latency);
        // PERSONAS_ATHENA_EFFORT pins a different level for a measured run.
        argv.push("--effort".into());
        argv.push(effort);
    }

    // Browser-test turns: hand this single CLI spawn browser tools via MCP —
    // the browser-bridge endpoint (user's real Chrome through the paired
    // extension) when one is connected, else the bundled Playwright MCP.
    // Continuation/regular turns never get it (startup cost + tool surface
    // stay scoped to the test). The temp config must outlive the child —
    // NamedTempFile deletes on drop.
    let mut _mcp_config_file: Option<tempfile::NamedTempFile> = None;
    if browser_tools {
        match crate::browser_bridge::build_browser_mcp_config() {
            Ok((f, mode)) => {
                tracing::info!(?mode, "browser-test turn: browser MCP config ready");
                argv.push("--mcp-config".into());
                argv.push(f.path().to_string_lossy().to_string());
                _mcp_config_file = Some(f);
            }
            Err(e) => tracing::warn!(
                error = %e,
                "browser-test turn: failed to build browser MCP config; running without browser tools"
            ),
        }
    }

    // Build turns can load per-project MCP connectors the user toggled on (C8).
    let mut _build_mcp_config_file: Option<tempfile::NamedTempFile> = None;
    if cwd_override.is_some() && !mcp.is_empty() {
        if let Some(cfg) = crate::webbuild::mcp::build_config(mcp) {
            if let Ok(mut f) = tempfile::Builder::new().suffix(".json").tempfile() {
                use std::io::Write as _;
                if write!(f, "{cfg}").is_ok() {
                    argv.push("--mcp-config".into());
                    argv.push(f.path().to_string_lossy().to_string());
                    _build_mcp_config_file = Some(f);
                }
            }
        }
    }

    // Spawn from the user's home directory (or a benign fallback) by default so
    // a normal turn doesn't auto-pick up the Personas project's CLAUDE.md. A
    // build session overrides this to root the turn in its project directory.
    let cwd = cwd_override
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(std::env::temp_dir));

    let mut cmd = Command::new(&cmd_program);
    cmd.args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .env("CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "1")
        // Enable fork-style subagent dispatch (2.1.117+) — when Athena
        // uses the Task tool, the child inherits her full conversation
        // history, runs in background, and shares the prompt cache.
        // Cheaper than a named subagent and gives the autonomous loop
        // a way to "send a copy of herself to investigate" without
        // re-priming context. Harmless on older CLI versions (env var
        // is ignored if the feature isn't recognized).
        .env("CLAUDE_CODE_FORK_SUBAGENT", "1");
    // Athena (and every persona execution/evaluation) runs on the Claude
    // monthly subscription — strip any ANTHROPIC_* API-account auth so the CLI
    // uses its OAuth/keychain credentials, never billing the API.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);
    // No console window on Windows — see apply_no_console_window. Without
    // this the GUI app's `cmd /C claude.cmd` child drains the desktop heap
    // and eventually dies on spawn with 0xC0000142.
    apply_no_console_window(&mut cmd);
    // H11 — tie the CLI's lifetime to this future. On the backend
    // TURN_TIMEOUT (or any future-drop/cancellation), dropping `run_cli`
    // drops `child`; without kill_on_drop tokio DETACHES it and claude keeps
    // running unattended (a real zombie seen live on build turns). Originally
    // scoped to build turns; multiconv P1 extends it to chat turns too — with
    // concurrent per-conversation turns, a dropped chat-turn future orphaning
    // its claude child is no longer a tolerable edge.
    cmd.kill_on_drop(true);
    let mut child = cmd
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
    // Per-assistant-message text, in emission order (Phase B interim segments).
    let mut segments: Vec<String> = Vec::new();
    // Continuous informing: the most recent non-empty cleaned prose segment
    // that hasn't been confirmed non-final yet. Flushed as an interim episode
    // the moment a LATER prose segment arrives; whatever remains here at EOF is
    // the final reply (persisted by `send_turn`), so it's never flushed here.
    // Only used when `persist_progress` is set.
    let mut pending_interim: Option<String> = None;
    let mut new_claude_session_id: Option<String> = None;
    // The CLI's terminal `result` event carries this turn's real cost / token
    // usage / duration; captured here for the companion_turn ledger.
    let mut result_usage: Option<crate::companion::turn_ledger::CliUsage> = None;
    let mut interrupt_tick = tokio::time::interval(Duration::from_millis(200));
    // Skip the immediate first tick — `interval` fires once at t=0 by
    // default, which would race the kill check before we've read a
    // single line.
    interrupt_tick.tick().await;
    let mut interrupted = false;
    // Mid-stream read failure preserved here so the loop can break and
    // the partial-reply tail handling below can tag whatever we
    // accumulated rather than losing the work to a hard error return.
    let mut stdout_read_error: Option<String> = None;

    loop {
        tokio::select! {
            // Favor stdout reads over the interrupt tick — we never want
            // to miss a line just because the timer happened to fire on
            // the same loop iteration.
            biased;
            line_result = reader.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        emit(
                            app,
                            StreamEvent {
                                session_id: session_id.to_string(),
                                turn_id: turn_id.to_string(),
                                kind: StreamEventKind::Cli,
                                payload: line.clone(),
                            },
                        );

                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                            if value.get("type").and_then(|v| v.as_str()) == Some("system") {
                                if let Some(sid) = value.get("session_id").and_then(|v| v.as_str()) {
                                    new_claude_session_id = Some(sid.to_string());
                                }
                            }
                            if value.get("type").and_then(|v| v.as_str()) == Some("assistant") {
                                if let Some(content) = value
                                    .get("message")
                                    .and_then(|m| m.get("content"))
                                    .and_then(|c| c.as_array())
                                {
                                    // Collect THIS message's text blocks into one
                                    // segment, then fold into the running full text.
                                    let mut msg_text = String::new();
                                    for block in content {
                                        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                                if !msg_text.is_empty() {
                                                    msg_text.push('\n');
                                                }
                                                msg_text.push_str(text);
                                            }
                                        }
                                    }
                                    if !msg_text.is_empty() {
                                        if !assistant_text.is_empty() {
                                            assistant_text.push('\n');
                                        }
                                        assistant_text.push_str(&msg_text);

                                        // Continuous informing (Variant B): flush
                                        // this step's progress + prior prose NOW,
                                        // at their real emission time, rather than
                                        // batching every beat/segment at turn-end.
                                        if persist_progress {
                                            persist_stream_progress(
                                                pool,
                                                session_id,
                                                &msg_text,
                                                &mut pending_interim,
                                            );
                                        }

                                        segments.push(msg_text);
                                    }
                                }
                            }
                            if let Some(u) =
                                crate::companion::turn_ledger::CliUsage::from_result_event(&value)
                            {
                                // Publish before storing locally: if this turn
                                // goes on to fail (or the timeout drops this
                                // whole future), the sink is the only copy the
                                // caller will still have.
                                if let Some(sink) = usage_sink {
                                    if let Ok(mut g) = sink.lock() {
                                        *g = Some(u.clone());
                                    }
                                }
                                result_usage = Some(u);
                            }
                        }
                    }
                    Ok(None) => break, // EOF — CLI finished naturally
                    Err(e) => {
                        // Don't hard-error and lose accumulated text.
                        // Record the failure, break, and let the
                        // partial-reply tail tag it for the user.
                        stdout_read_error = Some(format!("read claude stdout: {e}"));
                        break;
                    }
                }
            }
            _ = interrupt_tick.tick() => {
                if was_interrupted(turn_id) {
                    interrupted = true;
                    // Best-effort kill — if it fails the CLI will still
                    // finish on its own; we just stop reading.
                    let _ = child.start_kill();
                    break;
                }
            }
        }
    }

    // Clear the registry entry whether we hit it or not so a future
    // turn with a coincidentally-similar id isn't pre-cancelled.
    clear_interrupt(turn_id);

    if interrupted {
        // Drain whatever's still queued so the child can exit cleanly
        // and we don't leak a zombie. Don't surface read errors here —
        // a killed child often EOFs partway through a frame.
        while let Ok(Some(_)) = reader.next_line().await {}
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("wait claude: {e}")))?;
    let _ = stderr_handle.await;
    let stderr_text = stderr_buf.lock().await.clone();
    // Best-effort: clean up the temp prompt file. Failure is harmless.
    let _ = std::fs::remove_file(&prompt_file);

    // Interrupt path: the user clicked Stop. We killed the child, so a
    // non-success exit is expected. Persist whatever streamed (or a
    // placeholder if nothing did) and tag it so the transcript shows
    // the partial nature. The CLI session pointer is also persisted —
    // an interrupted turn still counts toward conversation continuity.
    if interrupted {
        if let Some(sid) = new_claude_session_id {
            upsert_claude_session_id(pool, session_id, &sid)?;
        }
        let body = if assistant_text.trim().is_empty() {
            "_(interrupted before any reply was generated)_".to_string()
        } else {
            format!("{assistant_text}\n\n_[interrupted by user]_")
        };
        return Ok((body, Vec::new(), result_usage.take()));
    }

    // Stdout-mid-stream failure path: the CLI was producing output and
    // then the pipe broke (process crashed, signal, OOM, etc.). We
    // already accumulated some text — preserve it rather than dropping
    // the whole turn. Tag with the underlying error so the user sees
    // what went wrong without losing the partial reply.
    if let Some(err_msg) = stdout_read_error {
        if let Some(sid) = new_claude_session_id {
            upsert_claude_session_id(pool, session_id, &sid)?;
        }
        let body = if assistant_text.trim().is_empty() {
            format!("_(stream ended before any reply: {err_msg})_")
        } else {
            format!("{assistant_text}\n\n_[interrupted by error: {err_msg}]_")
        };
        // Salvaging a partial reply keeps the turn useful, but it did NOT
        // complete cleanly — flag it even though the CLI died before it could
        // emit a `result` event saying so. Otherwise a broken pipe is
        // indistinguishable from success in the ledger.
        let mut usage = result_usage.take().unwrap_or_default();
        usage.is_error = true;
        return Ok((body, Vec::new(), Some(usage)));
    }

    if !status.success() {
        // The copy of this error that reaches the frontend/log is path-redacted
        // by `sanitize_error_message`, which hides the real failing command —
        // e.g. a Windows build-turn "'<path>' is not recognized" cmd.exe error
        // whose path is exactly what you need to fix it. Rust tracing is not
        // redacted, so log the RAW stderr here (build-turn spawn observability).
        tracing::warn!(
            target: "webbuild_cli",
            exit = %status,
            cwd = %cwd.display(),
            is_build = cwd_override.is_some(),
            stderr_raw = %stderr_text,
            "CLI turn exited non-zero"
        );
        let trimmed = if stderr_text.len() > 600 {
            format!(
                "{}…",
                crate::utils::text::truncate_on_char_boundary(&stderr_text, 600)
            )
        } else {
            stderr_text.clone()
        };
        // Non-zero exit AFTER partial text streamed: preserve the
        // partial — same logic as stdout_read_error above. The stderr
        // tail goes into the tag so the user (and Athena, next turn)
        // sees the diagnostic context.
        if !assistant_text.trim().is_empty() {
            if let Some(sid) = new_claude_session_id {
                upsert_claude_session_id(pool, session_id, &sid)?;
            }
            let body = format!(
                "{assistant_text}\n\n_[interrupted by error: claude exited with status {status}{}]_",
                if trimmed.is_empty() { String::new() } else { format!(": {trimmed}") }
            );
            // Same as the broken-pipe case: a non-zero exit is a failed turn
            // even when we kept the partial text the user can still read.
            let mut usage = result_usage.take().unwrap_or_default();
            usage.is_error = true;
            return Ok((body, Vec::new(), Some(usage)));
        }
        // No partial — fall through to hard error as before.
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

    Ok((assistant_text, segments, result_usage))
}

/// Was this CLI failure caused by an expired/missing --resume session id?
/// We match liberally on the known message patterns the CLI emits so this
/// keeps working across CLI version drift.
pub(super) fn is_stale_session_error(e: &AppError) -> bool {
    let msg = e.to_string().to_lowercase();
    msg.contains("no conversation found")
        || msg.contains("session id")
            && (msg.contains("not found") || msg.contains("does not exist"))
}

fn write_temp_prompt(content: &str) -> Result<std::path::PathBuf, AppError> {
    let path = std::env::temp_dir().join(format!(
        "athena-prompt-{}.md",
        crate::companion::util::short_id(12)
    ));
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("write prompt file: {e}")))?;
    Ok(path)
}

/// Bench seam (B0.2): persist one turn's fully-composed system prompt + user
/// message under `~/.personas/debug/prompts/` for the model bench to replay.
/// The `---USER-MESSAGE---` divider is the harness's parse contract
/// (`scripts/test/athena-model-bench.mjs`). Best-effort: any failure is
/// tracing-only and never blocks the turn.
fn dump_prompt_snapshot(turn_id: &str, session_id: &str, system_prompt: &str, user_message: &str) {
    let Some(home) = dirs::home_dir() else { return };
    let dir = home.join(".personas").join("debug").join("prompts");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        tracing::warn!(error = %e, "prompt dump: create dir failed");
        return;
    }
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let path = dir.join(format!("{stamp}-{session_id}-{turn_id}.md"));
    let body = format!(
        "<!-- athena prompt snapshot · turn {turn_id} · conversation {session_id} · {stamp} -->\n{system_prompt}\n\n---USER-MESSAGE---\n{user_message}\n"
    );
    if let Err(e) = std::fs::write(&path, body) {
        tracing::warn!(error = %e, "prompt dump: write failed");
    }
}

/// Resolve the platform-correct invocation for the Claude CLI.
/// On Windows we go via `cmd.exe /C claude.cmd` because the CLI is a
/// .cmd shim and a direct spawn doesn't see PATH the way the shell does.
/// On Unix the binary itself is on PATH.
///
/// Public so the consolidation + reflection one-shots can reuse the
/// same invocation pattern instead of duplicating the platform check.
pub fn base_cli_invocation() -> (String, Vec<String>) {
    // Shared resolver — verified absolute claude.exe on Windows so a broken
    // or missing claude.cmd shim on PATH can't break the spawn.
    crate::engine::cli_process::claude_cli_invocation()
}

/// Apply the Windows "no console window" creation flag to a CLI command.
///
/// The Personas app is a GUI process with no console of its own. A console-
/// subsystem child — the `cmd /C claude.cmd` chain from [`base_cli_invocation`]
/// — spawned without this flag gets a fresh `conhost.exe` allocated on the
/// interactive desktop. That both flashes a black window on every turn AND,
/// multiplied across the fleet PTYs + build sessions + back-to-back
/// proactive / brain / consolidation turns, drains the window-station desktop
/// heap. Once that heap is exhausted, new console children fail to initialize
/// and exit immediately with `STATUS_DLL_INIT_FAILED` (`0xC0000142`) — observed
/// in the wild on a fleet-orchestration proactive turn ("claude exited with
/// status exit code: 0xc0000142"). Running `claude` from an existing console
/// (cmd.exe / Windows Terminal) never hits this, which is why it only reproduces
/// inside the app.
///
/// The `CliArgs` / [`crate::engine::cli_process`] spawn family already sets this
/// on every spawn; the `base_cli_invocation` family historically did not. This
/// helper centralizes the flag so the two families can't drift apart again. All
/// of these calls pipe stdin/stdout/stderr, so the child never needs a console.
/// No-op on non-Windows.
pub fn apply_no_console_window(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}
