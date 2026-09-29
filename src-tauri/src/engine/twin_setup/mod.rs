//! The twin setup plan engine (spark `twin-setup-plan`).
//!
//! The guided setup as a planned, persisted interview. Each twin has a plan
//! (goals per code-owned slot, coverage, a queue of questions written ahead),
//! so an answer shows the next question at once while the background worker
//! reconciles it — ASSESS ∥ REFILL on OPUS_5_5 @ low — and a periodic deep
//! pass on OPUS_5_5 @ medium sharpens the plan. Readiness (computed in TS and
//! sent with every call) stays the only completion authority: goal coverage
//! only steers which question comes next.
//!
//! Layout: [`session`] (the six operations — database only, no LLM),
//! [`jobs`] (per-twin single flight + `twin-setup-updated`), [`plan`] (deep
//! pass), [`reconcile`] (assess ∥ refill), [`prompts`], [`parse`] (the three
//! reply doors), [`queue`] (promotion + steering rules), [`skeleton`] (the
//! slots), [`llm`] (the one logged, tiered, time-limited CLI door every twin
//! call goes through).

pub(crate) mod jobs;
pub(crate) mod llm;
pub(crate) mod parse;
pub(crate) mod plan;
pub(crate) mod prompts;
pub(crate) mod queue;
pub(crate) mod reconcile;
pub(crate) mod session;
pub(crate) mod skeleton;

#[cfg(test)]
mod tests;

use crate::db::models::{SetupOpener, SetupReadiness, SetupSessionSnapshot, SetupSteer};
use crate::error::AppError;

pub(crate) use jobs::JobCtx;
use session::Outcome;

/// Run a session operation off the async runtime, then schedule what it wants.
async fn run_op(
    ctx: &JobCtx,
    twin_id: &str,
    op: impl FnOnce(&crate::db::DbPool) -> Result<Outcome, AppError> + Send + 'static,
) -> Result<SetupSessionSnapshot, AppError> {
    let outcome = jobs::db(&ctx.pool, op).await?;
    jobs::schedule(ctx, twin_id, &outcome.wants);
    Ok(outcome.snapshot)
}

pub(crate) async fn open(
    ctx: &JobCtx,
    twin_id: String,
    locale: Option<String>,
    readiness: SetupReadiness,
    opener: Option<SetupOpener>,
) -> Result<SetupSessionSnapshot, AppError> {
    let running = jobs::is_running(&twin_id);
    let id = twin_id.clone();
    run_op(ctx, &twin_id, move |pool| {
        session::open(pool, &id, locale.as_deref(), readiness, opener, running)
    })
    .await
}

pub(crate) async fn answer(
    ctx: &JobCtx,
    twin_id: String,
    step_id: String,
    answer: Option<String>,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    let id = twin_id.clone();
    run_op(ctx, &twin_id, move |pool| {
        session::answer(
            pool,
            &id,
            &step_id,
            answer.as_deref(),
            locale.as_deref(),
            readiness,
        )
    })
    .await
}

pub(crate) async fn steer(
    ctx: &JobCtx,
    twin_id: String,
    steer: SetupSteer,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    let id = twin_id.clone();
    run_op(ctx, &twin_id, move |pool| {
        session::steer(pool, &id, steer, locale.as_deref(), readiness)
    })
    .await
}

pub(crate) async fn offer_verdict(
    ctx: &JobCtx,
    twin_id: String,
    offer_id: String,
    verdict: String,
) -> Result<SetupSessionSnapshot, AppError> {
    let id = twin_id.clone();
    run_op(ctx, &twin_id, move |pool| {
        session::offer_verdict(pool, &id, &offer_id, &verdict)
    })
    .await
}

pub(crate) async fn rebuild(
    ctx: &JobCtx,
    twin_id: String,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    let id = twin_id.clone();
    run_op(ctx, &twin_id, move |pool| {
        session::rebuild(pool, &id, locale.as_deref(), readiness)
    })
    .await
}

pub(crate) async fn get(
    pool: &crate::db::DbPool,
    twin_id: String,
) -> Result<SetupSessionSnapshot, AppError> {
    jobs::db(pool, move |pool| session::get(pool, &twin_id)).await
}
