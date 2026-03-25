use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::engine::crypto::SecureString;

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

// ---------------------------------------------------------------------------
// Multi-channel delivery
// ---------------------------------------------------------------------------

/// Deliver a notification to all enabled external channels (fire-and-forget).
fn deliver_to_channels(channels_json: Option<&str>, title: &str, body: &str) {
    let channels = parse_channels(channels_json);
    let enabled: Vec<_> = channels.into_iter().filter(|c| c.enabled).collect();
    if enabled.is_empty() {
        return;
    }
    let title = title.to_owned();
    let body = body.to_owned();
    tokio::spawn(async move {
        for ch in enabled {
            let result = match ch.channel_type.as_str() {
                "slack" => deliver_slack(&ch, &title, &body).await,
                "telegram" => deliver_telegram(&ch, &title, &body).await,
                "email" => deliver_email(&ch, &title, &body).await,
                other => {
                    tracing::debug!("Unknown channel type: {}", other);
                    Ok(())
                }
            };
            if let Err(e) = result {
                tracing::warn!("Failed to deliver to {} channel: {}", ch.channel_type, e);
            }
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
    deliver_to_channels(channels, &title, &body);
}

pub fn notify_manual_review(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    channels: Option<&str>,
) {
    if !parse_prefs(channels).manual_review {
        return;
    }
    let heading = "Manual Review Needed";
    let body = format!("{}: {}", persona_name, title);
    send(app, heading, &body);
    deliver_to_channels(channels, heading, &body);
}

pub fn notify_new_message(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    channels: Option<&str>,
) {
    if !parse_prefs(channels).new_message {
        return;
    }
    let heading = format!("Message from {}", persona_name);
    send(app, &heading, title);
    deliver_to_channels(channels, &heading, title);
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
    deliver_to_channels(channels, &heading, &body);
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
// Low-level OS send
// ---------------------------------------------------------------------------

pub(crate) fn send(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!("Failed to send OS notification: {}", e);
    }
}
