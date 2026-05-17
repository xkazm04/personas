//! PTY spawn + I/O multiplexing for Fleet sessions.
//!
//! Uses `portable-pty` (wezterm) which wraps ConPTY on Windows and
//! `posix_openpt` on Unix behind one API.
//!
//! Ownership:
//! - `master` and `writer` → registry (for resize / write_input).
//! - `reader` → moved into a tokio blocking task that emits chunks.
//! - `child` → moved into a tokio blocking task that waits + marks exit.
//!
//! The two background tasks own their handles directly so they never need
//! to look anything up via the registry while blocked on I/O.

use std::path::PathBuf;
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::engine::event_registry::event_name;

use super::registry::{now_ms, registry, FleetSessionInner};
use super::types::FleetSessionState;

/// `fleet-session-output` event payload.
#[derive(Serialize, Clone)]
struct OutputPayload<'a> {
    session_id: &'a str,
    chunk: String,
}

/// `fleet-session-exited` event payload.
#[derive(Serialize, Clone)]
struct ExitedPayload<'a> {
    session_id: &'a str,
    exit_code: Option<i32>,
}

/// `fleet-registry-changed` event payload.
#[derive(Serialize, Clone)]
struct RegistryChangedPayload<'a> {
    kind: &'a str,
    session_id: &'a str,
}

/// Spawn a new Claude Code session in a PTY rooted at `cwd`.
///
/// Returns the freshly-minted internal `id` (UUID v4). The
/// `claude_session_id` will be `None` until the first SessionStart hook
/// fires — phase 4 wires that up.
///
/// # Errors
/// - `cwd` missing or not a directory
/// - a session is already active for the same `cwd`
/// - PTY allocation fails
/// - `claude` not on PATH
pub fn spawn_session(
    app: AppHandle,
    cwd: PathBuf,
    args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    if !cwd.exists() {
        return Err(format!("cwd does not exist: {}", cwd.display()));
    }
    if !cwd.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd.display()));
    }
    // Multiple sessions per cwd are allowed — users routinely want 2-5
    // parallel claude runs on the same project (one drafting tests, one
    // refactoring, one running e2e). The hook router in hooks.rs handles
    // the bootstrap-window cwd ambiguity by preferring the most-recently-
    // spawned still-unbound session for cwd-based routing.

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(40),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    // `claude` is published to npm as a Unix shell script with no
    // extension. PATH-searching for it on Windows finds the bare script,
    // which CreateProcessW then refuses to exec (OS error 193 — "is
    // not a valid Win32 application"). Two coexisting shims handle this:
    //   • `claude.cmd` (batch shim)  — works under cmd.exe
    //   • `claude.ps1` (PowerShell)  — works under powershell.exe
    // We pick the .cmd path on Windows and bare `claude` everywhere else.
    let mut cmd = if cfg!(windows) {
        // `cmd.exe /c claude <args>` lets PATHEXT resolve to claude.cmd.
        // Single composed string for the /c arg avoids per-arg quoting
        // pitfalls for the common no-arg case (the `args` Vec is empty
        // by default from fleet_spawn_session).
        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/c");
        let mut composed = String::from("claude");
        for a in &args {
            composed.push(' ');
            composed.push_str(a);
        }
        c.arg(composed);
        c
    } else {
        let mut c = CommandBuilder::new("claude");
        for a in &args {
            c.arg(a);
        }
        c
    };
    cmd.cwd(&cwd);
    // xterm-256color is what xterm.js natively understands.
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn `claude` failed: {e}"))?;
    let child_pid = child.process_id();

    // Slave is no longer needed in our process — the child owns its own fd.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let project_label = cwd
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let inner = FleetSessionInner {
        id: id.clone(),
        claude_session_id: None,
        cwd: cwd.clone(),
        project_label,
        name: None,
        args: args.clone(),
        state: FleetSessionState::Spawning,
        last_activity_ms: now,
        created_at_ms: now,
        child_pid,
        exit_code: None,
        state_reason: Some("PTY spawned".to_string()),
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(Some(writer)),
    };
    registry().insert(inner);

    // Notify the UI a new session showed up.
    emit_registry_changed(&app, "added", &id);

    // Reader task — blocking I/O on its own thread.
    let app_reader = app.clone();
    let id_reader = id.clone();
    tokio::task::spawn_blocking(move || reader_loop(app_reader, id_reader, reader));

    // Reaper task — owns the child directly, waits, marks exit, emits.
    let app_reaper = app.clone();
    let id_reaper = id.clone();
    tokio::task::spawn_blocking(move || reaper_loop(app_reaper, id_reaper, child));

    Ok(id)
}

/// Reader loop — blocks on `reader.read`, emits chunks, exits on EOF/error.
fn reader_loop(app: AppHandle, session_id: String, mut reader: Box<dyn std::io::Read + Send>) {
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                tracing::debug!(session_id = %session_id, "fleet PTY reader: EOF");
                break;
            }
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                let _ = app.emit(
                    event_name::FLEET_SESSION_OUTPUT,
                    OutputPayload {
                        session_id: &session_id,
                        chunk,
                    },
                );
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                tracing::warn!(session_id = %session_id, error = %e, "fleet PTY reader: error");
                break;
            }
        }
    }
}

/// Reaper loop — owns the child handle directly. Waits for exit, marks
/// state, emits events.
fn reaper_loop(
    app: AppHandle,
    session_id: String,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
) {
    let exit_code = match child.wait() {
        Ok(status) => {
            if status.success() {
                Some(0i32)
            } else {
                // ExitStatus::exit_code is u32 on windows; squeeze into i32
                // saturating for the UI. Unsigned >2^31 is unreachable in practice.
                let code: u32 = status.exit_code();
                Some(code.min(i32::MAX as u32) as i32)
            }
        }
        Err(e) => {
            tracing::warn!(session_id = %session_id, error = %e, "fleet child wait failed");
            None
        }
    };

    registry().mark_exited(&session_id, exit_code);
    let _ = app.emit(
        event_name::FLEET_SESSION_EXITED,
        ExitedPayload {
            session_id: &session_id,
            exit_code,
        },
    );
    emit_registry_changed(&app, "updated", &session_id);
}

/// Emit a registry-changed event from a Tauri command.
pub fn emit_registry_changed(app: &AppHandle, kind: &str, session_id: &str) {
    let _ = app.emit(
        event_name::FLEET_REGISTRY_CHANGED,
        RegistryChangedPayload { kind, session_id },
    );
}
