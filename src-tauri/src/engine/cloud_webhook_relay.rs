//! Cloud webhook relay -- polls cloud trigger firings and injects them
//! into the local event bus so 3rd-party webhook POSTs to the cloud
//! orchestrator are relayed to the desktop app in near-real-time.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use futures_util::future::join_all;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::time::Duration;
use ts_rs::TS;

use super::event_registry::{emit_event_bus, event_name};
use chrono::DateTime;
use rusqlite::params;

use crate::cloud::client::{CloudClient, CloudTrigger};
use crate::db::models::{CreatePersonaEventInput, PersonaEvent};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::cloud_webhook_watermarks as watermark_repo;
use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Tracks the last-seen firing timestamp per cloud trigger to avoid
/// re-processing firings across poll cycles.
pub struct CloudWebhookRelayState {
    /// trigger_id -> ISO timestamp of last processed firing
    last_seen: HashMap<String, String>,
    pub total_relayed: u64,
    pub last_poll_at: Option<String>,
    pub last_error: Option<String>,
    pub active_webhook_triggers: u32,
    tick_lock: Arc<tokio::sync::Mutex<()>>,
}

impl CloudWebhookRelayState {
    pub fn new() -> Self {
        Self {
            last_seen: HashMap::new(),
            total_relayed: 0,
            last_poll_at: None,
            last_error: None,
            active_webhook_triggers: 0,
            tick_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// Create state pre-populated with persisted watermarks from the database.
    pub fn load_from_db(pool: &DbPool) -> Self {
        let last_seen = watermark_repo::load_all(pool).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "Failed to load cloud webhook watermarks from DB, starting fresh");
            HashMap::new()
        });
        if !last_seen.is_empty() {
            tracing::info!(count = last_seen.len(), "Loaded cloud webhook watermarks from DB");
        }
        Self {
            last_seen,
            total_relayed: 0,
            last_poll_at: None,
            last_error: None,
            active_webhook_triggers: 0,
            tick_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
}

// ---------------------------------------------------------------------------
// Status (emitted as Tauri event for frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudWebhookRelayStatus {
    pub connected: bool,
    pub last_poll_at: Option<String>,
    pub active_webhook_triggers: u32,
    pub total_relayed: u64,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/// One poll cycle of the cloud webhook relay.
///
/// 1. Fetches all webhook-enabled cloud deployments
/// 2. For each, lists webhook triggers
/// 3. For each trigger, fetches recent firings
/// 4. Publishes new firings as local PersonaEvents
pub async fn cloud_webhook_relay_tick(
    client: &Arc<CloudClient>,
    pool: &DbPool,
    app: &AppHandle,
    state: &tokio::sync::Mutex<CloudWebhookRelayState>,
) {
    let tick_lock = {
        let st = state.lock().await;
        Arc::clone(&st.tick_lock)
    };
    let _tick_guard = match tick_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            tracing::debug!("CloudWebhookRelay: tick already in progress, skipping");
            return;
        }
    };

    let now = chrono::Utc::now().to_rfc3339();

    // 1. List deployments with webhooks enabled
    let deployments = match client.list_deployments().await {
        Ok(deps) => deps,
        Err(e) => {
            let mut s = state.lock().await;
            s.last_poll_at = Some(now.clone());
            s.last_error = Some(format!("Failed to list deployments: {e}"));
            emit_status(app, &s, true);
            return;
        }
    };

    let webhook_deployments: Vec<_> = deployments
        .into_iter()
        .filter(|d| d.webhook_enabled && d.status == "active")
        .collect();

    // 2. Parallel round 1: fetch triggers for ALL deployments concurrently
    let trigger_futs: Vec<_> = webhook_deployments.iter().enumerate().map(|(i, dep)| {
        let client = Arc::clone(client);
        let persona_id = dep.persona_id.clone();
        async move {
            let result = client.list_persona_triggers(&persona_id).await;
            (i, result)
        }
    }).collect();
    let trigger_results = match tokio::time::timeout(
        Duration::from_secs(30),
        join_all(trigger_futs),
    ).await {
        Ok(results) => results,
        Err(_) => {
            let mut s = state.lock().await;
            s.last_poll_at = Some(now.clone());
            s.last_error = Some("Timed out fetching cloud triggers (30s)".into());
            emit_status(app, &s, true);
            return;
        }
    };

    // Collect webhook triggers with their parent deployment index
    let mut webhook_triggers_with_deployment: Vec<(usize, CloudTrigger)> = Vec::new();
    let mut active_trigger_ids = HashSet::new();

    for (dep_idx, result) in &trigger_results {
        let deployment = &webhook_deployments[*dep_idx];
        match result {
            Ok(triggers) => {
                for trigger in triggers {
                    if trigger.trigger_type == "webhook" && trigger.enabled {
                        active_trigger_ids.insert(trigger.id.clone());
                        webhook_triggers_with_deployment.push((*dep_idx, trigger.clone()));
                    }
                }
            }
            Err(e) => {
                tracing::debug!(
                    deployment_id = %deployment.id,
                    error = %e,
                    "Failed to list triggers for deployment"
                );
            }
        }
    }

    let trigger_count = webhook_triggers_with_deployment.len() as u32;

    // 3. Parallel round 2: fetch firings for ALL triggers concurrently
    let firing_futs: Vec<_> = webhook_triggers_with_deployment.iter().enumerate().map(|(i, (dep_idx, trigger))| {
        let client = Arc::clone(client);
        let trigger_id = trigger.id.clone();
        let dep_idx = *dep_idx;
        async move {
            let result = client.list_trigger_firings(&trigger_id, Some(20)).await;
            (i, dep_idx, result)
        }
    }).collect();
    let firing_results = match tokio::time::timeout(
        Duration::from_secs(30),
        join_all(firing_futs),
    ).await {
        Ok(results) => results,
        Err(_) => {
            let mut s = state.lock().await;
            s.last_poll_at = Some(now.clone());
            s.last_error = Some("Timed out fetching trigger firings (30s)".into());
            emit_status(app, &s, true);
            return;
        }
    };

    // 4. Process firings sequentially (DB writes + state updates)
    let mut total_new = 0u32;
    let mut s = state.lock().await;

    // Track the highest fired_at per trigger so the watermark always
    // advances to the newest timestamp regardless of API sort order.
    let mut max_fired_at: HashMap<String, String> = HashMap::new();

    for (trigger_idx, dep_idx, result) in &firing_results {
        let deployment = &webhook_deployments[*dep_idx];
        let (_, trigger) = &webhook_triggers_with_deployment[*trigger_idx];
        let firings = match result {
            Ok(f) => f,
            Err(e) => {
                tracing::debug!(
                    trigger_id = %trigger.id,
                    error = %e,
                    "Failed to list firings for trigger"
                );
                continue;
            }
        };

        let cutoff = s.last_seen.get(&trigger.id).cloned();

        for firing in firings {
            let fired_at: String = match &firing.fired_at {
                Some(t) => t.clone(),
                None => continue,
            };

            // Skip firings we've already processed (parse to DateTime
            // so different ISO 8601 representations compare correctly)
            if let Some(ref cutoff_ts) = cutoff {
                match (
                    DateTime::parse_from_rfc3339(&fired_at),
                    DateTime::parse_from_rfc3339(cutoff_ts),
                ) {
                    (Ok(f), Ok(c)) if f <= c => continue,
                    (Err(_), _) | (_, Err(_)) => {
                        // Unparseable timestamp — fall back to string comparison
                        if fired_at <= *cutoff_ts {
                            continue;
                        }
                    }
                    _ => {} // fired_at > cutoff — process it
                }
            }

            // Publish as local PersonaEvent
            let payload = serde_json::json!({
                "cloud_trigger_id": trigger.id,
                "cloud_firing_id": firing.id,
                "cloud_deployment_id": deployment.id,
                "cloud_deployment_slug": deployment.slug,
                "status": firing.status,
                "cost_usd": firing.cost_usd,
                "duration_ms": firing.duration_ms,
                "fired_at": firing.fired_at,
            });

            let input = CreatePersonaEventInput {
                event_type: "cloud_webhook".to_string(),
                source_type: "cloud_webhook".to_string(),
                project_id: None,
                source_id: Some(firing.id.clone()),
                target_persona_id: Some(trigger.persona_id.clone()),
                payload: Some(payload.to_string()),
                use_case_id: trigger.use_case_id.clone(),
            };

            // Compute the watermark to persist: the max of the current
            // fired_at and any previously committed watermark for this trigger.
            let watermark = match max_fired_at.get(&trigger.id) {
                Some(prev) => {
                    let is_newer = match (
                        DateTime::parse_from_rfc3339(&fired_at),
                        DateTime::parse_from_rfc3339(prev),
                    ) {
                        (Ok(f), Ok(p)) => f > p,
                        _ => fired_at > *prev,
                    };
                    if is_newer { fired_at.clone() } else { prev.clone() }
                }
                None => fired_at.clone(),
            };

            // Atomically publish the event AND upsert the watermark in a
            // single SQLite transaction so they cannot diverge.
            match publish_and_upsert_watermark(pool, input, &trigger.id, &watermark) {
                Ok(event) => {
                    emit_event_bus(app, &event);
                    total_new += 1;
                    s.total_relayed += 1;
                    // Update in-memory state only after the transaction commits
                    max_fired_at.insert(trigger.id.clone(), watermark.clone());
                    s.last_seen.insert(trigger.id.clone(), watermark);
                }
                Err(e) => {
                    tracing::debug!(
                        firing_id = %firing.id,
                        error = %e,
                        "Failed to publish relayed webhook event"
                    );
                }
            }
        }
    }

    // Prune last_seen entries for triggers that no longer exist, then update state
    s.last_seen.retain(|id, _| active_trigger_ids.contains(id));
    let active_ids: Vec<&str> = active_trigger_ids.iter().map(|s| s.as_str()).collect();
    if let Err(e) = watermark_repo::prune(pool, &active_ids) {
        tracing::debug!(error = %e, "Failed to prune stale webhook watermarks");
    }
    s.last_poll_at = Some(now);
    s.last_error = None;
    s.active_webhook_triggers = trigger_count;
    emit_status(app, &s, true);

    if total_new > 0 {
        tracing::info!(
            relayed = total_new,
            triggers = trigger_count,
            "Cloud webhook relay: published new events"
        );
    }
}

// ---------------------------------------------------------------------------
// Atomic publish + watermark (single SQLite transaction)
// ---------------------------------------------------------------------------

/// Publish a PersonaEvent and upsert the cloud webhook watermark atomically.
/// If either operation fails the transaction is rolled back, preventing the
/// scenario where an event is persisted but the watermark is not (which would
/// cause duplicate events after an app restart).
fn publish_and_upsert_watermark(
    pool: &DbPool,
    input: CreatePersonaEventInput,
    trigger_id: &str,
    fired_at: &str,
) -> Result<PersonaEvent, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let project_id = input.project_id.unwrap_or_else(|| "default".into());

    // Encrypt payload at rest if present
    let (stored_payload, payload_iv) = match &input.payload {
        Some(plaintext) if !plaintext.is_empty() => {
            match crypto::encrypt_for_db(plaintext) {
                Ok((ct, iv)) => (Some(ct), Some(iv)),
                Err(e) => {
                    tracing::warn!("Failed to encrypt event payload, storing plaintext: {}", e);
                    (Some(plaintext.clone()), None)
                }
            }
        }
        other => (other.clone(), None),
    };

    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    tx.execute(
        "INSERT INTO persona_events
         (id, project_id, event_type, source_type, source_id, target_persona_id, payload, payload_iv, use_case_id, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10)",
        params![
            id,
            project_id,
            input.event_type,
            input.source_type,
            input.source_id,
            input.target_persona_id,
            stored_payload,
            payload_iv,
            input.use_case_id,
            now,
        ],
    ).map_err(AppError::Database)?;

    tx.execute(
        "INSERT INTO cloud_webhook_watermarks (trigger_id, last_seen_ts, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(trigger_id) DO UPDATE SET last_seen_ts = ?2, updated_at = ?3",
        params![trigger_id, fired_at, now],
    ).map_err(AppError::Database)?;

    tx.commit().map_err(AppError::Database)?;

    // Read the event back after commit so decryption and row mapping use the
    // standard code path.
    event_repo::get_by_id(pool, &id)
}

fn emit_status(app: &AppHandle, state: &CloudWebhookRelayState, connected: bool) {
    let status = CloudWebhookRelayStatus {
        connected,
        last_poll_at: state.last_poll_at.clone(),
        active_webhook_triggers: state.active_webhook_triggers,
        total_relayed: state.total_relayed,
        error: state.last_error.clone(),
    };
    let _ = app.emit(event_name::CLOUD_WEBHOOK_RELAY_STATUS, status);
}
