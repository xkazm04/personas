//! Smee.io webhook relay — connects to a smee.io channel via SSE and relays
//! received webhook payloads into the local event bus.
//!
//! Smee.io is a free webhook delivery service by GitHub that provides a stable
//! public URL. 3rd-party apps POST webhooks to the Smee URL, and this module
//! receives them in real-time via Server-Sent Events.

use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::settings;
use crate::db::DbPool;

pub const SETTINGS_KEY: &str = "smee_channel_url";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct SmeeRelayState {
    pub channel_url: Option<String>,
    pub connected: bool,
    pub events_relayed: u64,
    pub last_event_at: Option<String>,
    pub error: Option<String>,
}

impl SmeeRelayState {
    pub fn new() -> Self {
        Self {
            channel_url: None,
            connected: false,
            events_relayed: 0,
            last_event_at: None,
            error: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Status (emitted as Tauri event for frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SmeeRelayStatus {
    pub channel_url: Option<String>,
    pub connected: bool,
    pub events_relayed: u64,
    pub last_event_at: Option<String>,
    pub error: Option<String>,
}

fn emit_status(app: &AppHandle, state: &SmeeRelayState) {
    let status = SmeeRelayStatus {
        channel_url: state.channel_url.clone(),
        connected: state.connected,
        events_relayed: state.events_relayed,
        last_event_at: state.last_event_at.clone(),
        error: state.error.clone(),
    };
    let _ = app.emit("smee-relay-status", status);
}

// ---------------------------------------------------------------------------
// SSE relay loop
// ---------------------------------------------------------------------------

/// Connect to a smee.io channel and relay payloads into the local event bus.
///
/// This function blocks on the SSE stream. On disconnect, it returns so the
/// caller can implement retry logic.
async fn relay_sse_stream(
    channel_url: &str,
    pool: &DbPool,
    app: &AppHandle,
    state: &Arc<tokio::sync::Mutex<SmeeRelayState>>,
) -> Result<(), String> {
    let http = reqwest::Client::builder()
        .no_proxy() // SSE to smee.io — skip any local proxy config
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = http
        .get(channel_url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    // Mark connected
    {
        let mut s = state.lock().await;
        s.connected = true;
        s.error = None;
        emit_status(app, &s);
    }

    tracing::info!(url = %channel_url, "Smee relay connected");

    // Stream SSE lines
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process complete SSE messages (separated by double newline)
        while let Some(pos) = buffer.find("\n\n") {
            let message = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            // Extract the data: line(s) from the SSE message
            let data_lines: Vec<&str> = message
                .lines()
                .filter(|l| l.starts_with("data: ") || l.starts_with("data:"))
                .map(|l| l.strip_prefix("data: ").or_else(|| l.strip_prefix("data:")).unwrap_or(""))
                .collect();

            if data_lines.is_empty() {
                continue;
            }

            let data = data_lines.join("");

            // Skip the smee.io "ready" ping
            if data.is_empty() || data == "{}" {
                continue;
            }

            // Parse as JSON and publish to event bus
            let payload_json: serde_json::Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => {
                    // Not JSON — wrap raw text as payload
                    serde_json::json!({ "raw": data })
                }
            };

            // Extract webhook metadata from smee payload
            let event_type = payload_json
                .get("x-github-event")
                .and_then(|v| v.as_str())
                .map(|s| format!("github_{s}"))
                .unwrap_or_else(|| "smee_webhook".to_string());

            let body = payload_json.get("body").cloned().unwrap_or(payload_json.clone());

            let input = CreatePersonaEventInput {
                event_type,
                source_type: "smee_relay".to_string(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: Some(body.to_string()),
                use_case_id: None,
            };

            match event_repo::publish(pool, input) {
                Ok(event) => {
                    let _ = app.emit("event-bus", event.clone());
                    let mut s = state.lock().await;
                    s.events_relayed += 1;
                    s.last_event_at = Some(chrono::Utc::now().to_rfc3339());
                    emit_status(app, &s);

                    tracing::debug!(event_id = %event.id, "Smee relay: published event");
                }
                Err(e) => {
                    tracing::debug!(error = %e, "Smee relay: failed to publish event");
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Background task
// ---------------------------------------------------------------------------

/// Long-lived background task that manages the Smee relay connection.
///
/// Reads the channel URL from settings, connects via SSE, and reconnects
/// with exponential backoff on failure. Listens for `smee-channel-update`
/// events to reconnect when the user changes the URL.
pub async fn run_smee_relay(
    pool: DbPool,
    app: AppHandle,
    state: Arc<tokio::sync::Mutex<SmeeRelayState>>,
) {
    // Initial delay to let the app start
    tokio::time::sleep(Duration::from_secs(5)).await;

    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(30);

    loop {
        // Read channel URL from settings
        let channel_url = settings::get(&pool, SETTINGS_KEY)
            .ok()
            .flatten();

        match channel_url {
            Some(url) if !url.is_empty() && url.starts_with("https://smee.io/") => {
                {
                    let mut s = state.lock().await;
                    s.channel_url = Some(url.clone());
                    emit_status(&app, &s);
                }

                match relay_sse_stream(&url, &pool, &app, &state).await {
                    Ok(()) => {
                        // Stream ended normally (server closed connection)
                        tracing::info!("Smee relay stream ended, reconnecting...");
                        backoff = Duration::from_secs(1);
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "Smee relay error");
                        let mut s = state.lock().await;
                        s.connected = false;
                        s.error = Some(e);
                        emit_status(&app, &s);
                    }
                }

                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(max_backoff);
            }
            _ => {
                // No channel URL configured — idle
                {
                    let mut s = state.lock().await;
                    s.channel_url = None;
                    s.connected = false;
                    s.error = None;
                    emit_status(&app, &s);
                }
                // Poll settings every 10 seconds to detect URL changes
                tokio::time::sleep(Duration::from_secs(10)).await;
                backoff = Duration::from_secs(1);
            }
        }
    }
}
