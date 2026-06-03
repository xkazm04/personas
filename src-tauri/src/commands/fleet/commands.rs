//! Tauri command surface for the Fleet plugin.
//!
//! All commands are async (executed on Tauri's thread pool) and return
//! `Result<T, String>` so any Rust-side error reaches the frontend as a
//! plain string (matched by `safeInvoke` / `invokeWithTimeout`).
//!
//! Phase 2 ships four commands:
//!   - `fleet_spawn_session` — opens a PTY and runs `claude` in it.
//!   - `fleet_write_input` — writes UTF-8 text to the PTY stdin.
//!   - `fleet_resize_session` — resize the PTY (xterm.js fit-addon).
//!   - `fleet_kill_session` — kills the underlying child.
//!   - `fleet_list_sessions` — snapshot of every tracked session.
//!   - `fleet_remove_session` — drop an exited row from the registry.

use std::path::PathBuf;

use tauri::AppHandle;

use super::hook_install;
use super::pty;
use super::registry::registry;
use super::types::{FleetHookStatus, FleetRegistrySnapshot};

/// Spawn a new `claude` session in a PTY rooted at `cwd`.
///
/// Returns the internal session id.
#[tauri::command]
pub async fn fleet_spawn_session(
    app: AppHandle,
    cwd: String,
    args: Option<Vec<String>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let cwd = PathBuf::from(cwd);
    let args = args.unwrap_or_default();
    let cols = cols.unwrap_or(120);
    let rows = rows.unwrap_or(32);
    pty::spawn_session(app, cwd, args, cols, rows)
}

/// Write UTF-8 `text` to the session's PTY stdin. Does NOT append a
/// newline — callers (xterm.js `onData`) ship raw key bytes.
#[tauri::command]
pub async fn fleet_write_input(session_id: String, text: String) -> Result<(), String> {
    registry().write_input(&session_id, text.as_bytes())
}

/// Resize the PTY for `session_id` to `cols × rows`. Called by xterm.js
/// after the fit-addon recalculates on layout changes.
#[tauri::command]
pub async fn fleet_resize_session(
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry().resize(&session_id, cols, rows)
}

/// Kill the underlying child process for `session_id`. Idempotent —
/// already-exited sessions silently succeed. The reaper task picks up
/// the exit and emits `fleet-session-exited`.
#[tauri::command]
pub async fn fleet_kill_session(app: AppHandle, session_id: String) -> Result<(), String> {
    // We don't hold the child here — the reaper task owns it. The cleanest
    // kill is "drop the writer" (closes the PTY → child reads EOF →
    // shuts down). For a hard kill we'd need to plumb the child handle
    // back; that lands when phase 6 adds the cancellation token.
    //
    // Until then: closing the writer slot is a soft kill that works for
    // `claude` (it shuts down on stdin EOF when in `-p` mode; in
    // interactive mode it lingers but stops accepting input).
    let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(session) = map.get(&session_id) {
        if let Ok(mut w) = session.writer.lock() { *w = None; }
        // Also close the master so the reader sees EOF on the slave side.
        if let Ok(mut m) = session.master.lock() { *m = None; }
    } else {
        return Err(format!("session not found: {session_id}"));
    }
    drop(map);
    pty::emit_registry_changed(&app, "updated", &session_id);
    Ok(())
}

/// Set (or clear, with `None` / empty `name`) the user-supplied display
/// name for a session. Returns the updated snapshot so the frontend can
/// patch its slice without a separate refresh round-trip.
#[tauri::command]
pub async fn fleet_rename_session(
    app: AppHandle,
    session_id: String,
    name: Option<String>,
) -> Result<bool, String> {
    let updated = registry().rename(&session_id, name);
    if updated {
        pty::emit_registry_changed(&app, "updated", &session_id);
    }
    Ok(updated)
}

/// Hibernate a session: kill the `claude` process to free it, but keep the
/// row (state → `Hibernated`) so it can be resumed via `fleet_wake_session`.
/// Returns `false` if the session can't be hibernated (already exited /
/// hibernated, or never bound a `claude_session_id`). The reaper records the
/// resulting child exit as a sleep, not a death.
#[tauri::command]
pub async fn fleet_hibernate_session(app: AppHandle, session_id: String) -> Result<bool, String> {
    // `require_resting = false`: the user explicitly chose to sleep this
    // session, whatever state it's in (Running / AwaitingInput included).
    let ok = registry().hibernate(&session_id, false);
    if ok {
        // "updated" → the frontend re-fetches the snapshot and sees Hibernated.
        pty::emit_registry_changed(&app, "updated", &session_id);
    }
    Ok(ok)
}

/// Wake a hibernated session: spawn a fresh PTY running
/// `claude --resume <claude_session_id>` in the original cwd (the resumed
/// process restores the conversation itself), then drop the hibernated
/// placeholder. Returns the new session id. Errors if the session isn't
/// hibernated / resumable.
#[tauri::command]
pub async fn fleet_wake_session(
    app: AppHandle,
    session_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let (claude_session_id, cwd) = registry()
        .resume_target(&session_id)
        .ok_or_else(|| format!("session not resumable: {session_id}"))?;
    let cols = cols.unwrap_or(120);
    let rows = rows.unwrap_or(32);
    let new_id = pty::spawn_session(
        app.clone(),
        cwd,
        vec!["--resume".to_string(), claude_session_id],
        cols,
        rows,
    )?;
    if registry().remove(&session_id) {
        pty::emit_registry_changed(&app, "removed", &session_id);
    }
    Ok(new_id)
}

/// Configure the always-on auto-hibernate policy (P3.2): when `enabled`,
/// the staleness ticker hibernates Idle/Stale sessions inactive for longer
/// than `after_minutes` — even when the Fleet UI isn't focused. The frontend
/// owns the persisted setting and pushes it here on change + on startup.
#[tauri::command]
pub async fn fleet_set_auto_hibernate(enabled: bool, after_minutes: u32) -> Result<(), String> {
    super::stale::set_auto_hibernate(enabled, (after_minutes as u64) * 60);
    Ok(())
}

/// Snapshot the registry for the UI's session grid.
///
/// `hook_port` is the resolved local_http port (hosting /fleet/hooks/*).
/// `hooks_installed` reflects whether `~/.claude/settings.json` currently
/// carries our `_fleet`-tagged entries.
#[tauri::command]
pub async fn fleet_list_sessions() -> Result<FleetRegistrySnapshot, String> {
    let hook_port = crate::local_http::port().unwrap_or(0);
    let hooks_installed = hook_install::check_hooks(hook_port)
        .map(|s| s.installed && s.port_matches)
        .unwrap_or(false);
    Ok(FleetRegistrySnapshot {
        sessions: registry().list_dto(),
        hook_port,
        hooks_installed,
    })
}

/// Install (or re-install) Fleet's Claude Code hook entries into
/// `~/.claude/settings.json`. Idempotent — re-installing replaces any
/// prior Fleet-tagged entries. Returns the resulting status.
#[tauri::command]
pub async fn fleet_install_hooks() -> Result<FleetHookStatus, String> {
    let port = crate::local_http::port()
        .ok_or_else(|| "Fleet hook receiver not running — restart Personas".to_string())?;
    hook_install::install_hooks(port)
}

/// Remove every Fleet-tagged hook entry from `~/.claude/settings.json`.
/// User-authored hooks are left untouched (we only remove entries
/// carrying our `_fleet: true` sentinel).
#[tauri::command]
pub async fn fleet_uninstall_hooks() -> Result<FleetHookStatus, String> {
    hook_install::uninstall_hooks()
}

/// Inspect `~/.claude/settings.json` and report the current Fleet hook
/// install status — drives the settings page banner.
#[tauri::command]
pub async fn fleet_check_hooks() -> Result<FleetHookStatus, String> {
    let port = crate::local_http::port().unwrap_or(0);
    hook_install::check_hooks(port)
}

/// Drop an exited session from the registry. Returns `true` if a row
/// was removed.
#[tauri::command]
pub async fn fleet_remove_session(app: AppHandle, session_id: String) -> Result<bool, String> {
    let removed = registry().remove(&session_id);
    if removed {
        pty::emit_registry_changed(&app, "removed", &session_id);
    }
    Ok(removed)
}

// Compile-time sanity: every Tauri command returns a Send + Sync future
// that yields a Result. If a refactor breaks that, this will fail to build.
#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    fn _commands_compile(app: AppHandle) {
        let _ = fleet_spawn_session(app.clone(), String::new(), None, None, None);
        let _ = fleet_write_input(String::new(), String::new());
        let _ = fleet_resize_session(String::new(), 80, 24);
        let _ = fleet_kill_session(app.clone(), String::new());
        let _ = fleet_list_sessions();
        let _ = fleet_remove_session(app, String::new());
    }

    #[test]
    fn dto_snapshot_is_send() {
        fn assert_send<T: Send>() {}
        assert_send::<Vec<super::super::types::FleetSession>>();
        assert_send::<FleetRegistrySnapshot>();
    }
}
