//! Boot phase: encrypt-at-rest migrations for secrets written by older versions.

use crate::db::DbPool;
use crate::engine;
use crate::startup_timing::StartupTimer;

// Encrypt any legacy plaintext credentials
pub fn encrypt_legacy_secrets(pool: &DbPool, st: &mut StartupTimer) {
    match engine::crypto::migrate_plaintext_credentials(pool) {
        Ok((migrated, failed)) => {
            if migrated > 0 || failed > 0 {
                tracing::info!(
                    "Credential migration: {} encrypted, {} failed (unparseable rows remain unencrypted)",
                    migrated,
                    failed
                );
            }
        }
        Err(e) => {
            tracing::warn!("Credential migration skipped: {}", e);
        }
    }

    // Assure sensitive credential FIELDS are encrypted at rest for every
    // external connector (built-in personas-local connectors excluded).
    // This is the silent replacement for the removed user-facing
    // "encrypt now" vault badge — the vault stays fully encrypted with
    // no user action.
    match engine::crypto::assure_sensitive_fields_encrypted(pool) {
        Ok((reencrypted, failed)) => {
            if reencrypted > 0 || failed > 0 {
                tracing::info!(
                    "Credential field encryption assurance: {} re-encrypted, {} failed",
                    reencrypted,
                    failed
                );
            }
        }
        Err(e) => {
            tracing::warn!("Credential field encryption assurance skipped: {}", e);
        }
    }

    // Encrypt any legacy plaintext notification channel secrets
    match engine::crypto::migrate_plaintext_notification_secrets(pool) {
        Ok((migrated, skipped)) => {
            if migrated > 0 || skipped > 0 {
                tracing::info!(
                    "Notification channel secret migration: {} encrypted, {} skipped",
                    migrated,
                    skipped
                );
            }
        }
        Err(e) => {
            tracing::warn!("Notification channel secret migration skipped: {}", e);
        }
    }

    // Encrypt any legacy plaintext trigger config secrets (webhook_secret, polling headers)
    match engine::crypto::migrate_plaintext_trigger_secrets(pool) {
        Ok((migrated, skipped)) => {
            if migrated > 0 || skipped > 0 {
                tracing::info!(
                    "Trigger config secret migration: {} encrypted, {} skipped",
                    migrated,
                    skipped
                );
            }
        }
        Err(e) => {
            tracing::warn!("Trigger config secret migration skipped: {}", e);
        }
    }
    st.checkpoint("credential_migrations");
}

/// Move legacy `app_master_mandate:<project_id>` app_settings rows into the
/// `persona_responsibilities` table (living-agent WP3). Idempotent — a healthy
/// second boot migrates 0 — and deliberately BEFORE the local HTTP server and
/// every background loop starts, so no mandate reader ever races the move.
pub fn migrate_app_master_mandates(pool: &DbPool) {
    match personas_engine::responsibility::migrate_legacy_mandates(pool) {
        Ok(0) => {}
        Ok(n) => tracing::info!(
            migrated = n,
            "App master mandates migrated from app_settings to persona_responsibilities"
        ),
        Err(e) => tracing::warn!(
            error = %e,
            "App master mandate migration failed; legacy rows stay in app_settings \
             (mandate enforcement reads the table, so affected projects read as \
             unmandated until the next boot retries)"
        ),
    }
}
