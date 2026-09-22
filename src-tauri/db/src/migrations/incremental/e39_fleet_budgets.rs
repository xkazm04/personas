//! Budgeted admission's durable half: five nullable columns on
//! `fleet_sessions`.
//!
//! The dispatch queue (e36) bounds the fleet by a session count. Budgeted
//! admission (`commands::fleet::budgets`) also charges each session two
//! resource budgets, so the row has to remember what it was charged - a
//! restart rebuilds "what is the live set costing" and "which queued entry has
//! been passed over how often" from these columns:
//!
//! - `machine_units`, `plan_units`, `gpu_class` - the charge, stamped at
//!   admission (enqueue or immediate start) and never nulled afterwards;
//! - `skip_count`, `first_unfit_at_ms` - the aging bound's memory: how many
//!   times promotion backfilled past this entry and since when it has not fit.
//!
//! All nullable: every pre-budget row reads as "charged the default" (one
//! machine unit, two plan units, no GPU) and "never skipped". No index - the
//! reads are over the queued / live handful the e36 partial index and the
//! in-memory registry already serve.
//!
//! The brief called this step e37; e37 and e38 were taken on master
//! (`dispatch_order_retired`, `project_enabled`), so it is e39.
//!
//! Guarded per column with `has_column` (idempotent column by column, so a
//! half-applied run resumes), exactly like e36.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// `(column, SQL type)` - in the order the repo's `COLUMNS` projection names
/// them.
const BUDGET_COLUMNS: &[(&str, &str)] = &[
    ("machine_units", "INTEGER"),
    ("plan_units", "INTEGER"),
    ("gpu_class", "TEXT"),
    ("skip_count", "INTEGER"),
    ("first_unfit_at_ms", "INTEGER"),
];

fn every_budget_column_present(conn: &Connection) -> Result<bool, AppError> {
    if !has_table(conn, "fleet_sessions")? {
        return Ok(true);
    }
    for (column, _) in BUDGET_COLUMNS {
        if !has_column(conn, "fleet_sessions", column)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn add_missing_budget_columns(conn: &Connection) -> Result<(), AppError> {
    for (column, ddl_type) in BUDGET_COLUMNS {
        if has_column(conn, "fleet_sessions", column)? {
            continue;
        }
        ddl_step(
            conn,
            &format!("ALTER TABLE fleet_sessions ADD COLUMN {column} {ddl_type};"),
        )?;
    }
    Ok(())
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "fleet_sessions.budget_columns",
            description: "Add the budgeted-admission columns (charge, skip count, first-unfit stamp) to fleet_sessions",
            already_applied: every_budget_column_present,
            apply: add_missing_budget_columns,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The boot chain replays on every launch: the columns must exist after
    /// one run, a replay must be a no-op, and a half-applied step (some
    /// columns present, some not) must resume rather than fail.
    #[test]
    fn fleet_budget_columns_land_idempotently_and_resume_a_half_applied_run() -> Result<(), AppError>
    {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        for (column, _) in BUDGET_COLUMNS {
            assert!(
                has_column(&conn, "fleet_sessions", column)?,
                "{column} missing after init"
            );
        }
        assert!(every_budget_column_present(&conn)?);
        run(&conn)?;

        // Half-applied: drop two of the five and replay.
        conn.execute_batch(
            "ALTER TABLE fleet_sessions DROP COLUMN skip_count;
             ALTER TABLE fleet_sessions DROP COLUMN first_unfit_at_ms;",
        )?;
        assert!(!every_budget_column_present(&conn)?);
        run(&conn)?;
        assert!(every_budget_column_present(&conn)?);

        // Existing rows read NULL in every new column.
        conn.execute(
            "INSERT INTO fleet_sessions
                (id, claude_session_id, cwd, project_label, args_json, mode, state,
                 created_at_ms, last_activity_ms, updated_at_ms)
             VALUES ('s1', 'c1', 'C:/tmp', 'p', '[]', 'headless', 'running', 1, 1, 1)",
            [],
        )?;
        let nulls: i64 = conn.query_row(
            "SELECT COUNT(id) AS n FROM fleet_sessions
             WHERE machine_units IS NULL AND plan_units IS NULL AND gpu_class IS NULL
               AND skip_count IS NULL AND first_unfit_at_ms IS NULL",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(nulls, 1);
        Ok(())
    }
}
