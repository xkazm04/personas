//! Passive usage readers for the OTHER coding CLIs on this machine (Codex,
//! Grok, Antigravity), for the Monitor's usage strip.
//!
//! Strictly read-only and strictly informational: nothing here feeds
//! auto-rotate, `usage_governor` or pacing - those stay Claude-only. A
//! provider that cannot be read is a CARD STATE (`reason`), never an error:
//! the command always answers with one entry per provider.
//!
//! [`codex`] reads the CLI's own session logs; [`grok`] reports presence
//! only; [`agy`] asks the CLI's own free `/quota` command. All sit behind
//! in-memory caches, so any number of open Monitors cost one disk walk (and at
//! most one `agy` spawn per [`AGY_TTL`]).

mod agy;
mod codex;
mod grok;

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

use codex::CodexReader;
use grok::GrokReader;

/// Same cadence as `claude_usage`: the strip polls once a minute.
const CACHE_TTL: Duration = Duration::from_secs(45);
/// The Grok probe spawns processes (`--version`, `models`), and whether a CLI
/// is installed does not change minute to minute.
const GROK_PROBE_TTL: Duration = Duration::from_secs(600);
/// `agy -p "/quota"` is a process spawn (free of quota, not of latency), so it
/// is polled slower than the strip's cadence. Its figures move with use, and a
/// 5-hour bucket does not need sub-minute freshness.
const AGY_TTL: Duration = Duration::from_secs(120);
/// `/quota` answers in well under a second; a spawn that has not by now is hung.
const AGY_TIMEOUT: Duration = Duration::from_secs(15);

/// Which CLI a usage card describes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CliProvider {
    Codex,
    Grok,
    Agy,
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
    /// The model group the window belongs to, for a provider that meters
    /// several (`agy`: "Gemini Models", "Claude and GPT models"). The strip
    /// paints one plan per group. Absent for a provider with a single plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group: Option<String>,
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

    /// A card with no windows, and why.
    pub(crate) fn absent(provider: CliProvider, installed: bool, reason: CliUsageReason) -> Self {
        Self {
            installed,
            reason: Some(reason),
            ..Self::not_installed(provider)
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

type Cached<T> = Mutex<Option<(Instant, T)>>;

fn fresh<T: Clone>(cell: &Cached<T>, ttl: Duration) -> Option<T> {
    let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .as_ref()
        .filter(|(at, _)| at.elapsed() < ttl)
        .map(|(_, v)| v.clone())
}

fn store<T>(cell: &Cached<T>, value: T) {
    *cell.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), value));
}

fn snapshot_cache() -> &'static Cached<CliUsageSnapshot> {
    static C: OnceLock<Cached<CliUsageSnapshot>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

fn grok_cache() -> &'static Cached<CliProviderUsage> {
    static C: OnceLock<Cached<CliProviderUsage>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

async fn grok_card() -> CliProviderUsage {
    if let Some(card) = fresh(grok_cache(), GROK_PROBE_TTL) {
        return card;
    }
    let probe = crate::companion::session::probe_engines().await;
    let card = GrokReader::from_probe(&probe).read();
    store(grok_cache(), card.clone());
    card
}

async fn agy_cache_card() -> CliProviderUsage {
    if let Some(card) = fresh(agy_cache(), AGY_TTL) {
        return card;
    }
    let card = agy_card().await;
    store(agy_cache(), card.clone());
    card
}

fn agy_cache() -> &'static Cached<CliProviderUsage> {
    static C: OnceLock<Cached<CliProviderUsage>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

/// Spawn `agy -p "/quota" --output-format json` and shape the reply. The argv
/// goes through `capture_output` as an ARRAY: no shell sees `/quota`, so no
/// MSYS path rewrite can turn it into a real (billed) prompt.
async fn agy_card() -> CliProviderUsage {
    use personas_core::types::CliArgs;

    let Some(exe) = agy::resolve_agy_exe() else {
        return CliProviderUsage::not_installed(CliProvider::Agy);
    };
    let cli_args = CliArgs {
        command: exe.to_string_lossy().into_owned(),
        args: agy::QUOTA_ARGS.iter().map(|a| (*a).to_string()).collect(),
        env_overrides: Vec::new(),
        env_removals: Vec::new(),
        cwd: Some(std::env::temp_dir()),
    };
    match crate::engine::cli_process::capture_output(&cli_args, AGY_TIMEOUT).await {
        Ok(out) if out.status.success() => agy::card_from_reply_now(&out.stdout),
        Ok(_) | Err(_) => {
            CliProviderUsage::absent(CliProvider::Agy, true, CliUsageReason::Unreadable)
        }
    }
}

async fn codex_card() -> CliProviderUsage {
    // A directory walk plus file reads: off the async runtime. A panicked
    // read is a card state like any other failure.
    tokio::task::spawn_blocking(|| CodexReader::from_env().read())
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(panicked = e.is_panic(), "codex usage: reader task failed");
            CliProviderUsage::absent(CliProvider::Codex, true, CliUsageReason::Unreadable)
        })
}

/// `[codex, grok, agy]`, cached for [`CACHE_TTL`]. Unreadable states are cached
/// too: a missing CLI must not be re-probed by every poll.
async fn cached_snapshot() -> CliUsageSnapshot {
    if let Some(snap) = fresh(snapshot_cache(), CACHE_TTL) {
        return snap;
    }
    let (codex, grok, agy) = tokio::join!(codex_card(), grok_card(), agy_cache_card());
    let snap = CliUsageSnapshot {
        providers: vec![codex, grok, agy],
    };
    store(snapshot_cache(), snap.clone());
    snap
}

/// Codex + Grok + Antigravity usage as the Monitor's strip reads it.
#[tauri::command]
pub async fn fleet_cli_usage(
    state: State<'_, Arc<AppState>>,
) -> Result<CliUsageSnapshot, AppError> {
    require_auth(&state).await?;
    Ok(cached_snapshot().await)
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
                group: None,
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
        // `group` is absent, not null, for a single-plan provider.
        assert!(v["windows"][0].get("group").is_none());
        assert_eq!(
            serde_json::to_value(CliProvider::Agy).expect("serializes"),
            "agy"
        );

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
