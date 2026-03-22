//! Proactive OAuth token refresh engine.
//!
//! Scans all OAuth credentials for tokens approaching expiry and refreshes
//! them preemptively. Runs as a ReactiveSubscription every 5 minutes.
//!
//! Records per-refresh metrics (predicted vs actual lifetime, fallback usage,
//! failure rates) to the `oauth_token_metrics` table for observability.

use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::oauth_token_metrics as metrics_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Threshold: refresh tokens that expire within this many seconds.
const REFRESH_THRESHOLD_SECS: i64 = 900; // 15 minutes

/// Default token lifetime fallback when the provider omits `expires_in`.
const DEFAULT_FALLBACK_LIFETIME_SECS: u64 = 3600;

/// Scan all credentials, find OAuth ones with tokens expiring soon, and refresh them.
pub async fn oauth_refresh_tick(pool: &DbPool) {
    if let Err(e) = refresh_expiring_tokens(pool).await {
        tracing::warn!(error = %e, "OAuth refresh tick failed");
    }
}

/// Startup sweep: immediately refresh all OAuth credentials whose access tokens
/// have already expired or will expire within 5 minutes. This catches tokens
/// that expired while the app was closed (e.g., Google's 1-hour access tokens).
///
/// Returns `(refreshed, failed)` counts.
pub async fn startup_oauth_sweep(pool: &DbPool) -> (u32, u32) {
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
        let meta: Option<serde_json::Value> = cred
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());

        let expires_at = meta
            .as_ref()
            .and_then(|m| m.get("oauth_token_expires_at"))
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());

        let Some(expires_at) = expires_at else {
            continue;
        };

        let remaining = expires_at.signed_duration_since(now);
        // Refresh if expired (up to 7 days old) or expiring within threshold
        if remaining.num_seconds() > startup_threshold_secs || remaining.num_seconds() < -604800 {
            continue;
        }

        tracing::info!(
            credential_id = %cred.id,
            credential_name = %cred.name,
            expires_in_secs = remaining.num_seconds(),
            "Startup OAuth sweep: refreshing expired/expiring token"
        );

        match refresh_single_credential(pool, cred).await {
            Ok(_) => refreshed += 1,
            Err(e) => {
                failed += 1;
                tracing::warn!(
                    credential_id = %cred.id,
                    error = %e,
                    "Startup OAuth sweep: failed to refresh token"
                );
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

async fn refresh_expiring_tokens(pool: &DbPool) -> Result<(), AppError> {
    let all_creds = cred_repo::get_all(pool)?;
    let now = chrono::Utc::now();
    let total_scanned = all_creds.len();
    let mut oauth_eligible: usize = 0;
    let mut approaching_expiry: usize = 0;
    let mut refreshed: usize = 0;
    let mut failed: usize = 0;

    for cred in &all_creds {
        // Check metadata for oauth_token_expires_at
        let meta: Option<serde_json::Value> = cred
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());

        let expires_at = meta
            .as_ref()
            .and_then(|m| m.get("oauth_token_expires_at"))
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());

        let Some(expires_at) = expires_at else {
            continue;
        };

        oauth_eligible += 1;

        let remaining = expires_at.signed_duration_since(now);
        if remaining.num_seconds() > REFRESH_THRESHOLD_SECS || remaining.num_seconds() < -86400 {
            // Not expiring soon, or expired more than 24h ago (stale, skip)
            continue;
        }

        approaching_expiry += 1;

        tracing::info!(
            credential_id = %cred.id,
            credential_name = %cred.name,
            expires_in_secs = remaining.num_seconds(),
            "Proactively refreshing OAuth token"
        );

        match refresh_single_credential(pool, cred).await {
            Ok(_) => refreshed += 1,
            Err(e) => {
                failed += 1;
                tracing::warn!(
                    credential_id = %cred.id,
                    error = %e,
                    "Failed to proactively refresh OAuth token"
                );
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

    // Must have a refresh_token to refresh
    let has_refresh = fields.contains_key("refresh_token") || fields.contains_key("refreshToken");
    if !has_refresh {
        return Err(AppError::Validation("No refresh_token found".into()));
    }

    // Extract the previous token's issued-at time from metadata (for actual lifetime calc)
    let meta: Option<serde_json::Value> = cred
        .metadata
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    let previous_refresh_at = meta
        .as_ref()
        .and_then(|m| m.get("oauth_last_refresh_at"))
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());

    let previous_predicted_secs = meta
        .as_ref()
        .and_then(|m| m.get("oauth_predicted_lifetime_secs"))
        .and_then(|v| v.as_i64());

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

    // Persist the fresh access_token
    cred_repo::upsert_field(pool, &cred.id, "access_token", &resolved.token, true)?;

    // Compute lifetime metrics
    let used_fallback = resolved.expires_in_secs.is_none();
    let expiry_secs = resolved.expires_in_secs.unwrap_or(DEFAULT_FALLBACK_LIFETIME_SECS) as i64;

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

    // Update metadata with refresh stats
    let now = chrono::Utc::now().to_rfc3339();
    let mut patch = serde_json::Map::new();

    let current_count = cred
        .metadata
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|m| m.get("oauth_refresh_count").and_then(|v| v.as_u64()))
        .unwrap_or(0);

    patch.insert(
        "oauth_refresh_count".to_string(),
        serde_json::json!(current_count + 1),
    );
    patch.insert(
        "oauth_last_refresh_at".to_string(),
        serde_json::json!(now),
    );
    // Store the predicted lifetime so the next refresh can compute drift
    patch.insert(
        "oauth_predicted_lifetime_secs".to_string(),
        serde_json::json!(expiry_secs),
    );

    // Use the provider-reported expiry if available, otherwise fall back
    let new_expiry = (chrono::Utc::now() + chrono::Duration::seconds(expiry_secs)).to_rfc3339();
    patch.insert(
        "oauth_token_expires_at".to_string(),
        serde_json::json!(new_expiry),
    );

    cred_repo::patch_metadata_atomic(pool, &cred.id, patch)?;

    // Audit log
    let detail = if used_fallback {
        format!(
            "Proactive refresh (count: {}, fallback {}s, no provider expires_in)",
            current_count + 1,
            DEFAULT_FALLBACK_LIFETIME_SECS,
        )
    } else {
        format!(
            "Proactive refresh (count: {}, provider TTL: {}s{})",
            current_count + 1,
            expiry_secs,
            drift_secs
                .map(|d| format!(", drift: {}s", d))
                .unwrap_or_default(),
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
