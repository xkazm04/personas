//! Synthetic load harness — the instrument that decides the React-vs-Rust-UI question.
//!
//! ## Why this exists
//!
//! The Monitor's cost was measured once at idle (7 personas, no traffic) and the
//! numbers said "React is free". That measurement answers the wrong question.
//! The regime that matters is the one the operator is building toward: hundreds
//! of agents and CLI sessions under control, terminals logging continuously,
//! state flipping constantly, Athena operating in the background. Nobody has a
//! number for that, and an architecture decision that large should not be made
//! on an idle reading or on anyone's intuition.
//!
//! So: a reproducible load generator, and the same load pointed at whichever UI
//! we are testing. React today; a Leptos/WASM island or a canvas renderer next.
//! The comparison is only fair if all of them receive **identical** load through
//! the **real** transport, which is the single constraint that shaped this file.
//!
//! ## Why it lives in Rust and not in a test script
//!
//! Because the transport is part of what is being measured. A JS-side generator
//! that pushed rows straight into the Zustand store would skip Tauri's event
//! serialization, the IPC thread, the webview message port and the event bridge
//! — i.e. most of the per-event cost — and would flatter every renderer equally
//! but wrongly. Load is emitted here, through `app.emit`, exactly as the real
//! PTY reader and the real registry do it.
//!
//! ## Why synthetic sessions are inserted into the REAL registry
//!
//! `fleetPatchSession` on the frontend only patches rows it already has, so
//! events naming sessions that do not exist are silently dropped and would
//! measure nothing. To make the load reach the UI, the harness inserts real
//! `FleetSessionInner` rows into the process-wide `FleetRegistry` — the same
//! structure a spawned session lands in — with no PTY attached. That is a
//! supported shape, not a hack: `master`/`writer` are `Option` ("None after
//! exit") and `killer` is documented as "None only in test fixtures", and
//! `persist::inner_from_row` already builds exactly this PTY-less form when
//! restoring sessions after a restart.
//!
//! **Residue: none.** The registry is `static OnceLock<FleetRegistry>` holding a
//! `Mutex<HashMap>` — pure process memory. Synthetic rows are never persisted,
//! `stop()` removes every one of them, and an app restart clears them
//! regardless. The harness performs no database writes at all.
//!
//! ## What this DOES load, and what it does not
//!
//! Loads (all through real events):
//!   * `fleet-session-output` — terminal streaming, the highest-volume path in
//!     the app, and the one that reaches xterm's WebGL renderer.
//!   * `fleet-session-state` — session lifecycle flips, which repaint the
//!     Activity board's session tiles and drive the transition ledger.
//!   * `fleet-registry-changed` — membership churn, which triggers a real
//!     `fleetRefresh()` round-trip.
//!
//! Does NOT load, and this is a stated gap rather than a silent one:
//!   * **channel/conversation volume** and **the triage queue** are POLL-driven
//!     and read the database. Loading them faithfully means writing rows into
//!     the operator's real database, which this harness will not do. They need
//!     a synthetic read-path source before they can be included — that is the
//!     v2 item, and until it exists any result here understates channel cost.
//!   * **persona count.** Personas are database rows; the board's tile count
//!     cannot be inflated without writes. Test with the fleet you have, and
//!     read the per-tile cost from the session tiles, which the harness DOES
//!     scale.
//!
//! ## Reproducibility
//!
//! Every random choice (which session emits, how long a chunk is, which state a
//! flip lands on) comes from a seeded xorshift, so two runs at the same profile
//! and seed emit the same sequence. Without that, comparing two renderers means
//! comparing two different workloads.

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tokio::sync::watch;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use personas_core::events::event_name;

use crate::commands::fleet::registry::{registry, FleetSessionInner};
use crate::commands::fleet::types::{FleetSessionMode, FleetSessionState};

/// Prefix on every synthetic session id. Unmistakable in the UI, and the only
/// thing `stop()` needs in order to remove exactly what the harness created and
/// nothing an operator spawned.
const SYNTHETIC_PREFIX: &str = "loadgen-";

/// Tick period. 50ms is fine-grained enough that a 200 lines/sec rate arrives as
/// ~10 chunks of traffic per tick rather than one burst per second — bursts
/// measure the scheduler's recovery, not the sustained cost we are after.
const TICK_MS: u64 = 50;

/// Bound on a single tick's emissions, per stream. A runaway profile should
/// degrade into "the harness could not keep up" (visible in `emitted` vs the
/// requested rate) rather than into an unbounded emit loop that wedges the
/// runtime and destroys the measurement it was taking.
const MAX_PER_TICK: usize = 2_000;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/// One step of load. Every field is a RATE, not a total, so the runner can hold
/// a level for a while and read a steady state instead of a transient.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProfile {
    /// Synthetic sessions present in the registry. Reconciled on every `set`:
    /// raising it inserts, lowering it removes, so a ramp does not restart.
    #[serde(default)]
    pub sessions: usize,
    /// Terminal output lines per second, summed across all synthetic sessions.
    #[serde(default)]
    pub lines_per_sec: usize,
    /// Session lifecycle transitions per second.
    #[serde(default)]
    pub state_flips_per_sec: usize,
    /// Characters per emitted output line. Real Claude output runs wide; the
    /// default is deliberately not 10, because per-event overhead and per-byte
    /// cost are different curves and a short line hides the second one.
    #[serde(default = "default_line_len")]
    pub line_len: usize,
    /// Seed for the emission sequence. Same seed + same profile = same run.
    #[serde(default = "default_seed")]
    pub seed: u64,
}

fn default_line_len() -> usize {
    120
}
fn default_seed() -> u64 {
    0x5EED_1234_ABCD_0001
}

/// What the harness actually did, for the runner to compare against what it
/// asked for. A profile the generator could not sustain is a finding in itself
/// — it means the emit path saturated before the renderer did.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadStatus {
    pub running: bool,
    pub profile: LoadProfile,
    pub live_sessions: usize,
    pub emitted_output: u64,
    pub emitted_state: u64,
    pub ticks: u64,
    /// Wall-clock ms since the current profile was applied.
    pub uptime_ms: i64,
    /// Emits that returned `Err`. Non-zero means the transport refused traffic
    /// the harness believes it sent, so `emitted_*` overstates the real load and
    /// every renderer number in that step is measuring less than the label says.
    pub emit_errors: u64,
    /// Ticks whose body panicked and were caught. Any value but 0 invalidates
    /// the step: the generator skipped work it does not know it skipped.
    pub tick_panics: u64,
    /// Ms since the driver last completed a tick. The stall read: while
    /// `running` is true this should sit near TICK_MS, and a large value means
    /// the generator is wedged and the load stopped without the rates changing.
    pub since_last_tick_ms: i64,
    /// False while `running` is true = the driver task is gone (panicked out of
    /// its loop, or never started). The load is not being produced; discard the
    /// run rather than reading the flat numbers as a fast renderer.
    pub driver_alive: bool,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct Harness {
    running: AtomicBool,
    /// Guards the driver task so two `set` calls cannot start two of them.
    started: AtomicBool,
    sessions: AtomicUsize,
    lines_per_sec: AtomicUsize,
    state_flips_per_sec: AtomicUsize,
    line_len: AtomicUsize,
    seed: AtomicU64,
    emitted_output: AtomicU64,
    emitted_state: AtomicU64,
    ticks: AtomicU64,
    emit_errors: AtomicU64,
    tick_panics: AtomicU64,
    last_tick_ms: AtomicI64,
    applied_at_ms: AtomicI64,
    /// Fractional carry, so a rate that is not a whole number of events per tick
    /// still averages out correctly instead of truncating to zero. At 50ms ticks
    /// a naive `rate / 20` floors every rate below 20/sec to nothing.
    carry_output: Mutex<f64>,
    carry_state: Mutex<f64>,
}

impl Default for Harness {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            started: AtomicBool::new(false),
            sessions: AtomicUsize::new(0),
            lines_per_sec: AtomicUsize::new(0),
            state_flips_per_sec: AtomicUsize::new(0),
            line_len: AtomicUsize::new(default_line_len()),
            seed: AtomicU64::new(default_seed()),
            emitted_output: AtomicU64::new(0),
            emitted_state: AtomicU64::new(0),
            ticks: AtomicU64::new(0),
            emit_errors: AtomicU64::new(0),
            tick_panics: AtomicU64::new(0),
            last_tick_ms: AtomicI64::new(0),
            applied_at_ms: AtomicI64::new(0),
            carry_output: Mutex::new(0.0),
            carry_state: Mutex::new(0.0),
        }
    }
}

static HARNESS: OnceLock<Arc<Harness>> = OnceLock::new();

/// Shutdown signal for the driver loop. A `watch` rather than an `AtomicBool`
/// because the loop must be able to *wait* on it inside `tokio::select!` — a
/// flag it can only poll between ticks is not a loop you can stop, it is a loop
/// that stops eventually (golden path: background-loop).
static SHUTDOWN: OnceLock<(watch::Sender<bool>, watch::Receiver<bool>)> = OnceLock::new();

fn shutdown_channel() -> &'static (watch::Sender<bool>, watch::Receiver<bool>) {
    SHUTDOWN.get_or_init(|| watch::channel(false))
}

/// The driver's join handle, retained rather than discarded.
///
/// Every spawn decides who waits, and here the answer is `status()`: a detached
/// task that dies takes the entire measurement with it, and a run that reports
/// flat numbers because the generator was dead looks exactly like a run that
/// reports flat numbers because the renderer was fast. `driver_alive` is the
/// only thing standing between those two readings.
static DRIVER: OnceLock<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> = OnceLock::new();

fn driver_slot() -> &'static Mutex<Option<tauri::async_runtime::JoinHandle<()>>> {
    DRIVER.get_or_init(|| Mutex::new(None))
}

fn harness() -> &'static Arc<Harness> {
    HARNESS.get_or_init(|| Arc::new(Harness::default()))
}

/// Record an emit failure.
///
/// `app.emit` fails permanently per call site when a payload cannot be
/// serialised, so discarding the Result would make "this event has never once
/// been delivered" indistinguishable from "delivered" — in a harness whose
/// entire job is to know how much load actually arrived, that is the one
/// discard that could invalidate every number it produces.
///
/// The emit itself stays at the CALL SITE rather than moving in here, so the
/// event name at the boundary is literally an `event_name::` constant. A helper
/// that took the name would have put a threaded `&str` there instead, which is
/// how an event reaches the frontend without being declared in the registry
/// both sides read.
fn note_emit_failure(h: &Harness, name: &str, e: &tauri::Error) {
    h.emit_errors.fetch_add(1, Ordering::Relaxed);
    tracing::warn!(event = name, error = %e, "load harness: emit failed");
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// xorshift64*. Not cryptographic and not trying to be — it needs to be fast,
/// allocation-free and *identical across runs*, which `rand`'s thread RNG is not.
fn next_rand(state: &AtomicU64) -> u64 {
    let mut x = state.load(Ordering::Relaxed);
    if x == 0 {
        x = default_seed();
    }
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    state.store(x, Ordering::Relaxed);
    x
}

// ---------------------------------------------------------------------------
// Synthetic sessions
// ---------------------------------------------------------------------------

fn synthetic_id(i: usize) -> String {
    format!("{SYNTHETIC_PREFIX}{i:04}")
}

fn is_synthetic(id: &str) -> bool {
    id.starts_with(SYNTHETIC_PREFIX)
}

/// Build a registry row with no PTY. Modelled on `persist::inner_from_row`,
/// which produces the same PTY-less shape when restoring sessions after an app
/// restart — so every consumer already handles it.
fn synthetic_inner(i: usize, cwd: std::path::PathBuf) -> FleetSessionInner {
    let now = now_ms();
    FleetSessionInner {
        id: synthetic_id(i),
        claude_session_id: None,
        cwd,
        project_label: format!("loadgen/{}", i % 8),
        name: Some(format!("loadgen {i:04}")),
        title: Some(format!("synthetic load session {i:04}")),
        athena_active_until_ms: 0,
        args: Vec::new(),
        mode: FleetSessionMode::Interactive,
        cols: 120,
        rows: 32,
        state: FleetSessionState::Running,
        last_activity_ms: now,
        last_pty_output_ms: 0,
        last_grew_ms: 0,
        // Spread creation times so the board's newest-first ordering is
        // exercised rather than every tile sorting equal.
        created_at_ms: now - (i as i64 * 1_000),
        child_pid: None,
        exit_code: None,
        limit_reset_at_ms: 0,
        state_reason: Some("synthetic load harness".to_string()),
        run_id: Some("loadgen".to_string()),
        run_label: Some("Load harness".to_string()),
        stale_kind: None,
        master: Mutex::new(None),
        writer: Mutex::new(None),
        hibernating: AtomicBool::new(false),
        dozing: false,
        output: Arc::new(Mutex::new(
            crate::commands::fleet::registry::OutputRing::new(64 * 1024),
        )),
        killer: None,
    }
}

/// Bring the registry's synthetic population to `target`. Returns true when
/// membership actually changed, so the caller only emits a registry event (and
/// only pays for the frontend's full refetch) when there is something to say.
fn reconcile_sessions(target: usize) -> bool {
    let reg = registry();
    // Sorted by ID, explicitly, and NOT left to `list_dto`'s newest-first order.
    // The tick loop addresses sessions as `loadgen-{0..sessions-1}`, so the
    // population must always be exactly that contiguous prefix: if a shrink
    // removed an arbitrary member instead of the tail, the generator would spend
    // the rest of the run emitting at ids that are no longer in the registry —
    // events that go nowhere, a load level quietly lower than the one on the
    // label, and nothing anywhere to say so.
    let mut existing: Vec<String> = reg
        .list_dto()
        .into_iter()
        .filter(|s| is_synthetic(&s.id))
        .map(|s| s.id)
        .collect();
    existing.sort();

    if existing.len() == target {
        return false;
    }

    if existing.len() < target {
        // The cwd is the current working directory: the Activity board maps a
        // session to a team column via cwd -> DevProject -> team_id, so pointing
        // synthetic sessions at a real project path exercises that join instead
        // of dumping every one of them into the Ungrouped tray.
        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        for i in existing.len()..target {
            reg.insert(synthetic_inner(i, cwd.clone()));
        }
    } else {
        for id in existing.iter().skip(target) {
            reg.remove(id);
        }
    }
    true
}

/// The lifecycle states a flip can land on. `Exited` is excluded deliberately:
/// it is terminal, the frontend treats it as "not live", and a generator that
/// could retire its own population would make the load level drift downward
/// mid-measurement.
const FLIP_STATES: [FleetSessionState; 5] = [
    FleetSessionState::Running,
    FleetSessionState::AwaitingInput,
    FleetSessionState::Idle,
    FleetSessionState::Stale,
    FleetSessionState::Finished,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Apply a profile. Idempotent, and safe to call repeatedly during a ramp — the
/// driver task is started at most once and thereafter just reads the atomics, so
/// stepping the load never restarts the generator or resets its counters.
pub fn set_profile(app: &AppHandle, profile: LoadProfile) -> LoadStatus {
    let h = harness();
    h.sessions.store(profile.sessions, Ordering::Relaxed);
    h.lines_per_sec
        .store(profile.lines_per_sec, Ordering::Relaxed);
    h.state_flips_per_sec
        .store(profile.state_flips_per_sec, Ordering::Relaxed);
    h.line_len.store(profile.line_len.max(1), Ordering::Relaxed);
    h.seed.store(profile.seed, Ordering::Relaxed);
    h.applied_at_ms.store(now_ms(), Ordering::Relaxed);
    h.running.store(true, Ordering::Relaxed);

    if reconcile_sessions(profile.sessions) {
        if let Err(e) = app.emit(
            event_name::FLEET_REGISTRY_CHANGED,
            serde_json::json!({ "kind": "updated", "session_id": "" }),
        ) {
            note_emit_failure(h, event_name::FLEET_REGISTRY_CHANGED, &e);
        }
    }

    let _ = shutdown_channel().0.send(false);
    ensure_driver(app.clone());
    status()
}

/// Zero the rates and remove every synthetic session. Counters are preserved so
/// a runner can still read the totals of the run it just finished.
pub fn stop(app: &AppHandle) -> LoadStatus {
    let h = harness();
    h.running.store(false, Ordering::Relaxed);
    h.lines_per_sec.store(0, Ordering::Relaxed);
    h.state_flips_per_sec.store(0, Ordering::Relaxed);
    h.sessions.store(0, Ordering::Relaxed);

    if reconcile_sessions(0) {
        if let Err(e) = app.emit(
            event_name::FLEET_REGISTRY_CHANGED,
            serde_json::json!({ "kind": "updated", "session_id": "" }),
        ) {
            note_emit_failure(h, event_name::FLEET_REGISTRY_CHANGED, &e);
        }
    }
    status()
}

pub fn status() -> LoadStatus {
    let h = harness();
    let live = registry()
        .list_dto()
        .into_iter()
        .filter(|s| is_synthetic(&s.id))
        .count();
    let applied = h.applied_at_ms.load(Ordering::Relaxed);
    LoadStatus {
        running: h.running.load(Ordering::Relaxed),
        profile: LoadProfile {
            sessions: h.sessions.load(Ordering::Relaxed),
            lines_per_sec: h.lines_per_sec.load(Ordering::Relaxed),
            state_flips_per_sec: h.state_flips_per_sec.load(Ordering::Relaxed),
            line_len: h.line_len.load(Ordering::Relaxed),
            seed: h.seed.load(Ordering::Relaxed),
        },
        live_sessions: live,
        emitted_output: h.emitted_output.load(Ordering::Relaxed),
        emitted_state: h.emitted_state.load(Ordering::Relaxed),
        ticks: h.ticks.load(Ordering::Relaxed),
        uptime_ms: if applied == 0 { 0 } else { now_ms() - applied },
        emit_errors: h.emit_errors.load(Ordering::Relaxed),
        tick_panics: h.tick_panics.load(Ordering::Relaxed),
        since_last_tick_ms: {
            let last = h.last_tick_ms.load(Ordering::Relaxed);
            if last == 0 {
                0
            } else {
                now_ms() - last
            }
        },
        driver_alive: driver_slot()
            .lock()
            .map(|g| g.as_ref().is_some_and(|jh| !jh.inner().is_finished()))
            .unwrap_or(false),
    }
}

/// Reset the counters without touching the profile — called between ramp steps
/// so each step's emitted totals belong to that step alone.
pub fn reset_counters() {
    let h = harness();
    h.emitted_output.store(0, Ordering::Relaxed);
    h.emitted_state.store(0, Ordering::Relaxed);
    h.ticks.store(0, Ordering::Relaxed);
    h.emit_errors.store(0, Ordering::Relaxed);
    h.tick_panics.store(0, Ordering::Relaxed);
    h.applied_at_ms.store(now_ms(), Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

fn ensure_driver(app: AppHandle) {
    let h = harness().clone();
    if h.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let mut shutdown = shutdown_channel().1.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(TICK_MS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            // The wait is RACED against shutdown rather than polled between
            // ticks: a generator that can only notice a stop request after its
            // next tick is one that keeps emitting into a run that has already
            // ended (golden path: background-loop).
            tokio::select! {
                _ = ticker.tick() => {}
                res = shutdown.changed() => {
                    if res.is_err() || *shutdown.borrow() {
                        break;
                    }
                    continue;
                }
            }
            if !h.running.load(Ordering::Relaxed) {
                continue;
            }
            // One tick's panic must not take the generator down silently — that
            // would stop the load mid-step while `running` still read true, and
            // the resulting flat numbers would be indistinguishable from a fast
            // renderer. Caught, counted, surfaced in `status()`.
            let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tick(&app, &h)));
            match caught {
                Ok(outcome) => {
                    // A cycle that produced nothing while rates are non-zero is
                    // the one state worth shouting about: the generator is alive
                    // and configured and still not emitting.
                    if outcome.idle && h.lines_per_sec.load(Ordering::Relaxed) > 0 {
                        tracing::debug!("load harness: tick produced nothing at a non-zero rate");
                    }
                }
                Err(_) => {
                    h.tick_panics.fetch_add(1, Ordering::Relaxed);
                    tracing::error!("load harness: tick panicked");
                }
            }
            // Stamped every cycle, panicking or not: `status()` turns this into
            // `since_last_tick_ms`, which is how a wedged generator becomes
            // visible instead of reading as a quiet one.
            h.last_tick_ms.store(now_ms(), Ordering::Relaxed);
        }
        h.started.store(false, Ordering::SeqCst);
    });
    if let Ok(mut slot) = driver_slot().lock() {
        *slot = Some(handle);
    }
}

/// What one cycle produced. Returned rather than folded into atomics inside the
/// tick so the driver — the supervisor — can see the outcome of the cycle it
/// just ran, instead of only how long it took (golden path: stall-watchdog).
#[derive(Debug, Default, Clone, Copy)]
struct TickOutcome {
    output: usize,
    state: usize,
    /// True when the cycle ran with nothing configured to emit. Distinguishes
    /// "idle by instruction" from "produced nothing but should have".
    idle: bool,
}

/// Convert a per-second rate into a whole number of events for this tick,
/// carrying the fraction forward so low rates are not floored to zero and high
/// rates do not drift.
fn take(carry: &Mutex<f64>, per_sec: usize) -> usize {
    let want = per_sec as f64 * (TICK_MS as f64 / 1000.0);
    let mut c = carry.lock().unwrap_or_else(|e| e.into_inner());
    *c += want;
    let n = c.floor();
    *c -= n;
    (n as usize).min(MAX_PER_TICK)
}

fn tick(app: &AppHandle, h: &Harness) -> TickOutcome {
    h.ticks.fetch_add(1, Ordering::Relaxed);
    let session_count = h.sessions.load(Ordering::Relaxed);
    if session_count == 0 {
        return TickOutcome {
            idle: true,
            ..TickOutcome::default()
        };
    }
    let mut outcome = TickOutcome::default();

    // ── Terminal output ────────────────────────────────────────────────────
    let lines = take(&h.carry_output, h.lines_per_sec.load(Ordering::Relaxed));
    if lines > 0 {
        let len = h.line_len.load(Ordering::Relaxed);
        for _ in 0..lines {
            let r = next_rand(&h.seed);
            let target = (r as usize) % session_count;
            let chunk = synth_line(r, len);
            if let Err(e) = app.emit(
                event_name::FLEET_SESSION_OUTPUT,
                serde_json::json!({ "session_id": synthetic_id(target), "chunk": chunk }),
            ) {
                note_emit_failure(h, event_name::FLEET_SESSION_OUTPUT, &e);
            }
        }
        h.emitted_output.fetch_add(lines as u64, Ordering::Relaxed);
        outcome.output = lines;
    }

    // ── State flips ────────────────────────────────────────────────────────
    let flips = take(
        &h.carry_state,
        h.state_flips_per_sec.load(Ordering::Relaxed),
    );
    if flips > 0 {
        for _ in 0..flips {
            let r = next_rand(&h.seed);
            let target = (r as usize) % session_count;
            let state = FLIP_STATES[(r >> 32) as usize % FLIP_STATES.len()];
            // Write the registry too, not just the event: the frontend patches
            // its cached row from the event, but any refetch reads the registry,
            // and a board that disagrees with itself after a refresh would look
            // like a rendering bug rather than a harness artefact.
            registry().set_state_direct(&synthetic_id(target), state, "load harness");
            if let Err(e) = app.emit(
                event_name::FLEET_SESSION_STATE,
                serde_json::json!({
                    "session_id": synthetic_id(target),
                    "state": crate::commands::fleet::types::state_to_token(state),
                }),
            ) {
                note_emit_failure(h, event_name::FLEET_SESSION_STATE, &e);
            }
        }
        h.emitted_state.fetch_add(flips as u64, Ordering::Relaxed);
        outcome.state = flips;
    }

    outcome.idle = outcome.output == 0 && outcome.state == 0;
    outcome
}

/// A line that looks like tool output: a timestamp-ish prefix, a varying body,
/// and ANSI colour, because xterm's parser cost is part of what terminals
/// actually pay and a stream of plain ASCII would understate it.
fn synth_line(r: u64, len: usize) -> String {
    const WORDS: [&str; 8] = [
        "compiling",
        "resolved",
        "checking",
        "warning:",
        "ok",
        "fetch",
        "linking",
        "emit",
    ];
    let colour = 31 + (r % 7) as u8;
    let mut s = String::with_capacity(len + 24);
    s.push_str(&format!("\u{1b}[{colour}m[{:08x}]\u{1b}[0m ", r as u32));
    let mut i = 0usize;
    let mut x = r;
    while s.len() < len {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
        s.push_str(WORDS[(x >> 33) as usize % WORDS.len()]);
        s.push(' ');
        i += 1;
        if i > 64 {
            break;
        }
    }
    s.push_str("\r\n");
    s
}
