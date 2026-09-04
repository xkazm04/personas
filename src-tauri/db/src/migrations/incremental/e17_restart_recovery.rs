//! Restart classification for mid-run executions (registry technique
//! `session-continuation/stuck-loop-detection`, "The interruption that leaves
//! no signature"; golden path `os-process-reconciliation` §2(c) "At boot, do
//! not declare — classify").
//!
//! Two columns on `persona_executions`, no new table and no widening of
//! `ExecutionState`:
//!
//! * `recovery_state` — NULL for every row that has never been through a
//!   restart sweep, else `resume_pending` / `unproven` / `suspended`. The enum
//!   is deliberately NOT widened: `ExecutionState` crosses to TypeScript via
//!   ts-rs and is read by the execution list, the inspector, the replay
//!   sandbox and the lab, and it carries `TERMINAL`/`ACTIVE` slices plus a
//!   compile-time assertion test. A nullable column is the cheap shape, and
//!   the states it needs already exist in the enum: a re-admitted row is
//!   `queued` (the durable queue the re-admission path already drains), and a
//!   row nobody will resume is `incomplete` — which is what
//!   `sweep_zombie_executions` already uses for "ran, never finished, not a
//!   failure anyone observed".
//!
//! * `restart_count` — consecutive app restarts survived while this execution
//!   was still active. Distinct from `retry_count`, which counts *healing*
//!   retries of an observed failure; an involuntary interruption produces no
//!   failure signature, so it needs its own key. Reset to 0 by
//!   `exec_status_update` when a run completes, never when a resume begins.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.recovery_state",
            description: "Add recovery_state to persona_executions (restart classification)",
            already_applied: |conn| has_column(conn, "persona_executions", "recovery_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN recovery_state TEXT;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.restart_count",
            description: "Add restart_count to persona_executions (consecutive restarts survived)",
            already_applied: |conn| has_column(conn, "persona_executions", "restart_count"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions
                        ADD COLUMN restart_count INTEGER NOT NULL DEFAULT 0;",
                )
            },
        },
    )?;

    // Partial index: the surface query asks only for rows a restart touched,
    // and that is a rounding error against the executions table (74 of 2,188
    // on the 2026-08-17 backup). A full index would be mostly NULLs.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.idx_recovery_state",
            description:
                "Index persona_executions(recovery_state) for the unresolved-recovery surface",
            already_applied: |conn| has_index(conn, "idx_persona_executions_recovery_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_persona_executions_recovery_state
                        ON persona_executions(recovery_state)
                        WHERE recovery_state IS NOT NULL;",
                )
            },
        },
    )?;

    Ok(())
}
