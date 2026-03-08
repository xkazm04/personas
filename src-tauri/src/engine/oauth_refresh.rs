//! Proactive OAuth token refresh engine.
//!
//! Scans all OAuth credentials for tokens approaching expiry and refreshes
//! them preemptively. Runs as a ReactiveSubscription every 5 minutes.

use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Threshold: refresh tokens that expire within this many seconds.
const REFRESH_THRESHOLD_SECS: i64 = 900; // 15 minutes

/// Scan all credentials, find OAuth ones with tokens expiring soon, and refresh them.
pub async fn oauth_refresh_tick(pool: &DbPool) {
    if let Err(e) = refresh_expiring_tokens(pool).await {
        tracing::warn!(error = %e, "OAuth refresh tick failed");
    }
}

async fn refresh_expiring_tokens(pool: &DbPool) -> Result<(), AppError> {
    let all_creds = cred_repo::get_all(pool)?;
    let now = chrono::Utc::now();

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

        let remaining = expires_at.signed_duration_since(now);
        if remaining.num_seconds() > REFRESH_THRESHOLD_SECS || remaining.num_seconds() < -86400 {
            // Not expiring soon, or expired more than 24h ago (stale, skip)
            continue;
        }

        tracing::info!(
            credential_id = %cred.id,
            credential_name = %cred.name,
            expires_in_secs = remaining.num_seconds(),
            "Proactively refreshing OAuth token"
        );

        if let Err(e) = refresh_single_credential(pool, cred).await {
            tracing::warn!(
                credential_id = %cred.id,
                error = %e,
                "Failed to proactively refresh OAuth token"
            );
        }
    }

    Ok(())
}

/// Refresh a single credential's OAuth access token.
///
/// 1. Decrypt fields to get refresh_token
/// 2. Resolve the connector's strategy
/// 3. Use resolve_auth_token to get a fresh access_token
/// 4. Persist the new access_token to encrypted fields
/// 5. Update metadata with refresh stats
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

    // Get connector metadata for strategy resolution
    let connector_meta = get_connector_metadata(pool, &cred.service_type);

    // Resolve strategy and get fresh token
    let registry = super::connector_strategy::registry()?;
    let strategy = registry.get(&cred.service_type, connector_meta.as_deref());

    if !strategy.is_oauth(&fields) {
        return Err(AppError::Validation("Credential is not OAuth".into()));
    }

    // resolve_auth_token will use the refresh_token to get a fresh access_token
    let fresh_token = strategy
        .resolve_auth_token(connector_meta.as_deref(), &fields)
        .await?;

    let fresh_token = fresh_token.ok_or_else(|| {
        AppError::Internal("Strategy returned no token after refresh".into())
    })?;

    // Persist the fresh access_token
    cred_repo::upsert_field(pool, &cred.id, "access_token", &fresh_token, true)?;

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

    // Estimate new expiry (most OAuth providers give 1h tokens)
    let new_expiry = (chrono::Utc::now() + chrono::Duration::seconds(3600)).to_rfc3339();
    patch.insert(
        "oauth_token_expires_at".to_string(),
        serde_json::json!(new_expiry),
    );

    cred_repo::patch_metadata_atomic(pool, &cred.id, patch)?;

    // Audit log
    let _ = crate::db::repos::resources::audit_log::insert(
        pool,
        &cred.id,
        &cred.name,
        "oauth_token_refreshed",
        None,
        None,
        Some(&format!(
            "Proactive refresh (count: {})",
            current_count + 1
        )),
    );

    Ok(format!(
        "Token refreshed successfully (refresh #{})",
        current_count + 1
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
