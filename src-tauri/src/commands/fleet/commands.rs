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

/// Subscribe the frontend to a session's live PTY output and return the
/// current ring-buffer snapshot to hydrate a freshly-focused terminal.
///
/// Until a session is subscribed the reader buffers its output silently (no
/// IPC, no xterm parse) — this is what lets a 16-CLI fleet cost the app only
/// the watched stream(s). The returned snapshot is the recent scrollback
/// (capped at [`super::registry::OUTPUT_RING_CAP`]); the caller should `reset()`
/// its terminal and write the snapshot before processing live chunks, so a
/// re-focus doesn't duplicate what the buffered ring already contains.
#[tauri::command]
pub async fn fleet_subscribe_terminal(session_id: String) -> Result<String, String> {
    registry()
        .subscribe_output(&session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))
}

/// Stop forwarding a session's PTY output over IPC (the reader keeps buffering
/// into the ring, so a later re-subscribe replays the recent tail). Called when
/// a terminal pane detaches / goes off-screen. Idempotent.
#[tauri::command]
pub async fn fleet_unsubscribe_terminal(session_id: String) -> Result<(), String> {
    registry().unsubscribe_output(&session_id);
    Ok(())
}

/// Cooked terminal previews for the given sessions — the grid's *unwatched*
/// tiles poll this in one batched call instead of each mounting a live xterm.
/// Each entry is the last `lines` (default 24, capped 200) plain-text lines
/// from that session's output ring (ANSI/cursor sequences resolved). Unknown
/// sessions are omitted. The watched/active tile renders a real terminal and is
/// not polled here.
#[tauri::command]
pub async fn fleet_terminal_previews(
    session_ids: Vec<String>,
    lines: Option<usize>,
) -> Result<Vec<super::types::FleetTerminalPreview>, String> {
    let max_lines = lines.unwrap_or(24).clamp(1, 200);
    let previews = registry()
        .preview_outputs(&session_ids, max_lines)
        .into_iter()
        .map(|(session_id, lines)| super::types::FleetTerminalPreview { session_id, lines })
        .collect();
    Ok(previews)
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
    // Hard kill via the session's kill handle, then drop the PTY handles. A soft
    // "drop the writer" EOF does NOT stop interactive `claude` (it ignores stdin
    // EOF and lingers as a zombie shell), so route through close_pty_handles,
    // which calls killer.kill() first. The reaper picks up the exit and emits.
    if !registry().close_pty_handles(&session_id) {
        return Err(format!("session not found: {session_id}"));
    }
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
