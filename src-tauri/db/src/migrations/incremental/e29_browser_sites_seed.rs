//! One example Whitelist row — `http://localhost:3000`, seeded ONCE.
//!
//! The Whitelist is deny-by-default and starts empty, which is correct and
//! also the least teachable state a feature can ship in: the operator opens
//! Browser > Whitelist, sees nothing, and has to guess what an entry even
//! looks like. So the table gets exactly one row — the origin a local dev
//! server is on — as a worked example they can read, edit, or delete.
//!
//! **It must be removable, permanently.** That is the whole constraint, and
//! it is why the step's postcondition is NOT "the row exists": probing for
//! the row would re-insert it on the next boot after the operator deleted
//! it, which is the app arguing with the operator once per launch. The
//! postcondition is a marker in `app_settings` —
//! [`SEED_MARKER`] — the same key-value table `damage.rs:316` writes its
//! detach marker into. Deleting the row leaves the marker, so the seed never
//! comes back; only a database that never ran this step gets one.
//!
//! `app_settings` is created by the base schema (`migrations/schema.rs:603`),
//! which `migrations::run` applies before `run_incremental`, so the marker's
//! table is always there by the time this runs.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// The `app_settings` key that records "this database has been offered the
/// example row". Its presence, not the row's, is the step's postcondition.
const SEED_MARKER: &str = "browser_sites_seeded";

/// The example origin. Already in the normalised form
/// `personas_core::models::normalize_site_origin` produces, so the row is
/// byte-identical to one the operator could have typed.
const SEED_ORIGIN: &str = "http://localhost:3000";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "browser_sites_seed",
            description:
                "Browser control: one removable example Whitelist row (http://localhost:3000)",
            already_applied: |conn| has_setting(conn, SEED_MARKER),
            apply: |conn| {
                // `INSERT OR IGNORE`: an operator who already added this
                // origin by hand keeps their row (their label, their budget,
                // their bound credential), and the marker still lands so the
                // seed is never offered twice.
                ddl_step(
                    conn,
                    "INSERT OR IGNORE INTO browser_sites
                         (origin, label, enabled, overrides, budget, credential_id,
                          scan_status, scan_tier, scan_report, scan_at,
                          first_seen, last_seen, created_by)
                     VALUES ('http://localhost:3000', 'Local dev (example)', 1, '{}', 50, NULL,
                             'none', NULL, NULL, NULL,
                             CAST(strftime('%s','now') AS INTEGER) * 1000,
                             CAST(strftime('%s','now') AS INTEGER) * 1000,
                             'operator');
                     INSERT INTO app_settings (key, value, updated_at)
                     VALUES ('browser_sites_seeded', '1', datetime('now'))
                     ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now');",
                )?;
                Ok(())
            },
        },
    )?;

    Ok(())
}

fn has_setting(conn: &Connection, key: &str) -> Result<bool, AppError> {
    let count = conn.query_row(
        "SELECT COUNT(*) FROM app_settings WHERE key = ?1",
        [key],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_rows(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM browser_sites WHERE origin = ?1",
            [SEED_ORIGIN],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// The property the marker buys, start to finish: seeded once, replaying
    /// the chain is a no-op, and a row the operator deleted STAYS deleted.
    #[test]
    fn the_seed_lands_once_and_a_deleted_row_is_never_re_inserted() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();

        // Converge on "never seeded" regardless of what the shared test
        // template already ran, so the assertions below are about THIS step.
        conn.execute("DELETE FROM app_settings WHERE key = ?1", [SEED_MARKER])
            .unwrap();
        conn.execute("DELETE FROM browser_sites WHERE origin = ?1", [SEED_ORIGIN])
            .unwrap();

        run(&conn).unwrap();
        assert_eq!(seed_rows(&conn), 1, "the first run seeds the example");
        let (label, enabled, created_by): (String, i64, String) = conn
            .query_row(
                "SELECT label, enabled, created_by FROM browser_sites WHERE origin = ?1",
                [SEED_ORIGIN],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(label, "Local dev (example)");
        assert_eq!(enabled, 1, "the example is usable, not a paused stub");
        assert_eq!(created_by, "operator");

        // Replaying the boot chain does not duplicate or rewrite it.
        run(&conn).unwrap();
        assert_eq!(seed_rows(&conn), 1);

        // The operator deletes it. Every later boot must leave it gone.
        conn.execute("DELETE FROM browser_sites WHERE origin = ?1", [SEED_ORIGIN])
            .unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert_eq!(
            seed_rows(&conn),
            0,
            "a deleted example row must stay deleted — the marker, not the \
             row, is this step's postcondition"
        );
    }

    /// An origin the operator already added by hand is theirs, not the
    /// seed's: the insert must not overwrite their label or their `enabled`.
    #[test]
    fn an_existing_row_on_the_seed_origin_survives_untouched() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute("DELETE FROM app_settings WHERE key = ?1", [SEED_MARKER])
            .unwrap();
        conn.execute("DELETE FROM browser_sites WHERE origin = ?1", [SEED_ORIGIN])
            .unwrap();
        conn.execute(
            "INSERT INTO browser_sites
                 (origin, label, enabled, overrides, budget, scan_status,
                  first_seen, last_seen, created_by)
             VALUES (?1, 'My dev server', 0, '{}', 7, 'none', 1, 1, 'operator')",
            [SEED_ORIGIN],
        )
        .unwrap();

        run(&conn).unwrap();

        let (label, budget): (String, i64) = conn
            .query_row(
                "SELECT label, budget FROM browser_sites WHERE origin = ?1",
                [SEED_ORIGIN],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(label, "My dev server");
        assert_eq!(budget, 7);
        assert!(has_setting(&conn, SEED_MARKER).unwrap());
    }
}
