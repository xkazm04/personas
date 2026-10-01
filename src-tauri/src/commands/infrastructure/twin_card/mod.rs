//! Twin Card v1.0 - export, inspect and import a portable twin (spark
//! `twin-portable-blueprint`).
//!
//! The file format is specified in `docs/standards/twin-card/1.0/` (SPEC.md,
//! RENDERER.md, `twin-card.schema.json`). This module is the app's
//! implementation of it: build a card from the database, apply a card to the
//! database, canonical JSON + per-partition SHA-256, sealing of the personal
//! partitions, an Ed25519 signature when the device identity is available,
//! and a Character Card V3 export that preserves the full card.
//!
//! CONTRACT STUBS (WP0): the bodies land in WP4. Wire names and parameter
//! names are frozen - change them only together with `src/api/twin/twinCard.ts`.

use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    TwinCardExportOptions, TwinCardExportResult, TwinCardImportResult, TwinCardInspection,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

fn not_built(name: &str) -> AppError {
    AppError::Internal(format!(
        "{name} is not built yet (spark twin-portable-blueprint WP4)"
    ))
}

/// Export one twin as a Twin Card (or a Character Card V3) to `options.path`.
/// `passphrase` (>= 8 chars) seals the `knowledge` and `training` partitions;
/// it is a parameter, never a struct field, so nothing serializable holds it.
#[tauri::command]
pub async fn twin_card_export(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    options: TwinCardExportOptions,
    passphrase: Option<String>,
) -> Result<TwinCardExportResult, AppError> {
    require_auth(&state).await?;
    let _ = (&twin_id, &options, &passphrase);
    Err(not_built("twin_card_export"))
}

/// Read a card without importing it: version support, schema validity,
/// partitions (hash checked when readable) and signature state.
#[tauri::command]
pub async fn twin_card_inspect(
    state: State<'_, Arc<AppState>>,
    path: String,
    passphrase: Option<String>,
) -> Result<TwinCardInspection, AppError> {
    require_auth(&state).await?;
    let _ = (&path, &passphrase);
    Err(not_built("twin_card_inspect"))
}

/// Import a card as a twin. `conflict` (a twin with the same name exists) is
/// `duplicate` | `replace` | `skip`.
#[tauri::command]
pub async fn twin_card_import(
    state: State<'_, Arc<AppState>>,
    path: String,
    passphrase: Option<String>,
    conflict: String,
) -> Result<TwinCardImportResult, AppError> {
    require_auth(&state).await?;
    let _ = (&path, &passphrase, &conflict);
    Err(not_built("twin_card_import"))
}
