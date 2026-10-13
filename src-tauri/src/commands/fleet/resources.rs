//! Tauri commands for measured resources: what each live run is consuming now,
//! and what finished runs consumed (CPU / RAM / GPU as shares of this device).
//!
//! The sampler, the process-tree sum and the GPU-engine read live in
//! `engine::resources`; the persisted summaries in `run_resource_summaries`.
//!
//! WP0 (contract freeze): stubs with the final signatures. The bodies land in
//! spark device-mesh WP1.

use tauri::State;

use crate::db::models::{LiveResourceSample, RunResourceSummary};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The latest sample of every LIVE run (fleet sessions and persona
/// executions). The same payload the `fleet-resource-sample` event carries;
/// this read is the poll-recovery path for a listener that mounted late.
#[tauri::command]
pub async fn resource_live_samples(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<LiveResourceSample>, AppError> {
    require_auth(&state).await?;
    Ok(Vec::new())
}

/// A persona's finished-run summaries, newest first (at most `limit`, default
/// 50, capped at 500).
#[tauri::command]
pub async fn resource_run_summaries(
    state: State<'_, std::sync::Arc<AppState>>,
    persona_id: String,
    limit: Option<u32>,
) -> Result<Vec<RunResourceSummary>, AppError> {
    require_auth(&state).await?;
    let _ = (persona_id, limit);
    Ok(Vec::new())
}
