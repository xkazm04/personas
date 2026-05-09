//! Tauri commands for the declarative bridge-manifest dispatcher.
//!
//! Surfaces three commands:
//! - `bridge_manifest_list_all` — return all bundled manifests (read from
//!   the repo-relative `scripts/bridges/` directory).
//! - `bridge_manifest_describe` — return a single manifest by id.
//! - `bridge_manifest_dispatch` — invoke an action on a bridge with params.
//!
//! See `engine/bridge_manifest/DESIGN.md` for the architectural rationale.

#![cfg(feature = "desktop")]

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use ts_rs::TS;

use crate::engine::bridge_manifest::{self, BridgeManifest};
use crate::engine::desktop_bridges::BridgeActionResult;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Wire shape for a manifest summary returned to the frontend. Drops the
/// full action params map for compactness in list views.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BridgeManifestSummary {
    pub id: String,
    pub label: String,
    pub description: String,
    pub binary: String,
    pub action_count: i32,
    pub action_names: Vec<String>,
}

impl From<&BridgeManifest> for BridgeManifestSummary {
    fn from(m: &BridgeManifest) -> Self {
        BridgeManifestSummary {
            id: m.id.clone(),
            label: m.label.clone(),
            description: m.description.clone(),
            binary: m.binary.clone(),
            action_count: m.actions.len() as i32,
            action_names: m.actions.iter().map(|a| a.name.clone()).collect(),
        }
    }
}

/// Locate the `scripts/bridges/` directory next to the working directory.
/// V1 only supports the repo-relative location; runtime app-data discovery
/// is a follow-up — see `DESIGN.md` "Out of scope (v1)".
fn manifests_dir() -> Result<std::path::PathBuf, AppError> {
    let cwd = std::env::current_dir()
        .map_err(|e| AppError::Internal(format!("current_dir failed: {e}")))?;
    let candidate = cwd.join("scripts").join("bridges");
    if candidate.is_dir() {
        Ok(candidate)
    } else {
        Err(AppError::NotFound(format!(
            "scripts/bridges/ directory not found under {}",
            cwd.display()
        )))
    }
}

#[tauri::command]
pub fn bridge_manifest_list_all(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<BridgeManifestSummary>, AppError> {
    require_auth_sync(&state)?;

    let dir = match manifests_dir() {
        Ok(d) => d,
        Err(_) => return Ok(Vec::new()), // Empty when the dir doesn't exist
    };

    let manifests = bridge_manifest::load_manifests_from_dir(&dir);
    let mut out: Vec<BridgeManifestSummary> = manifests.iter().map(Into::into).collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub fn bridge_manifest_describe(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<BridgeManifest, AppError> {
    require_auth_sync(&state)?;

    let dir = manifests_dir()?;
    let manifests = bridge_manifest::load_manifests_from_dir(&dir);
    manifests
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::NotFound(format!("bridge manifest '{id}' not found")))
}

#[tauri::command]
pub async fn bridge_manifest_dispatch(
    state: State<'_, Arc<AppState>>,
    id: String,
    action: String,
    params: HashMap<String, Value>,
) -> Result<BridgeActionResult, AppError> {
    require_auth_sync(&state)?;

    let dir = manifests_dir()?;
    let manifests = bridge_manifest::load_manifests_from_dir(&dir);
    let manifest = manifests
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::NotFound(format!("bridge manifest '{id}' not found")))?;

    bridge_manifest::dispatch(&manifest, &action, &params).await
}
