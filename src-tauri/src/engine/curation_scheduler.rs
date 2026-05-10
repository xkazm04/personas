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
        let parsed = match cron::parse_cron(&schedule.cron_expr) {
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
            Some(s) => match s.parse() {
                Ok(dt) => dt,
                Err(_) => {
                    tracing::warn!(
                        persona_id = %schedule.persona_id,
                        last_curation_at = %s,
                        "curation_scheduler: unparseable last_curation_at, falling back to now-as-reference (no fire this tick)"
                    );
                    now
                }
            },
            None => match schedule.created_at.parse() {
                Ok(dt) => dt,
                Err(_) => now,
            },
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
                if let Err(e) = curation_schedule::mark_run_now(pool, &schedule.persona_id) {
                    tracing::warn!(
                        persona_id = %schedule.persona_id,
                        error = %e,
                        "curation_scheduler: mark_run_now failed (will re-fire next tick)"
                    );
                    // Don't increment enqueued in this case — the row will be
                    // tried again next tick and may produce a duplicate. The
                    // worker_tick's pop_next_queued atomic UPDATE prevents
                    // double-execution at the job level even if we double-enqueue.
                }
                enqueued += 1;
            }
            Err(e) => {
                tracing::warn!(
                    persona_id = %schedule.persona_id,
                    error = %e,
                    "curation_scheduler: enqueue failed, skipping this tick"
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
