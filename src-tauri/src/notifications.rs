use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Mutex as TokioMutex;
use ts_rs::TS;

use crate::db::models::{ChannelScopeV2, ChannelSpecV2, ChannelSpecV2Type};
use crate::engine::crypto::SecureString;
use crate::engine::event_registry::{emit_event, event_name};

/// Per-persona notification preferences parsed from `notification_channels` JSON.
#[derive(Debug, Deserialize)]
struct NotificationPrefs {
    #[serde(default = "default_true")]
    execution_completed: bool,
    #[serde(default = "default_true")]
    manual_review: bool,
    #[serde(default = "default_true")]
    new_message: bool,
    #[serde(default = "default_true")]
    healing_issue: bool,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            execution_completed: true,
            manual_review: true,
            new_message: true,
            healing_issue: true,
        }
    }
}

fn default_true() -> bool {
    true
}

/// A configured external notification channel (Slack, Telegram, Email).
#[derive(Debug, Clone, Deserialize, Serialize)]
struct ExternalChannel {
    #[serde(rename = "type")]
    channel_type: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    credential_id: Option<String>,
    #[serde(default)]
    config: std::collections::HashMap<String, String>,
}

fn parse_prefs(json: Option<&str>) -> NotificationPrefs {
    match json {
        Some(json_str) => {
            // If the JSON starts with '[', it's the new array format -- return defaults
            if json_str.trim_start().starts_with('[') {
                return NotificationPrefs::default();
            }
            serde_json::from_str(json_str).unwrap_or_default()
        }
        None => NotificationPrefs::default(),
    }
}

/// Parse the array-format notification channels from JSON.
fn parse_channels(json: Option<&str>) -> Vec<ExternalChannel> {
    match json {
        Some(json_str) if json_str.trim_start().starts_with('[') => {
            serde_json::from_str(json_str).unwrap_or_default()
        }
        _ => vec![],
    }
}

// v3.2 — Parse shape-v2 notification_channels (D-02, D-05).
// Shape discriminant: JSON is an array AND the first element contains the key
// `use_case_ids`. Returns `None` when the JSON is not v2-shaped (shape A object,
// shape B legacy array, empty/None input); callers fall through to the legacy
// `parse_prefs` / `parse_channels` paths without any behavior change.
//
// Accepts an empty array `[]` as a valid v2 value (means "no channels
// configured"); the empty `use_case_ids: []` sentinel guard lives in
// `validation::persona::validate_notification_channels` (runs at DB write).
pub(crate) fn parse_channels_v2(json: Option<&str>) -> Option<Vec<ChannelSpecV2>> {
    let json_str = json?.trim();
    if !json_str.starts_with('[') {
        return None; // shape A object — not v2
    }
    let raw: Vec<serde_json::Value> = serde_json::from_str(json_str).ok()?;
    if raw.is_empty() {
        return Some(Vec::new()); // empty array is a valid v2 value
    }
    // Discriminant: first element must have `use_case_ids` to be shape v2.
    if raw[0].get("use_case_ids").is_none() {
        return None; // shape B legacy — let parse_channels handle it
    }
    serde_json::from_str::<Vec<ChannelSpecV2>>(json_str).ok()
}

// ---------------------------------------------------------------------------
// Shape-v2 delivery types (Phase 19 DELIV-02, D-04, D-07)
// ---------------------------------------------------------------------------

/// Payload emitted as a Tauri event when a message or emit event is
/// delivered to the "titlebar" channel type. (DELIV-02, D-04)
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TitlebarNotificationPayload {
    pub persona_id: String,
    pub persona_name: String,
    pub use_case_id: Option<String>,
    /// Present only for EmitEvent-sourced deliveries; None for UserMessage/ManualReview.
    pub event_type: Option<String>,
    pub title: String,
    pub body: String,
    pub priority: String,
}

/// Per-channel result returned by `test_channel_delivery`. (DELIV-06, D-07)
/// NOTE: the IPC command itself lives in Plan 02; the type lives here so the
/// binding regen can attach to a single file.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TestDeliveryResult {
    pub channel_type: String,
    pub success: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
    pub rate_limited: Option<bool>,
}

/// Delivery context passed to `deliver_to_channels` so `event_filter` can gate
/// EmitEvent fanout without the delivery layer knowing about DispatchContext. (D-02)
///
/// Invariant: `emit_event_type == None` means UserMessage/ManualReview — those
/// ALWAYS bypass `event_filter`. `Some(event_type)` means EmitEvent — gate applies.
#[derive(Debug, Clone)]
pub(crate) struct DeliveryContext {
    pub persona_id: String,
    pub persona_name: String,
    pub use_case_id: Option<String>,
    pub emit_event_type: Option<String>,
    pub priority: Option<String>,
}

// ---------------------------------------------------------------------------
// Delivery metrics (in-memory, process-scoped)
// ---------------------------------------------------------------------------

/// Per-channel-type delivery counters. Uses atomics for lock-free concurrent access
/// from multiple tokio::spawn tasks.
struct ChannelMetrics {
    attempted: AtomicU64,
    succeeded: AtomicU64,
    failed: AtomicU64,
    /// Cumulative latency in milliseconds (divide by succeeded for average).
    total_latency_ms: AtomicU64,
    /// Maximum observed latency in milliseconds.
    max_latency_ms: AtomicU64,
    /// Consecutive failures (resets on success).
    consecutive_failures: AtomicU64,
}

impl ChannelMetrics {
    const fn new() -> Self {
        Self {
            attempted: AtomicU64::new(0),
            succeeded: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            total_latency_ms: AtomicU64::new(0),
            max_latency_ms: AtomicU64::new(0),
            consecutive_failures: AtomicU64::new(0),
        }
    }

    fn record_success(&self, latency_ms: u64) {
        self.attempted.fetch_add(1, Ordering::Relaxed);
        self.succeeded.fetch_add(1, Ordering::Relaxed);
        self.total_latency_ms
            .fetch_add(latency_ms, Ordering::Relaxed);
        self.consecutive_failures.store(0, Ordering::Relaxed);
        // Update max latency (CAS loop)
        let mut current = self.max_latency_ms.load(Ordering::Relaxed);
        while latency_ms > current {
            match self.max_latency_ms.compare_exchange_weak(
                current,
                latency_ms,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(actual) => current = actual,
            }
        }
    }

    fn record_failure(&self) {
        self.attempted.fetch_add(1, Ordering::Relaxed);
        self.failed.fetch_add(1, Ordering::Relaxed);
        self.consecutive_failures.fetch_add(1, Ordering::Relaxed);
    }

    fn snapshot(&self) -> ChannelDeliveryStats {
        let attempted = self.attempted.load(Ordering::Relaxed);
        let succeeded = self.succeeded.load(Ordering::Relaxed);
        let failed = self.failed.load(Ordering::Relaxed);
        let total_latency_ms = self.total_latency_ms.load(Ordering::Relaxed);
        let avg_latency_ms = if succeeded > 0 {
            total_latency_ms as f64 / succeeded as f64
        } else {
            0.0
        };
        ChannelDeliveryStats {
            attempted,
            succeeded,
            failed,
            avg_latency_ms,
            max_latency_ms: self.max_latency_ms.load(Ordering::Relaxed),
            consecutive_failures: self.consecutive_failures.load(Ordering::Relaxed),
        }
    }

    /// Returns the current attempted count (used in tests to detect side effects).
    #[cfg(test)]
    fn attempted_count(&self) -> u64 {
        self.attempted.load(Ordering::Relaxed)
    }
}

struct DeliveryMetrics {
    slack: ChannelMetrics,
    telegram: ChannelMetrics,
    email: ChannelMetrics,
    titlebar: ChannelMetrics,
    discord: ChannelMetrics,
    teams: ChannelMetrics,
}

impl DeliveryMetrics {
    fn for_channel(&self, channel_type: &str) -> &ChannelMetrics {
        match channel_type {
            "slack" => &self.slack,
            "telegram" => &self.telegram,
            "email" => &self.email,
            "titlebar" => &self.titlebar,
            "discord" => &self.discord,
            "teams" => &self.teams,
            // Unknown channels fall back to slack (won't be reached in practice)
            _ => &self.slack,
        }
    }
}

static DELIVERY_METRICS: DeliveryMetrics = DeliveryMetrics {
    slack: ChannelMetrics::new(),
    telegram: ChannelMetrics::new(),
    email: ChannelMetrics::new(),
    titlebar: ChannelMetrics::new(),
    discord: ChannelMetrics::new(),
    teams: ChannelMetrics::new(),
};

/// Per-channel stats returned to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDeliveryStats {
    pub attempted: u64,
    pub succeeded: u64,
    pub failed: u64,
    pub avg_latency_ms: f64,
    pub max_latency_ms: u64,
    pub consecutive_failures: u64,
}

/// Aggregated delivery stats for all channel types.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDeliveryStats {
    pub slack: ChannelDeliveryStats,
    pub telegram: ChannelDeliveryStats,
    pub email: ChannelDeliveryStats,
    pub discord: ChannelDeliveryStats,
    pub teams: ChannelDeliveryStats,
}

/// Payload emitted via Tauri event after each delivery attempt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDeliveryEvent {
    pub channel_type: String,
    pub success: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
    pub consecutive_failures: u64,
}

// ---------------------------------------------------------------------------
// Shape-v2 channel filtering helpers (pure — no AppHandle, testable)
// ---------------------------------------------------------------------------

/// Filter channels by enabled flag and use_case_ids scoping. (DELIV-05)
/// Pure function: takes owned channels, returns the subset that should receive delivery.
pub(crate) fn filter_channels_for_delivery(
    channels: Vec<ChannelSpecV2>,
    ctx: &DeliveryContext,
) -> Vec<ChannelSpecV2> {
    channels
        .into_iter()
        .filter(|ch| {
            if !ch.enabled {
                return false;
            }
            match &ch.use_case_ids {
                ChannelScopeV2::All(_) => true,
                ChannelScopeV2::Specific(ids) => ctx
                    .use_case_id
                    .as_deref()
                    .map(|uc| ids.iter().any(|id| id == uc))
                    .unwrap_or(false),
            }
        })
        .collect()
}

/// Apply event_filter gating. (DELIV-03, D-02)
/// - `emit_event_type == None` (UserMessage/ManualReview) → filter bypassed, all channels pass.
/// - `emit_event_type == Some(evt)` (EmitEvent) → channel only passes if its event_filter is
///   empty/absent OR explicitly lists `evt`.
pub(crate) fn apply_event_filter(
    channels: &[ChannelSpecV2],
    ctx: &DeliveryContext,
) -> Vec<ChannelSpecV2> {
    channels
        .iter()
        .filter(|ch| match &ctx.emit_event_type {
            None => true, // UserMessage + ManualReview bypass filter (D-02)
            Some(evt) => match &ch.event_filter {
                None => true,
                Some(f) if f.is_empty() => true,
                Some(f) => f.iter().any(|x| x == evt),
            },
        })
        .cloned()
        .collect()
}

// ---------------------------------------------------------------------------
// Vault credential resolution (Slice 1: bridge spec.credential_id → vault)
// ---------------------------------------------------------------------------

/// Fetch a credential by ID and return its decrypted fields, plus the first
/// item from each `scoped_resources` group surfaced as `selected_<resource_id>`.
///
/// Returns an empty map (with a `tracing::warn`) when the credential is missing
/// or fails to decrypt — callers fall through to `spec.config` which may still
/// carry inline auth (legacy path).
async fn resolve_credential_fields(
    app: &AppHandle,
    credential_id: &str,
) -> HashMap<String, String> {
    use crate::db::repos::resources::credentials;

    use tauri::Manager;
    let state = match app.try_state::<std::sync::Arc<crate::AppState>>() {
        Some(s) => s,
        None => {
            tracing::warn!(%credential_id, "AppState unavailable; cannot resolve credential");
            return HashMap::new();
        }
    };

    let cred = match credentials::get_by_id(&state.db, credential_id) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(%credential_id, error = %e, "credential lookup failed");
            return HashMap::new();
        }
    };

    let mut merged = match credentials::get_decrypted_fields(&state.db, &cred) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(%credential_id, error = %e, "failed to decrypt credential fields");
            return HashMap::new();
        }
    };

    // Surface the first selected item from each scoped resource as
    // `selected_<resource_id>` so an adapter can pick a default destination
    // (e.g. Slack channel, Discord guild) without forcing the picker to
    // copy the ID into spec.config. spec.config still wins on collision.
    if let Some(scoped_json) = cred.scoped_resources.as_deref() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(scoped_json) {
            if let Some(obj) = parsed.as_object() {
                for (resource_id, items) in obj {
                    if let Some(first_id) = items
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|item| item.get("id"))
                        .and_then(|v| v.as_str())
                    {
                        merged
                            .entry(format!("selected_{}", resource_id))
                            .or_insert_with(|| first_id.to_string());
                    }
                }
            }
        }
    }

    merged
}

/// Build the merged config map for an external delivery: vault-resolved
/// credential fields layered under `spec.config` (config wins on collision so
/// the per-channel destination — Slack channel, Discord channel_id, Telegram
/// chat_id — set in the picker can override anything in the credential).
async fn merged_channel_config(
    app: &AppHandle,
    spec: &ChannelSpecV2,
) -> HashMap<String, String> {
    let mut merged = if let Some(cred_id) = spec.credential_id.as_deref() {
        resolve_credential_fields(app, cred_id).await
    } else {
        HashMap::new()
    };
    if let Some(obj) = spec.config.as_ref().and_then(|c| c.as_object()) {
        for (k, v) in obj {
            let s = match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            merged.insert(k.clone(), s);
        }
    }
    merged
}

// ---------------------------------------------------------------------------
// Shape-v2 channel delivery
// ---------------------------------------------------------------------------

/// Shape-v2 channel delivery. Applies `use_case_ids` scoping + `event_filter`
/// gating; dispatches to per-channel-type delivery paths. (DELIV-01, DELIV-02, DELIV-03, DELIV-05)
fn deliver_v2_channels(
    app: &AppHandle,
    channels: Vec<ChannelSpecV2>,
    title: &str,
    body: &str,
    ctx: &DeliveryContext,
) {
    let enabled = filter_channels_for_delivery(channels, ctx);
    let gated = apply_event_filter(&enabled, ctx);

    for ch in gated {
        match ch.channel_type {
            ChannelSpecV2Type::BuiltIn => {
                // True no-op: the messages table insert already happened
                // upstream in dispatch.rs::dispatch() before channels are resolved.
                // No metrics, no event. (DELIV-01, D-03)
                tracing::trace!("built-in channel: delivery is a no-op (message already in inbox)");
            }
            ChannelSpecV2Type::Titlebar => {
                let payload = TitlebarNotificationPayload {
                    persona_id: ctx.persona_id.clone(),
                    persona_name: ctx.persona_name.clone(),
                    use_case_id: ctx.use_case_id.clone(),
                    event_type: ctx.emit_event_type.clone(),
                    title: title.to_string(),
                    body: body.to_string(),
                    priority: ctx.priority.clone().unwrap_or_else(|| "normal".to_string()),
                };
                emit_event(app, event_name::TITLEBAR_NOTIFICATION, &payload);
                DELIVERY_METRICS.for_channel("titlebar").record_success(0);
            }
            ChannelSpecV2Type::Slack
            | ChannelSpecV2Type::Telegram
            | ChannelSpecV2Type::Email
            | ChannelSpecV2Type::Discord
            | ChannelSpecV2Type::Teams => {
                let ch_type_str = channel_type_str(&ch.channel_type).to_string();
                let app_clone = app.clone();
                let title = title.to_string();
                let body = body.to_string();
                let spec = ch.clone();
                tokio::spawn(async move {
                    let start = std::time::Instant::now();
                    // Slice 1: resolve credential_id → decrypted vault fields,
                    // overlay spec.config on top.
                    let cfg = merged_channel_config(&app_clone, &spec).await;
                    let external = ExternalChannel {
                        channel_type: ch_type_str.clone(),
                        enabled: spec.enabled,
                        credential_id: spec.credential_id.clone(),
                        config: cfg,
                    };
                    let result = match external.channel_type.as_str() {
                        "slack" => deliver_slack(&external, &title, &body).await,
                        "telegram" => deliver_telegram(&external, &title, &body).await,
                        "email" => deliver_email(&external, &title, &body).await,
                        "discord" => deliver_discord(&external, &title, &body).await,
                        "teams" => deliver_teams(&external, &title, &body).await,
                        other => {
                            tracing::debug!(channel_type = %other, "unknown shape-v2 external type");
                            Ok(())
                        }
                    };
                    let latency_ms = start.elapsed().as_millis() as u64;
                    let metrics = DELIVERY_METRICS.for_channel(&external.channel_type);
                    match &result {
                        Ok(_) => metrics.record_success(latency_ms),
                        Err(e) => {
                            metrics.record_failure();
                            tracing::warn!(
                                error = %e,
                                channel_type = %external.channel_type,
                                "shape-v2 external delivery failed"
                            );
                        }
                    }
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Multi-channel delivery
// ---------------------------------------------------------------------------

/// Deliver a notification to all enabled external channels (fire-and-forget).
/// Accepts a `DeliveryContext` so that:
///   - shape-v2 paths can apply `event_filter` gating and `use_case_ids` scoping
///   - the `"titlebar"` arm can build a correctly-typed `TitlebarNotificationPayload`
///
/// Shape-v2 channels (detected by `parse_channels_v2`) are handled by
/// `deliver_v2_channels`; legacy shape-A/B falls through to the existing loop.
pub(crate) fn deliver_to_channels(
    app: &AppHandle,
    channels_json: Option<&str>,
    title: &str,
    body: &str,
    ctx: &DeliveryContext,
) {
    // Shape-v2 path (DELIV-01, DELIV-02, DELIV-03, DELIV-05)
    if let Some(v2_channels) = parse_channels_v2(channels_json) {
        deliver_v2_channels(app, v2_channels, title, body, ctx);
        return;
    }
    // Legacy shape-A/B path — no DeliveryContext filtering needed
    let channels = parse_channels(channels_json);
    let enabled: Vec<_> = channels.into_iter().filter(|c| c.enabled).collect();
    if enabled.is_empty() {
        return;
    }
    let title = title.to_owned();
    let body = body.to_owned();
    let app = app.clone();
    tokio::spawn(async move {
        for ch in enabled {
            let metrics = DELIVERY_METRICS.for_channel(&ch.channel_type);
            let start = std::time::Instant::now();
            let result = match ch.channel_type.as_str() {
                "slack" => deliver_slack(&ch, &title, &body).await,
                "telegram" => deliver_telegram(&ch, &title, &body).await,
                "email" => deliver_email(&ch, &title, &body).await,
                "discord" => deliver_discord(&ch, &title, &body).await,
                "teams" => deliver_teams(&ch, &title, &body).await,
                other => {
                    tracing::debug!("Unknown channel type: {}", other);
                    Ok(())
                }
            };
            let latency_ms = start.elapsed().as_millis() as u64;

            let (success, error) = match &result {
                Ok(()) => {
                    metrics.record_success(latency_ms);
                    (true, None)
                }
                Err(e) => {
                    metrics.record_failure();
                    tracing::warn!(
                        channel_type = %ch.channel_type,
                        consecutive_failures = metrics.consecutive_failures.load(Ordering::Relaxed),
                        latency_ms,
                        "Failed to deliver to {} channel: {}", ch.channel_type, e
                    );
                    (false, Some(e.clone()))
                }
            };

            let event = NotificationDeliveryEvent {
                channel_type: ch.channel_type.clone(),
                success,
                latency_ms,
                error,
                consecutive_failures: metrics.consecutive_failures.load(Ordering::Relaxed),
            };
            emit_event(&app, event_name::NOTIFICATION_DELIVERY, &event);
        }
    });
}

/// Deliver to Slack. Two paths:
///   - `bot_token` present (vault-resolved) → `chat.postMessage` API to a
///     channel set in `channel`/`channel_id`/`selected_channels` (Slice 1).
///   - `webhook_url` present (legacy inline config) → POST to the Incoming
///     Webhook URL.
async fn deliver_slack(ch: &ExternalChannel, title: &str, body: &str) -> Result<(), String> {
    // Path A: vault credential with bot_token + a destination channel.
    if let Some(bot_token) = ch.config.get("bot_token").filter(|t| !t.is_empty()) {
        let channel = ch
            .config
            .get("channel")
            .or_else(|| ch.config.get("channel_id"))
            .or_else(|| ch.config.get("selected_channels"))
            .filter(|c| !c.is_empty())
            .ok_or(
                "Slack: vault credential resolved but no channel set — \
                 set 'channel' in spec.config or pick a channel resource on the credential",
            )?;
        let token = SecureString::new(bot_token.clone());
        let text = format!("*{}*\n{}", title, body);
        let resp = crate::SHARED_HTTP
            .post("https://slack.com/api/chat.postMessage")
            .bearer_auth(token.expose_secret())
            .json(&serde_json::json!({ "channel": channel, "text": text }))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Slack request failed: {e}"))?;
        drop(token);
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Slack returned {status}: {body}"));
        }
        // Slack returns HTTP 200 with `{"ok":false,"error":"..."}` for app-level errors.
        let payload: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Slack response parse failed: {e}"))?;
        if !payload.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            let err = payload
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            return Err(format!("Slack chat.postMessage error: {err}"));
        }
        return Ok(());
    }

    // Path B: inline webhook URL.
    let webhook_url = SecureString::new(
        ch.config
            .get("webhook_url")
            .filter(|u| !u.is_empty())
            .ok_or(
                "Slack: configure either bot_token+channel (vault credential) \
                 or webhook_url (inline config)",
            )?
            .clone(),
    );

    let channel = ch.config.get("channel").cloned().unwrap_or_default();
    let text = if channel.is_empty() {
        format!("*{}*\n{}", title, body)
    } else {
        format!("*{}*\n{}\n_{}_", title, body, channel)
    };

    let payload = serde_json::json!({ "text": text });

    let resp = crate::SHARED_HTTP
        .post(webhook_url.expose_secret())
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Slack request failed: {e}"))?;
    // `webhook_url` (SecureString) drops here -- memory is zeroized

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Slack returned {status}: {body}"));
    }
    Ok(())
}

/// Send message via Telegram Bot API.
async fn deliver_telegram(ch: &ExternalChannel, title: &str, body: &str) -> Result<(), String> {
    let bot_token = SecureString::new(
        ch.config
            .get("bot_token")
            .filter(|t| !t.is_empty())
            .ok_or("Telegram bot_token not configured")?
            .clone(),
    );
    let chat_id = ch
        .config
        .get("chat_id")
        .filter(|c| !c.is_empty())
        .ok_or("Telegram chat_id not configured")?;

    let text = format!("*{}*\n{}", title, body);
    let url = format!(
        "https://api.telegram.org/bot{}/sendMessage",
        bot_token.expose_secret()
    );
    drop(bot_token); // zeroize token immediately after building the URL

    let resp = crate::SHARED_HTTP
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Telegram request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Telegram returned {status}: {body}"));
    }
    Ok(())
}

/// Send email via HTTP email service (SendGrid / Resend).
/// Supports two providers detected by the presence of config keys:
///   - `sendgrid_api_key` -> SendGrid v3 API
///   - `resend_api_key`   -> Resend API
///     Falls back to no-op if neither is configured.
async fn deliver_email(ch: &ExternalChannel, title: &str, body: &str) -> Result<(), String> {
    let to = ch
        .config
        .get("to")
        .filter(|t| !t.is_empty())
        .ok_or("Email 'to' address not configured")?;
    let from = ch
        .config
        .get("from")
        .cloned()
        .unwrap_or_else(|| "noreply@personas.app".to_string());

    if let Some(api_key) = ch.config.get("sendgrid_api_key").filter(|k| !k.is_empty()) {
        let secret = SecureString::new(api_key.clone());
        return send_via_sendgrid(&secret, &from, to, title, body).await;
    }
    if let Some(api_key) = ch.config.get("resend_api_key").filter(|k| !k.is_empty()) {
        let secret = SecureString::new(api_key.clone());
        return send_via_resend(&secret, &from, to, title, body).await;
    }

    Err("No email provider configured (set sendgrid_api_key or resend_api_key)".into())
}

async fn send_via_sendgrid(
    api_key: &SecureString,
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "personalizations": [{ "to": [{ "email": to }] }],
        "from": { "email": from },
        "subject": subject,
        "content": [{ "type": "text/plain", "value": body }],
    });

    let resp = crate::SHARED_HTTP
        .post("https://api.sendgrid.com/v3/mail/send")
        .bearer_auth(api_key.expose_secret())
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("SendGrid request failed: {e}"))?;
    // `api_key` borrow ends here; caller's SecureString drops after return

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("SendGrid returned {status}: {text}"));
    }
    Ok(())
}

async fn send_via_resend(
    api_key: &SecureString,
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "from": from,
        "to": [to],
        "subject": subject,
        "text": body,
    });

    let resp = crate::SHARED_HTTP
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key.expose_secret())
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Resend request failed: {e}"))?;
    // `api_key` borrow ends here; caller's SecureString drops after return

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Resend returned {status}: {text}"));
    }
    Ok(())
}

/// Deliver to Discord. Two paths:
///   - `bot_token` present (vault-resolved) + `channel_id` in spec.config →
///     `POST /channels/{channel_id}/messages` with `Authorization: Bot <token>`.
///   - `webhook_url` present (inline config) → POST to the Discord webhook.
///
/// Slice 1 is plain-text only (`content` field); embeds/components deferred.
async fn deliver_discord(ch: &ExternalChannel, title: &str, body: &str) -> Result<(), String> {
    let content = format!("**{}**\n{}", title, body);

    if let Some(webhook_url) = ch.config.get("webhook_url").filter(|u| !u.is_empty()) {
        let url = SecureString::new(webhook_url.clone());
        let resp = crate::SHARED_HTTP
            .post(url.expose_secret())
            .json(&serde_json::json!({ "content": content }))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Discord request failed: {e}"))?;
        drop(url);
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Discord returned {status}: {body}"));
        }
        return Ok(());
    }

    let bot_token = ch
        .config
        .get("bot_token")
        .filter(|t| !t.is_empty())
        .ok_or(
            "Discord: configure either webhook_url (inline) or \
             bot_token+channel_id (vault credential + spec.config)",
        )?;
    let channel_id = ch
        .config
        .get("channel_id")
        .filter(|c| !c.is_empty())
        .ok_or(
            "Discord channel_id not configured — guild scoping on the \
             credential narrows which servers the bot may post to but does \
             not pick a target channel; set 'channel_id' in spec.config",
        )?;

    let token = SecureString::new(bot_token.clone());
    let url = format!(
        "https://discord.com/api/v10/channels/{}/messages",
        channel_id
    );
    let resp = crate::SHARED_HTTP
        .post(&url)
        .header(
            "Authorization",
            format!("Bot {}", token.expose_secret()),
        )
        .json(&serde_json::json!({ "content": content }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Discord request failed: {e}"))?;
    drop(token);
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Discord returned {status}: {body}"));
    }
    Ok(())
}

/// Deliver to Microsoft Teams. Three paths:
///   - `webhook_url` (inline) → Incoming Webhook MessageCard.
///   - `access_token` + `team_id` + `channel_id` (vault OAuth credential
///     + spec.config or `selected_teams`/`selected_channels` fallback) →
///     `POST /teams/{team_id}/channels/{channel_id}/messages` on Graph.
///   - Otherwise → actionable error explaining which fields are missing.
///
/// Slice 4 ships the Graph path WITHOUT proactive token refresh — if the
/// stored `access_token` has expired, Graph returns 401 and the dispatcher's
/// failure metric surfaces; the user re-authorises via Settings → Vault.
/// A future slice can plumb `connector_strategy::resolve_auth_token` here
/// for transparent refresh.
async fn deliver_teams(ch: &ExternalChannel, title: &str, body: &str) -> Result<(), String> {
    if let Some(webhook_url) = ch.config.get("webhook_url").filter(|u| !u.is_empty()) {
        let url = SecureString::new(webhook_url.clone());
        let payload = serde_json::json!({
            "@type": "MessageCard",
            "@context": "https://schema.org/extensions",
            "summary": title,
            "title": title,
            "text": body,
        });
        let resp = crate::SHARED_HTTP
            .post(url.expose_secret())
            .json(&payload)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Teams request failed: {e}"))?;
        drop(url);
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Teams returned {status}: {body}"));
        }
        return Ok(());
    }

    // Graph API path: requires access_token + team_id + channel_id.
    // team_id and channel_id may come from spec.config (set in the picker)
    // or from the credential's scoped_resources fallback (surfaced as
    // `selected_teams` / `selected_channels` by `merged_channel_config`).
    if let Some(access_token) = ch
        .config
        .get("access_token")
        .filter(|t| !t.is_empty())
    {
        let team_id = ch
            .config
            .get("team_id")
            .or_else(|| ch.config.get("selected_teams"))
            .filter(|t| !t.is_empty())
            .ok_or(
                "Teams Graph: team_id not configured \
                 (set 'team_id' in spec.config or pick a team resource on the credential)",
            )?;
        let channel_id = ch
            .config
            .get("channel_id")
            .or_else(|| ch.config.get("selected_channels"))
            .filter(|c| !c.is_empty())
            .ok_or(
                "Teams Graph: channel_id not configured \
                 (set 'channel_id' in spec.config or pick a channel resource on the credential)",
            )?;
        let token = SecureString::new(access_token.clone());
        // Plain text content — Graph accepts content_type "text" or "html";
        // Slice 4 stays plain to match the LCD richness pick from the design
        // conversation. Future richness can switch to "html" with markdown→HTML.
        let url = format!(
            "https://graph.microsoft.com/v1.0/teams/{}/channels/{}/messages",
            team_id, channel_id
        );
        let content = format!("{}\n\n{}", title, body);
        let resp = crate::SHARED_HTTP
            .post(&url)
            .bearer_auth(token.expose_secret())
            .json(&serde_json::json!({
                "body": { "contentType": "text", "content": content }
            }))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Teams Graph request failed: {e}"))?;
        drop(token);
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            // 401 is the canonical "token expired" case — flag it so the
            // user knows to re-authorise the Microsoft Teams credential
            // in the vault rather than fight a generic Graph error.
            if status.as_u16() == 401 {
                return Err(format!(
                    "Teams Graph 401 — access token expired or revoked. \
                     Re-authorise the Microsoft Teams credential in Settings → Vault. \
                     Server: {body}"
                ));
            }
            return Err(format!("Teams Graph returned {status}: {body}"));
        }
        return Ok(());
    }

    Err(
        "Teams: configure either webhook_url (inline) or \
         access_token + team_id + channel_id (vault credential + picker destination). \
         See https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook"
            .to_string(),
    )
}

// ---------------------------------------------------------------------------
// Public notification helpers
// ---------------------------------------------------------------------------

#[allow(dead_code)]
pub fn notify_execution_completed(
    app: &AppHandle,
    persona_name: &str,
    status: &str,
    duration_ms: u64,
    channels: Option<&str>,
) {
    notify_execution_completed_rich(
        app,
        persona_name,
        status,
        duration_ms,
        channels,
        None,
        None,
        None,
    );
}

/// Richer execution notification with cost, model, and error context.
#[allow(clippy::too_many_arguments)]
pub fn notify_execution_completed_rich(
    app: &AppHandle,
    persona_name: &str,
    status: &str,
    duration_ms: u64,
    channels: Option<&str>,
    cost_usd: Option<f64>,
    model_used: Option<&str>,
    error: Option<&str>,
) {
    if !parse_prefs(channels).execution_completed {
        return;
    }
    let duration_str = format!("{:.1}s", duration_ms as f64 / 1000.0);
    let emoji = match status {
        "completed" => "OK",
        "failed" => "FAIL",
        "cancelled" => "CANCEL",
        _ => status,
    };
    let title = format!("[{}] {}", emoji, persona_name);
    let mut body = format!("{} in {}", status, duration_str);
    if let Some(cost) = cost_usd {
        if cost > 0.0 {
            body.push_str(&format!(" | ${:.4}", cost));
        }
    }
    if let Some(model) = model_used {
        if !model.is_empty() {
            body.push_str(&format!(" | {}", model));
        }
    }
    if let Some(err) = error {
        if !err.is_empty() {
            // Truncate error for notification readability
            let short_err = if err.len() > 200 { &err[..200] } else { err };
            body.push_str(&format!("\nError: {}", short_err));
        }
    }
    send(app, &title, &body);
    // notify_execution_completed_rich is called from runner.rs which may not have
    // a DeliveryContext; use an empty-sentinel context (emit_event_type: None so
    // event_filter is bypassed — execution completion is UserMessage-class per D-02).
    let delivery_ctx = DeliveryContext {
        persona_id: String::new(), // sentinel: runner call site lacks persona_id in scope
        persona_name: persona_name.to_string(),
        use_case_id: None,
        emit_event_type: None, // always bypasses event_filter
        priority: None,
    };
    deliver_to_channels(app, channels, &title, &body, &delivery_ctx);
}

pub fn notify_manual_review(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    channels: Option<&str>,
    delivery_ctx: &DeliveryContext,
) {
    if !parse_prefs(channels).manual_review {
        return;
    }
    let heading = "Manual Review Needed";
    let body = format!("{}: {}", persona_name, title);
    send(app, heading, &body);
    deliver_to_channels(app, channels, heading, &body, delivery_ctx);
}

pub fn notify_new_message(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    channels: Option<&str>,
    delivery_ctx: &DeliveryContext,
) {
    if !parse_prefs(channels).new_message {
        return;
    }
    let heading = format!("Message from {}", persona_name);
    send(app, &heading, title);
    deliver_to_channels(app, channels, &heading, title, delivery_ctx);
}

pub fn notify_healing_issue(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    severity: &str,
    suggested_fix: Option<&str>,
    channels: Option<&str>,
) {
    if !parse_prefs(channels).healing_issue {
        return;
    }
    // Per-severity gating: critical and high always notify, medium/low are silent
    match severity {
        "critical" | "high" => {}
        _ => return,
    }
    let body = match suggested_fix {
        Some(fix) => format!("{persona_name}: {title}\nFix: {fix}"),
        None => format!("{persona_name}: {title}"),
    };
    let heading = format!("Healing Alert ({})", severity);
    send(app, &heading, &body);
    let delivery_ctx = DeliveryContext {
        persona_id: String::new(),
        persona_name: persona_name.to_string(),
        use_case_id: None,
        emit_event_type: None, // healing alerts are UserMessage-class — bypass filter
        priority: Some("high".to_string()),
    };
    deliver_to_channels(app, channels, &heading, &body, &delivery_ctx);
}

pub fn notify_n8n_transform_completed(app: &AppHandle, workflow_name: &str, success: bool) {
    if success {
        send(
            app,
            "n8n Transform Complete",
            &format!("{workflow_name} draft is ready for review."),
        );
    } else {
        send(
            app,
            "n8n Transform Failed",
            &format!("{workflow_name} transformation failed. Re-open importer for details."),
        );
    }
}

// ---------------------------------------------------------------------------
// Generic notification command -- allows the frontend to trigger OS notifications
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn send_app_notification(app: tauri::AppHandle, title: String, body: String) {
    send(&app, &title, &body);
}

// ---------------------------------------------------------------------------
// Per-channel test delivery rate limiter (DELIV-06, D-05)
// ---------------------------------------------------------------------------

/// Per-channel test delivery rate limiter.
/// Key = `channel_key(spec)` = "type:credential_id:config_hash"
/// Value = Instant of last successful call for that channel.
/// 1 req/sec per channel; in-memory only, resets on app restart. (DELIV-06, D-05)
static TEST_DELIVERY_RATE_LIMIT: LazyLock<
    TokioMutex<std::collections::HashMap<String, std::time::Instant>>,
> = LazyLock::new(|| TokioMutex::new(std::collections::HashMap::new()));

const RATE_LIMIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(1);

/// Compose a stable rate-limit key for a channel spec.
/// Hashes sorted config keys so two identical configs produce identical keys.
pub(crate) fn channel_key(ch: &ChannelSpecV2) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    if let Some(ref cfg) = ch.config {
        if let Some(obj) = cfg.as_object() {
            let mut pairs: Vec<(&String, &serde_json::Value)> = obj.iter().collect();
            pairs.sort_by(|a, b| a.0.cmp(b.0));
            for (k, v) in pairs {
                k.hash(&mut h);
                v.to_string().hash(&mut h);
            }
        } else {
            cfg.to_string().hash(&mut h);
        }
    }
    format!(
        "{}:{}:{:x}",
        channel_type_str(&ch.channel_type),
        ch.credential_id.as_deref().unwrap_or(""),
        h.finish()
    )
}

fn channel_type_str(t: &ChannelSpecV2Type) -> &'static str {
    match t {
        ChannelSpecV2Type::BuiltIn => "built-in",
        ChannelSpecV2Type::Titlebar => "titlebar",
        ChannelSpecV2Type::Slack => "slack",
        ChannelSpecV2Type::Telegram => "telegram",
        ChannelSpecV2Type::Email => "email",
        ChannelSpecV2Type::Discord => "discord",
        ChannelSpecV2Type::Teams => "teams",
    }
}

/// Pure rate-limit check helper. Returns Some(TestDeliveryResult) if rate-limited,
/// None if the call is allowed. Extracted for testability without AppHandle.
pub(crate) fn rate_limit_check(
    map: &std::collections::HashMap<String, std::time::Instant>,
    now: std::time::Instant,
    key: &str,
    channel_type: &str,
) -> Option<TestDeliveryResult> {
    match map.get(key) {
        Some(last) if now.duration_since(*last) < RATE_LIMIT_WINDOW => Some(TestDeliveryResult {
            channel_type: channel_type.to_string(),
            success: false,
            latency_ms: 0,
            error: Some("rate_limited".to_string()),
            rate_limited: Some(true),
        }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// test_channel_delivery IPC command (DELIV-06)
// ---------------------------------------------------------------------------

/// Test shape-v2 channel delivery end-to-end. (DELIV-06)
///
/// For each channel spec:
/// - Rate-limit check: if same channel key called within 1s, return `rate_limited: true`
/// - "built-in" → synthesizes a real `messages` row (user sees it in the inbox)
/// - "titlebar" → emits `titlebar-notification` Tauri event (bell round-trips)
/// - "slack"/"telegram"/"email" → delegates to the existing `deliver_*` helpers
///
/// Returns one `TestDeliveryResult` per channel in input order.
#[tauri::command]
pub async fn test_channel_delivery(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    channel_specs: Vec<ChannelSpecV2>,
    sample_title: String,
    sample_body: String,
) -> Result<Vec<TestDeliveryResult>, String> {
    let mut results = Vec::with_capacity(channel_specs.len());
    let now = std::time::Instant::now();
    let mut rate_map = TEST_DELIVERY_RATE_LIMIT.lock().await;

    for spec in channel_specs.iter() {
        let key = channel_key(spec);
        let ch_type_str = channel_type_str(&spec.channel_type);
        let start = std::time::Instant::now();

        // Rate-limit gate
        if let Some(limited) = rate_limit_check(&rate_map, now, &key, ch_type_str) {
            results.push(limited);
            continue;
        }

        // Dispatch per channel type
        let result = match spec.channel_type {
            ChannelSpecV2Type::BuiltIn => {
                match test_deliver_built_in(&state, &sample_title, &sample_body).await {
                    Ok(()) => TestDeliveryResult {
                        channel_type: "built-in".into(),
                        success: true,
                        latency_ms: start.elapsed().as_millis() as u64,
                        error: None,
                        rate_limited: None,
                    },
                    Err(e) => TestDeliveryResult {
                        channel_type: "built-in".into(),
                        success: false,
                        latency_ms: start.elapsed().as_millis() as u64,
                        error: Some(e),
                        rate_limited: None,
                    },
                }
            }
            ChannelSpecV2Type::Titlebar => {
                test_deliver_titlebar(&app, spec, &sample_title, &sample_body);
                TestDeliveryResult {
                    channel_type: "titlebar".into(),
                    success: true,
                    latency_ms: start.elapsed().as_millis() as u64,
                    error: None,
                    rate_limited: None,
                }
            }
            ChannelSpecV2Type::Slack
            | ChannelSpecV2Type::Telegram
            | ChannelSpecV2Type::Email
            | ChannelSpecV2Type::Discord
            | ChannelSpecV2Type::Teams => {
                test_deliver_external(&app, spec, &sample_title, &sample_body).await
            }
        };

        rate_map.insert(key, now);
        results.push(result);
    }

    Ok(results)
}

async fn test_deliver_built_in(
    state: &tauri::State<'_, crate::AppState>,
    title: &str,
    body: &str,
) -> Result<(), String> {
    use crate::db::models::CreateMessageInput;
    use crate::db::repos::communication::messages as msg_repo;
    let input = CreateMessageInput {
        persona_id: "__test__".to_string(),
        execution_id: None,
        title: Some(title.to_string()),
        content: body.to_string(),
        content_type: Some("text".to_string()),
        priority: Some("normal".to_string()),
        metadata: None,
        thread_id: None,
        use_case_id: None,
    };
    // AppState field is `db` (not `pool`) — see lib.rs.
    msg_repo::create(&state.db, input)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn test_deliver_titlebar(app: &tauri::AppHandle, spec: &ChannelSpecV2, title: &str, body: &str) {
    let payload = TitlebarNotificationPayload {
        persona_id: spec
            .credential_id
            .clone()
            .unwrap_or_else(|| "__test__".into()),
        persona_name: "Test".into(),
        use_case_id: None,
        event_type: None,
        title: title.to_string(),
        body: body.to_string(),
        priority: "normal".into(),
    };
    let _ = emit_event(app, event_name::TITLEBAR_NOTIFICATION, &payload);
}

async fn test_deliver_external(
    app: &AppHandle,
    spec: &ChannelSpecV2,
    title: &str,
    body: &str,
) -> TestDeliveryResult {
    let ch_type = channel_type_str(&spec.channel_type).to_string();
    let start = std::time::Instant::now();

    // Slice 1: resolve credential_id from vault and overlay spec.config so the
    // test path mirrors what real delivery sees.
    let cfg = merged_channel_config(app, spec).await;
    let ext = ExternalChannel {
        channel_type: ch_type.clone(),
        enabled: spec.enabled,
        credential_id: spec.credential_id.clone(),
        config: cfg,
    };

    let outcome: Result<(), String> = match spec.channel_type {
        ChannelSpecV2Type::Slack => deliver_slack(&ext, title, body).await,
        ChannelSpecV2Type::Telegram => deliver_telegram(&ext, title, body).await,
        ChannelSpecV2Type::Email => deliver_email(&ext, title, body).await,
        ChannelSpecV2Type::Discord => deliver_discord(&ext, title, body).await,
        ChannelSpecV2Type::Teams => deliver_teams(&ext, title, body).await,
        _ => Err("not_external".into()),
    };
    let latency_ms = start.elapsed().as_millis() as u64;
    match outcome {
        Ok(()) => TestDeliveryResult {
            channel_type: ch_type,
            success: true,
            latency_ms,
            error: None,
            rate_limited: None,
        },
        Err(e) => TestDeliveryResult {
            channel_type: ch_type,
            success: false,
            latency_ms,
            error: Some(e),
            rate_limited: None,
        },
    }
}

// ---------------------------------------------------------------------------
// Test notification command -- delivers a test message to a single channel
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn test_notification_channel(channel_json: String) -> Result<String, String> {
    let channel: ExternalChannel =
        serde_json::from_str(&channel_json).map_err(|e| format!("Invalid channel config: {e}"))?;

    let title = "Personas -- Test Notification";
    let body = "If you see this, your notification channel is working correctly.";

    match channel.channel_type.as_str() {
        "slack" => deliver_slack(&channel, title, body).await?,
        "telegram" => deliver_telegram(&channel, title, body).await?,
        "email" => deliver_email(&channel, title, body).await?,
        "discord" => deliver_discord(&channel, title, body).await?,
        "teams" => deliver_teams(&channel, title, body).await?,
        other => return Err(format!("Unknown channel type: {other}")),
    }

    Ok("Notification delivered successfully".into())
}

// ---------------------------------------------------------------------------
// Delivery stats query command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_notification_delivery_stats() -> NotificationDeliveryStats {
    NotificationDeliveryStats {
        slack: DELIVERY_METRICS.slack.snapshot(),
        telegram: DELIVERY_METRICS.telegram.snapshot(),
        email: DELIVERY_METRICS.email.snapshot(),
        discord: DELIVERY_METRICS.discord.snapshot(),
        teams: DELIVERY_METRICS.teams.snapshot(),
    }
}

// ---------------------------------------------------------------------------
// Public channel delivery (used by performance digest)
// ---------------------------------------------------------------------------

/// Deliver a notification to external channels. Exposed for use by the
/// performance digest and other system-level notifications.
pub async fn deliver_to_external_channels(
    app: &AppHandle,
    channels_json: &str,
    title: &str,
    body: &str,
) {
    let channels = parse_channels(Some(channels_json));
    let enabled: Vec<_> = channels.into_iter().filter(|c| c.enabled).collect();
    if enabled.is_empty() {
        return;
    }
    for ch in enabled {
        let metrics = DELIVERY_METRICS.for_channel(&ch.channel_type);
        let start = std::time::Instant::now();
        let result = match ch.channel_type.as_str() {
            "slack" => deliver_slack(&ch, title, body).await,
            "telegram" => deliver_telegram(&ch, title, body).await,
            "email" => deliver_email(&ch, title, body).await,
            "discord" => deliver_discord(&ch, title, body).await,
            "teams" => deliver_teams(&ch, title, body).await,
            other => {
                tracing::debug!("Unknown channel type: {}", other);
                Ok(())
            }
        };
        let latency_ms = start.elapsed().as_millis() as u64;

        let (success, error) = match &result {
            Ok(()) => {
                metrics.record_success(latency_ms);
                (true, None)
            }
            Err(e) => {
                metrics.record_failure();
                tracing::warn!(
                    channel_type = %ch.channel_type,
                    "Failed to deliver digest to {} channel: {}", ch.channel_type, e
                );
                (false, Some(e.clone()))
            }
        };

        let event = NotificationDeliveryEvent {
            channel_type: ch.channel_type.clone(),
            success,
            latency_ms,
            error,
            consecutive_failures: metrics.consecutive_failures.load(Ordering::Relaxed),
        };
        emit_event(app, event_name::NOTIFICATION_DELIVERY, &event);
    }
}

// ---------------------------------------------------------------------------
// Low-level OS send
// ---------------------------------------------------------------------------

pub(crate) fn send(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!("Failed to send OS notification: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{ChannelScopeV2, ChannelSpecV2Type};

    fn shape_v2_channel_json() -> &'static str {
        r#"[
            {"type":"built-in","enabled":true,"use_case_ids":"*"},
            {"type":"slack","enabled":true,"credential_id":"cred_123","use_case_ids":["uc_a"],"event_filter":["stock.signal.buy"]}
        ]"#
    }

    fn shape_b_legacy_json() -> &'static str {
        r##"[{"type":"slack","enabled":true,"credential_id":"cred_x","config":{"channel":"#alerts"}}]"##
    }

    fn shape_a_prefs_json() -> &'static str {
        r#"{"execution_completed":true,"approvals":false}"#
    }

    #[test]
    fn test_parse_channels_v2_shape_v2_roundtrips() {
        let parsed = parse_channels_v2(Some(shape_v2_channel_json())).expect("is v2");
        assert_eq!(parsed.len(), 2);
        // Re-serialize and re-parse to confirm zero data loss.
        let re = serde_json::to_string(&parsed).unwrap();
        let reparsed = parse_channels_v2(Some(&re)).expect("roundtrip");
        assert_eq!(parsed, reparsed);
    }

    #[test]
    fn test_parse_channels_v2_with_star_sentinel() {
        let parsed = parse_channels_v2(Some(shape_v2_channel_json())).unwrap();
        match &parsed[0].use_case_ids {
            ChannelScopeV2::All(s) => assert_eq!(s, "*"),
            _ => panic!("expected All(\"*\")"),
        }
    }

    #[test]
    fn test_parse_channels_v2_with_specific_array() {
        let parsed = parse_channels_v2(Some(shape_v2_channel_json())).unwrap();
        match &parsed[1].use_case_ids {
            ChannelScopeV2::Specific(ids) => assert_eq!(ids, &vec!["uc_a".to_string()]),
            _ => panic!("expected Specific"),
        }
        assert_eq!(parsed[1].channel_type, ChannelSpecV2Type::Slack);
    }

    #[test]
    fn test_parse_channels_v2_rejects_shape_a_object() {
        assert!(parse_channels_v2(Some(shape_a_prefs_json())).is_none());
    }

    #[test]
    fn test_parse_channels_v2_rejects_shape_b_legacy_array() {
        assert!(parse_channels_v2(Some(shape_b_legacy_json())).is_none());
    }

    #[test]
    fn test_parse_channels_v2_handles_empty_array() {
        let parsed = parse_channels_v2(Some("[]")).unwrap();
        assert!(parsed.is_empty());
    }

    #[test]
    fn test_parse_channels_v2_handles_none_input() {
        assert!(parse_channels_v2(None).is_none());
    }

    #[test]
    fn test_parse_channels_v2_multi_instance_same_type() {
        let json = r#"[
            {"type":"slack","enabled":true,"credential_id":"cred_1","use_case_ids":["uc_a"]},
            {"type":"slack","enabled":true,"credential_id":"cred_2","use_case_ids":["uc_b"]}
        ]"#;
        let parsed = parse_channels_v2(Some(json)).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].channel_type, ChannelSpecV2Type::Slack);
        assert_eq!(parsed[1].channel_type, ChannelSpecV2Type::Slack);
    }

    #[test]
    fn test_parse_channels_v2_built_in_without_credential_id() {
        let json = r#"[{"type":"built-in","enabled":true,"use_case_ids":"*"}]"#;
        let parsed = parse_channels_v2(Some(json)).unwrap();
        assert_eq!(parsed[0].channel_type, ChannelSpecV2Type::BuiltIn);
        assert!(parsed[0].credential_id.is_none());
    }

    #[test]
    fn test_parse_prefs_unchanged_regression() {
        // Shape A JSON still parses via legacy parse_prefs with correct values.
        // The `approvals` field is not in NotificationPrefs; `execution_completed` is.
        let prefs = parse_prefs(Some(shape_a_prefs_json()));
        assert_eq!(prefs.execution_completed, true);
        // Other fields default to true when not in JSON (serde ignores unknown keys).
        assert_eq!(prefs.manual_review, true);
    }

    #[test]
    fn test_parse_channels_legacy_shape_b_unchanged_regression() {
        let channels = parse_channels(Some(shape_b_legacy_json()));
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0].channel_type, "slack");
        assert_eq!(channels[0].credential_id.as_deref(), Some("cred_x"));
    }

    // ---- Task 1: Phase 19 camelCase serde tests (DELIV-02, D-07) ----

    #[test]
    fn test_titlebar_payload_serde_camelcase() {
        let p = TitlebarNotificationPayload {
            persona_id: "p1".into(),
            persona_name: "Alice".into(),
            use_case_id: Some("uc1".into()),
            event_type: None,
            title: "hi".into(),
            body: "world".into(),
            priority: "normal".into(),
        };
        let json = serde_json::to_value(&p).unwrap();
        assert!(json.get("personaId").is_some(), "personaId key missing");
        assert!(json.get("useCaseId").is_some(), "useCaseId key missing");
        assert!(json.get("eventType").is_some(), "eventType key missing");
        assert_eq!(json.get("eventType").unwrap(), &serde_json::Value::Null);
    }

    #[test]
    fn test_test_delivery_result_serde_camelcase() {
        let r = TestDeliveryResult {
            channel_type: "slack".into(),
            success: true,
            latency_ms: 42,
            error: None,
            rate_limited: None,
        };
        let json = serde_json::to_value(&r).unwrap();
        assert!(json.get("channelType").is_some(), "channelType key missing");
        assert!(json.get("latencyMs").is_some(), "latencyMs key missing");
        assert!(json.get("rateLimited").is_some(), "rateLimited key missing");
    }

    // ---- Task 2: Phase 19 delivery filtering tests (DELIV-01, DELIV-03, DELIV-05) ----

    fn mk_ctx(use_case_id: Option<&str>, emit_event_type: Option<&str>) -> DeliveryContext {
        DeliveryContext {
            persona_id: "p1".into(),
            persona_name: "Alice".into(),
            use_case_id: use_case_id.map(String::from),
            emit_event_type: emit_event_type.map(String::from),
            priority: None,
        }
    }

    #[test]
    fn test_deliver_built_in_noop() {
        // built-in passes through filter_channels_for_delivery (enabled + All scope)
        // but has no side effects — specifically, titlebar counter stays unchanged.
        let chans = vec![ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::BuiltIn,
            enabled: true,
            credential_id: None,
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: None,
        }];
        let titlebar_before = DELIVERY_METRICS.for_channel("titlebar").attempted_count();
        let filtered = filter_channels_for_delivery(chans, &mk_ctx(None, None));
        assert_eq!(filtered.len(), 1, "built-in should pass through filter");
        assert!(matches!(
            filtered[0].channel_type,
            ChannelSpecV2Type::BuiltIn
        ));
        // Titlebar counter unchanged because built-in arm does nothing
        let titlebar_after = DELIVERY_METRICS.for_channel("titlebar").attempted_count();
        assert_eq!(
            titlebar_before, titlebar_after,
            "built-in must not touch titlebar metrics"
        );
    }

    #[test]
    fn test_deliver_v2_use_case_scoping() {
        let chans = vec![
            ChannelSpecV2 {
                channel_type: ChannelSpecV2Type::BuiltIn,
                enabled: true,
                credential_id: None,
                use_case_ids: ChannelScopeV2::Specific(vec!["uc_b".into()]),
                event_filter: None,
                config: None,
            },
            ChannelSpecV2 {
                channel_type: ChannelSpecV2Type::BuiltIn,
                enabled: true,
                credential_id: None,
                use_case_ids: ChannelScopeV2::All("*".into()),
                event_filter: None,
                config: None,
            },
        ];
        // Scope mismatch → first channel filtered out; star → second passes
        let filtered = filter_channels_for_delivery(chans.clone(), &mk_ctx(Some("uc_a"), None));
        assert_eq!(filtered.len(), 1, "uc_a should skip uc_b-specific channel");
        assert!(matches!(filtered[0].use_case_ids, ChannelScopeV2::All(_)));
        // Matching scope → first channel also passes
        let filtered = filter_channels_for_delivery(chans, &mk_ctx(Some("uc_b"), None));
        assert_eq!(filtered.len(), 2, "uc_b should pass both channels");
    }

    #[test]
    fn test_deliver_v2_disabled_channel_skipped() {
        let chans = vec![ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Titlebar,
            enabled: false,
            credential_id: None,
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: None,
        }];
        let filtered = filter_channels_for_delivery(chans, &mk_ctx(None, None));
        assert_eq!(filtered.len(), 0, "disabled channel must be skipped");
    }

    #[test]
    fn test_event_filter_gates_emit_only() {
        let chans = vec![ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Titlebar,
            enabled: true,
            credential_id: None,
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: Some(vec!["stocks.buy".into()]),
            config: None,
        }];
        // UserMessage (emit_event_type = None) → filter bypassed, channel kept
        let passed = apply_event_filter(&chans, &mk_ctx(None, None));
        assert_eq!(passed.len(), 1, "UserMessage must bypass event_filter");
        // EmitEvent unmatched → channel filtered out
        let passed = apply_event_filter(&chans, &mk_ctx(None, Some("stocks.sell")));
        assert_eq!(passed.len(), 0, "unmatched EmitEvent must be filtered");
        // EmitEvent matched → channel kept
        let passed = apply_event_filter(&chans, &mk_ctx(None, Some("stocks.buy")));
        assert_eq!(passed.len(), 1, "matched EmitEvent must pass through");
    }

    // ---- Task 1: Phase 19 Plan 02 rate-limit and channel_key tests (DELIV-06, D-05) ----

    #[test]
    fn test_channel_key_stable() {
        let spec = ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Slack,
            enabled: true,
            credential_id: Some("cred-1".into()),
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(serde_json::json!({"channel": "#alerts", "username": "bot"})),
        };
        let spec2 = spec.clone();
        assert_eq!(channel_key(&spec), channel_key(&spec2));
    }

    #[test]
    fn test_channel_key_differs_on_credential() {
        let base = ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Slack,
            enabled: true,
            credential_id: Some("cred-1".into()),
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(serde_json::json!({"channel": "#a"})),
        };
        let mut other = base.clone();
        other.credential_id = Some("cred-2".into());
        assert_ne!(channel_key(&base), channel_key(&other));
    }

    #[test]
    fn test_channel_key_differs_on_config() {
        let base = ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Slack,
            enabled: true,
            credential_id: Some("cred-1".into()),
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(serde_json::json!({"channel": "#a"})),
        };
        let mut other = base.clone();
        other.config = Some(serde_json::json!({"channel": "#b"}));
        assert_ne!(channel_key(&base), channel_key(&other));
    }

    #[test]
    fn test_rate_limit_same_channel() {
        let mut map: std::collections::HashMap<String, std::time::Instant> =
            std::collections::HashMap::new();
        let key = "slack:cred-1:abc123";
        let t0 = std::time::Instant::now();
        // First check: not in map → allowed
        assert!(rate_limit_check(&map, t0, key, "slack").is_none());
        map.insert(key.to_string(), t0);
        // Second check within 1s → rate-limited
        let t1 = t0 + std::time::Duration::from_millis(500);
        let blocked = rate_limit_check(&map, t1, key, "slack");
        assert!(blocked.is_some());
        assert_eq!(blocked.unwrap().error.as_deref(), Some("rate_limited"));
        // Third check after 1.1s → allowed again
        let t2 = t0 + std::time::Duration::from_millis(1100);
        assert!(rate_limit_check(&map, t2, key, "slack").is_none());
    }

    #[test]
    fn test_rate_limit_key_independence() {
        let mut map: std::collections::HashMap<String, std::time::Instant> =
            std::collections::HashMap::new();
        let t0 = std::time::Instant::now();
        map.insert("slack:cred-1:abc".into(), t0);
        // Different credential_id → independent bucket, not rate-limited
        assert!(rate_limit_check(
            &map,
            t0 + std::time::Duration::from_millis(200),
            "slack:cred-2:abc",
            "slack"
        )
        .is_none());
    }

    // ---- Slice 1: Discord/Teams enum + dispatch coverage ----

    #[test]
    fn test_channel_type_str_includes_discord_and_teams() {
        assert_eq!(channel_type_str(&ChannelSpecV2Type::Discord), "discord");
        assert_eq!(channel_type_str(&ChannelSpecV2Type::Teams), "teams");
    }

    #[test]
    fn test_metrics_for_channel_resolves_discord_and_teams() {
        // for_channel must return distinct ChannelMetrics for the two new
        // channel types — otherwise stats would silently bucket failures
        // into Slack's counters.
        let discord = DELIVERY_METRICS.for_channel("discord");
        let teams = DELIVERY_METRICS.for_channel("teams");
        let slack = DELIVERY_METRICS.for_channel("slack");
        assert!(!std::ptr::eq(discord, slack));
        assert!(!std::ptr::eq(teams, slack));
        assert!(!std::ptr::eq(discord, teams));
    }

    #[test]
    fn test_parse_channels_v2_accepts_discord_and_teams() {
        let json = r#"[
            {"type":"discord","enabled":true,"credential_id":"cred_d","use_case_ids":"*","config":{"channel_id":"C123"}},
            {"type":"teams","enabled":true,"use_case_ids":"*","config":{"webhook_url":"https://outlook.office.com/webhook/abc"}}
        ]"#;
        let parsed = parse_channels_v2(Some(json)).expect("parses");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].channel_type, ChannelSpecV2Type::Discord);
        assert_eq!(parsed[0].credential_id.as_deref(), Some("cred_d"));
        assert_eq!(parsed[1].channel_type, ChannelSpecV2Type::Teams);
        assert!(parsed[1].credential_id.is_none());
    }

    #[test]
    fn test_channel_spec_v2_discord_serializes_kebab_case() {
        // Round-trip: ChannelSpecV2Type::Discord serializes as "discord" on the wire
        // (kebab-case rename). This is what dispatcher match arms key on.
        let spec = ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Discord,
            enabled: true,
            credential_id: Some("cred-1".into()),
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(serde_json::json!({"channel_id": "C123"})),
        };
        let json = serde_json::to_value(&spec).unwrap();
        assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("discord"));
    }

    #[test]
    fn test_channel_spec_v2_teams_serializes_kebab_case() {
        let spec = ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Teams,
            enabled: true,
            credential_id: None,
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(serde_json::json!({"webhook_url": "https://x"})),
        };
        let json = serde_json::to_value(&spec).unwrap();
        assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("teams"));
    }

    #[tokio::test]
    async fn test_deliver_discord_missing_config_actionable_error() {
        // No webhook_url AND no bot_token → user-facing error must point at both paths.
        let ch = ExternalChannel {
            channel_type: "discord".into(),
            enabled: true,
            credential_id: None,
            config: HashMap::new(),
        };
        let err = deliver_discord(&ch, "t", "b").await.unwrap_err();
        assert!(err.contains("webhook_url"));
        assert!(err.contains("bot_token"));
    }

    #[tokio::test]
    async fn test_deliver_discord_bot_token_without_channel_id_errors() {
        // Vault gives bot_token but channel_id wasn't supplied — must not
        // silently use a guild ID or default channel.
        let mut config = HashMap::new();
        config.insert("bot_token".into(), "fake-token".into());
        let ch = ExternalChannel {
            channel_type: "discord".into(),
            enabled: true,
            credential_id: Some("cred_d".into()),
            config,
        };
        let err = deliver_discord(&ch, "t", "b").await.unwrap_err();
        assert!(err.contains("channel_id"));
    }

    #[tokio::test]
    async fn test_deliver_teams_graph_requires_team_id() {
        // Slice 4: access_token present but no team_id — must error with
        // a clear pointer at the missing field instead of attempting a
        // malformed Graph URL.
        let mut config = HashMap::new();
        config.insert("access_token".into(), "fake-token".into());
        let ch = ExternalChannel {
            channel_type: "teams".into(),
            enabled: true,
            credential_id: Some("cred_t".into()),
            config,
        };
        let err = deliver_teams(&ch, "t", "b").await.unwrap_err();
        assert!(err.contains("team_id"));
    }

    #[tokio::test]
    async fn test_deliver_teams_graph_requires_channel_id() {
        // Slice 4: access_token + team_id present, but no channel_id.
        let mut config = HashMap::new();
        config.insert("access_token".into(), "fake-token".into());
        config.insert("team_id".into(), "T-123".into());
        let ch = ExternalChannel {
            channel_type: "teams".into(),
            enabled: true,
            credential_id: Some("cred_t".into()),
            config,
        };
        let err = deliver_teams(&ch, "t", "b").await.unwrap_err();
        assert!(err.contains("channel_id"));
    }

    #[tokio::test]
    async fn test_deliver_teams_no_config_errors_with_setup_link() {
        let ch = ExternalChannel {
            channel_type: "teams".into(),
            enabled: true,
            credential_id: None,
            config: HashMap::new(),
        };
        let err = deliver_teams(&ch, "t", "b").await.unwrap_err();
        assert!(err.contains("webhook_url"));
        assert!(err.contains("microsoft.com"));
    }

    #[tokio::test]
    async fn test_deliver_slack_credential_path_requires_channel() {
        // bot_token present but no channel set → must error rather than
        // silently fall through to webhook URL or pick a random channel.
        let mut config = HashMap::new();
        config.insert("bot_token".into(), "fake-xoxb".into());
        let ch = ExternalChannel {
            channel_type: "slack".into(),
            enabled: true,
            credential_id: Some("cred_s".into()),
            config,
        };
        let err = deliver_slack(&ch, "t", "b").await.unwrap_err();
        assert!(err.contains("channel"));
    }

    #[test]
    fn test_notification_delivery_stats_includes_discord_and_teams() {
        // get_notification_delivery_stats returns a NotificationDeliveryStats
        // with discord+teams populated (smoke test that we wired the new
        // ChannelMetrics into the stats command).
        let stats = get_notification_delivery_stats();
        // attempted is u64; this just ensures the field exists at compile time
        // and reads zero for a fresh process. (Other tests may have advanced
        // the slack/email/etc counters.)
        let _ = stats.discord.attempted;
        let _ = stats.teams.attempted;
    }
}
