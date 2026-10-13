//! **Measured resources** (spark device-mesh, WP1): what every LIVE run is
//! consuming of this machine, and what every FINISHED run consumed.
//!
//! A *run* is a fleet session (`fleet_sessions.id`, its `childPid`) or a
//! persona execution (`persona_executions.id`, the runner's CLI child). Each
//! is sampled over its whole process tree for CPU, RAM and GPU, as shares of
//! this device's capacity ([`crate::db::models::RunResourceSummary`] has the
//! absent-value rules).
//!
//! # The three doors in
//!
//! * [`track_run`] - a run's root process started. Called from the runner's
//!   pid registration and from `FleetRegistry::adopt_spawn`.
//! * [`end_run`] - its root process ended. Called beside the runner's pid
//!   unregistration and from the fleet's `finalize_child_exit`.
//! * Self-healing: a tracked root that is no longer in the process table (or
//!   whose pid now names another process) is ended by the sampler itself, so
//!   a missed end hook cannot leak a run.
//!
//! The hooks are synchronous and non-blocking (one short mutex, one notify)
//! and do nothing until [`spawn_sampler`] has run, so a test or a headless
//! binary that never boots the sampler pays nothing and accumulates nothing.
//!
//! # The sampler
//!
//! ONE task. It wakes every [`SAMPLE_INTERVAL`] only while at least one
//! tracked run is alive; with none it parks on a [`tokio::sync::Notify`]
//! without polling (the reason it is not a `ReactiveSubscription`, whose
//! contract is a poll interval). Each tick is one process-table refresh and
//! one GPU collection ([`probe`]), then it emits
//! [`event_name::FLEET_RESOURCE_SAMPLE`] with every live run's latest sample.
//!
//! When a run ends, its samples summarise ([`summary`]) into one
//! `run_resource_summaries` row - none for a run shorter than one tick - and,
//! when the run served a charter, the profile loop
//! (`personas_engine::responsibility::apply_measured_profile`) folds the
//! measurement back into the charter's resource profile.

pub mod gpu;
pub mod probe;
pub mod summary;
pub mod tree;

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::models::{LiveResourceSample, ResourceAxis, RunKind, RunResourceSummary};
use crate::db::repos::core::attention_ledger::{self, WorkerHandle};
use crate::db::repos::resources::run_resources;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::AppState;

use self::probe::{Probe, ProbeResult, RunProbe};
use self::summary::RunAccumulator;

/// How often a live run is sampled.
pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

type RunKey = (RunKind, String);

/// One tracked run.
#[derive(Debug)]
struct TrackedRun {
    root_pid: u32,
    root_start: Option<u64>,
    persona_id: Option<String>,
    responsibility_id: Option<String>,
    started_at_ms: f64,
    acc: RunAccumulator,
    latest: Option<LiveResourceSample>,
    /// Set by [`end_run`] or the self-heal; finalised on the next pass.
    ended_at_ms: Option<f64>,
}

#[derive(Default)]
struct Runs {
    runs: HashMap<RunKey, TrackedRun>,
}

fn runs() -> &'static Mutex<Runs> {
    static RUNS: OnceLock<Mutex<Runs>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(Runs::default()))
}

fn lock_runs() -> std::sync::MutexGuard<'static, Runs> {
    // A cache of in-flight measurements: a poisoned lock loses at most one
    // tick, so recover rather than panic.
    runs().lock().unwrap_or_else(|e| e.into_inner())
}

fn wake() -> &'static tokio::sync::Notify {
    static WAKE: OnceLock<tokio::sync::Notify> = OnceLock::new();
    WAKE.get_or_init(tokio::sync::Notify::new)
}

/// Set once [`spawn_sampler`] ran; until then the hooks are no-ops.
static SAMPLER_STARTED: AtomicBool = AtomicBool::new(false);

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

// ---------------------------------------------------------------------------
// The doors in
// ---------------------------------------------------------------------------

/// A run's root process started. `pid` `None` (the spawn reported none) is
/// ignored. Tracking a run that is already tracked re-points it at the new
/// root and keeps its samples (a failover respawn is the same run).
pub fn track_run(
    kind: RunKind,
    run_id: &str,
    pid: Option<u32>,
    persona_id: Option<&str>,
    responsibility_id: Option<&str>,
) {
    let Some(pid) = pid else { return };
    if !SAMPLER_STARTED.load(Ordering::Acquire) {
        return;
    }
    {
        let mut guard = lock_runs();
        let run = guard
            .runs
            .entry((kind, run_id.to_string()))
            .or_insert_with(|| TrackedRun {
                root_pid: pid,
                root_start: None,
                persona_id: None,
                responsibility_id: None,
                started_at_ms: now_ms(),
                acc: RunAccumulator::default(),
                latest: None,
                ended_at_ms: None,
            });
        if run.root_pid != pid {
            run.root_pid = pid;
            run.root_start = None;
        }
        run.ended_at_ms = None;
        if let Some(p) = persona_id {
            run.persona_id = Some(p.to_string());
        }
        if let Some(r) = responsibility_id {
            run.responsibility_id = Some(r.to_string());
        }
    }
    wake().notify_one();
}

/// A run's root process ended. Its summary is written on the sampler's next
/// pass (promptly - this wakes it). Unknown runs are ignored.
pub fn end_run(kind: RunKind, run_id: &str) {
    if !SAMPLER_STARTED.load(Ordering::Acquire) {
        return;
    }
    let ended = {
        let mut guard = lock_runs();
        match guard.runs.get_mut(&(kind, run_id.to_string())) {
            Some(run) if run.ended_at_ms.is_none() => {
                run.ended_at_ms = Some(now_ms());
                true
            }
            _ => false,
        }
    };
    if ended {
        wake().notify_one();
    }
}

/// The latest sample of every live run - what the last
/// `fleet-resource-sample` event carried.
pub fn live_samples() -> Vec<LiveResourceSample> {
    let guard = lock_runs();
    let mut out: Vec<LiveResourceSample> = guard
        .runs
        .values()
        .filter(|r| r.ended_at_ms.is_none())
        .filter_map(|r| r.latest.clone())
        .collect();
    out.sort_by(|a, b| a.run_id.cmp(&b.run_id));
    out
}

// ---------------------------------------------------------------------------
// The sampler task
// ---------------------------------------------------------------------------

/// Start the sampler. Idempotent; boot calls it once beside the fleet's
/// staleness ticker.
pub fn spawn_sampler(app: AppHandle) {
    if SAMPLER_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        // Panic boundary: the loop never returns, so an Err here is a crash.
        // It is logged and the loop restarts after one interval - tracked runs
        // and their samples live in the static map, so nothing is lost but
        // the tick that panicked.
        loop {
            let outcome = AssertUnwindSafe(run_sampler(app.clone()))
                .catch_unwind()
                .await;
            if let Err(panic) = outcome {
                tracing::error!(
                    panic = %crate::utils::extract_panic_message(panic),
                    "resources: sampler panicked; restarting"
                );
            }
            tokio::time::sleep(SAMPLE_INTERVAL).await;
        }
    });
}

async fn run_sampler(app: AppHandle) {
    // Built on the first tick (inside the blocking pool), then kept: both the
    // per-process CPU% and the GPU utilisation are rates over the gap between
    // two refreshes of the SAME objects.
    let probe: Arc<Mutex<Option<Probe>>> = Arc::new(Mutex::new(None));
    let mut next_tick = Instant::now();
    loop {
        finalize_ended(&app).await;

        let any_live = lock_runs().runs.values().any(|r| r.ended_at_ms.is_none());
        if !any_live {
            // Park. `notify_one` stores a permit when nobody waits, so a run
            // tracked between the check and this await is never missed.
            wake().notified().await;
            next_tick = Instant::now();
            continue;
        }

        if Instant::now() >= next_tick {
            let outcome = tick(&app, &probe).await;
            if outcome.gone > 0 || outcome.failed {
                tracing::debug!(?outcome, "resources: tick");
            }
            next_tick = Instant::now() + SAMPLE_INTERVAL;
        }

        tokio::select! {
            _ = tokio::time::sleep_until(next_tick.into()) => {}
            _ = wake().notified() => {}
        }
    }
}

/// What one measurement pass did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct TickOutcome {
    /// Runs that got a sample this tick.
    sampled: usize,
    /// Runs whose root was found gone (ended by the self-heal).
    gone: usize,
    /// The probe itself failed (a panic in the blocking pass).
    failed: bool,
}

/// One measurement pass over every live run, then the event.
async fn tick(app: &AppHandle, probe: &Arc<Mutex<Option<Probe>>>) -> TickOutcome {
    let mut outcome = TickOutcome::default();
    let targets: Vec<(RunKey, RunProbe)> = lock_runs()
        .runs
        .iter()
        .filter(|(_, r)| r.ended_at_ms.is_none())
        .map(|(k, r)| {
            (
                k.clone(),
                RunProbe {
                    root_pid: r.root_pid,
                    root_start: r.root_start,
                },
            )
        })
        .collect();
    if targets.is_empty() {
        return outcome;
    }
    let probe = probe.clone();
    let probes: Vec<RunProbe> = targets.iter().map(|(_, p)| p.clone()).collect();
    let results = match tokio::task::spawn_blocking(move || {
        let mut guard = probe.lock().unwrap_or_else(|e| e.into_inner());
        guard.get_or_insert_with(Probe::new).sample(&probes)
    })
    .await
    {
        Ok(r) => r,
        Err(e) => {
            // A panic in one tick costs that tick, never the sampler.
            tracing::error!(error = %e, "resources: sample tick failed");
            outcome.failed = true;
            return outcome;
        }
    };

    // A fleet session's persona is stamped on its registry row AFTER the
    // spawn (`stamp_provenance`), so it is resolved here, outside our lock.
    let fleet_personas: HashMap<String, String> = {
        let unresolved: Vec<String> = {
            let guard = lock_runs();
            targets
                .iter()
                .filter(|((kind, id), _)| {
                    *kind == RunKind::Fleet
                        && guard
                            .runs
                            .get(&(*kind, id.clone()))
                            .is_some_and(|r| r.persona_id.is_none())
                })
                .map(|((_, id), _)| id.clone())
                .collect()
        };
        unresolved
            .into_iter()
            .filter_map(|id| fleet_persona(&id).map(|p| (id, p)))
            .collect()
    };

    let at_ms = now_ms();
    {
        let mut guard = lock_runs();
        for ((key, _), result) in targets.into_iter().zip(results) {
            let Some(run) = guard.runs.get_mut(&key) else {
                continue;
            };
            if run.persona_id.is_none() {
                run.persona_id = fleet_personas.get(&key.1).cloned();
            }
            match result {
                ProbeResult::Gone => {
                    outcome.gone += 1;
                    // Self-heal: the root died without an end hook.
                    if run.ended_at_ms.is_none() {
                        run.ended_at_ms = Some(at_ms);
                    }
                }
                ProbeResult::Sampled {
                    reading,
                    root_start,
                } => {
                    outcome.sampled += 1;
                    run.root_start.get_or_insert(root_start);
                    run.acc.push(reading);
                    run.latest = Some(LiveResourceSample {
                        run_kind: key.0,
                        run_id: key.1.clone(),
                        persona_id: run.persona_id.clone(),
                        cpu_share: reading.cpu,
                        ram_share: reading.ram,
                        gpu_share: reading.gpu,
                        dominant: ResourceAxis::dominant(reading.cpu, reading.ram, reading.gpu),
                        at_ms,
                    });
                }
            }
        }
    }
    emit_live(app);
    outcome
}

fn emit_live(app: &AppHandle) {
    let samples = live_samples();
    if let Err(e) = app.emit(event_name::FLEET_RESOURCE_SAMPLE, &samples) {
        tracing::debug!(error = %e, "resources: sample emit failed");
    }
}

fn fleet_persona(session_id: &str) -> Option<String> {
    crate::commands::fleet::registry::registry()
        .dto_of(session_id)
        .and_then(|s| s.persona_id)
}

/// A finished run on its way to the database.
struct EndedRun {
    kind: RunKind,
    run_id: String,
    persona_id: Option<String>,
    responsibility_id: Option<String>,
    started_at_ms: f64,
    ended_at_ms: f64,
    acc: RunAccumulator,
}

/// Take every ended run out of the tracker and write its summary.
async fn finalize_ended(app: &AppHandle) {
    let ended: Vec<EndedRun> = {
        let mut guard = lock_runs();
        let keys: Vec<RunKey> = guard
            .runs
            .iter()
            .filter(|(_, r)| r.ended_at_ms.is_some())
            .map(|(k, _)| k.clone())
            .collect();
        keys.into_iter()
            .filter_map(|k| {
                let r = guard.runs.remove(&k)?;
                Some(EndedRun {
                    kind: k.0,
                    run_id: k.1,
                    persona_id: r.persona_id,
                    responsibility_id: r.responsibility_id,
                    started_at_ms: r.started_at_ms,
                    ended_at_ms: r.ended_at_ms.unwrap_or_else(now_ms),
                    acc: r.acc,
                })
            })
            .collect()
    };
    if ended.is_empty() {
        return;
    }
    // The ended runs left the live set; tell listeners even if nothing below
    // writes (a run shorter than one tick has no row).
    emit_live(app);
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        tracing::warn!(
            runs = ended.len(),
            "resources: no database yet; summaries dropped"
        );
        return;
    };
    let pool = state.db.clone();
    let fleet_personas: Vec<Option<String>> = ended
        .iter()
        .map(|r| match (r.kind, &r.persona_id) {
            (RunKind::Fleet, None) => fleet_persona(&r.run_id),
            _ => None,
        })
        .collect();
    let written = tokio::task::spawn_blocking(move || {
        for (mut run, persona) in ended.into_iter().zip(fleet_personas) {
            if run.persona_id.is_none() {
                run.persona_id = persona;
            }
            finalize(&pool, run);
        }
    })
    .await;
    if let Err(e) = written {
        tracing::error!(error = %e, "resources: summary write task failed");
    }
}

/// Summarise one run, charge it to its charter, write it, and run the profile
/// loop when the row is new. Blocking.
fn finalize(pool: &DbPool, run: EndedRun) {
    let Some(mut summary) = run.acc.summarize(
        run.kind,
        &run.run_id,
        run.persona_id,
        run.responsibility_id,
        run.started_at_ms,
        run.ended_at_ms,
    ) else {
        return;
    };
    attribute(pool, &mut summary);
    match run_resources::insert(pool, &summary) {
        Ok(true) => {
            if let Some(charter) = summary.responsibility_id.as_deref() {
                match personas_engine::responsibility::apply_measured_profile(pool, charter) {
                    Ok(outcome) => tracing::debug!(
                        responsibility_id = charter,
                        ?outcome,
                        "resources: profile loop"
                    ),
                    Err(e) => tracing::warn!(
                        responsibility_id = charter,
                        error = %e,
                        "resources: profile loop failed"
                    ),
                }
            }
        }
        Ok(false) => {}
        Err(e) => tracing::warn!(
            run_kind = run.kind.as_str(),
            run_id = %summary.run_id,
            error = %e,
            "resources: summary write failed"
        ),
    }
}

/// Charge a run to the charter that dispatched it when the start hook could
/// not say (a fleet session never carries one; an execution carries one only
/// when its input named `_responsibility`): the attention pass that
/// dispatched the worker names both the persona and the charter.
fn attribute(pool: &DbPool, summary: &mut RunResourceSummary) {
    if summary.responsibility_id.is_some() {
        return;
    }
    let handle = match summary.run_kind {
        RunKind::Fleet => WorkerHandle::FleetSession,
        RunKind::Execution => WorkerHandle::Execution,
    };
    match attention_ledger::charter_for_worker(pool, handle, &summary.run_id) {
        Ok(Some((persona_id, responsibility_id))) => {
            summary.persona_id.get_or_insert(persona_id);
            summary.responsibility_id = Some(responsibility_id);
        }
        Ok(None) => {}
        Err(e) => tracing::debug!(error = %e, "resources: charter lookup failed"),
    }
}
