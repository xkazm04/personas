//! The operator's global dispatch order (`fleet_autopilot.dispatch_order`) is
//! retired: the fleet dispatch queue (e36) is the only order there is.
//!
//! The setting was a JSON array of persona ids the attention tick walked
//! ahead of every unranked persona. With every autopilot start now admitted
//! through `queue::admit` and promoted in queue rank, a second, tick-side
//! order had two places to disagree about who goes first. The key's constant,
//! its validator, its command (`fleet_dispatch_order_set`) and the `rank`
//! column of the Orchestration ledger are gone; this step removes the row so
//! the settings audit stops listing a key nothing reads.
//!
//! `already_applied` is "no such row", which is also the postcondition — the
//! writer is deleted, so the row cannot come back.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// The retired key, spelled here rather than read from `settings_keys` — the
/// constant is deleted, and a migration must keep naming the row it removes.
const RETIRED_KEY: &str = "fleet_autopilot.dispatch_order";

fn row_absent(conn: &Connection) -> Result<bool, AppError> {
    if !has_table(conn, "app_settings")? {
        return Ok(true);
    }
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) AS n FROM app_settings WHERE key = ?1",
        [RETIRED_KEY],
        |r| r.get("n"),
    )?;
    Ok(present == 0)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "app_settings.retire_fleet_dispatch_order",
            description: "Delete the retired fleet_autopilot.dispatch_order setting (the queue is the only order)",
            already_applied: row_absent,
            apply: |conn| {
                conn.execute(
                    "DELETE FROM app_settings WHERE key = ?1",
                    [RETIRED_KEY],
                )?;
                Ok(())
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// The production schema (which has already run e37 once, on an empty
    /// table); the retired row is seeded RAW because `settings::set` refuses
    /// the key now that its constant is gone — exactly the state a database
    /// written before this step is in.
    fn pool_with_retired_row() -> Result<crate::DbPool, AppError> {
        let pool = init_test_db()?;
        pool.get()?.execute_batch(
            "INSERT INTO app_settings (key, value) VALUES
               ('fleet_autopilot.dispatch_order', '[\"p1\",\"p2\"]'),
               ('fleet_autopilot.max_parallel', '3');",
        )?;
        Ok(pool)
    }

    fn count(conn: &Connection, key: &str) -> Result<i64, AppError> {
        Ok(conn.query_row(
            "SELECT COUNT(*) AS n FROM app_settings WHERE key = ?1",
            [key],
            |r| r.get("n"),
        )?)
    }

    #[test]
    fn removes_the_retired_row_and_nothing_else() -> Result<(), AppError> {
        let pool = pool_with_retired_row()?;
        let conn = pool.get()?;
        assert!(!row_absent(&conn)?, "seeded row is present");
        run(&conn)?;
        assert_eq!(count(&conn, RETIRED_KEY)?, 0, "the retired row is gone");
        assert_eq!(
            count(&conn, "fleet_autopilot.max_parallel")?,
            1,
            "a neighbouring key is untouched"
        );
        assert!(row_absent(&conn)?, "postcondition reached");
        Ok(())
    }

    #[test]
    fn is_idempotent_and_tolerates_a_missing_table() -> Result<(), AppError> {
        let pool = pool_with_retired_row()?;
        let conn = pool.get()?;
        run(&conn)?;
        run(&conn)?;
        assert_eq!(count(&conn, RETIRED_KEY)?, 0, "a second run is a no-op");

        // No `app_settings` at all (a fresh file before the schema): nothing
        // to do, and no error — the probe answers "applied".
        let bare = Connection::open_in_memory()?;
        assert!(row_absent(&bare)?, "no table = nothing to do");
        run(&bare)?;
        Ok(())
    }
}
