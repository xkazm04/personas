//! Smee.io webhook relay — connects to a smee.io channel via SSE and relays
//! received webhook payloads into the local event bus.
//!
//! Smee.io is a free webhook delivery service by GitHub that provides a stable
//! public URL. 3rd-party apps POST webhooks to the Smee URL, and this module
//! receives them in real-time via Server-Sent Events.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use super::event_registry::{emit_event_bus, event_name};
use super::safe_json;
use super::url_safety;
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::DbPool;

/// Maximum SSE buffer size (1 MB). If the buffer exceeds this without producing
/// a complete SSE message, the connection is dropped to prevent memory exhaustion.
const MAX_SSE_BUFFER_BYTES: usize = 1_024 * 1_024;

/// Minimum time a connection must be alive before we consider it "stable" and
/// reset the backoff when it ends. Prevents reconnect storms when the server
/// accepts TCP then immediately closes (e.g., rate limiting). The reset keys on
/// lifetime, not on how the connection ended: a reaped idle stream ends the
/// body cleanly, a laptop resuming from sleep ends it with a read error, and
/// both count as stable once they lived past this threshold.
const MIN_STABLE_CONNECTION_SECS: u64 = 30;

/// First and largest reconnect delay. Read together with
/// `MIN_STABLE_CONNECTION_SECS`: a close before the stable threshold keeps the
/// current rung, so an origin that accepts and immediately closes is retried
/// at most every `RECONNECT_BACKOFF_MAX`, never at `RECONNECT_BACKOFF_BASE`.
const RECONNECT_BACKOFF_BASE: Duration = Duration::from_secs(1);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(30);

/// Backoff rung to sleep before the next reconnect, given the rung in force and
/// how long the connection that just ended lived. A stable connection resets
/// the ladder whatever its close looked like (clean end of body or read
/// error); a short-lived one keeps the rung whatever its close looked like.
fn backoff_after_close(current: Duration, lived: Duration) -> Duration {
    if lived.as_secs() >= MIN_STABLE_CONNECTION_SECS {
        RECONNECT_BACKOFF_BASE
    } else {
        current
    }
}

/// Optional shared secret for authenticating inbound smee payloads.
///
/// SECURITY: smee.io provides NO authenticity guarantee — the channel URL is an
/// unauthenticated bearer credential, and `allowed_repos` matches an
/// attacker-controllable JSON field (routing only, not authentication). When an
/// operator sets `PERSONAS_SMEE_WEBHOOK_SECRET` to the same secret configured on
/// the GitHub webhook, the relay verifies GitHub's forwarded
/// `x-hub-signature-256` and fails closed on a missing/invalid signature. This
/// is OPT-IN: when unset (the default) we cannot authenticate inbound events and
/// accept them as before, so existing relays are not broken.
///
/// Read once per relay task (env-var pattern, mirrors `webhook::webhook_port`);
/// changing it requires a relay restart. A per-relay, stored, *required* secret
/// (DB column + UI) is a deferred config decision — see harness notes.
fn smee_webhook_secret() -> Option<String> {
    std::env::var("PERSONAS_SMEE_WEBHOOK_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// Notification channel (replaces 60s polling)
// ---------------------------------------------------------------------------

/// Notifier that Tauri commands use to wake the relay manager immediately
/// after a relay is created, updated, or deleted. Backed by `tokio::sync::Notify`
/// so the handle can be cheaply cloned and shared without ownership issues.
#[derive(Clone)]
pub struct SmeeRelayNotifier {
    inner: Arc<tokio::sync::Notify>,
}

impl SmeeRelayNotifier {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Signal the relay manager to re-sync.
    pub fn notify(&self) {
        self.inner.notify_one();
    }

    /// Wait for a notification (used by the relay manager loop).
    pub async fn notified(&self) {
        self.inner.notified().await;
    }
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
    /// Per-relay status keyed by relay ID.
    relays: HashMap<String, RelayInstanceStatus>,
    /// Last emitted aggregate status snapshot (for change detection).
    last_emitted: Option<(bool, u64, Option<String>, Option<String>)>,
}

impl SmeeRelayState {
    pub fn new() -> Self {
        Self {
            relays: HashMap::new(),
            last_emitted: None,
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
    pub connected: bool,
    pub events_relayed: u64,
    pub last_event_at: Option<String>,
    pub error: Option<String>,
}

struct ActiveRelayTask {
    handle: tokio::task::JoinHandle<()>,
    cancel: CancellationToken,
    config_key: String,
}

fn relay_config_key(
    channel_url: &str,
    target_persona_id: Option<&str>,
    event_filter: Option<&str>,
    allowed_repos: Option<&str>,
) -> String {
    serde_json::json!({
        "channel_url": channel_url,
        "target_persona_id": target_persona_id,
        "event_filter": event_filter,
        "allowed_repos": allowed_repos,
    })
    .to_string()
}

fn emit_status(app: &AppHandle, state: &mut SmeeRelayState) {
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
        state.relays.values().filter_map(|r| r.error.clone()).last()
    };

    // Change detection: skip emit when nothing changed.
    let snapshot = (
        any_connected,
        total_events,
        latest_event.clone(),
        aggregate_error.clone(),
    );
    if state.last_emitted.as_ref() == Some(&snapshot) {
        return;
    }
    state.last_emitted = Some(snapshot);

    let status = SmeeRelayStatus {
        connected: any_connected,
        events_relayed: total_events,
        last_event_at: latest_event,
        error: aggregate_error,
    };
    let _ = app.emit(event_name::SMEE_RELAY_STATUS, status);
}

// ---------------------------------------------------------------------------
// SSE relay core
// ---------------------------------------------------------------------------

/// Parameters for a managed relay connection.
struct RelayParams {
    relay_key: String,
    channel_url: String,
    source_id: Option<String>,
    target_persona_id: Option<String>,
    event_filter: Option<Vec<String>>,
    /// Routing filter (NOT a security control). When `Some`, only events whose
    /// `body.repository.full_name` matches an entry are relayed. That field is
    /// part of the attacker-controllable smee body, so an attacker who can POST
    /// to the channel can forge it — this list only keeps unrelated/mis-routed
    /// repos off this relay's persona; it does NOT authenticate the sender.
    /// `None` accepts any origin (back-compat).
    allowed_repos: Option<Vec<String>>,
    /// Optional shared secret (from `PERSONAS_SMEE_WEBHOOK_SECRET`) used to
    /// verify GitHub's forwarded `x-hub-signature-256`. When `Some`, the relay
    /// fails closed on a missing/invalid signature. `None` (default) means
    /// inbound events cannot be authenticated and are accepted as before.
    webhook_secret: Option<String>,
}

/// Cross-reconnect de-duplication for a smee relay. smee.io replays the
/// channel's recent event history on every new SSE connection, so without this
/// each transient disconnect (laptop sleep, Wi-Fi drop, smee rate-limit) would
/// re-publish already-handled webhooks and spawn duplicate persona executions
/// (bug-hunt 2026-06-07 triggers #1). Bounded FIFO, tested in personas-engine.
type RelayDedup = personas_engine::webhook_ingest::DeliveryDedup;

/// SSE relay loop: connects to a smee.io channel, streams SSE events,
/// and publishes parsed payloads to the local event bus.
async fn relay_sse_core(
    params: &RelayParams,
    pool: &DbPool,
    app: &AppHandle,
    state: &Arc<tokio::sync::Mutex<SmeeRelayState>>,
    cancel: &CancellationToken,
    dedup: &mut RelayDedup,
) -> Result<(), String> {
    use crate::db::repos::communication::smee_relays as smee_relay_repo;

    // Use SSRF-safe DNS resolver to prevent connections to internal services
    // even if a validated smee.io URL somehow resolves to a private IP (DNS rebinding).
    let http = reqwest::Client::builder()
        .no_proxy()
        .dns_resolver(std::sync::Arc::new(url_safety::SsrfSafeDnsResolver))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let mut req = http
        .get(&params.channel_url)
        .header("Accept", "text/event-stream");
    // Resume after the last event we processed so the server need not replay.
    if let Some(ref last_id) = dedup.last_event_id {
        req = req.header("Last-Event-ID", last_id.as_str());
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    // Mark connected (preserve previous event counts across reconnects)
    {
        let mut s = state.lock().await;
        let prev_events = s
            .relays
            .get(&params.relay_key)
            .map_or(0, |r| r.events_relayed);
        let prev_last_event = s
            .relays
            .get(&params.relay_key)
            .and_then(|r| r.last_event_at.clone());
        s.relays.insert(
            params.relay_key.clone(),
            RelayInstanceStatus {
                connected: true,
                error: None,
                events_relayed: prev_events,
                last_event_at: prev_last_event,
            },
        );
        emit_status(app, &mut s);
    }

    let _ = smee_relay_repo::set_status_quiet(pool, &params.relay_key, "active");

    tracing::info!(relay_key = %params.relay_key, url = %params.channel_url, "Smee relay connected");

    // Stream SSE
    let mut stream = resp.bytes_stream();
    // Decodes BYTES: a chunk may end inside a multi-byte character or between
    // the \r and \n of one terminator, which per-chunk text decoding corrupted.
    let mut decoder = personas_engine::webhook_ingest::SseDecoder::new();

    loop {
        let chunk = tokio::select! {
            _ = cancel.cancelled() => {
                tracing::info!(relay_key = %params.relay_key, "Smee relay cancellation requested");
                return Ok(());
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        let messages = decoder.push(&chunk);

        // Guard against unbounded buffer growth from a misbehaving endpoint
        if decoder.pending_bytes() > MAX_SSE_BUFFER_BYTES {
            return Err(
                "SSE buffer exceeded 1 MB without a complete message — disconnecting".into(),
            );
        }

        // Process complete SSE messages
        for message in messages {
            let Some(data) = message.data else {
                continue;
            };

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

            // Apply event filter if configured
            if let Some(ref filter) = params.event_filter {
                if !filter.is_empty() && !filter.contains(&event_type) {
                    continue;
                }
            }

            let body = payload_json
                .get("body")
                .cloned()
                .unwrap_or(payload_json.clone());

            // --- Authenticity gate (opt-in HMAC) ---
            // SECURITY: smee.io provides NO authenticity guarantee. Anyone who
            // learns the channel URL can POST arbitrary payloads, so the channel
            // URL is effectively an UNAUTHENTICATED BEARER CREDENTIAL. When an
            // operator configures `PERSONAS_SMEE_WEBHOOK_SECRET` (matching the
            // GitHub webhook secret), verify GitHub's forwarded
            // `x-hub-signature-256` over the body and FAIL CLOSED on a
            // missing/invalid signature. Reuses the constant-time verifier from
            // `engine::webhook` rather than re-implementing crypto.
            //
            // Caveat: smee re-serializes the JSON body, so the bytes we hash may
            // not be byte-identical to what GitHub signed; operators enabling
            // verification should expect strict matching. Reliable, *mandatory*
            // per-relay verification (raw-body forwarding + a stored per-relay
            // secret) is deferred — see harness notes.
            if let Some(ref secret) = params.webhook_secret {
                let signature = payload_json
                    .get("x-hub-signature-256")
                    .or_else(|| payload_json.get("X-Hub-Signature-256"))
                    .and_then(|v| v.as_str());
                let body_bytes = serde_json::to_vec(&body).unwrap_or_default();
                let verified = match signature {
                    Some(sig) => super::webhook::verify_hmac_sha256(secret, &body_bytes, sig),
                    None => false,
                };
                if !verified {
                    tracing::warn!(
                        relay_id = %params.relay_key,
                        event_type = %event_type,
                        had_signature = signature.is_some(),
                        "Smee relay: rejected event — HMAC verification failed \
                         (secret configured but signature missing or invalid). Dropping."
                    );
                    continue;
                }
            }

            // Routing filter (NOT a security control). Drops events whose
            // body.repository.full_name is not in the configured list. That
            // field comes from the attacker-controllable smee body, so anyone
            // who can POST to the channel can forge it — `allowed_repos` only
            // keeps unrelated/mis-routed repos off this relay's persona; it does
            // NOT authenticate the sender. Sender authenticity is the job of the
            // opt-in HMAC gate above.
            if let Some(ref allow) = params.allowed_repos {
                let repo_full_name = body
                    .get("repository")
                    .and_then(|r| r.get("full_name"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let accepted = match &repo_full_name {
                    Some(name) => allow.iter().any(|allowed| allowed == name),
                    None => false,
                };
                if !accepted {
                    tracing::warn!(
                        relay_id = %params.relay_key,
                        event_type = %event_type,
                        repo = ?repo_full_name,
                        "Smee relay: dropped event whose repository.full_name is not in allowed_repos"
                    );
                    continue;
                }
            }

            // Deduplicate replayed events. smee.io replays recent history on
            // every reconnect, so derive a stable per-delivery key (SSE id >
            // x-github-delivery header > content hash) and skip anything already
            // published this process (bug-hunt 2026-06-07 triggers #1).
            let sse_id = message.id;
            if let Some(ref id) = sse_id {
                dedup.last_event_id = Some(id.clone());
            }
            let dedup_key = sse_id
                .or_else(|| {
                    payload_json
                        .get("x-github-delivery")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| {
                    use std::hash::{Hash, Hasher};
                    let mut h = std::collections::hash_map::DefaultHasher::new();
                    data.hash(&mut h);
                    format!("h:{:x}", h.finish())
                });
            if !dedup.check_and_insert(dedup_key.clone()) {
                tracing::debug!(
                    relay_key = %params.relay_key,
                    "Smee relay: skipping duplicate (replayed) event"
                );
                continue;
            }

            let input = CreatePersonaEventInput {
                event_type,
                source_type: "smee_relay".to_string(),
                project_id: None,
                source_id: params.source_id.clone(),
                target_persona_id: params.target_persona_id.clone(),
                payload: Some(body.to_string()),
                use_case_id: None,
            };

            // Rate-limit smee/webhook origins on the BUS, not just the IPC
            // command. smee.io has no authenticity guarantee — a leaked channel
            // URL lets anyone flood events. publish_event (the IPC path) is
            // throttled per source, but this internal relay — the highest-volume,
            // attacker-reachable producer — had no cap. Drop over-limit events.
            {
                use tauri::Manager;
                let app_state = app.state::<std::sync::Arc<crate::AppState>>();
                let event_source_max = app_state
                    .tier_config
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .event_source_max;
                let rate_key = format!("event:smee_relay:{}", params.relay_key);
                if app_state
                    .rate_limiter
                    .check(
                        &rate_key,
                        event_source_max,
                        crate::engine::rate_limiter::EVENT_SOURCE_WINDOW,
                    )
                    .is_err()
                {
                    tracing::warn!(
                        relay_key = %params.relay_key,
                        "Smee relay: event-source rate limit exceeded — dropping event"
                    );
                    continue;
                }
            }

            match event_repo::publish(pool, input) {
                Ok(event) => {
                    emit_event_bus(app, &event);
                    let _ = smee_relay_repo::record_event(pool, &params.relay_key);
                    let mut s = state.lock().await;
                    if let Some(r) = s.relays.get_mut(&params.relay_key) {
                        r.events_relayed += 1;
                        r.last_event_at = Some(chrono::Utc::now().to_rfc3339());
                    }
                    emit_status(app, &mut s);
                    tracing::debug!(event_id = %event.id, "Smee relay: published event");
                }
                Err(e) => {
                    // The delivery did not land: un-record it so smee's replay
                    // on the next reconnect is handled instead of skipped as a
                    // duplicate.
                    dedup.forget(&dedup_key);
                    tracing::warn!(
                        relay_key = %params.relay_key,
                        error = %e,
                        "Smee relay: failed to publish event; it will be accepted again if replayed"
                    );
                }
            }
        }
    }

    Ok(())
}

fn cancel_relay_task(relay_id: String, task: ActiveRelayTask) {
    task.cancel.cancel();
    let handle = task.handle;
    tokio::spawn(async move {
        let abort_started = Instant::now();
        tokio::time::sleep(Duration::from_secs(2)).await;
        if !handle.is_finished() {
            tracing::warn!(
                relay_id = %relay_id,
                elapsed_ms = abort_started.elapsed().as_millis() as u64,
                "Smee relay task still running after cancellation grace period"
            );
            handle.abort();
        }

        if let Err(error) = handle.await {
            if !error.is_cancelled() {
                tracing::warn!(relay_id = %relay_id, error = ?error, "Smee relay task ended with JoinError");
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Background task
// ---------------------------------------------------------------------------

/// Long-lived background task that manages all active Smee relay connections.
///
/// Wakes immediately when a command notifies via the notifier, and also performs
/// a periodic safety-net sync every 5 minutes in case a notification is missed.
pub async fn run_smee_relay(
    pool: DbPool,
    app: AppHandle,
    state: Arc<tokio::sync::Mutex<SmeeRelayState>>,
    notifier: SmeeRelayNotifier,
) {
    use crate::db::repos::communication::smee_relays as smee_relay_repo;

    tokio::time::sleep(Duration::from_secs(5)).await;

    // Track active relay tasks by relay ID
    let active_tasks: Arc<tokio::sync::Mutex<HashMap<String, ActiveRelayTask>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    loop {
        // ---- Sync relay tasks with database state ----
        let active_relays = smee_relay_repo::list_active_configs(&pool).unwrap_or_default();

        let desired_configs: HashMap<String, String> = active_relays
            .iter()
            .map(
                |(id, channel_url, target_persona_id, event_filter, allowed_repos)| {
                    (
                        id.clone(),
                        relay_config_key(
                            channel_url,
                            target_persona_id.as_deref(),
                            event_filter.as_deref(),
                            allowed_repos.as_deref(),
                        ),
                    )
                },
            )
            .collect();

        let mut tasks = active_tasks.lock().await;

        // Stop tasks for relays that are no longer active or whose routing
        // config changed while the SSE connection was alive.
        let current_ids: Vec<String> = tasks.keys().cloned().collect();
        for id in current_ids {
            let should_stop = tasks.get(&id).is_some_and(|task| {
                desired_configs
                    .get(&id)
                    .map(|desired| desired != &task.config_key)
                    .unwrap_or(true)
            });
            if should_stop {
                if let Some(task) = tasks.remove(&id) {
                    cancel_relay_task(id.clone(), task);
                    let mut s = state.lock().await;
                    s.relays.remove(&id);
                    tracing::info!(relay_id = %id, "Stopped Smee relay task for config sync");
                }
            }
        }

        // Start tasks for new active relays
        for (relay_id, channel_url, target_persona_id, event_filter, allowed_repos) in
            &active_relays
        {
            if tasks.contains_key(relay_id) {
                continue; // already running
            }

            let config_key = relay_config_key(
                channel_url,
                target_persona_id.as_deref(),
                event_filter.as_deref(),
                allowed_repos.as_deref(),
            );
            let pool2 = pool.clone();
            let app2 = app.clone();
            let state2 = state.clone();
            let relay_id2 = relay_id.clone();
            let url2 = channel_url.clone();
            let target_persona_id2 = target_persona_id.clone();
            // Parse the stored routing config. CRITICAL: a present-but-malformed
            // filter/allowlist must FAIL CLOSED. Collapsing invalid JSON to `None`
            // (the old `.ok()`) turned a restrictive relay into allow-all — a
            // relay scoped to `["deploy_complete"]` would then fire on every
            // webhook from every repo, an unbounded fan-out / execution storm.
            // A *missing* column (None raw) legitimately means "no filter
            // configured" and stays permissive; only invalid JSON disables the
            // relay (record the error so it surfaces in the UI, then skip).
            let event_filter2: Option<Vec<String>> = match event_filter.as_deref() {
                None => None,
                Some(raw) => match serde_json::from_str::<Vec<String>>(raw) {
                    Ok(list) => Some(list),
                    Err(e) => {
                        tracing::warn!(
                            relay_id = %relay_id,
                            error = %e,
                            "Smee relay event_filter is not valid JSON; refusing to start the relay (fail-closed) rather than fanning out to every event. Fix or clear the filter."
                        );
                        let _ = smee_relay_repo::record_error(
                            &pool,
                            relay_id,
                            "event_filter is not valid JSON (relay disabled — fix or clear the filter)",
                        );
                        continue;
                    }
                },
            };
            let allowed_repos2: Option<Vec<String>> = match allowed_repos.as_deref() {
                None => None,
                Some(raw) => match serde_json::from_str::<Vec<String>>(raw) {
                    // An explicitly empty allowlist (`[]`) is valid JSON meaning
                    // "no origin restriction" — preserve the prior permissive
                    // (warn-only) behavior for that case.
                    Ok(list) => Some(list).filter(|l| !l.is_empty()),
                    Err(e) => {
                        tracing::warn!(
                            relay_id = %relay_id,
                            error = %e,
                            "Smee relay allowed_repos is not valid JSON; refusing to start the relay (fail-closed) rather than accepting events from any repo. Fix or clear the allowlist."
                        );
                        let _ = smee_relay_repo::record_error(
                            &pool,
                            relay_id,
                            "allowed_repos is not valid JSON (relay disabled — fix or clear the allowlist)",
                        );
                        continue;
                    }
                },
            };
            // Read the optional authenticity secret once per relay task.
            let webhook_secret2 = smee_webhook_secret();
            let cancel = CancellationToken::new();
            let cancel_for_task = cancel.clone();

            let handle = tokio::spawn(async move {
                if webhook_secret2.is_none() {
                    // Posture: be explicit that inbound events are unauthenticated.
                    // The previous warning implied `allowed_repos` restricted
                    // origins; it does not — that field is forgeable.
                    tracing::warn!(
                        relay_id = %relay_id2,
                        "Smee relay: inbound events are NOT authenticated — the channel URL is an \
                         unauthenticated bearer credential and allowed_repos is a routing filter \
                         (forgeable), not a security control. Anyone who learns the URL can inject \
                         events that spawn persona executions. Set PERSONAS_SMEE_WEBHOOK_SECRET to \
                         the GitHub webhook secret to enable HMAC verification (fail-closed)."
                    );
                }
                let mut backoff = RECONNECT_BACKOFF_BASE;
                // Persists across reconnects so a smee history replay on the
                // fresh connection isn't re-published (bug-hunt 2026-06-07
                // triggers #1).
                let mut dedup = RelayDedup::default();
                loop {
                    if cancel_for_task.is_cancelled() {
                        tracing::info!(relay_id = %relay_id2, "Smee relay task stopped by cancellation");
                        return;
                    }
                    let params = RelayParams {
                        relay_key: relay_id2.clone(),
                        channel_url: url2.clone(),
                        source_id: Some(relay_id2.clone()),
                        target_persona_id: target_persona_id2.clone(),
                        event_filter: event_filter2.clone(),
                        allowed_repos: allowed_repos2.clone(),
                        webhook_secret: webhook_secret2.clone(),
                    };
                    let connected_at = Instant::now();
                    let outcome = relay_sse_core(
                        &params,
                        &pool2,
                        &app2,
                        &state2,
                        &cancel_for_task,
                        &mut dedup,
                    )
                    .await;
                    // Measured once, before the arms: the reset below keys on
                    // lifetime, not on which arm we land in.
                    let lived = connected_at.elapsed();
                    match outcome {
                        Ok(()) => {
                            if cancel_for_task.is_cancelled() {
                                tracing::info!(relay_id = %relay_id2, "Smee relay disconnected for cancellation");
                                return;
                            }
                        }
                        Err(e) => {
                            tracing::warn!(relay_id = %relay_id2, error = %e, "Smee relay error");
                            let _ = smee_relay_repo::record_error(&pool2, &relay_id2, &e);
                            let mut s = state2.lock().await;
                            if let Some(r) = s.relays.get_mut(&relay_id2) {
                                r.connected = false;
                                r.error = Some(e);
                            } else {
                                s.relays.insert(
                                    relay_id2.clone(),
                                    RelayInstanceStatus {
                                        connected: false,
                                        error: Some(e),
                                        events_relayed: 0,
                                        last_event_at: None,
                                    },
                                );
                            }
                            emit_status(&app2, &mut s);
                        }
                    }
                    backoff = backoff_after_close(backoff, lived);
                    tokio::select! {
                        _ = cancel_for_task.cancelled() => {
                            tracing::info!(relay_id = %relay_id2, "Smee relay backoff interrupted by cancellation");
                            return;
                        }
                        _ = tokio::time::sleep(backoff) => {}
                    }
                    backoff = (backoff * 2).min(RECONNECT_BACKOFF_MAX);

                    // Check if relay is still active before reconnecting
                    if let Ok(urls) = smee_relay_repo::list_active_urls(&pool2) {
                        if !urls.iter().any(|(id, _)| id == &relay_id2) {
                            tracing::info!(relay_id = %relay_id2, "Relay no longer active, stopping task");
                            return;
                        }
                    }
                }
            });

            tasks.insert(
                relay_id.clone(),
                ActiveRelayTask {
                    handle,
                    cancel,
                    config_key,
                },
            );
            tracing::info!(relay_id = %relay_id, url = %channel_url, "Started Smee relay task");
        }

        // Emit aggregate status (change detection skips if unchanged)
        {
            let mut s = state.lock().await;
            emit_status(&app, &mut s);
        }

        drop(tasks);

        // Wait for either a command notification or a 5-minute safety-net timeout.
        // The safety net catches edge cases where a notification was missed.
        tokio::select! {
            _ = notifier.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(300)) => {}
        }
    }
}

#[cfg(test)]
mod reconnect_backoff_tests {
    //! A/B over the reconnect ladder. Policy A is the rule this loop carried
    //! until 2026-09-05, transcribed verbatim: reset only in the `Ok` arm, i.e.
    //! only after a clean end of body. Policy B is `backoff_after_close`. Each
    //! case is a recorded shape from this relay's own history
    //! (docs/harness/bug-hunt-2026-06-07/triggers-and-event-automations.md #1,
    //! which names laptop sleep, Wi-Fi drop and smee rate-limit closes), and
    //! the instrument is the sequence of sleeps the loop would take.
    use super::*;

    /// One iteration of the relay loop, as recorded: did `relay_sse_core`
    /// return `Ok` (clean end of body) or `Err`, and how long did it live.
    type Close = (bool, u64);

    fn policy_a(current: Duration, clean: bool, lived: Duration) -> Duration {
        if clean && lived.as_secs() >= MIN_STABLE_CONNECTION_SECS {
            RECONNECT_BACKOFF_BASE
        } else {
            current
        }
    }

    fn policy_b(current: Duration, _clean: bool, lived: Duration) -> Duration {
        backoff_after_close(current, lived)
    }

    /// Replays the loop's ladder (reset, sleep, double-with-cap) and returns
    /// the sleep taken after each close, in seconds.
    fn replay(policy: fn(Duration, bool, Duration) -> Duration, closes: &[Close]) -> Vec<u64> {
        let mut backoff = RECONNECT_BACKOFF_BASE;
        let mut sleeps = Vec::new();
        for &(clean, lived_secs) in closes {
            backoff = policy(backoff, clean, Duration::from_secs(lived_secs));
            sleeps.push(backoff.as_secs());
            backoff = (backoff * 2).min(RECONNECT_BACKOFF_MAX);
        }
        sleeps
    }

    /// smee rate-limits: accepts the handshake, then closes within seconds.
    /// Both policies hold the rung; the ladder climbs to the cap instead of
    /// hammering at one second. A "reset on open" client would sleep 1s here
    /// forever - that is the storm MIN_STABLE_CONNECTION_SECS was added for.
    #[test]
    fn rate_limit_accept_then_close_keeps_the_rung_under_both_policies() {
        let closes = [
            (true, 2),
            (true, 1),
            (true, 3),
            (true, 2),
            (true, 1),
            (true, 2),
        ];
        let expected = vec![1, 2, 4, 8, 16, 30];
        assert_eq!(replay(policy_a, &closes), expected);
        assert_eq!(replay(policy_b, &closes), expected);
    }

    /// The reaped idle stream: after minutes of silence an intermediary ends
    /// the body cleanly. The hand-rolled reader reconnects (the loop never
    /// exits on `Ok`) and, the connection having been stable, starts the
    /// ladder over. Both policies agree.
    #[test]
    fn stable_then_clean_close_resets_under_both_policies() {
        let closes = [(false, 0), (false, 0), (true, 600)];
        assert_eq!(replay(policy_a, &closes), vec![1, 2, 1]);
        assert_eq!(replay(policy_b, &closes), vec![1, 2, 1]);
    }

    /// Laptop resumes from sleep: five handshakes fail while the network is
    /// still down (the ladder reaches the cap), the sixth connects and lives
    /// ten hours, then Wi-Fi drops and the read errors. Policy A never resets
    /// on an `Err`, so the relay waits the full cap before its first retry;
    /// policy B reads the lifetime and retries at the base.
    #[test]
    fn stable_then_read_error_resets_only_under_policy_b() {
        let closes = [
            (false, 0),
            (false, 0),
            (false, 0),
            (false, 0),
            (false, 0),
            (false, 36_000),
        ];
        assert_eq!(replay(policy_a, &closes), vec![1, 2, 4, 8, 16, 30]);
        assert_eq!(replay(policy_b, &closes), vec![1, 2, 4, 8, 16, 1]);
    }

    /// A non-2xx handshake (channel deleted, `HTTP 404`) lives zero seconds and
    /// must never reset, or a permanently gone channel is retried at the base
    /// forever. Both policies climb; neither has an attempt limit, which is
    /// the deviation the registry application records.
    #[test]
    fn failed_handshake_never_resets() {
        let closes = [(false, 0); 7];
        assert_eq!(replay(policy_b, &closes), vec![1, 2, 4, 8, 16, 30, 30]);
        assert_eq!(replay(policy_a, &closes), replay(policy_b, &closes));
    }
}
