//! Charter mirror (2026-10-15, spark `mandate-lanes`, WP9).
//!
//! A paired peer's read-only copy of the mandates whose HOME is another
//! device (see `personas_core::models::charter_mirror` for the home rule and
//! the two streams). Two tables, deliberately apart from
//! `persona_responsibilities` / `charter_acts`: nothing that reads this
//! device's own charters (the router, the sweep, the re-read law, the
//! orphanage) can see a mirrored one, so a peer can never file an item under
//! a mandate it does not own.
//!
//! * `mirrored_charters`: one row per mirrored charter, the latest summary
//!   the home sent (latest `home_sent_at_ms` wins).
//! * `mirrored_charter_acts`: the acts the home sent, keyed by the act id the
//!   home minted, so a re-delivered act is a no-op. `reverted` is the one
//!   field allowed to move (0 -> 1), as it does at home.
//!
//! FK-less: the charter rows they would point at live on another device.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "charter_mirror",
            description: "Create mirrored_charters and mirrored_charter_acts (mandates mirrored from a paired home device)",
            already_applied: |conn| {
                Ok(has_table(conn, "mirrored_charters")?
                    && has_table(conn, "mirrored_charter_acts")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS mirrored_charters (
                        charter_id      TEXT PRIMARY KEY NOT NULL,
                        home_peer_id    TEXT NOT NULL,
                        home_name       TEXT NOT NULL,
                        summary_json    TEXT NOT NULL,
                        home_sent_at_ms REAL NOT NULL,
                        mirrored_at     TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS mirrored_charter_acts (
                        id           TEXT PRIMARY KEY NOT NULL,
                        charter_id   TEXT NOT NULL,
                        home_peer_id TEXT NOT NULL,
                        act_json     TEXT NOT NULL,
                        created_at   TEXT NOT NULL,
                        reverted     INTEGER NOT NULL DEFAULT 0 CHECK (reverted IN (0, 1))
                    );
                    CREATE INDEX IF NOT EXISTS idx_mirrored_charter_acts_charter
                        ON mirrored_charter_acts(charter_id, created_at);",
                )
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_tables_once() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert!(has_table(&conn, "mirrored_charters").unwrap());
        assert!(has_table(&conn, "mirrored_charter_acts").unwrap());
        assert!(has_index(&conn, "idx_mirrored_charter_acts_charter").unwrap());
    }
}
