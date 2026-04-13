use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::cloud::client::CloudClient;
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::{events as event_repo, shared_events as repo};
use crate::db::DbPool;
use crate::engine::event_registry::emit_event_bus;

// ---------------------------------------------------------------------------
// Relay state
// ---------------------------------------------------------------------------

pub struct SharedEventRelayState {
    pub total_relayed: u64,
    pub last_poll_at: Option<String>,
    pub last_error: Option<String>,
    pub active_feeds: u32,
    /// Serializes the entire tick cycle (read subscriptions → poll feeds →
    /// advance cursors) so overlapping scheduler intervals cannot produce
    /// duplicate events from stale cursors.
    tick_lock: Arc<Mutex<()>>,
}

impl SharedEventRelayState {
    pub fn new() -> Self {
        Self {
            total_relayed: 0,
            last_poll_at: None,
            last_error: None,
            active_feeds: 0,
            tick_lock: Arc::new(Mutex::new(())),
        }
    }
}

// ---------------------------------------------------------------------------
// Status emitted to frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedEventRelayStatus {
    pub connected: bool,
    pub last_poll_at: Option<String>,
    pub active_feeds: u32,
    pub total_relayed: u64,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Tick function
// ---------------------------------------------------------------------------

pub async fn shared_event_relay_tick(
    client: &Arc<CloudClient>,
    pool: &DbPool,
    app: &AppHandle,
    state: &Mutex<SharedEventRelayState>,
) {
    // Grab the tick serialization lock (non-blocking). If another tick is
    // already running we skip this cycle entirely — the in-flight tick will
    // advance cursors past anything we would have polled.
    let tick_lock = {
        let st = state.lock().await;
        Arc::clone(&st.tick_lock)
    };
    let _tick_guard = match tick_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            tracing::debug!("SharedEventRelay: tick already in progress, skipping");
            return;
        }
    };

    let now = chrono::Utc::now().to_rfc3339();

    // 1. Get enabled subscriptions
    let subs = match repo::list_enabled_subscriptions(pool) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("SharedEventRelay: failed to list subscriptions: {e}");
            let mut st = state.lock().await;
            st.last_error = Some(e.to_string());
            st.last_poll_at = Some(now.clone());
            return;
        }
    };

    if subs.is_empty() {
        let mut st = state.lock().await;
        st.active_feeds = 0;
        st.last_poll_at = Some(now.clone());
        st.last_error = None;
        emit_status(app, &st);
        return;
    }

    let mut total_new = 0u64;

    // 2. Poll each subscription
    for sub in &subs {
        match client
            .shared_events_poll_feed(&sub.slug, sub.last_cursor.as_deref(), Some(50))
            .await
        {
            Ok(firings) => {
                let _ = repo::set_error(pool, &sub.id, None);

                let mut sub_published = 0u32;
                for firing in &firings {
                    // 3. Publish to local event bus
                    let event_type = format!("shared:{}", sub.slug);
                    let input = CreatePersonaEventInput {
                        event_type,
                        source_type: "shared_catalog".to_string(),
                        source_id: Some(firing.id.clone()),
                        target_persona_id: None, // broadcast
                        project_id: None,
                        payload: firing.payload.clone(),
                        use_case_id: None,
                    };

                    match event_repo::publish(pool, input) {
                        Ok(event) => {
                            emit_event_bus(app, &event);
                            total_new += 1;
                            sub_published += 1;
                        }
                        Err(e) => {
                            tracing::warn!(
                                sub_id = %sub.id,
                                "SharedEventRelay: failed to publish event: {e}"
                            );
                        }
                    }
                }

                // 4. Advance cursor with actual batch count
                if let Some(last) = firings.last() {
                    let count = if sub_published > 0 { sub_published } else { 1 };
                    let _ = repo::update_cursor(pool, &sub.id, &last.fired_at, count);
                }
            }
            Err(e) => {
                tracing::warn!(
                    sub_slug = %sub.slug,
                    "SharedEventRelay: failed to poll feed: {e}"
                );
                let _ = repo::set_error(pool, &sub.id, Some(&e.to_string()));
            }
        }
    }

    // 5. Update state
    let mut st = state.lock().await;
    st.total_relayed += total_new;
    st.active_feeds = subs.len() as u32;
    st.last_poll_at = Some(now);
    st.last_error = None;
    emit_status(app, &st);
}

fn emit_status(app: &AppHandle, st: &SharedEventRelayState) {
    let status = SharedEventRelayStatus {
        connected: true,
        last_poll_at: st.last_poll_at.clone(),
        active_feeds: st.active_feeds,
        total_relayed: st.total_relayed,
        error: st.last_error.clone(),
    };
    let _ = app.emit("shared-event-relay-status", status);
}
