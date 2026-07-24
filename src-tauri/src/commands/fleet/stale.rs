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

use tauri::AppHandle;


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

/// Per-session transcript-size baseline, captured the first tick a session is
/// seen in `AwaitingInput`. If a later tick finds the transcript has grown PAST
/// this baseline, the session kept producing output after the await flag was
/// raised — i.e. the `AwaitingInput` was spurious (Claude Code fires its idle
/// "waiting for input" Notification during long tool waits / model-latency gaps)
/// — so we revive it to `Running`. Snapshotting on the first AwaitingInput tick
/// rather than at the hook deliberately sidesteps transcript-flush races: by the
/// next tick, the assistant message that triggered a *legitimate* await (e.g. an
/// AskUserQuestion) is already on disk and folded into the baseline, so a
/// genuinely-waiting session shows no growth past it and is correctly left alone.
static AWAITING_BASELINE: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
fn awaiting_baseline() -> &'static Mutex<HashMap<String, u64>> {
    AWAITING_BASELINE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A session that hasn't seen activity in this long is flagged Stale.
/// 5 minutes — long enough that a thoughtful user typing slowly doesn't
/// trip it, short enough that a forgotten window is flagged before the
/// user circles back.
pub const STALE_AFTER_SECS: i64 = 6 * 60;

/// How long a session may sit `Spawning` with no bound `claude_session_id`
/// and no activity before we conclude `claude` never attached (trust-prompt
/// hang / crash / failed start). Claude Code binds the SessionStart hook
/// within seconds when it comes up, so 2 min is a confident verdict.
pub const NEVER_ATTACHED_SECS: i64 = 2 * 60;

/// Frozen-process fast path: a `Running` session whose PTY has produced NO
/// bytes at all for this long — alongside no transcript growth and no hooks —
/// is hung, not thinking. claude redraws its status line continuously even
/// when idle, so total PTY silence is a confident "the process is frozen"
/// verdict at 2 min, instead of letting a dead session wear the blue spinner
/// for the full 6-minute flat-log cutoff.
pub const STALLED_AFTER_SECS: i64 = 2 * 60;

/// How often the ticker runs. 30s is a good balance between
/// responsiveness and idle CPU.
pub const TICK_INTERVAL_SECS: u64 = 30;

/// Read a positive-seconds override from the environment, falling back to
/// `default`. Lets test harnesses shorten the staleness windows for fast
/// observation (`PERSONAS_FLEET_STALE_SECS` / `PERSONAS_FLEET_NEVER_ATTACHED_SECS`)
/// without waiting the production 6 min. Production leaves the env unset.
fn env_secs(key: &str, default: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(default)
}

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

// ---------------------------------------------------------------------------
// Live-slot scheduler (fleet-scale Tier A) — cap how many process-backed
// `claude` sessions run at once. The fleet becomes "N tracked conversations,
// ≤max live processes": overflow Idle/Stale sessions are hibernated
// (transcripts persist; Wake resumes them), so RAM/CPU tracks *active* work,
// not tracked work. 0 = unlimited (feature off). Soft cap by design —
// Running/AwaitingInput/Spawning sessions are never evicted, so a burst of
// genuinely-working sessions may exceed the cap until some go idle.
// Same frontend-owned plumbing as auto-hibernate: pushed on change + refresh.
// ---------------------------------------------------------------------------

static MAX_LIVE_SESSIONS: AtomicU64 = AtomicU64::new(0);

/// Update the live-slot cap. `0` disables the scheduler. Called by
/// `fleet_set_live_slots`.
pub fn set_live_slots(max_live: u64) {
    MAX_LIVE_SESSIONS.store(max_live, Ordering::Relaxed);
}

/// The configured live-slot cap (0 = unlimited / off).
pub fn live_slot_cap() -> u64 {
    MAX_LIVE_SESSIONS.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// User-tunable state cutoffs — set from Fleet → Settings via
// `fleet_set_state_cutoffs`, mirroring the auto-hibernate plumbing (persisted
// in the frontend slice, pushed on change + on every Fleet refresh). 0 = use
// the built-in default. Env test knobs still take precedence so harnesses
// keep working unchanged.
// ---------------------------------------------------------------------------
static STALE_OVERRIDE_SECS: AtomicU64 = AtomicU64::new(0);
static STALLED_OVERRIDE_SECS: AtomicU64 = AtomicU64::new(0);

/// Bounds for the user-tunable cutoffs. Stale below 1 min flaps while the
/// user is composing; frozen below 30s false-positives on model latency gaps.
const STALE_TUNE_RANGE: (u64, u64) = (60, 3600);
const STALLED_TUNE_RANGE: (u64, u64) = (30, 3600);

/// Update the user-tuned staleness / frozen cutoffs (seconds; clamped).
pub fn set_state_cutoffs(stale_secs: u64, stalled_secs: u64) {
    STALE_OVERRIDE_SECS.store(stale_secs.clamp(STALE_TUNE_RANGE.0, STALE_TUNE_RANGE.1), Ordering::Relaxed);
    STALLED_OVERRIDE_SECS.store(stalled_secs.clamp(STALLED_TUNE_RANGE.0, STALLED_TUNE_RANGE.1), Ordering::Relaxed);
}

/// Effective cutoff in seconds: env test knob > user-tuned override > default.
fn effective_secs(env_key: &str, override_atomic: &AtomicU64, default: i64) -> i64 {
    let user = override_atomic.load(Ordering::Relaxed);
    let base = if user > 0 { user as i64 } else { default };
    env_secs(env_key, base)
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

/// True when a `Running` session looks frozen mid-run: its PTY went totally
/// silent (claude redraws even when idle, so zero bytes ⇒ the process is
/// hung) AND no transcript growth / hook activity either, both past the
/// stall threshold. `last_pty_output_ms == 0` (never produced a byte —
/// covered by the never-attached check, and exempts PTY-less rows) and every
/// non-Running state are left to the other rules.
fn is_frozen_mid_run(
    state: FleetSessionState,
    last_pty_output_ms: i64,
    idle_since_ms: i64,
    now: i64,
    threshold_ms: i64,
) -> bool {
    matches!(state, FleetSessionState::Running)
        && last_pty_output_ms > 0
        && now - last_pty_output_ms >= threshold_ms
        && now - idle_since_ms >= threshold_ms
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
    let stale_secs = effective_secs("PERSONAS_FLEET_STALE_SECS", &STALE_OVERRIDE_SECS, STALE_AFTER_SECS);
    let cutoff_ms = stale_secs * 1000;
    let never_attached_ms = env_secs("PERSONAS_FLEET_NEVER_ATTACHED_SECS", NEVER_ATTACHED_SECS) * 1000;
    let stalled_secs = effective_secs("PERSONAS_FLEET_STALLED_SECS", &STALLED_OVERRIDE_SECS, STALLED_AFTER_SECS);
    let stalled_ms = stalled_secs * 1000;

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
        live_slot_pass(app);
        return;
    }

    // Pass B — stat transcript sizes (no registry lock). Track growth; the
    // `last_grew_ms` per session is the authoritative freshness signal.
    let mut grew_ids: HashSet<String> = HashSet::new();
    let mut last_grew: HashMap<String, i64> = HashMap::new();
    // Current transcript size per session this tick — feeds the AwaitingInput
    // baseline/revive check in Pass C.
    let mut sizes: HashMap<String, u64> = HashMap::new();
    {
        let mut g = growth_map().lock().unwrap_or_else(|e| e.into_inner());
        for (id, csid) in &snaps {
            let Some(csid) = csid else { continue };
            let Some(size) = transcript_size(csid) else { continue };
            sizes.insert(id.clone(), size);
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
        // Lock the await-baseline map alongside the registry (consistent order:
        // baseline before registry) so the AwaitingInput revive check is atomic
        // with the state mutation.
        let mut base = awaiting_baseline().lock().unwrap_or_else(|e| e.into_inner());
        let mut map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        for session in map.values_mut() {
            if matches!(session.state, FleetSessionState::Exited | FleetSessionState::Hibernated) {
                base.remove(&session.id);
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
                never_attached_ms,
            ) {
                session.state = FleetSessionState::Stale;
                session.state_reason = Some(
                    "Claude never attached — the folder may need trust approval, or claude failed to start. Safe to kill.".into(),
                );
                base.remove(&session.id);
                newly_stale.push(session.id.clone());
                continue;
            }
            let grew = grew_ids.contains(&session.id);
            if grew {
                session.last_activity_ms = now;
            }
            // Persist the growth timestamp onto the row so the UI's state
            // provenance tooltip can show "transcript grew Xs ago".
            if let Some(&g) = last_grew.get(&session.id) {
                session.last_grew_ms = g;
            }

            // AwaitingInput robustness — revive on growth that happens strictly
            // AFTER the await began. The first tick that sees AwaitingInput
            // records a transcript-size baseline (the question text that may
            // justify a *legitimate* await is already flushed by then); any
            // later tick whose transcript exceeds that baseline proves the
            // session kept working, so the await was spurious → back to Running.
            // A genuinely-waiting session never grows past the baseline and is
            // left untouched (AwaitingInput is also exempt from flat-log
            // staleness below). This is the no-tool backstop to the immediate
            // PreToolUse corrector in `hooks::receive_hook`.
            if matches!(session.state, FleetSessionState::AwaitingInput) {
                if let Some(&size) = sizes.get(&session.id) {
                    match base.get(&session.id).copied() {
                        None => {
                            base.insert(session.id.clone(), size);
                        }
                        Some(baseline) if size > baseline => {
                            session.state = FleetSessionState::Running;
                            session.state_reason =
                                Some("Transcript grew after awaiting input — still working".into());
                            session.last_activity_ms = now;
                            base.remove(&session.id);
                            revived.push(session.id.clone());
                        }
                        _ => {}
                    }
                }
                continue;
            }
            // Not (any longer) awaiting input → drop any baseline we held.
            base.remove(&session.id);

            // Freshness = the MOST RECENT of (a) real transcript growth and
            // (b) hook-driven activity. Using growth alone marked a working
            // session Stale during a long tool op (hooks firing, transcript
            // not yet flushed); using hooks alone let a hung session look
            // alive. The max of both keeps active sessions fresh without
            // reviving genuinely-hung ones (a hung session has neither).
            let idle_since = last_grew
                .get(&session.id)
                .copied()
                .unwrap_or(0)
                .max(session.last_activity_ms);

            // Frozen-process fast path (before the generous flat-log cutoff):
            // total PTY silence while Running means hung, not thinking — flag
            // it at STALLED_AFTER_SECS with a verdict the operator can act on.
            if is_frozen_mid_run(session.state, session.last_pty_output_ms, idle_since, now, stalled_ms) {
                session.state = FleetSessionState::Stale;
                session.state_reason = Some(if stalled_secs >= 60 {
                    format!(
                        "No console output for {} min — claude looks frozen mid-run. Safe to kill, or wake it with a prompt.",
                        stalled_secs / 60
                    )
                } else {
                    format!(
                        "No console output for {stalled_secs}s — claude looks frozen mid-run. Safe to kill, or wake it with a prompt."
                    )
                });
                newly_stale.push(session.id.clone());
                continue;
            }

            match staleness_transition(session.state, grew, idle_since, now, cutoff_ms) {
                Some(FleetSessionState::Running) => {
                    session.state = FleetSessionState::Running;
                    session.state_reason = Some("Transcript growing — session is active".into());
                    revived.push(session.id.clone());
                }
                Some(FleetSessionState::Stale) => {
                    session.state = FleetSessionState::Stale;
                    session.state_reason = Some(if stale_secs >= 60 {
                        format!("No log growth for {} min", stale_secs / 60)
                    } else {
                        format!("No log growth for {stale_secs}s")
                    });
                    newly_stale.push(session.id.clone());
                }
                _ => {}
            }
        }
        // Drop baselines for sessions that left the registry entirely (the
        // in-loop removals already cover non-AwaitingInput live sessions).
        base.retain(|k, _| map.contains_key(k));
    }

    // Emit state changes outside the lock.
    for sid in revived {
        super::pty::emit_session_state(app, &sid, None, "running", Some("Transcript growing".into()));
    }
    for sid in newly_stale {
        super::pty::emit_session_state(app, &sid, None, "stale", Some("No log growth".into()));
    }

    // Test/debug: log every non-terminal session's decision inputs each tick so
    // the staleness logic can be observed live in the dev console. Gated on
    // `PERSONAS_FLEET_DEBUG` so production stays quiet.
    if std::env::var("PERSONAS_FLEET_DEBUG").is_ok() {
        let g = growth_map().lock().unwrap_or_else(|e| e.into_inner());
        let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        let mut lines: Vec<String> = Vec::new();
        for s in map.values() {
            if matches!(s.state, FleetSessionState::Exited | FleetSessionState::Hibernated) {
                continue;
            }
            let grew_at = g.get(&s.id).map(|&(_, t)| (now - t) / 1000).unwrap_or(-1);
            let size = g.get(&s.id).map(|&(sz, _)| sz).unwrap_or(0);
            let out_ago = if s.last_pty_output_ms > 0 { (now - s.last_pty_output_ms) / 1000 } else { -1 };
            lines.push(format!(
                "{} {:?} cc={} idle={}s grewAgo={}s outAgo={}s size={} proj={}",
                &s.id[..8.min(s.id.len())],
                s.state,
                s.claude_session_id.is_some(),
                (now - s.last_activity_ms) / 1000,
                grew_at,
                out_ago,
                size,
                s.project_label,
            ));
        }
        if !lines.is_empty() {
            tracing::info!(target: "fleet_stale_debug", "cutoff={}s | {}", stale_secs, lines.join(" || "));
        }
    }

    // "Athena's on it" windows are deadlines the DTO evaluates lazily — sweep
    // the lapsed ones and emit, or the frontend's last snapshot wears the
    // light-blue border forever (observed live: tiles stuck "Athena" masking
    // their violet awaiting state after her turn deferred without an action).
    for sid in registry().sweep_expired_athena() {
        super::pty::emit_registry_changed(app, "updated", &sid);
    }

    doze_pass(app, now, cutoff_ms);
    auto_hibernate_pass(app);
    live_slot_pass(app);
}

/// Seconds a session may sit in `Stale` / `AwaitingInput` before its process
/// is dozed (light sleep — freed but displayed state kept; see
/// `registry::doze`). Override with `PERSONAS_FLEET_DOZE_SECS`; `0` disables.
const DOZE_AFTER_SECS: i64 = 60;

/// Light-sleep pass: free the process of any session that has sat in `Stale`
/// or `AwaitingInput` past `DOZE_AFTER_SECS` — the operator clearly isn't
/// mid-reply, and four parked `claude` processes cost real RAM/CPU. Unlike
/// auto-hibernate this keeps the DISPLAYED state (the tile still says what the
/// session was doing, with a sleep indicator), always applies (no settings
/// toggle — it's the resource floor), and wakes on the operator's return
/// (selecting the session resumes it via `claude --resume`).
///
/// Timing derives from signals that already exist rather than a new
/// state-age field:
/// - `AwaitingInput` stamps `last_activity_ms` on entry and any real progress
///   revives the session out of the state — so `now - idle_since ≥ doze` means
///   "has been waiting on the human for at least that long".
/// - `Stale` *means* `idle_since` is already past the stale cutoff, so "stale
///   for a minute" is `idle_since ≥ cutoff + doze`.
///
/// Athena interplay: her orchestration wake fires within seconds of
/// `AwaitingInput` and her verdict lands well inside the doze window; a
/// session she auto-fires goes `Running` (never dozed), a deferred one is
/// exactly the "waiting on the human" case doze exists for. `doze()` itself
/// re-validates state + a bound claude id under the lock, so never-attached
/// rows (nothing to resume) are skipped by construction.
fn doze_pass(app: &AppHandle, now: i64, stale_cutoff_ms: i64) {
    let doze_secs = env_secs("PERSONAS_FLEET_DOZE_SECS", DOZE_AFTER_SECS);
    if doze_secs <= 0 {
        return;
    }
    let doze_ms = doze_secs * 1000;

    // Snapshot candidates without holding the lock across the kills.
    let candidates: Vec<String> = {
        let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                if s.dozing || s.child_pid.is_none() {
                    return false;
                }
                let idle_since = s.last_grew_ms.max(s.last_activity_ms);
                match s.state {
                    FleetSessionState::AwaitingInput => now - idle_since >= doze_ms,
                    FleetSessionState::Stale => now - idle_since >= stale_cutoff_ms + doze_ms,
                    _ => false,
                }
            })
            .map(|s| s.id.clone())
            .collect()
    };

    for sid in candidates {
        // Athena still owes this session a verdict (its wake is queued or in
        // flight) — freeing the process now would strand her eventual answer
        // (typing fails closed once the writer is gone). Observed in the 30x
        // burst: queued wakes outlived the 60s doze window. The guard expires
        // after 6 min so a wedged turn can't pin sessions awake.
        if crate::commands::companion::fleet_bridge::has_pending_assessment(&sid) {
            continue;
        }
        if registry().doze(&sid) {
            tracing::info!(session_id = %sid, "fleet doze: freed a parked session's process (state kept)");
            super::debug_log::sleep_event(
                &sid,
                "dozed",
                &format!("parked {doze_secs}s+ — process freed, state kept; select to wake"),
            );
            // No state event — the state deliberately didn't change. The
            // registry-changed refresh carries the `dozing` flag to the UI.
            super::pty::emit_registry_changed(app, "updated", &sid);
        }
    }
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
        // `require_resting = true`: re-validate Idle/Stale inside hibernate()'s
        // lock. A hook may have flipped the session to Running/AwaitingInput
        // between our snapshot above and now — never sleep a live turn.
        if registry().hibernate(&sid, true) {
            tracing::info!(session_id = %sid, "fleet auto-hibernate: slept idle session");
            super::pty::emit_session_state(
                app,
                &sid,
                None,
                "hibernated",
                Some(format!("Auto-hibernated after {} min idle", after_secs / 60)),
            );
        }
    }
}

/// Minimal per-session facts the live-slot policy needs — extracted so the
/// eviction choice is a pure, unit-tested decision.
#[derive(Clone)]
struct SlotSnap {
    id: String,
    state: FleetSessionState,
    /// Resumable: hibernate only makes sense with a bound claude_session_id.
    has_cc_id: bool,
    /// Process-backed: only sessions whose process Fleet owns count against
    /// (and can free) a slot. Hooks-only external rows have no child_pid.
    has_pid: bool,
    last_activity_ms: i64,
}

/// Pure live-slot policy: given the fleet's process-backed population and the
/// cap, return the sessions to hibernate — oldest-idle first, Idle/Stale +
/// resumable only, and never more than the overflow. Running / AwaitingInput /
/// Spawning sessions are untouchable (soft cap): evicting working sessions
/// would lose in-flight work, which the never-lose-work rule forbids.
fn live_slot_evictions(snaps: &[SlotSnap], cap: u64) -> Vec<String> {
    if cap == 0 {
        return Vec::new();
    }
    let live = snaps.iter().filter(|s| s.has_pid && !matches!(s.state, FleetSessionState::Exited | FleetSessionState::Hibernated)).count() as u64;
    if live <= cap {
        return Vec::new();
    }
    let overflow = (live - cap) as usize;
    let mut candidates: Vec<&SlotSnap> = snaps
        .iter()
        .filter(|s| {
            s.has_pid
                && s.has_cc_id
                && matches!(s.state, FleetSessionState::Idle | FleetSessionState::Stale)
        })
        .collect();
    candidates.sort_by_key(|s| s.last_activity_ms);
    candidates.into_iter().take(overflow).map(|s| s.id.clone()).collect()
}

/// Snapshot the registry into the pure policy's shape.
fn slot_snapshot() -> Vec<SlotSnap> {
    let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
    map.values()
        .map(|s| SlotSnap {
            id: s.id.clone(),
            state: s.state,
            has_cc_id: s.claude_session_id.is_some(),
            has_pid: s.child_pid.is_some(),
            last_activity_ms: s.last_activity_ms,
        })
        .collect()
}

/// Enforce the live-slot cap: hibernate overflow Idle/Stale sessions (oldest
/// idle first) until the process-backed live count fits the cap. Runs every
/// ticker tick; also the rebalance path after a burst of spawns.
fn live_slot_pass(app: &AppHandle) {
    let cap = live_slot_cap();
    if cap == 0 {
        return;
    }
    let evict = live_slot_evictions(&slot_snapshot(), cap);
    for sid in evict {
        // `require_resting = true`: re-validate Idle/Stale inside hibernate()'s
        // lock — a hook may have flipped the session to Running/AwaitingInput
        // between the snapshot and now. Never sleep a live turn.
        if registry().hibernate(&sid, true) {
            tracing::info!(session_id = %sid, cap, "fleet live-slots: hibernated overflow session");
            super::pty::emit_session_state(
                app,
                &sid,
                None,
                "hibernated",
                Some(format!(
                    "Hibernated to stay within the live-session limit ({cap}) — wake to resume"
                )),
            );
        }
    }
}

/// Best-effort slot freeing before a spawn/wake: if the cap is set and the
/// fleet is at/over it, hibernate the single best idle candidate so the new
/// session starts inside the budget. If nothing is evictable (everything is
/// genuinely working), the spawn proceeds anyway — soft cap; the ticker
/// rebalances as sessions go idle.
pub fn free_slot_for_spawn(app: &AppHandle) {
    let cap = live_slot_cap();
    if cap == 0 {
        return;
    }
    // Pretend the cap is one lower so a fleet sitting exactly AT the cap
    // frees a slot for the incoming session.
    let evict = live_slot_evictions(&slot_snapshot(), cap.saturating_sub(1));
    if let Some(sid) = evict.first() {
        if registry().hibernate(sid, true) {
            tracing::info!(session_id = %sid, cap, "fleet live-slots: hibernated to make room for a new session");
            super::pty::emit_session_state(
                app,
                sid,
                None,
                "hibernated",
                Some(format!(
                    "Hibernated to free a live-session slot (limit {cap}) — wake to resume"
                )),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoff_is_sane() {
        // Sanity: the cutoff (6 min) sits between 1 minute (too jumpy — fires while
        // the user is still typing into the console) and 60 minutes (too slow).
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

    const STALL_MS: i64 = STALLED_AFTER_SECS * 1000;
    const SILENT: i64 = NOW - STALL_MS; // PTY last emitted exactly at the threshold
    const EMITTING: i64 = NOW - 5_000; // PTY emitted 5s ago (status redraws)

    #[test]
    fn frozen_running_session_is_flagged() {
        use FleetSessionState::*;
        // Running + total PTY silence + no growth/hooks past threshold → frozen.
        assert!(is_frozen_mid_run(Running, SILENT, SILENT, NOW, STALL_MS));
    }

    #[test]
    fn recent_output_or_activity_is_not_frozen() {
        use FleetSessionState::*;
        // Status line still redrawing → alive (even with flat logs).
        assert!(!is_frozen_mid_run(Running, EMITTING, SILENT, NOW, STALL_MS));
        // Recent growth/hook → working quietly (transcript flushed late).
        assert!(!is_frozen_mid_run(Running, SILENT, NOW - 10_000, NOW, STALL_MS));
    }

    #[test]
    fn frozen_check_only_applies_to_running_pty_sessions() {
        use FleetSessionState::*;
        // Never produced a byte (0) → never-attached's case, not ours.
        assert!(!is_frozen_mid_run(Running, 0, SILENT, NOW, STALL_MS));
        // Non-Running states are governed by the other rules.
        assert!(!is_frozen_mid_run(Idle, SILENT, SILENT, NOW, STALL_MS));
        assert!(!is_frozen_mid_run(AwaitingInput, SILENT, SILENT, NOW, STALL_MS));
        assert!(!is_frozen_mid_run(Spawning, SILENT, SILENT, NOW, STALL_MS));
        assert!(!is_frozen_mid_run(Stale, SILENT, SILENT, NOW, STALL_MS));
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

    fn snap(id: &str, state: FleetSessionState, has_cc_id: bool, has_pid: bool, last_activity_ms: i64) -> SlotSnap {
        SlotSnap { id: id.into(), state, has_cc_id, has_pid, last_activity_ms }
    }

    #[test]
    fn live_slots_zero_cap_is_off() {
        use FleetSessionState::*;
        let snaps = vec![snap("a", Idle, true, true, 1), snap("b", Idle, true, true, 2)];
        assert!(live_slot_evictions(&snaps, 0).is_empty());
    }

    #[test]
    fn live_slots_under_cap_evicts_nothing() {
        use FleetSessionState::*;
        let snaps = vec![snap("a", Running, true, true, 1), snap("b", Idle, true, true, 2)];
        assert!(live_slot_evictions(&snaps, 2).is_empty());
        assert!(live_slot_evictions(&snaps, 5).is_empty());
    }

    #[test]
    fn live_slots_evicts_oldest_idle_first_up_to_overflow() {
        use FleetSessionState::*;
        let snaps = vec![
            snap("working", Running, true, true, 1),
            snap("old-idle", Idle, true, true, 10),
            snap("older-stale", Stale, true, true, 5),
            snap("fresh-idle", Idle, true, true, 100),
        ];
        // 4 live, cap 2 → evict 2, oldest-activity first.
        assert_eq!(live_slot_evictions(&snaps, 2), vec!["older-stale".to_string(), "old-idle".to_string()]);
        // cap 3 → evict only the single oldest candidate.
        assert_eq!(live_slot_evictions(&snaps, 3), vec!["older-stale".to_string()]);
    }

    #[test]
    fn live_slots_never_evicts_working_awaiting_or_unresumable() {
        use FleetSessionState::*;
        let snaps = vec![
            snap("running", Running, true, true, 1),
            snap("awaiting", AwaitingInput, true, true, 2),
            snap("spawning", Spawning, false, true, 3),
            // Idle but no cc id → can't be resumed, so never hibernated.
            snap("unbound-idle", Idle, false, true, 4),
        ];
        // 4 live, cap 1 → overflow 3, but zero eligible candidates.
        assert!(live_slot_evictions(&snaps, 1).is_empty());
    }

    #[test]
    fn live_slots_ignores_processless_and_terminal_rows() {
        use FleetSessionState::*;
        let snaps = vec![
            // External hooks-only row (no pid) — neither counts nor evicts.
            snap("external", Idle, true, false, 1),
            snap("hibernated", Hibernated, true, false, 2),
            snap("exited", Exited, true, false, 3),
            snap("live", Idle, true, true, 4),
        ];
        // Only one process-backed live session → within cap 1 → nothing.
        assert!(live_slot_evictions(&snaps, 1).is_empty());
    }
}
