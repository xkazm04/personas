//! Spawning the Claude CLI and reading its stream-json back: the process
//! invocation, the stdout loop, and the small helpers that shape the command.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::events::{emit, StreamEvent, StreamEventKind};
use super::interrupts::{clear_interrupt, was_interrupted};
use super::launch::{build_launch, AthenaLaunch, LaunchCtx, PromptDelivery};
use super::model::{BUILD_TURN_EFFORT, COMPANION_TURN_MODEL};
use super::stream::{persist_stream_progress, CliRunOutput};
use super::transcript::upsert_claude_session_id;
use crate::companion::engine_settings::{AthenaEngine, ResolvedTier, TurnTierClass};
use crate::companion::turn_ledger::CliUsage;
use crate::db::UserDbPool;
use crate::error::AppError;

/// One CLI turn's inputs for [`run_cli_turn`]: the launch context plus the
/// engine decision the caller already made (see `launch::effective_tier`).
pub(super) struct CliTurn<'a> {
    pub turn_id: &'a str,
    pub session_id: &'a str,
    /// The engine's session pointer for `--resume`, if the conversation has one.
    pub resume_session_id: Option<&'a str>,
    pub system_prompt: &'a str,
    pub user_message: &'a str,
    /// Which arm to launch. Must be `Claude` when `tier.engine` fell back.
    pub engine: AthenaEngine,
    /// Model + effort for the spawn (already folded: env → setting → default,
    /// or the build turn's pin).
    pub tier: &'a ResolvedTier,
    pub browser_tools: bool,
    /// A research leg (athena-browser-react, `session::research`): the CLI
    /// gets `--allowedTools WebSearch,WebFetch --max-turns 8` instead of the
    /// chat argv, and this loop stays SILENT — no `companion://stream` events
    /// and no session-pointer write, because the leg is not a conversation
    /// turn and `session_id` is a job-scoped label, never the conversation.
    pub research_tools: bool,
    /// Working directory for the spawned CLI. `None` = the user's home dir (the
    /// default — so a normal Athena turn doesn't auto-pick up the Personas
    /// project's CLAUDE.md). `Some(path)` roots the turn in a project directory
    /// (web-build build sessions — P2 of the web-dev companion).
    pub cwd_override: Option<&'a std::path::Path>,
    /// Per-project MCP connectors to load on a build turn (C8). Empty = none.
    pub mcp: &'a [String],
    /// Continuous informing (Variant B). When true, each `PROGRESS:` beat and
    /// each confirmed-non-final prose segment is persisted as its own assistant
    /// episode the instant it streams in — at its REAL emission time — instead
    /// of being buffered for one end-of-turn flush (which stamped every beat /
    /// segment within the same millisecond → the "long-pause-then-big-bang"). The
    /// LAST prose segment is left un-persisted and returned so `send_turn` can
    /// store it as the considered final reply. False for build turns and
    /// fleet-orchestration (suppress_chat), which keep the prior behavior.
    pub persist_progress: bool,
    /// Mirror of the terminal `result` usage, visible to the CALLER even when
    /// this function returns `Err` or its future is dropped by the turn timeout
    /// — both of which discard the local `result_usage` below. That is what
    /// keeps cost capture best-effort on the failure path rather than
    /// all-or-nothing. `None` for build turns, which have no ledger row.
    pub usage_sink: Option<&'a std::sync::Mutex<Option<CliUsage>>>,
}

/// The build-turn entry (`build_turn.rs`): Claude, pinned to the canonical
/// model, effort from the Studio knob or [`BUILD_TURN_EFFORT`]. Kept with its
/// pre-seam signature so the build path is untouched by the engine seam; chat
/// turns go through [`run_cli_turn`] with a resolved tier.
///
/// `too_many_arguments`: this signature is wide and stays wide for now. The
/// workspace already carries 159 site-level allows on functions of the same
/// shape; converting them to a parameter struct is a later wave's job.
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
    cwd_override: Option<&std::path::Path>,
    // Reasoning effort for build turns. `None` → `BUILD_TURN_EFFORT`.
    // Validated against the known levels so we never inject an arbitrary
    // flag value.
    build_effort: Option<&str>,
    mcp: &[String],
    persist_progress: bool,
    usage_sink: Option<&std::sync::Mutex<Option<CliUsage>>>,
) -> Result<CliRunOutput, AppError> {
    let effort = match build_effort {
        Some(e) if matches!(e, "low" | "medium" | "high" | "xhigh") => e,
        _ => BUILD_TURN_EFFORT,
    };
    let tier = ResolvedTier {
        class: TurnTierClass::Main,
        engine: AthenaEngine::Claude,
        model: COMPANION_TURN_MODEL.to_string(),
        effort: Some(effort.to_string()),
    };
    run_cli_turn(
        app,
        pool,
        CliTurn {
            turn_id,
            session_id,
            resume_session_id: claude_session_id,
            system_prompt,
            user_message,
            engine: AthenaEngine::Claude,
            tier: &tier,
            browser_tools,
            research_tools: false,
            cwd_override,
            mcp,
            persist_progress,
            usage_sink,
        },
    )
    .await
}

/// Spawn the engine for one turn, stream its stdout back as events, and
/// return the assistant text, its segments and the parsed `result` usage
/// (carrying spawn-to-first-text in `first_text_ms`).
pub(super) async fn run_cli_turn(
    app: &AppHandle,
    pool: &UserDbPool,
    turn: CliTurn<'_>,
) -> Result<CliRunOutput, AppError> {
    let CliTurn {
        turn_id,
        session_id,
        resume_session_id,
        system_prompt,
        user_message,
        engine,
        tier,
        browser_tools,
        research_tools,
        cwd_override,
        mcp,
        persist_progress,
        usage_sink,
    } = turn;
    let name = engine.as_setting();

    // Bench seam (B0.2, docs/plans/athena-live-conversation-layer.md):
    // PERSONAS_DUMP_PROMPT=1 snapshots the fully-composed system prompt +
    // user message per turn under ~/.personas/debug/prompts/ so the model
    // bench replays REAL prompts. Best-effort; never blocks the turn.
    if std::env::var("PERSONAS_DUMP_PROMPT").is_ok_and(|v| v == "1") {
        dump_prompt_snapshot(turn_id, session_id, system_prompt, user_message);
    }

    // The whole invocation — program, argv, prompt/profile temp files, cwd —
    // comes from the engine seam. `launch` must outlive the child: its temp
    // files are removed when it drops.
    let launch: AthenaLaunch = build_launch(
        engine,
        tier,
        &LaunchCtx {
            turn_id,
            session_id,
            resume_session_id,
            system_prompt,
            user_message,
            browser_tools,
            research_tools,
            cwd_override,
            mcp,
            warm: None,
        },
    )?;
    let cwd = launch.cwd.clone();

    let mut cmd = prepare_command(&launch);
    // Spawn-to-first-text starts here: the number the routing table is
    // calibrated on is what the user waits, which includes process start.
    let spawned_at = Instant::now();
    let mut child = cmd.spawn().map_err(|e| match engine {
        AthenaEngine::Claude => AppError::Internal(format!("spawn claude: {e}")),
        // Worded so `failure::classify_failure` still files it as
        // `spawn_failed` ("failed to spawn").
        AthenaEngine::Grok => AppError::Internal(format!("failed to spawn grok: {e}")),
    })?;

    // Deliver the prompt. Claude reads it from stdin (`-p -`); grok already
    // has it on argv, so stdin is just closed. Either way closing stdin
    // signals end-of-prompt.
    if let Some(mut stdin) = child.stdin.take() {
        if launch.prompt_delivery == PromptDelivery::Stdin {
            stdin
                .write_all(user_message.as_bytes())
                .await
                .map_err(|e| AppError::Internal(format!("write {name} stdin: {e}")))?;
        }
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal(format!("{name} stdout missing")))?;
    let mut reader = BufReader::new(stdout).lines();

    // Drain stderr concurrently into a buffer so we can include it in
    // any failure message. Without this, exit-1 produces a useless
    // "claude exited with status 1" with no diagnostic context.
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal(format!("{name} stderr missing")))?;
    let (stderr_buf, stderr_handle) = drain_stderr(stderr);

    // Everything the stream-json lines accumulate into — shared with the warm
    // session loop (`warm.rs`), which reads the same envelope from a process
    // that outlives the turn. Spawn-to-first-text starts at `spawned_at`.
    let mut acc = StreamAccumulator::new(spawned_at);
    let ingest = IngestCtx {
        pool,
        session_id,
        persist_progress,
        usage_sink,
    };
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
                        // A research leg forwards nothing to the UI stream: it is
                        // not a turn of any conversation the panel shows.
                        if !research_tools {
                            emit(
                                app,
                                StreamEvent {
                                    session_id: session_id.to_string(),
                                    turn_id: turn_id.to_string(),
                                    kind: StreamEventKind::Cli,
                                    payload: line.clone(),
                                },
                            );
                        }
                        // Spawn-per-turn: the `result` line is followed by EOF,
                        // so the loop keeps reading until the pipe closes.
                        acc.ingest(&line, &ingest);
                    }
                    Ok(None) => break, // EOF — CLI finished naturally
                    Err(e) => {
                        // Don't hard-error and lose accumulated text.
                        // Record the failure, break, and let the
                        // partial-reply tail tag it for the user.
                        stdout_read_error = Some(format!("read {name} stdout: {e}"));
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
        .map_err(|e| AppError::Internal(format!("wait {name}: {e}")))?;
    let _ = stderr_handle.await;
    let stderr_text = stderr_buf.lock().await.clone();
    // The child has exited: the prompt / profile temp files can go.
    drop(launch);
    // A turn that streamed text but died before its `result` line still has
    // a first-text measurement worth keeping; an all-`None` usage block with
    // the timing is what the ledger writes as NULL usage + `first_text_ms`.
    let StreamAccumulator {
        assistant_text,
        segments,
        new_claude_session_id,
        mut result_usage,
        first_text_ms,
        ..
    } = acc;
    // A research leg's session is a one-shot: its id must never become a
    // conversation's `--resume` pointer, so every persist below sees `None`.
    let new_claude_session_id = if research_tools {
        None
    } else {
        new_claude_session_id
    };
    if result_usage.is_none() && first_text_ms.is_some() {
        result_usage = Some(CliUsage {
            first_text_ms,
            ..Default::default()
        });
    }
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
        let trimmed = stderr_tail(&stderr_text);
        // Non-zero exit AFTER partial text streamed: preserve the
        // partial — same logic as stdout_read_error above. The stderr
        // tail goes into the tag so the user (and Athena, next turn)
        // sees the diagnostic context.
        if !assistant_text.trim().is_empty() {
            if let Some(sid) = new_claude_session_id {
                upsert_claude_session_id(pool, session_id, &sid)?;
            }
            let body = format!(
                "{assistant_text}\n\n_[interrupted by error: {name} exited with status {status}{}]_",
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
            "{name} exited with status {status}: {trimmed}"
        )));
    }

    // Persist the (possibly new) claude session id for next turn's --resume.
    if let Some(sid) = new_claude_session_id {
        upsert_claude_session_id(pool, session_id, &sid)?;
    }

    if assistant_text.is_empty() {
        return Err(AppError::Internal(format!(
            "{name} produced no assistant text"
        )));
    }

    Ok((assistant_text, segments, result_usage))
}

/// The process invocation for a launch, with the env every arm needs: the
/// Claude-side env on the Claude arm, the nesting strip on grok, the
/// subscription-auth strip, no console window, and `kill_on_drop`. Shared by
/// the spawn-per-turn path and the warm session (`warm.rs`).
pub(super) fn prepare_command(launch: &AthenaLaunch) -> Command {
    let mut cmd = Command::new(&launch.program);
    cmd.args(&launch.argv)
        .current_dir(&launch.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match launch.engine {
        AthenaEngine::Claude => {
            cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
                .env("CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "1")
                // Enable fork-style subagent dispatch (2.1.117+) — when Athena
                // uses the Task tool, the child inherits her full conversation
                // history, runs in background, and shares the prompt cache.
                // Cheaper than a named subagent and gives the autonomous loop
                // a way to "send a copy of herself to investigate" without
                // re-priming context. Harmless on older CLI versions (env var
                // is ignored if the feature isn't recognized).
                .env("CLAUDE_CODE_FORK_SUBAGENT", "1");
        }
        AthenaEngine::Grok => {
            // Grok reads the Claude-compat env; a leaked `CLAUDECODE` /
            // `CLAUDE_CODE_*` from a parent Claude Code session would make it
            // behave as a nested agent. Nothing Claude-specific is set.
            super::launch::strip_nesting_env(&mut cmd);
        }
    }
    // Athena (and every persona execution/evaluation) runs on the Claude
    // monthly subscription — strip any ANTHROPIC_* API-account auth so the CLI
    // uses its OAuth/keychain credentials, never billing the API. Harmless on
    // grok, which ignores those variables.
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
    cmd
}

/// How much of a child's stderr a failure message carries.
pub(super) const STDERR_TAIL_BYTES: usize = 600;

/// The stderr text a failure message carries: the first
/// [`STDERR_TAIL_BYTES`] on a char boundary, with the cut stated in words at
/// the end rather than an in-band glyph that nothing downstream can tell from
/// a CLI that printed one. The leading text is untouched so the stale-resume
/// wording (`is_stale_session_error`) and the failure classifier still read
/// it exactly as they read the whole message. Shared with the warm session
/// (`warm.rs`).
pub(super) fn stderr_tail(stderr: &str) -> String {
    let (text, truncated) = cap_stderr(stderr);
    if truncated {
        format!(
            "{text} [stderr truncated at {STDERR_TAIL_BYTES} bytes of {} total]",
            stderr.len()
        )
    } else {
        text.to_string()
    }
}

/// The cut and the fact of the cut, side by side.
fn cap_stderr(stderr: &str) -> (&str, bool) {
    if stderr.len() > STDERR_TAIL_BYTES {
        (
            crate::utils::text::truncate_on_char_boundary(stderr, STDERR_TAIL_BYTES),
            true,
        )
    } else {
        (stderr, false)
    }
}

/// Drain a child's stderr into a shared buffer so a failure message can carry
/// the diagnostic tail.
pub(super) fn drain_stderr(
    stderr: tokio::process::ChildStderr,
) -> (Arc<tokio::sync::Mutex<String>>, tokio::task::JoinHandle<()>) {
    let buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let handle = {
        let buf = buf.clone();
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
    (buf, handle)
}

/// What one turn's stream-json lines accumulate into. One implementation for
/// both loops: the spawn-per-turn path above (a `result` line is followed by
/// EOF) and the warm session (`warm.rs`, where the `result` line ends the turn
/// but the process stays up for the next one).
pub(super) struct StreamAccumulator {
    pub assistant_text: String,
    /// Per-assistant-message text, in emission order (Phase B interim segments).
    pub segments: Vec<String>,
    /// Continuous informing: the most recent non-empty cleaned prose segment
    /// that hasn't been confirmed non-final yet. Flushed as an interim episode
    /// the moment a LATER prose segment arrives; whatever remains here at EOF
    /// is the final reply (persisted by `send_turn`), so it's never flushed
    /// here. Only used when `persist_progress` is set.
    pending_interim: Option<String>,
    /// The `session_id` from the `system` init line, if one arrived.
    pub new_claude_session_id: Option<String>,
    /// The CLI's terminal `result` event carries this turn's real cost / token
    /// usage / duration; captured here for the companion_turn ledger.
    pub result_usage: Option<CliUsage>,
    /// Start-to-first-visible-text, the latency the user actually waits and
    /// the number the tier table is calibrated on. Set once, on the first
    /// `text_delta` stream event; `None` if the turn never produced one. The
    /// start is the spawn on the cold path and the user-line write on the warm
    /// path — in both cases the moment the user's message left this process.
    pub first_text_ms: Option<i64>,
    started_at: Instant,
}

/// Where a line's side effects go while it is ingested.
pub(super) struct IngestCtx<'a> {
    /// The conversation store the mid-turn progress persist writes to. Never
    /// optional: a turn without a store would report its progress as absent
    /// rather than unknown. `persist_progress` is the switch.
    pub pool: &'a UserDbPool,
    pub session_id: &'a str,
    pub persist_progress: bool,
    pub usage_sink: Option<&'a std::sync::Mutex<Option<CliUsage>>>,
}

impl StreamAccumulator {
    pub fn new(started_at: Instant) -> Self {
        Self {
            assistant_text: String::new(),
            segments: Vec::new(),
            pending_interim: None,
            new_claude_session_id: None,
            result_usage: None,
            first_text_ms: None,
            started_at,
        }
    }

    /// Fold one stdout line in. Returns `true` when the line was the terminal
    /// `result` event — the turn is over, whatever the process does next.
    pub fn ingest(&mut self, line: &str, ctx: &IngestCtx<'_>) -> bool {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return false;
        };
        if self.first_text_ms.is_none() && is_text_delta(&value) {
            self.first_text_ms = Some(self.started_at.elapsed().as_millis() as i64);
        }
        if value.get("type").and_then(|v| v.as_str()) == Some("system") {
            if let Some(sid) = value.get("session_id").and_then(|v| v.as_str()) {
                self.new_claude_session_id = Some(sid.to_string());
            }
        }
        if value.get("type").and_then(|v| v.as_str()) == Some("assistant") {
            if let Some(content) = value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                // Collect THIS message's text blocks into one segment, then
                // fold into the running full text.
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
                    if !self.assistant_text.is_empty() {
                        self.assistant_text.push('\n');
                    }
                    self.assistant_text.push_str(&msg_text);

                    // Continuous informing (Variant B): flush this step's
                    // progress + prior prose NOW, at their real emission time,
                    // rather than batching every beat/segment at turn-end.
                    if ctx.persist_progress {
                        persist_stream_progress(
                            ctx.pool,
                            ctx.session_id,
                            &msg_text,
                            &mut self.pending_interim,
                        );
                    }

                    self.segments.push(msg_text);
                }
            }
        }
        if let Some(mut u) = CliUsage::from_result_event(&value) {
            // First text always precedes the result line, so the measurement
            // rides the same struct.
            u.first_text_ms = self.first_text_ms;
            // Publish before storing locally: if this turn goes on to fail (or
            // the timeout drops this whole future), the sink is the only copy
            // the caller will still have.
            if let Some(sink) = ctx.usage_sink {
                if let Ok(mut g) = sink.lock() {
                    *g = Some(u.clone());
                }
            }
            self.result_usage = Some(u);
            return true;
        }
        false
    }
}

/// Was this CLI failure caused by an expired/missing --resume session id?
/// We match liberally on the known message patterns the CLI emits so this
/// keeps working across CLI version drift.
///
/// Two arms. Claude: `No conversation found with session ID: …`. Grok 1.0.34
/// (captured 2026-09-17 with a bogus id, exit 1, on stderr):
/// `Session "<id>" not found locally, restoring conversation from remote...`
/// then `Error: Failed to restore session from remote: fetching session
/// record: session get failed: 404 Not Found`. Either line alone is enough.
pub(super) fn is_stale_session_error(e: &AppError) -> bool {
    let msg = e.to_string().to_lowercase();
    msg.contains("no conversation found")
        || msg.contains("session id")
            && (msg.contains("not found") || msg.contains("does not exist"))
        || msg.contains("failed to restore session")
        || msg.contains("not found locally")
}

/// A `stream_event` carrying a `content_block_delta` of type `text_delta` —
/// the first visible token of the reply, on both engines (grok emits the
/// same envelope).
pub(super) fn is_text_delta(value: &serde_json::Value) -> bool {
    value.get("type").and_then(|v| v.as_str()) == Some("stream_event")
        && value.pointer("/event/delta/type").and_then(|v| v.as_str()) == Some("text_delta")
}

/// Bench seam (B0.2): persist one turn's fully-composed system prompt + user
/// message under `~/.personas/debug/prompts/` for the model bench to replay.
/// The `---USER-MESSAGE---` divider is the harness's parse contract
/// (`scripts/test/athena-model-bench.mjs`). Best-effort: any failure is
/// tracing-only and never blocks the turn.
pub(super) fn dump_prompt_snapshot(
    turn_id: &str,
    session_id: &str,
    system_prompt: &str,
    user_message: &str,
) {
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
