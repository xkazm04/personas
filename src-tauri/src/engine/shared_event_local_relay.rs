//! Local-first shared-event relay.
//!
//! Delivers **baked** curated firings (seeded from `db/builtin_shared_events.rs`,
//! e.g. "ElevenLabs API updated") to their subscribers with **no cloud
//! dependency**. It is the local mirror of [`super::shared_event_relay`], which
//! polls the cloud orchestrator; both publish onto the same `shared:<slug>` bus
//! event so downstream triggers/chains treat them identically.
//!
//! Cursor model: the subscription's `last_cursor` holds the highest firing
//! `seq` delivered (a monotonic ledger integer, not a timestamp). On subscribe
//! the cursor is seeded at the current MAX(seq) so historical firings never
//! backfill-flood a new subscriber; only firings added in a *future* release
//! (seq greater than the cursor) are delivered — exactly once, with
//! `events::exists_by_source_id` as the dedup backstop.

use tauri::AppHandle;

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::{events as event_repo, shared_events as repo};
use crate::db::DbPool;
use crate::engine::event_registry::emit_event_bus;

/// Max firings delivered per subscription per tick — bounds a large catch-up
/// (e.g. an upgrade that skipped several releases) so one tick can't flood the
/// bus. The remainder is picked up on the next tick.
const MAX_PER_SUB_PER_TICK: i64 = 25;

pub async fn shared_event_local_relay_tick(pool: &DbPool, app: &AppHandle) {
    let subs = match repo::list_enabled_subscriptions(pool) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("SharedEventLocalRelay: failed to list subscriptions: {e}");
            return;
        }
    };
    if subs.is_empty() {
        return;
    }

    for sub in &subs {
        // Cursor = highest delivered firing seq (0 when unset / cloud-only slug).
        let after_seq = sub
            .last_cursor
            .as_deref()
            .and_then(|c| c.parse::<i64>().ok())
            .unwrap_or(0);

        let firings = match repo::list_firings_after(pool, &sub.slug, after_seq, MAX_PER_SUB_PER_TICK)
        {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(sub_slug = %sub.slug, "SharedEventLocalRelay: list firings failed: {e}");
                continue;
            }
        };
        if firings.is_empty() {
            continue;
        }

        let mut published = 0u32;
        let mut last_seq = after_seq;
        for firing in &firings {
            // Skip anything already on the bus (dedup by source id), but still
            // advance the cursor through it so we don't re-scan it forever.
            if event_repo::exists_by_source_id(pool, &firing.id).unwrap_or(false) {
                last_seq = firing.seq;
                continue;
            }

            let input = CreatePersonaEventInput {
                event_type: format!("shared:{}", sub.slug),
                source_type: "shared_catalog_local".to_string(),
                source_id: Some(firing.id.clone()),
                target_persona_id: None, // broadcast
                project_id: None,
                payload: Some(firing.payload.clone()),
                use_case_id: None,
            };

            match event_repo::publish(pool, input) {
                Ok(event) => {
                    emit_event_bus(app, &event);
                    published += 1;
                    last_seq = firing.seq;
                }
                Err(e) => {
                    // Hold the cursor at the last successful seq so ordering is
                    // preserved and the remainder re-delivers next tick.
                    tracing::warn!(sub_id = %sub.id, "SharedEventLocalRelay: publish failed, holding cursor: {e}");
                    break;
                }
            }
        }

        if last_seq > after_seq {
            let _ = repo::update_cursor(pool, &sub.id, &last_seq.to_string(), published);
        }
    }
}
