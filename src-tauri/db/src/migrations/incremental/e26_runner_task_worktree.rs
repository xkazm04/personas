//! Where a runner task actually executed (Grand Simulation gap G12,
//! `docs/architecture/grand-simulation.md` §3).
//!
//! Three nullable columns on `dev_tasks`, one question each:
//!
//! * `worktree_path` — the directory the CLI was spawned in. Always written
//!   once a run starts, **including on the fallback**, so the row answers
//!   "where did this run touch files" without a second lookup.
//! * `worktree_branch` — `autopilot/<slug>`, the branch that worktree is
//!   checked out on. `NULL` ⟺ the run was not isolated.
//! * `worktree_fallback_reason` — why isolation was refused (the project root
//!   is not a git work tree, the app data dir is unreadable, …).
//!   `NULL` ⟺ the run WAS isolated.
//!
//! The last two are deliberately mirror images rather than one status column:
//! a reader that only knows about `worktree_branch` still reads the isolated
//! case correctly, and the fallback can never be silent — a row with a path and
//! neither of the other two is a task that predates this migration, not a task
//! that quietly ran in the operator's checkout.
//!
//! Nullable with no `NOT NULL DEFAULT ''`: every task written before G12 ran in
//! the project root and there is no honest value to backfill. `''` would claim
//! we know something about those rows that we do not.
//!
//! Guarded with `has_table` / `has_column` like every other step here — the
//! chain has no version table, so each step probes its own postcondition and
//! must survive an unbounded number of replays.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_tasks.worktree_path",
            description: "Add worktree_path to dev_tasks (runner task isolation, G12)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_tasks")?
                    || has_column(conn, "dev_tasks", "worktree_path")?)
            },
            apply: |conn| ddl_step(conn, "ALTER TABLE dev_tasks ADD COLUMN worktree_path TEXT;"),
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_tasks.worktree_branch",
            description: "Add worktree_branch to dev_tasks (runner task isolation, G12)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_tasks")?
                    || has_column(conn, "dev_tasks", "worktree_branch")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_tasks ADD COLUMN worktree_branch TEXT;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_tasks.worktree_fallback_reason",
            description: "Add worktree_fallback_reason to dev_tasks (runner task isolation, G12)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_tasks")?
                    || has_column(conn, "dev_tasks", "worktree_fallback_reason")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_tasks ADD COLUMN worktree_fallback_reason TEXT;",
                )
            },
        },
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three columns exist, are NULLABLE (a pre-G12 task claims nothing
    /// about where it ran), and a replay is a no-op that keeps its rows.
    #[test]
    fn worktree_columns_are_nullable_and_idempotent() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, title, status, worktree_path, worktree_branch)
             VALUES ('t-iso', 'Isolated', 'completed', 'C:/data/worktrees/p/fix', 'autopilot/fix')",
            [],
        )?;
        conn.execute(
            "INSERT INTO dev_tasks (id, title, status, worktree_path, worktree_fallback_reason)
             VALUES ('t-fb', 'Fell back', 'completed', 'C:/repo', 'not a git work tree')",
            [],
        )?;
        conn.execute(
            "INSERT INTO dev_tasks (id, title, status) VALUES ('t-old', 'Pre-G12', 'completed')",
            [],
        )?;

        let old: Option<String> = conn.query_row(
            "SELECT worktree_path FROM dev_tasks WHERE id = 't-old'",
            [],
            |r| r.get("worktree_path"),
        )?;
        assert!(
            old.is_none(),
            "a task written before G12 claims nothing about where it ran"
        );

        // The two isolation columns are mirror images: exactly one is set.
        let branch: Option<String> = conn.query_row(
            "SELECT worktree_branch FROM dev_tasks WHERE id = 't-iso'",
            [],
            |r| r.get("worktree_branch"),
        )?;
        let reason: Option<String> = conn.query_row(
            "SELECT worktree_fallback_reason FROM dev_tasks WHERE id = 't-iso'",
            [],
            |r| r.get("worktree_fallback_reason"),
        )?;
        assert_eq!(branch.as_deref(), Some("autopilot/fix"));
        assert!(reason.is_none(), "an isolated run has no fallback reason");

        super::run(&conn).expect("e26 second run");
        super::run(&conn).expect("e26 third run");
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM dev_tasks WHERE worktree_branch = 'autopilot/fix'",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(n, 1, "the replay keeps the row it found");
        Ok(())
    }
}
