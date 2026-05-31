//! Staleness ticker — promotes `Idle` (and any non-Exited state with no
//! recent activity) to `Stale` when the session has been silent for
//! [`STALE_AFTER_SECS`] seconds.
//!
//! Hooks (phase 4) already drive the primary state transitions; this
//! ticker fills the gap when a session goes silent without any hook
//! firing (user walked away, model deadlocked, etc.).
//!
//! Spawned from `setup()` in lib.rs as a never-completing
//! `tokio::task::spawn`. Runs every [`TICK_INTERVAL_SECS`] seconds.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::engine::event_registry::event_name;

use super::registry::{now_ms, registry};
use super::types::FleetSessionState;

/// A session that hasn't seen activity in this long is flagged Stale.
/// 5 minutes — long enough that a thoughtful user typing slowly doesn't
/// trip it, short enough that a forgotten window is flagged before the
/// user circles back.
pub const STALE_AFTER_SECS: i64 = 5 * 60;

/// How often the ticker runs. 30s is a good balance between
/// responsiveness and idle CPU.
pub const TICK_INTERVAL_SECS: u64 = 30;

// ---------------------------------------------------------------------------
// Auto-hibernate policy (P3.2) — process-wide, set from the frontend via
// `fleet_set_auto_hibernate` and read by the always-on ticker, so idle
// sessions are freed even when the Fleet UI isn't focused. Default OFF
// (never kill a process without explicit opt-in).
// ---------------------------------------------------------------------------
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static AUTO_HIBERNATE_ENABLED: AtomicBool = AtomicBool::new(false);
/// Inactivity threshold before an Idle/Stale session is auto-hibernated.
/// 30 min default; floored at 60s by `set_auto_hibernate`.
static AUTO_HIBERNATE_AFTER_SECS: AtomicU64 = AtomicU64::new(30 * 60);

/// Update the auto-hibernate policy. Called by `fleet_set_auto_hibernate`.
pub fn set_auto_hibernate(enabled: bool, after_secs: u64) {
    AUTO_HIBERNATE_ENABLED.store(enabled, Ordering::Relaxed);
    AUTO_HIBERNATE_AFTER_SECS.store(after_secs.max(60), Ordering::Relaxed);
}

#[derive(Serialize, Clone)]
struct FleetStatePayload {
    session_id: String,
    state: &'static str,
    reason: Option<String>,
}

/// Spawn the staleness ticker. Idempotent — the caller should call this
/// at most once (in `setup()`).
///
/// Uses `tauri::async_runtime::spawn` instead of `tokio::task::spawn`
/// because Tauri 2's `setup()` callback runs in a sync context with no
/// thread-local Tokio reactor; the bare `tokio::task::spawn` panics
/// there. Tauri's async_runtime is the runtime Tauri itself owns and is
/// safe to spawn into from the setup hook.
pub fn spawn_ticker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_INTERVAL_SECS));
        // First tick fires immediately; skip it to give the app a moment to settle.
        interval.tick().await;
        loop {
            interval.tick().await;
            tick_once(&app);
        }
    });
}

/// One pass over the registry: find non-Exited / non-Stale sessions whose
/// `last_activity_ms` is older than the cutoff and flip them to Stale.
fn tick_once(app: &AppHandle) {
    let cutoff = now_ms() - (STALE_AFTER_SECS * 1000);
    let mut newly_stale: Vec<String> = Vec::new();

    {
        let mut map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        for session in map.values_mut() {
            if matches!(
                session.state,
                FleetSessionState::Exited | FleetSessionState::Stale | FleetSessionState::Hibernated
            ) {
                continue;
            }
            if session.last_activity_ms < cutoff {
                session.state = FleetSessionState::Stale;
                session.state_reason = Some(format!(
                    "No activity for {} minutes",
                    STALE_AFTER_SECS / 60
                ));
                newly_stale.push(session.id.clone());
            }
        }
    }

    // Emit one event per session that changed state. Done outside the lock.
    for sid in newly_stale {
        let _ = app.emit(
            event_name::FLEET_SESSION_STATE,
            FleetStatePayload {
                session_id: sid,
                state: "stale",
                reason: Some(format!(
                    "No activity for {} minutes",
                    STALE_AFTER_SECS / 60
                )),
            },
        );
    }

    auto_hibernate_pass(app);
}

/// Auto-hibernate Idle/Stale sessions that have been inactive past the
/// configured threshold (P3.2). Only fires when enabled; only targets
/// genuinely-resting sessions with a bound `claude_session_id` (so they can
/// be resumed) — never `AwaitingInput` (the user may be mid-response).
fn auto_hibernate_pass(app: &AppHandle) {
    if !AUTO_HIBERNATE_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let after_secs = AUTO_HIBERNATE_AFTER_SECS.load(Ordering::Relaxed) as i64;
    let cutoff = now_ms() - after_secs * 1000;

    // Collect candidates under the lock, then hibernate outside it (hibernate
    // re-locks the registry).
    let candidates: Vec<String> = {
        let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                matches!(s.state, FleetSessionState::Idle | FleetSessionState::Stale)
                    && s.claude_session_id.is_some()
                    && s.last_activity_ms < cutoff
            })
            .map(|s| s.id.clone())
            .collect()
    };

    for sid in candidates {
        if registry().hibernate(&sid) {
            tracing::info!(session_id = %sid, "fleet auto-hibernate: slept idle session");
            let _ = app.emit(
                event_name::FLEET_SESSION_STATE,
                FleetStatePayload {
                    session_id: sid,
                    state: "hibernated",
                    reason: Some(format!("Auto-hibernated after {} min idle", after_secs / 60)),
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoff_is_sane() {
        // Sanity: 5 minutes is between 1 minute (too jumpy) and 60 minutes (too slow).
        assert!(STALE_AFTER_SECS >= 60);
        assert!(STALE_AFTER_SECS <= 3600);
    }
}
