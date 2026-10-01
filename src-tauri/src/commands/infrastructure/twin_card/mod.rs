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
//! Layout: `types` (the card as serde structs); `build`, `build_knowledge`
//! and `build_training` (database -> card); `canonical` (RFC 8785 +
//! SHA-256); `seal`; `sign`; `schema` (the vendored schema); `stamp`
//! (timestamps); `envelope` (parts -> file); `open` (file -> parts); `ccv3`;
//! `apply` and `apply_record` (card -> database); `flow` (the three
//! operations). The commands below are adapters: they authenticate and run
//! one operation off the IPC worker. Wire names and parameter names are
//! frozen with `src/api/twin/twinCard.ts`.

mod apply;
mod apply_record;
mod build;
mod build_knowledge;
mod build_training;
mod canonical;
mod ccv3;
mod envelope;
mod flow;
mod open;
mod schema;
mod seal;
mod sign;
mod stamp;
mod types;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    TwinCardExportOptions, TwinCardExportResult, TwinCardImportResult, TwinCardInspection,
};
use crate::engine::twin_setup::jobs::db;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Export one twin as a Twin Card (or a Character Card V3) to `options.path`.
/// `passphrase` (>= 8 chars) seals the `knowledge` and `training` partitions;
/// it is a parameter, never a struct field, so nothing serializable holds it.
/// Signed with the device identity when this build has one; otherwise the
/// card is written unsigned and the result says so (`signed: false`).
#[tauri::command]
pub async fn twin_card_export(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    options: TwinCardExportOptions,
    passphrase: Option<String>,
) -> Result<TwinCardExportResult, AppError> {
    require_auth(&state).await?;
    db(&state.db, move |pool| {
        let signing = sign::device_signing(pool);
        flow::export(pool, &twin_id, &options, passphrase.as_deref(), &signing)
    })
    .await
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
    db(&state.db, move |_| {
        flow::inspect(&path, passphrase.as_deref())
    })
    .await
}

/// Import a card as a twin. `conflict` (a twin with the same name exists) is
/// `duplicate` | `replace` | `skip`. A sealed partition needs `passphrase`;
/// a wrong one fails the import before anything is written.
#[tauri::command]
pub async fn twin_card_import(
    state: State<'_, Arc<AppState>>,
    path: String,
    passphrase: Option<String>,
    conflict: String,
) -> Result<TwinCardImportResult, AppError> {
    require_auth(&state).await?;
    db(&state.db, move |pool| {
        flow::import(pool, &path, passphrase.as_deref(), &conflict)
    })
    .await
}
