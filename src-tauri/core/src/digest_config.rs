//! Shape of the `performance_digest` app-settings value.
//!
//! Only the config struct lives here, not the digest engine — `db::settings_keys`
//! validates the stored JSON against it, and the digest engine itself depends on
//! `notifications`, which sits above the data layer.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// User-configurable digest settings, stored as JSON under the
/// `performance_digest` app_settings key.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DigestConfig {
    /// Whether the digest is enabled.
    pub enabled: bool,
    /// Cadence: "daily" or "weekly".
    pub cadence: String,
    /// JSON array of notification channels (same format as persona notification_channels).
    /// When empty, only OS notifications are sent.
    #[serde(default)]
    pub channels: Option<String>,
}

impl Default for DigestConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cadence: "weekly".to_string(),
            channels: None,
        }
    }
}
