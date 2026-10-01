//! Per-twin background work, in two single-flight lanes.
//!
//! One in-process registry entry per twin holds four wants (plan, first
//! question, reconcile, refill) and which lane is alive. The DEEP PASS has a
//! lane of its own; the QUESTION lane runs everything that puts the next
//! question in front of the person or folds an answer in: the first question,
//! else reconcile (assess ∥ refill, each applied the moment it returns), else
//! refill. The two lanes run side by side, so nothing the person waits on is
//! held behind a ~30 s deep pass any more (until 2026-10-01 it ran first and
//! alone, and every 5th answer and every stage switch waited it out).
//!
//! [`schedule`] sets wants and starts a lane only when that lane is idle and
//! has work; a running lane LOOPS until its wants are gone, so wants arriving
//! mid-job are picked up by the job already running. Nothing schedules
//! itself: an idle twin costs zero spawns.
//!
//! The lanes write the same rows, but every write is one IMMEDIATE
//! transaction, so SQLite serializes them, and the one-live-step rule is held
//! by `queue::ensure_live` inside each (the partial unique index on `live`
//! backs it). A question written against the old plan may be retired by the
//! plan that lands after it: an accepted risk, cheaper than the wait.
//!
//! Each phase runs under `catch_unwind`: a panic is logged and the lane moves
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
    /// The deep-pass lane is alive.
    plan_running: bool,
    /// The question lane (first question, reconcile, refill) is alive.
    questions_running: bool,
    want_plan: bool,
    want_first: bool,
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
    First,
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

/// Whether any lane is alive for `twin_id` in this process (tests: "idle").
#[cfg(test)]
pub(crate) fn is_running(twin_id: &str) -> bool {
    registry()
        .get(twin_id)
        .is_some_and(|f| f.plan_running || f.questions_running)
}

/// Whether the deep-pass lane is alive for `twin_id` in this process. A
/// `building` plan without one was orphaned (a restart) and is rebuilt.
pub(crate) fn plan_running(twin_id: &str) -> bool {
    registry().get(twin_id).is_some_and(|f| f.plan_running)
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
/// in a row and a deep pass should take over; the caller schedules it (the
/// deep pass has its own lane, which a flag alone would not start). A deep
/// pass already running or wanted is rewriting the path anyway, so it
/// absorbs the escalation instead of queueing a second one.
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
        return !(flags.plan_running || flags.want_plan);
    }
    false
}

/// The lanes one [`schedule`] call started. Production lets them go: each
/// lane reports through its durable writes and events. Tests await them.
#[derive(Default)]
pub(crate) struct Started {
    // Read only by tests; production drops the handles on purpose.
    #[cfg_attr(not(test), allow(dead_code))]
    pub plan: Option<tauri::async_runtime::JoinHandle<()>>,
    #[cfg_attr(not(test), allow(dead_code))]
    pub questions: Option<tauri::async_runtime::JoinHandle<()>>,
}

/// Want `wants` for `twin_id`, starting each lane that is idle and now has
/// work. A lane already running picks the new wants up itself.
pub(crate) fn schedule(ctx: &JobCtx, twin_id: &str, wants: &[Want]) -> Started {
    let (start_plan, start_questions) = {
        let mut reg = registry();
        let flags = reg.entry(twin_id.to_string()).or_default();
        for want in wants {
            match want {
                Want::Plan => flags.want_plan = true,
                Want::First => flags.want_first = true,
                Want::Reconcile => flags.want_reconcile = true,
                Want::Refill => flags.want_refill = true,
            }
        }
        let start_plan = flags.want_plan && !flags.plan_running;
        let start_questions = (flags.want_first || flags.want_reconcile || flags.want_refill)
            && !flags.questions_running;
        flags.plan_running |= start_plan;
        flags.questions_running |= start_questions;
        (start_plan, start_questions)
    };
    Started {
        plan: start_plan
            .then(|| tauri::async_runtime::spawn(plan_lane(ctx.clone(), twin_id.to_string()))),
        questions: start_questions
            .then(|| tauri::async_runtime::spawn(question_lane(ctx.clone(), twin_id.to_string()))),
    }
}

/// Take the deep-pass want; `false` (and `plan_running = false`, under the
/// same lock) when there is none.
fn next_plan(twin_id: &str) -> bool {
    let mut reg = registry();
    let flags = reg.entry(twin_id.to_string()).or_default();
    if flags.want_plan {
        flags.want_plan = false;
        true
    } else {
        flags.plan_running = false;
        false
    }
}

/// Take the question lane's next phase, clearing its want; `None` (and
/// `questions_running = false`, under the same lock) when nothing is left.
/// The first question goes before a reconcile: it is the one thing the person
/// is waiting on, and it takes one short call.
fn next_question_phase(twin_id: &str) -> Option<Phase> {
    let mut reg = registry();
    let flags = reg.entry(twin_id.to_string()).or_default();
    if flags.want_first {
        flags.want_first = false;
        Some(Phase::First)
    } else if flags.want_reconcile {
        // A reconcile runs its own refill.
        flags.want_reconcile = false;
        flags.want_refill = false;
        Some(Phase::Reconcile)
    } else if flags.want_refill {
        flags.want_refill = false;
        Some(Phase::Refill)
    } else {
        flags.questions_running = false;
        None
    }
}

async fn plan_lane(ctx: JobCtx, twin_id: String) {
    while next_plan(&twin_id) {
        run_phase(&ctx, &twin_id, Phase::Plan).await;
    }
}

async fn question_lane(ctx: JobCtx, twin_id: String) {
    while let Some(phase) = next_question_phase(&twin_id) {
        run_phase(&ctx, &twin_id, phase).await;
    }
}

/// One phase under `catch_unwind`. A failure is logged; a panicking deep pass
/// is also recorded as a failed plan (durable), so it never sits `building`.
async fn run_phase(ctx: &JobCtx, twin_id: &str, phase: Phase) {
    let run = async {
        match phase {
            Phase::Plan => super::plan::run(ctx, twin_id).await,
            Phase::First => super::reconcile::first_question(ctx, twin_id).await,
            Phase::Reconcile => super::reconcile::run(ctx, twin_id).await,
            Phase::Refill => super::reconcile::refill_only(ctx, twin_id).await,
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
                let id = twin_id.to_string();
                let _ = db(&pool, move |pool| {
                    let conn = pool.get()?;
                    repo::fail_plan_on(&conn, &id, "The planner stopped unexpectedly.")
                })
                .await;
                ctx.announce(twin_id, "plan_failed", 0);
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
