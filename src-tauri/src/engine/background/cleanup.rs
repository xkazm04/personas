use crate::db::models::PersonaEventStatus;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::communication::reports as messages_repo;
use crate::db::repos::core::settings;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::settings_keys;
use crate::db::DbPool;

/// Read a numeric retention setting from `app_settings`, falling back to
/// `default` if the row is absent OR unparseable. Unparseable values emit a
/// `warn!` so corrupt/legacy values are visible in observability — without
/// this, a user setting `"90d"` or `"  45 "` silently reverts to the default.
fn parse_retention_setting(pool: &DbPool, key: &str, default: i64) -> i64 {
    match settings::get(pool, key).ok().flatten() {
        None => default,
        Some(raw) => match raw.parse::<i64>() {
            Ok(n) => n,
            Err(err) => {
                tracing::warn!(
                    key = key,
                    value = %raw,
                    error = %err,
                    default = default,
                    "settings retention value is not a valid integer — using default",
                );
                default
            }
        },
    }
}

/// One tick of the cleanup subscription: delete old processed events.
///
/// Reads `event_retention_days` from app_settings (default 30 days).
pub(crate) fn cleanup_tick(pool: &DbPool) {
    let retention_days = parse_retention_setting(
        pool,
        settings_keys::EVENT_RETENTION_DAYS,
        settings_keys::EVENT_RETENTION_DAYS_DEFAULT,
    );

    match event_repo::cleanup(pool, Some(retention_days)) {
        Ok(n) if n > 0 => tracing::info!(
            "Cleaned up {} old events (retention={}d)",
            n,
            retention_days
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Event cleanup error: {}", e),
    }

    // Count cap: bound intra-window growth. Age-only cleanup lets a chatty
    // source balloon the table between daily sweeps, so also trim the oldest
    // terminal events beyond a hard ceiling. DLQ + in-flight rows are exempt.
    let max_count = parse_retention_setting(
        pool,
        settings_keys::EVENT_RETENTION_MAX_COUNT,
        settings_keys::EVENT_RETENTION_MAX_COUNT_DEFAULT,
    );
    match event_repo::enforce_count_cap(pool, max_count) {
        Ok(n) if n > 0 => tracing::info!(
            "Trimmed {} terminal event(s) over the count cap (max={})",
            n,
            max_count
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Event count-cap cleanup error: {}", e),
    }

    // DLQ auto-retry: re-queue failed events that haven't exhausted retries
    let max_retries = event_repo::DEFAULT_MAX_RETRIES;
    match event_repo::get_retry_eligible(pool, max_retries, 20) {
        Ok(events) if !events.is_empty() => {
            let count = events.len();
            for evt in &events {
                if let Err(e) =
                    event_repo::update_status(pool, &evt.id, PersonaEventStatus::Pending, None)
                {
                    tracing::warn!(event_id = %evt.id, "DLQ auto-retry: failed to re-queue: {}", e);
                }
            }
            tracing::info!(
                "DLQ auto-retry: re-queued {} failed events for retry",
                count
            );
        }
        Ok(_) => {}
        Err(e) => tracing::error!("DLQ auto-retry query error: {}", e),
    }

    // Credential audit log: 90-day retention
    match audit_log::cleanup_old_entries(pool, 90) {
        Ok(n) if n > 0 => tracing::info!(
            "Cleaned up {} old credential audit log entries (retention=90d)",
            n
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Credential audit log cleanup error: {}", e),
    }

    // Stale automation runs: reap runs stuck in 'running' beyond 2× timeout
    {
        use crate::db::repos::resources::automations as auto_repo;
        match auto_repo::reap_stale_runs(pool) {
            Ok(n) if n > 0 => {
                tracing::warn!("Reaped {} stale automation run(s) stuck in running", n)
            }
            Ok(_) => {}
            Err(e) => tracing::error!("Stale automation run reaper error: {}", e),
        }
    }

    // SLA daily rollups: persist per-persona/day aggregates BEFORE execution
    // retention prunes the raw rows below, so the SLA trend survives past the
    // execution window. Idempotent recompute — safe to run every tick.
    {
        use crate::db::repos::communication::sla as sla_repo;
        match sla_repo::upsert_sla_daily(pool, sla_repo::server_offset_minutes()) {
            Ok(n) if n > 0 => tracing::debug!("SLA rollup: upserted {} persona-day row(s)", n),
            Ok(_) => {}
            Err(e) => tracing::error!("SLA rollup upsert error: {}", e),
        }
    }

    // Execution log: configurable retention (default 60 days / 2 months), keep at least 50 per persona
    let exec_retention_days = parse_retention_setting(
        pool,
        settings_keys::EXECUTION_RETENTION_DAYS,
        settings_keys::EXECUTION_RETENTION_DAYS_DEFAULT,
    );
    match exec_repo::cleanup_old_executions(pool, exec_retention_days, 50) {
        Ok(n) if n > 0 => tracing::info!(
            "Cleaned up {} old execution records (retention={}d, min_keep=50/persona)",
            n,
            exec_retention_days
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Execution log cleanup error: {}", e),
    }

    // Message log: prune READ messages older than 90 days (unread are always
    // kept). persona_reports previously had no retention, so read
    // notifications grew unbounded.
    match messages_repo::cleanup_old_reports(pool, 90) {
        Ok(n) if n > 0 => {
            tracing::info!("Cleaned up {} old read messages (retention=90d)", n)
        }
        Ok(_) => {}
        Err(e) => tracing::error!("Message log cleanup error: {}", e),
    }

    // Fix 2: orphan trigger sweep — delete triggers whose owning persona no
    // longer exists, then purge their dead audit events. Also heal any
    // schedule/polling/webhook trigger that's missing its Fix 4a auto-listener
    // (e.g. after an import, a template adoption, or a pre-Fix-4a install).
    // All three are idempotent; logs only surface when work was done.
    match trigger_repo::delete_orphaned_triggers(pool) {
        Ok(n) if n > 0 => tracing::warn!(
            count = n,
            "Orphan sweep: deleted {} trigger(s) whose persona no longer exists",
            n,
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Orphan trigger sweep error: {}", e),
    }
    match event_repo::delete_orphaned_trigger_events(pool) {
        Ok(n) if n > 0 => tracing::info!(
            count = n,
            "Orphan sweep: purged {} persona_events row(s) from deleted triggers",
            n,
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Orphan event sweep error: {}", e),
    }
    match trigger_repo::backfill_auto_listeners(pool) {
        Ok((_scanned, created)) if created > 0 => tracing::info!(
            created,
            "Auto-listener backfill: created {} missing event_listener trigger(s)",
            created,
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Auto-listener backfill error: {}", e),
    }

    // Draft-persona TTL sweep: delete abandoned build stubs (lifecycle `draft`,
    // no execution history) older than `draft_retention_days`. Default 0 =
    // disabled (opt-in), because deletion is destructive. `sweep_stale_drafts`
    // routes each candidate through the same `delete_draft_if_safe` guard the
    // build cancel path uses, so a draft that produced work is never swept.
    let draft_retention_days = parse_retention_setting(
        pool,
        settings_keys::DRAFT_RETENTION_DAYS,
        settings_keys::DRAFT_RETENTION_DAYS_DEFAULT,
    );
    if draft_retention_days > 0 {
        match crate::db::repos::core::personas::sweep_stale_drafts(pool, draft_retention_days) {
            Ok(n) if n > 0 => tracing::info!(
                "Draft sweep: deleted {} abandoned draft persona(s) (retention={}d)",
                n,
                draft_retention_days
            ),
            Ok(_) => {}
            Err(e) => tracing::error!("Draft sweep error: {}", e),
        }
    }

    // Stuck build-session GC: build sessions get parked forever at a
    // non-terminal phase (draft_ready / testing / …) — promoted personas were
    // the first observed case, but the dominant one is a from-scratch build
    // that crashed, since nothing resumes an in-memory session after a restart
    // and its persona is still `draft`. Those ghosts resurface anywhere
    // sessions are listed and keep `get_active_for_persona` reporting a build
    // in flight. Reconcile at the source: any non-terminal session with no
    // activity for ≥24h is transitioned to `cancelled` (a legal transition from
    // every non-terminal phase per `BuildPhase::validate_transition`),
    // regardless of the persona's lifecycle. The 24h floor is the whole
    // live-work protection and is deliberately unchanged — see
    // `expire_stale_non_terminal`'s docblock. Recently-active sessions are
    // never touched. Idempotent; always on (no opt-in gate, because this only
    // cancels — it never deletes data).
    {
        use crate::db::repos::core::build_sessions as bs_repo;
        match bs_repo::expire_stale_non_terminal(pool, bs_repo::STALE_SESSION_MIN_AGE_HOURS) {
            Ok(n) if n > 0 => tracing::info!(
                "Stuck build-session GC: cancelled {} stale non-terminal build session(s)",
                n
            ),
            Ok(_) => {}
            Err(e) => tracing::error!("Stuck build-session GC error: {}", e),
        }
    }
}
