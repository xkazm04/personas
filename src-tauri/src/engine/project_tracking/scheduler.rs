//! Scheduler — 1h tick driver. Hardcoded cadence (the user explicitly
//! decided to hide the cadence selector for v1).
//!
//! Each tick:
//!   1. Short-circuit if the master enable flag is off.
//!   2. Read the set of enabled subscriptions.
//!   3. Per project, run each enabled watcher with `since = last_pulse_at
//!      ?? now-24h` and insert the resulting events.
//!   4. Stamp `last_pulse_at = now`.
//!   5. Prune events older than 7 days (cheap; runs once per tick).
//!   6. Phase 2 will trigger the consolidator when `event_count > 0`.
//!
//! Failures inside one project's watcher pass are logged and skipped;
//! they don't break the tick for other projects.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tauri::AppHandle;
use tokio::task::JoinHandle;
use tokio::time::interval;
use tracing::{info, warn};

use crate::db::UserDbPool;
use crate::engine::project_tracking::consolidator::{self, TickSnapshot};
use crate::engine::project_tracking::events::{
    insert_event, prune_old_events, EventPayload,
};
use crate::engine::project_tracking::subscription::{
    list_enabled, update_last_pulse_at, watch_since, Subscription,
};
use crate::engine::project_tracking::watchers;

/// Tick cadence — 1h, hardcoded per the locked design decision.
pub const TICK_INTERVAL: Duration = Duration::from_secs(3600);

/// Spawn the scheduler loop. Returns the JoinHandle so a future
/// shutdown path can abort it; for v1 we just spawn-and-forget.
pub fn spawn(
    pool: UserDbPool,
    enabled: Arc<AtomicBool>,
    app_handle: AppHandle,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = interval(TICK_INTERVAL);
        // The first `tick()` fires immediately; we want to wait one full
        // interval before the first poll so the app has a chance to
        // settle. The "first-run backfill" path runs out-of-band when
        // the subscription is first toggled enabled (Phase 5 wires it
        // through the master toggle command), not from this loop.
        ticker.tick().await;

        loop {
            ticker.tick().await;
            if !enabled.load(Ordering::Relaxed) {
                continue;
            }
            if let Err(e) = run_tick(&pool, &app_handle).await {
                warn!(error = %e, "project_tracking: tick failed");
            }
        }
    })
}

/// One tick worth of work. Public for the push accelerator (Phase 3) to
/// call out-of-band when a CLI signals an interesting event, and for
/// the master toggle command (Phase 5) to fire the first-run backfill
/// pulse on enable.
pub async fn run_tick(
    pool: &UserDbPool,
    app_handle: &AppHandle,
) -> Result<(), crate::error::AppError> {
    let subs = list_enabled(pool)?;
    if subs.is_empty() {
        return Ok(());
    }

    for sub in &subs {
        if let Err(e) = run_project(pool, sub, app_handle).await {
            warn!(
                project_id = %sub.project_id,
                error = %e,
                "project_tracking: project tick failed; continuing with others",
            );
        }
    }

    let pruned = prune_old_events(pool)?;
    if pruned > 0 {
        info!(pruned, "project_tracking: pruned aged events");
    }

    Ok(())
}

async fn run_project(
    pool: &UserDbPool,
    sub: &Subscription,
    app_handle: &AppHandle,
) -> Result<(), crate::error::AppError> {
    let project_path = PathBuf::from(&sub.project_path);
    let since = watch_since(sub);

    let mut all_events: Vec<EventPayload> = Vec::new();

    if sub.watch_git {
        match watchers::git::poll(&project_path, since).await {
            Ok(events) => all_events.extend(events),
            Err(e) => warn!(
                project_id = %sub.project_id,
                error = %e,
                "git watcher failed",
            ),
        }
    }

    if sub.watch_active_runs {
        match watchers::ledger::poll(&project_path, since).await {
            Ok(events) => all_events.extend(events),
            Err(e) => warn!(
                project_id = %sub.project_id,
                error = %e,
                "ledger watcher failed",
            ),
        }
    }

    if sub.watch_obsidian {
        if let Some(vault_path_str) = &sub.obsidian_vault_path {
            let vault_path = PathBuf::from(vault_path_str);
            match watchers::obsidian::poll(&vault_path, since).await {
                Ok(events) => all_events.extend(events),
                Err(e) => warn!(
                    project_id = %sub.project_id,
                    error = %e,
                    "obsidian watcher failed",
                ),
            }
        }
    }

    let event_count = all_events.len();
    for payload in &all_events {
        if let Err(e) = insert_event(pool, &sub.project_id, payload) {
            warn!(
                project_id = %sub.project_id,
                kind = payload.kind(),
                error = %e,
                "event insert failed",
            );
        }
    }

    if event_count > 0 {
        info!(
            project_id = %sub.project_id,
            event_count,
            "project_tracking: ingested events; running consolidator",
        );
        let project_name = sub
            .project_path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&sub.project_path)
            .to_string();
        let snapshot = TickSnapshot::from_events(project_name, &all_events);
        if let Err(e) =
            consolidator::run_for_project(pool, sub, snapshot, Some(app_handle)).await
        {
            warn!(
                project_id = %sub.project_id,
                error = %e,
                "project_tracking: consolidator failed; pulse not updated this tick",
            );
        }
    }

    update_last_pulse_at(pool, &sub.project_id, Utc::now())?;
    Ok(())
}
