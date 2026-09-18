//! Twin style studio (spark `twin-presets`).
//!
//! A communication style is 8 dimensions on a 1-5 scale ([`TwinStyleDims`]).
//! Ten curated presets live in the TS catalog; this module owns the other half:
//!
//! - `twin_style_roll` draws 3 spread, coherent anchor vectors in Rust (an LLM
//!   asked for randomness collapses to a mode), lets the model nudge each
//!   non-pinned dimension by at most 1, name it and write a sample reply.
//! - `twin_style_materialize` writes voice / examples / constraints / length
//!   for each requested channel from that channel's target dimensions.
//! - `twin_style_apply` writes the accepted drafts in one transaction.
//!
//! Roll and materialize never write (census `model-output-persisted-without-preview`).
//! Every LLM reply passes ONE validation door with path-addressed errors that
//! feed a single repair retry.
//!
//! WP0 contract stubs: the signatures are final; the bodies land in WP1.

use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    StyleCandidate, StyleChannelTarget, StyleToneDraft, TwinStyle, TwinStyleDims, TwinStylePins,
    TwinTone,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Roll 3 contrasting candidate styles for a twin. Preview only.
#[tauri::command]
pub async fn twin_style_roll(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    pins: TwinStylePins,
    avoid: Vec<TwinStyleDims>,
) -> Result<Vec<StyleCandidate>, AppError> {
    require_auth(&state).await?;
    let _ = (twin_id, pins, avoid);
    Err(AppError::Validation(
        "twin_style_roll is not implemented yet".into(),
    ))
}

/// Materialize a chosen style into per-channel tone drafts. Preview only.
#[tauri::command]
pub async fn twin_style_materialize(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    style: TwinStyle,
    targets: Vec<StyleChannelTarget>,
) -> Result<Vec<StyleToneDraft>, AppError> {
    require_auth(&state).await?;
    let _ = (twin_id, style, targets);
    Err(AppError::Validation(
        "twin_style_materialize is not implemented yet".into(),
    ))
}

/// Write accepted drafts (one transaction). Channels not listed stay untouched.
#[tauri::command]
pub async fn twin_style_apply(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    style: TwinStyle,
    tones: Vec<StyleToneDraft>,
) -> Result<Vec<TwinTone>, AppError> {
    require_auth(&state).await?;
    let _ = (twin_id, style, tones);
    Err(AppError::Validation(
        "twin_style_apply is not implemented yet".into(),
    ))
}
