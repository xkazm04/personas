//! Typed credential metadata ledger.
//!
//! Replaces the schemaless JSON blob on `PersonaCredential.metadata` with a
//! strongly-typed struct. Each section has its own merge strategy so that
//! concurrent subsystems (healthcheck, rotation, OAuth refresh, usage tracking)
//! can update their slice without racing on the same opaque column.
//!
//! The struct serializes to the **same flat JSON layout** as the legacy
//! metadata, so existing rows deserialize without migration.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Healthcheck ring buffer entry (model-layer type)
// ---------------------------------------------------------------------------

/// A single healthcheck result stored in the credential's ring buffer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LedgerHealthEntry {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_class: Option<String>,
    pub message: String,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// Anomaly score snapshot (model-layer type)
// ---------------------------------------------------------------------------

/// Computed anomaly scores for a credential, persisted in the ledger.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LedgerAnomalyScore {
    pub failure_rate_total: f64,
    pub failure_rate_5m: f64,
    pub failure_rate_1h: f64,
    pub failure_rate_24h: f64,
    pub permanent_failure_rate_1h: f64,
    pub transient_failure_rate_1h: f64,
    pub remediation: String,
    pub sample_count: usize,
    pub data_stale: bool,
}

// ---------------------------------------------------------------------------
// CredentialLedger — the typed replacement for Option<String> metadata
// ---------------------------------------------------------------------------

/// Typed metadata ledger for a credential. Sections are logically grouped but
/// stored as a flat JSON object for backward compatibility with existing rows.
///
/// ## Sections
///
/// - **Health ring buffer**: `healthcheck_results`, `healthcheck_last_success`,
///   `healthcheck_last_success_at`, `anomaly_score`, `anomaly_tolerance`, `environment`
/// - **OAuth lifecycle**: `oauth_token_expires_at`, `oauth_refresh_count`, etc.
/// - **Usage tracking**: `usage_count`, `last_used_at`
/// - **Custom hints**: any other keys (imported_from, source, auth_type, …)
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(default)]
pub struct CredentialLedger {
    // ── Health ring buffer ──────────────────────────────────────────────
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub healthcheck_results: Vec<LedgerHealthEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub healthcheck_last_success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub healthcheck_last_success_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anomaly_score: Option<LedgerAnomalyScore>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anomaly_tolerance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,

    // ── OAuth lifecycle ─────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_token_expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_refresh_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_last_refresh_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_predicted_lifetime_secs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_refresh_backoff_until: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_refresh_fail_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_reauth: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_reauth_at: Option<String>,

    // ── Usage tracking ──────────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,

    // ── Custom / integration hints ──────────────────────────────────────
    /// Catch-all for unrecognized keys (imported_from, source, auth_type,
    /// spec_version, spec_format, healthcheck_config, kb_id, etc.).
    #[serde(flatten)]
    #[ts(skip)]
    pub custom: HashMap<String, serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Parsing & serialization
// ---------------------------------------------------------------------------

impl CredentialLedger {
    /// Parse a ledger from the raw `metadata` column (`Option<String>`).
    /// Returns `Default` if the column is `None` or contains invalid JSON.
    pub fn parse(raw: Option<&str>) -> Self {
        raw.and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default()
    }

    /// Serialize the ledger back to a JSON string for persistence.
    pub fn to_json_string(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Convert to a `serde_json::Value` (Object).
    pub fn to_value(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Object(Default::default()))
    }

    // ── Section-level merge helpers ─────────────────────────────────────

    /// Merge only the health section from `other`, leaving all other
    /// sections untouched. Used by the healthcheck subsystem.
    pub fn merge_health(&mut self, other: &CredentialLedger) {
        self.healthcheck_results = other.healthcheck_results.clone();
        self.healthcheck_last_success = other.healthcheck_last_success;
        self.healthcheck_last_success_at = other.healthcheck_last_success_at.clone();
        self.anomaly_score = other.anomaly_score.clone();
        self.anomaly_tolerance = other.anomaly_tolerance;
        self.environment = other.environment.clone();
    }

    /// Merge only the OAuth section from `other`.
    /// Used by the OAuth refresh engine.
    pub fn merge_oauth(&mut self, other: &CredentialLedger) {
        self.oauth_token_expires_at = other.oauth_token_expires_at.clone();
        self.oauth_refresh_count = other.oauth_refresh_count;
        self.oauth_last_refresh_at = other.oauth_last_refresh_at.clone();
        self.oauth_predicted_lifetime_secs = other.oauth_predicted_lifetime_secs;
        self.oauth_refresh_backoff_until = other.oauth_refresh_backoff_until.clone();
        self.oauth_refresh_fail_count = other.oauth_refresh_fail_count;
        self.needs_reauth = other.needs_reauth;
        self.needs_reauth_at = other.needs_reauth_at.clone();
    }

    /// Merge only the usage section from `other`.
    /// Used by the usage tracking subsystem.
    pub fn merge_usage(&mut self, other: &CredentialLedger) {
        self.usage_count = other.usage_count;
        self.last_used_at = other.last_used_at.clone();
    }

    // ── Convenience accessors ───────────────────────────────────────────

    /// Resolve the anomaly tolerance, falling back to environment hints
    /// and then to a default value.
    pub fn resolve_tolerance(&self) -> f64 {
        if let Some(t) = self.anomaly_tolerance {
            return t.clamp(0.0, 1.0);
        }
        if let Some(ref env) = self.environment {
            return match env.as_str() {
                "production" | "prod" => 0.05,
                "development" | "dev" | "staging" => 0.50,
                _ => 0.8,
            };
        }
        0.8 // DEFAULT_PERMANENT_FAILURE_THRESHOLD
    }

    /// Parse `oauth_token_expires_at` into a chrono DateTime, if present and valid.
    pub fn oauth_expires_at(&self) -> Option<chrono::DateTime<chrono::FixedOffset>> {
        self.oauth_token_expires_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    }

    /// Check if the credential is in OAuth refresh backoff.
    pub fn is_in_refresh_backoff(&self) -> bool {
        self.oauth_refresh_backoff_until
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|until| until > chrono::Utc::now())
            .unwrap_or(false)
    }

    /// Increment oauth_refresh_fail_count and compute exponential backoff.
    /// Returns `(new_fail_count, backoff_secs)`.
    pub fn increment_refresh_backoff(&mut self, backoff_steps: &[i64]) -> (u64, i64) {
        let fail_count = self.oauth_refresh_fail_count.unwrap_or(0);
        let new_fail_count = fail_count + 1;
        let step_idx = (fail_count as usize).min(backoff_steps.len() - 1);
        let backoff_secs = backoff_steps[step_idx];
        let backoff_until =
            (chrono::Utc::now() + chrono::Duration::seconds(backoff_secs)).to_rfc3339();

        self.oauth_refresh_fail_count = Some(new_fail_count);
        self.oauth_refresh_backoff_until = Some(backoff_until);
        (new_fail_count, backoff_secs)
    }

    /// Clear OAuth refresh backoff fields after a successful refresh.
    pub fn clear_refresh_backoff(&mut self) {
        self.oauth_refresh_backoff_until = None;
        self.oauth_refresh_fail_count = None;
    }

    /// Mark the credential as needing re-authorization.
    pub fn mark_needs_reauth(&mut self) {
        self.needs_reauth = Some(true);
        self.needs_reauth_at = Some(chrono::Utc::now().to_rfc3339());
    }

    /// Clear the needs_reauth flag (e.g., after successful refresh).
    pub fn clear_needs_reauth(&mut self) {
        self.needs_reauth = None;
        self.needs_reauth_at = None;
    }

    /// Record an OAuth token refresh in the ledger.
    pub fn record_oauth_refresh(&mut self, expires_at: &str, predicted_lifetime_secs: i64) {
        let count = self.oauth_refresh_count.unwrap_or(0);
        self.oauth_refresh_count = Some(count + 1);
        self.oauth_last_refresh_at = Some(chrono::Utc::now().to_rfc3339());
        self.oauth_predicted_lifetime_secs = Some(predicted_lifetime_secs);
        self.oauth_token_expires_at = Some(expires_at.to_string());
        self.clear_needs_reauth();
    }

    /// Increment usage counter and update last_used_at.
    pub fn record_usage(&mut self) {
        let count = self.usage_count.unwrap_or(0);
        self.usage_count = Some(count + 1);
        self.last_used_at = Some(chrono::Utc::now().to_rfc3339());
    }
}
