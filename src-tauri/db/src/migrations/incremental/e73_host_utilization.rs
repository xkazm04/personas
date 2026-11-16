//! Whole-machine utilisation series (2026-11-06, spark `app-standup`).
//!
//! * `host_utilization` - one row per MINUTE of the host: a 1-minute rollup of
//!   the 10-second host sampler (`engine::resources::host_sampler`), kept 14
//!   days. `minute_ms` (epoch ms, minute-aligned) is the key, so a re-flushed
//!   minute upserts instead of duplicating.
//!
//! Shares are REAL in `0..=1`, as in `run_resource_summaries`. Every share is
//! NULL when the minute has no reading for that axis (GPU off Windows), never
//! 0: "no reading" and "idle" are different facts, and the dead-spot detector
//! must not read a missing GPU as an idle one. The row maps to
//! `personas_core::models::HostUtilizationPoint`.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "host_utilization",
            description:
                "Whole-machine CPU/RAM/GPU 1-minute rollups + fleet load (14-day retention)",
            already_applied: |conn| has_table(conn, "host_utilization"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS host_utilization (
                        minute_ms INTEGER PRIMARY KEY NOT NULL,
                        cpu_avg REAL,
                        cpu_max REAL,
                        ram_avg REAL,
                        gpu_avg REAL,
                        gpu_max REAL,
                        fleet_running INTEGER NOT NULL DEFAULT 0,
                        fleet_queued INTEGER NOT NULL DEFAULT 0
                     );",
                )
            },
        },
    )?;
    Ok(())
}
