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
        self.total_latency_ms.fetch_add(latency_ms, Ordering::Relaxed);
        self.consecutive_failures.store(0, Ordering::Relaxed);
        // Update max latency (CAS loop)
        let mut current = self.max_latency_ms.load(Ordering::Relaxed);
        while latency_ms > current {
            match self.max_latency_ms.compare_exchange_weak(
                current, latency_ms, Ordering::Relaxed, Ordering::Relaxed,
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
        let avg_latency_ms = if succeeded > 0 { total_latency_ms as f64 / succeeded as f64 } else { 0.0 };
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
}

impl DeliveryMetrics {
    fn for_channel(&self, channel_type: &str) -> &ChannelMetrics {
        match channel_type {
            "slack" => &self.slack,
            "telegram" => &self.telegram,
            "email" => &self.email,
            "titlebar" => &self.titlebar,
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
                tracing::trace!(
                    "built-in channel: delivery is a no-op (message already in inbox)"
                );
            }
            ChannelSpecV2Type::Titlebar => {
                let payload = TitlebarNotificationPayload {
                    persona_id: ctx.persona_id.clone(),
                    persona_name: ctx.persona_name.clone(),
                    use_case_id: ctx.use_case_id.clone(),
                    event_type: ctx.emit_event_type.clone(),
                    title: title.to_string(),
                    body: body.to_string(),
                    priority: ctx
                        .priority
                        .clone()
                        .unwrap_or_else(|| "normal".to_string()),
                };
                emit_event(app, event_name::TITLEBAR_NOTIFICATION, &payload);
                DELIVERY_METRICS.for_channel("titlebar").record_success(0);
            }
            ChannelSpecV2Type::Slack | ChannelSpecV2Type::Telegram | ChannelSpecV2Type::Email => {
                // Translate ChannelSpecV2 config to the ExternalChannel form expected by
                // the existing async deliver_* functions.
                let ch_type = match ch.channel_type {
                    ChannelSpecV2Type::Slack => "slack",
                    ChannelSpecV2Type::Telegram => "telegram",
                    ChannelSpecV2Type::Email => "email",
                    _ => unreachable!(),
                };
                // Build config map from serde_json::Value (shape-v2 config is Value)
                let config: HashMap<String, String> = ch
                    .config
                    .as_ref()
                    .and_then(|v| v.as_object())
                    .map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                    .unwrap_or_default();
                let external = ExternalChannel {
                    channel_type: ch_type.to_string(),
                    enabled: ch.enabled,
                    credential_id: ch.credential_id.clone(),
                    config,
                };
                let app = app.clone();
                let title = title.to_string();
                let body = body.to_string();
                tokio::spawn(async move {
                    let start = std::time::Instant::now();
                    let result = match external.channel_type.as_str() {
                        "slack" => deliver_slack(&external, &title, &body).await,
                        "telegram" => deliver_telegram(&external, &title, &body).await,
                        "email" => deliver_email(&external, &title, &body).await,
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

/// POST to Slack incoming webhook URL.
async fn deliver_slack(
    ch: &ExternalChannel,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let webhook_url = SecureString::new(
        ch.config
            .get("webhook_url")
            .filter(|u| !u.is_empty())
            .ok_or("Slack webhook_url not configured")?
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
async fn deliver_telegram(
    ch: &ExternalChannel,
    title: &str,
    body: &str,
) -> Result<(), String> {
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
async fn deliver_email(
    ch: &ExternalChannel,
    title: &str,
    body: &str,
) -> Result<(), String> {
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
    notify_execution_completed_rich(app, persona_name, status, duration_ms, channels, None, None, None);
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

pub fn notify_n8n_transform_completed(
    app: &AppHandle,
    workflow_name: &str,
    success: bool,
) {
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
pub fn send_app_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) {
    send(&app, &title, &body);
}

// ---------------------------------------------------------------------------
// Per-channel test delivery rate limiter (DELIV-06, D-05)
// ---------------------------------------------------------------------------

/// Per-channel test delivery rate limiter.
/// Key = `channel_key(spec)` = "type:credential_id:config_hash"
/// Value = Instant of last successful call for that channel.
/// 1 req/sec per channel; in-memory only, resets on app restart. (DELIV-06, D-05)
static TEST_DELIVERY_RATE_LIMIT: LazyLock<TokioMutex<std::collections::HashMap<String, std::time::Instant>>> =
    LazyLock::new(|| TokioMutex::new(std::collections::HashMap::new()));

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
            ChannelSpecV2Type::Slack | ChannelSpecV2Type::Telegram | ChannelSpecV2Type::Email => {
                test_deliver_external(spec, &sample_title, &sample_body).await
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
    use crate::db::repos::communication::messages as msg_repo;
    use crate::db::models::CreateMessageInput;
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
    msg_repo::create(&state.db, input).map(|_| ()).map_err(|e| e.to_string())
}

fn test_deliver_titlebar(
    app: &tauri::AppHandle,
    spec: &ChannelSpecV2,
    title: &str,
    body: &str,
) {
    let payload = TitlebarNotificationPayload {
        persona_id: spec.credential_id.clone().unwrap_or_else(|| "__test__".into()),
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
    spec: &ChannelSpecV2,
    title: &str,
    body: &str,
) -> TestDeliveryResult {
    let ch_type = channel_type_str(&spec.channel_type).to_string();
    let start = std::time::Instant::now();

    // Convert ChannelSpecV2 → ExternalChannel so we can call the existing deliver_* helpers.
    // ExternalChannel.config is HashMap<String,String>; ChannelSpecV2.config is Option<serde_json::Value>.
    let mut cfg: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Some(v) = spec.config.as_ref().and_then(|c| c.as_object()) {
        for (k, val) in v {
            let s = match val {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            cfg.insert(k.clone(), s);
        }
    }
    let ext = ExternalChannel {
        channel_type: ch_type.clone(),
        enabled: spec.enabled,
        credential_id: spec.credential_id.clone(),
        config: cfg,
    };

    // deliver_slack/_telegram/_email all return Result<(), String>.
    let outcome: Result<(), String> = match spec.channel_type {
        ChannelSpecV2Type::Slack => deliver_slack(&ext, title, body).await,
        ChannelSpecV2Type::Telegram => deliver_telegram(&ext, title, body).await,
        ChannelSpecV2Type::Email => deliver_email(&ext, title, body).await,
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
pub async fn test_notification_channel(
    channel_json: String,
) -> Result<String, String> {
    let channel: ExternalChannel = serde_json::from_str(&channel_json)
        .map_err(|e| format!("Invalid channel config: {e}"))?;

    let title = "Personas -- Test Notification";
    let body = "If you see this, your notification channel is working correctly.";

    match channel.channel_type.as_str() {
        "slack" => deliver_slack(&channel, title, body).await?,
        "telegram" => deliver_telegram(&channel, title, body).await?,
        "email" => deliver_email(&channel, title, body).await?,
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
    }
}

// ---------------------------------------------------------------------------
// Public channel delivery (used by performance digest)
// ---------------------------------------------------------------------------

/// Deliver a notification to external channels. Exposed for use by the
/// performance digest and other system-level notifications.
pub async fn deliver_to_external_channels(app: &AppHandle, channels_json: &str, title: &str, body: &str) {
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
        assert!(matches!(filtered[0].channel_type, ChannelSpecV2Type::BuiltIn));
        // Titlebar counter unchanged because built-in arm does nothing
        let titlebar_after = DELIVERY_METRICS.for_channel("titlebar").attempted_count();
        assert_eq!(titlebar_before, titlebar_after, "built-in must not touch titlebar metrics");
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
        let mut map: std::collections::HashMap<String, std::time::Instant> = std::collections::HashMap::new();
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
        let mut map: std::collections::HashMap<String, std::time::Instant> = std::collections::HashMap::new();
        let t0 = std::time::Instant::now();
        map.insert("slack:cred-1:abc".into(), t0);
        // Different credential_id → independent bucket, not rate-limited
        assert!(rate_limit_check(&map, t0 + std::time::Duration::from_millis(200), "slack:cred-2:abc", "slack").is_none());
    }
}
