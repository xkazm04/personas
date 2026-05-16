//! JSONL transcript watcher.
//!
//! Watches `~/.claude/projects/` recursively for changes to `*.jsonl`
//! files (Claude Code's per-session transcripts). Each modification is
//! evidence that the session is still alive — we refresh
//! `last_activity_ms` so the staleness ticker doesn't promote it to
//! `Stale`.
//!
//! Why this exists alongside hooks:
//! - Hooks (phase 4) cover the *intent* signals (waiting, running, idle).
//! - This watcher covers the *aliveness* signal — even without hooks
//!   installed, transcript appends tell us "Claude is doing something".
//! - And if the user runs `claude` from a terminal we don't own (no
//!   PTY), this is the only way we learn about that session at all.
//!
//! Cross-platform note: `notify` v7 picks RecommendedWatcher per OS
//! (kqueue on macOS, inotify on Linux, ReadDirectoryChangesW on
//! Windows). All three give us per-file modify events.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use serde::Serialize;

use crate::engine::event_registry::event_name;

use super::registry::{now_ms, registry};
use super::types::FleetSessionState;

/// Returns `~/.claude/projects/` if the home dir is resolvable.
pub fn projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

#[derive(Serialize, Clone)]
struct FleetStatePayload {
    session_id: String,
    state: &'static str,
    reason: Option<String>,
}

/// Spawn the JSONL transcript watcher. Idempotent — call once from setup().
/// Returns silently if `~/.claude/projects/` doesn't exist (user hasn't
/// run Claude Code yet) — phase 4's hooks are still functional, this is
/// just a belt-and-suspenders fallback.
pub fn spawn_watcher(app: AppHandle) {
    let Some(dir) = projects_dir() else {
        tracing::debug!("fleet transcript watcher: no home directory");
        return;
    };
    if !dir.exists() {
        // CC hasn't been run yet — fine. Re-check periodically (60s) so
        // we pick up the directory once the user runs `claude` for the
        // first time.
        let app_clone = app.clone();
        tokio::task::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                if let Some(d) = projects_dir() {
                    if d.exists() {
                        spawn_watcher(app_clone.clone());
                        return;
                    }
                }
            }
        });
        return;
    }

    // notify's mpsc channel needs a std thread to drain (its callbacks
    // run on the watcher's OS thread). Spawn a long-lived thread.
    let dir_for_thread = dir.clone();
    let app_for_thread = app.clone();
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = match RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            notify::Config::default().with_poll_interval(Duration::from_secs(2)),
        ) {
            Ok(w) => w,
            Err(e) => {
                tracing::warn!(error = %e, "fleet transcript watcher: create failed");
                return;
            }
        };
        if let Err(e) = watcher.watch(&dir_for_thread, RecursiveMode::Recursive) {
            tracing::warn!(path = %dir_for_thread.display(), error = %e, "fleet transcript watcher: watch failed");
            return;
        }
        tracing::info!(path = %dir_for_thread.display(), "fleet transcript watcher started");

        for evt in rx.iter() {
            match evt {
                Ok(event) => handle_event(&app_for_thread, event),
                Err(e) => tracing::debug!(error = %e, "fleet transcript watcher: event error"),
            }
        }
    });
}

fn handle_event(app: &AppHandle, event: Event) {
    // We only care about file modifications/creations of .jsonl files.
    let is_relevant = matches!(
        event.kind,
        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Access(_)
    );
    if !is_relevant {
        return;
    }
    for path in &event.paths {
        if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            if let Some(claude_session_id) = derive_claude_session_id(path) {
                refresh_activity(app, &claude_session_id);
            }
        }
    }
}

/// The transcript filename is `<sessionId>.jsonl`. Strip the extension.
fn derive_claude_session_id(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

/// If a Fleet session matches this `claude_session_id`, refresh its
/// `last_activity_ms`. Re-animates Stale sessions back to Idle (or
/// preserves whatever the hook system has flipped them to since).
fn refresh_activity(app: &AppHandle, claude_session_id: &str) {
    let mut maybe_emit: Option<(String, FleetSessionState, String)> = None;
    {
        let mut map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        for session in map.values_mut() {
            if session.claude_session_id.as_deref() != Some(claude_session_id) {
                continue;
            }
            session.last_activity_ms = now_ms();
            // If we'd promoted this to Stale, the JSONL append proves it's
            // not — drop back to Idle (hooks will refine to AwaitingInput /
            // Running on the next event).
            if matches!(session.state, FleetSessionState::Stale) {
                session.state = FleetSessionState::Idle;
                session.state_reason = Some("Transcript append — session re-engaged".into());
                maybe_emit = Some((
                    session.id.clone(),
                    FleetSessionState::Idle,
                    "Transcript append".into(),
                ));
            }
            break;
        }
    }

    if let Some((sid, _state, reason)) = maybe_emit {
        let _ = app.emit(
            event_name::FLEET_SESSION_STATE,
            FleetStatePayload {
                session_id: sid,
                state: "idle",
                reason: Some(reason),
            },
        );
    }
}
