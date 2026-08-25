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
use super::screen_activity::{ScreenActivity, ScreenDelta};
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

/// Per-session "the rendered screen has looked frozen since" timestamp.
///
/// One sample only says the last two renders matched, which a healthy session
/// produces all the time (two renders taken either side of a pause). The
/// frozen-by-screen verdict therefore needs the silence to PERSIST across
/// ticks, and this map is that memory. Cleared the instant any evidence is
/// lost (a moving screen, transcript growth, a state change out of `Running`,
/// or an unusable sample) so the verdict can never be reached on stale data.
static SCREEN_SILENT_SINCE: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();
fn silent_since_map() -> &'static Mutex<HashMap<String, i64>> {
    SCREEN_SILENT_SINCE.get_or_init(|| Mutex::new(HashMap::new()))
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

/// Multiplier applied to [`STALLED_AFTER_SECS`] for Athena's own dev
/// sessions (`athena-dev*`).
///
/// The frozen verdict reads "no bytes and no transcript growth" as hung.
/// That inference holds for a conversational session; it is simply wrong for
/// a dev run, whose normal working state is a **silent `cargo check`** that
/// on this repo routinely runs 5-15 minutes with no PTY output and no
/// transcript lines. At 2 min every such compile was reported frozen, which
/// is how a healthy build came to wear a "safe to kill" label. 8× puts the
/// verdict at 16 min — past any ordinary compile, still short of a real hang.
pub const DEV_SESSION_STALL_MULTIPLIER: i64 = 8;

/// True when this session is one of Athena's dev runs, by name
/// (`athena-dev…` — the rename applied at dispatch in `execute_dev_improve`).
fn is_dev_session(name: Option<&str>) -> bool {
    name.is_some_and(|n| {
        n.contains(&format!(
            "{}-dev",
            super::registry::ATHENA_SESSION_NAME_SENTINEL
        ))
    })
}

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
    STALE_OVERRIDE_SECS.store(
        stale_secs.clamp(STALE_TUNE_RANGE.0, STALE_TUNE_RANGE.1),
        Ordering::Relaxed,
    );
    STALLED_OVERRIDE_SECS.store(
        stalled_secs.clamp(STALLED_TUNE_RANGE.0, STALLED_TUNE_RANGE.1),
        Ordering::Relaxed,
    );
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
            // Boot restore rides this loop rather than a second setup hook: the
            // ticker already starts after the app is up, and `rehydrate` is
            // idempotent + no-ops until AppState (the DB pool) is managed, so
            // an early tick simply retries on the next one.
            super::persist::rehydrate(&app);
            // Mechanism 2 — recover mid-task orphans BEFORE tick_once, so the
            // auto-forget pass can't sweep a rehydrated session that was still
            // working when the app restarted. One-shot; no-ops thereafter.
            super::persist::recover_after_restart(&app);
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
            // Finished included: the operator handed it more work — it's a
            // live session again.
            Stale | Idle | Finished => Some(Running),
            _ => None,
        };
    }
    match state {
        // Finished is a declared-complete park — silence is its normal
        // condition, never staleness.
        Stale | AwaitingInput | Exited | Hibernated | Finished => None,
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

// ---------------------------------------------------------------------------
// Screen-movement corroboration (see `super::screen_activity`).
//
// Freshness has always been `max(last_grew, last_activity)` — growth alone
// falsely staled sessions during long tool ops, hooks alone let hung sessions
// look alive. Screen movement is a THIRD corroborating input, never a
// replacement: it can veto a `Stale` verdict the flat-log rule would have
// produced, and it can reach the frozen verdict on its own evidence, but it
// removes no existing trigger and every rule below degrades to exactly
// today's behaviour when the evidence is unusable.
// ---------------------------------------------------------------------------

/// What the screen says about a session, once the caveats are applied.
/// `None` means "no usable evidence" and every caller must then behave as it
/// did before this signal existed. Evidence is dropped when:
///
/// - nothing ever rendered this session, or only once (the first render has no
///   predecessor and always reads `Working` — `OutputRing::record_delta`),
/// - the screen is too small to separate chrome from content
///   (`ScreenDelta::classifiable`), or
/// - the sample is older than the window of the rule asking. Renders are a
///   byproduct of other work, so a session nobody looked at recently carries a
///   measurement that says nothing about NOW.
fn usable_activity(
    delta: Option<ScreenDelta>,
    now: i64,
    max_age_ms: i64,
) -> Option<ScreenActivity> {
    let d = delta?;
    if !d.classifiable() || d.at_ms <= 0 || now - d.at_ms > max_age_ms {
        return None;
    }
    Some(d.activity())
}

/// Corroboration rule 1 — a screen that is demonstrably producing content is
/// not stale, whatever the transcript says. Suppression only: it can hold a
/// session in its current state, never move it to one.
fn screen_vetoes_stale(activity: Option<ScreenActivity>) -> bool {
    matches!(activity, Some(ScreenActivity::Working))
}

/// Fold this tick's verdict into the per-session silence clock, returning the
/// new "silent since" (`None` = no sustained silence to speak of).
///
/// Deliberately strict: any of growth, a non-`Running` state, or a sample that
/// is not a usable `Silent` resets the clock. A session parked in
/// `AwaitingInput` shows a static screen by definition — letting that
/// accumulate and then firing the moment it flips to `Running` is exactly the
/// false positive this reset prevents.
fn track_silence(
    prev: Option<i64>,
    state: FleetSessionState,
    grew: bool,
    activity: Option<ScreenActivity>,
    now: i64,
) -> Option<i64> {
    if grew || !matches!(state, FleetSessionState::Running) {
        return None;
    }
    match activity {
        Some(ScreenActivity::Silent) => Some(prev.unwrap_or(now)),
        _ => None,
    }
}

/// Corroboration rule 2 — the frozen verdict reached from the screen instead
/// of from the PTY. Additive to [`is_frozen_mid_run`]: that rule catches a
/// process emitting no bytes at all, this one catches a process still
/// repainting an unchanged grid while nothing is logged and no hook fires.
///
/// Requires the silence to have PERSISTED for the whole threshold (see
/// [`SCREEN_SILENT_SINCE`]) on top of the same no-growth-and-no-hooks
/// conjunction the PTY rule uses, so the screen never flags a session the
/// transcript says is working.
fn is_frozen_by_screen(
    state: FleetSessionState,
    activity: Option<ScreenActivity>,
    silent_since_ms: Option<i64>,
    idle_since_ms: i64,
    now: i64,
    threshold_ms: i64,
) -> bool {
    matches!(state, FleetSessionState::Running)
        && matches!(activity, Some(ScreenActivity::Silent))
        && silent_since_ms.is_some_and(|since| now - since >= threshold_ms)
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
    // Companion harvest watcher — ingest finished `run_pattern_harvest`
    // dispatches without the Workspaces UI open. No-op unless the companion
    // executor registered a pending harvest; rides this ticker because the
    // 30s cadence and the AppHandle are already here.
    crate::commands::infrastructure::workspace_harvest::sweep_pending_harvest_ingests(app);
    // Feed-impact watcher — same contract for `feed_impact_dispatch` waves:
    // ingest finished impact runs + raise the wave-complete notification
    // without any UI open. No-op unless the op registered a pending wave.
    crate::commands::infrastructure::feed_impact::sweep_pending_feed_impact_ingests(app);
    let now = now_ms();
    let stale_secs = effective_secs(
        "PERSONAS_FLEET_STALE_SECS",
        &STALE_OVERRIDE_SECS,
        STALE_AFTER_SECS,
    );
    let cutoff_ms = stale_secs * 1000;
    let never_attached_ms =
        env_secs("PERSONAS_FLEET_NEVER_ATTACHED_SECS", NEVER_ATTACHED_SECS) * 1000;
    let stalled_secs = effective_secs(
        "PERSONAS_FLEET_STALLED_SECS",
        &STALLED_OVERRIDE_SECS,
        STALLED_AFTER_SECS,
    );
    let stalled_ms = stalled_secs * 1000;

    // Pass A — snapshot the sessions worth checking (no IO under the lock).
    let snaps: Vec<(String, Option<String>)> = {
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                !matches!(
                    s.state,
                    FleetSessionState::Exited | FleetSessionState::Hibernated
                )
            })
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
            let Some(size) = transcript_size(csid) else {
                continue;
            };
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
        // silence clock before baseline before registry) so the AwaitingInput
        // revive check is atomic with the state mutation.
        let mut silent = silent_since_map().lock().unwrap_or_else(|e| e.into_inner());
        let mut base = awaiting_baseline()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let mut map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        for session in map.values_mut() {
            if matches!(
                session.state,
                FleetSessionState::Exited | FleetSessionState::Hibernated
            ) {
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

            // Screen-movement corroboration. FREE: reads whatever the last
            // render already measured and never triggers one, so a session
            // nobody looked at simply has no evidence (`None`) and every rule
            // below falls back to its screen-free behaviour. Two windows
            // because the two rules ask different questions of the same
            // sample — "did content move inside the staleness window" vs "has
            // the grid been frozen across the stall window".
            let delta = session
                .output
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .informative_screen_delta();
            let screen_stale = usable_activity(delta, now, cutoff_ms);
            let screen_stall = usable_activity(delta, now, stalled_ms);
            let silent_since = track_silence(
                silent.get(&session.id).copied(),
                session.state,
                grew,
                screen_stall,
                now,
            );
            match silent_since {
                Some(since) => {
                    silent.insert(session.id.clone(), since);
                }
                None => {
                    silent.remove(&session.id);
                }
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

            // Athena's own dev sessions spend their normal working life in a
            // silent multi-minute `cargo check`, which the frozen rules below
            // would (and did) read as hung. They get a much longer fuse.
            let (stalled_ms, stalled_secs) = if is_dev_session(session.name.as_deref()) {
                (
                    stalled_ms * DEV_SESSION_STALL_MULTIPLIER,
                    stalled_secs * DEV_SESSION_STALL_MULTIPLIER,
                )
            } else {
                (stalled_ms, stalled_secs)
            };

            // Frozen-process fast path (before the generous flat-log cutoff):
            // total PTY silence while Running means hung, not thinking — flag
            // it at STALLED_AFTER_SECS with a verdict the operator can act on.
            if is_frozen_mid_run(
                session.state,
                session.last_pty_output_ms,
                idle_since,
                now,
                stalled_ms,
            ) {
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
                silent.remove(&session.id);
                continue;
            }

            // Same verdict reached from the screen: bytes are still arriving
            // (so the PTY rule above stayed quiet) but the rendered grid has
            // not moved for the whole stall window and nothing was logged.
            // That is the "alive-looking but stuck" case byte-presence can
            // never see.
            if is_frozen_by_screen(
                session.state,
                screen_stall,
                silent_since,
                idle_since,
                now,
                stalled_ms,
            ) {
                session.state = FleetSessionState::Stale;
                session.state_reason = Some(if stalled_secs >= 60 {
                    format!(
                        "The screen has not changed for {} min and nothing was logged. Claude looks stuck mid-run; safe to kill, or wake it with a prompt.",
                        stalled_secs / 60
                    )
                } else {
                    format!(
                        "The screen has not changed for {stalled_secs}s and nothing was logged. Claude looks stuck mid-run; safe to kill, or wake it with a prompt."
                    )
                });
                newly_stale.push(session.id.clone());
                silent.remove(&session.id);
                continue;
            }

            match staleness_transition(session.state, grew, idle_since, now, cutoff_ms) {
                Some(FleetSessionState::Running) => {
                    session.state = FleetSessionState::Running;
                    session.state_reason = Some("Transcript growing — session is active".into());
                    // Back at work — whatever it was parked on no longer holds.
                    session.stale_kind = None;
                    revived.push(session.id.clone());
                }
                // Corroboration veto: the transcript is flat, but the screen
                // is demonstrably producing content (more than the status
                // area moved, on a screen big enough to tell, within the
                // staleness window). Leave the session alone — a long tool op
                // that streams to the console without flushing JSONL is the
                // exact case the flat-log cutoff used to mislabel. Bounded by
                // the sample's freshness, so a screen that stops moving hands
                // the decision straight back to the flat-log rule.
                Some(FleetSessionState::Stale) if screen_vetoes_stale(screen_stale) => {}
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
        // Same for the silence clock — a session that left the registry must
        // not leave a clock behind for a future id to inherit.
        silent.retain(|k, _| map.contains_key(k));
    }

    // Pass D — read the transcript for every parked session and turn the one
    // amber "stale" bucket into a typed verdict. Runs outside every lock.
    classify_pass(app, &grew_ids);

    // Emit state changes outside the lock.
    for sid in revived {
        super::pty::emit_session_state(
            app,
            &sid,
            None,
            "running",
            Some("Transcript growing".into()),
        );
    }
    for sid in newly_stale {
        super::pty::emit_session_state(app, &sid, None, "stale", Some("No log growth".into()));
    }

    // Test/debug: log every non-terminal session's decision inputs each tick so
    // the staleness logic can be observed live in the dev console. Gated on
    // `PERSONAS_FLEET_DEBUG` so production stays quiet.
    if std::env::var("PERSONAS_FLEET_DEBUG").is_ok() {
        let g = growth_map().lock().unwrap_or_else(|e| e.into_inner());
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let mut lines: Vec<String> = Vec::new();
        for s in map.values() {
            if matches!(
                s.state,
                FleetSessionState::Exited | FleetSessionState::Hibernated
            ) {
                continue;
            }
            let grew_at = g.get(&s.id).map(|&(_, t)| (now - t) / 1000).unwrap_or(-1);
            let size = g.get(&s.id).map(|&(sz, _)| sz).unwrap_or(0);
            let out_ago = if s.last_pty_output_ms > 0 {
                (now - s.last_pty_output_ms) / 1000
            } else {
                -1
            };
            // Screen movement since the previous render. `outAgo` only says
            // bytes arrived — a spinner produces bytes forever — so this is the
            // column that separates "working" from "animating while stuck".
            // Free: reports whatever the last render already measured, never
            // triggers one, so sessions nobody rendered show `-`.
            let screen = s
                .output
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .last_screen_delta()
                .map(|d| d.summary())
                .unwrap_or_else(|| "-".into());
            lines.push(format!(
                "{} {:?} cc={} idle={}s grewAgo={}s outAgo={}s size={} screen={} proj={}",
                &s.id[..8.min(s.id.len())],
                s.state,
                s.claude_session_id.is_some(),
                (now - s.last_activity_ms) / 1000,
                grew_at,
                out_ago,
                size,
                screen,
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

    limit_retry_pass(app, now);
    doze_pass(app, now, cutoff_ms);
    auto_hibernate_pass(app);
    live_slot_pass(app);
    auto_forget_pass(app);
}

/// Auto-maintenance (Mechanism 1): forget Athena-owned sessions that have
/// finished or gone dead, so the fleet sidebar self-cleans without a manual
/// kill. Scoped hard for safety:
///   • only sessions Athena spawned (`is_athena_owned`),
///   • only the terminal / rest states `Finished` / `Stale` / `Exited`
///     (never `Running`/`AwaitingInput`/`Idle`/`Spawning`, and never
///     `Hibernated`, which is a deliberate resumable sleep the operator owns),
///   • and `forget_dead` is a second gate — it removes only sessions with no
///     live PTY, so a `Stale` session that revived to `Running` between the
///     snapshot and the act (regaining a live child) is left untouched.
/// On removal the durable `fleet_sessions` row is pruned too (`note_removed`)
/// so a forgotten session does not resurrect on the next rehydrate.
fn auto_forget_pass(app: &AppHandle) {
    // Pass A — snapshot candidate ids under the lock; no IO while it is held.
    let candidates: Vec<String> = {
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                matches!(
                    s.state,
                    FleetSessionState::Finished
                        | FleetSessionState::Stale
                        | FleetSessionState::Exited
                )
            })
            .map(|s| s.id.clone())
            .collect()
    };
    // Pass B — act per candidate outside the lock. Both `is_athena_owned` and
    // `forget_dead` re-take the lock briefly and re-validate current truth, so
    // a session that moved on between the passes is skipped, not clobbered.
    for sid in candidates {
        if !registry().is_athena_owned(&sid) {
            continue;
        }
        if registry().forget_dead(&sid) {
            super::persist::note_removed(app, &sid);
            super::pty::emit_registry_changed(app, "removed", &sid);
        }
    }
}

/// Per-session mechanical retry state for the Claude server/usage-limit lane.
#[derive(Clone, Copy, Default)]
struct LimitRetry {
    /// Wall-clock ms of the last attempt.
    last_ms: i64,
    /// Attempts made so far (capped by [`LIMIT_RETRY_MAX`]).
    count: u32,
    /// Reset time parsed from the banner, `0` when unknown/unparseable.
    reset_at_ms: i64,
    /// Whether the ONE scheduled post-reset attempt has already fired. After
    /// it does we fall back to the blind cadence — if the stated time was
    /// wrong (or the limit outlasted it) the session must still recover.
    fired_after_reset: bool,
}

fn limit_retry_map() -> &'static Mutex<HashMap<String, LimitRetry>> {
    static MAP: OnceLock<Mutex<HashMap<String, LimitRetry>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Grace after the stated reset before the single scheduled retry fires —
/// Claude's clock and ours are not the same clock, and a retry that lands one
/// second early just burns the attempt.
const LIMIT_RESET_GRACE_MS: i64 = 2 * 60 * 1000;

/// Extract the reset time Claude states in its limit banner and resolve it to
/// an absolute wall-clock ms.
///
/// The live banner (2026-07-24) reads:
/// `You've hit your session limit · resets 7:50pm (Europe/Prague) …`
///
/// Design decisions, both deliberate:
/// - **The stated time is treated as LOCAL wall-clock.** The banner shows the
///   user's own timezone, so the machine's local clock already agrees with it.
///   The `(Europe/Prague)` parenthetical is display-only; parsing it would mean
///   shipping a tz database for zero behavioural gain.
/// - **Ambiguity yields `None`**, which keeps today's blind retry cadence
///   exactly as-is. A wrong ETA is worse than no ETA: it would silence the
///   retries until a moment that never comes.
///
/// A stated time that has already passed today is read as tomorrow (a limit
/// hit at 11pm resetting "7:50am" is the next morning).
pub fn parse_limit_reset(screen: &str, now_ms: i64) -> Option<i64> {
    use chrono::{Duration, Local, NaiveTime, TimeZone};

    let lower = screen.to_lowercase();
    // Anchor on the word that introduces the time so we never pick up an
    // unrelated clock elsewhere on the screen (a log timestamp, a diff line).
    let anchor = [
        "resets ",
        "reset at ",
        "resets at ",
        "will reset ",
        "resume at ",
    ]
    .iter()
    .filter_map(|kw| lower.find(kw).map(|i| i + kw.len()))
    .min()?;
    let tail: String = lower[anchor..].chars().take(24).collect();
    let (hour, minute) = parse_clock(&tail)?;

    let now = Local.timestamp_millis_opt(now_ms).single()?;
    let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
    let today = now.date_naive();
    let candidate = Local
        .from_local_datetime(&today.and_time(time))
        .single()
        .or_else(|| {
            // DST spring-forward gap / fold: nudge a day rather than guess.
            Local
                .from_local_datetime(&today.succ_opt()?.and_time(time))
                .single()
        })?;
    let resolved = if candidate.timestamp_millis() <= now_ms {
        Local
            .from_local_datetime(&(today + Duration::days(1)).and_time(time))
            .single()?
    } else {
        candidate
    };
    // Sanity floor: a "reset" more than 24h out is a misparse, not a limit.
    let ms = resolved.timestamp_millis();
    if ms - now_ms > 24 * 60 * 60 * 1000 {
        return None;
    }
    Some(ms)
}

/// Pull `(hour_24, minute)` off the front of `tail` (already lowercased).
/// Accepts `7:50pm`, `7:50 pm`, `19:50`, `7pm`. Anything else → `None`.
fn parse_clock(tail: &str) -> Option<(u32, u32)> {
    let bytes: Vec<char> = tail.chars().collect();
    let mut i = 0;
    while i < bytes.len() && !bytes[i].is_ascii_digit() {
        // Only skip immediate padding — a digit must start within a few chars,
        // otherwise the anchor wasn't followed by a time at all.
        if i >= 3 {
            return None;
        }
        i += 1;
    }
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == start || i - start > 2 {
        return None;
    }
    let mut hour: u32 = bytes[start..i].iter().collect::<String>().parse().ok()?;
    let mut minute: u32 = 0;
    if i < bytes.len() && bytes[i] == ':' {
        i += 1;
        let ms = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i - ms != 2 {
            return None;
        }
        minute = bytes[ms..i].iter().collect::<String>().parse().ok()?;
    }
    // Optional whitespace then an am/pm marker.
    let rest: String = bytes[i..].iter().collect();
    let rest = rest.trim_start();
    let meridiem = if rest.starts_with("pm") {
        Some(true)
    } else if rest.starts_with("am") {
        Some(false)
    } else {
        None
    };
    match meridiem {
        Some(true) => {
            if hour > 12 {
                return None; // "19:50pm" is not a time
            }
            if hour != 12 {
                hour += 12;
            }
        }
        Some(false) => {
            if hour > 12 {
                return None;
            }
            if hour == 12 {
                hour = 0;
            }
        }
        // Bare 24h clock — a bare `7:50` with no meridiem below 13 is
        // genuinely ambiguous (7:50am or 7:50pm?), so refuse it rather than
        // schedule a retry against a coin flip. `19:50` is unambiguous.
        None => {
            if minute == 0 && !tail.contains(':') {
                return None; // bare "7" is a token, not a time
            }
            if hour < 13 {
                return None;
            }
        }
    }
    if hour > 23 || minute > 59 {
        return None;
    }
    Some((hour, minute))
}

/// Screen signature of a Claude-side limit / transient server error. Kept
/// deliberately narrow — sessions legitimately *talk about* rate limits, so
/// bare "rate limit" does not match. "session limit" / "usage-credits" are the
/// REAL banner text observed live 2026-07-24 ("You've hit your session limit ·
/// resets 7:50pm … /usage-credits to finish what you're working on") — the
/// first signature guess missed it and 8 of 16 sessions sat invisible.
fn screen_shows_limit_error(screen: &str) -> bool {
    let s = screen.to_lowercase();
    s.contains("usage limit")
        || s.contains("session limit")
        || s.contains("usage-credits")
        || s.contains("limit will reset")
        || s.contains("limit resets")
        || s.contains("overloaded_error")
        || s.contains("api error")
        || (s.contains("rate limit") && (s.contains("retry") || s.contains("try again")))
}

const LIMIT_RETRY_INTERVAL_MS: i64 = 4 * 60 * 1000;
/// A dozed limited session retries on a slower cadence — each attempt is a
/// wake (process spawn) + typed `continue`, and a session limit can be hours
/// from reset. 15-minute wake cycles keep the cost at ~4 spawns/hour while
/// still converging within minutes of the limit lifting.
const LIMIT_RETRY_DOZED_INTERVAL_MS: i64 = 15 * 60 * 1000;
/// High cap: a 5-hour session-limit window at mixed cadence needs ~20+
/// attempts to ride out. Attempts are cheap (a typed word / a wake).
const LIMIT_RETRY_MAX: u32 = 24;

/// Athena-autonomy for Claude-side outages (2026-07-24): a session that hit a
/// usage/rate limit or transient server error used to sit parked until the
/// operator noticed. In autonomous mode the retry is MECHANICAL — no Athena
/// turn spent (her turns fail under the same limit): every ~4 min, type a
/// confirmed-submit "continue" into the parked session; once the limit lifts,
/// the turn resumes and the state machine takes over. The retry stamp also
/// arms the doze guard so the process stays alive between attempts; after
/// [`LIMIT_RETRY_MAX`] attempts the session is left to doze (a multi-hour cap
/// is the operator's call — the next app-side wake still finds it).
/// Read every PARKED session's transcript tail and give it a typed verdict.
///
/// "Stale" conflated three situations the operator responds to completely
/// differently — the task is DONE, the session is BLOCKED on a question or a
/// permission prompt, or it is genuinely HUNG mid-tool — and the ticker never
/// looked at the one artifact that knows which: the transcript. This pass
/// closes that, and maps each verdict onto the EXISTING lifecycle rather than
/// inventing a state:
///
/// - `Done`   → `mark_finished` (the same path the `FLEET:DONE` cue uses), and
///   the completion is handed to Athena's fleet bridge so a finished
///   run finally reaches the chat instead of dying in the grid.
/// - `Blocked`→ `AwaitingInput` with a typed reason.
/// - `Hung`   → left `Stale`; only the typed kind is stamped, because the
///   existing frozen reasons already say it well.
fn classify_pass(app: &AppHandle, grew_ids: &HashSet<String>) {
    use super::classify::{classify_parked, verdict_token, BlockedKind, ParkedVerdict};

    // Candidates: parked states only. A Running session is not parked, and a
    // Finished/Exited one has nothing left to decide.
    let candidates: Vec<(String, Option<String>)> = {
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                matches!(
                    s.state,
                    FleetSessionState::Stale
                        | FleetSessionState::AwaitingInput
                        | FleetSessionState::Idle
                )
            })
            .map(|s| (s.id.clone(), s.claude_session_id.clone()))
            .collect()
    };

    for (sid, csid) in candidates {
        let Some(csid) = csid else { continue };
        let Some(tail) = super::transcript_read::tail_lines(&csid) else {
            continue;
        };
        let screen = registry()
            .render_screen_for(&sid)
            .map(|(_, lines)| lines.join("\n"));
        let verdict = classify_parked(&tail, screen.as_deref(), grew_ids.contains(&sid));
        if verdict == ParkedVerdict::Unknown {
            continue;
        }
        let changed = registry().set_stale_kind(&sid, verdict_token(&verdict).map(str::to_string));

        match &verdict {
            ParkedVerdict::Done { summary } => {
                let summary = if summary.is_empty() {
                    "detected complete".to_string()
                } else {
                    summary.clone()
                };
                if let Some(prev) = registry().mark_finished(&sid, &summary) {
                    super::pty::emit_session_state(
                        app,
                        &sid,
                        Some(prev),
                        "finished",
                        Some(format!("Task complete: {summary}")),
                    );
                    super::debug_log::athena(
                        &sid,
                        "finished (classified)",
                        &format!("transcript tail reads as done — {summary}"),
                    );
                    crate::commands::companion::fleet_bridge::notify_completion(
                        app, &sid, &summary,
                    );
                }
            }
            ParkedVerdict::Blocked(kind) => {
                let reason = match kind {
                    BlockedKind::Question => {
                        "Waiting on your answer — the session asked a question."
                    }
                    BlockedKind::Permission => {
                        "Waiting on you — a permission or login prompt is on screen."
                    }
                };
                if let Some(prev) = registry().escalate_to_awaiting(&sid, reason) {
                    super::pty::emit_session_state(
                        app,
                        &sid,
                        Some(prev),
                        "awaiting_input",
                        Some(reason.to_string()),
                    );
                } else if changed {
                    super::pty::emit_registry_changed(app, "updated", &sid);
                }
            }
            // Hung keeps whatever frozen reason the time rules already wrote —
            // they describe it accurately. Only the typed kind is new.
            ParkedVerdict::Hung(_) => {
                if changed {
                    super::pty::emit_registry_changed(app, "updated", &sid);
                }
            }
            ParkedVerdict::Unknown => {}
        }
    }
}

fn limit_retry_pass(app: &AppHandle, now: i64) {
    let candidates: Vec<(String, bool)> = {
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                matches!(
                    s.state,
                    FleetSessionState::AwaitingInput
                        | FleetSessionState::Stale
                        | FleetSessionState::Idle
                )
            })
            .map(|s| (s.id.clone(), s.dozing || s.child_pid.is_none()))
            .collect()
    };
    // Entries for sessions the registry no longer knows (wake replaced the id
    // via lineage, or the row was removed) just age out here.
    {
        let ids: std::collections::HashSet<String> =
            candidates.iter().map(|(id, _)| id.clone()).collect();
        let mut m = limit_retry_map().lock().unwrap_or_else(|e| e.into_inner());
        m.retain(|id, _| ids.contains(id));
    }
    for (sid, asleep) in candidates {
        let Some((_, lines)) = registry().render_screen_for(&sid) else {
            continue;
        };
        let screen = lines.join("\n");
        if !screen_shows_limit_error(&screen) {
            let mut m = limit_retry_map().lock().unwrap_or_else(|e| e.into_inner());
            m.remove(&sid);
            // The session moved on — drop the countdown so the tile stops
            // advertising a reset that no longer gates anything.
            if registry().set_limit_reset(&sid, None) {
                super::pty::emit_registry_changed(app, "updated", &sid);
            }
            continue;
        }
        let mut entry = {
            let m = limit_retry_map().lock().unwrap_or_else(|e| e.into_inner());
            m.get(&sid).copied().unwrap_or_default()
        };
        // Read the ETA off the banner once (it does not change while parked)
        // and publish it — the operator can now SEE when the fleet comes back
        // instead of watching blind retries burn cycles.
        if entry.reset_at_ms == 0 {
            if let Some(at) = parse_limit_reset(&screen, now) {
                entry.reset_at_ms = at;
                if registry().set_limit_reset(&sid, Some(at)) {
                    super::pty::emit_registry_changed(app, "updated", &sid);
                }
                super::debug_log::athena(
                    &sid,
                    "limit eta",
                    &format!(
                        "banner states a reset — one retry scheduled in {}s",
                        (at + LIMIT_RESET_GRACE_MS - now) / 1000
                    ),
                );
            }
        }
        let interval = if asleep {
            LIMIT_RETRY_DOZED_INTERVAL_MS
        } else {
            LIMIT_RETRY_INTERVAL_MS
        };
        // Known ETA → hold fire until reset + grace, then spend exactly ONE
        // attempt. Unknown ETA (or that attempt already spent, meaning the
        // stated time did not hold) → today's blind cadence, unchanged.
        let scheduled = entry.reset_at_ms > 0 && !entry.fired_after_reset;
        if scheduled {
            if now < entry.reset_at_ms + LIMIT_RESET_GRACE_MS {
                continue;
            }
        } else if entry.count >= LIMIT_RETRY_MAX || now - entry.last_ms < interval {
            continue;
        }
        let count = entry.count;
        {
            entry.last_ms = now;
            entry.count += 1;
            if scheduled {
                entry.fired_after_reset = true;
            }
            let mut m = limit_retry_map().lock().unwrap_or_else(|e| e.into_inner());
            m.insert(sid.clone(), entry);
        }
        // Keep the process alive across the retry window (doze guard).
        crate::commands::companion::fleet_bridge::stamp_pending_assessment(&sid);
        super::debug_log::athena(
            &sid,
            "limit retry",
            &format!(
                "limit screen — mechanical retry {}/{} ({})",
                count + 1,
                LIMIT_RETRY_MAX,
                if asleep {
                    "wake + `continue`"
                } else {
                    "typing `continue`"
                }
            ),
        );
        if asleep {
            // The dozed process is gone — resume it (lineage-adopting wake),
            // then type `continue` once it boots. Under a still-active limit
            // the turn fails again and the session re-dozes in ~60s; the next
            // cycle fires in 15 min. Converges shortly after the limit lifts.
            let app = app.clone();
            let old = sid.clone();
            tauri::async_runtime::spawn(async move {
                match crate::commands::fleet::commands::fleet_wake_session(
                    app,
                    old.clone(),
                    None,
                    None,
                )
                .await
                {
                    Ok(new_id) => {
                        tokio::time::sleep(std::time::Duration::from_secs(25)).await;
                        let _ = registry().write_text_line(&new_id, "continue");
                    }
                    Err(e) => {
                        tracing::warn!(session_id = %old, error = %e, "limit retry: wake failed");
                    }
                }
            });
        } else {
            let _ = registry().write_text_line(&sid, "continue");
        }
    }
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
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                if s.dozing || s.child_pid.is_none() {
                    return false;
                }
                let idle_since = s.last_grew_ms.max(s.last_activity_ms);
                match s.state {
                    FleetSessionState::AwaitingInput => now - idle_since >= doze_ms,
                    FleetSessionState::Stale => now - idle_since >= stale_cutoff_ms + doze_ms,
                    // Declared complete — nothing left to type; free the
                    // process on the same window as awaiting.
                    FleetSessionState::Finished => now - idle_since >= doze_ms,
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
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| {
                matches!(s.state, FleetSessionState::Idle | FleetSessionState::Stale)
                    && s.claude_session_id.is_some()
                    // Already process-free (dozed, or rehydrated after a
                    // restart) — there is nothing left to free, and flipping
                    // the row to `Hibernated` would only hide what it was
                    // doing. Wake is the same gesture either way.
                    && !s.dozing
                    && s.child_pid.is_some()
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
                Some(format!(
                    "Auto-hibernated after {} min idle",
                    after_secs / 60
                )),
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
    let live = snaps
        .iter()
        .filter(|s| {
            s.has_pid
                && !matches!(
                    s.state,
                    FleetSessionState::Exited | FleetSessionState::Hibernated
                )
        })
        .count() as u64;
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
    candidates
        .into_iter()
        .take(overflow)
        .map(|s| s.id.clone())
        .collect()
}

/// Snapshot the registry into the pure policy's shape.
fn slot_snapshot() -> Vec<SlotSnap> {
    let map = registry()
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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
    fn dev_sessions_get_a_much_longer_frozen_fuse() {
        assert!(is_dev_session(Some("athena-dev")));
        assert!(is_dev_session(Some("athena-dev · personas")));
        assert!(!is_dev_session(Some("athena · personas")));
        assert!(!is_dev_session(None));

        // A dev run silent for 10 minutes is a `cargo check`, not a hang: the
        // ordinary 2-min fuse fires, the dev fuse does not.
        let stalled_ms = STALLED_AFTER_SECS * 1000;
        let silent_10min = NOW - 10 * 60_000;
        assert!(
            is_frozen_mid_run(
                FleetSessionState::Running,
                silent_10min,
                silent_10min,
                NOW,
                stalled_ms
            ),
            "ordinary session at 10 min silence reads as frozen"
        );
        assert!(
            !is_frozen_mid_run(
                FleetSessionState::Running,
                silent_10min,
                silent_10min,
                NOW,
                stalled_ms * DEV_SESSION_STALL_MULTIPLIER
            ),
            "a dev session mid-compile must NOT be labelled frozen"
        );
    }

    #[test]
    fn growth_revives_stale_and_idle_to_running() {
        use FleetSessionState::*;
        assert_eq!(
            staleness_transition(Stale, true, OLD, NOW, CUTOFF),
            Some(Running)
        );
        assert_eq!(
            staleness_transition(Idle, true, OLD, NOW, CUTOFF),
            Some(Running)
        );
        // Growth while already Running / AwaitingInput → no state change.
        assert_eq!(staleness_transition(Running, true, OLD, NOW, CUTOFF), None);
        assert_eq!(
            staleness_transition(AwaitingInput, true, OLD, NOW, CUTOFF),
            None
        );
    }

    #[test]
    fn flat_logs_past_cutoff_go_stale() {
        use FleetSessionState::*;
        assert_eq!(
            staleness_transition(Running, false, OLD, NOW, CUTOFF),
            Some(Stale)
        );
        assert_eq!(
            staleness_transition(Idle, false, OLD, NOW, CUTOFF),
            Some(Stale)
        );
        assert_eq!(
            staleness_transition(Spawning, false, OLD, NOW, CUTOFF),
            Some(Stale)
        );
    }

    #[test]
    fn flat_but_recent_stays_put() {
        use FleetSessionState::*;
        assert_eq!(
            staleness_transition(Running, false, FRESH, NOW, CUTOFF),
            None
        );
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
        assert_eq!(
            staleness_transition(Hibernated, false, OLD, NOW, CUTOFF),
            None
        );
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
        assert!(!is_frozen_mid_run(
            Running,
            SILENT,
            NOW - 10_000,
            NOW,
            STALL_MS
        ));
    }

    #[test]
    fn frozen_check_only_applies_to_running_pty_sessions() {
        use FleetSessionState::*;
        // Never produced a byte (0) → never-attached's case, not ours.
        assert!(!is_frozen_mid_run(Running, 0, SILENT, NOW, STALL_MS));
        // Non-Running states are governed by the other rules.
        assert!(!is_frozen_mid_run(Idle, SILENT, SILENT, NOW, STALL_MS));
        assert!(!is_frozen_mid_run(
            AwaitingInput,
            SILENT,
            SILENT,
            NOW,
            STALL_MS
        ));
        assert!(!is_frozen_mid_run(Spawning, SILENT, SILENT, NOW, STALL_MS));
        assert!(!is_frozen_mid_run(Stale, SILENT, SILENT, NOW, STALL_MS));
    }

    // ---- screen-movement corroboration ------------------------------------

    /// A delta measured `age_ms` before NOW.
    fn screen(changed: usize, total: usize, age_ms: i64) -> Option<ScreenDelta> {
        Some(ScreenDelta {
            changed_lines: changed,
            total_lines: total,
            at_ms: NOW - age_ms,
        })
    }

    #[test]
    fn no_delta_means_no_evidence_and_todays_behaviour() {
        // The fallback that makes the whole feature additive: nothing rendered
        // → no verdict → the flat-log rule and the PTY frozen rule decide
        // exactly as they did before.
        assert_eq!(usable_activity(None, NOW, CUTOFF), None);
        assert!(!screen_vetoes_stale(None));
        assert!(!is_frozen_by_screen(
            FleetSessionState::Running,
            None,
            Some(0),
            OLD,
            NOW,
            STALL_MS
        ));
        // And the transition itself is untouched.
        assert_eq!(
            staleness_transition(FleetSessionState::Running, false, OLD, NOW, CUTOFF),
            Some(FleetSessionState::Stale),
        );
    }

    #[test]
    fn unusable_samples_are_discarded() {
        // Too small to classify — `Working` there is a fail-safe, not evidence.
        assert_eq!(usable_activity(screen(1, 4, 0), NOW, CUTOFF), None);
        assert_eq!(usable_activity(screen(0, 3, 0), NOW, CUTOFF), None);
        // Older than the window asking → says nothing about now.
        assert_eq!(
            usable_activity(screen(9, 24, CUTOFF + 1), NOW, CUTOFF),
            None
        );
        // Fresh + classifiable → a real verdict.
        assert_eq!(
            usable_activity(screen(9, 24, 1_000), NOW, CUTOFF),
            Some(ScreenActivity::Working)
        );
        assert_eq!(
            usable_activity(screen(0, 24, 1_000), NOW, CUTOFF),
            Some(ScreenActivity::Silent)
        );
        assert_eq!(
            usable_activity(screen(1, 24, 1_000), NOW, CUTOFF),
            Some(ScreenActivity::Cosmetic)
        );
    }

    #[test]
    fn a_working_screen_vetoes_the_flat_log_stale_verdict() {
        // The flat-log rule still SAYS stale...
        assert_eq!(
            staleness_transition(FleetSessionState::Running, false, OLD, NOW, CUTOFF),
            Some(FleetSessionState::Stale),
        );
        // ...but content is visibly moving, so the tick suppresses it.
        assert!(screen_vetoes_stale(usable_activity(
            screen(9, 24, 1_000),
            NOW,
            CUTOFF
        )));
        // A spinner is not content, and neither is a frozen grid.
        assert!(!screen_vetoes_stale(usable_activity(
            screen(1, 24, 1_000),
            NOW,
            CUTOFF
        )));
        assert!(!screen_vetoes_stale(usable_activity(
            screen(0, 24, 1_000),
            NOW,
            CUTOFF
        )));
        // A tiny screen must never become a "never stale" hole.
        assert!(!screen_vetoes_stale(usable_activity(
            screen(1, 3, 1_000),
            NOW,
            CUTOFF
        )));
    }

    #[test]
    fn silence_clock_starts_holds_and_resets() {
        use FleetSessionState::*;
        let silent = Some(ScreenActivity::Silent);
        // Starts at the first silent observation, then holds that instant.
        assert_eq!(track_silence(None, Running, false, silent, NOW), Some(NOW));
        assert_eq!(
            track_silence(Some(OLD), Running, false, silent, NOW),
            Some(OLD)
        );
        // Any evidence of life clears it.
        assert_eq!(track_silence(Some(OLD), Running, true, silent, NOW), None);
        assert_eq!(
            track_silence(
                Some(OLD),
                Running,
                false,
                Some(ScreenActivity::Cosmetic),
                NOW
            ),
            None,
        );
        assert_eq!(track_silence(Some(OLD), Running, false, None, NOW), None);
        // A parked session shows a static screen by definition — never let
        // that accumulate and fire when it flips back to Running.
        assert_eq!(
            track_silence(Some(OLD), AwaitingInput, false, silent, NOW),
            None
        );
        assert_eq!(track_silence(Some(OLD), Idle, false, silent, NOW), None);
    }

    #[test]
    fn a_sustained_silent_screen_corroborates_frozen() {
        use FleetSessionState::*;
        let silent = Some(ScreenActivity::Silent);
        let since = NOW - STALL_MS; // silent for the whole stall window
                                    // Bytes are still arriving (the PTY rule stays quiet), nothing logged,
                                    // grid frozen throughout → stuck.
        assert!(!is_frozen_mid_run(Running, EMITTING, SILENT, NOW, STALL_MS));
        assert!(is_frozen_by_screen(
            Running,
            silent,
            Some(since),
            SILENT,
            NOW,
            STALL_MS
        ));
    }

    #[test]
    fn screen_frozen_verdict_needs_every_condition() {
        use FleetSessionState::*;
        let silent = Some(ScreenActivity::Silent);
        let since = NOW - STALL_MS;
        // One tick of silence is not sustained silence.
        assert!(!is_frozen_by_screen(
            Running,
            silent,
            Some(NOW),
            SILENT,
            NOW,
            STALL_MS
        ));
        // No clock at all (evidence was lost this tick).
        assert!(!is_frozen_by_screen(
            Running, silent, None, SILENT, NOW, STALL_MS
        ));
        // Recent growth or a hook → working quietly, never flagged.
        assert!(!is_frozen_by_screen(
            Running,
            silent,
            Some(since),
            NOW - 10_000,
            NOW,
            STALL_MS
        ));
        // The screen is moving.
        assert!(!is_frozen_by_screen(
            Running,
            Some(ScreenActivity::Cosmetic),
            Some(since),
            SILENT,
            NOW,
            STALL_MS
        ));
        // Only Running sessions; the rest are governed by the other rules.
        for state in [
            Idle,
            AwaitingInput,
            Spawning,
            Stale,
            Finished,
            Exited,
            Hibernated,
        ] {
            assert!(
                !is_frozen_by_screen(state, silent, Some(since), SILENT, NOW, STALL_MS),
                "{state:?}"
            );
        }
    }

    const ATTACH_MS: i64 = NEVER_ATTACHED_SECS * 1000;

    #[test]
    fn never_attached_flags_silent_unbound_spawn() {
        // Spawning, no cc id, idle past threshold → never attached.
        assert!(is_never_attached(
            FleetSessionState::Spawning,
            false,
            ATTACH_MS,
            ATTACH_MS
        ));
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

    fn snap(
        id: &str,
        state: FleetSessionState,
        has_cc_id: bool,
        has_pid: bool,
        last_activity_ms: i64,
    ) -> SlotSnap {
        SlotSnap {
            id: id.into(),
            state,
            has_cc_id,
            has_pid,
            last_activity_ms,
        }
    }

    #[test]
    fn live_slots_zero_cap_is_off() {
        use FleetSessionState::*;
        let snaps = vec![
            snap("a", Idle, true, true, 1),
            snap("b", Idle, true, true, 2),
        ];
        assert!(live_slot_evictions(&snaps, 0).is_empty());
    }

    #[test]
    fn live_slots_under_cap_evicts_nothing() {
        use FleetSessionState::*;
        let snaps = vec![
            snap("a", Running, true, true, 1),
            snap("b", Idle, true, true, 2),
        ];
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
        assert_eq!(
            live_slot_evictions(&snaps, 2),
            vec!["older-stale".to_string(), "old-idle".to_string()]
        );
        // cap 3 → evict only the single oldest candidate.
        assert_eq!(
            live_slot_evictions(&snaps, 3),
            vec!["older-stale".to_string()]
        );
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

    // ---- limit-reset ETA parsing ------------------------------------------

    use chrono::{Local, TimeZone, Timelike};

    /// Local wall-clock ms for "today at hh:mm" — the tests express intent in
    /// local time because that is exactly how the banner is interpreted.
    fn local_today_at(hour: u32, min: u32) -> i64 {
        let now = Local::now();
        Local
            .from_local_datetime(&now.date_naive().and_hms_opt(hour, min, 0).unwrap())
            .single()
            .unwrap()
            .timestamp_millis()
    }

    /// A "now" that leaves room for both an earlier and a later time today.
    fn midday() -> i64 {
        local_today_at(12, 0)
    }

    fn hm_of(ms: i64) -> (u32, u32) {
        let dt = Local.timestamp_millis_opt(ms).single().unwrap();
        (dt.hour(), dt.minute())
    }

    #[test]
    fn parses_the_live_banner_text() {
        // Verbatim from the 2026-07-24 fleet incident.
        let screen = "You've hit your session limit · resets 7:50pm (Europe/Prague) \
                      /usage-credits to finish what you're working on";
        let at = parse_limit_reset(screen, midday()).expect("banner states a time");
        assert_eq!(hm_of(at), (19, 50));
        assert!(at > midday());
    }

    #[test]
    fn parses_meridiem_and_24h_forms() {
        for (text, expect) in [
            ("resets 7:50pm", (19, 50)),
            ("resets 7:50 pm", (19, 50)),
            ("resets 12:05am", (0, 5)),
            ("resets 12:05pm", (12, 5)),
            ("resets 19:50", (19, 50)),
            ("limit resets 23:00 (utc)", (23, 0)),
        ] {
            let at = parse_limit_reset(text, local_today_at(0, 1))
                .unwrap_or_else(|| panic!("should parse: {text}"));
            assert_eq!(hm_of(at), expect, "{text}");
        }
    }

    #[test]
    fn timezone_parenthetical_is_display_only() {
        // Both resolve to the SAME local instant — we never shift by the
        // stated zone, by design (the banner already shows the user's tz).
        let a = parse_limit_reset("resets 7:50pm (Europe/Prague)", midday()).unwrap();
        let b = parse_limit_reset("resets 7:50pm", midday()).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn ambiguous_or_absent_times_yield_none() {
        // A bare sub-13 clock with no meridiem could be either half of the day.
        assert!(parse_limit_reset("resets 7:50", midday()).is_none());
        // Not a time at all.
        assert!(parse_limit_reset("resets soon", midday()).is_none());
        assert!(parse_limit_reset("resets", midday()).is_none());
        // No anchor word — never scrape an unrelated clock off the screen.
        assert!(parse_limit_reset("build finished at 19:50", midday()).is_none());
        // Impossible clocks.
        assert!(parse_limit_reset("resets 19:50pm", midday()).is_none());
        assert!(parse_limit_reset("resets 25:00", midday()).is_none());
        assert!(parse_limit_reset("resets 12:99", midday()).is_none());
    }

    #[test]
    fn a_time_already_past_today_rolls_to_tomorrow() {
        // "now" is 23:00; a stated 07:50 must mean the next morning.
        let now = local_today_at(23, 0);
        let at = parse_limit_reset("resets 7:50am", now).expect("parses");
        assert!(at > now, "reset must be in the future");
        assert!(at - now < 24 * 60 * 60 * 1000);
        assert_eq!(hm_of(at), (7, 50));
    }
}
