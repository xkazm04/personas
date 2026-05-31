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

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::engine::event_registry::event_name;

use super::registry::{now_ms, registry};
use super::transcript_read::transcript_size;
use super::types::FleetSessionState;

/// Per-session transcript growth tracking: `(last_size_bytes, last_grew_ms)`.
/// The ticker polls each session's JSONL size; real growth — not hook timing
/// or mtime touches — is the authoritative "is it actually working" signal.
/// This is what hardens Running↔Stale accuracy (logs flat for a while ⇒ not
/// really in progress; logs growing ⇒ active, even if no hook fired).
static TRANSCRIPT_GROWTH: OnceLock<Mutex<HashMap<String, (u64, i64)>>> = OnceLock::new();
fn growth_map() -> &'static Mutex<HashMap<String, (u64, i64)>> {
    TRANSCRIPT_GROWTH.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A session that hasn't seen activity in this long is flagged Stale.
/// 5 minutes — long enough that a thoughtful user typing slowly doesn't
/// trip it, short enough that a forgotten window is flagged before the
/// user circles back.
pub const STALE_AFTER_SECS: i64 = 5 * 60;

/// How long a session may sit `Spawning` with no bound `claude_session_id`
/// and no activity before we conclude `claude` never attached (trust-prompt
/// hang / crash / failed start). Claude Code binds the SessionStart hook
/// within seconds when it comes up, so 2 min is a confident verdict.
pub const NEVER_ATTACHED_SECS: i64 = 2 * 60;

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

/// Pure staleness decision for one session, given whether its transcript grew
/// this tick and how long since it last grew. Returns the new state to apply,
/// or `None` to leave it unchanged. Extracted so the rules are unit-tested.
///
/// Rules:
/// - grew + (`Stale`|`Idle`) → `Running` (active output revives it)
/// - grew + anything else → unchanged
/// - flat + (`Running`|`Idle`|`Spawning`) idle past the cutoff → `Stale`
/// - flat + `AwaitingInput` → unchanged (waiting on the user, not hung)
/// - already `Stale`/`Exited`/`Hibernated` → unchanged
fn staleness_transition(
    state: FleetSessionState,
    grew: bool,
    idle_since_ms: i64,
    now: i64,
    cutoff_ms: i64,
) -> Option<FleetSessionState> {
    use FleetSessionState::*;
    if grew {
        return match state {
            Stale | Idle => Some(Running),
            _ => None,
        };
    }
    match state {
        Stale | AwaitingInput | Exited | Hibernated => None,
        Running | Idle | Spawning if now - idle_since_ms >= cutoff_ms => Some(Stale),
        _ => None,
    }
}

/// True when a session looks like it never attached: still `Spawning`, no
/// Claude session id bound, and no activity for `idle_ms` past the threshold.
/// The transcript watcher bumps activity (by cwd, even pre-cc-id) for sessions
/// that actually run, so a frozen `idle_ms` here means nothing came up.
fn is_never_attached(
    state: FleetSessionState,
    has_cc_id: bool,
    idle_ms: i64,
    threshold_ms: i64,
) -> bool {
    matches!(state, FleetSessionState::Spawning) && !has_cc_id && idle_ms >= threshold_ms
}

/// One pass over the registry, hardened with real transcript-growth tracking:
///
/// - **Growth ⇒ active.** A session whose JSONL grew since the last tick is
///   genuinely producing output: refresh its activity, and if it was wrongly
///   showing `Stale` / `Idle`, bounce it back to `Running` (fixes "in-progress
///   shown as stale" — a working session can't stay stuck stale).
/// - **Flat ⇒ stale.** A `Running` / `Idle` / `Spawning` session whose logs
///   haven't grown for `STALE_AFTER_SECS` is not actually progressing → `Stale`
///   (fixes "stale shown as in progress"). Staleness is measured from the last
///   real log growth, not the last hook/mtime touch, so a hung session can't
///   masquerade as in-progress. `AwaitingInput` is left alone — it's
///   legitimately waiting for the user, not stale.
///
/// Sessions with no transcript yet (unbound `Spawning`) fall back to the
/// hook-driven `last_activity_ms` cutoff.
fn tick_once(app: &AppHandle) {
    let now = now_ms();
    let cutoff_ms = STALE_AFTER_SECS * 1000;

    // Pass A — snapshot the sessions worth checking (no IO under the lock).
    let snaps: Vec<(String, Option<String>)> = {
        let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| !matches!(s.state, FleetSessionState::Exited | FleetSessionState::Hibernated))
            .map(|s| (s.id.clone(), s.claude_session_id.clone()))
            .collect()
    };
    if snaps.is_empty() {
        auto_hibernate_pass(app);
        return;
    }

    // Pass B — stat transcript sizes (no registry lock). Track growth; the
    // `last_grew_ms` per session is the authoritative freshness signal.
    let mut grew_ids: HashSet<String> = HashSet::new();
    let mut last_grew: HashMap<String, i64> = HashMap::new();
    {
        let mut g = growth_map().lock().unwrap_or_else(|e| e.into_inner());
        for (id, csid) in &snaps {
            let Some(csid) = csid else { continue };
            let Some(size) = transcript_size(csid) else { continue };
            let entry = g.entry(id.clone()).or_insert((size, now));
            if size > entry.0 {
                entry.0 = size;
                entry.1 = now;
                grew_ids.insert(id.clone());
            }
            last_grew.insert(id.clone(), entry.1);
        }
        // Drop tracking for sessions that have gone away.
        let present: HashSet<&String> = snaps.iter().map(|(id, _)| id).collect();
        g.retain(|k, _| present.contains(k));
    }

    // Pass C — apply state changes under the lock, via the pure transition fn.
    let mut newly_stale: Vec<String> = Vec::new();
    let mut revived: Vec<String> = Vec::new();
    {
        let mut map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        for session in map.values_mut() {
            if matches!(session.state, FleetSessionState::Exited | FleetSessionState::Hibernated) {
                continue;
            }
            // Never-attached spawn: still `Spawning`, no Claude session id ever
            // bound, and no activity since spawn → claude never actually came up
            // (folder-trust prompt hang, crash, or failed start). Flag it
            // distinctly instead of mislabeling it generic "stale" 3 min later.
            // Safe because the transcript watcher bumps `last_activity_ms` (by
            // cwd, even before a cc id binds) for any session that's really
            // working — so a frozen `last_activity_ms` means nothing ran.
            if is_never_attached(
                session.state,
                session.claude_session_id.is_some(),
                now - session.last_activity_ms,
                NEVER_ATTACHED_SECS * 1000,
            ) {
                session.state = FleetSessionState::Stale;
                session.state_reason = Some(
                    "Claude never attached — the folder may need trust approval, or claude failed to start. Safe to kill.".into(),
                );
                newly_stale.push(session.id.clone());
                continue;
            }
            let grew = grew_ids.contains(&session.id);
            if grew {
                session.last_activity_ms = now;
            }
            // Prefer the last real log-growth time; fall back to hook-driven
            // last_activity for sessions without a transcript yet.
            let idle_since = last_grew.get(&session.id).copied().unwrap_or(session.last_activity_ms);
            match staleness_transition(session.state, grew, idle_since, now, cutoff_ms) {
                Some(FleetSessionState::Running) => {
                    session.state = FleetSessionState::Running;
                    session.state_reason = Some("Transcript growing — session is active".into());
                    revived.push(session.id.clone());
                }
                Some(FleetSessionState::Stale) => {
                    session.state = FleetSessionState::Stale;
                    session.state_reason = Some(format!("No log growth for {} min", STALE_AFTER_SECS / 60));
                    newly_stale.push(session.id.clone());
                }
                _ => {}
            }
        }
    }

    // Emit state changes outside the lock.
    for sid in revived {
        let _ = app.emit(
            event_name::FLEET_SESSION_STATE,
            FleetStatePayload { session_id: sid, state: "running", reason: Some("Transcript growing".into()) },
        );
    }
    for sid in newly_stale {
        let _ = app.emit(
            event_name::FLEET_SESSION_STATE,
            FleetStatePayload {
                session_id: sid,
                state: "stale",
                reason: Some(format!("No log growth for {} min", STALE_AFTER_SECS / 60)),
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

    // now=10_000_000ms, cutoff=5min. "fresh" grew 1min ago, "old" grew 6min ago.
    const NOW: i64 = 10_000_000;
    const CUTOFF: i64 = 5 * 60 * 1000;
    const FRESH: i64 = NOW - 60_000; // 1 min ago
    const OLD: i64 = NOW - 6 * 60_000; // 6 min ago

    #[test]
    fn growth_revives_stale_and_idle_to_running() {
        use FleetSessionState::*;
        assert_eq!(staleness_transition(Stale, true, OLD, NOW, CUTOFF), Some(Running));
        assert_eq!(staleness_transition(Idle, true, OLD, NOW, CUTOFF), Some(Running));
        // Growth while already Running / AwaitingInput → no state change.
        assert_eq!(staleness_transition(Running, true, OLD, NOW, CUTOFF), None);
        assert_eq!(staleness_transition(AwaitingInput, true, OLD, NOW, CUTOFF), None);
    }

    #[test]
    fn flat_logs_past_cutoff_go_stale() {
        use FleetSessionState::*;
        assert_eq!(staleness_transition(Running, false, OLD, NOW, CUTOFF), Some(Stale));
        assert_eq!(staleness_transition(Idle, false, OLD, NOW, CUTOFF), Some(Stale));
        assert_eq!(staleness_transition(Spawning, false, OLD, NOW, CUTOFF), Some(Stale));
    }

    #[test]
    fn flat_but_recent_stays_put() {
        use FleetSessionState::*;
        assert_eq!(staleness_transition(Running, false, FRESH, NOW, CUTOFF), None);
        assert_eq!(staleness_transition(Idle, false, FRESH, NOW, CUTOFF), None);
    }

    #[test]
    fn awaiting_input_is_never_staled_by_flat_logs() {
        // Waiting on the user is a correct state, not a hung one.
        assert_eq!(
            staleness_transition(FleetSessionState::AwaitingInput, false, OLD, NOW, CUTOFF),
            None,
        );
    }

    #[test]
    fn already_stale_or_terminal_unchanged() {
        use FleetSessionState::*;
        assert_eq!(staleness_transition(Stale, false, OLD, NOW, CUTOFF), None);
        assert_eq!(staleness_transition(Exited, false, OLD, NOW, CUTOFF), None);
        assert_eq!(staleness_transition(Hibernated, false, OLD, NOW, CUTOFF), None);
    }

    const ATTACH_MS: i64 = NEVER_ATTACHED_SECS * 1000;

    #[test]
    fn never_attached_flags_silent_unbound_spawn() {
        // Spawning, no cc id, idle past threshold → never attached.
        assert!(is_never_attached(FleetSessionState::Spawning, false, ATTACH_MS, ATTACH_MS));
    }

    #[test]
    fn never_attached_ignores_bound_or_active_or_recent() {
        use FleetSessionState::*;
        // Has a cc id → it attached.
        assert!(!is_never_attached(Spawning, true, ATTACH_MS, ATTACH_MS));
        // Recent activity (transcript watcher bumped it) → it's running.
        assert!(!is_never_attached(Spawning, false, 5_000, ATTACH_MS));
        // Already past Spawning → not our case.
        assert!(!is_never_attached(Running, false, ATTACH_MS, ATTACH_MS));
        assert!(!is_never_attached(Idle, false, ATTACH_MS, ATTACH_MS));
    }
}
