use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single OAuth token refresh metric record.
///
/// Tracks predicted vs actual token lifetime, fallback usage, refresh
/// failures, and provider-reported lifetime drift over time.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenMetric {
    pub id: String,
    pub credential_id: String,
    pub service_type: String,
    /// Seconds the provider said the token would last (from `expires_in`).
    /// `None` when the provider omitted the field and the 3600s fallback was used.
    pub predicted_lifetime_secs: Option<i64>,
    /// Seconds the token actually lived before this refresh replaced it.
    /// Computed as (refresh_time − previous_token_issued_at).
    /// `None` on the first refresh for a credential (no prior baseline).
    pub actual_lifetime_secs: Option<i64>,
    /// Drift in seconds: actual − predicted. Positive means the token lasted
    /// longer than predicted, negative means it expired earlier.
    pub drift_secs: Option<i64>,
    /// Whether the 3600s default fallback was used because the provider
    /// did not include `expires_in` in the token response.
    pub used_fallback: bool,
    /// Whether this refresh attempt succeeded.
    pub success: bool,
    /// Error message if the refresh failed.
    pub error_message: Option<String>,
    pub created_at: String,
}

/// Aggregated token lifetime stats for a single credential.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenLifetimeSummary {
    pub credential_id: String,
    pub service_type: String,
    /// Total refresh attempts tracked.
    pub total_refreshes: u32,
    /// How many times the 3600s fallback was used.
    pub fallback_count: u32,
    /// How many refreshes failed.
    pub failure_count: u32,
    /// Average predicted lifetime in seconds (provider-reported).
    pub avg_predicted_lifetime_secs: Option<f64>,
    /// Average actual lifetime in seconds.
    pub avg_actual_lifetime_secs: Option<f64>,
    /// Average drift (actual − predicted) in seconds.
    pub avg_drift_secs: Option<f64>,
    /// Most recent predicted lifetime.
    pub latest_predicted_lifetime_secs: Option<i64>,
    /// Most recent actual lifetime.
    pub latest_actual_lifetime_secs: Option<i64>,
    /// Whether lifetime is trending shorter (potential throttling signal).
    pub lifetime_trending_shorter: bool,
    /// Last 5 predicted lifetimes (newest first) for trend detection.
    pub recent_predicted_lifetimes: Vec<i64>,
}
