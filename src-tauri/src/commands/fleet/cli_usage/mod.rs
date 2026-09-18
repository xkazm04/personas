//! Passive usage readers for the OTHER coding CLIs on this machine (Codex,
//! Grok), for the Monitor's usage strip.
//!
//! Strictly read-only and strictly informational: nothing here feeds
//! auto-rotate, `usage_governor` or pacing - those stay Claude-only. A
//! provider that cannot be read is a CARD STATE (`reason`), never an error:
//! the command always answers with one entry per provider.
//!
//! WP0 lands the wire types, the [`CliUsageReader`] seam and a stub command;
//! WP4 adds `codex.rs` / `grok.rs` readers and the cache.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Which CLI a usage card describes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CliProvider {
    Codex,
    Grok,
}

/// Why a provider has no usage windows to show.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CliUsageReason {
    /// The CLI is not on this machine.
    NotInstalled,
    /// The CLI is installed but exposes no quota we can read passively.
    NoQuotaSource,
    /// The CLI is installed but has never run a session here.
    NoSessions,
    /// A source exists but could not be parsed (format drift, truncated log).
    Unreadable,
}

/// One rate-limit window of a provider.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CliUsageWindow {
    /// `"primary"` or `"secondary"`.
    pub key: String,
    #[ts(type = "number")]
    pub window_minutes: i64,
    pub used_percent: f64,
    #[ts(type = "number | null")]
    pub resets_at_ms: Option<i64>,
}

/// One provider's card.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CliProviderUsage {
    pub provider: CliProvider,
    pub installed: bool,
    pub version: Option<String>,
    pub plan_type: Option<String>,
    pub windows: Vec<CliUsageWindow>,
    /// When the numbers were true (the source's own timestamp), epoch ms.
    #[ts(type = "number | null")]
    pub as_of_ms: Option<i64>,
    /// The source is older than a window reset, so `windows` is a projection
    /// past that reset rather than a reading.
    pub projected: bool,
    /// Why `windows` is empty, when it is.
    pub reason: Option<CliUsageReason>,
}

impl CliProviderUsage {
    /// The card for a provider whose CLI is absent.
    pub fn not_installed(provider: CliProvider) -> Self {
        Self {
            provider,
            installed: false,
            version: None,
            plan_type: None,
            windows: Vec::new(),
            as_of_ms: None,
            projected: false,
            reason: Some(CliUsageReason::NotInstalled),
        }
    }
}

/// Every provider's card, in display order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CliUsageSnapshot {
    pub providers: Vec<CliProviderUsage>,
}

/// One provider's passive reader. Infallible by contract: whatever goes wrong
/// is reported through [`CliProviderUsage::reason`].
pub trait CliUsageReader {
    fn read(&self) -> CliProviderUsage;
}

/// Placeholder reader: reports its provider as not installed.
struct AbsentReader(CliProvider);

impl CliUsageReader for AbsentReader {
    fn read(&self) -> CliProviderUsage {
        CliProviderUsage::not_installed(self.0)
    }
}

/// Codex + Grok usage as the Monitor's strip reads it.
#[tauri::command]
pub async fn fleet_cli_usage(
    state: State<'_, Arc<AppState>>,
) -> Result<CliUsageSnapshot, AppError> {
    require_auth(&state).await?;
    // WP4 fills this
    let readers: [&dyn CliUsageReader; 2] = [
        &AbsentReader(CliProvider::Codex),
        &AbsentReader(CliProvider::Grok),
    ];
    Ok(CliUsageSnapshot {
        providers: readers.iter().map(|r| r.read()).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_usage_wire_shape_is_camel_case_with_snake_case_vocabulary() {
        let card = CliProviderUsage {
            provider: CliProvider::Codex,
            installed: true,
            version: Some("0.153.4".into()),
            plan_type: Some("pro".into()),
            windows: vec![CliUsageWindow {
                key: "primary".into(),
                window_minutes: 300,
                used_percent: 12.5,
                resets_at_ms: None,
            }],
            as_of_ms: Some(1),
            projected: false,
            reason: None,
        };
        let v = serde_json::to_value(&card).expect("serializes");
        assert_eq!(v["provider"], "codex");
        assert_eq!(v["planType"], "pro");
        assert_eq!(v["asOfMs"], 1);
        assert_eq!(v["windows"][0]["windowMinutes"], 300);
        assert_eq!(v["windows"][0]["usedPercent"], 12.5);
        assert!(v["windows"][0]["resetsAtMs"].is_null());

        let absent = CliProviderUsage::not_installed(CliProvider::Grok);
        let v = serde_json::to_value(&absent).expect("serializes");
        assert_eq!(v["provider"], "grok");
        assert_eq!(v["installed"], false);
        assert_eq!(v["reason"], "not_installed");
        assert_eq!(
            serde_json::to_value(CliUsageReason::NoQuotaSource).expect("serializes"),
            "no_quota_source"
        );
    }
}
