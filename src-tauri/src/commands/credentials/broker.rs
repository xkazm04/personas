//! Tauri commands for the Zero-Plaintext Credential Broker.
//!
//! The Broker lets external processes (fleet sessions, scripts, MCP clients)
//! *use* vault credentials without ever seeing them: they hold short-lived,
//! narrowly-scoped `external_api_keys` handles and route calls through the
//! audited `/api/proxy/{credential_id}` route. These commands power the vault
//! Broker surface: mint handles, list consumers + their observed activity,
//! and the per-consumer kill-switch.

use std::sync::Arc;
use tauri::State;

use crate::db::models::{ApiKeyAuditEntry, BrokerConsumerView, CreateApiKeyResponse};
use crate::db::repos::resources::api_key_audit;
use crate::db::repos::resources::broker_edges;
use crate::db::repos::resources::external_api_keys as api_key_repo;
use crate::db::repos::resources::settings_audit_log;
use crate::engine::credential_broker;
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

/// Mint a short-lived derived handle for one credential. Returns the handle
/// plaintext exactly once — the credential's secret is never part of the
/// response. TTL is clamped server-side (5 min .. 24 h, default 60 min).
#[tauri::command]
#[requires(privileged)]
pub fn mint_credential_handle(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    consumer_name: String,
    ttl_minutes: Option<u32>,
) -> Result<CreateApiKeyResponse, AppError> {
    credential_broker::mint_derived_handle(&state.db, &credential_id, &consumer_name, ttl_minutes)
}

/// List all observed broker consumers (one row per consumer key), aggregated
/// across credentials and joined with live key state for the kill-switch.
#[tauri::command]
#[requires(privileged)]
pub fn list_broker_consumers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<BrokerConsumerView>, AppError> {
    broker_edges::list_consumers(&state.db)
}

/// Recent management-API request trail for one consumer key (newest first).
/// Reuses the per-key audit table the middleware writes on every request.
#[tauri::command]
#[requires(privileged)]
pub fn list_broker_consumer_activity(
    state: State<'_, Arc<AppState>>,
    consumer_key_id: String,
    limit: Option<u32>,
) -> Result<Vec<ApiKeyAuditEntry>, AppError> {
    api_key_audit::list_for_key(&state.db, &consumer_key_id, limit.unwrap_or(50))
}

/// Kill-switch: revoke a consumer key. Takes effect on the consumer's very
/// next request (`find_by_token` filters revoked keys), and the consumer's
/// blast-radius edges drop out of the dependents graph immediately.
#[tauri::command]
#[requires(privileged)]
pub fn revoke_broker_consumer(
    state: State<'_, Arc<AppState>>,
    consumer_key_id: String,
) -> Result<(), AppError> {
    api_key_repo::revoke(&state.db, &consumer_key_id)?;
    tracing::info!(consumer_key_id = %consumer_key_id, "broker consumer revoked (kill-switch)");
    // Settings → History feed; best-effort.
    if let Err(e) = settings_audit_log::insert(
        &state.db,
        "api_keys",
        &consumer_key_id,
        "broker_kill_switch",
        None,
        None,
        Some("ui"),
    ) {
        tracing::warn!(error = %e, "settings_audit_log insert failed for broker kill-switch");
    }
    Ok(())
}
