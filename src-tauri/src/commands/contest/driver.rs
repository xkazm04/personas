//! The seat driver and the autopilot chain.
//!
//! - **Launch.** `contest.mjs plan` prepares the seats of one kind (the prompt
//!   is the instrument's, never duplicated here); each seat is admitted through
//!   the fleet's one door (`spawn_contest_seat`, run label
//!   `contest:<contestId>:<seatKey>`), and its session id lands in `app.json`.
//! - **Watch.** One task per seat waits for the seat to START (queue time does
//!   not count), then times the run against the ceiling (`timeout_min` for a
//!   participant, 30 min for a judge), kills it on timeout, and writes
//!   `runs/<seatKey>/record.json` + `final.md` in the skill's record schema.
//! - **Chain.** When every participant seat has a record: collect → visual pass
//!   (when Playwright resolves) → judges (when enabled) → aggregate → ready.
//!   Every step is idempotent (the instrument's steps are) and retryable.
//! - **Durability.** Once per boot, right after the fleet rehydrates its rows
//!   (the fleet ticker kicks [`kick_reattach`]; the first `contest_list` /
//!   `contest_get` is the fallback), the driver re-attaches: a seat whose
//!   session is still queued or running gets a
//!   watcher again; a seat whose session ended while the app was down gets its
//!   record from what the fleet still knows (the in-memory capture is gone), or
//!   an `errored` record with the reason stated. `app.json` `recordedSessions`
//!   makes finalising idempotent, so no record is ever written twice.
//!
//! Every seat-state change and chain step emits `contest-changed`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::fleet::contest_seat::{
    self, contest_run_label, is_settled_state, is_started_state, ContestSeatLaunch,
};
use crate::commands::fleet::registry::registry;
use crate::commands::fleet::types::FleetSessionState;
use crate::commands::fleet::wait::wait_until_state;
use crate::db::models::DevProject;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::error::AppError;

use super::arena::{
    self, is_judge_key, judge_seat_key, parse_seat_spec, ArenaPaths, ContestFile, RecordView,
    SeatLive, Sidecar,
};
use super::node::{self, STEP_TIMEOUT, VISUAL_TIMEOUT};
use super::record::{self, RunEnd, SeatIdentity};
use super::types::{ContestChainStep, ContestChangedPayload, ContestSeatKind};

/// A judge seat's ceiling (the instrument's `judge` default).
const JUDGE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// After a timeout kill, how long to wait for the fleet to settle the row.
const KILL_SETTLE: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

pub fn db_of(app: &AppHandle) -> Result<DbPool, AppError> {
    app.try_state::<Arc<crate::AppState>>()
        .map(|s| s.db.clone())
        .ok_or_else(|| AppError::Internal("contest: app state is not ready".into()))
}

/// One contest, resolved: its project and its arena paths.
#[derive(Debug, Clone)]
pub struct Ctx {
    pub project_id: String,
    pub project_name: String,
    pub paths: ArenaPaths,
}

impl Ctx {
    pub fn root(&self) -> &Path {
        &self.paths.project_root
    }
    pub fn contest_id(&self) -> &str {
        &self.paths.contest_id
    }
    /// The args every instrument step takes: `--id <id> --arena <abs>`.
    pub fn id_args(&self, step: &str) -> Vec<String> {
        vec![
            step.to_string(),
            "--id".to_string(),
            self.paths.contest_id.clone(),
            "--arena".to_string(),
            self.paths.arena_root.to_string_lossy().into_owned(),
        ]
    }
}

pub fn project(db: &DbPool, project_id: &str) -> Result<DevProject, AppError> {
    crate::db::repos::dev_tools::get_project_by_id(db, project_id)
}

pub fn ctx_for_project(p: &DevProject, contest_id: &str) -> Result<Ctx, AppError> {
    Ok(Ctx {
        project_id: p.id.clone(),
        project_name: p.name.clone(),
        paths: ArenaPaths::new(Path::new(&p.root_path), contest_id)?,
    })
}

/// Resolve an EXISTING contest (its `contest.json` must be on disk).
pub fn ctx(db: &DbPool, project_id: &str, contest_id: &str) -> Result<Ctx, AppError> {
    let p = project(db, project_id)?;
    let c = ctx_for_project(&p, contest_id)?;
    if !c.paths.contest_json().is_file() {
        return Err(AppError::NotFound(format!(
            "no contest `{contest_id}` in project `{}`",
            p.name
        )));
    }
    Ok(c)
}

pub fn read_contest(paths: &ArenaPaths) -> Result<ContestFile, AppError> {
    arena::read_json(&paths.contest_json())
}

// ---------------------------------------------------------------------------
// Process-wide driver state
// ---------------------------------------------------------------------------

/// Session ids that have a live watcher in this process.
fn watched() -> &'static Mutex<HashSet<String>> {
    static W: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    W.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Contest dirs whose chain is running in this process (single-flight).
fn chain_busy() -> &'static Mutex<HashSet<PathBuf>> {
    static B: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(HashSet::new()))
}

/// One async lock per contest dir, for every read-modify-write of `app.json`.
fn contest_lock(dir: &Path) -> Arc<tokio::sync::Mutex<()>> {
    static L: OnceLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let mut map = L
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    map.entry(dir.to_path_buf())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Read-modify-write the sidecar under the contest's lock.
pub async fn update_sidecar<R>(
    paths: &ArenaPaths,
    f: impl FnOnce(&mut Sidecar) -> R,
) -> Result<R, AppError> {
    let lock = contest_lock(&paths.dir);
    let _guard = lock.lock().await;
    let mut s = arena::read_sidecar(paths);
    let r = f(&mut s);
    arena::write_json(&paths.app_json(), &s)?;
    Ok(r)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub async fn set_chain(
    app: &AppHandle,
    ctx: &Ctx,
    step: ContestChainStep,
    reason: Option<String>,
) -> Result<(), AppError> {
    update_sidecar(&ctx.paths, |s| {
        s.chain.step = step;
        s.chain.reason = reason;
        s.chain.updated_at_ms = Some(now_ms());
    })
    .await?;
    emit_changed(app, &ctx.project_id, ctx.contest_id());
    Ok(())
}

/// Move the chain from `from` to `to`, only while it is still at `from`: a
/// cancel (or any failure) written meanwhile wins and the chain stops there.
/// Returns whether it moved. The check and the write share the contest lock.
pub async fn transition_chain(
    paths: &ArenaPaths,
    from: ContestChainStep,
    to: ContestChainStep,
    reason: Option<String>,
) -> Result<bool, AppError> {
    update_sidecar(paths, |s| {
        if s.chain.step != from {
            return false;
        }
        s.chain.step = to;
        s.chain.reason = reason;
        s.chain.updated_at_ms = Some(now_ms());
        true
    })
    .await
}

/// [`transition_chain`] plus the change event; a refused move is logged.
async fn advance_chain(
    app: &AppHandle,
    ctx: &Ctx,
    from: ContestChainStep,
    to: ContestChainStep,
    reason: Option<String>,
) -> Result<bool, AppError> {
    let moved = transition_chain(&ctx.paths, from, to, reason).await?;
    if moved {
        emit_changed(app, &ctx.project_id, ctx.contest_id());
    } else {
        tracing::info!(contest = %ctx.contest_id(), ?from, ?to,
            "contest: the chain moved on meanwhile (cancelled), stopping here");
    }
    Ok(moved)
}

pub fn emit_changed(app: &AppHandle, project_id: &str, contest_id: &str) {
    if let Err(e) = app.emit(
        event_name::CONTEST_CHANGED,
        ContestChangedPayload {
            project_id: project_id.to_string(),
            contest_id: contest_id.to_string(),
        },
    ) {
        tracing::warn!(contest_id, error = %e, "contest: contest-changed emit failed");
    }
}

fn short_reason(e: &AppError) -> String {
    node::tail_lines(&e.to_string(), 8, 600)
}

// ---------------------------------------------------------------------------
// Live seat state
// ---------------------------------------------------------------------------

/// A seat session's live state in the fleet. A session the registry restored
/// after a restart has no process (`dozing`): its run is over.
pub fn seat_live(session_id: &str) -> SeatLive {
    let state = registry().session_state(session_id);
    if state == Some(FleetSessionState::Queued) {
        SeatLive::Queued
    } else if is_settled_state(state) || registry().is_dozing(session_id) {
        SeatLive::Settled
    } else {
        SeatLive::Running
    }
}

/// seatKey → live state of its latest session, with a recorded session
/// always settled (its record is written).
pub fn live_by_key(s: &Sidecar) -> BTreeMap<String, SeatLive> {
    s.seat_sessions
        .iter()
        .map(|(key, sid)| {
            let live = if s.recorded_sessions.get(key) == Some(sid) {
                SeatLive::Settled
            } else {
                seat_live(sid)
            };
            (key.clone(), live)
        })
        .collect()
}

pub fn is_watched(session_id: &str) -> bool {
    watched()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(session_id)
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/// `contest.mjs plan` output.
#[derive(Debug, Clone, Deserialize)]
struct PlanOut {
    timeout_min: Option<f64>,
    seats: Vec<PlanSeat>,
}

#[derive(Debug, Clone, Deserialize)]
struct PlanSeat {
    id: String,
    spec: String,
    engine: String,
    model: String,
    effort: String,
    cwd: String,
    log_dir: String,
    prompt: String,
}

/// One seat under watch.
#[derive(Debug, Clone)]
struct SeatJob {
    ctx: Ctx,
    key: String,
    who: SeatIdentity,
    session_id: String,
    timeout: Duration,
}

/// Plan and admit the seats of `kind` (all, or the `only` seat keys).
pub async fn launch_seats(
    app: &AppHandle,
    ctx: &Ctx,
    kind: ContestSeatKind,
    only: Option<Vec<String>>,
) -> Result<usize, AppError> {
    launch_seats_from(app, ctx, kind, only, None).await
}

/// [`launch_seats`]. With `chain_from`, the chain launches its judges: they
/// are armed only while the chain is still at that step (a cancel wins), with
/// that reason kept.
async fn launch_seats_from(
    app: &AppHandle,
    ctx: &Ctx,
    kind: ContestSeatKind,
    only: Option<Vec<String>>,
    chain_from: Option<(ContestChainStep, Option<String>)>,
) -> Result<usize, AppError> {
    let db = db_of(app)?;
    let instrument = node::require_instrument(&db, ctx.root())?;
    let sidecar = arena::read_sidecar(&ctx.paths);
    let mut args = ctx.id_args("plan");
    match kind {
        ContestSeatKind::Participant => {
            args.extend(["--kind".into(), "participants".into()]);
            if let Some(only) = only.as_ref().filter(|o| !o.is_empty()) {
                for k in only {
                    arena::require_slug("seat id", k)?;
                }
                args.extend(["--only".into(), only.join(",")]);
            }
        }
        ContestSeatKind::Judge => {
            let mut specs = Vec::new();
            for spec in &sidecar.judges {
                let p = parse_seat_spec(spec)?;
                let key = judge_seat_key(&p.id);
                let wanted = match &only {
                    Some(o) if !o.is_empty() => o.contains(&key) || o.contains(&p.id),
                    _ => true,
                };
                if wanted {
                    specs.push(p.spec);
                }
            }
            personas_core::validation::require_at_least_one("judges", &specs)?;
            args.extend([
                "--kind".into(),
                "judges".into(),
                "--judges".into(),
                specs.join(","),
            ]);
        }
    }
    let out = node::run_node_checked(&instrument, &args, ctx.root(), STEP_TIMEOUT).await?;
    let plan: PlanOut = serde_json::from_str(out.stdout.trim()).map_err(|e| {
        AppError::Internal(format!(
            "contest plan: unreadable output ({e}): {}",
            node::tail_lines(&out.stdout, 3, 300)
        ))
    })?;
    let timeout = match kind {
        ContestSeatKind::Participant => plan
            .timeout_min
            .filter(|m| m.is_finite() && *m > 0.0)
            .map(|m| Duration::from_secs_f64(m * 60.0))
            .unwrap_or(Duration::from_secs(60 * 60)),
        ContestSeatKind::Judge => plan
            .timeout_min
            .filter(|m| m.is_finite() && *m > 0.0)
            .map(|m| Duration::from_secs_f64(m * 60.0))
            .unwrap_or(JUDGE_TIMEOUT),
    };

    // Arm the chain BEFORE any seat can settle, so the last seat to settle
    // always finds the step it advances from.
    match (kind, chain_from) {
        (ContestSeatKind::Participant, _) => {
            set_chain(app, ctx, ContestChainStep::Idle, None).await?
        }
        (ContestSeatKind::Judge, Some((from, reason))) => {
            if !advance_chain(app, ctx, from, ContestChainStep::Judging, reason).await? {
                return Ok(0);
            }
        }
        (ContestSeatKind::Judge, None) => {
            let keep = sidecar.chain.reason.clone();
            set_chain(app, ctx, ContestChainStep::Judging, keep).await?
        }
    }

    let mut launched = 0usize;
    for seat in plan.seats {
        let key = Path::new(&seat.log_dir)
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_string)
            .unwrap_or_default();
        arena::require_slug("seat key", &key)?;
        let current = arena::read_sidecar(&ctx.paths);
        if current.chain.step == ContestChainStep::Failed {
            tracing::info!(seat = %key, "contest: cancelled mid-launch, no more seats");
            break;
        }
        if let Some(prev) = current.seat_sessions.get(&key) {
            let recorded = current.recorded_sessions.get(&key) == Some(prev);
            if !recorded && matches!(seat_live(prev), SeatLive::Queued | SeatLive::Running) {
                tracing::info!(seat = %key, "contest: seat already live, not launched twice");
                continue;
            }
        }
        let parsed = parse_seat_spec(&seat.spec)?;
        let cwd = PathBuf::from(&seat.cwd);
        std::fs::create_dir_all(&cwd)
            .map_err(|e| AppError::Internal(format!("create {}: {e}", cwd.display())))?;
        let session_id = contest_seat::spawn_contest_seat(
            app,
            ContestSeatLaunch {
                cwd,
                prompt: seat.prompt.clone(),
                engine: parsed.engine,
                model: parsed.model.clone(),
                effort: parsed.effort,
                run_label: contest_run_label(ctx.contest_id(), &key),
                not_before_ms: sidecar.not_before_ms,
            },
        )
        .await?;
        let cancelled = update_sidecar(&ctx.paths, |s| {
            s.seat_sessions.insert(key.clone(), session_id.clone());
            s.recorded_sessions.remove(&key);
            s.seat_started_ms.remove(&key);
            s.chain.step == ContestChainStep::Failed
        })
        .await?;
        emit_changed(app, &ctx.project_id, ctx.contest_id());
        if cancelled {
            // A cancel landed while this seat was admitted: it read the
            // sessions before this one was recorded, so end it here.
            if let Err(e) = contest_seat::kill_contest_seat(app, &session_id) {
                tracing::warn!(seat = %key, error = %e, "contest: could not end a seat admitted during cancel");
            }
        }
        spawn_watcher(
            app.clone(),
            SeatJob {
                ctx: ctx.clone(),
                key,
                who: SeatIdentity {
                    id: seat.id,
                    spec: seat.spec,
                    engine: seat.engine,
                    model: seat.model,
                    effort: seat.effort,
                },
                session_id,
                timeout,
            },
        );
        launched += 1;
    }
    Ok(launched)
}

// ---------------------------------------------------------------------------
// Watch + finalise
// ---------------------------------------------------------------------------

fn spawn_watcher(app: AppHandle, job: SeatJob) {
    {
        let mut w = watched().lock().unwrap_or_else(|e| e.into_inner());
        if !w.insert(job.session_id.clone()) {
            return;
        }
    }
    tauri::async_runtime::spawn(async move {
        let sid = job.session_id.clone();
        let run = std::panic::AssertUnwindSafe(watch(&app, &job)).catch_unwind();
        if run.await.is_err() {
            // A panicked watcher still leaves a durable, honest record.
            tracing::error!(session = %sid, "contest: seat watcher panicked");
            let end = RunEnd {
                missing_capture_reason: Some("the app's seat watcher failed".into()),
                ..RunEnd::default()
            };
            if let Err(e) = finalize(&app, &job, end).await {
                tracing::warn!(error = %e, "contest: could not record a panicked seat");
            }
        }
        watched()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&sid);
        advance(&app, &job.ctx).await;
    });
}

async fn watch(app: &AppHandle, job: &SeatJob) {
    let sid = job.session_id.as_str();
    // Queue time does not count against the ceiling: wait for the start.
    wait_until_state(sid, is_started_state, None).await;
    // The start is recorded once per run; a re-attached watcher (after a
    // restart) keeps the original start and so the original ceiling.
    let key = job.key.clone();
    let owner = job.session_id.clone();
    let started_ms = update_sidecar(&job.ctx.paths, move |s| {
        if s.seat_sessions.get(&key) != Some(&owner) {
            return None;
        }
        Some(*s.seat_started_ms.entry(key).or_insert_with(now_ms))
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_else(now_ms);
    emit_changed(app, &job.ctx.project_id, job.ctx.contest_id());
    let already = Duration::from_millis(u64::try_from(now_ms() - started_ms).unwrap_or(0));
    let remaining = job.timeout.saturating_sub(already);
    let started = Instant::now()
        .checked_sub(already)
        .unwrap_or_else(Instant::now);
    let settled = wait_until_state(sid, is_settled_state, Some(remaining)).await;
    let timed_out = !settled.matched;
    if timed_out {
        tracing::info!(session = %sid, seat = %job.key, "contest: seat hit its ceiling, killing");
        if let Err(e) = contest_seat::kill_contest_seat(app, sid) {
            tracing::warn!(session = %sid, error = %e, "contest: kill after timeout failed");
        }
        wait_until_state(sid, is_settled_state, Some(KILL_SETTLE)).await;
    }
    let outcome = contest_seat::contest_seat_outcome(sid);
    let end = RunEnd {
        exit: outcome.effective_exit(),
        missing_capture_reason: outcome
            .capture
            .is_none()
            .then(|| "the seat's event stream produced nothing the app could read".to_string()),
        state_reason: outcome.state_reason.clone(),
        capture: outcome.capture,
        timed_out,
        wall_s: Some(started.elapsed().as_secs_f64()),
        finished_without_capture: false,
    };
    if let Err(e) = finalize(app, job, end).await {
        tracing::warn!(session = %sid, error = %e, "contest: writing the seat record failed");
    }
}

/// Write `record.json` + `final.md` for the job's session, once.
async fn finalize(app: &AppHandle, job: &SeatJob, end: RunEnd) -> Result<(), AppError> {
    let paths = &job.ctx.paths;
    let lock = contest_lock(&paths.dir);
    let _guard = lock.lock().await;
    let mut s = arena::read_sidecar(paths);
    if s.recorded_sessions.get(&job.key) == Some(&job.session_id) {
        return Ok(()); // never double-write
    }
    if s.seat_sessions.get(&job.key) != Some(&job.session_id) {
        // A newer run of this seat superseded this session; its record is not ours.
        return Ok(());
    }
    let (rec, final_text) = record::build_record(&job.who, &end, record::iso_now());
    arena::write_text(&paths.run_dir(&job.key).join("final.md"), &final_text)?;
    arena::write_json(&paths.record_json(&job.key), &rec)?;
    s.recorded_sessions
        .insert(job.key.clone(), job.session_id.clone());
    arena::write_json(&paths.app_json(), &s)?;
    contest_seat::forget_seat_capture(&job.session_id);
    drop(_guard);
    emit_changed(app, &job.ctx.project_id, job.ctx.contest_id());
    Ok(())
}

/// Move the chain on when a batch of seats has settled.
async fn advance(app: &AppHandle, ctx: &Ctx) {
    let s = arena::read_sidecar(&ctx.paths);
    let all_recorded = |judges: bool| {
        let keys: Vec<&String> = s
            .seat_sessions
            .keys()
            .filter(|k| is_judge_key(k) == judges)
            .collect();
        !keys.is_empty()
            && keys
                .iter()
                .all(|k| s.recorded_sessions.get(*k) == s.seat_sessions.get(*k))
    };
    match s.chain.step {
        ContestChainStep::Idle if all_recorded(false) => {
            spawn_chain(app.clone(), ctx.clone(), ChainFrom::Collect);
        }
        ContestChainStep::Collecting => {
            spawn_chain(app.clone(), ctx.clone(), ChainFrom::Collect);
        }
        ContestChainStep::Visual => {
            spawn_chain(app.clone(), ctx.clone(), ChainFrom::Visual);
        }
        ContestChainStep::Judging if all_recorded(true) => {
            spawn_chain(app.clone(), ctx.clone(), ChainFrom::Aggregate);
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainFrom {
    Collect,
    Visual,
    Aggregate,
}

fn claim_chain(dir: &Path) -> bool {
    chain_busy()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(dir.to_path_buf())
}

fn release_chain(dir: &Path) {
    chain_busy()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(dir);
}

pub fn chain_is_busy(dir: &Path) -> bool {
    chain_busy()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(dir)
}

/// Run the chain from `from` in the background; a no-op while one runs.
/// Returns whether it started.
pub fn spawn_chain(app: AppHandle, ctx: Ctx, from: ChainFrom) -> bool {
    if !claim_chain(&ctx.paths.dir) {
        return false;
    }
    tauri::async_runtime::spawn(async move {
        let dir = ctx.paths.dir.clone();
        let run = std::panic::AssertUnwindSafe(run_chain(&app, &ctx, from)).catch_unwind();
        if run.await.is_err() {
            tracing::error!(contest = %ctx.contest_id(), "contest: chain panicked");
            let _ = set_chain(
                &app,
                &ctx,
                ContestChainStep::Failed,
                Some("the chain stopped unexpectedly".into()),
            )
            .await;
        }
        release_chain(&dir);
        // A judge seat that settled while this chain still held the claim
        // (e.g. it failed at once) could not start the aggregate; look again.
        if arena::read_sidecar(&ctx.paths).chain.step == ContestChainStep::Judging {
            advance(&app, &ctx).await;
        }
    });
    true
}

async fn run_chain(app: &AppHandle, ctx: &Ctx, from: ChainFrom) {
    if let Err(e) = chain_steps(app, ctx, from).await {
        tracing::warn!(contest = %ctx.contest_id(), error = %e, "contest: chain step failed");
        if let Err(e2) = set_chain(app, ctx, ContestChainStep::Failed, Some(short_reason(&e))).await
        {
            tracing::warn!(error = %e2, "contest: could not record the chain failure");
        }
    }
}

async fn chain_steps(app: &AppHandle, ctx: &Ctx, from: ChainFrom) -> Result<(), AppError> {
    let db = db_of(app)?;
    let instrument = node::require_instrument(&db, ctx.root())?;
    if from == ChainFrom::Aggregate {
        return aggregate_to_ready(app, ctx, &instrument).await;
    }
    // The entry step is written as-is (a retry starts from Failed); every
    // later move is taken only while the chain still sits where this run
    // left it, so a cancel during collect or the visual pass stops it.
    if from == ChainFrom::Collect {
        set_chain(app, ctx, ContestChainStep::Collecting, None).await?;
        collect(ctx, &instrument).await?;
        let (c, v) = (ContestChainStep::Collecting, ContestChainStep::Visual);
        if !advance_chain(app, ctx, c, v, None).await? {
            return Ok(());
        }
    } else {
        set_chain(app, ctx, ContestChainStep::Visual, None).await?;
    }
    let skipped = visual_pass(ctx, &instrument).await;
    let s = arena::read_sidecar(&ctx.paths);
    if s.judges_enabled && !s.judges.is_empty() {
        let from = Some((ContestChainStep::Visual, skipped));
        launch_seats_from(app, ctx, ContestSeatKind::Judge, None, from).await?;
        return Ok(());
    }
    let (v, r) = (ContestChainStep::Visual, ContestChainStep::Ready);
    advance_chain(app, ctx, v, r, skipped).await.map(|_| ())
}

pub async fn collect(ctx: &Ctx, instrument: &Path) -> Result<(), AppError> {
    node::run_node_checked(
        instrument,
        &ctx.id_args("collect"),
        ctx.root(),
        STEP_TIMEOUT,
    )
    .await
    .map(|_| ())
}

/// The visual pass. Never fatal: its screenshots are the host's eyes, not an
/// input any later step reads. Returns why it was skipped or failed, if it was.
pub async fn visual_pass(ctx: &Ctx, instrument: &Path) -> Option<String> {
    if !node::playwright_available(ctx.root()) {
        return Some(
            "visual pass skipped: Playwright is not installed in this project \
             (node_modules/playwright)"
                .into(),
        );
    }
    let script = node::visual_pass_script(instrument);
    if !script.is_file() {
        return Some(format!(
            "visual pass skipped: {} is missing",
            script.display()
        ));
    }
    let args = vec![ctx.paths.dir.to_string_lossy().into_owned()];
    match node::run_node_script(&script, &args, ctx.root(), VISUAL_TIMEOUT).await {
        Ok(out) if out.success => None,
        Ok(out) => Some(format!("visual pass failed: {}", out.tail())),
        Err(e) => Some(format!("visual pass failed: {}", short_reason(&e))),
    }
}

async fn aggregate_to_ready(app: &AppHandle, ctx: &Ctx, instrument: &Path) -> Result<(), AppError> {
    node::run_node_checked(
        instrument,
        &ctx.id_args("aggregate"),
        ctx.root(),
        STEP_TIMEOUT,
    )
    .await?;
    let reason = arena::read_sidecar(&ctx.paths).chain.reason;
    set_chain(app, ctx, ContestChainStep::Ready, reason).await
}

/// `contest_run_step`: collect / visual continue the chain from there; judge
/// launches the judge seats; aggregate runs now and marks the chain ready.
pub async fn run_step(
    app: &AppHandle,
    ctx: &Ctx,
    step: super::types::ContestStep,
) -> Result<(), AppError> {
    use super::types::ContestStep;
    if chain_is_busy(&ctx.paths.dir) {
        return Err(AppError::Validation(
            "a chain step is already running for this contest".into(),
        ));
    }
    match step {
        ContestStep::Collect => {
            spawn_chain(app.clone(), ctx.clone(), ChainFrom::Collect);
            Ok(())
        }
        ContestStep::Visual => {
            spawn_chain(app.clone(), ctx.clone(), ChainFrom::Visual);
            Ok(())
        }
        ContestStep::Judge => match launch_seats(app, ctx, ContestSeatKind::Judge, None).await {
            Ok(_) => Ok(()),
            Err(e) => {
                let _ = set_chain(app, ctx, ContestChainStep::Failed, Some(short_reason(&e))).await;
                Err(e)
            }
        },
        ContestStep::Aggregate => {
            if !claim_chain(&ctx.paths.dir) {
                return Err(AppError::Validation(
                    "a chain step is already running for this contest".into(),
                ));
            }
            let res = async {
                let db = db_of(app)?;
                let instrument = node::require_instrument(&db, ctx.root())?;
                aggregate_to_ready(app, ctx, &instrument).await
            }
            .await;
            release_chain(&ctx.paths.dir);
            if let Err(e) = &res {
                let _ = set_chain(app, ctx, ContestChainStep::Failed, Some(short_reason(e))).await;
            }
            res
        }
    }
}

/// Kill every live seat and mark the chain failed ("cancelled"). The chain is
/// marked first, so the watchers' records do not advance it and a running
/// chain stops at its next step. A seat that could not be ended is named in
/// the chain reason and returned as the error.
pub async fn cancel(app: &AppHandle, ctx: &Ctx) -> Result<(), AppError> {
    set_chain(app, ctx, ContestChainStep::Failed, Some("cancelled".into())).await?;
    let s = arena::read_sidecar(&ctx.paths);
    let mut failed: Vec<String> = Vec::new();
    for (key, live) in live_by_key(&s) {
        if matches!(live, SeatLive::Queued | SeatLive::Running) {
            if let Some(sid) = s.seat_sessions.get(&key) {
                if let Err(e) = contest_seat::kill_contest_seat(app, sid) {
                    tracing::warn!(seat = %key, error = %e, "contest: cancel could not end a seat");
                    failed.push(format!("{key}: {e}"));
                }
            }
        }
    }
    if failed.is_empty() {
        return Ok(());
    }
    let reason = format!(
        "cancelled; still running (could not be ended): {}",
        failed.join("; ")
    );
    set_chain(app, ctx, ContestChainStep::Failed, Some(reason.clone())).await?;
    Err(AppError::ProcessSpawn(format!("contest cancel: {reason}")))
}

// ---------------------------------------------------------------------------
// Durability: re-attach after a restart
// ---------------------------------------------------------------------------

/// Who a seat key is, from `contest.json` (participants by id, judges by
/// `judge-<id>`); `None` when the file no longer names it.
fn identity_for(c: &ContestFile, key: &str) -> Option<SeatIdentity> {
    let from_spec = |spec: &str, id: String| {
        let p = parse_seat_spec(spec).ok()?;
        Some(SeatIdentity {
            id,
            spec: p.spec,
            engine: arena::engine_str(p.engine).to_string(),
            model: p.model,
            effort: arena::effort_str(p.effort).to_string(),
        })
    };
    if let Some(judge_id) = key.strip_prefix("judge-") {
        return c
            .judges
            .iter()
            .filter_map(|j| parse_seat_spec(j).ok())
            .find(|p| p.id == judge_id)
            .and_then(|p| from_spec(&p.spec, p.id.clone()));
    }
    c.participants
        .iter()
        .find(|p| p.id == key)
        .and_then(|p| from_spec(&p.spec, p.id.clone()))
}

/// Set once the boot re-attach has started (it runs once per process).
static REATTACHED: AtomicBool = AtomicBool::new(false);

/// Start the boot re-attach in the background, once. Called by the fleet's
/// ticker right after it rehydrates (and may promote) the restored rows, so
/// a restored seat gets its watcher — its ceiling, its record, the chain —
/// without anyone opening the Contest page. A no-op until the app state is
/// managed and after the re-attach has started.
pub fn kick_reattach(app: &AppHandle) {
    if REATTACHED.load(Ordering::SeqCst) || db_of(app).is_err() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let run = std::panic::AssertUnwindSafe(ensure_reattached(&app)).catch_unwind();
        if run.await.is_err() {
            tracing::error!("contest: the boot re-attach panicked");
        }
    });
}

/// Once per boot: bring every contest's seats back under the driver.
pub async fn ensure_reattached(app: &AppHandle) {
    let Ok(db) = db_of(app) else { return };
    if REATTACHED.swap(true, Ordering::SeqCst) {
        return;
    }
    // The fleet restores its rows from the DB on its own ticker; make sure it
    // has (both calls are idempotent and one-shot), so a restored seat is not
    // misread as gone, and a finished claude seat is settled from its
    // transcript before we read it.
    crate::commands::fleet::persist::rehydrate(app);
    crate::commands::fleet::persist::recover_after_restart(app);

    let projects = match crate::db::repos::dev_tools::list_projects(&db, None) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "contest: re-attach could not list projects");
            return;
        }
    };
    for p in projects {
        for contest_id in arena::list_contest_ids(Path::new(&p.root_path)) {
            let Ok(ctx) = ctx_for_project(&p, &contest_id) else {
                continue;
            };
            if let Err(e) = reattach_contest(app, &ctx).await {
                tracing::warn!(contest = %contest_id, error = %e, "contest: re-attach failed");
            }
        }
    }
}

async fn reattach_contest(app: &AppHandle, ctx: &Ctx) -> Result<(), AppError> {
    let s = arena::read_sidecar(&ctx.paths);
    if s.seat_sessions.is_empty() {
        return Ok(());
    }
    let c = read_contest(&ctx.paths)?;
    let participant_timeout = Duration::from_secs(u64::from(c.timeout_min.max(1)) * 60);
    for (key, sid) in &s.seat_sessions {
        if s.recorded_sessions.get(key) == Some(sid) || is_watched(sid) {
            continue;
        }
        let who = identity_for(&c, key).unwrap_or_else(|| SeatIdentity {
            id: key.clone(),
            spec: String::new(),
            engine: String::new(),
            model: String::new(),
            effort: String::new(),
        });
        let job = SeatJob {
            ctx: ctx.clone(),
            key: key.clone(),
            who,
            session_id: sid.clone(),
            timeout: if is_judge_key(key) {
                JUDGE_TIMEOUT
            } else {
                participant_timeout
            },
        };
        match seat_live(sid) {
            // Still queued or running: watch it again. Its recorded start
            // (app.json seatStartedMs) keeps the ceiling where it was.
            SeatLive::Queued | SeatLive::Running => spawn_watcher(app.clone(), job),
            SeatLive::Settled => {
                let outcome = contest_seat::contest_seat_outcome(sid);
                let finished =
                    outcome.capture.is_none() && outcome.state == Some(FleetSessionState::Finished);
                let end = RunEnd {
                    exit: outcome.effective_exit(),
                    missing_capture_reason: outcome.capture.is_none().then(|| {
                        if outcome.state.is_none() {
                            "the app restarted and the fleet no longer knows this seat's session"
                                .to_string()
                        } else {
                            "the app restarted while this seat ran; its live output was lost"
                                .to_string()
                        }
                    }),
                    state_reason: outcome.state_reason.clone(),
                    capture: outcome.capture,
                    timed_out: false,
                    wall_s: None,
                    finished_without_capture: finished,
                };
                finalize(app, &job, end).await?;
            }
        }
    }
    advance(app, ctx).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Seat views for contest_get
// ---------------------------------------------------------------------------

/// The record of a seat key, if one was written.
pub fn read_record(paths: &ArenaPaths, key: &str) -> Option<RecordView> {
    match arena::read_json_opt::<RecordView>(&paths.record_json(key)) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(seat = %key, error = %e, "contest: record.json unreadable");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arena() -> (tempfile::TempDir, ArenaPaths) {
        let tmp = tempfile::tempdir().unwrap();
        let paths = ArenaPaths::new(tmp.path(), "c").unwrap();
        (tmp, paths)
    }

    async fn cancel_now(paths: &ArenaPaths) {
        update_sidecar(paths, |s| {
            s.chain.step = ContestChainStep::Failed;
            s.chain.reason = Some("cancelled".into());
        })
        .await
        .unwrap();
    }

    /// Both cancel windows of the chain: during `collect` (the chain would
    /// move Collecting -> Visual) and during the visual pass (it would move
    /// Visual -> Judging and launch paid judge seats). A cancel written in
    /// either window must win.
    #[tokio::test]
    async fn a_cancel_during_collect_or_visual_stops_the_chain() {
        use ContestChainStep as C;
        for (at, next) in [(C::Collecting, C::Visual), (C::Visual, C::Judging)] {
            let (_tmp, paths) = arena();
            update_sidecar(&paths, |s| s.chain.step = at).await.unwrap();
            cancel_now(&paths).await;
            let moved = transition_chain(&paths, at, next, None).await.unwrap();
            assert!(!moved, "{at:?} -> {next:?} ran over a cancel");
            let s = arena::read_sidecar(&paths);
            assert_eq!(s.chain.step, C::Failed);
            assert_eq!(s.chain.reason.as_deref(), Some("cancelled"));
        }
        // Uncancelled, the step moves.
        let (_tmp, paths) = arena();
        update_sidecar(&paths, |s| s.chain.step = C::Visual)
            .await
            .unwrap();
        assert!(transition_chain(&paths, C::Visual, C::Ready, None)
            .await
            .unwrap());
        assert_eq!(arena::read_sidecar(&paths).chain.step, C::Ready);
    }

    /// Seats restored by the fleet at boot must get a watcher without anyone
    /// opening the Contest page: the fleet's ticker, which rehydrates and
    /// promotes queued rows, kicks the contest re-attach right after.
    #[test]
    fn the_fleet_ticker_kicks_the_contest_reattach_after_rehydrate() {
        let ticker = include_str!("../fleet/stale.rs");
        let rehydrate = ticker
            .find("super::persist::rehydrate(&app);")
            .expect("the ticker rehydrates");
        let kick = ticker
            .find("crate::commands::contest::driver::kick_reattach(&app);")
            .expect("the ticker kicks the contest re-attach");
        assert!(kick > rehydrate, "the kick runs after the rehydrate");
    }
}
