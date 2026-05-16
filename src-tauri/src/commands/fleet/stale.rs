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
                FleetSessionState::Exited | FleetSessionState::Stale
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
