//! Tauri commands for managing external API keys used by the management HTTP API.
//!
//! These keys authenticate non-IPC consumers (CLI, MCP servers, A2A clients).
//! All write commands are gated through `require_privileged_sync`.

use std::sync::Arc;
use tauri::State;

use crate::db::models::{ApiKeyAuditEntry, CreateApiKeyResponse, ExternalApiKey};
use crate::db::repos::resources::api_key_audit;
use crate::db::repos::resources::external_api_keys as repo;
use crate::db::repos::resources::settings_audit_log;
use crate::engine::management_api;
use crate::engine::pairing::{self, PendingPairingView};
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

#[tauri::command]
#[requires(privileged)]
pub fn create_external_api_key(
    state: State<'_, Arc<AppState>>,
    name: String,
    scopes: Vec<String>,
    expires_in_days: Option<u32>,
) -> Result<CreateApiKeyResponse, AppError> {
    // Server-authoritative expiry: the UI picks a window (7/30/90 days or
    // never); we stamp the absolute timestamp here rather than trust the client
    // clock. Origin-binding stays None until the pairing ceremony (P6).
    let expires_at = expires_in_days
        .map(|days| (chrono::Utc::now() + chrono::Duration::days(days as i64)).to_rfc3339());
    let resp = repo::create(&state.db, &name, scopes, expires_at, None, None)?;
    tracing::info!(
        api_key_id = %resp.record.id,
        prefix = %resp.record.key_prefix,
        "external_api_key created"
    );
    // Settings → History feed. Audit write is best-effort: a failed insert
    // must not turn a successful key creation into an error for the caller.
    let after = serde_json::json!({
        "name": resp.record.name,
        "scopes": resp.record.scopes,
        "prefix": resp.record.key_prefix,
    })
    .to_string();
    if let Err(e) = settings_audit_log::insert(
        &state.db,
        "api_keys",
        &resp.record.name,
        "create",
        None,
        Some(&after),
        Some("ui"),
    ) {
        tracing::warn!(error = %e, "settings_audit_log insert failed for api_key create");
    }
    Ok(resp)
}

#[tauri::command]
#[requires(privileged)]
pub fn list_external_api_keys(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ExternalApiKey>, AppError> {
    repo::list(&state.db)
}

#[tauri::command]
#[requires(privileged)]
pub fn revoke_external_api_key(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    repo::revoke(&state.db, &id)?;
    tracing::info!(api_key_id = %id, "external_api_key revoked");
    // Settings → History feed; best-effort.
    if let Err(e) = settings_audit_log::insert(
        &state.db,
        "api_keys",
        &id,
        "revoke",
        None,
        None,
        Some("ui"),
    ) {
        tracing::warn!(error = %e, "settings_audit_log insert failed for api_key revoke");
    }
    Ok(())
}

#[tauri::command]
#[requires(privileged)]
pub fn delete_external_api_key(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    repo::delete(&state.db, &id)?;
    tracing::info!(api_key_id = %id, "external_api_key deleted");
    Ok(())
}

/// Returns the bootstrap "system" API key — created on first call if missing —
/// so the desktop frontend can authenticate its direct HTTP fetches against the
/// management API. The plaintext is regenerated and persisted only on first
/// creation; subsequent calls return the in-memory cached plaintext for the
/// current process.
///
/// Gated through `require_privileged_sync` because this key is the master
/// credential for the management HTTP API — leaking it bypasses the entire
/// `require_api_key` middleware. Each issuance is audit-logged so any
/// unexpected callers (compromised renderer, malicious plugin webview,
/// test-automation HTTP bridge) leave a trail.
#[tauri::command]
#[requires(privileged)]
pub fn get_system_api_key(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    let key = crate::engine::management_api::get_or_create_system_api_key(&state.db)?;
    tracing::info!("system_api_key issued to privileged caller");
    Ok(key)
}

/// List the recent management-API request audit trail for one key (newest
/// first, capped). Powers the per-key audit drawer in Settings → API Keys so a
/// user can see exactly what each key has done.
#[tauri::command]
#[requires(privileged)]
pub fn list_api_key_audit(
    state: State<'_, Arc<AppState>>,
    key_id: String,
    limit: Option<u32>,
) -> Result<Vec<ApiKeyAuditEntry>, AppError> {
    api_key_audit::list_for_key(&state.db, &key_id, limit.unwrap_or(100))
}

// ============================================================================
// Pairing ceremony (Direction 1)
// ============================================================================

/// Pending pairings awaiting the user's approval (safety net for a modal host
/// that missed the `pairing-requested` event).
#[tauri::command]
#[requires(privileged)]
pub fn list_pending_pairings(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PendingPairingView>, AppError> {
    let _ = &state;
    Ok(pairing::list_views())
}

/// Approve a pending pairing: mint an ORIGIN-BOUND, scoped, expiring key for the
/// requesting cloud origin, add it to the live CORS allowlist, and stash the
/// plaintext for the cloud app's single-use `/pair/claim`. `scopes` are the
/// (possibly user-narrowed) scopes from the approval modal.
#[tauri::command]
#[requires(privileged)]
pub fn approve_pairing(
    state: State<'_, Arc<AppState>>,
    nonce: String,
    scopes: Vec<String>,
    expires_in_days: Option<u32>,
) -> Result<(), AppError> {
    let (origin, app_name) = pairing::pending_origin(&nonce)
        .ok_or_else(|| AppError::NotFound("pending pairing (expired or already resolved)".into()))?;

    let expires_at = expires_in_days
        .map(|days| (chrono::Utc::now() + chrono::Duration::days(days as i64)).to_rfc3339());
    let label = format!("Paired: {origin}");
    let resp = repo::create(
        &state.db,
        &app_name,
        scopes,
        expires_at,
        Some(origin.clone()),
        Some(label),
    )?;

    // Make the origin's browser fetches pass CORS immediately, then hand the
    // plaintext to the single-use claim keyed by the nonce.
    management_api::add_paired_origin(&origin);
    pairing::set_approved(&nonce, resp.plaintext_token).map_err(AppError::Internal)?;

    tracing::info!(
        prefix = %resp.record.key_prefix,
        origin = %origin,
        "pairing approved — origin-bound key minted"
    );
    let after = serde_json::json!({
        "origin": origin,
        "scopes": resp.record.scopes,
        "prefix": resp.record.key_prefix,
    })
    .to_string();
    let _ = settings_audit_log::insert(
        &state.db,
        "api_keys",
        &resp.record.name,
        "pair",
        None,
        Some(&after),
        Some("ui"),
    );
    Ok(())
}

/// Reject a pending pairing — the cloud app's claim then returns 403.
#[tauri::command]
#[requires(privileged)]
pub fn reject_pairing(state: State<'_, Arc<AppState>>, nonce: String) -> Result<(), AppError> {
    let _ = &state;
    pairing::set_rejected(&nonce);
    Ok(())
}

/// Revoke a paired key and re-derive the CORS allowlist from the DB (so the
/// origin drops out once no active key references it).
#[tauri::command]
#[requires(privileged)]
pub fn revoke_pairing(state: State<'_, Arc<AppState>>, key_id: String) -> Result<(), AppError> {
    repo::revoke(&state.db, &key_id)?;
    management_api::load_paired_origins(&state.db);
    tracing::info!(api_key_id = %key_id, "pairing revoked");
    let _ = settings_audit_log::insert(
        &state.db,
        "api_keys",
        &key_id,
        "revoke_pairing",
        None,
        None,
        Some("ui"),
    );
    Ok(())
}
