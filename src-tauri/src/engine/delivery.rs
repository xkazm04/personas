#![allow(dead_code)]
use crate::error::AppError;

/// Deliver a message to an external channel
pub async fn deliver_message(
    channel_type: &str,
    message: &str,
    credential_data: &serde_json::Value,
) -> Result<String, AppError> {
    match channel_type {
        "slack" => deliver_slack(message, credential_data).await,
        "telegram" => deliver_telegram(message, credential_data).await,
        _ => Err(AppError::Validation(format!(
            "Unknown channel type: {}",
            channel_type
        ))),
    }
}

async fn deliver_slack(message: &str, cred: &serde_json::Value) -> Result<String, AppError> {
    let token = cred
        .get("bot_token")
        .or_else(|| cred.get("SLACK_BOT_TOKEN"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("Missing Slack bot_token".into()))?;

    let channel = cred
        .get("channel")
        .or_else(|| cred.get("SLACK_CHANNEL"))
        .and_then(|v| v.as_str())
        .unwrap_or("#general");

    let client = reqwest::Client::new();
    let resp = client
        .post("https://slack.com/api/chat.postMessage")
        .bearer_auth(token)
        .json(&serde_json::json!({
            "channel": channel,
            "text": message,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Slack request failed: {}", e)))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Slack response: {}", e)))?;

    if body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok("Delivered to Slack".into())
    } else {
        let err = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        Err(AppError::Internal(format!("Slack API error: {}", err)))
    }
}

async fn deliver_telegram(message: &str, cred: &serde_json::Value) -> Result<String, AppError> {
    let token = cred
        .get("bot_token")
        .or_else(|| cred.get("TELEGRAM_BOT_TOKEN"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("Missing Telegram bot_token".into()))?;

    let chat_id = cred
        .get("chat_id")
        .or_else(|| cred.get("TELEGRAM_CHAT_ID"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("Missing Telegram chat_id".into()))?;

    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "Markdown",
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Telegram request failed: {}", e)))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Telegram response: {}", e)))?;

    if body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok("Delivered to Telegram".into())
    } else {
        let desc = body
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        Err(AppError::Internal(format!("Telegram API error: {}", desc)))
    }
}
