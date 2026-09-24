//! The fleet's ONE admission door: a durable dispatch queue over the
//! live-session cap.
//!
//! ## Why
//!
//! Every spawn lane used to call `stale::free_slot_for_spawn`, a soft cap that
//! hibernated an idle session when it could and otherwise let the spawn
//! through — the fleet never refused work and never remembered it. The cap
//! itself was a process-global fed from the frontend on every refresh and lost
//! on restart. Under an Autopilot, a night shift and an operator dispatching
//! into the same fleet, "start it anyway" is how a machine ends up with twenty
//! `claude` processes.
//!
//! ## What
//!
//! [`admit`] is the door. Under the cap ([`cap`], the
//! `fleet.max_parallel_sessions` setting) the dispatch spawns now through the
//! existing primitives; at the cap it becomes a `Queued` registry row and a
//! durable `fleet_sessions` row — same id, same address every surface holds —
//! carrying the dispatch (cwd, args, mode, run label) and its provenance
//! (origin, persona, goal, cycle). [`promote_head`] spawns queued rows on
//! their own id whenever a slot frees up (a session leaving the live set, a
//! raised cap, a boot reconcile), in rank order, skipping rows whose
//! `not_before_ms` is still ahead.
//!
//! ## Budgets
//!
//! The count cap is shorthand for "N sessions of equal cost", and fleet
//! sessions do not cost the same. With `fleet.dynamic_budgets` on (the
//! default) the door also charges each dispatch two resource budgets -
//! machine units and Claude-plan units - through the pure rules in
//! [`super::budgets`]: a dispatch starts now only when it is under the count
//! cap, its time gate has passed AND its charge fits; promotion takes the
//! first queued entry that fits (aged backfill), and a closed RAM gate, a full
//! five-hour window or a held GPU token defer PROMOTION only - nothing here
//! ever touches a session that is already live. The count cap stays the hard
//! ceiling; with the setting off the door is exactly the count-only door it
//! was before. The measured inputs ([`BudgetLive`]) are refreshed by the
//! staleness ticker ([`schedule_budget_tick`]), never per admission.
//!
//! ## Layering
//!
//! The in-memory registry is the admission authority while the app runs
//! (`live_count`, ranks); the durable table is what a restart rebuilds it
//! from (`persist::rehydrate` → [`reconcile_after_restore`]). Writes ride the
//! existing `persist::note_changed` piggyback on the registry-changed emit —
//! no second write path. State moves only through `registry::apply_transition`
//! (`Queued → Spawning` on promotion, `Queued → Exited` on cancel).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::db::repos::fleet_sessions;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_core::events::QueueChangedPayload;
use personas_core::models::{GpuClass, ResourceProfile};

use super::budgets::{self, BudgetInputs, Budgets, Charge, Used};
use super::pty::SpawnIdentity;
use super::registry::{
    now_ms, registry, AdmissionFacts, FleetRegistry, FleetSessionInner, OutputRing, OUTPUT_RING_CAP,
};
use super::types::{state_to_token, FleetSessionMode, FleetSessionState};

/// Who asked for a session. Stored on the row as its snake_case token so the
/// queue can say "Autopilot's, cycle 7" a restart later.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DispatchOrigin {
    Manual,
    DevRunner,
    DispatchIdeas,
    Athena,
    Autopilot,
    NightShift,
    FeedImpact,
    OrphanResume,
    /// A paired device dispatched this session to this one as a
    /// `fleet_session` remote job. The row also carries `remote_job_id` and
    /// `origin_peer_id`.
    Remote,
    /// Curator dispatched this session - either draining the operator's own
    /// request lane or acting on her plan. A worker she starts is HERS on the
    /// board, and the fallback below is why that matters: an unrecognised
    /// token reads as `Manual`, so a missing variant does not show up as an
    /// unknown origin, it shows up as the operator's own dispatch on the one
    /// board that exists to tell producers apart.
    Curator,
}

impl DispatchOrigin {
    /// Every variant, in declaration order.
    ///
    /// Exists so the round-trip test cannot be a hand-kept subset of the enum
    /// — which is what it was until 2026-09-24, when `Remote` had never been
    /// in it.
    pub const ALL: [DispatchOrigin; 10] = [
        DispatchOrigin::Manual,
        DispatchOrigin::DevRunner,
        DispatchOrigin::DispatchIdeas,
        DispatchOrigin::Athena,
        DispatchOrigin::Autopilot,
        DispatchOrigin::NightShift,
        DispatchOrigin::FeedImpact,
        DispatchOrigin::OrphanResume,
        DispatchOrigin::Remote,
        DispatchOrigin::Curator,
    ];

    /// The wire / row token — the same string `serde` writes.
    pub fn token(self) -> &'static str {
        match self {
            DispatchOrigin::Manual => "manual",
            DispatchOrigin::DevRunner => "dev_runner",
            DispatchOrigin::DispatchIdeas => "dispatch_ideas",
            DispatchOrigin::Athena => "athena",
            DispatchOrigin::Autopilot => "autopilot",
            DispatchOrigin::NightShift => "night_shift",
            DispatchOrigin::FeedImpact => "feed_impact",
            DispatchOrigin::OrphanResume => "orphan_resume",
            DispatchOrigin::Remote => "remote",
            DispatchOrigin::Curator => "curator",
        }
    }

    /// Inverse of [`Self::token`]; an unknown or absent token reads as
    /// `Manual`, which is what every pre-queue row was.
    ///
    /// Derived from [`Self::ALL`] and [`Self::token`] rather than written out
    /// as a second match, because a second match is a second place to forget a
    /// variant - and forgetting one here does not produce an unknown, it
    /// produces the OPERATOR'S label on somebody else's session. Ten string
    /// comparisons per row read; the rows are a board, not a hot loop.
    pub fn parse(token: Option<&str>) -> Self {
        token
            .and_then(|raw| Self::ALL.into_iter().find(|o| o.token() == raw))
            .unwrap_or(DispatchOrigin::Manual)
    }
}

/// Everything a spawn needs, plus who wants it. For `Headless` mode the
/// seed task travels in `args` behind [`TASK_ARG`] (the row's `args_json` is
/// the only durable place for it); `spawn_now` splits it back out.
#[derive(Clone, Debug)]
pub struct DispatchRequest {
    pub cwd: String,
    pub name: Option<String>,
    pub title: Option<String>,
    pub args: Vec<String>,
    pub mode: FleetSessionMode,
    pub run_label: Option<String>,
    pub origin: DispatchOrigin,
    pub persona_id: Option<String>,
    pub goal_id: Option<String>,
    /// Which autopilot cycle this dispatch runs (the goal's `[cycle:…:n]`
    /// marker index); `None` for every other origin.
    pub cycle_index: Option<i64>,
    /// Earliest start, epoch ms. A request whose gate is still ahead is
    /// QUEUED even under the cap — the queue is the one place the cadence
    /// floor of a re-enqueued cycle is enforced — and promoted once the gate
    /// has passed (the staleness ticker calls [`schedule_promote_head`]).
    pub not_before_ms: Option<i64>,
    /// What this run costs the machine and the plan (the charter's
    /// `spec.resourceProfile`, stamped by the dispatcher). `None` - a manual
    /// session, or a charter nobody tagged - is charged as
    /// [`ResourceProfile::default`].
    pub profile: Option<ResourceProfile>,
}

/// The provenance a dispatcher stamps on a request: who asked, for which
/// persona / goal / cycle, and the earliest start. One value instead of five
/// positional parameters on every spawn wrapper.
#[derive(Clone, Debug, Default)]
pub struct Provenance {
    pub origin: Option<DispatchOrigin>,
    pub persona_id: Option<String>,
    pub goal_id: Option<String>,
    pub cycle_index: Option<i64>,
    pub not_before_ms: Option<i64>,
}

impl Provenance {
    /// A plain origin with nothing else attached.
    pub fn from_origin(origin: DispatchOrigin) -> Self {
        Self {
            origin: Some(origin),
            ..Self::default()
        }
    }

    /// The origin, `Manual` when none was named.
    pub fn origin(&self) -> DispatchOrigin {
        self.origin.unwrap_or(DispatchOrigin::Manual)
    }
}

/// Marker in a headless dispatch's `args`: `[TASK_ARG, <task>, ...extra]`.
/// Never reaches the CLI — `split_headless_args` strips it.
pub const TASK_ARG: &str = "--fleet-task";

/// Marker pair in a headless dispatch's `args` naming the codex engine:
/// `["--engine", "codex", "--model", <model>]` — the same `row_args` the codex
/// worker already stamps on its row.
const ENGINE_ARG: &str = "--engine";
const MODEL_ARG: &str = "--model";

/// Build the `args` for a headless dispatch: the task, then the CLI extras.
pub fn headless_args(task: &str, extra: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(extra.len() + 2);
    out.push(TASK_ARG.to_string());
    out.push(task.to_string());
    out.extend(extra);
    out
}

/// Build the `args` for a codex maintenance worker dispatch.
pub fn codex_args(task: &str, model: &str) -> Vec<String> {
    headless_args(
        task,
        vec![
            ENGINE_ARG.to_string(),
            super::headless::CODEX_ENGINE.to_string(),
            MODEL_ARG.to_string(),
            model.to_string(),
        ],
    )
}

/// `(task, extra_args)` from a headless dispatch's `args`. A dispatch that
/// carries no task cannot be a headless session (the CLI needs a seed), so
/// that is a validation error at the door, not a later spawn failure.
fn split_headless_args(args: &[String]) -> Result<(String, Vec<String>), AppError> {
    let Some(pos) = args.iter().position(|a| a == TASK_ARG) else {
        return Err(AppError::Validation(
            "a headless dispatch must carry its task (`--fleet-task <task>`)".into(),
        ));
    };
    let Some(task) = args.get(pos + 1) else {
        return Err(AppError::Validation(
            "a headless dispatch's `--fleet-task` has no task after it".into(),
        ));
    };
    personas_core::validation::require_non_empty("task", task)?;
    let mut extra: Vec<String> = args[..pos].to_vec();
    extra.extend_from_slice(&args[pos + 2..]);
    Ok((task.clone(), extra))
}

/// The codex model when `args` names the codex engine, else `None`.
fn codex_model(args: &[String]) -> Option<String> {
    let engine = args
        .iter()
        .position(|a| a == ENGINE_ARG)
        .and_then(|i| args.get(i + 1))?;
    if engine != super::headless::CODEX_ENGINE {
        return None;
    }
    args.iter()
        .position(|a| a == MODEL_ARG)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

/// Admit refusal reason: the entry's machine or plan units exceed the STATIC
/// maximum budget, so no amount of waiting would ever fit it. Refused at the
/// door, never queued. The refusal is an `AppError::Validation` whose message
/// STARTS with this token (the `Admission` wire shape has no refused arm).
pub const REFUSAL_EXCEEDS_BUDGET: &str = "exceeds_budget";

/// Why promotion is being held back even though a count slot may be free.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BudgetHold {
    /// Ahead of Claude plan pace: the plan budget has shrunk.
    AheadOfPace,
    /// The five-hour window is full; the plan budget is zero.
    FiveHourFull,
    /// Measured RAM crossed the high-water mark; promotion is deferred.
    RamHighWater,
    /// A `gpu = exclusive` session holds the single GPU token.
    GpuTokenHeld,
}

/// The RAM promotion gate (hysteresis: closes high, reopens low). `Warming`
/// is the sampler's first sample, which is never acted on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RamGate {
    #[default]
    Open,
    Closed,
    Warming,
}

/// The two budgets admission charges, as the Monitor reads them.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetBudgets {
    /// `fleet.dynamic_budgets` - off means pure count-cap behaviour.
    pub enabled: bool,
    pub machine_used: u32,
    pub machine_budget: u32,
    pub plan_used: u32,
    pub plan_budget: u32,
    /// The plan budget at pace factor 1 (static cap x 2).
    pub plan_budget_max: u32,
    pub pace_factor: f64,
    /// Negative = ahead of plan pace; `None` when pacing is unknown.
    pub behind_pct: Option<f64>,
    pub ram_pct: Option<f64>,
    pub ram_gate: RamGate,
    /// Session id holding the single GPU token, if any.
    pub gpu_holder: Option<String>,
    /// The one reason promotion is currently held, if it is.
    pub hold: Option<BudgetHold>,
}

impl FleetBudgets {
    /// Budgets that change nothing: every count slot is worth one machine
    /// unit and two plan units, nothing is charged, nothing is held.
    pub fn neutral(cap: u32) -> Self {
        let plan = cap.saturating_mul(2);
        Self {
            enabled: true,
            machine_used: 0,
            machine_budget: cap,
            plan_used: 0,
            plan_budget: plan,
            plan_budget_max: plan,
            pace_factor: 1.0,
            behind_pct: None,
            ram_pct: None,
            ram_gate: RamGate::Open,
            gpu_holder: None,
            hold: None,
        }
    }
}

/// What the door decided.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Admission {
    pub session_id: String,
    /// `Spawning` (started now) or `Queued` (waiting; see `rank`).
    pub state: FleetSessionState,
    pub rank: Option<u32>,
    pub cap: u32,
    /// Live sessions at the moment of the decision, this one included when
    /// it started.
    pub running: u32,
}

/// One row of the queue, for the Monitor.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetQueueEntry {
    pub session_id: String,
    pub rank: u32,
    pub origin: DispatchOrigin,
    pub persona_id: Option<String>,
    pub goal_id: Option<String>,
    #[ts(type = "number")]
    pub queued_at_ms: i64,
    #[ts(type = "number | null")]
    pub not_before_ms: Option<i64>,
    /// `now + rank × mean duration of the last 20 ended sessions`; `None`
    /// when there is no history to estimate from.
    #[ts(type = "number | null")]
    pub estimated_start_ms: Option<i64>,
    /// Machine units this entry will be charged (see `MachineLoad::units`).
    pub machine_units: u32,
    /// Plan units this entry will be charged (see `EffortBand::units`).
    pub plan_units: u32,
    pub gpu: GpuClass,
    /// How many times promotion backfilled past this entry.
    pub skips: u32,
    /// Why THIS entry is not being promoted, when a budget is the reason.
    pub held_by: Option<BudgetHold>,
}

/// The queue as the Monitor reads it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetQueueSnapshot {
    pub cap: u32,
    pub running: u32,
    pub queued: u32,
    /// `max(0, running - cap)` — how far "start now" has pushed the fleet
    /// past its own line.
    pub over_admitted: u32,
    pub entries: Vec<FleetQueueEntry>,
    pub budgets: FleetBudgets,
}

/// How many ended sessions the start estimate averages over.
const ESTIMATE_HISTORY: u32 = 20;

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

/// The live-session cap from `fleet.max_parallel_sessions`, clamped to its
/// bounds; the default when unset or unparseable. Also refreshes the cached
/// copy `stale::live_slot_cap` serves to pool-less readers.
pub fn cap(pool: &DbPool) -> u32 {
    let cap =
        crate::db::repos::core::settings::get(pool, settings_keys::FLEET_MAX_PARALLEL_SESSIONS)
            .ok()
            .flatten()
            .and_then(|v| v.trim().parse::<u32>().ok())
            .map(|n| {
                n.clamp(
                    settings_keys::FLEET_MAX_PARALLEL_SESSIONS_MIN,
                    settings_keys::FLEET_MAX_PARALLEL_SESSIONS_MAX,
                )
            })
            .unwrap_or(settings_keys::FLEET_MAX_PARALLEL_SESSIONS_DEFAULT);
    super::stale::note_live_slot_cap(cap);
    cap
}

/// [`cap`] through an `AppHandle`; before the DB pool is managed (early
/// boot) it is the last cached reading.
pub fn cap_via_app(app: &AppHandle) -> u64 {
    match pool_of(app) {
        Some(pool) => u64::from(cap(&pool)),
        None => super::stale::live_slot_cap(),
    }
}

/// How many sessions occupy a live slot right now, from the in-memory
/// registry.
pub fn live_count() -> u32 {
    registry().live_count()
}

/// The last `fleet.dynamic_budgets` reading, for a reader with no pool yet.
static DYNAMIC_BUDGETS_CACHED: AtomicBool =
    AtomicBool::new(settings_keys::FLEET_DYNAMIC_BUDGETS_DEFAULT);

/// `fleet.dynamic_budgets` - the kill switch. Off = the count-only door.
/// Unset or unparseable reads as the default (on).
pub fn dynamic_budgets(pool: &DbPool) -> bool {
    let on = crate::db::repos::core::settings::get(pool, settings_keys::FLEET_DYNAMIC_BUDGETS)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<bool>().ok())
        .unwrap_or(settings_keys::FLEET_DYNAMIC_BUDGETS_DEFAULT);
    DYNAMIC_BUDGETS_CACHED.store(on, Ordering::Relaxed);
    on
}

/// [`dynamic_budgets`] through an `AppHandle`, read like [`cap_via_app`].
pub fn dynamic_budgets_via_app(app: &AppHandle) -> bool {
    match pool_of(app) {
        Some(pool) => dynamic_budgets(&pool),
        None => DYNAMIC_BUDGETS_CACHED.load(Ordering::Relaxed),
    }
}

// ---------------------------------------------------------------------------
// The measured half of the budgets
// ---------------------------------------------------------------------------

/// A pacing reading older than this is treated as "not measured" (fail open):
/// the ticker only refreshes it while the fleet has work, so an idle fleet's
/// last reading must not hold the first dispatch of the next morning.
const PACING_STALE_MS: i64 = 10 * 60 * 1000;

/// What the budgets were last measured from, plus the GPU token. Process
/// global ([`budget_live`]); refreshed by [`refresh_budget_state`] on the
/// staleness ticker and read - never re-measured - by every admission
/// (`resource-denominated-bounds`: "resolve once and cache; never re-read on
/// the hot path").
#[derive(Clone, Debug)]
pub(super) struct BudgetLive {
    behind_pct: Option<f64>,
    five_hour_full: bool,
    governor_stop: bool,
    memory_slots: Option<u32>,
    /// When the pacing half was read; `0` = never.
    pacing_as_of_ms: i64,
    ram_pct: Option<f64>,
    ram_gate: RamGate,
    ram_samples: u32,
    /// Session id holding the single GPU token.
    gpu_holder: Option<String>,
    /// The `(gate, hold)` pair last announced on `fleet-queue-changed`.
    announced: (RamGate, Option<BudgetHold>),
}

impl BudgetLive {
    pub(super) const fn new() -> Self {
        Self {
            behind_pct: None,
            five_hour_full: false,
            governor_stop: false,
            memory_slots: None,
            pacing_as_of_ms: 0,
            ram_pct: None,
            // Nothing sampled yet: warming, which never holds.
            ram_gate: RamGate::Warming,
            ram_samples: 0,
            gpu_holder: None,
            announced: (RamGate::Warming, None),
        }
    }

    /// The pure rules' inputs as of `now`. A stale pacing half is dropped.
    fn inputs(&self, cap: u32, enabled: bool, now: i64) -> BudgetInputs {
        let fresh =
            self.pacing_as_of_ms > 0 && now.saturating_sub(self.pacing_as_of_ms) <= PACING_STALE_MS;
        BudgetInputs {
            cap,
            enabled,
            behind_pct: self.behind_pct.filter(|_| fresh),
            five_hour_full: fresh && self.five_hour_full,
            governor_stop: fresh && self.governor_stop,
            memory_slots: self.memory_slots.filter(|_| fresh),
            ram_pct: self.ram_pct,
            ram_gate: self.ram_gate,
        }
    }

    /// Take one RAM reading through the gate's state machine. Returns
    /// `(previous, next)` so the caller can log and announce a transition.
    fn note_ram(&mut self, ram_pct: Option<f64>) -> (RamGate, RamGate) {
        self.ram_samples = self.ram_samples.saturating_add(1);
        self.ram_pct = ram_pct;
        let prev = self.ram_gate;
        self.ram_gate = budgets::next_ram_gate(prev, ram_pct, self.ram_samples);
        (prev, self.ram_gate)
    }

    /// The GPU token follows the live set: a holder that left it releases the
    /// token, and a free token is adopted by the OLDEST live `gpu = exclusive`
    /// session. The second half is the startup recovery (restored live rows
    /// carry their `gpu_class`) and what settles a start-now that put two
    /// exclusive sessions live at once.
    fn reconcile_gpu(&mut self, live: &[(String, i64, Charge)]) {
        let exclusive = |id: &str| {
            live.iter()
                .any(|(lid, _, c)| lid == id && c.gpu == GpuClass::Exclusive)
        };
        if self.gpu_holder.as_deref().is_some_and(|h| !exclusive(h)) {
            self.gpu_holder = None;
        }
        if self.gpu_holder.is_none() {
            self.gpu_holder = live
                .iter()
                .filter(|(_, _, c)| c.gpu == GpuClass::Exclusive)
                .min_by_key(|(id, created, _)| (*created, id.clone()))
                .map(|(id, _, _)| id.clone());
        }
    }

    /// What the live set costs right now, token reconciled first.
    fn used(&mut self, reg: &FleetRegistry) -> Used {
        let live = reg.live_charges();
        self.reconcile_gpu(&live);
        let mut used = Used {
            gpu_held: self.gpu_holder.is_some(),
            ..Used::default()
        };
        for (_, _, charge) in &live {
            used.add(*charge);
        }
        used
    }
}

static BUDGET_LIVE: Mutex<BudgetLive> = Mutex::new(BudgetLive::new());

/// The process-global measured state. A poisoned lock is recovered: this is a
/// cache of readings, and the next tick rewrites it.
fn budget_live() -> std::sync::MutexGuard<'static, BudgetLive> {
    BUDGET_LIVE.lock().unwrap_or_else(|e| e.into_inner())
}

/// `(inputs, used, gpu holder)` for one decision, read under one lock
/// acquisition.
fn budget_reading(
    reg: &FleetRegistry,
    cap: u32,
    enabled: bool,
    now: i64,
) -> (BudgetInputs, Used, Option<String>) {
    let mut live = budget_live();
    let used = live.used(reg);
    (
        live.inputs(cap, enabled, now),
        used,
        live.gpu_holder.clone(),
    )
}

fn pool_of(app: &AppHandle) -> Option<DbPool> {
    app.try_state::<Arc<AppState>>().map(|s| s.db.clone())
}

fn pool_or_err(app: &AppHandle) -> Result<DbPool, AppError> {
    pool_of(app).ok_or_else(|| AppError::Internal("fleet queue: app state not ready".into()))
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/// Whether a dispatch may start now: strictly under the cap.
fn under_cap(running: u32, cap: u32) -> bool {
    running < cap
}

/// Why a dispatch waits instead of starting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QueueWhy {
    /// The fleet is at its live-session count cap.
    Cap,
    /// The dispatch's own `not_before_ms` is still ahead.
    Gated,
    /// A named budget reason holds it.
    Held(BudgetHold),
    /// The budgets are occupied by live work (no pressure signal).
    BudgetFull,
    /// An aged entry ahead of it must start first: backfill is suspended.
    BehindAged,
}

impl QueueWhy {
    fn label(self) -> String {
        match self {
            QueueWhy::Cap => "the fleet is at its live-session cap".into(),
            QueueWhy::Gated => "its earliest start is still ahead".into(),
            QueueWhy::Held(hold) => format!("held by {}", hold_label(hold)),
            QueueWhy::BudgetFull => "the machine and plan budgets are in use".into(),
            QueueWhy::BehindAged => {
                "an older dispatch that has waited its turn out starts first".into()
            }
        }
    }
}

/// The hold's words for a row's `state_reason` and the lifecycle log.
fn hold_label(hold: BudgetHold) -> &'static str {
    match hold {
        BudgetHold::AheadOfPace => "the plan budget (ahead of the weekly pace)",
        BudgetHold::FiveHourFull => "the five-hour window (full)",
        BudgetHold::RamHighWater => "the RAM gate (memory above its high-water mark)",
        BudgetHold::GpuTokenHeld => "the GPU token (another session holds it)",
    }
}

/// The door's three verdicts (`admission-vocabulary`): start now, wait, or
/// never. `Start.passed` names the queued entries this start backfills past.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Door {
    Start { passed: Vec<String> },
    Queue(QueueWhy),
    Refuse,
}

/// One walk of the queue in promotion order against the budgets.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct QueueScan {
    /// The first time-eligible entry that fits - what promotion starts next.
    pick: Option<String>,
    /// Time-eligible entries AHEAD of the pick (or all of them, when there is
    /// no pick) that do not fit right now.
    unfit: Vec<String>,
    /// The walk stopped at an AGED unfit entry: nothing behind it may start
    /// until it does.
    blocked_by_aged: bool,
}

/// Walk the queue: first time-eligible entry that fits, honouring the aging
/// bound. With budgets off this is [`head_to_promote`] and nothing else.
fn scan_queue(reg: &FleetRegistry, now: i64, inputs: &BudgetInputs, used: Used) -> QueueScan {
    if !inputs.enabled {
        return QueueScan {
            pick: head_to_promote(reg, now),
            ..QueueScan::default()
        };
    }
    let budgets = budgets::budgets_from(inputs, used);
    let mut scan = QueueScan::default();
    for (id, not_before, facts) in reg.queued_admissions_in_order() {
        if not_before.is_some_and(|t| t > now) {
            // A time gate is skipped, not waited on, and is not "unfit".
            continue;
        }
        if budgets::fits(facts.charge(), used, &budgets).is_ok() {
            scan.pick = Some(id);
            return scan;
        }
        let aged = budgets::is_aged(facts.skip_count, facts.first_unfit_at_ms, now);
        scan.unfit.push(id);
        if aged {
            scan.blocked_by_aged = true;
            return scan;
        }
    }
    scan
}

/// The pure admission decision. Budgets off = the count-only door, exactly.
/// Every origin obeys the same rules - there are no exemptions here; the one
/// bypass is the operator's explicit [`fleet_queue_start_now`].
fn door_verdict(
    reg: &FleetRegistry,
    req: &DispatchRequest,
    now: i64,
    inputs: &BudgetInputs,
    used: Used,
) -> Door {
    door_verdict_for(
        reg,
        Charge::from_profile(req.profile.as_ref()),
        req.not_before_ms,
        now,
        inputs,
        used,
    )
}

/// [`door_verdict`] over the two facts of the request it reads.
fn door_verdict_for(
    reg: &FleetRegistry,
    charge: Charge,
    not_before_ms: Option<i64>,
    now: i64,
    inputs: &BudgetInputs,
    used: Used,
) -> Door {
    let under = under_cap(reg.live_count(), inputs.cap);
    let gate_ahead = not_before_ms.is_some_and(|t| t > now);
    if !inputs.enabled {
        return if under && !gate_ahead {
            Door::Start { passed: Vec::new() }
        } else if gate_ahead {
            Door::Queue(QueueWhy::Gated)
        } else {
            Door::Queue(QueueWhy::Cap)
        };
    }
    let budgets = budgets::budgets_from(inputs, used);
    if budgets::never_fits(charge, &budgets) {
        return Door::Refuse;
    }
    if gate_ahead {
        return Door::Queue(QueueWhy::Gated);
    }
    if !under {
        return Door::Queue(QueueWhy::Cap);
    }
    if let Err(unfit) = budgets::fits(charge, used, &budgets) {
        return Door::Queue(match unfit.hold() {
            Some(hold) => QueueWhy::Held(hold),
            None => QueueWhy::BudgetFull,
        });
    }
    // It fits - but a direct start is a backfill past the waiting line, and
    // an aged entry suspends backfill for arrivals as it does for promotion.
    let scan = scan_queue(reg, now, inputs, used);
    if scan.blocked_by_aged {
        return Door::Queue(QueueWhy::BehindAged);
    }
    Door::Start { passed: scan.unfit }
}

/// Record a pass's verdict on the entries it found unfit (see
/// [`FleetRegistry::note_unfit`]). Returns what changed, for the durable rows.
fn mark_unfit(
    reg: &FleetRegistry,
    unfit: &[String],
    now: i64,
    skipped: bool,
) -> Vec<(String, u32, Option<i64>)> {
    unfit
        .iter()
        .filter_map(|id| {
            reg.note_unfit(id, now, skipped)
                .map(|(skips, first)| (id.clone(), skips, first))
        })
        .collect()
}

/// Write the skip memory to the durable rows.
fn persist_skips(app: &AppHandle, marks: &[(String, u32, Option<i64>)]) {
    if marks.is_empty() {
        return;
    }
    let Some(pool) = pool_of(app) else { return };
    for (id, skips, first) in marks {
        if let Err(err) = fleet_sessions::set_skip_state(&pool, id, *skips, *first) {
            tracing::warn!(session_id = %id, error = %err, "fleet queue: skip-state write failed");
        }
    }
}

/// Admit a dispatch: spawn it now if a slot is free, queue it otherwise.
pub async fn admit(app: &AppHandle, req: DispatchRequest) -> Result<Admission, AppError> {
    admit_sync(app, req)
}

/// [`admit`] for a caller that is not async — the same door, not a second
/// one. The approval executors (`execute_fleet_spawn`, `execute_fleet_dispatch`,
/// `execute_dev_improve`, the night plan) and the feed-impact sweep run inside
/// sync dispatchers, and nothing in the decision awaits: the cap is one
/// settings read, the count is the in-memory registry, and both spawn
/// primitives are blocking calls already.
pub fn admit_sync(app: &AppHandle, req: DispatchRequest) -> Result<Admission, AppError> {
    personas_core::validation::require_non_empty("cwd", &req.cwd)?;
    if matches!(req.mode, FleetSessionMode::Headless) {
        // Fail at the door, not at promotion time on a row nobody can start.
        split_headless_args(&req.args)?;
    }
    let cap = cap_via_app(app) as u32;
    let running = live_count();
    let now = now_ms();
    let gate_ahead = req.not_before_ms.is_some_and(|t| t > now);
    let (inputs, used, _) = budget_reading(registry(), cap, dynamic_budgets_via_app(app), now);
    let verdict = door_verdict(registry(), &req, now, &inputs, used);
    if let Door::Refuse = verdict {
        let charge = Charge::from_profile(req.profile.as_ref());
        super::debug_log::lifecycle(
            "-",
            "refused",
            &format!(
                "{REFUSAL_EXCEEDS_BUDGET} · {} machine / {} plan units can never fit",
                charge.machine, charge.plan
            ),
        );
        return Err(AppError::Validation(format!(
            "{REFUSAL_EXCEEDS_BUDGET}: this dispatch is charged {} machine and {} plan units, \
             more than the fleet's budgets could ever hold - declare a lighter resource profile",
            charge.machine, charge.plan
        )));
    }
    if let Door::Start { passed } = &verdict {
        let session_id = spawn_now(app, &req, None)?;
        // A direct start is a backfill past whatever waits unfit: count it -
        // once the spawn has actually happened.
        persist_skips(app, &mark_unfit(registry(), passed, now, true));
        super::debug_log::lifecycle(
            &session_id,
            "admitted",
            &format!("started now · {} of {cap} live", running + 1),
        );
        return Ok(Admission {
            session_id,
            state: FleetSessionState::Spawning,
            rank: None,
            cap,
            running: running + 1,
        });
    }
    let budget_wait = match verdict {
        Door::Queue(why @ (QueueWhy::Held(_) | QueueWhy::BudgetFull | QueueWhy::BehindAged)) => {
            Some(why)
        }
        _ => None,
    };
    let (session_id, rank) = enqueue(app, &req, cap, running)?;
    if let Some(why) = budget_wait {
        // Under the count cap and still waiting: say what holds it.
        registry().set_state_reason(
            &session_id,
            &format!("Queued at rank {rank} — {}", why.label()),
        );
        super::persist::note_changed(app, &session_id);
    }
    super::debug_log::lifecycle(
        &session_id,
        "queued",
        &if let Some(why) = budget_wait {
            format!("rank {rank} · {} ({running} of {cap} live)", why.label())
        } else if gate_ahead {
            format!(
                "rank {rank} · gated until {} ({running} of {cap} live)",
                req.not_before_ms.unwrap_or_default()
            )
        } else {
            format!("rank {rank} · fleet at its cap ({running} of {cap} live)")
        },
    );
    Ok(Admission {
        session_id,
        state: FleetSessionState::Queued,
        rank: Some(rank),
        cap,
        running,
    })
}

/// Spawn through the existing primitives. `identity` is the queued row's own
/// ids on promotion, `None` for an immediate start.
fn spawn_now(
    app: &AppHandle,
    req: &DispatchRequest,
    identity: Option<SpawnIdentity>,
) -> Result<String, AppError> {
    let cwd = PathBuf::from(&req.cwd);
    // `(id, name to store)`: the PTY lane resolves the requested CLI name
    // (collision discriminator) and that resolved string is what the row
    // keeps; the headless lane passes no name to the CLI, so the request's
    // name is stored as-is.
    let spawned = match req.mode {
        FleetSessionMode::Interactive => super::pty::spawn_session_with_identity(
            app.clone(),
            cwd,
            req.args.clone(),
            120,
            32,
            req.name.clone(),
            identity,
        )
        .map(|(id, cli_name)| (id, cli_name.or_else(|| req.name.clone()))),
        FleetSessionMode::Headless => {
            let (task, extra) = split_headless_args(&req.args)?;
            match codex_model(&extra) {
                Some(model) => super::headless::spawn_codex_worker_with_identity(
                    app.clone(),
                    cwd,
                    task,
                    model,
                    req.run_label.as_deref(),
                    identity,
                ),
                None => super::headless::spawn_headless_session_with_identity(
                    app.clone(),
                    cwd,
                    task,
                    extra,
                    req.run_label.as_deref(),
                    identity,
                ),
            }
            .map(|id| (id, req.name.clone()))
        }
    };
    let (id, name) = spawned.map_err(AppError::ProcessSpawn)?;
    // A started dispatch keeps its provenance on the row (an immediate start
    // never went through `enqueue`, so stamp it here).
    registry().stamp_provenance(
        &id,
        Some(req.origin.token().to_string()),
        req.persona_id.clone(),
        req.goal_id.clone(),
        req.cycle_index,
    );
    // ... and its charge: the live set's cost is summed from the rows, so a
    // session that never queued (or was started over the budgets by the
    // operator) is counted in `used` like any other. A promoted row already
    // carries the charge it was admitted with; the stamp never overwrites it.
    registry().stamp_charge(&id, Charge::from_profile(req.profile.as_ref()));
    // Take the GPU token (a no-op unless this row is `gpu = exclusive` and the
    // token is free) and make the stamps durable.
    budget_live().used(registry());
    super::persist::note_changed(app, &id);
    // A promoted row keeps the display name it was given while it waited (a
    // dispatcher may have renamed it, e.g. `athena-writer · personas`); only a
    // row with no name yet takes the spawn's.
    if registry().name_of(&id).is_none() {
        if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
            registry().rename(&id, Some(name));
        }
    }
    if let Some(title) = req.title.as_deref() {
        registry().set_title(&id, title);
    }
    Ok(id)
}

/// What a batch of admissions came to, in the words a dispatcher reports:
/// `admitted 5, queued 2 (positions 3..4), cap 10`. Athena's executors put
/// this in their result text so her next turn re-plans against the number;
/// the night shift, feed impact and the ideas dispatch report it the same way.
pub fn summarize_admissions(admissions: &[Admission]) -> String {
    let admitted = admissions.len();
    let ranks: Vec<u32> = admissions.iter().filter_map(|a| a.rank).collect();
    let queued = ranks.len();
    let cap = admissions.iter().map(|a| a.cap).max().unwrap_or(0);
    let positions = match (ranks.iter().min(), ranks.iter().max()) {
        (Some(lo), Some(hi)) if lo == hi => format!(" (position {lo})"),
        (Some(lo), Some(hi)) => format!(" (positions {lo}..{hi})"),
        _ => String::new(),
    };
    format!("admitted {admitted}, queued {queued}{positions}, cap {cap}")
}

/// The claude id a queued dispatch will bind: the resumed conversation's id
/// for a `--resume` spawn, a fresh UUID otherwise.
fn claude_id_for(args: &[String]) -> String {
    args.iter()
        .position(|a| a == "--resume")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

/// Build the `Queued` registry row for a dispatch. Pure over its inputs so
/// the tests can exercise it against a private registry.
fn queued_inner(
    req: &DispatchRequest,
    id: String,
    claude_session_id: String,
    rank: u32,
    now: i64,
    cap: u32,
    running: u32,
) -> FleetSessionInner {
    let cwd = PathBuf::from(&req.cwd);
    let project_label = cwd
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let (run_id, run_label) = match req.run_label.as_deref() {
        Some(label) => super::run::claim_run_for_labeled_spawn(label),
        None => super::run::claim_run_for_spawn(),
    };
    FleetSessionInner {
        id,
        claude_session_id: Some(claude_session_id),
        cwd,
        project_label,
        name: req.name.clone(),
        title: req.title.clone(),
        athena_active_until_ms: 0,
        args: req.args.clone(),
        mode: req.mode,
        cols: 120,
        rows: 32,
        state: FleetSessionState::Queued,
        last_activity_ms: now,
        last_pty_output_ms: 0,
        last_grew_ms: 0,
        created_at_ms: now,
        child_pid: None,
        exit_code: None,
        state_reason: Some(format!(
            "Queued at rank {rank} — the fleet is at its live-session cap ({running} of {cap})"
        )),
        limit_reset_at_ms: 0,
        run_id,
        run_label,
        stale_kind: None,
        queue_rank: Some(rank),
        queued_at_ms: Some(now),
        not_before_ms: req.not_before_ms,
        origin: Some(req.origin.token().to_string()),
        persona_id: req.persona_id.clone(),
        goal_id: req.goal_id.clone(),
        cycle_index: req.cycle_index,
        // The verdict precedes the record, and the record carries the charge:
        // promotion and `used` both read it from the row.
        admission: AdmissionFacts::charged(Charge::from_profile(req.profile.as_ref())),
        master: Mutex::new(None),
        writer: Mutex::new(None),
        hibernating: AtomicBool::new(false),
        dozing: false,
        reaped: false,
        output: Arc::new(Mutex::new(OutputRing::new(OUTPUT_RING_CAP))),
        killer: None,
    }
}

/// Insert a queued row into `reg` at the tail. Returns `(id, rank)`.
fn enqueue_into(
    reg: &FleetRegistry,
    req: &DispatchRequest,
    now: i64,
    cap: u32,
    running: u32,
) -> (String, u32) {
    let rank = reg
        .queued_in_order()
        .iter()
        .map(|(_, rank, _, _)| *rank)
        .filter(|r| *r != u32::MAX)
        .max()
        .unwrap_or(0)
        + 1;
    let id = uuid::Uuid::new_v4().to_string();
    let csid = claude_id_for(&req.args);
    reg.insert(queued_inner(req, id.clone(), csid, rank, now, cap, running));
    (id, rank)
}

/// Queue a dispatch: registry row + durable row (via the registry-changed
/// piggyback) + the two events.
fn enqueue(
    app: &AppHandle,
    req: &DispatchRequest,
    cap: u32,
    running: u32,
) -> Result<(String, u32), AppError> {
    // Durable by contract — a queue that cannot be persisted is not a queue.
    pool_or_err(app)?;
    let (id, rank) = enqueue_into(registry(), req, now_ms(), cap, running);
    super::pty::emit_registry_changed(app, "added", &id);
    emit_queue_changed(app, "enqueued", Some(&id));
    Ok((id, rank))
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

/// One promotion pass at a time: the hook fires from every state emit, and
/// two overlapping passes would both read the same free slot.
static PROMOTING: AtomicBool = AtomicBool::new(false);

/// Schedule [`promote_head`] on the runtime. Never blocks the caller — this is
/// what the state emitter and the settings writer call.
pub fn schedule_promote_head(app: &AppHandle) {
    schedule_promotion(app, false);
}

/// The staleness ticker's call: re-measure the budgets' inputs (RAM gate,
/// pacing), THEN run a promotion pass. This is what re-evaluates the queue
/// when nothing left the live set - a RAM gate that reopened, a pace that
/// recovered, a `not_before_ms` that came due. One existing timer, no new one.
pub fn schedule_budget_tick(app: &AppHandle) {
    schedule_promotion(app, true);
}

fn schedule_promotion(app: &AppHandle, refresh: bool) {
    let app = app.clone();
    // Spawn on the runtime's own tokio handle (callable from any thread, as
    // the PTY readers are) so the JoinHandle carries a `JoinError` whose
    // `is_panic` can be read.
    let rt = tauri::async_runtime::handle();
    let handle = rt.inner().spawn(async move {
        if refresh {
            refresh_budget_state(&app).await;
        }
        promote_head(&app).await;
    });
    // The promotion pass's death is its own outcome: a panic here would leave
    // `PROMOTING` latched and the queue head wedged, so it is named and the
    // latch released rather than folded into a vanished task.
    rt.inner().spawn(async move {
        if let Err(e) = handle.await {
            if e.is_panic() {
                PROMOTING.store(false, Ordering::SeqCst);
                tracing::error!("fleet queue: promotion pass PANICKED — latch released");
            }
        }
    });
}

/// One warning per outage, not one per tick.
static RAM_PROBE_WARNED: AtomicBool = AtomicBool::new(false);

/// Re-measure what the budgets are derived from. With the kill switch off
/// nothing is sampled. The RAM reading is taken every tick (one cheap sample
/// of the shared sampler); the pacing half - which may cost a usage-endpoint
/// call, cached 45 s process-wide - only while the fleet has work, so an idle
/// fleet does not poll. Defers promotion only: nothing here reaches a live
/// session.
async fn refresh_budget_state(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let state: Arc<AppState> = state.inner().clone();
    let pool = state.db.clone();
    if !dynamic_budgets(&pool) {
        return;
    }
    let fleet_has_work = live_count() > 0 || !registry().queued_in_order().is_empty();
    let (ram_pct, pacing) = if fleet_has_work {
        let pacing = crate::engine::subscription::usage_pacing::verdict(&pool, &state).await;
        let stopped = crate::engine::subscription::usage_governor::verdict(&pool)
            .await
            .blocked;
        (Some(pacing.memory_used_pct), Some((pacing, stopped)))
    } else {
        let mem = crate::engine::subscription::usage_pacing::read_memory(&state);
        (Some(mem.used_pct), None)
    };
    // A sampler that could not read the host reports 0 of 0: spell that as
    // "not measured" so the gate fails OPEN out loud instead of reading calm.
    let ram_pct = ram_pct.filter(|p| p.is_finite() && *p > 0.0);
    let (prev, next) = {
        let mut live = budget_live();
        if let Some((pacing, stopped)) = pacing {
            live.behind_pct = pacing.behind_pct;
            live.five_hour_full = pacing
                .five_hour_pct
                .is_some_and(|pct| pct >= pacing.five_hour_line_pct);
            live.governor_stop = stopped;
            live.memory_slots = Some(u32::try_from(pacing.memory_slots).unwrap_or(u32::MAX));
            live.pacing_as_of_ms = now_ms();
        }
        live.note_ram(ram_pct)
    };
    if ram_pct.is_none() {
        if !RAM_PROBE_WARNED.swap(true, Ordering::Relaxed) {
            tracing::warn!("fleet queue: RAM probe unreadable - the promotion gate fails OPEN");
        }
    } else {
        RAM_PROBE_WARNED.store(false, Ordering::Relaxed);
    }
    let closed_now = next == RamGate::Closed && prev != RamGate::Closed;
    let reopened_now = prev == RamGate::Closed && next != RamGate::Closed;
    if closed_now || reopened_now {
        tracing::info!(
            ram_pct = ?ram_pct,
            close_at = budgets::RAM_GATE_CLOSE_PCT,
            reopen_at = budgets::RAM_GATE_REOPEN_PCT,
            "fleet queue: RAM promotion gate {}",
            if closed_now {
                "CLOSED - queued dispatches wait; live sessions are untouched"
            } else {
                "reopened"
            }
        );
    }
}

/// Announce a change of the gate / hold pair on `fleet-queue-changed` so the
/// Monitor's budgets block re-reads the snapshot. The existing `cap_changed`
/// kind is reused on purpose: it already means "capacity moved, re-read", and
/// a new kind would change the event's closed vocabulary on the wire.
fn announce_budget_state(app: &AppHandle, cap: u32, enabled: bool) {
    let now = now_ms();
    let (inputs, used, gpu_holder) = budget_reading(registry(), cap, enabled, now);
    let current = (
        inputs.ram_gate,
        budget_view(registry(), &inputs, used, gpu_holder, now).hold,
    );
    let changed = {
        let mut live = budget_live();
        let changed = live.announced != current;
        live.announced = current;
        changed
    };
    if changed {
        emit_queue_changed(app, "cap_changed", None);
    }
}

/// The next row to promote: lowest rank whose `not_before_ms` has passed.
/// `None` when the queue is empty or every head is still gated.
fn head_to_promote(reg: &FleetRegistry, now: i64) -> Option<String> {
    reg.queued_in_order()
        .into_iter()
        .find(|(_, _, _, not_before)| not_before.map_or(true, |t| t <= now))
        .map(|(id, _, _, _)| id)
}

/// Promote queued rows while `live_count() < cap`, in rank order, skipping
/// rows whose gate is still ahead. A row that fails to spawn is closed with
/// the error as its reason (`Queued → Exited`) so the head never wedges.
pub async fn promote_head(app: &AppHandle) {
    if PROMOTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let cap = cap_via_app(app) as u32;
    let enabled = dynamic_budgets_via_app(app);
    // Bounded by the queue's length: every iteration either promotes, closes
    // or stops, so a loop over the queue can run at most `queued` times.
    let mut budget = registry().queued_in_order().len();
    while budget > 0 && under_cap(live_count(), cap) {
        budget -= 1;
        let now = now_ms();
        // Re-read per iteration: the previous promotion is live now and its
        // charge is part of `used`.
        let (inputs, used, _) = budget_reading(registry(), cap, enabled, now);
        let scan = scan_queue(registry(), now, &inputs, used);
        // An unfit entry gets its first-unfit stamp either way; it is only
        // SKIPPED when something behind it is about to start.
        persist_skips(
            app,
            &mark_unfit(registry(), &scan.unfit, now, scan.pick.is_some()),
        );
        let Some(id) = scan.pick else {
            break;
        };
        if let Err(err) = promote(app, &id) {
            tracing::warn!(session_id = %id, error = %err, "fleet queue: promotion failed; row closed");
            if registry().fail_queued(&id, &format!("Could not start: {err}")) {
                super::pty::emit_session_state(
                    app,
                    &id,
                    Some(state_to_token(FleetSessionState::Queued)),
                    state_to_token(FleetSessionState::Exited),
                    Some(format!("Could not start: {err}")),
                );
                release_tasks_of(app, &id);
                emit_queue_changed(app, "cancelled", Some(&id));
            }
        }
    }
    announce_budget_state(app, cap, enabled);
    PROMOTING.store(false, Ordering::SeqCst);
}

/// Spawn ONE queued row on its own id (whatever the cap says — the callers
/// decide that). The spawn lands through `FleetRegistry::adopt_spawn`, which
/// is the `Queued → Spawning` transition; this then re-ranks the rest and
/// announces the promotion.
fn promote(app: &AppHandle, session_id: &str) -> Result<String, AppError> {
    let Some(req) = dispatch_of(registry(), session_id) else {
        return Err(AppError::NotFound(format!(
            "queued session not found: {session_id}"
        )));
    };
    let (req, identity) = req;
    let id = spawn_now(app, &req, Some(identity))?;
    super::debug_log::lifecycle(&id, "promoted", "started from the dispatch queue");
    let ranks = registry().renumber_queue(&[]);
    persist_ranks(app, &ranks);
    start_tasks_of(app, &id);
    emit_queue_changed(app, "promoted", Some(&id));
    Ok(id)
}

/// A promoted session's `dev_tasks` rows (an ideas dispatch or a Dev-runner
/// task admitted while the fleet was full) go `queued → running` now. This is
/// the non-capacity half of the retired dispatch-ideas drain, hung off the
/// queue's own promotion instead of a poll loop.
fn start_tasks_of(app: &AppHandle, session_id: &str) {
    let Some(pool) = pool_of(app) else { return };
    let now = chrono::Utc::now().to_rfc3339();
    match crate::db::repos::dev_tools::mark_tasks_running_for_session(&pool, session_id, &now) {
        Ok(n) if n > 0 => {
            tracing::debug!(session_id = %session_id, tasks = n, "fleet queue: promoted session's tasks started");
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(session_id = %session_id, error = %err, "fleet queue: task start write failed");
        }
    }
}

/// A queued session left without starting: its still-`queued` `dev_tasks`
/// rows are unbound again, so the idea is re-dispatchable.
fn release_tasks_of(app: &AppHandle, session_id: &str) {
    let Some(pool) = pool_of(app) else { return };
    if let Err(err) =
        crate::db::repos::dev_tools::release_tasks_for_unstarted_session(&pool, session_id)
    {
        tracing::warn!(session_id = %session_id, error = %err, "fleet queue: task release write failed");
    }
}

/// Cancel a queued dispatch (`Queued → Exited`, reason `cancelled`). Errs
/// with `NotFound` for an unknown id and `Validation` for a row that is no
/// longer queued. The command `fleet_queue_cancel` is this plus a snapshot;
/// a dispatcher whose own job was cancelled while its session still waited
/// (the Dev runner) calls this directly.
pub fn cancel_dispatch(app: &AppHandle, session_id: &str) -> Result<(), AppError> {
    match registry().cancel_queued(session_id) {
        None => {
            return Err(AppError::NotFound(format!(
                "queued session not found: {session_id}"
            )))
        }
        Some(false) => {
            return Err(AppError::Validation(format!(
                "session {session_id} is not queued"
            )))
        }
        Some(true) => {}
    }
    super::debug_log::lifecycle(session_id, "cancelled", "removed from the dispatch queue");
    // The state emit persists the row and — Exited not being live — schedules
    // a promotion pass, which is a harmless no-op here (no slot was freed).
    super::pty::emit_session_state(
        app,
        session_id,
        Some(state_to_token(FleetSessionState::Queued)),
        state_to_token(FleetSessionState::Exited),
        Some("cancelled".to_string()),
    );
    let ranks = registry().renumber_queue(&[]);
    persist_ranks(app, &ranks);
    release_tasks_of(app, session_id);
    emit_queue_changed(app, "cancelled", Some(session_id));
    Ok(())
}

/// Read a queued row back as the dispatch it holds, plus the identity the
/// spawn must reuse. `None` for an unknown id or a row that is not queued.
fn dispatch_of(reg: &FleetRegistry, session_id: &str) -> Option<(DispatchRequest, SpawnIdentity)> {
    let map = reg.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let s = map.get(session_id)?;
    if !matches!(s.state, FleetSessionState::Queued) {
        return None;
    }
    let claude_session_id = s.claude_session_id.clone()?;
    Some((
        DispatchRequest {
            cwd: s.cwd.to_string_lossy().into_owned(),
            // The CLI part only: a dispatcher may have renamed the waiting row
            // to a display name (`athena-writer · personas`), and what the
            // spawn passes as `--name` is the part before the separator.
            name: s
                .name
                .as_deref()
                .map(|n| super::naming::cli_part_of_display_name(n).to_string())
                .filter(|n| !n.is_empty()),
            title: s.title.clone(),
            args: s.args.clone(),
            mode: s.mode,
            run_label: s.run_label.clone(),
            origin: DispatchOrigin::parse(s.origin.as_deref()),
            persona_id: s.persona_id.clone(),
            goal_id: s.goal_id.clone(),
            cycle_index: s.cycle_index,
            not_before_ms: s.not_before_ms,
            profile: profile_of(&s.admission),
        },
        SpawnIdentity {
            id: s.id.clone(),
            claude_session_id,
        },
    ))
}

/// The dispatch a session — in ANY state — was admitted with: what a re-enqueue
/// of the same work would send back through [`admit`]. `None` for an unknown
/// id. The cycle harvest reads a `finished` autopilot row through this.
pub fn dispatch_of_session(session_id: &str) -> Option<DispatchRequest> {
    dispatch_of_session_in(registry(), session_id)
}

/// [`dispatch_of_session`] over a given registry.
fn dispatch_of_session_in(reg: &FleetRegistry, session_id: &str) -> Option<DispatchRequest> {
    let map = reg.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let s = map.get(session_id)?;
    Some(DispatchRequest {
        cwd: s.cwd.to_string_lossy().into_owned(),
        name: s
            .name
            .as_deref()
            .map(|n| super::naming::cli_part_of_display_name(n).to_string())
            .filter(|n| !n.is_empty()),
        title: s.title.clone(),
        args: s.args.clone(),
        mode: s.mode,
        run_label: s.run_label.clone(),
        origin: DispatchOrigin::parse(s.origin.as_deref()),
        persona_id: s.persona_id.clone(),
        goal_id: s.goal_id.clone(),
        cycle_index: s.cycle_index,
        not_before_ms: s.not_before_ms,
        // A re-enqueue of the same work is charged what the original was.
        profile: profile_of(&s.admission),
    })
}

/// The profile a row's stored charge stands for; `None` when the row was
/// never charged explicitly (it costs the default either way).
fn profile_of(facts: &AdmissionFacts) -> Option<ResourceProfile> {
    (facts.machine_units.is_some() || facts.plan_units.is_some() || facts.gpu.is_some())
        .then(|| facts.charge().to_profile())
}

/// Whether the persona already has an autopilot dispatch waiting or running
/// (a `queued` or live row with `origin = autopilot` and this persona id).
/// The tick's duplicate guard: one cycle worker per persona at a time.
pub fn has_pending_autopilot_dispatch(persona_id: &str) -> bool {
    let reg = registry();
    let map = reg.sessions.lock().unwrap_or_else(|e| e.into_inner());
    map.values().any(|s| {
        s.persona_id.as_deref() == Some(persona_id)
            && s.origin.as_deref() == Some(DispatchOrigin::Autopilot.token())
            && (matches!(s.state, FleetSessionState::Queued)
                || super::registry::is_live_state(s.state))
    })
}

/// How many LIVE sessions one producer is holding right now.
///
/// Live, not live-plus-queued: a queued row holds no terminal, and the number
/// this answers is "how many of her worker slots are occupied". The registry
/// is the source - a row's `origin` is the token `DispatchOrigin::token` wrote,
/// and a row from before the queue existed carries none, which reads as
/// `Manual` exactly as [`DispatchOrigin::parse`] says.
pub fn live_count_for_origin(origin: DispatchOrigin) -> u32 {
    count_live_for_origin(registry(), origin)
}

/// [`live_count_for_origin`] against a given registry, so a test can hold one.
fn count_live_for_origin(reg: &FleetRegistry, origin: DispatchOrigin) -> u32 {
    let map = reg.sessions.lock().unwrap_or_else(|e| e.into_inner());
    map.values()
        .filter(|s| {
            super::registry::is_live_state(s.state)
                && DispatchOrigin::parse(s.origin.as_deref()) == origin
        })
        .count()
        .min(u32::MAX as usize) as u32
}

/// Write the queue's ranks to the durable rows.
fn persist_ranks(app: &AppHandle, ranks: &[(String, u32)]) {
    let Some(pool) = pool_of(app) else { return };
    if let Err(err) = fleet_sessions::renumber_queue(&pool, ranks) {
        tracing::warn!(error = %err, "fleet queue: rank write failed");
    }
}

/// Boot: queued rows came back from `fleet_sessions` — renumber them densely
/// (a restart may have lost the rows between two ranks) and start what the
/// cap allows. Called by `persist::rehydrate` after the restore.
pub fn reconcile_after_restore(app: &AppHandle) {
    let ranks = registry().renumber_queue(&[]);
    if ranks.is_empty() {
        return;
    }
    persist_ranks(app, &ranks);
    tracing::info!(
        queued = ranks.len(),
        "fleet queue: reconciled after restore"
    );
    emit_queue_changed(app, "reordered", None);
    schedule_promote_head(app);
}

/// The cap setting changed: announce it and fill any slots it opened.
pub fn on_cap_changed(app: &AppHandle) {
    emit_queue_changed(app, "cap_changed", None);
    schedule_promote_head(app);
}

fn emit_queue_changed(app: &AppHandle, kind: &str, session_id: Option<&str>) {
    if let Err(e) = app.emit(
        event_name::FLEET_QUEUE_CHANGED,
        QueueChangedPayload {
            kind: kind.to_string(),
            session_id: session_id.map(str::to_string),
        },
    ) {
        tracing::warn!(kind, error = %e, "fleet queue: queue-changed emit failed");
    }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/// `max(0, live - cap)`.
fn over_admitted(live: u32, cap: u32) -> u32 {
    live.saturating_sub(cap)
}

/// `now + rank × mean(durations)`; `None` without history.
fn estimated_start_ms(now: i64, rank: u32, durations_ms: &[i64]) -> Option<i64> {
    if durations_ms.is_empty() {
        return None;
    }
    let mean = durations_ms.iter().sum::<i64>() / durations_ms.len() as i64;
    Some(now + i64::from(rank) * mean)
}

/// The budgets as the Monitor reads them, plus each queued entry's own hold.
struct BudgetView {
    budgets: FleetBudgets,
    /// `session id -> why THIS entry is not starting`, budget reasons only.
    held_by: std::collections::HashMap<String, BudgetHold>,
    /// Mirror of `budgets.hold`, for the announcer.
    hold: Option<BudgetHold>,
}

/// Evaluate every queued entry against the budgets. Pure over its inputs
/// (the GPU holder id is passed in).
///
/// `hold` is why the HEAD entry (first time-eligible row in rank order) is
/// held, when a budget is the reason; with no such entry it is the hold that
/// applies to ANY dispatch (five-hour window full, RAM gate closed), so the
/// Monitor can say why nothing would start before anyone queues. With the
/// kill switch off nothing is ever held: `used` stays real (informational),
/// the budgets read as the neutral count-cap pair.
fn budget_view(
    reg: &FleetRegistry,
    inputs: &BudgetInputs,
    used: Used,
    gpu_holder: Option<String>,
    now: i64,
) -> BudgetView {
    let derived: Budgets = budgets::budgets_from(inputs, used);
    let mut held_by = std::collections::HashMap::new();
    let mut hold = None;
    if inputs.enabled {
        let mut head_seen = false;
        for (id, not_before, facts) in reg.queued_admissions_in_order() {
            let entry_hold = budgets::fits(facts.charge(), used, &derived)
                .err()
                .and_then(budgets::Unfit::hold);
            if let Some(h) = entry_hold {
                held_by.insert(id, h);
            }
            if !head_seen && not_before.map_or(true, |t| t <= now) {
                head_seen = true;
                hold = entry_hold;
            }
        }
        if !head_seen {
            hold = budgets::global_hold(&derived);
        }
    }
    let budgets = if inputs.enabled {
        FleetBudgets {
            enabled: true,
            machine_used: used.machine,
            machine_budget: derived.machine_budget,
            plan_used: used.plan,
            plan_budget: derived.plan_budget,
            plan_budget_max: derived.plan_budget_max,
            pace_factor: derived.pace_factor,
            behind_pct: inputs.behind_pct,
            ram_pct: inputs.ram_pct,
            ram_gate: inputs.ram_gate,
            gpu_holder,
            hold,
        }
    } else {
        FleetBudgets {
            enabled: false,
            machine_used: used.machine,
            plan_used: used.plan,
            behind_pct: inputs.behind_pct,
            ram_pct: inputs.ram_pct,
            ram_gate: inputs.ram_gate,
            gpu_holder,
            ..FleetBudgets::neutral(inputs.cap)
        }
    };
    BudgetView {
        budgets,
        held_by,
        hold,
    }
}

/// [`build_snapshot_with`] under budgets that bind nothing beyond the cap.
#[cfg(test)]
fn build_snapshot(
    reg: &FleetRegistry,
    cap: u32,
    durations_ms: &[i64],
    now: i64,
) -> FleetQueueSnapshot {
    let inputs = BudgetInputs::unmeasured(cap, true);
    let mut live = BudgetLive::new();
    let used = live.used(reg);
    build_snapshot_with(reg, durations_ms, now, &inputs, used, live.gpu_holder)
}

/// Assemble the snapshot from the registry, the budgets' inputs and the
/// duration history.
fn build_snapshot_with(
    reg: &FleetRegistry,
    durations_ms: &[i64],
    now: i64,
    inputs: &BudgetInputs,
    used: Used,
    gpu_holder: Option<String>,
) -> FleetQueueSnapshot {
    let cap = inputs.cap;
    let view = budget_view(reg, inputs, used, gpu_holder, now);
    let running = reg.live_count();
    let mut entries: Vec<FleetQueueEntry> = {
        let map = reg.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter(|s| matches!(s.state, FleetSessionState::Queued))
            .map(|s| {
                let rank = s.queue_rank.unwrap_or(u32::MAX);
                FleetQueueEntry {
                    session_id: s.id.clone(),
                    rank,
                    origin: DispatchOrigin::parse(s.origin.as_deref()),
                    persona_id: s.persona_id.clone(),
                    goal_id: s.goal_id.clone(),
                    queued_at_ms: s.queued_at_ms.unwrap_or(s.created_at_ms),
                    not_before_ms: s.not_before_ms,
                    estimated_start_ms: estimated_start_ms(now, rank, durations_ms),
                    machine_units: s.admission.charge().machine,
                    plan_units: s.admission.charge().plan,
                    gpu: s.admission.charge().gpu,
                    skips: s.admission.skip_count,
                    held_by: view.held_by.get(&s.id).copied(),
                }
            })
            .collect()
    };
    entries.sort_by_key(|e| (e.rank, e.queued_at_ms));
    FleetQueueSnapshot {
        cap,
        running,
        queued: entries.len() as u32,
        over_admitted: over_admitted(running, cap),
        entries,
        budgets: view.budgets,
    }
}

async fn snapshot(app: &AppHandle, pool: DbPool) -> Result<FleetQueueSnapshot, AppError> {
    let _ = app;
    let (cap, enabled, durations) = tokio::task::spawn_blocking(move || {
        let cap = cap(&pool);
        let enabled = dynamic_budgets(&pool);
        let durations =
            fleet_sessions::recent_ended_durations_ms(&pool, ESTIMATE_HISTORY).unwrap_or_default();
        (cap, enabled, durations)
    })
    .await
    .map_err(|e| AppError::Internal(format!("fleet queue snapshot: {e}")))?;
    let now = now_ms();
    let (inputs, used, gpu_holder) = budget_reading(registry(), cap, enabled, now);
    Ok(build_snapshot_with(
        registry(),
        &durations,
        now,
        &inputs,
        used,
        gpu_holder,
    ))
}

/// The budgets as they stand right now, for a reader that wants the figures
/// and not the queue (the attention decide prompt). Blocking: two settings
/// reads. It measures nothing - the same cached [`BudgetLive`] reading an
/// admission takes - and assembles the wire shape through [`budget_view`], so
/// the persona is told exactly what the Monitor's budgets block shows.
pub fn current_budgets(pool: &DbPool) -> FleetBudgets {
    let now = now_ms();
    let (inputs, used, gpu_holder) =
        budget_reading(registry(), cap(pool), dynamic_budgets(pool), now);
    budget_view(registry(), &inputs, used, gpu_holder, now).budgets
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// The queue as the Monitor reads it: cap, live count, ordered entries with a
/// start estimate, and how far "start now" has pushed past the cap.
#[tauri::command]
pub async fn fleet_queue_snapshot(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<FleetQueueSnapshot, AppError> {
    require_auth(&state).await?;
    snapshot(&app, state.db.clone()).await
}

/// Re-rank the queue densely in the given order. Unknown or non-queued ids
/// are ignored; queued rows not named keep their relative order after the
/// named ones. Returns the resulting snapshot.
#[tauri::command]
pub async fn fleet_queue_reorder(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_ids: Vec<String>,
) -> Result<FleetQueueSnapshot, AppError> {
    require_auth(&state).await?;
    let ranks = registry().renumber_queue(&session_ids);
    let pool = state.db.clone();
    let ranks_for_db = ranks.clone();
    let expected = ranks.len();
    let written = match tokio::task::spawn_blocking(move || {
        fleet_sessions::renumber_queue(&pool, &ranks_for_db)
    })
    .await
    {
        Ok(r) => r?,
        Err(e) if e.is_panic() => {
            return Err(AppError::Internal(
                "fleet queue reorder: the durable re-rank PANICKED; the in-memory order is applied, the row order is not".into(),
            ));
        }
        Err(e) => return Err(AppError::Internal(format!("fleet queue reorder: {e}"))),
    };
    if written != expected {
        tracing::warn!(
            written,
            expected,
            "fleet queue reorder: some ranked ids were no longer queued rows"
        );
    }
    emit_queue_changed(&app, "reordered", None);
    snapshot(&app, state.db.clone()).await
}

/// Cancel a queued dispatch (`Queued → Exited`, reason `cancelled`). Errs
/// with `NotFound` for an unknown id and `Validation` for a row that is no
/// longer queued. Returns the resulting snapshot.
#[tauri::command]
pub async fn fleet_queue_cancel(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<FleetQueueSnapshot, AppError> {
    require_auth(&state).await?;
    cancel_dispatch(&app, &session_id)?;
    snapshot(&app, state.db.clone()).await
}

/// Start a queued dispatch NOW, cap or no cap, budgets or no budgets - the
/// operator's one explicit bypass. The snapshot's `over_admitted` reports the
/// count overshoot afterwards, and the started session's charge is part of
/// `used` like any other, so the budgets tighten behind it.
#[tauri::command]
pub async fn fleet_queue_start_now(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<Admission, AppError> {
    require_auth(&state).await?;
    let cap = cap_via_app(&app) as u32;
    let id = promote(&app, &session_id)?;
    super::debug_log::lifecycle(
        &id,
        "started now",
        "operator started a queued dispatch over the cap",
    );
    Ok(Admission {
        session_id: id,
        state: FleetSessionState::Spawning,
        rank: None,
        cap,
        running: live_count(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::registry::{apply_transition, is_live_state, TransitionOutcome};
    use crate::commands::fleet::types::FleetSessionState as S;

    fn req(cwd: &str) -> DispatchRequest {
        DispatchRequest {
            cwd: cwd.into(),
            name: None,
            title: None,
            args: vec!["do the thing".into()],
            mode: FleetSessionMode::Interactive,
            run_label: None,
            origin: DispatchOrigin::Autopilot,
            persona_id: Some("p-1".into()),
            goal_id: None,
            cycle_index: None,
            not_before_ms: None,
            profile: None,
        }
    }

    /// A process-backed live row, the shape a real spawn leaves behind.
    fn live(id: &str, state: FleetSessionState) -> FleetSessionInner {
        let mut s = queued_inner(&req("C:/repo/x"), id.into(), format!("cc-{id}"), 0, 1, 1, 0);
        s.state = state;
        s.queue_rank = None;
        s.queued_at_ms = None;
        s.child_pid = Some(4242);
        s
    }

    /// What a real spawn hands `adopt_spawn` for a promoted id.
    fn spawned(id: &str) -> FleetSessionInner {
        let mut s = live(id, S::Spawning);
        s.state_reason = Some("PTY spawned".into());
        s
    }

    /// **Curator's dispatch is stored as HERS, end to end.** The enum, the row
    /// token and the parse have to agree, because the fallback is `Manual`: a
    /// variant that reaches only some of the three mirrors does not surface as
    /// an unknown origin, it surfaces as the OPERATOR'S dispatch on the one
    /// board that exists to tell producers apart. The two frontend mirrors are
    /// covered by `board/queue/__tests__/originCurator.test.tsx`.
    #[test]
    fn a_curator_dispatch_is_stored_and_read_back_as_hers() {
        let reg = FleetRegistry::default();
        let request = DispatchRequest {
            origin: DispatchOrigin::Curator,
            ..req("C:/checkouts/ai-registry")
        };
        let (id, rank) = enqueue_into(&reg, &request, 1_000, 0, 2);
        assert_eq!(rank, 1);

        let dto = reg.list_dto().into_iter().find(|s| s.id == id).unwrap();
        assert_eq!(dto.origin.as_deref(), Some("curator"));
        assert_eq!(
            DispatchOrigin::parse(dto.origin.as_deref()),
            DispatchOrigin::Curator
        );
        assert_ne!(
            DispatchOrigin::parse(dto.origin.as_deref()),
            DispatchOrigin::Manual,
            "the whole trap: a missing mirror reads as the operator's own dispatch"
        );

        // A queued row holds no terminal, so none of her worker slots is
        // occupied yet; a live one occupies exactly one.
        assert_eq!(count_live_for_origin(&reg, DispatchOrigin::Curator), 0);
        let mut running = live("cur-1", S::Running);
        running.origin = Some(DispatchOrigin::Curator.token().to_string());
        reg.insert(running);
        assert_eq!(count_live_for_origin(&reg, DispatchOrigin::Curator), 1);
        assert_eq!(
            count_live_for_origin(&reg, DispatchOrigin::Manual),
            0,
            "her terminal is not counted against anybody else"
        );
    }

    #[test]
    fn admit_at_cap_queues_with_a_dense_rank() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        reg.insert(live("b", S::Idle));
        assert_eq!(reg.live_count(), 2);
        assert!(
            !under_cap(reg.live_count(), 2),
            "at the cap is not under it"
        );
        let (first, r1) = enqueue_into(&reg, &req("C:/repo/one"), 1_000, 2, 2);
        let (second, r2) = enqueue_into(&reg, &req("C:/repo/two"), 1_001, 2, 2);
        assert_eq!((r1, r2), (1, 2));
        assert_eq!(reg.session_state(&first), Some(S::Queued));
        assert_eq!(reg.session_state(&second), Some(S::Queued));
        // A queued row is NOT live and holds no process.
        assert_eq!(reg.live_count(), 2);
        let dto = reg.list_dto().into_iter().find(|s| s.id == first).unwrap();
        assert_eq!(dto.queue_rank, Some(1));
        assert_eq!(dto.queued_at_ms, Some(1_000));
        assert_eq!(dto.origin.as_deref(), Some("autopilot"));
        assert_eq!(dto.persona_id.as_deref(), Some("p-1"));
        assert!(dto.child_pid.is_none());
        assert!(
            dto.claude_session_id.is_some(),
            "minted at admission so the row persists"
        );
    }

    #[test]
    fn freeing_a_slot_promotes_the_head_on_its_own_id() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        let (head, _) = enqueue_into(&reg, &req("C:/repo/one"), 1_000, 1, 1);
        let (tail, _) = enqueue_into(&reg, &req("C:/repo/two"), 1_001, 1, 1);
        // Nothing free yet.
        assert!(!under_cap(reg.live_count(), 1));
        // The running session ends → a slot frees.
        {
            let mut map = reg.sessions.lock().unwrap();
            let a = map.get_mut("a").unwrap();
            assert_eq!(
                apply_transition(a, S::Exited, "done", "test"),
                TransitionOutcome::Changed
            );
        }
        assert!(under_cap(reg.live_count(), 1));
        assert_eq!(head_to_promote(&reg, 2_000).as_deref(), Some(head.as_str()));
        // The promotion spawns ON the queued id.
        let (dispatch, identity) = dispatch_of(&reg, &head).unwrap();
        assert_eq!(identity.id, head);
        assert_eq!(dispatch.cwd, "C:/repo/one");
        assert!(
            reg.adopt_spawn(spawned(&head)),
            "a queued row is promoted in place"
        );
        assert_eq!(reg.session_state(&head), Some(S::Spawning));
        assert_eq!(reg.live_count(), 1);
        let ranks = reg.renumber_queue(&[]);
        assert_eq!(ranks, vec![(tail.clone(), 1)]);
        let dto = reg.list_dto().into_iter().find(|s| s.id == head).unwrap();
        assert_eq!(dto.queue_rank, None, "a promoted row drops its rank");
        assert_eq!(
            dto.queued_at_ms,
            Some(1_000),
            "but keeps when it was admitted"
        );
        assert_eq!(dto.child_pid, Some(4242));
        // Now the fleet is at the cap again: the tail waits.
        assert!(!under_cap(reg.live_count(), 1));
    }

    #[test]
    fn a_future_not_before_gate_is_skipped_not_waited_on() {
        let reg = FleetRegistry::default();
        let mut gated = req("C:/repo/later");
        gated.not_before_ms = Some(5_000);
        let (first, _) = enqueue_into(&reg, &gated, 1_000, 1, 1);
        let (second, _) = enqueue_into(&reg, &req("C:/repo/now"), 1_001, 1, 1);
        assert_eq!(
            head_to_promote(&reg, 2_000).as_deref(),
            Some(second.as_str())
        );
        assert_eq!(
            head_to_promote(&reg, 5_000).as_deref(),
            Some(first.as_str())
        );
        // Only gated rows → nothing to promote yet.
        assert!(reg.cancel_queued(&second).unwrap());
        assert_eq!(head_to_promote(&reg, 2_000), None);
    }

    #[test]
    fn cancel_leaves_queued_through_the_door_with_reason_cancelled() {
        let reg = FleetRegistry::default();
        let (id, _) = enqueue_into(&reg, &req("C:/repo/one"), 1_000, 1, 1);
        assert_eq!(reg.cancel_queued("nope"), None);
        assert_eq!(reg.cancel_queued(&id), Some(true));
        assert_eq!(reg.session_state(&id), Some(S::Exited));
        let dto = reg.list_dto().into_iter().find(|s| s.id == id).unwrap();
        assert_eq!(dto.state_reason.as_deref(), Some("cancelled"));
        assert_eq!(dto.queue_rank, None);
        // Not queued any more → the door says so instead of writing.
        assert_eq!(reg.cancel_queued(&id), Some(false));
        // A live row is never "cancelled" by the queue.
        reg.insert(live("a", S::Running));
        assert_eq!(reg.cancel_queued("a"), Some(false));
        assert_eq!(reg.session_state("a"), Some(S::Running));
    }

    #[test]
    fn start_now_over_admits_and_the_snapshot_reports_it() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        let (id, _) = enqueue_into(&reg, &req("C:/repo/one"), 1_000, 1, 1);
        let before = build_snapshot(&reg, 1, &[], 2_000);
        assert_eq!(
            (before.running, before.queued, before.over_admitted),
            (1, 1, 0)
        );
        assert_eq!(
            before.entries[0].estimated_start_ms, None,
            "no history, no estimate"
        );
        // Start now: promoted although the fleet is at the cap.
        assert!(reg.adopt_spawn(spawned(&id)));
        let after = build_snapshot(&reg, 1, &[], 2_000);
        assert_eq!(
            (after.running, after.queued, after.over_admitted),
            (2, 0, 1)
        );
    }

    #[test]
    fn reorder_renumbers_densely_and_persists() {
        let reg = FleetRegistry::default();
        let (a, _) = enqueue_into(&reg, &req("C:/repo/a"), 1_000, 1, 1);
        let (b, _) = enqueue_into(&reg, &req("C:/repo/b"), 1_001, 1, 1);
        let (c, _) = enqueue_into(&reg, &req("C:/repo/c"), 1_002, 1, 1);
        // Unknown ids are ignored; unnamed rows follow in their old order.
        let ranks = reg.renumber_queue(&["ghost".into(), c.clone(), c.clone()]);
        assert_eq!(ranks, vec![(c.clone(), 1), (a.clone(), 2), (b.clone(), 3)]);
        // The durable half: the same ranks land in fleet_sessions.
        let pool = crate::db::init_test_db().unwrap();
        for id in [&a, &b, &c] {
            let inner = reg.sessions.lock().unwrap();
            let row = super::super::persist::row_from_inner(inner.get(id).unwrap()).unwrap();
            fleet_sessions::upsert(&pool, &row).unwrap();
        }
        fleet_sessions::renumber_queue(&pool, &ranks).unwrap();
        let rows = fleet_sessions::list_queued_ordered(&pool).unwrap();
        let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
        assert_eq!(ids, vec![c.clone(), a.clone(), b.clone()]);
        let stored: Vec<Option<u32>> = rows.iter().map(|r| r.queue_rank).collect();
        assert_eq!(stored, vec![Some(1), Some(2), Some(3)]);
        assert_eq!(fleet_sessions::max_queue_rank(&pool).unwrap(), 3);
        assert_eq!(fleet_sessions::count_live(&pool).unwrap(), 0);
        // A snapshot reads the same order.
        let snap = build_snapshot(&reg, 1, &[60_000], 10_000);
        let order: Vec<&str> = snap.entries.iter().map(|e| e.session_id.as_str()).collect();
        assert_eq!(order, vec![c.as_str(), a.as_str(), b.as_str()]);
        assert_eq!(snap.entries[0].estimated_start_ms, Some(70_000));
        assert_eq!(snap.entries[2].estimated_start_ms, Some(190_000));
    }

    #[test]
    fn reconcile_on_load_renumbers_gaps_and_finds_the_head() {
        let reg = FleetRegistry::default();
        // Restored rows with the gaps a restart can leave (5 and 9).
        let mut first = queued_inner(
            &req("C:/repo/one"),
            "q1".into(),
            "cc-1".into(),
            5,
            1_000,
            1,
            1,
        );
        first.queue_rank = Some(5);
        let mut second = queued_inner(
            &req("C:/repo/two"),
            "q2".into(),
            "cc-2".into(),
            9,
            1_001,
            1,
            1,
        );
        second.queue_rank = Some(9);
        reg.insert(second);
        reg.insert(first);
        let ranks = reg.renumber_queue(&[]);
        assert_eq!(ranks, vec![("q1".to_string(), 1), ("q2".to_string(), 2)]);
        assert_eq!(head_to_promote(&reg, 2_000).as_deref(), Some("q1"));
        // Under the cap the head is promotable; the promotion is the same
        // adopt_spawn door the live path uses.
        assert!(under_cap(reg.live_count(), 1));
        assert!(reg.adopt_spawn(spawned("q1")));
        assert_eq!(reg.session_state("q1"), Some(S::Spawning));
    }

    #[test]
    fn queued_leaves_only_by_promotion_or_cancel() {
        let reg = FleetRegistry::default();
        let (id, _) = enqueue_into(&reg, &req("C:/repo/one"), 1_000, 1, 1);
        let mut map = reg.sessions.lock().unwrap();
        let s = map.get_mut(&id).unwrap();
        for to in [
            S::Running,
            S::Idle,
            S::AwaitingInput,
            S::Stale,
            S::Finished,
            S::Hibernated,
        ] {
            assert_eq!(
                apply_transition(s, to, "unit", "test"),
                TransitionOutcome::Refused,
                "Queued -> {to:?} must be refused"
            );
            assert_eq!(s.state, S::Queued);
        }
        // Nothing enters Queued from a live state either.
        let mut running = live("r", S::Running);
        assert_eq!(
            apply_transition(&mut running, S::Queued, "unit", "test"),
            TransitionOutcome::Refused
        );
        assert_eq!(
            apply_transition(s, S::Spawning, "promote", "test"),
            TransitionOutcome::Changed
        );
    }

    fn admission(rank: Option<u32>, cap: u32) -> Admission {
        Admission {
            session_id: uuid::Uuid::new_v4().to_string(),
            state: if rank.is_some() {
                S::Queued
            } else {
                S::Spawning
            },
            rank,
            cap,
            running: cap,
        }
    }

    #[test]
    fn the_admission_summary_counts_started_and_queued_with_positions() {
        // All started.
        let all = vec![admission(None, 10), admission(None, 10)];
        assert_eq!(summarize_admissions(&all), "admitted 2, queued 0, cap 10");
        // A mixed batch: the queued tail reports its position span.
        let mixed = vec![
            admission(None, 10),
            admission(Some(3), 10),
            admission(Some(4), 10),
            admission(None, 10),
        ];
        assert_eq!(
            summarize_admissions(&mixed),
            "admitted 4, queued 2 (positions 3..4), cap 10"
        );
        // One queued row: a single position, not a degenerate range.
        let one = vec![admission(Some(7), 4)];
        assert_eq!(
            summarize_admissions(&one),
            "admitted 1, queued 1 (position 7), cap 4"
        );
        // Nothing admitted at all.
        assert_eq!(summarize_admissions(&[]), "admitted 0, queued 0, cap 0");
    }

    #[test]
    fn a_renamed_queued_row_is_promoted_with_its_cli_name_only() {
        let reg = FleetRegistry::default();
        let mut r = req("C:/repo/one");
        r.name = Some("athena-writer".into());
        let (id, _) = enqueue_into(&reg, &r, 1_000, 1, 1);
        // The dispatcher decorates the waiting row for the grid.
        assert!(reg.rename(&id, Some("athena-writer · personas".into())));
        let (dispatch, _) = dispatch_of(&reg, &id).unwrap();
        assert_eq!(
            dispatch.name.as_deref(),
            Some("athena-writer"),
            "the `--name` the spawn passes is the CLI part"
        );
        // A cleared name passes nothing to the CLI.
        assert!(reg.rename(&id, None));
        let (dispatch, _) = dispatch_of(&reg, &id).unwrap();
        assert_eq!(dispatch.name, None);
    }

    #[test]
    fn headless_args_round_trip_the_task_and_name_the_engine() {
        let args = headless_args("ship it", vec!["--model".into(), "opus".into()]);
        let (task, extra) = split_headless_args(&args).unwrap();
        assert_eq!(task, "ship it");
        assert_eq!(extra, vec!["--model".to_string(), "opus".to_string()]);
        assert_eq!(codex_model(&extra), None);
        let codex = codex_args("refactor", "gpt-5-codex");
        let (_, extra) = split_headless_args(&codex).unwrap();
        assert_eq!(codex_model(&extra).as_deref(), Some("gpt-5-codex"));
        assert!(split_headless_args(&["--model".to_string()]).is_err());
        assert!(split_headless_args(&[TASK_ARG.to_string(), "  ".to_string()]).is_err());
    }

    #[test]
    fn origin_tokens_match_serde_and_parse_back() {
        // Every variant, not a hand-kept subset: `Remote` was missing from
        // this list for its whole life, and an origin whose token nobody
        // round-trips is an origin the board renders as `manual`.
        for o in DispatchOrigin::ALL {
            let wire = serde_json::to_value(o).unwrap();
            assert_eq!(wire, serde_json::Value::String(o.token().to_string()));
            assert_eq!(DispatchOrigin::parse(Some(o.token())), o);
        }
        assert_eq!(DispatchOrigin::ALL.len(), 10);
        // The trap this enum sets: an unrecognised token is NOT an unknown
        // state, it is the operator's own dispatch. A variant that reaches
        // only one of the three mirrors is invisible except as a wrong answer.
        assert_eq!(
            DispatchOrigin::parse(Some("curator")),
            DispatchOrigin::Curator
        );
        assert_eq!(
            DispatchOrigin::parse(Some("kurator")),
            DispatchOrigin::Manual
        );
        assert_eq!(DispatchOrigin::parse(None), DispatchOrigin::Manual);
        assert_eq!(over_admitted(3, 5), 0);
        assert_eq!(over_admitted(7, 5), 2);
        assert_eq!(estimated_start_ms(100, 2, &[10, 20]), Some(130));
        assert!(!is_live_state(S::Queued));
    }

    // -----------------------------------------------------------------------
    // Budgeted admission
    // -----------------------------------------------------------------------

    use crate::commands::fleet::budgets::{AGING_MAX_SKIPS, AGING_MAX_WAIT_MS};
    use personas_core::models::{EffortBand, MachineLoad};

    fn profiled(
        cwd: &str,
        machine: MachineLoad,
        effort: EffortBand,
        gpu: GpuClass,
    ) -> DispatchRequest {
        let mut r = req(cwd);
        r.profile = Some(ResourceProfile {
            machine,
            effort,
            gpu,
            ..ResourceProfile::default()
        });
        r
    }

    fn xl_light(cwd: &str) -> DispatchRequest {
        profiled(cwd, MachineLoad::Light, EffortBand::Xl, GpuClass::None)
    }

    fn s_heavy(cwd: &str) -> DispatchRequest {
        profiled(cwd, MachineLoad::Heavy, EffortBand::S, GpuClass::None)
    }

    /// A live row carrying `r`'s charge, as a real spawn would stamp it.
    fn live_charged(id: &str, r: &DispatchRequest) -> FleetSessionInner {
        let mut s = live(id, S::Running);
        s.admission = AdmissionFacts::charged(Charge::from_profile(r.profile.as_ref()));
        s
    }

    fn end(reg: &FleetRegistry, id: &str) {
        let mut map = reg.sessions.lock().unwrap();
        let s = map.get_mut(id).unwrap();
        assert_eq!(
            apply_transition(s, S::Exited, "done", "test"),
            TransitionOutcome::Changed
        );
    }

    /// Ahead of pace by 20 points on a cap of 10: pace factor 0.2, plan budget 4.
    fn ahead_inputs() -> BudgetInputs {
        BudgetInputs {
            behind_pct: Some(-20.0),
            ..BudgetInputs::unmeasured(10, true)
        }
    }

    /// Drive `n` all-default arrivals through the door, then end the live
    /// sessions one by one and promote after each. Returns which arrivals
    /// started at once, and the order (by cwd) the rest were promoted in.
    fn simulate(enabled: bool, cap: u32, n: usize) -> (Vec<bool>, Vec<String>) {
        let reg = FleetRegistry::default();
        let inputs = BudgetInputs::unmeasured(cap, enabled);
        let mut measured = BudgetLive::new();
        let mut started = Vec::new();
        for i in 0..n {
            let r = req(&format!("C:/repo/{i:02}"));
            let used = measured.used(&reg);
            match door_verdict(&reg, &r, 1_000, &inputs, used) {
                Door::Start { passed } => {
                    assert!(passed.is_empty());
                    reg.insert(live_charged(&format!("live-{i:02}"), &r));
                    started.push(true);
                }
                Door::Queue(_) => {
                    enqueue_into(&reg, &r, 1_000 + i as i64, cap, reg.live_count());
                    started.push(false);
                }
                Door::Refuse => panic!("a default dispatch is never refused"),
            }
        }
        let mut promoted = Vec::new();
        loop {
            let victim = reg.live_charges().into_iter().map(|(id, _, _)| id).min();
            let Some(victim) = victim else { break };
            end(&reg, &victim);
            while under_cap(reg.live_count(), cap) {
                let used = measured.used(&reg);
                let scan = scan_queue(&reg, 9_000, &inputs, used);
                assert!(
                    scan.unfit.is_empty(),
                    "a default entry always fits a free slot"
                );
                let Some(id) = scan.pick else { break };
                promoted.push(dispatch_of(&reg, &id).unwrap().0.cwd);
                assert!(reg.adopt_spawn(spawned(&id)));
            }
        }
        (started, promoted)
    }

    /// THE EQUIVALENCE PROOF. An all-default fleet at pace factor 1 must admit,
    /// queue and promote exactly as the count cap alone does - for every cap.
    #[test]
    fn an_all_default_fleet_behaves_exactly_like_the_count_cap() {
        for cap in 1..=10u32 {
            let n = cap as usize + 6;
            let legacy = simulate(false, cap, n);
            let budgeted = simulate(true, cap, n);
            assert_eq!(legacy, budgeted, "cap {cap}");
            let expected_started: Vec<bool> = (0..n).map(|i| i < cap as usize).collect();
            assert_eq!(budgeted.0, expected_started, "cap {cap}: first `cap` start");
            let expected_order: Vec<String> = (cap as usize..n)
                .map(|i| format!("C:/repo/{i:02}"))
                .collect();
            assert_eq!(budgeted.1, expected_order, "cap {cap}: FIFO promotion");
        }
    }

    #[test]
    fn ahead_of_pace_defers_an_xl_light_and_admits_an_s_heavy() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        let inputs = ahead_inputs();
        let mut measured = BudgetLive::new();
        let used = measured.used(&reg);
        assert_eq!((used.machine, used.plan), (1, 2));
        // At the door.
        assert_eq!(
            door_verdict(&reg, &xl_light("C:/repo/xl"), 1_000, &inputs, used),
            Door::Queue(QueueWhy::Held(BudgetHold::AheadOfPace))
        );
        assert_eq!(
            door_verdict(&reg, &s_heavy("C:/repo/heavy"), 1_000, &inputs, used),
            Door::Start { passed: vec![] }
        );
        // In the queue: promotion backfills the s/heavy past the held xl.
        let (xl, _) = enqueue_into(&reg, &xl_light("C:/repo/xl"), 1_000, 10, 1);
        let (heavy, _) = enqueue_into(&reg, &s_heavy("C:/repo/heavy"), 1_001, 10, 1);
        let scan = scan_queue(&reg, 2_000, &inputs, used);
        assert_eq!(scan.pick.as_deref(), Some(heavy.as_str()));
        assert_eq!(scan.unfit, vec![xl.clone()]);
        assert!(!scan.blocked_by_aged);
        // The Monitor reads the same story.
        let snap = build_snapshot_with(&reg, &[], 2_000, &inputs, used, None);
        assert!(snap.budgets.enabled);
        assert_eq!((snap.budgets.plan_used, snap.budgets.plan_budget), (2, 4));
        assert_eq!(snap.budgets.plan_budget_max, 20);
        assert_eq!(
            (snap.budgets.machine_used, snap.budgets.machine_budget),
            (1, 10)
        );
        assert!((snap.budgets.pace_factor - 0.2).abs() < 1e-9);
        assert_eq!(snap.budgets.behind_pct, Some(-20.0));
        assert_eq!(
            snap.budgets.hold,
            Some(BudgetHold::AheadOfPace),
            "the HEAD's hold"
        );
        let e = &snap.entries[0];
        assert_eq!(
            (e.machine_units, e.plan_units, e.gpu),
            (1, 8, GpuClass::None)
        );
        assert_eq!(e.held_by, Some(BudgetHold::AheadOfPace));
        let e = &snap.entries[1];
        assert_eq!((e.machine_units, e.plan_units, e.held_by), (4, 1, None));
        // Pace recovers: the xl is the head again and fits.
        let calm = BudgetInputs::unmeasured(10, true);
        assert_eq!(
            scan_queue(&reg, 3_000, &calm, used).pick.as_deref(),
            Some(xl.as_str())
        );
    }

    #[test]
    fn five_skips_age_the_head_and_promotion_drains_until_it_fits() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        let inputs = ahead_inputs();
        let mut measured = BudgetLive::new();
        let (xl, _) = enqueue_into(&reg, &xl_light("C:/repo/xl"), 1_000, 10, 1);
        for i in 0..AGING_MAX_SKIPS {
            let (small, _) = enqueue_into(&reg, &s_heavy("C:/repo/s"), 1_001, 10, 1);
            let used = measured.used(&reg);
            let scan = scan_queue(&reg, 2_000, &inputs, used);
            assert_eq!(scan.pick.as_deref(), Some(small.as_str()), "backfill {i}");
            let marks = mark_unfit(&reg, &scan.unfit, 2_000, scan.pick.is_some());
            assert_eq!(marks, vec![(xl.clone(), i + 1, Some(2_000))]);
            assert!(reg.adopt_spawn(spawned(&small)));
            end(&reg, &small);
        }
        // Aged: nothing behind it may start, from the queue or at the door.
        let (behind, _) = enqueue_into(&reg, &s_heavy("C:/repo/s"), 1_002, 10, 1);
        let used = measured.used(&reg);
        let scan = scan_queue(&reg, 3_000, &inputs, used);
        assert_eq!(scan.pick, None);
        assert!(scan.blocked_by_aged);
        assert_eq!(scan.unfit, vec![xl.clone()]);
        // A blocked pass promotes nothing, so it counts no skip.
        assert!(mark_unfit(&reg, &scan.unfit, 3_000, false).is_empty());
        assert_eq!(
            door_verdict(&reg, &s_heavy("C:/repo/new"), 3_000, &inputs, used),
            Door::Queue(QueueWhy::BehindAged)
        );
        let snap = build_snapshot_with(&reg, &[], 3_000, &inputs, used, None);
        assert_eq!(snap.entries[0].skips, AGING_MAX_SKIPS);
        // The pace recovers: the aged head goes first, then the line drains.
        let calm = BudgetInputs::unmeasured(10, true);
        assert_eq!(
            scan_queue(&reg, 4_000, &calm, used).pick.as_deref(),
            Some(xl.as_str())
        );
        assert!(reg.adopt_spawn(spawned(&xl)));
        let used = measured.used(&reg);
        assert_eq!(
            scan_queue(&reg, 4_001, &calm, used).pick.as_deref(),
            Some(behind.as_str())
        );
    }

    #[test]
    fn thirty_unfit_minutes_age_the_head_too() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        let inputs = ahead_inputs();
        let used = BudgetLive::new().used(&reg);
        let (xl, _) = enqueue_into(&reg, &xl_light("C:/repo/xl"), 1_000, 10, 1);
        let (small, _) = enqueue_into(&reg, &s_heavy("C:/repo/s"), 1_001, 10, 1);
        let t0 = 10_000;
        // Found unfit with nothing promoted past it: stamped, not skipped.
        assert_eq!(
            mark_unfit(&reg, &[xl.clone()], t0, false),
            vec![(xl.clone(), 0, Some(t0))]
        );
        let just_before = scan_queue(&reg, t0 + AGING_MAX_WAIT_MS - 1, &inputs, used);
        assert_eq!(just_before.pick.as_deref(), Some(small.as_str()));
        let at = scan_queue(&reg, t0 + AGING_MAX_WAIT_MS, &inputs, used);
        assert_eq!(at.pick, None);
        assert!(at.blocked_by_aged);
        // A time-gated entry is neither unfit nor a blocker.
        let mut later = xl_light("C:/repo/later");
        later.not_before_ms = Some(i64::MAX);
        let reg2 = FleetRegistry::default();
        reg2.insert(live("a", S::Running));
        enqueue_into(&reg2, &later, 1_000, 10, 1);
        let (ok, _) = enqueue_into(&reg2, &s_heavy("C:/repo/s"), 1_001, 10, 1);
        let scan = scan_queue(&reg2, 2_000, &inputs, used);
        assert_eq!(scan.pick.as_deref(), Some(ok.as_str()));
        assert!(scan.unfit.is_empty());
    }

    #[test]
    fn the_gpu_token_has_one_holder_is_released_on_exit_and_recovered_at_startup() {
        let reg = FleetRegistry::default();
        let gpu_job =
            |cwd: &str| profiled(cwd, MachineLoad::Light, EffortBand::S, GpuClass::Exclusive);
        let inputs = BudgetInputs::unmeasured(10, true);
        let mut measured = BudgetLive::new();
        // First exclusive job: the token is free.
        let used = measured.used(&reg);
        assert!(!used.gpu_held);
        assert_eq!(
            door_verdict(&reg, &gpu_job("C:/repo/g1"), 1_000, &inputs, used),
            Door::Start { passed: vec![] }
        );
        let mut g1 = live_charged("g1", &gpu_job("C:/repo/g1"));
        g1.created_at_ms = 100;
        reg.insert(g1);
        let used = measured.used(&reg);
        assert!(used.gpu_held);
        assert_eq!(measured.gpu_holder.as_deref(), Some("g1"));
        // A second one waits on the token; `shared` does not.
        assert_eq!(
            door_verdict(&reg, &gpu_job("C:/repo/g2"), 1_000, &inputs, used),
            Door::Queue(QueueWhy::Held(BudgetHold::GpuTokenHeld))
        );
        let shared = profiled(
            "C:/repo/sh",
            MachineLoad::Light,
            EffortBand::S,
            GpuClass::Shared,
        );
        assert_eq!(
            door_verdict(&reg, &shared, 1_000, &inputs, used),
            Door::Start { passed: vec![] }
        );
        let (g2, _) = enqueue_into(&reg, &gpu_job("C:/repo/g2"), 1_000, 10, 1);
        let snap =
            build_snapshot_with(&reg, &[], 2_000, &inputs, used, measured.gpu_holder.clone());
        assert_eq!(snap.budgets.gpu_holder.as_deref(), Some("g1"));
        assert_eq!(snap.budgets.hold, Some(BudgetHold::GpuTokenHeld));
        assert_eq!(snap.entries[0].held_by, Some(BudgetHold::GpuTokenHeld));
        assert_eq!(snap.entries[0].gpu, GpuClass::Exclusive);
        assert_eq!(scan_queue(&reg, 2_000, &inputs, used).pick, None);
        // The holder leaves the live set: released, and the waiter is next.
        end(&reg, "g1");
        let used = measured.used(&reg);
        assert!(!used.gpu_held);
        assert_eq!(measured.gpu_holder, None);
        assert_eq!(
            scan_queue(&reg, 3_000, &inputs, used).pick.as_deref(),
            Some(g2.as_str())
        );
        assert!(reg.adopt_spawn(spawned(&g2)));
        measured.used(&reg);
        assert_eq!(measured.gpu_holder.as_deref(), Some(g2.as_str()));

        // Startup: a fresh process finds live exclusive rows restored from the
        // table and adopts the OLDEST as the holder.
        let restored = FleetRegistry::default();
        let mut young = live_charged("young", &gpu_job("C:/repo/y"));
        young.created_at_ms = 900;
        let mut old = live_charged("old", &gpu_job("C:/repo/o"));
        old.created_at_ms = 200;
        restored.insert(young);
        restored.insert(old);
        let mut fresh = BudgetLive::new();
        assert!(fresh.used(&restored).gpu_held);
        assert_eq!(fresh.gpu_holder.as_deref(), Some("old"));
        // The charge survives the durable round trip that restore rides.
        let row = {
            let map = restored.sessions.lock().unwrap();
            super::super::persist::row_from_inner(map.get("old").unwrap()).unwrap()
        };
        assert_eq!(row.gpu_class.as_deref(), Some("exclusive"));
        assert_eq!(
            (row.machine_units, row.plan_units, row.skip_count),
            (Some(1), Some(1), None)
        );
        let back = super::super::persist::inner_from_row(&row);
        assert_eq!(back.admission.charge().gpu, GpuClass::Exclusive);
    }

    #[test]
    fn the_ram_gate_skips_its_first_sample_closes_at_85_reopens_at_70_and_never_touches_live_work()
    {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        let mut measured = BudgetLive::new();
        let door = |m: &mut BudgetLive| {
            let used = m.used(&reg);
            door_verdict(
                &reg,
                &req("C:/repo/new"),
                1_000,
                &m.inputs(10, true, 1_000),
                used,
            )
        };
        // Nothing sampled, then the FIRST sample - however bad - is not acted on.
        assert_eq!(measured.ram_gate, RamGate::Warming);
        assert_eq!(
            measured.note_ram(Some(99.0)),
            (RamGate::Warming, RamGate::Warming)
        );
        assert_eq!(door(&mut measured), Door::Start { passed: vec![] });
        // Second sample at the high-water mark: closed.
        assert_eq!(
            measured.note_ram(Some(85.0)),
            (RamGate::Warming, RamGate::Closed)
        );
        assert_eq!(
            door(&mut measured),
            Door::Queue(QueueWhy::Held(BudgetHold::RamHighWater))
        );
        let (q, _) = enqueue_into(&reg, &req("C:/repo/q"), 1_000, 10, 1);
        let used = measured.used(&reg);
        let inputs = measured.inputs(10, true, 1_000);
        assert_eq!(scan_queue(&reg, 2_000, &inputs, used).pick, None);
        let snap = build_snapshot_with(&reg, &[], 2_000, &inputs, used, None);
        assert_eq!(snap.budgets.ram_gate, RamGate::Closed);
        assert_eq!(snap.budgets.ram_pct, Some(85.0));
        assert_eq!(snap.budgets.hold, Some(BudgetHold::RamHighWater));
        // The gate defers promotion ONLY: the live session is untouched.
        assert_eq!(reg.session_state("a"), Some(S::Running));
        assert_eq!(reg.live_count(), 1);
        // Between the marks it stays closed; it reopens only at 70.
        assert_eq!(measured.note_ram(Some(75.0)).1, RamGate::Closed);
        assert_eq!(measured.note_ram(Some(70.0)).1, RamGate::Open);
        let inputs = measured.inputs(10, true, 1_000);
        assert_eq!(
            scan_queue(&reg, 3_000, &inputs, used).pick.as_deref(),
            Some(q.as_str())
        );
        // With an empty queue the snapshot still names a closed gate.
        let empty = FleetRegistry::default();
        measured.note_ram(Some(90.0));
        let snap = build_snapshot_with(
            &empty,
            &[],
            1,
            &measured.inputs(10, true, 1),
            Used::default(),
            None,
        );
        assert_eq!(snap.budgets.hold, Some(BudgetHold::RamHighWater));
    }

    #[test]
    fn a_charge_that_could_never_fit_is_refused_not_queued() {
        let reg = FleetRegistry::default();
        let inputs = BudgetInputs::unmeasured(4, true);
        let oversized = Charge {
            machine: 9,
            plan: 2,
            gpu: GpuClass::None,
        };
        assert_eq!(
            door_verdict_for(&reg, oversized, None, 1_000, &inputs, Used::default()),
            Door::Refuse
        );
        // Refused even when a time gate or a full fleet would otherwise queue it.
        assert_eq!(
            door_verdict_for(
                &reg,
                oversized,
                Some(i64::MAX),
                1_000,
                &inputs,
                Used::default()
            ),
            Door::Refuse
        );
        assert!(reg.queued_in_order().is_empty(), "never queued");
        // No profile in the closed vocabularies can be refused - not even on cap 1.
        let tiny = BudgetInputs::unmeasured(1, true);
        let heaviest = profiled(
            "C:/r",
            MachineLoad::Exclusive,
            EffortBand::Xl,
            GpuClass::Exclusive,
        );
        assert_eq!(
            door_verdict(&reg, &heaviest, 1_000, &tiny, Used::default()),
            Door::Start { passed: vec![] }
        );
        // The count-only door has no budgets to exceed.
        let off = BudgetInputs::unmeasured(4, false);
        assert_eq!(
            door_verdict_for(&reg, oversized, None, 1_000, &off, Used::default()),
            Door::Start { passed: vec![] }
        );
    }

    #[test]
    fn the_kill_switch_restores_the_count_only_door() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        // Every gauge hostile - and none of it consulted.
        let off = BudgetInputs {
            behind_pct: Some(-50.0),
            five_hour_full: true,
            governor_stop: true,
            memory_slots: Some(0),
            ram_pct: Some(99.0),
            ram_gate: RamGate::Closed,
            ..BudgetInputs::unmeasured(2, false)
        };
        let heaviest = profiled(
            "C:/r",
            MachineLoad::Exclusive,
            EffortBand::Xl,
            GpuClass::Exclusive,
        );
        let used = BudgetLive::new().used(&reg);
        assert_eq!(
            door_verdict(&reg, &heaviest, 1_000, &off, used),
            Door::Start { passed: vec![] }
        );
        reg.insert(live("b", S::Running));
        let used = BudgetLive::new().used(&reg);
        assert_eq!(
            door_verdict(&reg, &heaviest, 1_000, &off, used),
            Door::Queue(QueueWhy::Cap)
        );
        let mut gated = req("C:/gated");
        gated.not_before_ms = Some(9_000);
        assert_eq!(
            door_verdict(&reg, &gated, 1_000, &off, used),
            Door::Queue(QueueWhy::Gated)
        );
        // Promotion is the plain head.
        let (head, _) = enqueue_into(&reg, &heaviest, 1_000, 2, 2);
        enqueue_into(&reg, &req("C:/next"), 1_001, 2, 2);
        let scan = scan_queue(&reg, 2_000, &off, used);
        assert_eq!(scan.pick, head_to_promote(&reg, 2_000));
        assert_eq!(scan.pick.as_deref(), Some(head.as_str()));
        assert!(scan.unfit.is_empty() && !scan.blocked_by_aged);
        // The snapshot says so: nothing held, neutral budgets, real usage.
        let snap = build_snapshot_with(&reg, &[], 2_000, &off, used, None);
        assert!(!snap.budgets.enabled);
        assert_eq!(snap.budgets.hold, None);
        assert_eq!(
            (snap.budgets.machine_budget, snap.budgets.plan_budget),
            (2, 4)
        );
        assert_eq!((snap.budgets.machine_used, snap.budgets.plan_used), (2, 4));
        assert_eq!(snap.budgets.pace_factor, 1.0);
        assert!(snap.entries.iter().all(|e| e.held_by.is_none()));
        assert_eq!(snap.entries[0].plan_units, 8, "the weight is still shown");
    }

    #[test]
    fn start_now_bypasses_the_budgets_and_its_charge_counts_afterwards() {
        let reg = FleetRegistry::default();
        reg.insert(live("a", S::Running));
        let inputs = BudgetInputs::unmeasured(3, true); // machine 3, plan 6
        let mut measured = BudgetLive::new();
        let big = profiled("C:/big", MachineLoad::Heavy, EffortBand::Xl, GpuClass::None);
        let used = measured.used(&reg);
        assert_eq!(
            door_verdict(&reg, &big, 1_000, &inputs, used),
            Door::Queue(QueueWhy::BudgetFull),
            "4/8 on top of a live default does not fit 3/6"
        );
        let (id, _) = enqueue_into(&reg, &big, 1_000, 3, 1);
        // The operator starts it anyway: `promote` spawns whatever the budgets say.
        assert!(reg.adopt_spawn(spawned(&id)));
        let used = measured.used(&reg);
        assert_eq!((used.machine, used.plan), (5, 10), "the bypass is charged");
        // Under the COUNT cap (2 of 3) - and still nothing else fits.
        assert!(under_cap(reg.live_count(), 3));
        assert_eq!(
            door_verdict(&reg, &req("C:/next"), 2_000, &inputs, used),
            Door::Queue(QueueWhy::BudgetFull)
        );
        let snap = build_snapshot_with(&reg, &[], 2_000, &inputs, used, None);
        assert_eq!(
            (snap.budgets.machine_used, snap.budgets.machine_budget),
            (5, 3)
        );
        assert_eq!((snap.budgets.plan_used, snap.budgets.plan_budget), (10, 6));
        assert_eq!(snap.over_admitted, 0, "the count cap was never crossed");
        // A re-enqueue of that work is charged what the original was.
        let again = dispatch_of_session_in(&reg, &id).unwrap();
        assert_eq!(
            Charge::from_profile(again.profile.as_ref()),
            Charge::from_profile(big.profile.as_ref())
        );
    }

    #[test]
    fn the_empty_machine_rule_lets_an_exclusive_job_own_a_small_fleet() {
        let reg = FleetRegistry::default();
        let inputs = BudgetInputs::unmeasured(4, true); // machine 4, plan 8
        let mut measured = BudgetLive::new();
        let exclusive = profiled(
            "C:/x",
            MachineLoad::Exclusive,
            EffortBand::Xl,
            GpuClass::Exclusive,
        );
        let used = measured.used(&reg);
        assert_eq!(
            door_verdict(&reg, &exclusive, 1_000, &inputs, used),
            Door::Start { passed: vec![] }
        );
        reg.insert(live_charged("x", &exclusive));
        let used = measured.used(&reg);
        assert_eq!((used.machine, used.plan, used.gpu_held), (8, 8, true));
        // It owns the machine: three count slots are free and nothing fits.
        assert_eq!(
            door_verdict(&reg, &req("C:/d"), 1_000, &inputs, used),
            Door::Queue(QueueWhy::BudgetFull)
        );
        // Not alone, the same job waits instead.
        let busy = FleetRegistry::default();
        busy.insert(live("a", S::Running));
        let used = BudgetLive::new().used(&busy);
        assert_eq!(
            door_verdict(&busy, &exclusive, 1_000, &inputs, used),
            Door::Queue(QueueWhy::BudgetFull)
        );
    }

    #[test]
    fn a_stale_pacing_reading_is_dropped_and_the_budgets_fail_open() {
        let mut measured = BudgetLive::new();
        measured.behind_pct = Some(-25.0);
        measured.five_hour_full = true;
        measured.memory_slots = Some(0);
        measured.pacing_as_of_ms = 1_000;
        let fresh = measured.inputs(10, true, 1_000 + PACING_STALE_MS);
        assert!(fresh.five_hour_full);
        assert_eq!(
            (fresh.behind_pct, fresh.memory_slots),
            (Some(-25.0), Some(0))
        );
        let stale = measured.inputs(10, true, 1_001 + PACING_STALE_MS);
        assert!(!stale.five_hour_full);
        assert_eq!((stale.behind_pct, stale.memory_slots), (None, None));
        // Never read at all is the same as stale.
        assert_eq!(BudgetLive::new().inputs(10, true, 5).behind_pct, None);
    }
}
