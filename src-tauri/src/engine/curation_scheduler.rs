//! Scheduled-curation worker — periodically scans
//! `persona_curation_schedule` rows, evaluates cron expressions, and
//! enqueues `memory_curation_run` jobs for personas whose schedule is
//! due to fire.
//!
//! Concept borrowed from Anthropic Managed Agents' dream pipeline +
//! the user request: nightly memory curation per persona, runs while
//! the user is away. Personas's primitive: a tokio task that ticks
//! every 60 seconds (`SCHEDULER_TICK_INTERVAL`), reads the schedule
//! table, computes next-fire vs `last_curation_at`, and pushes a job
//! row into `persona_background_job` via `engine::persona_jobs::enqueue`.
//!
//! Distinct from `engine::scheduler` (cron/trigger evaluator that
//! fires persona executions): that scheduler operates on the
//! `triggers` table; this scheduler operates on
//! `persona_curation_schedule`. The two have different semantics
//! (trigger fires the persona; curation reviews its memory) and
//! different consumers, so they intentionally don't share an
//! abstraction.

use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::db::repos::core::curation_schedule;
use crate::db::DbPool;
use crate::engine::cron;
use crate::engine::persona_jobs::{self, KIND_MEMORY_CURATION};
use crate::error::AppError;

/// Parse a DB timestamp tolerantly. `curation_schedule::upsert`/`mark_run_now`
/// persist via SQLite `datetime('now')`, which yields `2026-06-16 14:30:00`
/// (space separator, no offset) — and `DateTime::<Utc>::from_str` is RFC3339-only,
/// so it rejected every such value. Both reference arms then fell through to
/// `now`, making `next_fire` always `> now` → the scheduler never enqueued a
/// curation run for any persona. Accept the space-separated form as well as
/// RFC3339 so existing rows parse without a migration.
fn parse_db_timestamp(s: &str) -> Option<DateTime<Utc>> {
    s.parse::<DateTime<Utc>>().ok().or_else(|| {
        chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y-%m-%d %H:%M:%S")
            .ok()
            .map(|n| n.and_utc())
    })
}

/// Tick interval for the scheduler worker. Set to 60s because cron's
/// finest granularity is 1 minute — checking more frequently would
/// burn CPU without finding any due-fire transitions.
pub const SCHEDULER_TICK_INTERVAL: Duration = Duration::from_secs(60);

/// One scheduler tick. For each persona with a curation schedule:
/// 1. Parse the cron expression (skip + log if invalid).
/// 2. Determine the reference point (last_curation_at, or row's
///    created_at if never run).
/// 3. Compute the next-fire time from that reference.
/// 4. If next-fire <= now, enqueue a memory_curation_run job and
///    update last_curation_at.
///
/// Returns the number of jobs enqueued this tick. Public so tests +
/// `lib.rs::setup` can call it directly.
pub fn tick(pool: &DbPool) -> Result<usize, AppError> {
    let schedules = curation_schedule::list(pool)?;
    if schedules.is_empty() {
        return Ok(0);
    }

    let now = Utc::now();
    let mut enqueued = 0usize;

    for schedule in &schedules {
        // Seed H-token expansion with the persona id so two personas on the
        // same `H/15` curation cron land on different minutes instead of
        // both running at :00.
        let parsed = match cron::parse_cron_seeded(
            &schedule.cron_expr,
            cron::seed_hash(&schedule.persona_id),
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(
                    persona_id = %schedule.persona_id,
                    cron_expr = %schedule.cron_expr,
                    error = %e,
                    "curation_scheduler: invalid cron, skipping persona"
                );
                continue;
            }
        };

        // Reference point for next-fire computation:
        //   - if last_curation_at is set, use it (so we don't re-fire
        //     immediately after a run completes)
        //   - otherwise use created_at (first-fire path: persona was
        //     just scheduled; fire on the first matching minute)
        let reference: DateTime<Utc> = match schedule.last_curation_at.as_deref() {
            Some(s) => match parse_db_timestamp(s) {
                Some(dt) => dt,
                None => {
                    tracing::warn!(
                        persona_id = %schedule.persona_id,
                        last_curation_at = %s,
                        "curation_scheduler: unparseable last_curation_at, falling back to now-as-reference (no fire this tick)"
                    );
                    now
                }
            },
            None => parse_db_timestamp(&schedule.created_at).unwrap_or(now),
        };

        let next_fire = match cron::next_fire_time(&parsed, reference) {
            Some(t) => t,
            None => {
                tracing::debug!(
                    persona_id = %schedule.persona_id,
                    "curation_scheduler: no next-fire (cron evaluator returned None)"
                );
                continue;
            }
        };

        if next_fire > now {
            continue; // not yet due
        }

        // Due. Enqueue a memory_curation_run job for this persona.
        let mut params = serde_json::Map::new();
        params.insert(
            "persona_id".to_string(),
            serde_json::Value::String(schedule.persona_id.clone()),
        );
        // Default threshold matches the IPC command's default.
        params.insert("threshold".to_string(), serde_json::Value::Number(7.into()));
        let params_value = serde_json::Value::Object(params);

        // Advance the schedule watermark BEFORE enqueuing. The previous order
        // (enqueue, then mark) double-enqueued whenever mark_run_now failed:
        // the watermark stayed put, so the next tick saw the schedule still due
        // and enqueued a second job. Two queued rows are two DISTINCT jobs that
        // both run — pop_next_queued's atomic UPDATE only dedups a single row,
        // it does not collapse two. A scheduled curation pass is an expensive
        // paid CLI run, so we fail closed: if the watermark can't advance we
        // skip this tick (at worst a missed run, recovered next tick) rather
        // than risk a double-run.
        if let Err(e) = curation_schedule::mark_run_now(pool, &schedule.persona_id) {
            tracing::warn!(
                persona_id = %schedule.persona_id,
                error = %e,
                "curation_scheduler: mark_run_now failed; skipping enqueue this tick to avoid a double-run"
            );
            continue;
        }

        match persona_jobs::enqueue(
            pool,
            KIND_MEMORY_CURATION,
            &params_value,
            Some(&schedule.persona_id),
        ) {
            Ok(job_id) => {
                tracing::info!(
                    persona_id = %schedule.persona_id,
                    cron_expr = %schedule.cron_expr,
                    job_id = %job_id,
                    "curation_scheduler: enqueued scheduled memory_curation_run"
                );
                enqueued += 1;
            }
            Err(e) => {
                // Watermark already advanced, so this missed run is recovered
                // at the next cron fire rather than retried immediately.
                tracing::warn!(
                    persona_id = %schedule.persona_id,
                    error = %e,
                    "curation_scheduler: enqueue failed after watermark advance; will fire next cron tick"
                );
            }
        }
    }

    Ok(enqueued)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_interval_is_one_minute() {
        // Cron's finest granularity is 1 minute; ticking faster wastes CPU.
        assert_eq!(SCHEDULER_TICK_INTERVAL, Duration::from_secs(60));
    }

    #[test]
    fn cron_parse_smoke() {
        // Sunday 3am = "0 3 * * 0"
        assert!(cron::parse_cron("0 3 * * 0").is_ok());
        // Every Monday 9am = "0 9 * * 1"
        assert!(cron::parse_cron("0 9 * * 1").is_ok());
        // Invalid
        assert!(cron::parse_cron("not a cron").is_err());
        assert!(cron::parse_cron("* * *").is_err()); // too few fields
    }

    #[test]
    fn next_fire_advances_past_reference() {
        let parsed = cron::parse_cron("0 3 * * *").unwrap(); // every day 3am UTC
        let reference: DateTime<Utc> = "2026-05-10T12:00:00Z".parse().unwrap();
        let next = cron::next_fire_time(&parsed, reference).unwrap();
        assert!(next > reference);
        // 3am the next day: should be 2026-05-11 03:00 UTC.
        let expected: DateTime<Utc> = "2026-05-11T03:00:00Z".parse().unwrap();
        assert_eq!(next, expected);
    }
}
