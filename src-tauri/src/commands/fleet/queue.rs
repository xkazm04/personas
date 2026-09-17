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

use super::pty::SpawnIdentity;
use super::registry::{
    now_ms, registry, FleetRegistry, FleetSessionInner, OutputRing, OUTPUT_RING_CAP,
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
}

impl DispatchOrigin {
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
        }
    }

    /// Inverse of [`Self::token`]; an unknown or absent token reads as
    /// `Manual`, which is what every pre-queue row was.
    pub fn parse(token: Option<&str>) -> Self {
        match token {
            Some("dev_runner") => DispatchOrigin::DevRunner,
            Some("dispatch_ideas") => DispatchOrigin::DispatchIdeas,
            Some("athena") => DispatchOrigin::Athena,
            Some("autopilot") => DispatchOrigin::Autopilot,
            Some("night_shift") => DispatchOrigin::NightShift,
            Some("feed_impact") => DispatchOrigin::FeedImpact,
            Some("orphan_resume") => DispatchOrigin::OrphanResume,
            _ => DispatchOrigin::Manual,
        }
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
    pub not_before_ms: Option<i64>,
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
    if task.trim().is_empty() {
        return Err(AppError::Validation(
            "a headless dispatch must carry a non-empty task".into(),
        ));
    }
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
    pub queued_at_ms: i64,
    pub not_before_ms: Option<i64>,
    /// `now + rank × mean duration of the last 20 ended sessions`; `None`
    /// when there is no history to estimate from.
    pub estimated_start_ms: Option<i64>,
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
    if req.cwd.trim().is_empty() {
        return Err(AppError::Validation(
            "a dispatch needs a working directory".into(),
        ));
    }
    if matches!(req.mode, FleetSessionMode::Headless) {
        // Fail at the door, not at promotion time on a row nobody can start.
        split_headless_args(&req.args)?;
    }
    let cap = cap_via_app(app) as u32;
    let running = live_count();
    if under_cap(running, cap) {
        let session_id = spawn_now(app, &req, None)?;
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
    let (session_id, rank) = enqueue(app, &req, cap, running)?;
    super::debug_log::lifecycle(
        &session_id,
        "queued",
        &format!("rank {rank} · fleet at its cap ({running} of {cap} live)"),
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
        None,
    );
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
        cycle_index: None,
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
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        promote_head(&app).await;
    });
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
    // Bounded by the queue's length: every iteration either promotes, closes
    // or stops, so a loop over the queue can run at most `queued` times.
    let mut budget = registry().queued_in_order().len();
    while budget > 0 && under_cap(live_count(), cap) {
        budget -= 1;
        let Some(id) = head_to_promote(registry(), now_ms()) else {
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
            not_before_ms: s.not_before_ms,
        },
        SpawnIdentity {
            id: s.id.clone(),
            claude_session_id,
        },
    ))
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
    let _ = app.emit(
        event_name::FLEET_QUEUE_CHANGED,
        QueueChangedPayload {
            kind: kind.to_string(),
            session_id: session_id.map(str::to_string),
        },
    );
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

/// Assemble the snapshot from the registry, the cap and the duration history.
fn build_snapshot(
    reg: &FleetRegistry,
    cap: u32,
    durations_ms: &[i64],
    now: i64,
) -> FleetQueueSnapshot {
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
    }
}

async fn snapshot(app: &AppHandle, pool: DbPool) -> Result<FleetQueueSnapshot, AppError> {
    let _ = app;
    let (cap, durations) = tokio::task::spawn_blocking(move || {
        let cap = cap(&pool);
        let durations =
            fleet_sessions::recent_ended_durations_ms(&pool, ESTIMATE_HISTORY).unwrap_or_default();
        (cap, durations)
    })
    .await
    .map_err(|e| AppError::Internal(format!("fleet queue snapshot: {e}")))?;
    Ok(build_snapshot(registry(), cap, &durations, now_ms()))
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
    tokio::task::spawn_blocking(move || fleet_sessions::renumber_queue(&pool, &ranks_for_db))
        .await
        .map_err(|e| AppError::Internal(format!("fleet queue reorder: {e}")))??;
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

/// Start a queued dispatch NOW, cap or no cap. The snapshot's
/// `over_admitted` reports the overshoot afterwards.
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
            not_before_ms: None,
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
        for o in [
            DispatchOrigin::Manual,
            DispatchOrigin::DevRunner,
            DispatchOrigin::DispatchIdeas,
            DispatchOrigin::Athena,
            DispatchOrigin::Autopilot,
            DispatchOrigin::NightShift,
            DispatchOrigin::FeedImpact,
            DispatchOrigin::OrphanResume,
        ] {
            let wire = serde_json::to_value(o).unwrap();
            assert_eq!(wire, serde_json::Value::String(o.token().to_string()));
            assert_eq!(DispatchOrigin::parse(Some(o.token())), o);
        }
        assert_eq!(DispatchOrigin::parse(None), DispatchOrigin::Manual);
        assert_eq!(over_admitted(3, 5), 0);
        assert_eq!(over_admitted(7, 5), 2);
        assert_eq!(estimated_start_ms(100, 2, &[10, 20]), Some(130));
        assert!(!is_live_state(S::Queued));
    }
}
