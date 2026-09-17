//! Drive tag index — Finder-style colour labels + named tags.
//!
//! WIRE CONTRACT (fixed by the drive-finder spark, 2026-09-17):
//! the index lives INSIDE the sandbox at `<root>/.drive-meta.json`, is owned
//! by Rust, and is a declared bookkeeping exclusion for every walker
//! (list / tree / search / recent / storage). Builtin ids are
//! `label:<color>`; user tags are `tag:<uuid>`.
//!
//! STUB: every command below returns `Execution("not implemented")` until
//! the tag-index work package lands. Types are final.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use ts_rs::TS;

use crate::error::AppError;

use super::DriveEntry;

/// Name of the index file at the sandbox root. Excluded from every listing.
pub const META_FILENAME: &str = ".drive-meta.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DriveTagColor {
    Red,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
    Gray,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveTag {
    /// `label:<color>` for the seven builtins, `tag:<uuid>` for user tags.
    pub id: String,
    /// Display name. Builtins carry the colour token name; the UI localises.
    pub name: String,
    pub color: DriveTagColor,
    /// Builtins cannot be deleted or renamed.
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveMeta {
    pub version: u32,
    pub vocab: Vec<DriveTag>,
    /// rel_path (forward slashes) -> tag ids applied to that entry.
    pub labels: BTreeMap<String, Vec<String>>,
    /// Set when the index file was unreadable and moved aside.
    pub warning: Option<String>,
}

fn not_implemented(what: &str) -> AppError {
    AppError::Execution(format!("drive meta: {what} not implemented"))
}

#[tauri::command]
pub fn drive_meta_get(app: AppHandle) -> Result<DriveMeta, AppError> {
    let _ = app;
    Err(not_implemented("drive_meta_get"))
}

#[tauri::command]
pub fn drive_tags_set(
    app: AppHandle,
    rel_path: String,
    tag_ids: Vec<String>,
) -> Result<DriveMeta, AppError> {
    let _ = (app, rel_path, tag_ids);
    Err(not_implemented("drive_tags_set"))
}

#[tauri::command]
pub fn drive_tag_upsert(app: AppHandle, tag: DriveTag) -> Result<DriveMeta, AppError> {
    let _ = (app, tag);
    Err(not_implemented("drive_tag_upsert"))
}

#[tauri::command]
pub fn drive_tag_delete(app: AppHandle, tag_id: String) -> Result<DriveMeta, AppError> {
    let _ = (app, tag_id);
    Err(not_implemented("drive_tag_delete"))
}

#[tauri::command]
pub fn drive_tagged(app: AppHandle, tag_id: String) -> Result<Vec<DriveEntry>, AppError> {
    let _ = (app, tag_id);
    Err(not_implemented("drive_tagged"))
}
