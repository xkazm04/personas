//! Twin learn-from-sample - the command surface (spark `twin-portable-blueprint`).
//!
//! A sample is the user's OWN writing (a highlighted selection, the clipboard,
//! or a sample the forge hands over when a twin is created from one).
//! `twin_learn_from_sample` stores it and returns at once with status
//! `analyzing`; a single-flight background job per twin analyses it and
//! announces itself with `twin-sample-updated`
//! (`event_name::TWIN_SAMPLE_UPDATED`, payload `TwinSampleUpdatedEvent`). The
//! result is PROPOSALS, resolved through `twin_sample_resolve`; nothing writes
//! a tone field before that (census `model-output-persisted-without-preview`).
//!
//! Each command is a thin adapter over `engine::twin_sample`, which owns the
//! validation, the lane, the analysis and the accept door. Wire names and
//! parameter names are frozen with `src/api/twin/twinSample.ts`; the
//! `AppHandle` some commands take is injected by Tauri and is not on the wire.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db::models::{TwinSample, TwinSampleProposal};
use crate::engine::twin_sample::{self as engine, SampleCtx};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

fn ctx(app: &AppHandle, state: &AppState) -> SampleCtx {
    SampleCtx::for_app(app, state.db.clone())
}

/// Store a sample and start its analysis. Returns the row with status
/// `analyzing`. `source_kind` is `selection` | `clipboard` | `forge`.
#[tauri::command]
pub async fn twin_learn_from_sample(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    text: String,
    source_kind: String,
    source_host: Option<String>,
) -> Result<TwinSample, AppError> {
    require_auth(&state).await?;
    engine::learn(&ctx(&app, &state), twin_id, text, source_kind, source_host).await
}

/// The twin's samples, newest first. A sample a restart left `analyzing` has
/// its analysis started again.
#[tauri::command]
pub async fn twin_sample_list(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<Vec<TwinSample>, AppError> {
    require_auth(&state).await?;
    engine::list(&ctx(&app, &state), twin_id).await
}

/// The twin's sample proposals, optionally filtered by `status`
/// (`open` | `accepted` | `edited` | `dismissed`), newest first.
#[tauri::command]
pub async fn twin_sample_proposals(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    status: Option<String>,
) -> Result<Vec<TwinSampleProposal>, AppError> {
    require_auth(&state).await?;
    engine::proposals(&state.db, twin_id, status).await
}

/// Accept or dismiss one proposal. `verdict` is `accept` | `dismiss`; an
/// accept with `edited_value` writes that value instead and records `edited`.
#[tauri::command]
pub async fn twin_sample_resolve(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    proposal_id: String,
    verdict: String,
    edited_value: Option<String>,
) -> Result<TwinSampleProposal, AppError> {
    require_auth(&state).await?;
    engine::resolve(&ctx(&app, &state), proposal_id, verdict, edited_value).await
}

/// The OS clipboard's text, read once because the user pressed Learn (never
/// polled). Capped like a selection; `None` when the clipboard holds no text.
/// Registered on every build; a build without an OS clipboard answers `None`.
#[tauri::command]
pub async fn twin_clipboard_text(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, AppError> {
    require_auth(&state).await?;
    engine::clipboard_text().await
}
