//! Trigger *firing* state — the scheduler's hot path.
//!
//! Everything here is written on a tick rather than by a human: the dispatch
//! lookups the engine runs to find work, the compare-and-swap claims that stop
//! a slot firing twice, the schedule-pointer advances, and the
//! `schedule_missed_runs` side-state that records what was discarded while the
//! app was offline. Contrast [`super::definitions`], which is written once and
//! read forever.

use rusqlite::params;

use crate::models::PersonaTrigger;
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::scheduler;

use super::{get_by_id, row_to_trigger};

/// Get enabled chain triggers whose source_persona_id matches the given value.
/// Uses SQL-level filtering with json_extract to avoid loading all triggers.
pub fn get_chain_triggers_for_source(
    pool: &DbPool,
    source_persona_id: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::get_chain_triggers_for_source",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_triggers
             WHERE trigger_type = 'chain'
               AND status = 'active'
               AND json_extract(config, '$.source_persona_id') = ?1
             ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![source_persona_id], row_to_trigger)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Get enabled event_listener triggers whose listen_event_type matches the given event type.
/// Uses SQL-level filtering with json_extract.
pub fn get_event_listeners_for_event_type(
    pool: &DbPool,
    event_type: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::get_event_listeners_for_event_type",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_triggers
             WHERE trigger_type = 'event_listener'
               AND status = 'active'
               AND json_extract(config, '$.listen_event_type') = ?1
             ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![event_type], row_to_trigger)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Bulk-fetch enabled event_listener triggers for multiple event types in a single query.
pub fn get_event_listeners_for_event_types(
    pool: &DbPool,
    event_types: &[String],
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::get_event_listeners_for_event_types",
        {
            if event_types.is_empty() {
                return Ok(Vec::new());
            }
            let conn = pool.get()?;
            let mut qb = QueryBuilder::new();
            qb.where_raw(|_| "trigger_type = 'event_listener'".to_string(), vec![]);
            qb.where_raw(|_| "status = 'active'".to_string(), vec![]);
            qb.where_in(
                "json_extract(config, '$.listen_event_type')",
                event_types.to_vec(),
            );
            qb.order_by("created_at", "DESC");
            let sql = qb.build_select("SELECT * FROM persona_triggers");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_trigger)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Get enabled triggers of a specific type using SQL-level filtering.
/// Avoids loading all triggers and filtering in Rust — mirrors the pattern
/// used by `get_chain_triggers_for_source` and `get_event_listeners_for_event_type`.
pub fn get_enabled_by_type(
    pool: &DbPool,
    trigger_type: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::get_enabled_by_type",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_triggers
             WHERE trigger_type = ?1 AND status = 'active'
             ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![trigger_type], row_to_trigger)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn get_due(pool: &DbPool, now: &str) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_due", {
        let conn = pool.get()?;
        // Honour the persona Active/Off toggle: a disabled persona's
        // schedule triggers must not fire. Without the JOIN+WHERE the
        // header toggle was purely cosmetic — `personas.enabled = 0` was
        // never read by the dispatch path, and cron continued to fire
        // executions after the user "switched the agent off".
        // FOREIGN TABLE: personas is owned by `repos::core::personas`.
        let mut stmt = conn.prepare_cached(
            "SELECT t.* FROM persona_triggers t
             INNER JOIN personas p ON p.id = t.persona_id
             WHERE t.status = 'active'
               AND t.next_trigger_at IS NOT NULL
               AND t.next_trigger_at <= ?1
               AND p.enabled = 1
             ORDER BY t.next_trigger_at ASC",
        )?;
        let rows = stmt.query_map(params![now], row_to_trigger)?;
        let triggers = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(triggers)
    })
}

/// Returns a map of trigger_id -> health status ("healthy", "degraded", "failing", "unknown")
/// by joining triggers with the 3 most recent executions per trigger in a single query.
pub fn get_health_map(
    pool: &DbPool,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_health_map", {
        let conn = pool.get()?;
        // For each trigger, get the 3 most recent executions (ranked by created_at DESC).
        // Then aggregate: count failures in top 3, check if top 2 are both non-completed.
        // FOREIGN TABLE: persona_executions is owned by `repos::execution::executions`.
        let mut stmt = conn.prepare_cached(
            "WITH ranked AS (
               SELECT
                 e.trigger_id,
                 e.status,
                 ROW_NUMBER() OVER (PARTITION BY e.trigger_id ORDER BY e.created_at DESC) AS rn
               FROM persona_executions e
               WHERE e.trigger_id IS NOT NULL
             ),
             top3 AS (
               SELECT trigger_id, status, rn FROM ranked WHERE rn <= 3
             ),
             agg AS (
               SELECT
                 trigger_id,
                 COUNT(*) AS total,
                 SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END) AS fail_count,
                 -- Check if the two most recent are both non-completed
                 SUM(CASE WHEN rn <= 2 AND status != 'completed' THEN 1 ELSE 0 END) AS top2_non_completed
               FROM top3
               GROUP BY trigger_id
             )
             SELECT trigger_id, total, fail_count, top2_non_completed FROM agg",
        )?;

        let mut health_map = std::collections::HashMap::new();
        let rows = stmt.query_map([], |row| {
            let trigger_id: String = row.get(0)?;
            let total: i64 = row.get(1)?;
            let fail_count: i64 = row.get(2)?;
            let top2_non_completed: i64 = row.get(3)?;
            Ok((trigger_id, total, fail_count, top2_non_completed))
        })?;

        for row in rows {
            let (trigger_id, total, fail_count, top2_non_completed) =
                row.map_err(AppError::Database)?;
            let health = if total == 0 {
                "unknown"
            } else if fail_count == 0 {
                "healthy"
            } else if total >= 2 && top2_non_completed >= 2 {
                "failing"
            } else {
                "degraded"
            };
            health_map.insert(trigger_id, health.to_string());
        }

        Ok(health_map)
    })
}

/// Single-query chain link resolution using SQL JOINs + json_extract.
/// Returns (trigger_id, source_persona_id, source_name, target_persona_id, target_name, condition_type, enabled).
#[allow(clippy::type_complexity)]
pub fn get_chain_links(
    pool: &DbPool,
) -> Result<Vec<(String, String, String, String, String, String, bool)>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_chain_links", {
        let conn = pool.get()?;
        // FOREIGN TABLE: personas is owned by `repos::core::personas`.
        let mut stmt = conn.prepare_cached(
            "SELECT
               t.id,
               COALESCE(json_extract(t.config, '$.source_persona_id'), '') AS source_persona_id,
               COALESCE(sp.name, 'Unknown') AS source_persona_name,
               t.persona_id AS target_persona_id,
               COALESCE(tp.name, 'Unknown') AS target_persona_name,
               COALESCE(json_extract(t.config, '$.condition.type'), 'any') AS condition_type,
               t.enabled
             FROM persona_triggers t
             LEFT JOIN personas sp ON sp.id = json_extract(t.config, '$.source_persona_id')
             LEFT JOIN personas tp ON tp.id = t.persona_id
             WHERE t.trigger_type = 'chain'
             ORDER BY t.created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i32>(6)? != 0,
            ))
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Atomically claim a due trigger using compare-and-swap on `trigger_version`.
///
/// The WHERE clause checks that `trigger_version` still matches the value the
/// caller read from `get_due`.  If a concurrent scheduler tick already advanced
/// the schedule (incrementing the version), this UPDATE touches 0 rows and
/// returns `Ok(false)`, preventing double-fire.
pub fn mark_triggered(
    pool: &DbPool,
    id: &str,
    next_trigger_at: Option<String>,
    expected_version: i32,
) -> Result<bool, AppError> {
    timed_query!("persona_triggers", "persona_triggers::mark_triggered", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE persona_triggers
             SET last_triggered_at = ?1, next_trigger_at = ?2, updated_at = ?1,
                 trigger_version = trigger_version + 1
             WHERE id = ?3 AND trigger_version = ?4",
            params![now, next_trigger_at, id, expected_version],
        )?;
        Ok(rows > 0)
    })
}

/// Advance ONLY the schedule pointer on a *skip* — without touching
/// `last_triggered_at`.
///
/// The auto-backfill catch-up window is `(last_triggered_at, now]`, so
/// `last_triggered_at` must remain the watermark of the last slot that actually
/// *fired/published*. The skip paths (over-budget, out-of-active-window,
/// rate-limited) still need to advance `next_trigger_at` (so the overdue slot
/// isn't re-evaluated every 5s tick) and bump `trigger_version` (so the CAS in
/// `mark_triggered` still detects concurrent advances) — but they must NOT move
/// the fired-watermark forward, or days of missed runs would silently never be
/// replayed after a pause.
///
/// Mirrors `mark_triggered`'s CAS semantics: the WHERE clause checks
/// `trigger_version = expected_version`, so a concurrent tick that already
/// advanced the schedule makes this UPDATE touch 0 rows and return `Ok(false)`.
pub fn advance_schedule_pointer(
    pool: &DbPool,
    id: &str,
    next_trigger_at: Option<String>,
    expected_version: i32,
) -> Result<bool, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::advance_schedule_pointer",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            let rows = conn.execute(
                "UPDATE persona_triggers
                 SET next_trigger_at = ?1, updated_at = ?2,
                     trigger_version = trigger_version + 1
                 WHERE id = ?3 AND trigger_version = ?4",
                params![next_trigger_at, now, id, expected_version],
            )?;
            Ok(rows > 0)
        }
    )
}

/// Unconditionally advance a trigger's schedule after a manual execution.
///
/// Unlike `mark_triggered` (which uses CAS to prevent double-fire from
/// concurrent scheduler ticks), this always updates. Used when the user
/// manually runs or recovers an overdue trigger so it moves out of the
/// "overdue" state.
pub fn advance_schedule(
    pool: &DbPool,
    id: &str,
    next_trigger_at: Option<String>,
) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::advance_schedule", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_triggers
             SET last_triggered_at = ?1, next_trigger_at = ?2, updated_at = ?1,
                 trigger_version = trigger_version + 1
             WHERE id = ?3",
            params![now, next_trigger_at, id],
        )?;
        Ok(())
    })
}

/// Atomically update the content hash and advance the schedule in a single
/// compare-and-swap (CAS) operation.
///
/// The WHERE clause checks that the stored content_hash still matches
/// `expected_old_hash`. If another poll cycle already updated the hash,
/// the CAS fails (returns `Ok(false)`) and the caller must NOT publish a
/// duplicate event.
///
/// This prevents the race where event publish succeeds but the hash or
/// schedule update fails, leaving stale state for the next cycle.
pub fn mark_triggered_with_hash(
    pool: &DbPool,
    id: &str,
    new_hash: &str,
    expected_old_hash: Option<&str>,
    next_trigger_at: Option<String>,
) -> Result<bool, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::mark_triggered_with_hash",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;

            let rows = match expected_old_hash {
                Some(old) => conn.execute(
                    "UPDATE persona_triggers
                 SET config = json_set(COALESCE(config, '{}'), '$.content_hash', ?1),
                     last_triggered_at = ?2,
                     next_trigger_at = ?3,
                     updated_at = ?2,
                     trigger_version = trigger_version + 1
                 WHERE id = ?4
                   AND json_extract(config, '$.content_hash') = ?5",
                    params![new_hash, now, next_trigger_at, id, old],
                )?,
                None => conn.execute(
                    "UPDATE persona_triggers
                 SET config = json_set(COALESCE(config, '{}'), '$.content_hash', ?1),
                     last_triggered_at = ?2,
                     next_trigger_at = ?3,
                     updated_at = ?2,
                     trigger_version = trigger_version + 1
                 WHERE id = ?4
                   AND json_extract(config, '$.content_hash') IS NULL",
                    params![new_hash, now, next_trigger_at, id],
                )?,
            };

            Ok(rows > 0)
        }
    )
}

/// Set the `enabled` flag on a trigger. Used as a safety valve to disable
/// triggers that fail to mark as triggered, preventing cascade re-fire loops.
/// Also updates the `status` column to stay in sync.
pub fn set_enabled(pool: &DbPool, id: &str, enabled: bool) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::set_enabled", {
        let now = chrono::Utc::now().to_rfc3339();
        let status = if enabled { "active" } else { "disabled" };
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_triggers SET enabled = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
            params![enabled as i32, status, now, id],
        )?;
        drop(conn);

        // Re-arm on enable. A time-based trigger that was created disabled (the
        // persona-duplication path does exactly this) carries
        // `next_trigger_at = NULL`; switching it on without recomputing leaves
        // it invisible to `get_due` forever, so the user turns it on and
        // nothing happens. Only fills a NULL — an already-armed trigger keeps
        // its slot so toggling does not shift the cadence.
        if enabled {
            let trigger = get_by_id(pool, id)?;
            let time_based = personas_core::models::TriggerKind::from_wire(&trigger.trigger_type)
                .is_some_and(|k| k.is_time_based());
            if time_based && trigger.next_trigger_at.is_none() {
                if let Some(next) = scheduler::compute_next_trigger_at(&trigger, chrono::Utc::now())
                {
                    let conn2 = pool.get()?;
                    conn2.execute(
                        "UPDATE persona_triggers SET next_trigger_at = ?1 WHERE id = ?2",
                        params![next, id],
                    )?;
                }
            }
        }
        Ok(())
    })
}

/// Set the full lifecycle status on a trigger, keeping `enabled` in sync.
///
/// Unlike `set_enabled` (which only knows Active/Disabled), this preserves
/// all four states: Active, Paused, Errored, Disabled.
pub fn set_status(
    pool: &DbPool,
    id: &str,
    status: personas_core::lifecycle::TriggerStatus,
) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::set_status", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "UPDATE persona_triggers SET status = ?1, enabled = ?2, updated_at = ?3 WHERE id = ?4",
        )?;
        stmt.execute(params![
            status.as_str(),
            status.is_enabled() as i32,
            now,
            id
        ])?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Schedule missed-runs (discarded-while-offline) side-state
// ---------------------------------------------------------------------------

/// Per-trigger record of scheduled slots that were DISCARDED while the app was
/// offline. The startup overdue sweep fires ONE catch-up per trigger and drops
/// the rest under the default backfill cap of 1; this row is the durable
/// "missed N while offline" signal surfaced in the schedule UI. Cleared after
/// the user backfills or dismisses.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleMissedRuns {
    pub trigger_id: String,
    #[ts(type = "number")]
    pub missed_count: i64,
    pub first_missed_at: Option<String>,
    pub last_missed_at: Option<String>,
    /// Direction 3: machine-readable reason the schedule is Paused/Unscheduled
    /// (e.g. `invalid_timezone`). `None` when the schedule is healthy. Surfaced
    /// in the schedule row next to the Paused/Unscheduled state.
    pub status_reason: Option<String>,
    /// Human-facing detail for `status_reason` (e.g. the offending timezone +
    /// parser error). Not translated — a diagnostic string.
    pub status_reason_detail: Option<String>,
}

/// Accumulate `delta` discarded slots for a trigger. Idempotent-friendly:
/// `first_missed_at` is preserved across calls (the earliest gap), while
/// `last_missed_at` tracks the most recent detection. A `delta` of 0 or less
/// is a no-op so callers can pass a raw count without guarding.
pub fn record_missed_runs(
    pool: &DbPool,
    trigger_id: &str,
    delta: i64,
    now: &str,
) -> Result<(), AppError> {
    if delta <= 0 {
        return Ok(());
    }
    timed_query!("schedule_missed_runs", "schedule_missed_runs::record", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO schedule_missed_runs
                 (trigger_id, missed_count, first_missed_at, last_missed_at, updated_at)
             VALUES (?1, ?2, ?3, ?3, ?3)
             ON CONFLICT(trigger_id) DO UPDATE SET
                 missed_count    = missed_count + excluded.missed_count,
                 first_missed_at = COALESCE(schedule_missed_runs.first_missed_at, excluded.first_missed_at),
                 last_missed_at  = excluded.last_missed_at,
                 updated_at      = excluded.updated_at",
            params![trigger_id, delta, now],
        )?;
        Ok(())
    })
}

/// List every trigger with a non-zero discarded-while-offline count, for the
/// schedule UI's "missed N while offline" badge.
pub fn list_missed_runs(pool: &DbPool) -> Result<Vec<ScheduleMissedRuns>, AppError> {
    timed_query!("schedule_missed_runs", "schedule_missed_runs::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT trigger_id, missed_count, first_missed_at, last_missed_at,
                    status_reason, status_reason_detail
             FROM schedule_missed_runs
             WHERE missed_count > 0 OR status_reason IS NOT NULL
             ORDER BY last_missed_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ScheduleMissedRuns {
                trigger_id: row.get(0)?,
                missed_count: row.get(1)?,
                first_missed_at: row.get(2)?,
                last_missed_at: row.get(3)?,
                status_reason: row.get(4)?,
                status_reason_detail: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Clear a trigger's discarded-while-offline count after the user backfills or
/// dismisses it. Idempotent — clearing an absent row is a no-op.
///
/// Preserves any `status_reason` (a bad-timezone pause is independent of the
/// missed-count badge): the row is deleted only when no reason remains.
pub fn clear_missed_runs(pool: &DbPool, trigger_id: &str) -> Result<(), AppError> {
    timed_query!("schedule_missed_runs", "schedule_missed_runs::clear", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE schedule_missed_runs
             SET missed_count = 0, first_missed_at = NULL, last_missed_at = NULL,
                 updated_at = ?2
             WHERE trigger_id = ?1",
            params![trigger_id, chrono::Utc::now().to_rfc3339()],
        )?;
        conn.execute(
            "DELETE FROM schedule_missed_runs
             WHERE trigger_id = ?1 AND missed_count = 0 AND status_reason IS NULL",
            params![trigger_id],
        )?;
        Ok(())
    })
}

/// Direction 3: persist a machine-readable reason the schedule is
/// Paused/Unscheduled (e.g. `invalid_timezone`) on the per-trigger side-state
/// row. `detail` is an optional human-facing diagnostic. Upserts so the reason
/// coexists with any missed-count on the same row.
pub fn set_schedule_status_reason(
    pool: &DbPool,
    trigger_id: &str,
    reason: &str,
    detail: Option<&str>,
) -> Result<(), AppError> {
    timed_query!(
        "schedule_missed_runs",
        "schedule_missed_runs::set_status_reason",
        {
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO schedule_missed_runs
                     (trigger_id, status_reason, status_reason_detail, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(trigger_id) DO UPDATE SET
                     status_reason        = excluded.status_reason,
                     status_reason_detail = excluded.status_reason_detail,
                     updated_at           = excluded.updated_at",
                params![trigger_id, reason, detail, chrono::Utc::now().to_rfc3339()],
            )?;
            Ok(())
        }
    )
}

/// Direction 3: clear a schedule's pause reason once it is healthy again (e.g.
/// the timezone was corrected). Deletes the row if no missed-count remains.
pub fn clear_schedule_status_reason(pool: &DbPool, trigger_id: &str) -> Result<(), AppError> {
    timed_query!(
        "schedule_missed_runs",
        "schedule_missed_runs::clear_status_reason",
        {
            let conn = pool.get()?;
            conn.execute(
                "UPDATE schedule_missed_runs
                 SET status_reason = NULL, status_reason_detail = NULL, updated_at = ?2
                 WHERE trigger_id = ?1",
                params![trigger_id, chrono::Utc::now().to_rfc3339()],
            )?;
            conn.execute(
                "DELETE FROM schedule_missed_runs
                 WHERE trigger_id = ?1 AND missed_count = 0 AND status_reason IS NULL",
                params![trigger_id],
            )?;
            Ok(())
        }
    )
}
