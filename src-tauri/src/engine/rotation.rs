//! Credential rotation engine.
//!
//! Evaluates rotation policies, refreshes OAuth tokens, runs healthchecks,
//! and records rotation history. Integrated into the scheduler background loop.

use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::rotation as rotation_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::healthcheck;

/// Evaluate all due rotation policies and execute rotations.
/// Called periodically from the background scheduler loop.
pub async fn evaluate_due_rotations(pool: &DbPool) {
    let now = chrono::Utc::now().to_rfc3339();

    let due_policies = match rotation_repo::get_due_policies(pool, &now) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Rotation: failed to query due policies: {}", e);
            return;
        }
    };

    if due_policies.is_empty() {
        return;
    }

    tracing::info!(
        count = due_policies.len(),
        "Rotation: evaluating {} due policies",
        due_policies.len()
    );

    for policy in &due_policies {
        let credential = match cred_repo::get_by_id(pool, &policy.credential_id) {
            Ok(c) => c,
            Err(_) => {
                tracing::warn!(
                    policy_id = %policy.id,
                    credential_id = %policy.credential_id,
                    "Rotation: credential not found, skipping"
                );
                let _ = rotation_repo::record_rotation(
                    pool,
                    &policy.credential_id,
                    &policy.policy_type,
                    "skipped",
                    Some("Credential not found"),
                );
                continue;
            }
        };

        // Determine rotation strategy based on credential type
        let is_oauth = credential.service_type.contains("google")
            || credential.service_type.contains("oauth")
            || has_refresh_token(pool, &credential);

        let result = if is_oauth {
            rotate_oauth_credential(pool, &credential).await
        } else {
            rotate_api_key_credential(pool, &credential).await
        };

        match result {
            Ok(detail) => {
                let _ = rotation_repo::record_rotation(
                    pool,
                    &policy.credential_id,
                    &policy.policy_type,
                    "success",
                    Some(&detail),
                );
                let _ = rotation_repo::mark_rotated(pool, &policy.id);
                tracing::info!(
                    credential_id = %policy.credential_id,
                    "Rotation: successful — {}",
                    detail
                );
            }
            Err(e) => {
                let msg = e.to_string();
                let _ = rotation_repo::record_rotation(
                    pool,
                    &policy.credential_id,
                    &policy.policy_type,
                    "failed",
                    Some(&msg),
                );
                // Still advance the schedule so we don't retry every tick
                let _ = rotation_repo::mark_rotated(pool, &policy.id);
                tracing::warn!(
                    credential_id = %policy.credential_id,
                    "Rotation: failed — {}",
                    msg
                );
            }
        }
    }
}

/// Check for anomalies: credentials that suddenly fail after being healthy.
pub async fn detect_anomalies(pool: &DbPool) {
    let credentials = match cred_repo::get_all(pool) {
        Ok(c) => c,
        Err(_) => return,
    };

    for cred in &credentials {
        // Parse metadata to check last healthcheck status
        let metadata: serde_json::Value = cred
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);

        let last_success = metadata
            .get("healthcheck_last_success")
            .and_then(|v| v.as_bool());

        // If credential was previously healthy but now failing, that's an anomaly
        if last_success == Some(false) {
            let last_success_at = metadata
                .get("healthcheck_last_success_at")
                .and_then(|v| v.as_str());

            if last_success_at.is_some() {
                // Had a success before but now failing → anomaly
                let history = rotation_repo::get_history(pool, &cred.id, Some(1)).unwrap_or_default();
                let already_recorded = history
                    .first()
                    .is_some_and(|h| h.rotation_type == "anomaly");

                if !already_recorded {
                    let _ = rotation_repo::record_rotation(
                        pool,
                        &cred.id,
                        "anomaly",
                        "failed",
                        Some("Credential suddenly failing after previous success — possible revocation"),
                    );
                    tracing::warn!(
                        credential_id = %cred.id,
                        name = %cred.name,
                        "Rotation anomaly: credential failing after previous success"
                    );
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// OAuth credential rotation (token refresh)
// ---------------------------------------------------------------------------

async fn rotate_oauth_credential(
    pool: &DbPool,
    credential: &crate::db::models::PersonaCredential,
) -> Result<String, AppError> {
    // Run healthcheck to refresh the token (healthcheck already handles refresh)
    let result = healthcheck::run_healthcheck(pool, &credential.id).await?;

    if result.success {
        Ok(format!("OAuth token refreshed and verified: {}", result.message))
    } else {
        Err(AppError::Internal(format!(
            "OAuth healthcheck failed after refresh: {}",
            result.message
        )))
    }
}

// ---------------------------------------------------------------------------
// API key rotation (healthcheck-only verification)
// ---------------------------------------------------------------------------

async fn rotate_api_key_credential(
    pool: &DbPool,
    credential: &crate::db::models::PersonaCredential,
) -> Result<String, AppError> {
    // For API keys, we verify the current key still works via healthcheck.
    // Full programmatic key rotation via provider APIs would require
    // provider-specific logic; for now we verify + record.
    let result = healthcheck::run_healthcheck(pool, &credential.id).await?;

    if result.success {
        Ok(format!("API key verified healthy: {}", result.message))
    } else {
        Err(AppError::Internal(format!(
            "API key healthcheck failed: {}",
            result.message
        )))
    }
}

// ---------------------------------------------------------------------------
// Manual rotation trigger
// ---------------------------------------------------------------------------

/// Trigger an immediate rotation for a credential (manual or event-driven).
pub async fn rotate_now(
    pool: &DbPool,
    credential_id: &str,
    rotation_type: &str,
) -> Result<String, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    let is_oauth = credential.service_type.contains("google")
        || credential.service_type.contains("oauth")
        || has_refresh_token(pool, &credential);

    let result = if is_oauth {
        rotate_oauth_credential(pool, &credential).await
    } else {
        rotate_api_key_credential(pool, &credential).await
    };

    match &result {
        Ok(detail) => {
            let _ = rotation_repo::record_rotation(
                pool,
                credential_id,
                rotation_type,
                "success",
                Some(detail),
            );
            // Update all enabled policies for this credential
            let policies = rotation_repo::get_policies_by_credential(pool, credential_id)
                .unwrap_or_default();
            for policy in &policies {
                if policy.enabled {
                    let _ = rotation_repo::mark_rotated(pool, &policy.id);
                }
            }
        }
        Err(e) => {
            let _ = rotation_repo::record_rotation(
                pool,
                credential_id,
                rotation_type,
                "failed",
                Some(&e.to_string()),
            );
        }
    }

    result
}

/// Get a summary of rotation status for a credential.
pub fn get_rotation_status(
    pool: &DbPool,
    credential_id: &str,
) -> Result<RotationStatus, AppError> {
    let policies = rotation_repo::get_policies_by_credential(pool, credential_id)?;
    let history = rotation_repo::get_history(pool, credential_id, Some(10))?;

    let active_policy = policies.iter().find(|p| p.enabled && p.policy_type == "scheduled");

    let next_rotation_at = active_policy.and_then(|p| p.next_rotation_at.clone());
    let last_rotated_at = active_policy.and_then(|p| p.last_rotated_at.clone());
    let rotation_interval_days = active_policy.map(|p| p.rotation_interval_days);
    let has_policy = !policies.is_empty();
    let policy_enabled = active_policy.is_some();

    let last_status = history.first().map(|h| h.status.clone());
    let anomaly_detected = history.iter().any(|h| h.rotation_type == "anomaly");

    Ok(RotationStatus {
        has_policy,
        policy_enabled,
        rotation_interval_days,
        next_rotation_at,
        last_rotated_at,
        last_status,
        anomaly_detected,
        recent_history: history,
    })
}

#[derive(Debug, serde::Serialize)]
pub struct RotationStatus {
    pub has_policy: bool,
    pub policy_enabled: bool,
    pub rotation_interval_days: Option<i32>,
    pub next_rotation_at: Option<String>,
    pub last_rotated_at: Option<String>,
    pub last_status: Option<String>,
    pub anomaly_detected: bool,
    pub recent_history: Vec<crate::db::models::CredentialRotationEntry>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn has_refresh_token(
    _pool: &DbPool,
    credential: &crate::db::models::PersonaCredential,
) -> bool {
    use super::crypto;
    let fields: std::collections::HashMap<String, String> = if crypto::is_plaintext(&credential.iv) {
        serde_json::from_str(&credential.encrypted_data).unwrap_or_default()
    } else {
        crypto::decrypt_from_db(&credential.encrypted_data, &credential.iv)
            .ok()
            .and_then(|plain| serde_json::from_str(&plain).ok())
            .unwrap_or_default()
    };

    fields.contains_key("refresh_token") || fields.contains_key("refreshToken")
}
