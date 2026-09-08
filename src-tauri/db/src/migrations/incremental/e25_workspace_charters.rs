//! Workspace-bound charters (Grand Simulation gap G1,
//! `docs/architecture/grand-simulation.md` §3).
//!
//! One nullable column and one index on `persona_responsibilities`:
//!
//! * `workspace_id` — the `dev_workspaces` row a CROSS-PROJECT charter binds
//!   to. Every persona until now bound to at most one project, and
//!   App-Master-ness was defined as *holds a charter with a non-empty
//!   `project_id`*; the Architect holds the whole workspace instead, so its
//!   charters need a binding the project column cannot express.
//!
//! Nullable, and no `NOT NULL DEFAULT ''`: an unbound charter and a
//! workspace-bound one must stay distinguishable, and `''` would make every
//! hand-authored charter look like it names a workspace nobody created.
//! Mutual exclusion with `project_id` is enforced at the intake door
//! (`personas_engine::responsibility::validate`), not by a CHECK — adding a
//! CHECK here would be a table rebuild, and the existing rows it would judge
//! were written before the column existed.
//!
//! The index mirrors `idx_pr_persona_status` from `e16`: the workspace reads
//! are "every charter bound to THIS workspace", which is the shape a plain
//! column index answers.
//!
//! Guarded with `has_column` / `has_index` over `has_table`, because
//! `init_test_db` drops `persona_responsibilities` in the TEST binary and an
//! unguarded ALTER there is a crash, not a migration.
//!
//! Numbered `e25` rather than `e24`: two concurrent sessions had already
//! claimed that ordinal (`e24_workspace_protection`, `e24_channel_authority`).
//! The ordinal is a filename, not a version — every step probes its own
//! postcondition — so the skip costs nothing and the collision would have.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.workspace_id",
            description:
                "Add workspace_id to persona_responsibilities (cross-project charters, G1)",
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_responsibilities")?
                    || has_column(conn, "persona_responsibilities", "workspace_id")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_responsibilities ADD COLUMN workspace_id TEXT;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.workspace_id.index",
            description: "Index persona_responsibilities(workspace_id, status)",
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_responsibilities")?
                    || !has_column(conn, "persona_responsibilities", "workspace_id")?
                    || has_index(conn, "idx_pr_workspace_status")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_pr_workspace_status
                         ON persona_responsibilities(workspace_id, status);",
                )
            },
        },
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The column exists, is NULLABLE (an unbound charter is not a
    /// workspace-bound one), the index is there, and a replay is a no-op that
    /// keeps the rows written before it.
    #[test]
    fn workspace_column_is_nullable_indexed_and_idempotent() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p1', 'p1', 'sp', datetime('now'), datetime('now'))",
            [],
        )?;
        conn.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, workspace_id, created_at, updated_at)
             VALUES ('r-ws', 'p1', 'Design the bank', 'ws-1', datetime('now'), datetime('now'))",
            [],
        )?;
        conn.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, created_at, updated_at)
             VALUES ('r-free', 'p1', 'Unbound', datetime('now'), datetime('now'))",
            [],
        )?;
        let unbound: Option<String> = conn.query_row(
            "SELECT workspace_id FROM persona_responsibilities WHERE id = 'r-free'",
            [],
            |r| r.get("workspace_id"),
        )?;
        assert!(unbound.is_none(), "an unbound charter names no workspace");
        assert!(has_index(&conn, "idx_pr_workspace_status")?);

        super::run(&conn).expect("e25 second run");
        super::run(&conn).expect("e25 third run");
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM persona_responsibilities WHERE workspace_id = 'ws-1'",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(n, 1, "the replay keeps the row it found");
        Ok(())
    }
}
