//! Smee.io webhook relay — connects to a smee.io channel via SSE and relays
//! received webhook payloads into the local event bus.
//!
//! Smee.io is a free webhook delivery service by GitHub that provides a stable
//! public URL. 3rd-party apps POST webhooks to the Smee URL, and this module
//! receives them in real-time via Server-Sent Events.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use super::safe_json;
use super::event_registry::event_name;
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::settings;
use crate::db::DbPool;

pub const SETTINGS_KEY: &str = "smee_channel_url";

/// Maximum SSE buffer size (1 MB). If the buffer exceeds this without producing
/// a complete SSE message, the connection is dropped to prevent memory exhaustion.
const MAX_SSE_BUFFER_BYTES: usize = 1_024 * 1_024;

/// Normalize SSE line endings: `\r\n` → `\n`, then bare `\r` → `\n`.
/// The SSE spec allows `\r`, `\n`, or `\r\n` as line terminators; normalizing
/// up-front lets the rest of the parser only look for `\n`.
fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Find the first SSE message boundary (`\n\n`) and return
/// `(message_end, delimiter_len)` so the caller can split correctly.
/// Assumes the buffer has already been normalized via [`normalize_line_endings`].
fn find_sse_boundary(buf: &str) -> Option<(usize, usize)> {
    buf.find("\n\n").map(|pos| (pos, 2))
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Per-relay connection status tracked individually so one relay's
/// disconnect does not clobber the aggregate state of other relays.
struct RelayInstanceStatus {
    connected: bool,
    error: Option<String>,
    events_relayed: u64,
    last_event_at: Option<String>,
}

pub struct SmeeRelayState {
    pub channel_url: Option<String>,
    /// Per-relay status keyed by relay ID (or "__legacy__" for the single-URL mode).
    relays: HashMap<String, RelayInstanceStatus>,
}

impl SmeeRelayState {
    pub fn new() -> Self {
        Self {
            channel_url: None,
            relays: HashMap::new(),
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
    let any_connected = state.relays.values().any(|r| r.connected);
    let total_events: u64 = state.relays.values().map(|r| r.events_relayed).sum();
    let latest_event = state
        .relays
        .values()
        .filter_map(|r| r.last_event_at.as_deref())
        .max()
        .map(String::from);
    // Only surface an error when no relay is connected.
    let aggregate_error = if any_connected {
        None
    } else {
        state
            .relays
            .values()
            .filter_map(|r| r.error.clone())
            .last()
    };

    let status = SmeeRelayStatus {
        channel_url: state.channel_url.clone(),
        connected: any_connected,
        events_relayed: total_events,
        last_event_at: latest_event,
        error: aggregate_error,
    };
    let _ = app.emit(event_name::SMEE_RELAY_STATUS, status);
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
        s.relays.insert("__legacy__".to_string(), RelayInstanceStatus {
            connected: true,
            error: None,
            events_relayed: 0,
            last_event_at: None,
        });
        emit_status(app, &s);
    }

    tracing::info!(url = %channel_url, "Smee relay connected");

    // Stream SSE lines
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&normalize_line_endings(&text));

        // Guard against unbounded buffer growth from a misbehaving endpoint
        if buffer.len() > MAX_SSE_BUFFER_BYTES {
            return Err("SSE buffer exceeded 1 MB without a complete message — disconnecting".into());
        }

        // Process complete SSE messages (separated by \n\n)
        while let Some((pos, delim_len)) = find_sse_boundary(&buffer) {
            let message = buffer[..pos].to_string();
            buffer = buffer[pos + delim_len..].to_string();

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
            let payload_json: serde_json::Value = match safe_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => {
                    // Not JSON or exceeded safety limits — wrap raw text as payload
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
                    let _ = app.emit(event_name::EVENT_BUS, event.clone());
                    let mut s = state.lock().await;
                    if let Some(r) = s.relays.get_mut("__legacy__") {
                        r.events_relayed += 1;
                        r.last_event_at = Some(chrono::Utc::now().to_rfc3339());
                    }
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

/// SSE relay for a specific managed relay (records per-relay stats).
async fn relay_sse_stream_for_relay(
    channel_url: &str,
    relay_id: &str,
    pool: &DbPool,
    app: &AppHandle,
    state: &Arc<tokio::sync::Mutex<SmeeRelayState>>,
) -> Result<(), String> {
    use crate::db::repos::communication::smee_relays as smee_relay_repo;

    let http = reqwest::Client::builder()
        .no_proxy()
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

    {
        let mut s = state.lock().await;
        let prev_events = s.relays.get(relay_id).map_or(0, |r| r.events_relayed);
        let prev_last_event = s.relays.get(relay_id).and_then(|r| r.last_event_at.clone());
        s.relays.insert(relay_id.to_string(), RelayInstanceStatus {
            connected: true,
            error: None,
            events_relayed: prev_events,
            last_event_at: prev_last_event,
        });
        emit_status(app, &s);
    }

    // Clear error on successful connect
    let _ = smee_relay_repo::set_status(pool, relay_id, "active");

    tracing::info!(relay_id = %relay_id, url = %channel_url, "Smee relay connected");

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    // Load relay config for event filtering
    let _relay_target: Option<String> = {
        let conn = pool.get().ok();
        conn.and_then(|c| {
            c.query_row(
                "SELECT target_persona_id FROM smee_relays WHERE id = ?1",
                rusqlite::params![relay_id],
                |row| row.get::<_, Option<String>>(0),
            ).ok()
        }).flatten()
    };
    let event_filter: Option<Vec<String>> = {
        let conn = pool.get().ok();
        conn.and_then(|c| {
            c.query_row(
                "SELECT event_filter FROM smee_relays WHERE id = ?1",
                rusqlite::params![relay_id],
                |row| row.get::<_, Option<String>>(0),
            ).ok()
        }).flatten().and_then(|f| serde_json::from_str(&f).ok())
    };

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&normalize_line_endings(&text));

        // Guard against unbounded buffer growth from a misbehaving endpoint
        if buffer.len() > MAX_SSE_BUFFER_BYTES {
            return Err("SSE buffer exceeded 1 MB without a complete message — disconnecting".into());
        }

        while let Some((pos, delim_len)) = find_sse_boundary(&buffer) {
            let message = buffer[..pos].to_string();
            buffer = buffer[pos + delim_len..].to_string();

            let data_lines: Vec<&str> = message
                .lines()
                .filter(|l| l.starts_with("data: ") || l.starts_with("data:"))
                .map(|l| l.strip_prefix("data: ").or_else(|| l.strip_prefix("data:")).unwrap_or(""))
                .collect();

            if data_lines.is_empty() { continue; }
            let data = data_lines.join("");
            if data.is_empty() || data == "{}" { continue; }

            let payload_json: serde_json::Value = match safe_json::from_str(&data) {
                Ok(v) => v,
                Err(_) => serde_json::json!({ "raw": data }),
            };

            let event_type = payload_json
                .get("x-github-event")
                .and_then(|v| v.as_str())
                .map(|s| format!("github_{s}"))
                .unwrap_or_else(|| "smee_webhook".to_string());

            // Apply event filter if configured
            if let Some(ref filter) = event_filter {
                if !filter.is_empty() && !filter.contains(&event_type) {
                    continue;
                }
            }

            let body = payload_json.get("body").cloned().unwrap_or(payload_json.clone());

            let input = CreatePersonaEventInput {
                event_type,
                source_type: "smee_relay".to_string(),
                project_id: None,
                source_id: Some(relay_id.to_string()),
                target_persona_id: _relay_target.clone(),
                payload: Some(body.to_string()),
                use_case_id: None,
            };

            match event_repo::publish(pool, input) {
                Ok(event) => {
                    let _ = app.emit(event_name::EVENT_BUS, event.clone());
                    let _ = smee_relay_repo::record_event(pool, relay_id);
                    let mut s = state.lock().await;
                    if let Some(r) = s.relays.get_mut(relay_id) {
                        r.events_relayed += 1;
                        r.last_event_at = Some(chrono::Utc::now().to_rfc3339());
                    }
                    emit_status(app, &s);
                }
                Err(e) => {
                    tracing::debug!(error = %e, "Smee relay: failed to publish event");
                }
            }
        }
    }

    Ok(())
}

/// Long-lived background task that manages all active Smee relay connections.
///
/// Periodically polls the smee_relays table for active relays and spawns/stops
/// SSE connections as needed.
pub async fn run_smee_relay(
    pool: DbPool,
    app: AppHandle,
    state: Arc<tokio::sync::Mutex<SmeeRelayState>>,
) {
    use crate::db::repos::communication::smee_relays as smee_relay_repo;

    tokio::time::sleep(Duration::from_secs(5)).await;

    // Track active relay tasks by relay ID
    let active_tasks: Arc<tokio::sync::Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    loop {
        // Also check legacy single-URL setting for backward compat
        let legacy_url = settings::get(&pool, SETTINGS_KEY).ok().flatten();

        // Read active relays from database
        let active_relays = smee_relay_repo::list_active_urls(&pool).unwrap_or_default();

        // Build set of relay IDs that should be connected
        let desired_ids: std::collections::HashSet<String> = active_relays.iter().map(|(id, _)| id.clone()).collect();

        let mut tasks = active_tasks.lock().await;

        // Stop tasks for relays that are no longer active
        let current_ids: Vec<String> = tasks.keys().cloned().collect();
        for id in current_ids {
            if !desired_ids.contains(&id) {
                if let Some(handle) = tasks.remove(&id) {
                    handle.abort();
                    let mut s = state.lock().await;
                    s.relays.remove(&id);
                    tracing::info!(relay_id = %id, "Stopped Smee relay task");
                }
            }
        }

        // Start tasks for new active relays
        for (relay_id, channel_url) in &active_relays {
            if tasks.contains_key(relay_id) {
                continue; // already running
            }

            let pool2 = pool.clone();
            let app2 = app.clone();
            let state2 = state.clone();
            let relay_id2 = relay_id.clone();
            let url2 = channel_url.clone();

            let handle = tokio::spawn(async move {
                let mut backoff = Duration::from_secs(1);
                let max_backoff = Duration::from_secs(30);
                loop {
                    match relay_sse_stream_for_relay(&url2, &relay_id2, &pool2, &app2, &state2).await {
                        Ok(()) => {
                            backoff = Duration::from_secs(1);
                        }
                        Err(e) => {
                            tracing::warn!(relay_id = %relay_id2, error = %e, "Smee relay error");
                            let _ = smee_relay_repo::record_error(&pool2, &relay_id2, &e);
                            let mut s = state2.lock().await;
                            if let Some(r) = s.relays.get_mut(&relay_id2) {
                                r.connected = false;
                                r.error = Some(e);
                            } else {
                                s.relays.insert(relay_id2.clone(), RelayInstanceStatus {
                                    connected: false,
                                    error: Some(e),
                                    events_relayed: 0,
                                    last_event_at: None,
                                });
                            }
                            emit_status(&app2, &s);
                        }
                    }
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(max_backoff);

                    // Check if relay is still active before reconnecting
                    if let Ok(urls) = smee_relay_repo::list_active_urls(&pool2) {
                        if !urls.iter().any(|(id, _)| id == &relay_id2) {
                            tracing::info!(relay_id = %relay_id2, "Relay no longer active, stopping task");
                            return;
                        }
                    }
                }
            });

            tasks.insert(relay_id.clone(), handle);
            tracing::info!(relay_id = %relay_id, url = %channel_url, "Started Smee relay task");
        }

        // Handle legacy single-URL mode (backward compat)
        if let Some(url) = legacy_url {
            if !url.is_empty() && url.starts_with("https://smee.io/") && !tasks.contains_key("__legacy__") {
                let pool2 = pool.clone();
                let app2 = app.clone();
                let state2 = state.clone();
                let handle = tokio::spawn(async move {
                    let mut backoff = Duration::from_secs(1);
                    let max_backoff = Duration::from_secs(30);
                    loop {
                        {
                            let mut s = state2.lock().await;
                            s.channel_url = Some(url.clone());
                            emit_status(&app2, &s);
                        }
                        match relay_sse_stream(&url, &pool2, &app2, &state2).await {
                            Ok(()) => { backoff = Duration::from_secs(1); }
                            Err(e) => {
                                let mut s = state2.lock().await;
                                if let Some(r) = s.relays.get_mut("__legacy__") {
                                    r.connected = false;
                                    r.error = Some(e);
                                }
                                emit_status(&app2, &s);
                            }
                        }
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(max_backoff);

                        // Check if legacy URL still exists
                        if let Ok(u) = settings::get(&pool2, SETTINGS_KEY) {
                            if u.is_none() || u.as_deref() == Some("") {
                                return;
                            }
                        }
                    }
                });
                tasks.insert("__legacy__".to_string(), handle);
            }
        } else if tasks.contains_key("__legacy__") {
            if let Some(handle) = tasks.remove("__legacy__") {
                handle.abort();
                let mut s = state.lock().await;
                s.relays.remove("__legacy__");
            }
        }

        // Emit aggregate status (derived from per-relay map)
        {
            let mut s = state.lock().await;
            if s.relays.is_empty() {
                s.channel_url = None;
            }
            emit_status(&app, &s);
        }

        drop(tasks);

        // Poll every 60 seconds (reduced from 10s to avoid IPC congestion)
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}
