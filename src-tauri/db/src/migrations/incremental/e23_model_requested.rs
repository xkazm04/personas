//! The model the run DECIDED on, kept apart from the model that SERVED it.
//!
//! One nullable column on `persona_executions`:
//!
//! * `model_requested` — the `--model` value the CLI was actually spawned
//!   with, stamped once by `set_launch_model_info` and never rewritten.
//!
//! Why a second column rather than a second read of the first. `model_used`
//! carries the SERVED name: `set_model_used_actual` overwrites it from the
//! stream's `system/init` event, and that overwrite is deliberate and
//! documented as authoritative *"(covers account-default runs and
//! provider-side aliasing)"*. The docstring names the exact case the
//! conflation then makes undetectable — if the provider aliases
//! `claude-sonnet-4-5` onto something else, the row afterwards holds only the
//! alias and the decision is gone. Two columns make the mismatch a fact on the
//! row instead of an inference nobody can make.
//!
//! Write-once, and enforced in SQL rather than by convention: the write is
//! `model_requested = COALESCE(model_requested, ?)`, so the resume and
//! failover paths — which re-enter the same launch stamp on the SAME execution
//! row — cannot overwrite the original decision.
//!
//! Nullable, and it stays that way. Every row written before this column
//! existed has no decided model, and there is nothing to backfill it from:
//! `model_used` on a historical row may be either fact and the row does not
//! say which. A backfill would manufacture exactly the certainty this column
//! exists to stop manufacturing.
//!
//! No index. There is no reader yet that filters or groups on it; the first
//! query that does (a decided-vs-served mismatch count) will scan a window
//! `metrics` already scans on `created_at`.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.model_requested",
            description:
                "Add model_requested to persona_executions (the decided model, written once)",
            already_applied: |conn| has_column(conn, "persona_executions", "model_requested"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN model_requested TEXT;",
                )
            },
        },
    )?;

    Ok(())
}
