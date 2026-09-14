//! Headless (stream-json) Fleet sessions — Tier B of the fleet-scale plan.
//!
//! Spawns `claude -p --input-format stream-json --output-format stream-json`
//! with plain piped stdio instead of a PTY. Compared to the interactive lane:
//!
//! - **No ConPTY / conhost**, and **no TUI redraw loop** — an idle headless
//!   session costs ~zero CPU (the interactive CLI repaints its status line
//!   continuously even when idle).
//! - **Structured events instead of escape sequences.** The stdout reader
//!   parses one JSON event per line and drives the state machine directly:
//!   `system/init` → alive, `assistant` → Running, `result` → Idle. No vt100
//!   reconstruction, no keystroke-driving of TUI menus on this lane.
//! - **Same conversation semantics.** The session id is pinned via
//!   `--session-id`, the transcript persists under `<uuid>.jsonl`, lifecycle
//!   hooks still fire, the staleness ticker still applies (PTY-silence checks
//!   exempt it — `last_pty_output_ms` stays 0), and Hibernate/Wake work —
//!   waking a headless conversation resumes it interactively.
//!
//! The output ring is fed *cooked display lines* (plain text + `\r\n`) derived
//! from the events, so everything downstream that reads the ring — the grid
//! peek, `render_screen_for`, Athena's orchestration context — keeps working
//! with cleaner content than a scraped TUI.
//!
//! `write_input` on this lane wraps the payload into one stream-json user
//! message (see `registry::write_input`), so broadcast, quick-reply, and
//! Athena's `fleet_send_input` all just work. The process stays alive between
//! turns because we hold its stdin open; if Personas dies, the pipe closes and
//! `claude -p` exits on EOF after the in-flight turn — headless sessions never
//! outlive the app as invisible orphans.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

use crate::engine::event_registry::event_name;

use super::pty::{build_mcp_spawn, emit_registry_changed, finalize_child_exit, CLAUDE_NESTING_ENV};
use super::registry::{
    headless_user_message, now_ms, registry, FleetSessionInner, OutputRing, OUTPUT_RING_CAP,
};
use super::types::{FleetSessionMode, FleetSessionState};

/// `fleet-session-output` payload (mirrors the PTY reader's shape).
#[derive(Serialize, Clone)]
struct OutputPayload<'a> {
    session_id: &'a str,
    chunk: String,
}

/// `fleet-session-state` payload (mirrors the ticker's shape).
#[derive(Serialize, Clone)]
/// PID-based kill handle so headless sessions ride the exact same
/// `session.killer` path close/hibernate already use for PTY children.
/// Targeted (never a blanket kill), same mechanism as `fleet_kill_pid`.
#[derive(Debug)]
struct PidKiller(u32);

impl portable_pty::ChildKiller for PidKiller {
    fn kill(&mut self) -> std::io::Result<()> {
        let target = Pid::from_u32(self.0);
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::Some(&[target]), true);
        match sys.process(target) {
            Some(p) => {
                p.kill();
                Ok(())
            }
            // Already gone — kill is idempotent.
            None => Ok(()),
        }
    }

    fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
        Box::new(PidKiller(self.0))
    }
}

/// The flags every headless spawn carries, before `extra_args` and before the
/// variadic `--mcp-config`. Pure, so the argv contract is unit-testable without
/// spawning anything.
///
/// `extra_args` are appended in order, with ONE rule applied: a flag from
/// [`super::naming::VALUE_FLAGS`] that the base argv already carries is dropped
/// along with its value. Only `--session-id` can collide today (the base pins
/// it), but the rule is written against the flag list rather than that one name
/// because the caller-supplied set grows — the decide lane started passing
/// `--model` on 2026-09-07 — and `claude` takes the LAST occurrence of a
/// repeated flag, so a silent duplicate would override a value this function
/// chose deliberately.
fn headless_argv(claude_session_id: &str, extra_args: &[String]) -> Vec<String> {
    let mut argv: Vec<String> = [
        "--print",
        // stream-json output with --print requires --verbose (per CLI contract).
        "--verbose",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--session-id",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    argv.push(claude_session_id.to_string());

    let base_flags: Vec<String> = argv
        .iter()
        .filter(|a| a.starts_with("--"))
        .cloned()
        .collect();
    let mut i = 0;
    while i < extra_args.len() {
        let a = &extra_args[i];
        let takes_value = super::naming::VALUE_FLAGS.contains(&a.as_str());
        if base_flags.contains(a) {
            tracing::warn!(
                flag = %a,
                "fleet headless spawn: dropping a caller arg the base argv already sets"
            );
            i += if takes_value { 2 } else { 1 };
            continue;
        }
        argv.push(a.clone());
        if takes_value {
            if let Some(v) = extra_args.get(i + 1) {
                argv.push(v.clone());
            }
        }
        i += if takes_value { 2 } else { 1 };
    }
    argv
}

/// Spawn a headless stream-json Claude Code session rooted at `cwd`, seeded
/// with `task` as its first user message. Returns the internal session id.
pub fn spawn_headless_session(
    app: AppHandle,
    cwd: PathBuf,
    task: String,
    extra_args: Vec<String>,
) -> Result<String, String> {
    if !cwd.exists() {
        return Err(format!("cwd does not exist: {}", cwd.display()));
    }
    if !cwd.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd.display()));
    }
    if task.trim().is_empty() {
        return Err("headless spawn requires a non-empty task".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    // Deterministic binding, same as the PTY lane: pin claude's session id so
    // hooks/transcript/wake all key off a known uuid from the first tick.
    let claude_session_id = uuid::Uuid::new_v4().to_string();
    let mcp = build_mcp_spawn(&id);

    // `#[cfg(windows)]`, NOT `if cfg!(windows)`: the macro form is a runtime
    // bool, so the Windows branch still gets compiled and type-checked on every
    // platform — and `resolve_claude_exe_windows` only exists under
    // `#[cfg(windows)]`. That produced E0425 on macOS and Linux.
    #[cfg(windows)]
    let program: PathBuf = match crate::engine::cli_process::resolve_claude_exe_windows() {
        Some(p) => PathBuf::from(p),
        None => {
            return Err(
                "fleet headless spawn: claude executable not found (checked the native \
                 installer %USERPROFILE%\\.local\\bin, the npm-global layout, and PATH)"
                    .to_string(),
            )
        }
    };
    #[cfg(not(windows))]
    let program: PathBuf = PathBuf::from("claude");

    let mut cmd = Command::new(&program);
    for a in headless_argv(&claude_session_id, &extra_args) {
        cmd.arg(a);
    }
    // Variadic `--mcp-config` must come LAST — see pty.rs for the rationale.
    if let Some(p) = mcp.config_path.as_deref() {
        let p_fwd = p.display().to_string().replace('\\', "/");
        cmd.arg("--mcp-config");
        cmd.arg(p_fwd);
    }
    cmd.current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    // Subscription auth + top-level session semantics — same strips as the PTY lane.
    for &key in crate::engine::cli_process::CLI_SUBSCRIPTION_RESERVED_ENV {
        cmd.env_remove(key);
    }
    for &key in CLAUDE_NESTING_ENV {
        cmd.env_remove(key);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn headless `claude` failed: {e}"))?;
    let child_pid = child.id();

    let mut stdin = child
        .stdin
        .take()
        .ok_or("headless spawn: no stdin handle")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("headless spawn: no stdout handle")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("headless spawn: no stderr handle")?;

    // Seed the first turn BEFORE registry insertion so a write failure fails
    // the spawn cleanly instead of leaving a silent do-nothing session.
    stdin
        .write_all(headless_user_message(&task).as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("headless spawn: seeding the first task failed: {e}"))?;

    let now = now_ms();
    let project_label = cwd
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let output = Arc::new(Mutex::new(OutputRing::new(OUTPUT_RING_CAP)));

    let (run_id, run_label) = super::run::claim_run_for_spawn();
    let inner = FleetSessionInner {
        id: id.clone(),
        claude_session_id: Some(claude_session_id),
        cwd: cwd.clone(),
        project_label,
        name: None,
        title: None,
        athena_active_until_ms: 0,
        args: extra_args.clone(),
        mode: FleetSessionMode::Headless,
        // Wide virtual grid so cooked lines render unwrapped through the
        // vt100 reconstruction paths (previews / orchestration context).
        cols: 200,
        rows: 50,
        state: FleetSessionState::Spawning,
        last_activity_ms: now,
        // Stays 0 forever on this lane — exempts headless sessions from the
        // PTY-silence "frozen mid-run" check (there is no status-line redraw
        // to be silent about; transcript growth + hooks carry freshness).
        last_pty_output_ms: 0,
        last_grew_ms: 0,
        created_at_ms: now,
        child_pid: Some(child_pid),
        exit_code: None,
        state_reason: Some("Headless session spawned".to_string()),
        limit_reset_at_ms: 0,
        run_id,
        run_label,
        stale_kind: None,
        master: Mutex::new(None),
        writer: Mutex::new(Some(Box::new(stdin))),
        hibernating: std::sync::atomic::AtomicBool::new(false),
        dozing: false,
        reaped: false,
        output: output.clone(),
        killer: Some(Mutex::new(Box::new(PidKiller(child_pid)))),
    };
    registry().insert(inner);
    emit_registry_changed(&app, "added", &id);

    // Cheap LLM naming from the task, same as spawn-with-task on the PTY lane -
    // INCLUDING its guard, which this lane was missing: the one-shot is an extra
    // `claude` process with a 30 s timeout per session, and it is pure waste when
    // the spawn args already carry `--name` (the CLI titles itself with it) or a
    // `--resume` (the woken conversation keeps its own identity, and the
    // transcript watcher adopts its on-disk `ai-title` for free).
    if !super::naming::args_supply_name(&extra_args) {
        super::naming::name_session_from_task(app.clone(), id.clone(), task);
    }

    // stdout reader — parses stream-json events, drives state, feeds the ring.
    let app_out = app.clone();
    let id_out = id.clone();
    let ring_out = output.clone();
    tokio::task::spawn_blocking(move || stdout_loop(app_out, id_out, ring_out, stdout));

    // stderr drain — surfaced into the ring so failures are readable in-app.
    let app_err = app.clone();
    let id_err = id.clone();
    let ring_err = output;
    tokio::task::spawn_blocking(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            push_display_line(&app_err, &id_err, &ring_err, &format!("! {line}"));
        }
    });

    // Reaper — polls try_wait so the PidKiller can terminate it any time.
    let app_reaper = app;
    let id_reaper = id.clone();
    let mcp_config_for_reaper = mcp.config_path.clone();
    let child = Arc::new(Mutex::new(child));
    tokio::task::spawn_blocking(move || {
        let exit_code = reaper_poll(&child);
        finalize_child_exit(&app_reaper, &id_reaper, exit_code);
        crate::companion::orchestration::mcp::release_session_tokens(&id_reaper);
        crate::companion::orchestration::mcp::pending::cancel_for_session(&id_reaper);
        if let Some(p) = mcp_config_for_reaper {
            if let Some(parent) = p.parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    });

    Ok(id)
}

/// Poll the child until it exits (250ms cadence). Polling instead of a
/// blocking `wait()` keeps the `Child` lockable, so kill/hibernate can
/// terminate it (via the OS PID) without deadlocking on the reaper's borrow.
fn reaper_poll(child: &Arc<Mutex<std::process::Child>>) -> Option<i32> {
    loop {
        {
            let mut guard = child.lock().unwrap_or_else(|e| e.into_inner());
            match guard.try_wait() {
                Ok(Some(status)) => return status.code(),
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(error = %e, "fleet headless reaper: try_wait failed");
                    return None;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Append one display line to the ring (CRLF-terminated so vt100/preview
/// consumers keep line structure) and forward it over IPC while subscribed.
fn push_display_line(app: &AppHandle, session_id: &str, ring: &Arc<Mutex<OutputRing>>, line: &str) {
    let framed = format!("{line}\r\n");
    let subscribed = {
        let mut r = ring.lock().unwrap_or_else(|e| e.into_inner());
        r.push(framed.as_bytes());
        r.is_subscribed()
    };
    if subscribed {
        let _ = app.emit(
            event_name::FLEET_SESSION_OUTPUT,
            OutputPayload {
                session_id,
                chunk: framed,
            },
        );
    }
}

/// Apply a state transition + emit the same events the other lanes emit.
fn transition(
    app: &AppHandle,
    session_id: &str,
    state: FleetSessionState,
    tag: &str,
    reason: &str,
) {
    if registry().set_state_direct(session_id, state, reason) {
        super::pty::emit_session_state(app, session_id, None, tag, Some(reason.to_string()));
        emit_registry_changed(app, "updated", session_id);
    }
}

/// One cooked display line for a stream-json event, or `None` to stay silent.
/// Pure — unit-tested below.
fn render_event_line(event: &serde_json::Value) -> Option<String> {
    match event.get("type").and_then(|t| t.as_str()) {
        Some("system") => {
            let subtype = event.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
            if subtype == "init" {
                let model = event.get("model").and_then(|m| m.as_str()).unwrap_or("?");
                Some(format!("· session started ({model})"))
            } else {
                None
            }
        }
        Some("assistant") => {
            let blocks = event
                .pointer("/message/content")
                .and_then(|c| c.as_array())?;
            let mut parts: Vec<String> = Vec::new();
            for b in blocks {
                match b.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(text) = b.get("text").and_then(|t| t.as_str()) {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                parts.push(trimmed.to_string());
                            }
                        }
                    }
                    Some("tool_use") => {
                        let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("?");
                        parts.push(format!("● {name}"));
                    }
                    _ => {}
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\r\n"))
            }
        }
        Some("result") => {
            let subtype = event
                .get("subtype")
                .and_then(|s| s.as_str())
                .unwrap_or("done");
            let turns = event.get("num_turns").and_then(|n| n.as_i64());
            match turns {
                Some(n) => Some(format!("— turn complete ({subtype}, {n} turns)")),
                None => Some(format!("— turn complete ({subtype})")),
            }
        }
        // Tool results are voluminous and already visible via the transcript;
        // keep the glance log terse.
        Some("user") => None,
        _ => None,
    }
}

/// The plain assistant text of an event, tool calls excluded — the closing
/// prose of a turn, which is where the fleet protocol's completion line lives.
/// Pure.
fn assistant_text(event: &serde_json::Value) -> Option<String> {
    let blocks = event
        .pointer("/message/content")
        .and_then(|c| c.as_array())?;
    let mut text = String::new();
    for b in blocks {
        if b.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(t);
            }
        }
    }
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The final assistant text of a completed turn. The `result` event carries the
/// closing message in its own `result` field, which is the authoritative copy;
/// `last_assistant` is the loop's running capture, used when the event does not
/// carry one (the error subtypes do not). Pure.
fn turn_final_text(event: &serde_json::Value, last_assistant: Option<&str>) -> Option<String> {
    event
        .get("result")
        .and_then(|r| r.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| last_assistant.map(str::to_string))
}

/// How long a one-shot worker's process is left alive after its work is over,
/// so the transcript finishes flushing and any trailing Stop hook completes
/// before the child is terminated. Short on purpose: the whole point is that an
/// idle `claude` costs ~300 MB and the resource governor is counting.
const ONE_SHOT_REAP_GRACE: Duration = Duration::from_secs(5);

/// Settle a ONE-SHOT WORKER's completed turn (**G21 + G25**).
///
/// Interactive sessions and every session without the one-shot run label are
/// left exactly as they were — those are conversations, they keep their
/// process, and a `result` event on them means only "your turn, operator".
pub(super) fn settle_one_shot_turn(app: &AppHandle, session_id: &str, final_text: Option<&str>) {
    use super::classify::WorkerTurnEnd;
    if !registry().is_one_shot_worker(session_id) {
        return;
    }
    match super::classify::worker_turn_end(final_text) {
        WorkerTurnEnd::Declared { summary } => {
            if let Some(prev) = registry().mark_finished(session_id, &summary) {
                super::pty::emit_session_state(
                    app,
                    session_id,
                    Some(prev),
                    "finished",
                    Some(format!("Task complete: {summary}")),
                );
                emit_registry_changed(app, "updated", session_id);
                super::debug_log::lifecycle(session_id, "finished (declared)", &summary);
            }
            reap_after_completion(app, session_id, "declared complete");
        }
        WorkerTurnEnd::Blocked { reason } => {
            // Unchanged lane: the worker asked for a human, so it parks
            // `awaiting_input` with its declaration and `stale::unattended_awaiting_pass`
            // finishes it once its 15-minute cutoff proves nobody came. No reap
            // here — that pass writes the verdict, and killing the process first
            // would race it into an `exited` row.
            if let Some(prev) = registry().escalate_to_awaiting(session_id, &reason) {
                super::pty::emit_session_state(
                    app,
                    session_id,
                    Some(prev),
                    "awaiting_input",
                    Some(reason.clone()),
                );
                emit_registry_changed(app, "updated", session_id);
                super::debug_log::lifecycle(session_id, "blocked (declared)", &reason);
            }
        }
        WorkerTurnEnd::Unmarked { reason } => {
            if let Some(prev) = registry().finish_unmarked(session_id, &reason) {
                super::pty::emit_session_state(
                    app,
                    session_id,
                    Some(prev),
                    "finished",
                    Some(reason.clone()),
                );
                emit_registry_changed(app, "updated", session_id);
                super::debug_log::lifecycle(session_id, "finished (unmarked)", &reason);
            }
            reap_after_completion(app, session_id, "turn ended without a completion line");
        }
        WorkerTurnEnd::Limit { banner } => {
            // The lifecycle stays where the `result` event put it (`Idle`) —
            // `stale::limit_retry_pass` owns this lane and needs the process
            // alive to retry — but the row now says WHY it is sitting there
            // instead of "ready for the next instruction".
            if registry().set_state_reason(session_id, &banner) {
                emit_registry_changed(app, "updated", session_id);
            }
            super::debug_log::lifecycle(session_id, "limit at turn end", &banner);
        }
    }
}

/// Claim the session's process and end it after [`ONE_SHOT_REAP_GRACE`].
/// The claim happens NOW so the ticker's backstop and the child reaper both
/// already know this exit is planned; only the kill waits.
fn reap_after_completion(app: &AppHandle, session_id: &str, why: &str) {
    if !registry().claim_reap(session_id) {
        return;
    }
    let app = app.clone();
    let session_id = session_id.to_string();
    let why = why.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ONE_SHOT_REAP_GRACE).await;
        // The claim is already recorded, so a panic in here would leave a
        // worker flagged reaped with its process still resident and nothing
        // ever coming back for it — the precise failure this reaper exists to
        // remove. The boundary is inside the task and its Err arm is durable:
        // the fleet debug log is the same sink the successful reap writes to.
        let killed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            kill_claimed_worker(&app, &session_id, &why);
        }));
        if killed.is_err() {
            tracing::error!(
                session_id = %session_id,
                "fleet one-shot reap panicked — the worker's process may still be resident"
            );
            super::debug_log::lifecycle(
                &session_id,
                "reap panicked",
                "the claimed process was not confirmed freed",
            );
        }
    });
}

/// Reap a one-shot worker with no grace — the ticker's backstop, where the
/// session has already sat parked for its whole window. Returns `true` when it
/// actually claimed and killed something.
pub(super) fn reap_now(app: &AppHandle, session_id: &str, why: &str) -> bool {
    if !registry().claim_reap(session_id) {
        return false;
    }
    kill_claimed_worker(app, session_id, why);
    true
}

/// End an already-claimed worker's process through the same door
/// `fleet_kill_session` uses — the session's OWN kill handle, never a blanket
/// kill. The child reaper picks the exit up and, seeing the claim, keeps the
/// row's finished state.
fn kill_claimed_worker(app: &AppHandle, session_id: &str, why: &str) {
    let outcome = registry().close_pty_handles_reporting(session_id);
    super::debug_log::lifecycle(
        session_id,
        "reaped after completion",
        &match outcome.failure() {
            Some(e) => format!("{why} — kill refused: {e}"),
            None => format!("{why} — process freed"),
        },
    );
    emit_registry_changed(app, "updated", session_id);
}

/// stdout loop — one stream-json event per line. Drives the state machine
/// (init → alive, assistant → Running, result → Idle) and feeds the ring.
fn stdout_loop(
    app: AppHandle,
    session_id: String,
    ring: Arc<Mutex<OutputRing>>,
    stdout: std::process::ChildStdout,
) {
    // The turn's closing prose, kept so the `result` event can be read for the
    // fleet protocol's completion line even when it carries no `result` field.
    let mut last_assistant: Option<String> = None;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            // Not JSON (unexpected) — keep it visible rather than dropping it.
            push_display_line(&app, &session_id, &ring, trimmed);
            continue;
        };
        if let Some(display) = render_event_line(&event) {
            push_display_line(&app, &session_id, &ring, &display);
        }
        match event.get("type").and_then(|t| t.as_str()) {
            Some("system") => {
                if registry().mark_alive(&session_id) {
                    emit_registry_changed(&app, "updated", &session_id);
                }
            }
            Some("assistant") => {
                if let Some(text) = assistant_text(&event) {
                    last_assistant = Some(text);
                }
                transition(
                    &app,
                    &session_id,
                    FleetSessionState::Running,
                    "running",
                    "Streaming turn (headless)",
                );
            }
            Some("user") => {
                transition(
                    &app,
                    &session_id,
                    FleetSessionState::Running,
                    "running",
                    "Streaming turn (headless)",
                );
            }
            Some("result") => {
                transition(
                    &app,
                    &session_id,
                    FleetSessionState::Idle,
                    "idle",
                    "Turn completed — ready for the next instruction",
                );
                // …and for a one-shot worker the turn ending IS the job
                // ending: read how it ended and park it accordingly, instead
                // of leaving it `idle` for the stale sweeper to misread as a
                // stall (G25) with its process still resident (G21).
                let final_text = turn_final_text(&event, last_assistant.take().as_deref());
                settle_one_shot_turn(&app, &session_id, final_text.as_deref());
            }
            _ => {}
        }
    }
    tracing::debug!(session_id = %session_id, "fleet headless stdout: EOF");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn renders_init_assistant_and_result_lines() {
        let init = json!({"type":"system","subtype":"init","model":"claude-sonnet-5"});
        assert_eq!(
            render_event_line(&init).unwrap(),
            "· session started (claude-sonnet-5)"
        );

        let assistant = json!({"type":"assistant","message":{"content":[
            {"type":"text","text":"Working on it."},
            {"type":"tool_use","name":"Bash","input":{}}
        ]}});
        let line = render_event_line(&assistant).unwrap();
        assert!(line.contains("Working on it."));
        assert!(line.contains("● Bash"));

        let result = json!({"type":"result","subtype":"success","num_turns":3});
        assert_eq!(
            render_event_line(&result).unwrap(),
            "— turn complete (success, 3 turns)"
        );
    }

    #[test]
    fn stays_silent_on_tool_results_and_unknown_events() {
        assert!(render_event_line(&json!({"type":"user","message":{}})).is_none());
        assert!(render_event_line(&json!({"type":"stream_event"})).is_none());
        assert!(render_event_line(&json!({"type":"system","subtype":"compact"})).is_none());
    }

    fn argv(raw: &[&str]) -> Vec<String> {
        raw.iter().map(|s| s.to_string()).collect()
    }

    /// Index of `flag`'s value in `args`, or None.
    fn value_of<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .map(String::as_str)
    }

    #[test]
    fn the_base_argv_pins_the_session_and_carries_the_stream_json_contract() {
        let a = headless_argv("sess-1", &[]);
        assert_eq!(value_of(&a, "--session-id"), Some("sess-1"));
        for flag in [
            "--print",
            "--verbose",
            "--dangerously-skip-permissions",
            "--input-format",
            "--output-format",
        ] {
            assert!(a.iter().any(|x| x == flag), "{flag} missing from {a:?}");
        }
        // Nothing invents a model: with no caller args the session rides the
        // account default, exactly as before.
        assert!(!a.iter().any(|x| x == "--model"));
    }

    #[test]
    fn a_caller_supplied_model_reaches_the_argv_exactly_once() {
        // What `dispatch_into_worktree` passes for an App Master code charter.
        // The id comes from `personas_core::model_ids` — the one door — rather
        // than a dated literal that would rot on the vendor's schedule.
        let opus = personas_core::model_ids::OPUS_CURRENT;
        let a = headless_argv("sess-2", &argv(&["--model", opus]));
        assert_eq!(
            a.iter().filter(|x| *x == "--model").count(),
            1,
            "exactly one --model in {a:?}"
        );
        assert_eq!(value_of(&a, "--model"), Some(opus));
        // …and it lands after the base flags, so the base contract is intact.
        assert_eq!(value_of(&a, "--session-id"), Some("sess-2"));
    }

    #[test]
    fn a_caller_cannot_duplicate_a_flag_the_base_argv_already_set() {
        // `claude` takes the LAST occurrence, so an un-dropped duplicate would
        // silently unpin the session id the registry keyed everything on.
        let opus = personas_core::model_ids::OPUS_CURRENT;
        let a = headless_argv(
            "sess-3",
            &argv(&["--session-id", "hijacked", "--model", opus]),
        );
        assert_eq!(a.iter().filter(|x| *x == "--session-id").count(), 1);
        assert_eq!(value_of(&a, "--session-id"), Some("sess-3"));
        assert!(!a.iter().any(|x| x == "hijacked"));
        assert_eq!(value_of(&a, "--model"), Some(opus));
    }

    #[test]
    fn extra_args_keep_their_order_and_their_positionals() {
        let a = headless_argv(
            "sess-4",
            &argv(&["--model", "m", "--add-dir", "/repo", "--flagless"]),
        );
        let tail: Vec<&str> = a
            .iter()
            .skip_while(|x| *x != "--model")
            .map(String::as_str)
            .collect();
        assert_eq!(
            tail,
            vec!["--model", "m", "--add-dir", "/repo", "--flagless"]
        );
    }

    #[test]
    fn the_turns_final_text_prefers_the_result_events_own_copy() {
        let assistant = json!({"type":"assistant","message":{"content":[
            {"type":"text","text":"Working on it."},
            {"type":"tool_use","name":"Bash","input":{}}
        ]}});
        // Tool calls are not prose — only the text blocks are the closing line.
        assert_eq!(
            assistant_text(&assistant).as_deref(),
            Some("Working on it.")
        );
        assert!(
            assistant_text(&json!({"type":"assistant","message":{"content":[
                {"type":"tool_use","name":"Bash","input":{}}
            ]}}))
            .is_none()
        );

        let result = json!({"type":"result","subtype":"success","result":"FLEET:DONE — shipped"});
        assert_eq!(
            turn_final_text(&result, Some("Working on it.")).as_deref(),
            Some("FLEET:DONE — shipped")
        );
        // The error subtypes carry no `result` field — fall back to the prose
        // the loop captured, or say nothing at all.
        let bare = json!({"type":"result","subtype":"error_during_execution"});
        assert_eq!(
            turn_final_text(&bare, Some("Working on it.")).as_deref(),
            Some("Working on it.")
        );
        assert!(turn_final_text(&bare, None).is_none());
        // An empty `result` is not a final text either.
        let empty = json!({"type":"result","result":"   "});
        assert_eq!(
            turn_final_text(&empty, Some("prose")).as_deref(),
            Some("prose")
        );
    }

    #[test]
    fn headless_user_message_is_line_delimited_json() {
        let line = headless_user_message("do the thing");
        assert!(line.ends_with('\n'));
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["content"][0]["text"], "do the thing");
    }
}
