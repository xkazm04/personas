//! Media Studio composition persistence — user saves and autosave.
//!
//! Two storage surfaces:
//!
//! 1. **User files**: `Documents/Personas Media Studio/*.mstudio.json`. Chosen
//!    explicitly via Save As / Open. Lives outside the app bundle so an app
//!    upgrade never touches them.
//! 2. **Autosave**: `{app_data_dir}/media-studio/autosave.json`. Overwritten
//!    on every debounced composition change so an app crash or accidental
//!    close doesn't lose work.
//!
//! All commands are async and use tokio::fs to avoid blocking the IPC
//! worker. Writes are atomic (write to `.tmp` then rename) so a crash
//! mid-write cannot corrupt either file.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::fs;
use ts_rs::TS;

use crate::engine::render_plan::compile::Composition;
use crate::error::AppError;

// =============================================================================
// Types
// =============================================================================

/// Wrapper that tags saved files with a schema version so future changes to
/// the Composition shape can be migrated instead of refused.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedComposition {
    /// Version of the composition format. Bump when backward-incompatible.
    schema_version: u32,
    /// App build that wrote the file — diagnostic only.
    saved_by: String,
    /// ISO 8601 timestamp when saved.
    saved_at: String,
    /// The composition payload; kept as a `serde_json::Value` so older
    /// payloads that don't parse as the current `Composition` shape can still
    /// be loaded and inspected before a migration step.
    composition: serde_json::Value,
}

const CURRENT_SCHEMA_VERSION: u32 = 1;
const USER_FILE_EXTENSION: &str = "mstudio.json";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompositionLoad {
    /// Raw composition JSON the frontend hands straight to the store.
    pub composition_json: String,
    pub schema_version: u32,
    pub saved_at: String,
    pub saved_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutosaveInfo {
    pub has_autosave: bool,
    pub saved_at: Option<String>,
}

// =============================================================================
// Commands
// =============================================================================

/// Save a composition to a user-picked path. The path is usually chosen by
/// the frontend's `@tauri-apps/plugin-dialog` save dialog and lives under
/// `Documents/Personas Media Studio/` by convention.
#[tauri::command]
pub async fn artist_save_composition(
    composition_json: String,
    file_path: String,
) -> Result<(), AppError> {
    // Validate the payload parses as the current Composition shape. We
    // deliberately parse-and-reserialize rather than write the raw string
    // so corrupt payloads can't reach disk.
    let composition: Composition = serde_json::from_str(&composition_json)
        .map_err(|e| AppError::Validation(format!("Invalid composition: {e}")))?;

    let wrapped = SavedComposition {
        schema_version: CURRENT_SCHEMA_VERSION,
        saved_by: env!("CARGO_PKG_VERSION").to_string(),
        saved_at: chrono::Utc::now().to_rfc3339(),
        composition: serde_json::to_value(&composition)
            .map_err(|e| AppError::Internal(format!("Serialize composition: {e}")))?,
    };

    let serialized = serde_json::to_vec_pretty(&wrapped)
        .map_err(|e| AppError::Internal(format!("Serialize wrapper: {e}")))?;

    let target = PathBuf::from(&file_path);
    ensure_parent_dir(&target).await?;
    atomic_write(&target, &serialized).await?;
    Ok(())
}

/// Load a composition from a user-picked path. Returns the unwrapped
/// composition JSON so the frontend can feed it straight into useMediaStudio.
#[tauri::command]
pub async fn artist_load_composition(file_path: String) -> Result<CompositionLoad, AppError> {
    let bytes = fs::read(&file_path)
        .await
        .map_err(|e| AppError::NotFound(format!("Cannot read {file_path}: {e}")))?;

    let wrapped: SavedComposition = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Validation(format!("Invalid composition file: {e}")))?;

    if wrapped.schema_version > CURRENT_SCHEMA_VERSION {
        return Err(AppError::Validation(format!(
            "Composition file was saved by a newer app version (schema v{}, this app supports up to v{})",
            wrapped.schema_version, CURRENT_SCHEMA_VERSION
        )));
    }

    let composition_json = serde_json::to_string(&wrapped.composition)
        .map_err(|e| AppError::Internal(format!("Re-serialize composition: {e}")))?;

    Ok(CompositionLoad {
        composition_json,
        schema_version: wrapped.schema_version,
        saved_at: wrapped.saved_at,
        saved_by: wrapped.saved_by,
    })
}

/// Overwrite the autosave file in the app data directory. Called on every
/// debounced composition change — the write must stay cheap.
#[tauri::command]
pub async fn artist_autosave_composition(
    app: AppHandle,
    composition_json: String,
) -> Result<(), AppError> {
    // Same validation pass as the user-save path so a bad composition never
    // lands in autosave either.
    let composition: Composition = serde_json::from_str(&composition_json)
        .map_err(|e| AppError::Validation(format!("Invalid composition: {e}")))?;

    let wrapped = SavedComposition {
        schema_version: CURRENT_SCHEMA_VERSION,
        saved_by: env!("CARGO_PKG_VERSION").to_string(),
        saved_at: chrono::Utc::now().to_rfc3339(),
        composition: serde_json::to_value(&composition)
            .map_err(|e| AppError::Internal(format!("Serialize composition: {e}")))?,
    };

    let serialized = serde_json::to_vec(&wrapped)
        .map_err(|e| AppError::Internal(format!("Serialize wrapper: {e}")))?;

    let target = autosave_path(&app)?;
    ensure_parent_dir(&target).await?;
    atomic_write(&target, &serialized).await?;
    Ok(())
}

/// Read the autosave file if it exists. Returns None when there's nothing
/// to restore — the frontend uses that as the "fresh session" signal.
#[tauri::command]
pub async fn artist_load_autosave(
    app: AppHandle,
) -> Result<Option<CompositionLoad>, AppError> {
    let path = autosave_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Read autosave: {e}")))?;

    // A corrupt autosave shouldn't prevent the app from starting. Log and
    // swallow the parse error; the user just loses the autosave once.
    let Ok(wrapped) = serde_json::from_slice::<SavedComposition>(&bytes) else {
        tracing::warn!("autosave file at {path:?} is unparseable; ignoring");
        return Ok(None);
    };

    if wrapped.schema_version > CURRENT_SCHEMA_VERSION {
        tracing::warn!(
            "autosave schema v{} is newer than current v{}; ignoring",
            wrapped.schema_version,
            CURRENT_SCHEMA_VERSION
        );
        return Ok(None);
    }

    let composition_json = serde_json::to_string(&wrapped.composition)
        .map_err(|e| AppError::Internal(format!("Re-serialize composition: {e}")))?;

    Ok(Some(CompositionLoad {
        composition_json,
        schema_version: wrapped.schema_version,
        saved_at: wrapped.saved_at,
        saved_by: wrapped.saved_by,
    }))
}

/// Delete the autosave file — used after a user explicitly opens or saves,
/// so the next session doesn't restore a stale state.
#[tauri::command]
pub async fn artist_clear_autosave(app: AppHandle) -> Result<(), AppError> {
    let path = autosave_path(&app)?;
    if path.exists() {
        fs::remove_file(&path)
            .await
            .map_err(|e| AppError::Internal(format!("Clear autosave: {e}")))?;
    }
    Ok(())
}

/// Resolve the default directory where user compositions live. Created if
/// missing. Lives under the OS's "Documents" so an app upgrade never wipes
/// user files.
#[tauri::command]
pub async fn artist_default_save_dir() -> Result<String, AppError> {
    let documents = dirs::document_dir().ok_or_else(|| {
        AppError::NotFound("Could not resolve the Documents directory".into())
    })?;
    let dir = documents.join("Personas Media Studio");
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("Create save dir: {e}")))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Extension the UI filters by in the save/open dialogs. Exposed as a
/// command so the frontend doesn't hard-code it.
#[tauri::command]
pub async fn artist_composition_file_extension() -> Result<String, AppError> {
    Ok(USER_FILE_EXTENSION.to_string())
}

// =============================================================================
// Helpers
// =============================================================================

fn autosave_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app_data_dir unavailable: {e}")))?;
    Ok(dir.join("media-studio").join("autosave.json"))
}

async fn ensure_parent_dir(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Internal(format!("Create dir {}: {e}", parent.display())))?;
    }
    Ok(())
}

/// Write-then-rename to avoid producing a half-written file if the process
/// dies mid-save.
async fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let tmp = target.with_extension({
        let mut ext = target
            .extension()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        ext.push_str(".tmp");
        ext
    });
    fs::write(&tmp, bytes)
        .await
        .map_err(|e| AppError::Internal(format!("Write {}: {e}", tmp.display())))?;
    fs::rename(&tmp, target)
        .await
        .map_err(|e| AppError::Internal(format!("Rename {}: {e}", tmp.display())))?;
    Ok(())
}
