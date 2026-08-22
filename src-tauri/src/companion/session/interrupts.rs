//! The process-wide registries a running turn can be stopped through: the
//! interrupt set, the live build-turn set, and the autonomy generation counters
//! that make a superseded continuation inert.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

/// In-flight turn ids that the user has asked to interrupt. `run_cli`
/// polls this set every ~200ms via `tokio::select!`; on hit, it
/// `start_kill()`s the child CLI and returns whatever text was streamed
/// so far so the partial reply still becomes the persisted assistant
/// turn (annotated with `[interrupted]`).
///
/// A plain `Mutex<HashSet<String>>` is fine here — contention is one
/// insert per Stop click, one read every 200ms during a streaming
/// turn; the lock is held for microseconds.
static INTERRUPTED_TURNS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Mark a turn for interruption. The streaming loop will detect it on
/// its next ~200ms tick, kill the child, and finalize whatever text
/// it already received.
pub fn request_interrupt(turn_id: &str) {
    if let Ok(mut g) = INTERRUPTED_TURNS.lock() {
        g.insert(turn_id.to_string());
    }
}

pub(super) fn was_interrupted(turn_id: &str) -> bool {
    INTERRUPTED_TURNS
        .lock()
        .map(|g| g.contains(turn_id))
        .unwrap_or(false)
}

pub(super) fn clear_interrupt(turn_id: &str) {
    if let Ok(mut g) = INTERRUPTED_TURNS.lock() {
        g.remove(turn_id);
    }
}

/// Active build turns keyed by session id (`webbuild:<project_id>`) → the
/// in-flight `turn_id`. Lets the Studio Stop button interrupt a build turn by
/// project — the frontend never sees the turn id. Set for the duration of
/// `run_build_turn`, cleared on every exit path by `BuildTurnGuard`.
pub(super) static ACTIVE_BUILD_TURNS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Interrupt the in-flight build turn for `session_id`, if any. Returns whether a
/// turn was found. The streaming loop kills the child within ~200ms and finalizes
/// whatever partial reply it has — same path as the main chat's Stop button.
pub fn request_build_interrupt(session_id: &str) -> bool {
    let turn = ACTIVE_BUILD_TURNS
        .lock()
        .ok()
        .and_then(|g| g.get(session_id).cloned());
    match turn {
        Some(turn_id) => {
            request_interrupt(&turn_id);
            true
        }
        None => false,
    }
}

/// Clears the `session_id → turn_id` entry on drop, so it's removed on every
/// `run_build_turn` exit (success, error, early `?` return).
pub(super) struct BuildTurnGuard(pub(super) String);
impl Drop for BuildTurnGuard {
    fn drop(&mut self) {
        if let Ok(mut g) = ACTIVE_BUILD_TURNS.lock() {
            g.remove(&self.0);
        }
    }
}

/// Cancellation flag for the in-flight autonomous-continuation tick.
///
/// We use a flag (not a `JoinHandle::abort`) for two reasons:
///
/// 1. `send_turn`'s future is `!Send` (multiple captures across awaits
///    that the Tauri command path tolerates but `tauri::async_runtime
///    ::spawn` doesn't), so we can't put it inside a `spawn` and rely
///    on `abort()` anyway. The scheduler uses `spawn_blocking` with a
///    fresh single-threaded tokio runtime instead — `abort()` on a
///    blocking task is a soft signal, so we'd need a flag here either
///    way.
///
/// 2. The semantics from Q3 are "stop = next user input"; that's a
///    cooperative pause, not a process-kill. A flag the spawned task
///    checks before each potentially-blocking step is exactly that.
///    Monotonic generation counters for autonomous continuation ticks, **keyed by
///    conversation** (multiconv P1): a user message in thread A must not cancel a
///    pending tick in thread B. Each scheduled tick captures its conversation's
///    current value; cancelling advances it. A tick aborts as soon as its
///    conversation's value no longer matches the one it captured.
///
/// This replaces a single `AtomicBool` that was *reset* on every new schedule:
/// a user "stop" set the bool, but if that same turn's reply also emitted
/// `continue_autonomously`, `schedule_autonomous_tick` reset the bool and the
/// originally-pending tick — still polling — saw `cancelled == false` and fired,
/// so the loop the user halted kept running (bug-hunt 2026-06-07 companion #1).
/// A generation token is never reset (only advanced), so a stale tick can never
/// be revived by a later schedule. (The single global counter era ended with
/// the conversation keying; same never-reset invariant per key.)
static AUTONOMOUS_GENS: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);

/// Read (and materialize) a conversation's current generation. Materializing on
/// read means `cancel_all_pending_autonomy` can bump every conversation that
/// ever scheduled or checked a tick.
pub(super) fn autonomy_gen_of(conversation_id: &str) -> u64 {
    let mut guard = AUTONOMOUS_GENS.lock().expect("autonomy gen map poisoned");
    *guard
        .get_or_insert_with(HashMap::new)
        .entry(conversation_id.to_string())
        .or_insert(0)
}

/// Cancel this conversation's pending continuation tick(s) by advancing its
/// generation. Other conversations' chains are untouched.
pub fn cancel_pending_autonomy(conversation_id: &str) {
    let mut guard = AUTONOMOUS_GENS.lock().expect("autonomy gen map poisoned");
    *guard
        .get_or_insert_with(HashMap::new)
        .entry(conversation_id.to_string())
        .or_insert(0) += 1;
}

/// Cancel pending continuation ticks in EVERY conversation — the explicit
/// stop-button semantics (`companion_cancel_autonomy`).
pub fn cancel_all_pending_autonomy() {
    let mut guard = AUTONOMOUS_GENS.lock().expect("autonomy gen map poisoned");
    if let Some(map) = guard.as_mut() {
        for gen in map.values_mut() {
            *gen += 1;
        }
    }
}

/// Has a newer schedule or a cancel superseded the tick that captured `my_gen`
/// on this conversation?
pub(super) fn autonomous_superseded(conversation_id: &str, my_gen: u64) -> bool {
    autonomy_gen_of(conversation_id) != my_gen
}
