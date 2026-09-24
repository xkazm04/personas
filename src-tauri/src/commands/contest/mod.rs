//! Contest plugin: the in-app home of the /contest method.
//!
//! The arena folders on disk (`<dev_project.root_path>/.contest/arena/<id>/`) are
//! the single truth shared with the CLI skill, and the skill's `contest.mjs`
//! stays the one implementation of the file steps. A contest is keyed by
//! `(projectId, contestId)`.
//!
//! This file is the IPC surface; every command validates, makes one call into
//! the module that owns the behaviour, and maps the result:
//! - [`arena`] — the file reader, the app sidecar and `derive_phase`
//! - [`node`] — the instrument runner and its lookups
//! - [`driver`] — seat launch / watch / record, the autopilot chain, re-attach
//! - [`review`], [`decide`], [`create`], [`env`], [`lineups`], [`draft`], [`view`]
//! - [`preview`] — the loopback preview route (security-sensitive; see its header)
//!
//! No `#[requires(auth)]`: that guard expands to an unconditional `Ok(())`, and
//! census rule `unfalsifiable-tier-guard` counts it as a violation (the IPC
//! session-token wrapper is the real gate).

pub mod arena;
pub mod create;
pub mod decide;
pub mod draft;
pub mod driver;
pub mod env;
pub mod lineups;
pub mod node;
pub mod preview;
pub mod record;
pub mod review;
pub mod types;
pub mod view;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::AppState;

use types::{
    ContestBriefDraft, ContestCreateRequest, ContestDecision, ContestDetail, ContestEnvironment,
    ContestLineup, ContestReview, ContestSeatKind, ContestStep, ContestSummary,
};

/// Run blocking file/DB work off the IPC worker. The JoinHandle is awaited
/// here and a panic is reported as what it is, never flattened into a
/// generic failure.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) if e.is_panic() => Err(AppError::Internal(
            "contest: the file read panicked; see the log".into(),
        )),
        Err(e) => Err(AppError::Internal(format!("contest: task cancelled: {e}"))),
    }
}

/// Every contest across every managed dev project, newest first.
#[tauri::command]
pub async fn contest_list(app: AppHandle) -> Result<Vec<ContestSummary>, AppError> {
    driver::ensure_reattached(&app).await;
    let db = driver::db_of(&app)?;
    blocking(move || view::list(&db)).await
}

/// One contest in full: seats, variants, scoreboard, review and chain state.
#[tauri::command]
pub async fn contest_get(
    app: AppHandle,
    project_id: String,
    contest_id: String,
) -> Result<ContestDetail, AppError> {
    driver::ensure_reattached(&app).await;
    let db = driver::db_of(&app)?;
    blocking(move || view::detail(&db, &project_id, &contest_id)).await
}

/// Create a contest arena through `contest.mjs init` (and launch it when
/// `req.launch`).
#[tauri::command]
pub async fn contest_create(
    app: AppHandle,
    req: ContestCreateRequest,
) -> Result<ContestSummary, AppError> {
    let ctx = create::create(&app, req).await?;
    view::summary(&driver::db_of(&app)?, &ctx.project_id, ctx.contest_id())
}

/// Queue a contest's seats of `kind` through the fleet. `only` limits the
/// launch to those seat ids (a retry); `None` launches every seat of the kind.
#[tauri::command]
pub async fn contest_launch(
    app: AppHandle,
    project_id: String,
    contest_id: String,
    kind: ContestSeatKind,
    only: Option<Vec<String>>,
) -> Result<(), AppError> {
    let ctx = driver::ctx(&driver::db_of(&app)?, &project_id, &contest_id)?;
    driver::launch_seats(&app, &ctx, kind, only)
        .await
        .map(|_| ())
}

/// Cancel a contest's queued and running seats.
#[tauri::command]
pub async fn contest_cancel(
    app: AppHandle,
    project_id: String,
    contest_id: String,
) -> Result<(), AppError> {
    let ctx = driver::ctx(&driver::db_of(&app)?, &project_id, &contest_id)?;
    driver::cancel(&app, &ctx).await
}

/// Persist the owner's review (`review.json`) and re-render `REVIEW.md`.
#[tauri::command]
pub async fn contest_save_review(
    app: AppHandle,
    project_id: String,
    contest_id: String,
    review: ContestReview,
) -> Result<(), AppError> {
    let ctx = driver::ctx(&driver::db_of(&app)?, &project_id, &contest_id)?;
    review::save_review(&ctx.paths, &review)?;
    driver::emit_changed(&app, &project_id, &contest_id);
    Ok(())
}

/// Record the owner's decision. A shortlist returns the refine round's summary.
#[tauri::command]
pub async fn contest_decide(
    app: AppHandle,
    project_id: String,
    contest_id: String,
    decision: ContestDecision,
) -> Result<ContestSummary, AppError> {
    let db = driver::db_of(&app)?;
    let ctx = driver::ctx(&db, &project_id, &contest_id)?;
    let shown = decide::decide(&app, &ctx, decision).await?;
    view::summary(&db, &shown.project_id, shown.contest_id())
}

/// Run (or retry) one autopilot chain step.
#[tauri::command]
pub async fn contest_run_step(
    app: AppHandle,
    project_id: String,
    contest_id: String,
    step: ContestStep,
) -> Result<(), AppError> {
    let ctx = driver::ctx(&driver::db_of(&app)?, &project_id, &contest_id)?;
    driver::run_step(&app, &ctx, step).await
}

/// Probe node, the instrument, the engine CLIs and Playwright for a project.
#[tauri::command]
pub async fn contest_environment(
    app: AppHandle,
    project_id: String,
) -> Result<ContestEnvironment, AppError> {
    let db = driver::db_of(&app)?;
    let project = driver::project(&db, &project_id)?;
    Ok(env::probe(&db, &PathBuf::from(project.root_path)).await)
}

/// The saved seat line-ups (app_settings `contest.lineups`).
#[tauri::command]
pub async fn contest_lineups_get(app: AppHandle) -> Result<Vec<ContestLineup>, AppError> {
    let db = driver::db_of(&app)?;
    blocking(move || lineups::get(&db)).await
}

/// Replace the saved seat line-ups.
#[tauri::command]
pub async fn contest_lineups_set(
    app: AppHandle,
    lineups: Vec<ContestLineup>,
) -> Result<(), AppError> {
    let db = driver::db_of(&app)?;
    blocking(move || lineups::set(&db, lineups)).await
}

/// Draft a five-section brief from a one-line idea with Athena (experimental).
#[tauri::command]
pub async fn contest_draft_brief(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    idea: String,
) -> Result<ContestBriefDraft, AppError> {
    let project = driver::project(&state.db, &project_id)?;
    let brief = draft::draft(&state.user_db, &PathBuf::from(project.root_path), &idea).await?;
    Ok(ContestBriefDraft { brief })
}
