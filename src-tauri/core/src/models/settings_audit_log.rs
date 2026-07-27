use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single entry in the immutable settings audit log.
///
/// Every settings mutation that calls into `commands/infrastructure/settings.rs`,
/// `commands/credentials/external_api_keys.rs`, and (over time) every other
/// settings-mutating IPC writes one row here. Append-only; UI surfaces it via
/// the Settings → History tab.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SettingsAuditEntry {
    pub id: String,
    /// High-level grouping that matches Settings sub-modules:
    /// `"api_keys" | "notifications" | "appearance" | "engine" | "byom" |
    /// "portability" | "account" | "admin" | "config" | "quality_gates"`.
    /// New surfaces add new categories without a migration.
    pub category: String,
    /// Specific knob touched, e.g. `"create"`, `"revoke"`, the
    /// `app_settings.key`, or `"providers.allow_list"`. Free-form so each
    /// category can pick a shape that reads well in the History table.
    pub setting_key: String,
    /// Action verb: `"create" | "update" | "delete" | "revoke" | "toggle"`.
    /// Renders as a colored badge in the UI.
    pub action: String,
    /// Prior value (sanitized) when meaningful. `None` for `"create"`.
    pub before_value: Option<String>,
    /// New value (sanitized) when meaningful. `None` for `"delete"` /
    /// `"revoke"`.
    pub after_value: Option<String>,
    /// Caller surface: `"ui"` (Tauri IPC from desktop renderer), `"http"`
    /// (management HTTP API), `"cli"`, `"system"`. `None` when origin
    /// cannot be determined.
    pub actor: Option<String>,
    pub created_at: String,
}
