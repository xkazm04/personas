//! Claude subscription usage — the Activity board's usage strip.
//!
//! A monthly Claude subscription is rate-limited on two rolling windows: a
//! **5-hour** session window and a **7-day** window (the weekly one may be
//! reported per model family as well). Anthropic exposes the live utilisation
//! of each window to a signed-in Claude Code install through its OAuth usage
//! endpoint, and that is what this module reads — the same endpoint the
//! community usage monitors (Claude-Code-Usage-Monitor's `--api` mode,
//! ccusage's `statusline`) opt into. It is the only source that knows the
//! subscription's real ceilings: a transcript scan can count tokens, but the
//! limit itself is not in any file on disk, which is why the JSONL-based
//! estimates those tools fall back on are plan tables with `P90` guesses.
//!
//! WHAT LEAVES THE MACHINE, AND WHERE. The OAuth access token is read from the
//! CLI's own credential store (`~/.claude/.credentials.json`, or the
//! `CLAUDE_CODE_OAUTH_TOKEN` override) and sent to exactly one host: the one
//! that issued it. It is never returned over IPC, never logged, and never
//! written anywhere. The frontend receives percentages and timestamps.
//!
//! An account with no OAuth login (API-key users, a macOS install whose token
//! lives in the Keychain rather than the file) is a STATE, not an error: the
//! command answers `available: false` with a machine reason and the strip
//! renders a calm "unavailable" chip. Only an auth failure of the app itself
//! is an `Err`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use crate::SHARED_HTTP;

/// Anthropic's OAuth usage endpoint. Undocumented but stable since 2025-04;
/// the beta header is the one Claude Code itself sends.
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";

/// The strip polls once a minute; the endpoint itself is rate-limited and a
/// second Monitor (or a second window) must not double the traffic.
const CACHE_TTL: Duration = Duration::from_secs(45);

const HOUR_MS: i64 = 3_600_000;
const FIVE_HOUR_MS: i64 = 5 * HOUR_MS;
const SEVEN_DAY_MS: i64 = 7 * 24 * HOUR_MS;

/// The windows the endpoint may report, in display order. Unknown keys in the
/// response are ignored rather than surfaced — a new window the strip has no
/// label for would render as a raw token.
const WINDOW_KEYS: [(&str, i64); 4] = [
    ("five_hour", FIVE_HOUR_MS),
    ("seven_day", SEVEN_DAY_MS),
    ("seven_day_opus", SEVEN_DAY_MS),
    ("seven_day_sonnet", SEVEN_DAY_MS),
];

/// One rolling rate-limit window.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageWindow {
    /// `five_hour` | `seven_day` | `seven_day_opus` | `seven_day_sonnet`.
    pub key: String,
    /// 0–100, clamped. The endpoint reports percent.
    pub utilization_pct: f64,
    /// When the window resets, epoch ms. `None` when the endpoint gave no
    /// reset (an untouched window has none).
    #[ts(type = "number | null")]
    pub resets_at_ms: Option<i64>,
    /// The window's length in ms — lets the strip derive "elapsed fraction"
    /// from `resets_at_ms` without re-encoding the 5h / 7d rule.
    #[ts(type = "number")]
    pub window_ms: i64,
}

/// What the strip renders. `available: false` is a state (no OAuth login, a
/// dead network), carried with a machine `reason` the frontend maps to copy.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageSnapshot {
    pub available: bool,
    /// `no_credentials` | `token_expired` | `unauthorized` | `rate_limited`
    /// | `http_error` | `network` | `parse` — or `None` when available.
    pub reason: Option<String>,
    /// `pro` | `max` | `team` | … as the CLI stored it.
    pub subscription_type: Option<String>,
    /// e.g. `default_claude_max_20x`; the strip derives the "Max 20×" label.
    pub rate_limit_tier: Option<String>,
    pub windows: Vec<ClaudeUsageWindow>,
    #[ts(type = "number")]
    pub fetched_at_ms: i64,
}

impl ClaudeUsageSnapshot {
    fn unavailable(reason: &str, creds: Option<&Credentials>) -> Self {
        Self {
            available: false,
            reason: Some(reason.to_string()),
            subscription_type: creds.and_then(|c| c.subscription_type.clone()),
            rate_limit_tier: creds.and_then(|c| c.rate_limit_tier.clone()),
            windows: Vec::new(),
            fetched_at_ms: now_ms(),
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Credentials ─────────────────────────────────────────────────────────────

/// The slice of `~/.claude/.credentials.json` this module reads. The token
/// deliberately has no `Debug` exposure beyond this struct's own derive being
/// absent — do not add one.
struct Credentials {
    access_token: String,
    expires_at_ms: Option<i64>,
    subscription_type: Option<String>,
    rate_limit_tier: Option<String>,
}

/// `$CLAUDE_CONFIG_DIR` or `~/.claude` — the same override Claude Code honours.
fn claude_config_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    dirs::home_dir().map(|h| h.join(".claude"))
}

fn read_credentials() -> Option<Credentials> {
    if let Ok(tok) = std::env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        if !tok.trim().is_empty() {
            return Some(Credentials {
                access_token: tok.trim().to_string(),
                expires_at_ms: None,
                subscription_type: None,
                rate_limit_tier: None,
            });
        }
    }
    let path = claude_config_dir()?.join(".credentials.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    parse_credentials(&v)
}

/// Pure half of [`read_credentials`], so the shape can be tested without a
/// home directory. Accepts the CLI's nested `claudeAiOauth` object and the
/// flat forms other tooling writes.
fn parse_credentials(v: &Value) -> Option<Credentials> {
    let oauth = v
        .get("claudeAiOauth")
        .or_else(|| v.get("oauth"))
        .unwrap_or(v);
    let token = ["accessToken", "access_token", "oauth_access_token"]
        .iter()
        .find_map(|k| oauth.get(k).and_then(Value::as_str))
        .filter(|s| !s.trim().is_empty())?;
    Some(Credentials {
        access_token: token.to_string(),
        expires_at_ms: oauth.get("expiresAt").and_then(as_epoch_ms),
        subscription_type: oauth
            .get("subscriptionType")
            .and_then(Value::as_str)
            .map(str::to_string),
        rate_limit_tier: oauth
            .get("rateLimitTier")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

// ── Response parsing ────────────────────────────────────────────────────────

/// Epoch in ms from a JSON number that may be seconds or milliseconds, or an
/// RFC 3339 string. Anything before 2001 in ms terms is taken as seconds.
fn as_epoch_ms(v: &Value) -> Option<i64> {
    if let Some(n) = v.as_f64() {
        let n = n as i64;
        return Some(if n < 100_000_000_000 { n * 1000 } else { n });
    }
    let s = v.as_str()?;
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

/// Shape the endpoint's JSON into windows. Pure, so the scaling and the
/// timestamp variants are pinned by tests rather than by a live account.
fn parse_windows(body: &Value) -> Vec<ClaudeUsageWindow> {
    let mut out = Vec::new();
    for (key, window_ms) in WINDOW_KEYS {
        let Some(w) = body.get(key).filter(|w| w.is_object()) else {
            continue;
        };
        let raw = w
            .get("utilization")
            .or_else(|| w.get("used_percentage"))
            .and_then(Value::as_f64);
        let Some(raw) = raw else { continue };
        out.push(ClaudeUsageWindow {
            key: key.to_string(),
            utilization_pct: raw.clamp(0.0, 100.0),
            resets_at_ms: w
                .get("resets_at")
                .or_else(|| w.get("resets_at_epoch"))
                .and_then(as_epoch_ms),
            window_ms,
        });
    }
    out
}

// ── Fetch + cache ───────────────────────────────────────────────────────────

fn cache() -> &'static Mutex<Option<(Instant, ClaudeUsageSnapshot)>> {
    static C: OnceLock<Mutex<Option<(Instant, ClaudeUsageSnapshot)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

async fn fetch_snapshot() -> ClaudeUsageSnapshot {
    let Some(creds) = read_credentials() else {
        return ClaudeUsageSnapshot::unavailable("no_credentials", None);
    };
    if let Some(exp) = creds.expires_at_ms {
        // The CLI refreshes its own token on its next run; until then the
        // stored one is dead and a 401 round-trip would only say so slower.
        if exp < now_ms() {
            return ClaudeUsageSnapshot::unavailable("token_expired", Some(&creds));
        }
    }

    let resp = SHARED_HTTP
        .get(USAGE_URL)
        .bearer_auth(&creds.access_token)
        .header("anthropic-beta", OAUTH_BETA)
        .header("Accept", "application/json")
        .send()
        .await;
    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(error = %e, "claude usage: request failed");
            return ClaudeUsageSnapshot::unavailable("network", Some(&creds));
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let reason = match status.as_u16() {
            401 | 403 => "unauthorized",
            429 => "rate_limited",
            _ => "http_error",
        };
        tracing::debug!(status = status.as_u16(), "claude usage: non-success");
        return ClaudeUsageSnapshot::unavailable(reason, Some(&creds));
    }
    let body: Value = match resp.json().await {
        Ok(b) => b,
        Err(_) => return ClaudeUsageSnapshot::unavailable("parse", Some(&creds)),
    };
    let windows = parse_windows(&body);
    if windows.is_empty() {
        return ClaudeUsageSnapshot::unavailable("parse", Some(&creds));
    }
    ClaudeUsageSnapshot {
        available: true,
        reason: None,
        subscription_type: creds.subscription_type,
        rate_limit_tier: creds.rate_limit_tier,
        windows,
        fetched_at_ms: now_ms(),
    }
}

/// The subscription's live rate-limit windows, cached for [`CACHE_TTL`].
#[tauri::command]
pub async fn fleet_claude_usage(
    state: State<'_, Arc<AppState>>,
) -> Result<ClaudeUsageSnapshot, AppError> {
    require_auth(&state).await?;
    if let Some((at, snap)) = cache().lock().map(|g| g.clone()).unwrap_or(None) {
        if at.elapsed() < CACHE_TTL {
            return Ok(snap);
        }
    }
    let snap = fetch_snapshot().await;
    // A failed read is cached too: a missing credentials file must not be
    // re-read by every poll of every open Monitor.
    if let Ok(mut g) = cache().lock() {
        *g = Some((Instant::now(), snap.clone()));
    }
    Ok(snap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_percent_windows_and_rfc3339_resets() {
        let body = json!({
            "five_hour": { "utilization": 42.5, "resets_at": "2026-09-05T18:00:00Z" },
            "seven_day": { "utilization": 12, "resets_at": "2026-09-08T00:00:00+00:00" },
            "seven_day_opus": { "utilization": 0, "resets_at": null },
            "something_new": { "utilization": 99 }
        });
        let w = parse_windows(&body);
        assert_eq!(w.len(), 3, "unknown keys are ignored");
        assert_eq!(w[0].key, "five_hour");
        assert_eq!(w[0].utilization_pct, 42.5);
        assert_eq!(w[0].window_ms, FIVE_HOUR_MS);
        assert_eq!(w[0].resets_at_ms, Some(1_788_631_200_000));
        assert_eq!(w[1].window_ms, SEVEN_DAY_MS);
        assert_eq!(w[1].resets_at_ms, Some(1_788_825_600_000));
        assert_eq!(w[2].resets_at_ms, None);
    }

    #[test]
    fn clamps_and_accepts_epoch_seconds_or_millis() {
        let body = json!({
            "five_hour": { "used_percentage": 140, "resets_at_epoch": 1_788_717_600 },
            "seven_day": { "utilization": -3, "resets_at": 1_788_717_600_000i64 }
        });
        let w = parse_windows(&body);
        assert_eq!(w[0].utilization_pct, 100.0);
        assert_eq!(w[0].resets_at_ms, Some(1_788_717_600_000));
        assert_eq!(w[1].utilization_pct, 0.0);
        assert_eq!(w[1].resets_at_ms, Some(1_788_717_600_000));
    }

    #[test]
    fn empty_or_malformed_body_yields_no_windows() {
        assert!(parse_windows(&json!({})).is_empty());
        assert!(parse_windows(&json!({ "five_hour": "nope" })).is_empty());
        assert!(parse_windows(&json!({ "five_hour": { "resets_at": "x" } })).is_empty());
    }

    #[test]
    fn reads_the_cli_credential_shape_and_flat_variants() {
        let cli = json!({ "claudeAiOauth": {
            "accessToken": "sk-ant-oat01-abc", "refreshToken": "r",
            "expiresAt": 1_788_642_880_404i64,
            "subscriptionType": "max", "rateLimitTier": "default_claude_max_20x"
        }});
        let c = parse_credentials(&cli).expect("parsed");
        assert_eq!(c.access_token, "sk-ant-oat01-abc");
        assert_eq!(c.expires_at_ms, Some(1_788_642_880_404));
        assert_eq!(c.subscription_type.as_deref(), Some("max"));
        assert_eq!(c.rate_limit_tier.as_deref(), Some("default_claude_max_20x"));

        let flat = json!({ "access_token": "tok" });
        assert_eq!(parse_credentials(&flat).expect("flat").access_token, "tok");
        assert!(parse_credentials(&json!({ "claudeAiOauth": { "accessToken": "" } })).is_none());
        assert!(parse_credentials(&json!({})).is_none());
    }

    #[test]
    fn unavailable_snapshot_keeps_plan_identity() {
        let c = Credentials {
            access_token: "t".into(),
            expires_at_ms: None,
            subscription_type: Some("pro".into()),
            rate_limit_tier: None,
        };
        let s = ClaudeUsageSnapshot::unavailable("network", Some(&c));
        assert!(!s.available);
        assert_eq!(s.reason.as_deref(), Some("network"));
        assert_eq!(s.subscription_type.as_deref(), Some("pro"));
        assert!(s.windows.is_empty());
    }
}
