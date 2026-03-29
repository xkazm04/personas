//! Proactive OAuth token refresh engine.
//!
//! Scans all OAuth credentials for tokens approaching expiry and refreshes
//! them preemptively. Runs as a ReactiveSubscription every 5 minutes.
//!
//! Records per-refresh metrics (predicted vs actual lifetime, fallback usage,
//! failure rates) to the `oauth_token_metrics` table for observability.

use crate::db::repos::resources::{audit_log, credentials as cred_repo};
use crate::db::repos::resources::oauth_token_metrics as metrics_repo;
use crate::db::DbPool;
use crate::error::AppError;

use serde::Serialize;
use tauri::AppHandle;

use crate::db::models::CredentialLedger;

/// Parse a credential's metadata into a typed ledger.
fn parse_ledger(cred: &crate::db::models::PersonaCredential) -> CredentialLedger {
    CredentialLedger::parse(cred.metadata.as_deref())
}

/// Parse a credential's JSON metadata, returning `None` if absent or invalid.
fn parse_credential_metadata(
    cred: &crate::db::models::PersonaCredential,
) -> Option<serde_json::Value> {
    cred.metadata
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
}

/// Extract `oauth_token_expires_at` from parsed metadata.
fn extract_expires_at(
    meta: &serde_json::Value,
) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    meta.get("oauth_token_expires_at")
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
}

/// Threshold: refresh tokens that expire within this many seconds.
const REFRESH_THRESHOLD_SECS: i64 = 900; // 15 minutes

/// Default token lifetime fallback when the provider omits `expires_in`.
const DEFAULT_FALLBACK_LIFETIME_SECS: u64 = 3600;

/// Maximum age of an expired token that is still eligible for refresh.
/// Both startup sweep and periodic tick use this same threshold so that no
/// credential falls through the gap between the two code paths.
const STALENESS_CEILING_SECS: i64 = 604800; // 7 days

/// Exponential backoff steps for failed OAuth refreshes (in seconds).
/// 15 min → 1 hr → 4 hr → 24 hr (capped).
const REFRESH_BACKOFF_STEPS: &[i64] = &[900, 3600, 14400, 86400];

/// Scan all credentials, find OAuth ones with tokens expiring soon, and refresh them.
pub async fn oauth_refresh_tick(pool: &DbPool, app: Option<&AppHandle>) {
    if let Err(e) = refresh_expiring_tokens(pool, app).await {
        tracing::warn!(error = %e, "OAuth refresh tick failed");
    }
}

/// Startup sweep: immediately refresh all OAuth credentials whose access tokens
/// have already expired or will expire within 5 minutes. This catches tokens
/// that expired while the app was closed (e.g., Google's 1-hour access tokens).
///
/// Returns `(refreshed, failed)` counts.
pub async fn startup_oauth_sweep(pool: &DbPool, app: Option<&AppHandle>) -> (u32, u32) {
    let all_creds = match cred_repo::get_all(pool) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "Startup OAuth sweep: failed to list credentials");
            return (0, 0);
        }
    };

    let now = chrono::Utc::now();
    // Wider window on startup: refresh anything expiring within 5 minutes or already expired
    let startup_threshold_secs: i64 = 300;
    let mut refreshed: u32 = 0;
    let mut failed: u32 = 0;

    for cred in &all_creds {
        let meta = parse_credential_metadata(cred);

        let expires_at = meta.as_ref().and_then(extract_expires_at);

        let Some(expires_at) = expires_at else {
            continue;
        };

        let remaining = expires_at.signed_duration_since(now);
        // Refresh if expired (up to STALENESS_CEILING) or expiring within threshold
        if remaining.num_seconds() > startup_threshold_secs || remaining.num_seconds() < -STALENESS_CEILING_SECS {
            continue;
        }

        tracing::info!(
            credential_id = %cred.id,
            credential_name = %cred.name,
            expires_in_secs = remaining.num_seconds(),
            "Startup OAuth sweep: refreshing expired/expiring token"
        );

        match refresh_single_credential(pool, cred).await {
            Ok(_) => {
                refreshed += 1;
                // Clear backoff on success, just like refresh_expiring_tokens does
                clear_refresh_backoff(pool, &cred.id);
            }
            Err(e) => {
                failed += 1;
                if matches!(e, AppError::OAuthRevoked(_)) {
                    tracing::warn!(
                        credential_id = %cred.id,
                        credential_name = %cred.name,
                        error = %e,
                        "Startup OAuth sweep: grant revoked — needs re-authorization"
                    );
                    mark_needs_reauth(pool, &cred.id);
                    emit_reauth_required(app, &cred.id, &cred.name, &cred.service_type, &e.to_string());
                } else {
                    tracing::warn!(
                        credential_id = %cred.id,
                        error = %e,
                        "Startup OAuth sweep: failed to refresh token"
                    );
                }
                // Set backoff so periodic tick doesn't immediately re-attempt a doomed refresh
                set_refresh_backoff(pool, &cred.id);
            }
        }
    }

    if refreshed > 0 || failed > 0 {
        tracing::info!(
            refreshed,
            failed,
            "Startup OAuth sweep: complete"
        );
    }

    (refreshed, failed)
}

async fn refresh_expiring_tokens(pool: &DbPool, app: Option<&AppHandle>) -> Result<(), AppError> {
    let all_creds = cred_repo::get_all(pool)?;
    let now = chrono::Utc::now();
    let total_scanned = all_creds.len();
    let mut oauth_eligible: usize = 0;
    let mut approaching_expiry: usize = 0;
    let mut refreshed: usize = 0;
    let mut failed: usize = 0;

    for cred in &all_creds {
        let meta = parse_credential_metadata(cred);

        let expires_at = meta.as_ref().and_then(extract_expires_at);

        let Some(expires_at) = expires_at else {
            continue;
        };

        oauth_eligible += 1;

        let remaining = expires_at.signed_duration_since(now);
        if remaining.num_seconds() > REFRESH_THRESHOLD_SECS || remaining.num_seconds() < -STALENESS_CEILING_SECS {
            // Not expiring soon, or expired beyond staleness ceiling (skip)
            continue;
        }

        approaching_expiry += 1;

        // Check backoff via typed ledger
        let ledger = parse_ledger(cred);
        if ledger.is_in_refresh_backoff() {
            tracing::debug!(
                credential_id = %cred.id,
                backoff_until = ?ledger.oauth_refresh_backoff_until,
                "Skipping OAuth refresh — credential is in backoff"
            );
            continue;
        }

        tracing::info!(
            credential_id = %cred.id,
            credential_name = %cred.name,
            expires_in_secs = remaining.num_seconds(),
            "Proactively refreshing OAuth token"
        );

        match refresh_single_credential(pool, cred).await {
            Ok(_) => {
                refreshed += 1;
                // Clear backoff on success
                clear_refresh_backoff(pool, &cred.id);
            }
            Err(e) => {
                failed += 1;

                // If the error is a revocation, mark the credential and notify the user
                if matches!(e, AppError::OAuthRevoked(_)) {
                    tracing::warn!(
                        credential_id = %cred.id,
                        credential_name = %cred.name,
                        error = %e,
                        "OAuth grant revoked — credential needs re-authorization"
                    );
                    mark_needs_reauth(pool, &cred.id);
                    emit_reauth_required(app, &cred.id, &cred.name, &cred.service_type, &e.to_string());
                } else {
                    tracing::warn!(
                        credential_id = %cred.id,
                        error = %e,
                        "Failed to proactively refresh OAuth token"
                    );
                }
                // Set exponential backoff so we don't retry a doomed refresh every tick
                set_refresh_backoff(pool, &cred.id);
            }
        }
    }

    tracing::info!(
        total_scanned,
        oauth_eligible,
        approaching_expiry,
        refreshed,
        failed,
        "OAuth refresh: tick complete",
    );

    Ok(())
}

/// Refresh a single credential's OAuth access token.
///
/// 1. Decrypt fields to get refresh_token
/// 2. Resolve the connector's strategy
/// 3. Use resolve_auth_token to get a fresh access_token
/// 4. Persist the new access_token to encrypted fields
/// 5. Update metadata with refresh stats
/// 6. Record token lifetime metrics
pub async fn refresh_single_credential(
    pool: &DbPool,
    cred: &crate::db::models::PersonaCredential,
) -> Result<String, AppError> {
    let fields = cred_repo::get_decrypted_fields(pool, cred)?;
    let _ = audit_log::log_decrypt(pool, &cred.id, &cred.name, "oauth_refresh", None, None);

    // Must have a refresh_token to refresh
    if !fields.contains_key("refresh_token") {
        return Err(AppError::Validation("No refresh_token found".into()));
    }

    // Extract the previous token's issued-at time from typed ledger (for actual lifetime calc)
    let ledger = parse_ledger(cred);

    let previous_refresh_at = ledger
        .oauth_last_refresh_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());

    let previous_predicted_secs = ledger.oauth_predicted_lifetime_secs;

    // Get connector metadata for strategy resolution
    let connector_meta = get_connector_metadata(pool, &cred.service_type);

    // Resolve strategy and get fresh token
    let registry = super::connector_strategy::registry()?;
    let strategy = registry.get(&cred.service_type, connector_meta.as_deref());

    if !strategy.is_oauth(&fields) {
        return Err(AppError::Validation("Credential is not OAuth".into()));
    }

    // resolve_auth_token will use the refresh_token to get a fresh access_token
    let resolve_result = strategy
        .resolve_auth_token(connector_meta.as_deref(), &fields)
        .await;

    // Record failure metric if the refresh attempt failed
    if let Err(ref e) = resolve_result {
        let _ = metrics_repo::insert(
            pool,
            &cred.id,
            &cred.service_type,
            None,
            None,
            None,
            false,
            false,
            Some(&e.to_string()),
        );
        tracing::warn!(
            credential_id = %cred.id,
            service_type = %cred.service_type,
            "OAuth refresh failed — metric recorded"
        );
    }

    let resolved = resolve_result?;

    let resolved = resolved.ok_or_else(|| {
        AppError::Internal("Strategy returned no token after refresh".into())
    })?;

    // Compute values needed for persistence before opening the transaction.
    let expiry_secs_for_field = resolved.expires_in_secs.unwrap_or(DEFAULT_FALLBACK_LIFETIME_SECS) as i64;
    let expires_at_rfc3339 = (chrono::Utc::now() + chrono::Duration::seconds(expiry_secs_for_field)).to_rfc3339();

    // Compute lifetime metrics
    let used_fallback = resolved.expires_in_secs.is_none();
    let expiry_secs = resolved.expires_in_secs.unwrap_or(DEFAULT_FALLBACK_LIFETIME_SECS) as i64;

    // Build the metadata patch using the typed ledger
    let current_count = ledger.oauth_refresh_count.unwrap_or(0);
    let new_expiry = (chrono::Utc::now() + chrono::Duration::seconds(expiry_secs)).to_rfc3339();

    // Build a JSON patch from the ledger fields for the atomic persist block
    let mut patch = serde_json::Map::new();
    patch.insert("oauth_refresh_count".to_string(), serde_json::json!(current_count + 1));
    patch.insert("oauth_last_refresh_at".to_string(), serde_json::json!(chrono::Utc::now().to_rfc3339()));
    patch.insert("oauth_predicted_lifetime_secs".to_string(), serde_json::json!(expiry_secs));
    patch.insert("oauth_token_expires_at".to_string(), serde_json::json!(new_expiry));
    // Clear any previous revocation flag on successful refresh
    patch.insert("needs_reauth".to_string(), serde_json::Value::Null);
    patch.insert("needs_reauth_at".to_string(), serde_json::Value::Null);

    // ---- Atomic persist block ------------------------------------------------
    // Wrap access_token, oauth_token_expires_at, rotated refresh_token, AND the
    // metadata patch in a single SQLite transaction.  This prevents credential
    // death when a crash occurs between persisting the new access_token and the
    // rotated refresh_token (the old one is already revoked server-side).
    {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        cred_repo::upsert_field_on_conn(&tx, &cred.id, "access_token", &resolved.token, true)?;
        cred_repo::upsert_field_on_conn(&tx, &cred.id, "oauth_token_expires_at", &expires_at_rfc3339, false)?;

        if let Some(ref new_refresh_token) = resolved.refresh_token {
            cred_repo::upsert_field_on_conn(&tx, &cred.id, "refresh_token", new_refresh_token, true)?;
        }

        cred_repo::patch_metadata_on_conn(&tx, &cred.id, patch)?;

        tx.commit()?;
    }
    // ---- End atomic persist block --------------------------------------------

    if let Some(ref _new_refresh_token) = resolved.refresh_token {
        tracing::info!(
            credential_id = %cred.id,
            service_type = %cred.service_type,
            "Rotated refresh_token persisted"
        );
    }

    // Actual lifetime: how long the previous token lived before we replaced it
    let actual_lifetime_secs = previous_refresh_at.map(|prev| {
        chrono::Utc::now()
            .signed_duration_since(prev)
            .num_seconds()
    });

    // Drift: actual − predicted (from the previous refresh's predicted value)
    let drift_secs = match (actual_lifetime_secs, previous_predicted_secs) {
        (Some(actual), Some(predicted)) => Some(actual - predicted),
        _ => None,
    };

    // Record the metric
    let _ = metrics_repo::insert(
        pool,
        &cred.id,
        &cred.service_type,
        Some(expiry_secs),
        actual_lifetime_secs,
        drift_secs,
        used_fallback,
        true,
        None,
    );

    if used_fallback {
        tracing::info!(
            credential_id = %cred.id,
            service_type = %cred.service_type,
            "Provider omitted expires_in — used {}s fallback",
            DEFAULT_FALLBACK_LIFETIME_SECS,
        );
    }

    if let Some(drift) = drift_secs {
        if drift < -300 {
            tracing::warn!(
                credential_id = %cred.id,
                service_type = %cred.service_type,
                drift_secs = drift,
                "Token expired significantly earlier than predicted (possible throttling)"
            );
        }
    }

    // Audit log
    let rt_rotated = resolved.refresh_token.is_some();
    let detail = if used_fallback {
        format!(
            "Proactive refresh (count: {}, fallback {}s, no provider expires_in{})",
            current_count + 1,
            DEFAULT_FALLBACK_LIFETIME_SECS,
            if rt_rotated { ", refresh_token rotated" } else { "" },
        )
    } else {
        format!(
            "Proactive refresh (count: {}, provider TTL: {}s{}{})",
            current_count + 1,
            expiry_secs,
            drift_secs
                .map(|d| format!(", drift: {}s", d))
                .unwrap_or_default(),
            if rt_rotated { ", refresh_token rotated" } else { "" },
        )
    };

    let _ = crate::db::repos::resources::audit_log::insert(
        pool,
        &cred.id,
        &cred.name,
        "oauth_token_refreshed",
        None,
        None,
        Some(&detail),
    );

    Ok(format!(
        "Token refreshed successfully (refresh #{}, expires in {}s)",
        current_count + 1,
        expiry_secs,
    ))
}

/// Set an exponential backoff timestamp on a credential after a failed OAuth refresh.
/// Uses an atomic read-increment-write to prevent concurrent callers from clobbering
/// each other's fail_count (e.g. startup sweep vs periodic tick overlap).
fn set_refresh_backoff(pool: &DbPool, credential_id: &str) {
    match cred_repo::increment_refresh_backoff_atomic(pool, credential_id, REFRESH_BACKOFF_STEPS) {
        Ok((new_fail_count, backoff_secs)) => {
            tracing::info!(
                credential_id = %credential_id,
                backoff_secs,
                fail_count = new_fail_count,
                "Set OAuth refresh backoff"
            );
        }
        Err(e) => {
            tracing::warn!(credential_id = %credential_id, error = %e, "Failed to set OAuth refresh backoff");
        }
    }
}

/// Clear the backoff fields after a successful OAuth refresh.
fn clear_refresh_backoff(pool: &DbPool, credential_id: &str) {
    if let Err(e) = cred_repo::update_ledger(pool, credential_id, |l| {
        l.clear_refresh_backoff();
    }) {
        tracing::warn!(credential_id = %credential_id, error = %e, "Failed to clear OAuth refresh backoff");
    }
}

/// Payload emitted when a credential's OAuth grant has been revoked and the
/// user must re-authorize. Listened to by the frontend to show a re-auth prompt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialReauthRequiredEvent {
    pub credential_id: String,
    pub credential_name: String,
    pub service_type: String,
    pub reason: String,
}

/// Mark a credential's metadata with `needs_reauth: true` so the frontend can
/// surface it even without a live event (e.g. on next app launch).
fn mark_needs_reauth(pool: &DbPool, credential_id: &str) {
    if let Err(e) = cred_repo::update_ledger(pool, credential_id, |l| {
        l.mark_needs_reauth();
    }) {
        tracing::warn!(credential_id = %credential_id, error = %e, "Failed to mark credential as needs_reauth");
    }
}

/// Emit a Tauri event and OS notification when OAuth re-authorization is required.
fn emit_reauth_required(
    app: Option<&AppHandle>,
    credential_id: &str,
    credential_name: &str,
    service_type: &str,
    reason: &str,
) {
    let Some(app) = app else { return };
    use crate::engine::event_registry::{emit_event, event_name};

    let payload = CredentialReauthRequiredEvent {
        credential_id: credential_id.to_string(),
        credential_name: credential_name.to_string(),
        service_type: service_type.to_string(),
        reason: reason.to_string(),
    };
    emit_event(app, event_name::CREDENTIAL_REAUTH_REQUIRED, &payload);

    // Also send an OS notification so the user sees it even if the app is in the background
    crate::notifications::send(
        app,
        "Credential needs re-authorization",
        &format!(
            "{} ({}) -- access was revoked. Open Vault to reconnect.",
            credential_name, service_type,
        ),
    );
}

/// Look up the connector_definitions row to get metadata for strategy resolution.
fn get_connector_metadata(pool: &DbPool, service_type: &str) -> Option<String> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT metadata FROM connector_definitions WHERE name = ?1",
        rusqlite::params![service_type],
        |row| row.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}
