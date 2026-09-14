//! The goal an idea serves (Grand Simulation gap G41).
//!
//! Measured 2026-09-10 by the Architect of the Bank: **0 of 432 `dev_tasks`
//! rows carried a `goal_id`, and `dev_ideas` had no goal column at all** — so
//! no work item in a workspace could ever advance a goal, and fourteen goals
//! sat at 0–20 % not because anyone chose badly but because nothing could
//! reach them. A goal was a document, not a target.
//!
//! One nullable column on `dev_ideas`. A filer names the goal its finding
//! serves (`propose_backlog.goal`), the task minted from that idea inherits it
//! (`dev_tasks.goal_id` already existed and was never written), and the
//! decision prompt prints how much work each goal has attached and finished.
//!
//! Nullable with no default: every idea filed before this ran served no goal
//! anyone recorded, and `''` would claim otherwise. No FK, like `use_case_id`
//! — a goal deleted later must not take its ideas with it, and the reader
//! treats a dangling id as "served a goal that no longer exists".
//!
//! Guarded with `has_table` / `has_column` like every other step here.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.goal_id",
            description: "Add goal_id to dev_ideas (the goal a finding serves, G41)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_ideas")? || has_column(conn, "dev_ideas", "goal_id")?)
            },
            apply: |conn| ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN goal_id TEXT;"),
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.goal_id.index",
            description: "Index dev_ideas(goal_id) for the per-goal work counts",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_ideas")? || has_index(conn, "idx_dev_ideas_goal_id")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_ideas_goal_id ON dev_ideas(goal_id);",
                )
            },
        },
    )
}
