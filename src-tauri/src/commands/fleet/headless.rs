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
use super::registry::{headless_user_message, now_ms, registry, FleetSessionInner, OutputRing, OUTPUT_RING_CAP};
use super::types::{FleetSessionMode, FleetSessionState};

/// `fleet-session-output` payload (mirrors the PTY reader's shape).
#[derive(Serialize, Clone)]
struct OutputPayload<'a> {
    session_id: &'a str,
    chunk: String,
}

/// `fleet-session-state` payload (mirrors the ticker's shape).
#[derive(Serialize, Clone)]
struct StatePayload<'a> {
    session_id: &'a str,
    state: &'a str,
    reason: Option<String>,
}

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

    let program: PathBuf = if cfg!(windows) {
        match crate::engine::cli_process::resolve_claude_exe_windows() {
            Some(p) => PathBuf::from(p),
            None => {
                return Err(
                    "fleet headless spawn: claude executable not found (checked the native \
                     installer %USERPROFILE%\\.local\\bin, the npm-global layout, and PATH)"
                        .to_string(),
                )
            }
        }
    } else {
        PathBuf::from("claude")
    };

    let mut cmd = Command::new(&program);
    cmd.arg("--print")
        // stream-json output with --print requires --verbose (per CLI contract).
        .arg("--verbose")
        .arg("--input-format")
        .arg("stream-json")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--dangerously-skip-permissions")
        .arg("--session-id")
        .arg(&claude_session_id);
    for a in &extra_args {
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

    let mut stdin = child.stdin.take().ok_or("headless spawn: no stdin handle")?;
    let stdout = child.stdout.take().ok_or("headless spawn: no stdout handle")?;
    let stderr = child.stderr.take().ok_or("headless spawn: no stderr handle")?;

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
        master: Mutex::new(None),
        writer: Mutex::new(Some(Box::new(stdin))),
        hibernating: std::sync::atomic::AtomicBool::new(false),
        output: output.clone(),
        killer: Some(Mutex::new(Box::new(PidKiller(child_pid)))),
    };
    registry().insert(inner);
    emit_registry_changed(&app, "added", &id);

    // Cheap LLM naming from the task, same as spawn-with-task on the PTY lane.
    super::naming::name_session_from_task(app.clone(), id.clone(), task);

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
            OutputPayload { session_id, chunk: framed },
        );
    }
}

/// Apply a state transition + emit the same events the other lanes emit.
fn transition(app: &AppHandle, session_id: &str, state: FleetSessionState, tag: &str, reason: &str) {
    if registry().set_state_direct(session_id, state, reason) {
        let _ = app.emit(
            event_name::FLEET_SESSION_STATE,
            StatePayload { session_id, state: tag, reason: Some(reason.to_string()) },
        );
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
            if parts.is_empty() { None } else { Some(parts.join("\r\n")) }
        }
        Some("result") => {
            let subtype = event.get("subtype").and_then(|s| s.as_str()).unwrap_or("done");
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

/// stdout loop — one stream-json event per line. Drives the state machine
/// (init → alive, assistant → Running, result → Idle) and feeds the ring.
fn stdout_loop(
    app: AppHandle,
    session_id: String,
    ring: Arc<Mutex<OutputRing>>,
    stdout: std::process::ChildStdout,
) {
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
            Some("assistant") | Some("user") => {
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
        assert_eq!(render_event_line(&init).unwrap(), "· session started (claude-sonnet-5)");

        let assistant = json!({"type":"assistant","message":{"content":[
            {"type":"text","text":"Working on it."},
            {"type":"tool_use","name":"Bash","input":{}}
        ]}});
        let line = render_event_line(&assistant).unwrap();
        assert!(line.contains("Working on it."));
        assert!(line.contains("● Bash"));

        let result = json!({"type":"result","subtype":"success","num_turns":3});
        assert_eq!(render_event_line(&result).unwrap(), "— turn complete (success, 3 turns)");
    }

    #[test]
    fn stays_silent_on_tool_results_and_unknown_events() {
        assert!(render_event_line(&json!({"type":"user","message":{}})).is_none());
        assert!(render_event_line(&json!({"type":"stream_event"})).is_none());
        assert!(render_event_line(&json!({"type":"system","subtype":"compact"})).is_none());
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
