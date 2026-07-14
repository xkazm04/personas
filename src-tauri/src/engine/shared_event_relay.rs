use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::cloud::client::CloudClient;
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::{events as event_repo, shared_events as repo};
use crate::db::DbPool;

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

                // Record each firing's outcome in feed order; the cursor may
                // only advance through the leading contiguous run of handled
                // firings and must STOP at the first publish failure (advancing
                // past it — as pre-2026 code did, unconditionally to
                // firings.last() — would skip the failed firing forever). See
                // `resolve_published_prefix`.
                let mut outcomes: Vec<(FiringRelay, &str)> = Vec::with_capacity(firings.len());
                for firing in &firings {
                    // Dedup: the feed cursor is a bare `fired_at` with no id
                    // tiebreaker, so a firing sharing a boundary timestamp can be
                    // re-delivered on the next poll. Skip any firing already
                    // relayed (by its source id) but still advance the cursor
                    // through it so we don't stall. (The inverse — a firing
                    // *dropped* because the remote uses strict `>` on a shared
                    // timestamp — needs a server-side composite cursor and can't
                    // be recovered here.)
                    if event_repo::exists_by_source_id(pool, &firing.id).unwrap_or(false) {
                        outcomes.push((FiringRelay::AlreadyRelayed, firing.fired_at.as_str()));
                        continue;
                    }

                    // 3. Publish to the local event bus. We do NOT emit here:
                    // `publish` INSERTs into persona_events, which fires the CDC
                    // update hook — the single source of the `event-bus` emit
                    // (db/cdc.rs). The old `emit_event_bus(app, &event)` ALSO
                    // emitted, so every relayed firing reached the frontend
                    // twice; only useEventLog's id-dedupe hid the duplicate.
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
                        Ok(_event) => {
                            total_new += 1;
                            outcomes.push((FiringRelay::Published, firing.fired_at.as_str()));
                        }
                        Err(e) => {
                            tracing::warn!(
                                sub_id = %sub.id,
                                "SharedEventRelay: failed to publish event, holding cursor: {e}"
                            );
                            outcomes.push((FiringRelay::Failed, firing.fired_at.as_str()));
                            break;
                        }
                    }
                }

                // 4. Advance the cursor only through the published/handled prefix.
                let (cursor_fired_at, sub_published) = resolve_published_prefix(&outcomes);
                if let Some(fired_at) = cursor_fired_at {
                    let _ = repo::update_cursor(pool, &sub.id, fired_at, sub_published);
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

// ---------------------------------------------------------------------------
// Cursor advance rule (pure, testable)
// ---------------------------------------------------------------------------

/// Per-firing outcome, in feed order, used to compute how far the shared-event
/// cursor may advance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FiringRelay {
    /// Already relayed on a previous tick (dedup hit) — the cursor advances
    /// through it, but nothing is re-published.
    AlreadyRelayed,
    /// Newly published this tick — the cursor advances and it counts toward the
    /// published tally.
    Published,
    /// Publish failed — the cursor must STOP *before* this firing so it is
    /// re-polled next tick rather than skipped forever.
    Failed,
}

/// Compute `(cursor_fired_at, published_count)` from per-firing outcomes in feed
/// order: the cursor advances through the leading contiguous run of *handled*
/// firings (`AlreadyRelayed` | `Published`) and stops at the first `Failed`.
/// `cursor_fired_at` is `None` when that prefix is empty (no firings, or the
/// first firing failed) — leaving the stored cursor untouched.
pub(crate) fn resolve_published_prefix<'a>(
    outcomes: &[(FiringRelay, &'a str)],
) -> (Option<&'a str>, u32) {
    let mut cursor: Option<&'a str> = None;
    let mut published = 0u32;
    for (outcome, fired_at) in outcomes {
        match outcome {
            FiringRelay::AlreadyRelayed => cursor = Some(fired_at),
            FiringRelay::Published => {
                cursor = Some(fired_at);
                published += 1;
            }
            FiringRelay::Failed => break,
        }
    }
    (cursor, published)
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

#[cfg(test)]
mod tests {
    use super::{resolve_published_prefix, FiringRelay};

    #[test]
    fn empty_batch_leaves_cursor_untouched() {
        assert_eq!(resolve_published_prefix(&[]), (None, 0));
    }

    #[test]
    fn advances_through_all_published() {
        let outcomes = [
            (FiringRelay::Published, "t1"),
            (FiringRelay::Published, "t2"),
            (FiringRelay::Published, "t3"),
        ];
        assert_eq!(resolve_published_prefix(&outcomes), (Some("t3"), 3));
    }

    #[test]
    fn already_relayed_advances_cursor_without_counting() {
        // A batch of pure dedup hits still advances the cursor past them so the
        // feed doesn't re-deliver the same boundary firings forever, but none
        // count as newly published.
        let outcomes = [
            (FiringRelay::AlreadyRelayed, "t1"),
            (FiringRelay::AlreadyRelayed, "t2"),
        ];
        assert_eq!(resolve_published_prefix(&outcomes), (Some("t2"), 0));
    }

    #[test]
    fn mixed_dedup_and_published_counts_only_published() {
        let outcomes = [
            (FiringRelay::AlreadyRelayed, "t1"),
            (FiringRelay::Published, "t2"),
            (FiringRelay::AlreadyRelayed, "t3"),
            (FiringRelay::Published, "t4"),
        ];
        assert_eq!(resolve_published_prefix(&outcomes), (Some("t4"), 2));
    }

    #[test]
    fn stops_before_first_failure() {
        // The cursor must hold at the last handled firing (t2); t3 failed and
        // must be re-polled next tick, so anything at/after it is NOT skipped.
        let outcomes = [
            (FiringRelay::Published, "t1"),
            (FiringRelay::Published, "t2"),
            (FiringRelay::Failed, "t3"),
        ];
        assert_eq!(resolve_published_prefix(&outcomes), (Some("t2"), 2));
    }

    #[test]
    fn first_firing_failure_leaves_cursor_untouched() {
        let outcomes = [
            (FiringRelay::Failed, "t1"),
            (FiringRelay::Published, "t2"),
        ];
        // Never reached t2; cursor stays put so t1 is retried.
        assert_eq!(resolve_published_prefix(&outcomes), (None, 0));
    }
}
