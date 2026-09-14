//! `execution_traces` leaves with its execution.
//!
//! `execution_traces` is keyed on `execution_id` but was created with no
//! foreign key, and no code path ever deleted a trace. Every way an execution
//! row goes away — the hourly retention sweep, the Storage prune, a single
//! delete, the test-env reset script — therefore left its trace behind.
//! Measured on the operator's database 2026-09-14: **2,942 of 2,946 trace rows
//! (32.4 MB, mostly the `spans` JSON) belonged to executions that no longer
//! existed.**
//!
//! Adding the missing FK would mean rebuilding the table. A trigger gives the
//! same guarantee without one, and it is stronger than a declared cascade in the
//! one way that has bitten this repo before: it fires whatever the connection's
//! `PRAGMA foreign_keys` says (`persona_tool_usage` accumulated 980 orphans under
//! a declared `ON DELETE CASCADE` because some deletes ran with FKs off). It
//! rides `idx_et_execution`, so the per-row cost is one index seek.
//!
//! The step also scrubs the backlog once, in the same transaction that installs
//! the trigger — after that the trigger keeps the table honest and the scrub has
//! nothing left to do.
//!
//! Guarded on the trigger's existence, so a table rebuild that drops triggers
//! (see `support::rebuild_executions_table_with_incomplete_status`) simply
//! re-arms it on the next boot.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// Name of the satellite-cleanup trigger. Exposed to the crate so tests and
/// diagnostics name it instead of re-typing it.
pub(crate) const TRACE_CASCADE_TRIGGER: &str = "execution_traces_ad";

fn has_trigger(conn: &Connection, name: &str) -> Result<bool, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
        [name],
        |row| row.get("n"),
    )?;
    Ok(count > 0)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "execution_traces.delete_with_execution",
            description: "Delete an execution's traces with it (trigger) and scrub orphaned traces",
            already_applied: |conn| {
                Ok(!has_table(conn, "execution_traces")?
                    || !has_table(conn, "persona_executions")?
                    || has_trigger(conn, TRACE_CASCADE_TRIGGER)?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TRIGGER IF NOT EXISTS execution_traces_ad
                     AFTER DELETE ON persona_executions BEGIN
                         DELETE FROM execution_traces WHERE execution_id = old.id;
                     END;
                     DELETE FROM execution_traces
                      WHERE execution_id NOT IN (SELECT id FROM persona_executions);",
                )
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::execution::traces;
    use crate::PoolExt;
    use personas_core::trace::ExecutionTrace;

    fn seed_execution(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p-trace', 'Trace Test', 'sp', datetime('now'), datetime('now'))
             ON CONFLICT(id) DO NOTHING",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO persona_executions (id, persona_id, status, created_at)
             VALUES (?1, 'p-trace', 'completed', datetime('now'))",
            [id],
        )
        .unwrap();
    }

    fn trace_for(execution_id: &str) -> ExecutionTrace {
        ExecutionTrace {
            trace_id: format!("trace-{execution_id}"),
            execution_id: execution_id.to_string(),
            persona_id: "p-trace".to_string(),
            chain_trace_id: None,
            spans: Vec::new(),
            total_duration_ms: Some(1),
            evicted_span_count: 0,
            created_at: "2026-09-14T00:00:00Z".to_string(),
        }
    }

    fn trace_count(conn: &Connection, execution_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) AS n FROM execution_traces WHERE execution_id = ?1",
            [execution_id],
            |r| r.get("n"),
        )
        .unwrap()
    }

    /// The measurable: deleting an execution — through any path, here a bare
    /// DELETE with foreign keys OFF, the shape the test-env reset script uses —
    /// takes its traces with it, and a live execution's trace survives.
    #[test]
    fn deleting_an_execution_deletes_its_traces_even_with_foreign_keys_off() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.conn("e28::tests").unwrap();
        seed_execution(&conn, "e-gone");
        seed_execution(&conn, "e-live");
        traces::save(&pool, &trace_for("e-gone")).unwrap();
        traces::save(&pool, &trace_for("e-live")).unwrap();

        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute("DELETE FROM persona_executions WHERE id = 'e-gone'", [])
            .unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        assert_eq!(
            trace_count(&conn, "e-gone"),
            0,
            "the trace left with its execution"
        );
        assert_eq!(
            trace_count(&conn, "e-live"),
            1,
            "a live execution keeps its trace"
        );
    }

    /// A database that predates the trigger carries orphans; the step scrubs
    /// them once, keeps live traces, and a replay is a no-op.
    #[test]
    fn the_step_scrubs_orphans_left_before_the_trigger_existed() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.conn("e28::tests").unwrap();
        conn.execute_batch("DROP TRIGGER IF EXISTS execution_traces_ad;")
            .unwrap();
        seed_execution(&conn, "e-live");
        traces::save(&pool, &trace_for("e-live")).unwrap();
        traces::save(&pool, &trace_for("e-never-existed")).unwrap();
        assert_eq!(trace_count(&conn, "e-never-existed"), 1);

        run(&conn).expect("first run installs the trigger and scrubs");
        assert_eq!(trace_count(&conn, "e-never-existed"), 0);
        assert_eq!(trace_count(&conn, "e-live"), 1);
        assert!(has_trigger(&conn, TRACE_CASCADE_TRIGGER).unwrap());

        run(&conn).expect("replay");
        assert_eq!(
            trace_count(&conn, "e-live"),
            1,
            "the replay keeps live traces"
        );
    }
}
