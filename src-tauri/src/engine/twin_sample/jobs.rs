//! Per-twin sample analysis, single-flight (the setup engine's lane shape,
//! `engine::twin_setup::jobs`).
//!
//! One in-process registry entry per twin holds a want and whether its lane
//! is alive. [`schedule`] sets the want and starts the lane only when none is
//! running; a running lane LOOPS while wants keep arriving, so a sample stored
//! mid-run is picked up by the lane already running. Nothing schedules itself:
//! an idle twin costs zero spawns.
//!
//! The work list is durable: a lane drains every `analyzing` sample of its
//! twin from the database, oldest first, so a sample left `analyzing` by a
//! restart is analysed the next time the twin's lane runs. Each sample runs
//! under `catch_unwind`; a failure the analysis could not record itself (a
//! database error, a panic) is recorded here as `failed`, a durable write, so
//! no sample sits `analyzing` behind a lane that died.

use std::collections::{HashMap, HashSet};
use std::panic::AssertUnwindSafe;
use std::sync::{Mutex, MutexGuard, OnceLock};

use futures_util::FutureExt;

use crate::db::repos::twin_sample as repo;
use crate::engine::twin_setup::jobs::db;

use super::SampleCtx;

/// The reason a sample carries when its analysis panicked.
const PANIC_REASON: &str = "The analysis stopped unexpectedly.";

#[derive(Debug, Default)]
struct LaneFlags {
    running: bool,
    wanted: bool,
}

fn registry() -> MutexGuard<'static, HashMap<String, LaneFlags>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, LaneFlags>>> = OnceLock::new();
    // A poisoned registry is a cache of flags, not an invariant: recover it.
    REGISTRY
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Whether the twin's lane is alive in this process.
pub(crate) fn is_running(twin_id: &str) -> bool {
    registry().get(twin_id).is_some_and(|f| f.running)
}

/// Want the twin's `analyzing` samples analysed, starting its lane when it is
/// idle. Returns the lane's handle when this call started one: production
/// lets it go (the lane reports through durable writes and events), tests
/// await it.
pub(crate) fn schedule(
    ctx: &SampleCtx,
    twin_id: &str,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let start = {
        let mut reg = registry();
        let flags = reg.entry(twin_id.to_string()).or_default();
        flags.wanted = true;
        let start = !flags.running;
        flags.running = true;
        start
    };
    start.then(|| tauri::async_runtime::spawn(lane(ctx.clone(), twin_id.to_string())))
}

/// Take the want; `false` (and `running = false`, under the same lock) when
/// there is none, so a want set after this returns starts a new lane.
fn take_want(twin_id: &str) -> bool {
    let mut reg = registry();
    let flags = reg.entry(twin_id.to_string()).or_default();
    if flags.wanted {
        flags.wanted = false;
        true
    } else {
        flags.running = false;
        false
    }
}

async fn lane(ctx: SampleCtx, twin_id: String) {
    while take_want(&twin_id) {
        // Each sample is tried once per want: one the analysis could not move
        // out of `analyzing` must not spin the lane.
        let mut tried: HashSet<String> = HashSet::new();
        loop {
            let id = twin_id.clone();
            let pending = match db(&ctx.pool, move |pool| repo::analyzing_ids(pool, &id)).await {
                Ok(ids) => ids,
                Err(e) => {
                    tracing::warn!(twin_id = %twin_id, error = %e, "twin sample lane: could not read the work list");
                    break;
                }
            };
            let next: Vec<String> = pending
                .into_iter()
                .filter(|id| !tried.contains(id))
                .collect();
            if next.is_empty() {
                break;
            }
            for sample_id in next {
                tried.insert(sample_id.clone());
                run_one(&ctx, &twin_id, &sample_id).await;
            }
        }
    }
}

/// One sample under `catch_unwind`. A failure or a panic the analysis did not
/// record is recorded as `failed` (durable) and announced.
async fn run_one(ctx: &SampleCtx, twin_id: &str, sample_id: &str) {
    let outcome = AssertUnwindSafe(super::analyze::run(ctx, sample_id))
        .catch_unwind()
        .await;
    let reason = match outcome {
        Ok(Ok(())) => return,
        Ok(Err(e)) => {
            tracing::warn!(twin_id = %twin_id, sample_id = %sample_id, error = %e, "twin sample analysis failed");
            format!("The analysis could not be saved: {e}")
        }
        Err(panic) => {
            let message = panic
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".to_string());
            tracing::warn!(twin_id = %twin_id, sample_id = %sample_id, %message, "twin sample analysis panicked");
            PANIC_REASON.to_string()
        }
    };
    let id = sample_id.to_string();
    let recorded = db(&ctx.pool, move |pool| {
        repo::settle_sample(pool, &id, repo::STATUS_FAILED, &reason)
    })
    .await;
    match recorded {
        Ok(true) => ctx.announce(twin_id, sample_id, repo::STATUS_FAILED, 0),
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(twin_id = %twin_id, sample_id = %sample_id, error = %e, "twin sample: could not record the failure");
        }
    }
}
