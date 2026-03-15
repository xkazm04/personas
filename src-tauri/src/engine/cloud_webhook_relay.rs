//! Cloud webhook relay -- polls cloud trigger firings and injects them
//! into the local event bus so 3rd-party webhook POSTs to the cloud
//! orchestrator are relayed to the desktop app in near-real-time.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use crate::cloud::client::CloudClient;
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::DbPool;

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
}

impl CloudWebhookRelayState {
    pub fn new() -> Self {
        Self {
            last_seen: HashMap::new(),
            total_relayed: 0,
            last_poll_at: None,
            last_error: None,
            active_webhook_triggers: 0,
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

    let mut total_new = 0u32;
    let mut trigger_count = 0u32;

    // 2. For each webhook-enabled deployment, get webhook triggers
    for deployment in &webhook_deployments {
        let triggers = match client.list_persona_triggers(&deployment.persona_id).await {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!(
                    deployment_id = %deployment.id,
                    error = %e,
                    "Failed to list triggers for deployment"
                );
                continue;
            }
        };

        let webhook_triggers: Vec<_> = triggers
            .into_iter()
            .filter(|t| t.trigger_type == "webhook" && t.enabled)
            .collect();

        trigger_count += webhook_triggers.len() as u32;

        // 3. For each webhook trigger, fetch recent firings
        for trigger in &webhook_triggers {
            let firings = match client.list_trigger_firings(&trigger.id, Some(20)).await {
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

            // 4. Filter to firings newer than last_seen
            let mut s = state.lock().await;
            let cutoff = s.last_seen.get(&trigger.id).cloned();

            for firing in &firings {
                let fired_at = match &firing.fired_at {
                    Some(t) => t.clone(),
                    None => continue,
                };

                // Skip firings we've already processed
                if let Some(ref cutoff_ts) = cutoff {
                    if fired_at <= *cutoff_ts {
                        continue;
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

                match event_repo::publish(pool, input) {
                    Ok(event) => {
                        if let Err(e) = app.emit("event-bus", event.clone()) {
                            tracing::warn!(
                                event_id = %event.id,
                                error = %e,
                                "Failed to emit relayed webhook event"
                            );
                        }
                        total_new += 1;
                        s.total_relayed += 1;
                    }
                    Err(e) => {
                        tracing::debug!(
                            firing_id = %firing.id,
                            error = %e,
                            "Failed to publish relayed webhook event"
                        );
                    }
                }

                // Update last_seen watermark
                s.last_seen.insert(trigger.id.clone(), fired_at);
            }
        }
    }

    // Update state and emit status
    let mut s = state.lock().await;
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

fn emit_status(app: &AppHandle, state: &CloudWebhookRelayState, connected: bool) {
    let status = CloudWebhookRelayStatus {
        connected,
        last_poll_at: state.last_poll_at.clone(),
        active_webhook_triggers: state.active_webhook_triggers,
        total_relayed: state.total_relayed,
        error: state.last_error.clone(),
    };
    let _ = app.emit("cloud-webhook-relay-status", status);
}
