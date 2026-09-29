//! Per-twin single flight for the background work.
//!
//! One in-process registry entry per twin holds three wants (plan, reconcile,
//! refill) and whether a worker runs. [`schedule`] sets a want and starts a
//! worker only when none runs; the worker LOOPS until no want is left — the
//! deep pass first and alone, else reconcile (assess ∥ refill), else refill —
//! so answers arriving mid-job are picked up by the job already running, and
//! a reconcile never overlaps a deep pass for the same twin. Nothing
//! schedules itself: an idle twin costs zero spawns.
//!
//! Each phase runs under `catch_unwind`: a panic is logged and the loop moves
//! on (its want was already taken), and a panicking deep pass is recorded as
//! a failed plan — a durable write, so the plan never sits in `building`.

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use futures_util::FutureExt;
use tauri::AppHandle;

use crate::db::models::SetupUpdatedEvent;
use crate::db::repos::twin_setup as repo;
use crate::db::DbPool;
use crate::engine::event_registry::{emit_event, event_name};
use crate::error::AppError;

use super::llm::{real_llm, LlmFn};
use super::session::Want;

/// How a job announces a change (`twin-setup-updated`).
pub(crate) type EmitFn = Arc<dyn Fn(SetupUpdatedEvent) + Send + Sync>;

/// Everything a job needs, cheap to clone.
#[derive(Clone)]
pub(crate) struct JobCtx {
    pub pool: DbPool,
    pub llm: LlmFn,
    pub emit: EmitFn,
}

impl JobCtx {
    /// The production context: the real CLI and the app's event bus.
    pub(crate) fn for_app(app: &AppHandle, pool: DbPool) -> Self {
        let app = app.clone();
        Self {
            pool,
            llm: real_llm(),
            emit: Arc::new(move |event: SetupUpdatedEvent| {
                emit_event(&app, event_name::TWIN_SETUP_UPDATED, &event);
            }),
        }
    }

    pub(crate) fn announce(&self, twin_id: &str, reason: &str, plan_version: i64) {
        (self.emit)(SetupUpdatedEvent {
            twin_id: twin_id.to_string(),
            reason: reason.to_string(),
            plan_version,
        });
    }
}

#[derive(Debug, Default)]
struct JobFlags {
    running: bool,
    want_plan: bool,
    want_reconcile: bool,
    want_refill: bool,
    /// Consecutive refill failures; two in a row escalate to a deep pass.
    refill_failures: u32,
    /// The operator's own words for a custom training topic. There is no
    /// column for it (the plan row stores only `topic_preset`), so it lives
    /// for the process, like the rest of this registry.
    topic_prompt: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Plan,
    Reconcile,
    Refill,
}

fn registry() -> MutexGuard<'static, HashMap<String, JobFlags>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, JobFlags>>> = OnceLock::new();
    // A poisoned registry is a cache of flags, not an invariant: recover it.
    REGISTRY
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Whether a worker is alive for `twin_id` in this process.
pub(crate) fn is_running(twin_id: &str) -> bool {
    registry().get(twin_id).is_some_and(|f| f.running)
}

pub(crate) fn set_topic_prompt(twin_id: &str, prompt: Option<String>) {
    registry()
        .entry(twin_id.to_string())
        .or_default()
        .topic_prompt = prompt;
}

pub(crate) fn topic_prompt(twin_id: &str) -> Option<String> {
    registry().get(twin_id).and_then(|f| f.topic_prompt.clone())
}

/// Record a refill outcome. Returns `true` when this failure was the second
/// in a row and a deep pass has been wanted instead.
pub(crate) fn note_refill(twin_id: &str, ok: bool) -> bool {
    let mut reg = registry();
    let flags = reg.entry(twin_id.to_string()).or_default();
    if ok {
        flags.refill_failures = 0;
        return false;
    }
    flags.refill_failures += 1;
    if flags.refill_failures >= 2 {
        flags.refill_failures = 0;
        flags.want_plan = true;
        return true;
    }
    false
}

/// Want `wants` for `twin_id`, starting a worker if none runs. Returns the
/// new worker's handle, or `None` when an existing worker will pick the wants
/// up (or there were none). Production callers let the handle go — the
/// worker reports through its durable writes and events; tests await it.
pub(crate) fn schedule(
    ctx: &JobCtx,
    twin_id: &str,
    wants: &[Want],
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    if wants.is_empty() {
        return None;
    }
    {
        let mut reg = registry();
        let flags = reg.entry(twin_id.to_string()).or_default();
        for want in wants {
            match want {
                Want::Plan => flags.want_plan = true,
                Want::Reconcile => flags.want_reconcile = true,
                Want::Refill => flags.want_refill = true,
            }
        }
        if flags.running {
            return None;
        }
        flags.running = true;
    }
    let ctx = ctx.clone();
    let twin_id = twin_id.to_string();
    Some(tauri::async_runtime::spawn(worker(ctx, twin_id)))
}

/// Take the next phase, clearing its want; `None` (and `running = false`,
/// under the same lock) when nothing is left.
fn next_phase(twin_id: &str) -> Option<Phase> {
    let mut reg = registry();
    let flags = reg.entry(twin_id.to_string()).or_default();
    if flags.want_plan {
        flags.want_plan = false;
        Some(Phase::Plan)
    } else if flags.want_reconcile {
        // A reconcile runs its own refill.
        flags.want_reconcile = false;
        flags.want_refill = false;
        Some(Phase::Reconcile)
    } else if flags.want_refill {
        flags.want_refill = false;
        Some(Phase::Refill)
    } else {
        flags.running = false;
        None
    }
}

async fn worker(ctx: JobCtx, twin_id: String) {
    while let Some(phase) = next_phase(&twin_id) {
        let run = async {
            match phase {
                Phase::Plan => super::plan::run(&ctx, &twin_id).await,
                Phase::Reconcile => super::reconcile::run(&ctx, &twin_id).await,
                Phase::Refill => super::reconcile::refill_only(&ctx, &twin_id).await,
            }
        };
        match AssertUnwindSafe(run).catch_unwind().await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                tracing::warn!(twin_id = %twin_id, ?phase, error = %e, "twin setup job failed");
            }
            Err(panic) => {
                let message = panic
                    .downcast_ref::<&str>()
                    .map(|s| (*s).to_string())
                    .or_else(|| panic.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "unknown panic".to_string());
                tracing::warn!(twin_id = %twin_id, ?phase, %message, "twin setup job panicked");
                if phase == Phase::Plan {
                    let pool = ctx.pool.clone();
                    let id = twin_id.clone();
                    let _ = db(&pool, move |pool| {
                        let conn = pool.get()?;
                        repo::fail_plan_on(&conn, &id, "The planner stopped unexpectedly.")
                    })
                    .await;
                    ctx.announce(&twin_id, "plan_failed", 0);
                }
            }
        }
    }
}

/// Run blocking database work off the async runtime.
pub(crate) async fn db<T, F>(pool: &DbPool, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&DbPool) -> Result<T, AppError> + Send + 'static,
{
    let pool = pool.clone();
    match tokio::task::spawn_blocking(move || f(&pool)).await {
        Ok(result) => result,
        Err(e) => Err(AppError::Internal(format!("twin setup db task: {e}"))),
    }
}

/// One LLM call with ONE repair retry told what the door rejected. `Err` is
/// a short reason (spawn failure, timeout, or two unusable replies).
pub(crate) async fn call_with_repair<T>(
    ctx: &JobCtx,
    call: super::llm::TwinCall,
    build: impl Fn(Option<&str>) -> String,
    door: impl Fn(&str) -> Result<T, String>,
) -> Result<T, String> {
    let raw = (ctx.llm)(ctx.pool.clone(), call, build(None))
        .await
        .map_err(|e| e.to_string())?;
    let first = match door(&raw) {
        Ok(value) => return Ok(value),
        Err(e) => e,
    };
    let repaired = (ctx.llm)(ctx.pool.clone(), call, build(Some(&first)))
        .await
        .map_err(|e| e.to_string())?;
    door(&repaired).map_err(|second| format!("unusable output twice ({first}; then {second})"))
}
