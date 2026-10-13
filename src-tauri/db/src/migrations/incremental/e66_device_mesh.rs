//! Device mesh + measured resources (2026-10-13, spark `device-mesh`).
//!
//! * `run_resource_summaries` - one row per FINISHED run (fleet session or
//!   persona execution): what it actually consumed of this machine, as shares
//!   of its capacity. APPEND-ONLY and written once at run end, so `ended_at_ms`
//!   is an event time, not "when we last looked". `(run_kind, run_id)` is unique
//!   so a repeated end hook cannot double-count a run.
//! * `mesh_probe_results` - one row per onboarding/probe test verdict against a
//!   paired device. Append-only; the device strip reads the newest per peer.
//!
//! Shares are REAL in `0..=1`; `gpu_p95_share` is NULL when the platform could
//! not read GPU engines (never 0).

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "run_resource_summaries",
            description: "Measured per-run CPU/RAM/GPU summaries (append-only)",
            already_applied: |conn| has_table(conn, "run_resource_summaries"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS run_resource_summaries (
                        id TEXT PRIMARY KEY NOT NULL,
                        run_kind TEXT NOT NULL CHECK (run_kind IN ('fleet', 'execution')),
                        run_id TEXT NOT NULL,
                        persona_id TEXT,
                        responsibility_id TEXT,
                        cpu_p95_share REAL NOT NULL,
                        ram_peak_share REAL NOT NULL,
                        gpu_p95_share REAL,
                        dominant TEXT NOT NULL CHECK (dominant IN ('cpu', 'ram', 'gpu')),
                        samples INTEGER NOT NULL,
                        started_at_ms INTEGER NOT NULL,
                        ended_at_ms INTEGER NOT NULL,
                        UNIQUE (run_kind, run_id)
                     );
                     CREATE INDEX IF NOT EXISTS idx_run_resources_responsibility
                        ON run_resource_summaries(responsibility_id, ended_at_ms);
                     CREATE INDEX IF NOT EXISTS idx_run_resources_persona
                        ON run_resource_summaries(persona_id, ended_at_ms);",
                )
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "mesh_probe_results",
            description: "Device-mesh onboarding/probe verdicts per paired device (append-only)",
            already_applied: |conn| has_table(conn, "mesh_probe_results"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS mesh_probe_results (
                        id TEXT PRIMARY KEY NOT NULL,
                        peer_id TEXT NOT NULL,
                        test_id TEXT NOT NULL,
                        passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
                        detail TEXT,
                        at_ms INTEGER NOT NULL
                     );
                     CREATE INDEX IF NOT EXISTS idx_mesh_probe_peer
                        ON mesh_probe_results(peer_id, at_ms);",
                )
            },
        },
    )?;
    Ok(())
}
