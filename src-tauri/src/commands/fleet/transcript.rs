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
        // tauri::async_runtime::spawn — see stale.rs spawn_ticker docstring
        // for why we don't use tokio::task::spawn from this sync setup path.
        tauri::async_runtime::spawn(async move {
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
                // Fold the newly-appended bytes into the session's compact
                // metadata rollup (the (B) abstraction) — cheap, delta-only,
                // raw output stays on disk.
                super::transcript_read::ingest_delta(&claude_session_id, path);
                // Primary: bump activity for the session already bound to this id.
                // Fallback: if nothing is bound to it yet, try to bind it to an
                // unbound Fleet session by the transcript's recorded cwd. This
                // covers a SessionStart hook that fired but never bound (observed:
                // claude runs + writes a transcript carrying Fleet's injected MCP,
                // yet the session stays `cc:-`). Without this, such a session is
                // mislabeled stale/never-attached and Insights has no id to read.
                if !refresh_activity(app, &claude_session_id) {
                    bind_unbound_by_cwd(app, path, &claude_session_id);
                }
            }
        }
    }
}

/// Grace (ms) allowed between a Fleet session spawning and its transcript
/// file being created. The transcript is created by `claude` shortly AFTER the
/// PTY spawns, so a legitimate transcript is created at/after `created_at_ms`;
/// the grace only absorbs clock skew.
const BIND_FRESHNESS_GRACE_MS: i64 = 5_000;

/// File-creation time in ms since the UNIX epoch, if resolvable.
fn file_created_ms(path: &Path) -> Option<i64> {
    let created = std::fs::metadata(path).ok()?.created().ok()?;
    let dur = created.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as i64)
}

/// Bind `claude_session_id` to an unbound Fleet session matched by the cwd
/// recorded inside the transcript — the watcher's reconciliation path when the
/// SessionStart hook didn't bind. Picks the most-recently-created unbound,
/// non-Exited session for that cwd (mirrors `resolve_session_id`'s bootstrap
/// preference) **whose spawn is consistent with this transcript's creation
/// time**, so it never grabs a *pre-existing* or *concurrent* same-cwd
/// transcript (e.g. the user's own Claude Code session, or a manual `claude`
/// run, in the same repo). No-op if no transcript cwd, no fresh match, or the
/// transcript's creation time can't be read (conservative — better unbound
/// than mis-bound).
fn bind_unbound_by_cwd(app: &AppHandle, path: &Path, claude_session_id: &str) {
    let Some(tcwd) = super::transcript_read::read_transcript_cwd(path) else {
        return;
    };
    let target = super::transcript_read::normalize_cwd(&tcwd);
    // A transcript created *before* a session spawned can't belong to it.
    let Some(transcript_created_ms) = file_created_ms(path) else {
        return;
    };

    let mut bound: Option<String> = None;
    {
        let mut map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        // Don't double-bind if some other session already claimed this id.
        if map.values().any(|s| s.claude_session_id.as_deref() == Some(claude_session_id)) {
            return;
        }
        let mut best_created = i64::MIN;
        let mut best_id: Option<String> = None;
        for s in map.values() {
            if s.claude_session_id.is_some() {
                continue;
            }
            if matches!(s.state, FleetSessionState::Exited | FleetSessionState::Hibernated) {
                continue;
            }
            if super::transcript_read::normalize_cwd(&s.cwd.to_string_lossy()) != target {
                continue;
            }
            // The transcript must have been created at/after this session
            // spawned (minus a small grace) — otherwise it's someone else's.
            if transcript_created_ms < s.created_at_ms - BIND_FRESHNESS_GRACE_MS {
                continue;
            }
            if s.created_at_ms > best_created {
                best_created = s.created_at_ms;
                best_id = Some(s.id.clone());
            }
        }
        if let Some(sid) = best_id {
            if let Some(s) = map.get_mut(&sid) {
                s.claude_session_id = Some(claude_session_id.to_string());
                s.last_activity_ms = now_ms();
                s.state = FleetSessionState::Running;
                s.state_reason = Some("Bound to transcript (SessionStart hook missed)".into());
                bound = Some(sid);
            }
        }
    }

    if let Some(sid) = bound {
        let _ = app.emit(
            event_name::FLEET_SESSION_STATE,
            FleetStatePayload {
                session_id: sid.clone(),
                state: "running",
                reason: Some("Bound to transcript".into()),
            },
        );
        super::pty::emit_registry_changed(app, "updated", &sid);
    }
}

/// The transcript filename is `<sessionId>.jsonl`. Strip the extension.
fn derive_claude_session_id(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

/// If a Fleet session is already bound to this `claude_session_id`, refresh its
/// `last_activity_ms` and re-animate it from Stale → Idle. Returns `true` if a
/// bound session matched (so the caller knows whether to attempt cwd-binding).
fn refresh_activity(app: &AppHandle, claude_session_id: &str) -> bool {
    let mut matched = false;
    let mut maybe_emit: Option<(String, FleetSessionState, String)> = None;
    {
        let mut map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        for session in map.values_mut() {
            if session.claude_session_id.as_deref() != Some(claude_session_id) {
                continue;
            }
            matched = true;
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
    matched
}
