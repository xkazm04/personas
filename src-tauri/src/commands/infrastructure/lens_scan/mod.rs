//! Lens-scan doors (spark one-control, Stage 2, WP2): Personas as the one point
//! of control for the lens-scan stores of the product repos it manages.
//!
//! READS open `<root>/.ai/lens-scan/scan.db` read-only in place
//! (`personas_db::repos::dev::lens_scan`). WRITES go only through lens-scan's
//! own scripts - `store.mjs decide|triage` here, `drive.mjs` for starts - so the
//! store's transition rules keep exactly one owner. Every command is an adapter:
//! validate, resolve the product, one call, map.
//!
//! Wire types: `personas_core::models::lens_scan` (the snapshot rows are JSON
//! maps by design - see that module). The TypeScript narrowing is
//! `src/api/lensScan.ts`.

mod files;
mod start;
mod tooling;

use std::sync::Arc;

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::db::models::{
    LensScanCommitDiff, LensScanDecideDecision, LensScanDecideResult, LensScanIdentity,
    LensScanProduct, LensScanSnapshot, LensScanStartRequest, LensScanStartResult,
    LensScanTriageDecision, LensScanTriageResult,
};
use crate::db::repos::dev::lens_scan as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

use tooling::{
    clean_note, locate_scripts, require_node, resolve_identity, run_store, store_args, validate_ids,
};

/// Every enabled code project whose root holds a lens-scan store. A store that
/// will not open is listed with `error`, never dropped.
#[tauri::command]
pub async fn lens_scan_products(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<LensScanProduct>, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    run_blocking("lens_scan_products", move || repo::list_products(&db)).await
}

/// `BlueprintData` minus `product`: the map, the events log and the store as
/// bp's wire (store column names, NULL columns omitted).
#[tauri::command]
pub async fn lens_scan_snapshot(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<LensScanSnapshot, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    run_blocking("lens_scan_snapshot", move || {
        repo::read_snapshot(&repo::project_root(&db, &project_id)?)
    })
    .await
}

/// A person's decision on `proposed` items, through `store.mjs decide`. The
/// store's answer passes through, `skipped[]` included.
#[tauri::command]
pub async fn lens_scan_decide(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    ids: Vec<String>,
    decision: LensScanDecideDecision,
    note: Option<String>,
) -> Result<LensScanDecideResult, AppError> {
    require_auth(&state).await?;
    validate_ids(&ids)?;
    let note = clean_note(note.as_deref())?;
    let root = product_root(&state, project_id).await?;
    let scripts = locate_scripts(&root)?;
    require_node().await?;
    let by = resolve_identity().await.by;
    let args = store_args(&ids, decision.as_str(), &by, note.as_deref());
    run_store(&scripts, &root, "decide", &args).await
}

/// A person's call on built items, through `store.mjs triage`
/// (accept, rework, descope, or the v3 `reopen` undo). The store's answer
/// passes through with every `skipped[].reason`.
#[tauri::command]
pub async fn lens_scan_triage(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    ids: Vec<String>,
    decision: LensScanTriageDecision,
    note: Option<String>,
) -> Result<LensScanTriageResult, AppError> {
    require_auth(&state).await?;
    validate_ids(&ids)?;
    let note = clean_note(note.as_deref())?;
    let root = product_root(&state, project_id).await?;
    let scripts = locate_scripts(&root)?;
    require_node().await?;
    let by = resolve_identity().await.by;
    let args = store_args(&ids, decision.as_str(), &by, note.as_deref());
    run_store(&scripts, &root, "triage", &args).await
}

/// Start a build (`execute`) or a coverage run (`measure`) through lens-scan's
/// `drive.mjs`, with its Claude sessions handed to the fleet. Never approves.
#[tauri::command]
pub async fn lens_scan_start(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    request: LensScanStartRequest,
) -> Result<LensScanStartResult, AppError> {
    require_auth(&state).await?;
    let root = product_root(&state, project_id).await?;
    let scripts = locate_scripts(&root)?;
    require_node().await?;
    start::start_drive(&scripts, &root, &request).await
}

/// Who signs a write: `user:<gh login>`, else `user:personas`.
#[tauri::command]
pub async fn lens_scan_identity(
    state: State<'_, Arc<AppState>>,
) -> Result<LensScanIdentity, AppError> {
    require_auth(&state).await?;
    Ok(resolve_identity().await)
}

/// One item commit (message, stat, numstat, patch cut at 2000 lines). The sha
/// must be one a proposal of the product's store carries.
#[tauri::command]
pub async fn lens_scan_commit_diff(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    sha: String,
) -> Result<LensScanCommitDiff, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    run_blocking("lens_scan_commit_diff", move || {
        files::commit_diff(&repo::project_root(&db, &project_id)?, &sha)
    })
    .await
}

/// The bytes of a screenshot or recording under `<store>/shots`, as a raw IPC
/// response (not a JSON number array).
#[tauri::command]
pub async fn lens_scan_shot(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let bytes = run_blocking("lens_scan_shot", move || {
        files::read_shot(&repo::project_root(&db, &project_id)?, &path)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The project's repo root (it must hold a store), resolved off the IPC worker.
async fn product_root(
    state: &State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<std::path::PathBuf, AppError> {
    let db = state.db.clone();
    run_blocking("lens_scan_project", move || {
        repo::project_root(&db, &project_id)
    })
    .await
}

#[cfg(test)]
mod tests;
