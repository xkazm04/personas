//! Contest plugin: the in-app home of the /contest method.
//!
//! The arena folders on disk (`<dev_project.root_path>/.contest/arena/<id>/`) are
//! the single truth shared with the CLI skill, and the skill's `contest.mjs`
//! stays the one implementation of the file steps. A contest is keyed by
//! `(projectId, contestId)`.
//!
//! This file is the IPC surface. WP0 committed the wire contract ([`types`]) and
//! these stubs; the behaviour (arena reader, `derive_phase`, the node runner,
//! the seat driver and the autopilot chain) lands in WP2.
//!
//! Every command is `async` because every one of them will do IO (the arena on
//! disk, `node`, the fleet, app settings).
//!
//! No `#[requires(auth)]`: that guard expands to an unconditional `Ok(())`, and
//! census rule `unfalsifiable-tier-guard` counts it as a violation (the IPC
//! session-token wrapper is the real gate). `state` / `app` are not wire
//! parameters, so WP2 adds them where a body needs them without touching the
//! contract.

pub mod types;

use crate::error::AppError;

use types::{
    ContestBriefDraft, ContestCreateRequest, ContestDecision, ContestDetail, ContestEnvironment,
    ContestLineup, ContestReview, ContestSeatKind, ContestStep, ContestSummary,
};

/// The stub error every unbuilt command returns until WP2 lands.
fn not_implemented(command: &str) -> AppError {
    AppError::Internal(format!("{command}: not implemented (WP2)"))
}

/// Every contest across every managed dev project, newest first.
#[tauri::command]
pub async fn contest_list() -> Result<Vec<ContestSummary>, AppError> {
    Ok(vec![])
}

/// One contest in full: seats, variants, scoreboard, review and chain state.
#[tauri::command]
pub async fn contest_get(
    project_id: String,
    contest_id: String,
) -> Result<ContestDetail, AppError> {
    let _ = (project_id, contest_id);
    Err(not_implemented("contest_get"))
}

/// Create a contest arena through `contest.mjs init` (and launch it when
/// `req.launch`).
#[tauri::command]
pub async fn contest_create(req: ContestCreateRequest) -> Result<ContestSummary, AppError> {
    let _ = req;
    Err(not_implemented("contest_create"))
}

/// Queue a contest's seats of `kind` through the fleet. `only` limits the
/// launch to those seat ids (a retry); `None` launches every seat of the kind.
#[tauri::command]
pub async fn contest_launch(
    project_id: String,
    contest_id: String,
    kind: ContestSeatKind,
    only: Option<Vec<String>>,
) -> Result<(), AppError> {
    let _ = (project_id, contest_id, kind, only);
    Err(not_implemented("contest_launch"))
}

/// Cancel a contest's queued and running seats.
#[tauri::command]
pub async fn contest_cancel(project_id: String, contest_id: String) -> Result<(), AppError> {
    let _ = (project_id, contest_id);
    Err(not_implemented("contest_cancel"))
}

/// Persist the owner's review (`review.json`) and re-render `REVIEW.md`.
#[tauri::command]
pub async fn contest_save_review(
    project_id: String,
    contest_id: String,
    review: ContestReview,
) -> Result<(), AppError> {
    let _ = (project_id, contest_id, review);
    Err(not_implemented("contest_save_review"))
}

/// Record the owner's decision. A shortlist returns the refine round's summary.
#[tauri::command]
pub async fn contest_decide(
    project_id: String,
    contest_id: String,
    decision: ContestDecision,
) -> Result<ContestSummary, AppError> {
    let _ = (project_id, contest_id, decision);
    Err(not_implemented("contest_decide"))
}

/// Run (or retry) one autopilot chain step.
#[tauri::command]
pub async fn contest_run_step(
    project_id: String,
    contest_id: String,
    step: ContestStep,
) -> Result<(), AppError> {
    let _ = (project_id, contest_id, step);
    Err(not_implemented("contest_run_step"))
}

/// Probe node, the instrument, the engine CLIs and Playwright for a project.
#[tauri::command]
pub async fn contest_environment(project_id: String) -> Result<ContestEnvironment, AppError> {
    let _ = project_id;
    Err(not_implemented("contest_environment"))
}

/// The saved seat line-ups (app_settings `contest.lineups`).
#[tauri::command]
pub async fn contest_lineups_get() -> Result<Vec<ContestLineup>, AppError> {
    Err(not_implemented("contest_lineups_get"))
}

/// Replace the saved seat line-ups.
#[tauri::command]
pub async fn contest_lineups_set(lineups: Vec<ContestLineup>) -> Result<(), AppError> {
    let _ = lineups;
    Err(not_implemented("contest_lineups_set"))
}

/// Draft a five-section brief from a one-line idea with Athena (experimental).
#[tauri::command]
pub async fn contest_draft_brief(
    project_id: String,
    idea: String,
) -> Result<ContestBriefDraft, AppError> {
    let _ = (project_id, idea);
    Err(not_implemented("contest_draft_brief"))
}
