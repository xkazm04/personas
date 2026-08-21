//! Whole-app export and import ("data portability").
//!
//! This module is the IPC surface: the nine `#[tauri::command]` entry points
//! below and nothing else. Everything they call lives in the submodules,
//! grouped by what it operates on rather than by name -- the schema types per
//! domain, then the export / validate / import stage for each of those same
//! domains. The submodules are re-exported here so every path that resolved
//! against the former single file still resolves.

use std::collections::HashMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::commands::infrastructure::skill_files;
use crate::db::credential_fields::classify_field_type;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::{
    memories as memory_repo, personas as persona_repo, settings as settings_repo,
};
use crate::db::repos::dev_tools as dev_tools_repo;
use crate::db::repos::execution::test_suites as suite_repo;
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo,
    team_memories as team_memory_repo, teams as team_repo, tools as tool_repo,
    triggers as trigger_repo,
};
use crate::db::{DbPool, UserDbPool};
use crate::engine::crypto;
use crate::engine::persona_icon::export_safe_icon;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync, require_privileged};
use crate::validation;
use crate::AppState;
use personas_macros::requires;

use super::export_types::{
    MemoryExport, SubscriptionExport, TriggerExport, MAX_CONFIG_LEN, MAX_DESCRIPTION_LEN,
    MAX_DESIGN_CONTEXT_LEN, MAX_MEMORIES, MAX_MEMORY_CONTENT_LEN, MAX_NAME_LEN,
    MAX_SHORT_FIELD_LEN, MAX_STRUCTURED_PROMPT_LEN, MAX_SUBSCRIPTIONS, MAX_SYSTEM_PROMPT_LEN,
    MAX_TRIGGERS,
};

mod archive;
mod competitive;
mod credentials;
mod export;
mod export_athena;
mod export_dev;
mod export_twin;
mod export_workspace;
mod flow;
mod helpers;
mod import;
mod import_athena;
mod import_dev;
mod import_skills;
mod import_twin;
mod import_workspace;
mod limits;
mod sealing;
mod stats;
mod types;
mod types_athena;
mod types_dev;
mod types_twin;
mod types_workspace;
mod validate;
mod validate_athena;
mod validate_twin;

pub(crate) use archive::*;
pub(crate) use competitive::*;
pub(crate) use credentials::*;
pub(crate) use export::*;
pub(crate) use export_athena::*;
pub(crate) use export_dev::*;
pub(crate) use export_twin::*;
pub(crate) use export_workspace::*;
pub(crate) use flow::*;
pub(crate) use helpers::*;
pub(crate) use import::*;
pub(crate) use import_athena::*;
pub(crate) use import_dev::*;
pub(crate) use import_skills::*;
pub(crate) use import_twin::*;
pub(crate) use import_workspace::*;
pub(crate) use limits::*;
pub(crate) use sealing::*;
pub(crate) use stats::*;
pub(crate) use types::*;
pub(crate) use types_athena::*;
pub(crate) use types_dev::*;
pub(crate) use types_twin::*;
pub(crate) use types_workspace::*;
pub(crate) use validate::*;
pub(crate) use validate_athena::*;
pub(crate) use validate_twin::*;

#[cfg(test)]
mod tests;

// ============================================================================
// Commands
// ============================================================================

/// Get export statistics for the entire workspace (for UI preview).
#[tauri::command]
pub async fn get_export_stats(state: State<'_, Arc<AppState>>) -> Result<ExportStats, AppError> {
    require_auth_sync(&state)?;
    compute_export_stats(&state.db, Some(&state.user_db))
}

/// Full export: export everything into a compressed JSON archive via save dialog.
/// When `passphrase` is provided (>= 8 chars), credential secrets — and the two
/// always-encrypted sections, twins and Athena's memory — are encrypted and
/// embedded in the bundle.
///
/// **Without a passphrase, a full export carries neither twins nor Athena.**
/// That mirrors what this command already did with credential secrets: the
/// shells travel, the secrets do not. A twin is a model of a real person's
/// voice and `identity.md` is a dossier on the operator; neither belongs in a
/// plaintext zip. The omission is recorded in `export_warnings` rather than
/// being silent.
#[tauri::command]
#[requires(privileged)]
pub async fn export_full(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    include_memories: Option<bool>,
    passphrase: Option<String>,
) -> Result<bool, AppError> {
    let pool = &state.db;
    let pp = usable_passphrase(passphrase.as_deref());
    // Full export carries the entire workspace, KPI setup included.
    let mut bundle = build_export_bundle(
        pool,
        Some(&state.user_db),
        ExportScope::Full,
        include_memories.unwrap_or(true),
        true,
        SensitiveSections::from_passphrase(pp),
    )?;

    if let Some(pp) = pp {
        let envelope = build_encrypted_credentials(pool, pp, None)?;
        bundle.encrypted_credentials = Some(envelope);
        bundle.format_version = 3;
    }
    seal_sensitive_sections(&mut bundle, pp)?;

    save_bundle_to_file(&app, &bundle, "personas_full_export").await
}

/// Selective export: export only specified personas and teams.
/// When `passphrase` is provided (>= 8 chars), credential secrets for the
/// selected `credential_ids` are encrypted and embedded in the bundle.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_selective(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    persona_ids: Vec<String>,
    team_ids: Vec<String>,
    credential_ids: Vec<String>,
    project_ids: Vec<String>,
    workspace_ids: Vec<String>,
    twin_ids: Vec<String>,
    athena_tiers: Vec<String>,
    include_memories: Option<bool>,
    include_kpis: Option<bool>,
    passphrase: Option<String>,
) -> Result<bool, AppError> {
    // When passphrase is provided (credential secrets involved), upgrade to privileged
    let pp = usable_passphrase(passphrase.as_deref());
    if pp.is_some() {
        require_privileged(&state, "export_selective").await?;
    } else {
        require_auth(&state).await?;
    }
    require_passphrase_for_selection(&twin_ids, &athena_tiers, pp)?;

    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
        credential_ids: credential_ids.clone(),
        project_ids: project_ids.clone(),
        workspace_ids: workspace_ids.clone(),
        twin_ids: twin_ids.clone(),
        athena_tiers: athena_tiers.clone(),
    };
    let mut bundle = build_export_bundle(
        pool,
        Some(&state.user_db),
        scope,
        include_memories.unwrap_or(true),
        include_kpis.unwrap_or(true),
        SensitiveSections::from_passphrase(pp),
    )?;

    if let Some(pp) = pp {
        let filter_ids = if credential_ids.is_empty() {
            None
        } else {
            Some(&credential_ids)
        };
        let envelope = build_encrypted_credentials(pool, pp, filter_ids)?;
        bundle.encrypted_credentials = Some(envelope);
        bundle.format_version = 3;
    }
    seal_sensitive_sections(&mut bundle, pp)?;

    save_bundle_to_file(&app, &bundle, "personas_selective_export").await
}

/// Import a previously exported portability bundle.
/// When `passphrase` is provided and the bundle contains `encrypted_credentials`,
/// credential secrets are decrypted and written to the imported credential shells.
///
/// Two-pass conflict flow (mirrors `import_credentials`):
/// - Pass 1 (no `resolutions_json`): all non-conflicting sections
///   import immediately; colliding entities are returned in `import_conflicts`
///   together with `bundle_file_path`.
/// - Pass 2: the caller re-invokes with `resolutions_json` (a JSON map
///   of `"<kind>:<bundle_id>"` → `"replace" | "skip" | "duplicate"`) and
///   `file_path_override` set to the returned `bundle_file_path`; only the
///   resolved entities are processed.
///
/// The parameter was `project_resolutions_json` while the flow was
/// project-only; it is `resolutions_json` (invoke key `resolutionsJson`) now
/// that the map is generic. Tauri silently drops payload keys a command does
/// not declare, so a caller still sending only the old name degrades into a
/// pass-1 re-run rather than erroring — the remaining call sites
/// (`src/api/system/dataPortability.ts`, `src/test/automation/bridge.ts`,
/// `tools/test-mcp/e2e_portability.py`) must send the new key.
#[tauri::command]
#[requires(privileged)]
pub async fn import_portability_bundle(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: Option<String>,
    resolutions_json: Option<String>,
    file_path_override: Option<String>,
) -> Result<Option<PortabilityImportResult>, AppError> {
    let path = if let Some(override_path) = file_path_override {
        std::path::PathBuf::from(override_path)
    } else {
        let app_clone = app.clone();
        let file_path = tokio::task::spawn_blocking(move || {
            app_clone
                .dialog()
                .file()
                .add_filter("Personas Export", &["zip", "json"])
                .blocking_pick_file()
        })
        .await
        .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

        let Some(file_path) = file_path else {
            return Ok(None);
        };

        file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?
    };

    let result = run_bundle_import(
        &state.db,
        Some(&state.user_db),
        &path,
        passphrase.as_deref(),
        resolutions_json.as_deref(),
    )?;
    spawn_pending_kb_reindex(&app, &state, &result);
    spawn_pending_reembed(&state, &result);
    Ok(Some(result))
}

/// Parse a competitive workflow file (n8n, Zapier, Make) and return a preview
/// of what would be imported as persona agents.
#[tauri::command]
pub async fn preview_competitive_import(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Option<Vec<CompetitiveImportPreview>>, AppError> {
    require_auth(&state).await?;
    let _ = &state.db; // validate state

    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .add_filter("Workflow Files", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;

    let previews = parse_competitive_workflow(&content)?;
    Ok(Some(previews))
}

// ============================================================================
// Debug-only commands for smoke testing
//
// The production export/import commands open native file dialogs, which makes
// IPC-only round-trip testing impossible. These variants accept an explicit
// `file_path` and bypass the dialog so e2e_portability.py can drive a real
// export → import round-trip via window.__TAURI__.invoke. Compiled out of
// release builds.
// ============================================================================

#[cfg(debug_assertions)]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_selective_to_path(
    state: State<'_, Arc<AppState>>,
    persona_ids: Vec<String>,
    team_ids: Vec<String>,
    credential_ids: Vec<String>,
    project_ids: Vec<String>,
    workspace_ids: Vec<String>,
    twin_ids: Vec<String>,
    athena_tiers: Vec<String>,
    include_memories: Option<bool>,
    include_kpis: Option<bool>,
    passphrase: Option<String>,
    file_path: String,
) -> Result<bool, AppError> {
    let pp = usable_passphrase(passphrase.as_deref());
    if pp.is_some() {
        require_privileged(&state, "export_selective_to_path").await?;
    } else {
        require_auth(&state).await?;
    }
    require_passphrase_for_selection(&twin_ids, &athena_tiers, pp)?;

    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
        credential_ids: credential_ids.clone(),
        project_ids: project_ids.clone(),
        workspace_ids: workspace_ids.clone(),
        twin_ids: twin_ids.clone(),
        athena_tiers: athena_tiers.clone(),
    };
    let mut bundle = build_export_bundle(
        pool,
        Some(&state.user_db),
        scope,
        include_memories.unwrap_or(true),
        include_kpis.unwrap_or(true),
        SensitiveSections::from_passphrase(pp),
    )?;

    if let Some(pp) = pp {
        let filter_ids = if credential_ids.is_empty() {
            None
        } else {
            Some(&credential_ids)
        };
        let envelope = build_encrypted_credentials(pool, pp, filter_ids)?;
        bundle.encrypted_credentials = Some(envelope);
        bundle.format_version = 3;
    }
    seal_sensitive_sections(&mut bundle, pp)?;

    let json =
        serde_json::to_string_pretty(&bundle).map_err(|e| AppError::Internal(e.to_string()))?;
    let zip_bytes = create_zip_bundle(&json)?;
    tokio::fs::write(&file_path, zip_bytes)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

    Ok(true)
}

#[cfg(debug_assertions)]
#[tauri::command]
#[requires(privileged)]
pub async fn import_portability_bundle_from_path(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: Option<String>,
    file_path: String,
    resolutions_json: Option<String>,
) -> Result<Option<PortabilityImportResult>, AppError> {
    let path = std::path::PathBuf::from(&file_path);
    let result = run_bundle_import(
        &state.db,
        Some(&state.user_db),
        &path,
        passphrase.as_deref(),
        resolutions_json.as_deref(),
    )?;
    spawn_pending_kb_reindex(&app, &state, &result);
    spawn_pending_reembed(&state, &result);
    Ok(Some(result))
}

/// Export all credential secrets to a password-protected encrypted file.
#[tauri::command]
#[requires(privileged)]
pub async fn export_credentials(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: String,
) -> Result<bool, AppError> {
    if passphrase.len() < 8 {
        return Err(AppError::Validation(
            "Passphrase must be at least 8 characters".into(),
        ));
    }

    let pool = &state.db;
    let all_creds = cred_repo::get_all(pool)?;

    // Collect built-in connector names so we can skip their credentials
    let builtin_names: std::collections::HashSet<String> = connector_repo::get_all(pool)
        .unwrap_or_default()
        .into_iter()
        .filter(|c| c.is_builtin)
        .map(|c| c.name.to_lowercase())
        .collect();

    let mut entries = Vec::with_capacity(all_creds.len());
    for cred in &all_creds {
        // Skip credentials belonging to built-in connectors
        if builtin_names.contains(&cred.service_type.to_lowercase()) {
            continue;
        }
        let fields = cred_repo::get_decrypted_fields(pool, cred).unwrap_or_default();
        if let Err(e) = audit_log::log_decrypt(
            pool,
            &cred.id,
            &cred.name,
            "data_portability:export",
            None,
            None,
        ) {
            tracing::warn!(credential_id = %cred.id, error = %e, "Failed to write audit log for credential decrypt");
        }
        entries.push(CredentialExportEntry {
            name: cred.name.clone(),
            service_type: cred.service_type.clone(),
            metadata: cred.metadata.clone(),
            fields,
        });
    }

    let bundle = CredentialExportBundle {
        format_version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        credentials: entries,
    };

    let plaintext = serde_json::to_vec(&bundle)
        .map_err(|e| AppError::Internal(format!("Serialization failed: {e}")))?;

    // Generate random salt and nonce
    use aes_gcm::aead::rand_core::RngCore;
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(&passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| AppError::Internal(format!("Encryption failed: {e}")))?;

    let envelope = CredentialExportEnvelope {
        format: CREDENTIAL_EXPORT_FORMAT.into(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    };

    let envelope_json = serde_json::to_string_pretty(&envelope)
        .map_err(|e| AppError::Internal(format!("Envelope serialization failed: {e}")))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("personas_credentials_{}.cred.enc", timestamp);
    let app_clone = app.clone();

    let save_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Encrypted Credentials", &["enc"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    if let Some(file_path) = save_path {
        let path = file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;
        tokio::fs::write(&path, envelope_json)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;
        return Ok(true);
    }

    Ok(false)
}

/// Import credentials from a password-protected encrypted file.
#[tauri::command]
#[requires(privileged)]
pub async fn import_credentials(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: String,
    resolutions_json: Option<String>,
    file_path_override: Option<String>,
) -> Result<Option<CredentialImportResult>, AppError> {
    let path = if let Some(override_path) = file_path_override {
        std::path::PathBuf::from(override_path)
    } else {
        let app_clone = app.clone();
        let file_path = tokio::task::spawn_blocking(move || {
            app_clone
                .dialog()
                .file()
                .add_filter("Encrypted Credentials", &["enc"])
                .blocking_pick_file()
        })
        .await
        .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

        let Some(file_path) = file_path else {
            return Ok(None);
        };

        file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?
    };

    // Cap the file size before read_to_string so a multi-GB pick (accidental
    // or socially engineered) cannot OOM the process. Mirrors the guard in
    // `import_persona`, with a tighter ceiling because credential bundles
    // are tiny (JSON envelope + base64 ciphertext).
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file metadata: {e}")))?;
    if metadata.len() > MAX_CREDENTIAL_IMPORT_BYTES {
        return Err(AppError::Validation(format!(
            "Credential import file too large ({:.1} MB). Maximum is {} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_CREDENTIAL_IMPORT_BYTES / (1024 * 1024)
        )));
    }

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;

    let envelope: CredentialExportEnvelope = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid credential export file: {e}")))?;

    if envelope.format != CREDENTIAL_EXPORT_FORMAT {
        return Err(AppError::Validation(format!(
            "Unsupported format: {} (expected {})",
            envelope.format, CREDENTIAL_EXPORT_FORMAT
        )));
    }

    let salt = B64
        .decode(&envelope.salt)
        .map_err(|e| AppError::Validation(format!("Invalid salt: {e}")))?;
    let nonce_bytes = B64
        .decode(&envelope.nonce)
        .map_err(|e| AppError::Validation(format!("Invalid nonce: {e}")))?;
    let ciphertext = B64
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Validation(format!("Invalid ciphertext: {e}")))?;

    let key = derive_key(&passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
        AppError::Validation("Decryption failed -- wrong passphrase or corrupted file".into())
    })?;

    let bundle: CredentialExportBundle = serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Validation(format!("Invalid inner data: {e}")))?;

    let pool = &state.db;

    // Parse resolutions from frontend (second pass after conflict detection)
    let resolutions: std::collections::HashMap<String, String> = resolutions_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let has_resolutions = !resolutions.is_empty();

    // Load existing credentials for conflict detection
    let existing = cred_repo::get_all(pool).unwrap_or_default();
    let existing_names: std::collections::HashMap<String, String> = existing
        .iter()
        .map(|c| (c.name.to_lowercase(), c.id.clone()))
        .collect();

    let path_str = path.to_string_lossy().to_string();

    let mut result = CredentialImportResult {
        created: 0,
        skipped: 0,
        replaced: 0,
        warnings: Vec::new(),
        conflicts: Vec::new(),
        file_path: None,
    };

    // First pass: if conflicts exist and no resolutions provided, return conflicts for UI
    if !has_resolutions {
        for entry in &bundle.credentials {
            let conflict_key = entry.name.to_lowercase();
            if existing_names.contains_key(&conflict_key) {
                result.conflicts.push(CredentialConflict {
                    name: entry.name.clone(),
                    service_type: entry.service_type.clone(),
                    existing_id: existing_names
                        .get(&conflict_key)
                        .cloned()
                        .unwrap_or_default(),
                });
            }
        }
        if !result.conflicts.is_empty() {
            // Include file path so frontend can re-use it for resolution pass
            result.file_path = Some(path_str);
            return Ok(Some(result));
        }
    }

    // Wrap the entire import in a single transaction so that a failed create
    // after a delete does not permanently lose the original credential.
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    use crate::db::repos::resources::credentials as cred_repo;

    for entry in &bundle.credentials {
        let conflict_key = entry.name.to_lowercase();

        // Determine action based on resolution
        let resolution = resolutions.get(&entry.name);
        match resolution.map(|s| s.as_str()) {
            Some("skip") => {
                result.skipped += 1;
                continue;
            }
            Some("replace") => {
                // Delete existing credential and dependents within the transaction
                if let Some(existing_id) = existing_names.get(&conflict_key) {
                    tx.execute(
                        "DELETE FROM credential_fields WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM credential_rotation_history WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM credential_rotation_policies WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM credential_events WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM persona_credentials WHERE id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                }
                result.replaced += 1;
            }
            Some("keep_both") => {
                // Import with "(imported)" suffix — fall through to create with modified name
            }
            _ => {
                // No conflict or no resolution needed — use original name
            }
        }

        let final_name = if resolution == Some(&"keep_both".to_string()) {
            format!("{} (imported)", entry.name)
        } else {
            entry.name.clone()
        };

        let cred_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert credential row within the transaction
        match tx.execute(
            "INSERT INTO persona_credentials
             (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            rusqlite::params![
                cred_id,
                final_name,
                entry.service_type,
                "",
                "",
                entry.metadata,
                now,
            ],
        ) {
            Ok(_) => {}
            Err(e) => {
                // Roll back the entire transaction on failure
                return Err(AppError::Internal(format!(
                    "Credential '{}': insert failed: {}",
                    entry.name, e
                )));
            }
        }

        // Derive field sensitivity from connector schema
        let sens_map = cred_repo::sensitivity_map_for_connector(pool, &entry.service_type);

        // Insert encrypted fields within the same transaction
        for (key, value) in &entry.fields {
            let is_sensitive = cred_repo::is_field_sensitive(sens_map.as_ref(), key);
            let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
                .map_err(|e| AppError::Internal(format!("Field encryption failed: {}", e)))?;

            let field_type = classify_field_type(key);
            let field_id = uuid::Uuid::new_v4().to_string();

            tx.execute(
                "INSERT INTO credential_fields
                 (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                rusqlite::params![
                    field_id,
                    cred_id,
                    key,
                    enc_val,
                    field_iv,
                    field_type,
                    is_sensitive as i32,
                    now,
                ],
            )?;
        }

        result.created += 1;
    }

    tx.commit().map_err(AppError::Database)?;
    Ok(Some(result))
}
