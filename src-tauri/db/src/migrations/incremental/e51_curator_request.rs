//! `curator_request` - the operator's own lane into Curator.
//!
//! One table and one index, each in its own `run_step` probing the object it
//! itself creates, so a crash between the two resumes rather than records a lie
//! (census `unresumable-migration-step` is the opposite shape: one probe
//! guarding several DDL transactions).
//!
//! This is the OTHER direction from `curator_decision`. A decision is something
//! she raises and a person answers; a request is something a person writes and
//! she carries out. Modelling both as one table would make "she asked" and "she
//! was asked" the same row, and the answer to "what is she doing because I told
//! her to" would stop being a query.
//!
//! The three house properties `e43_council` established, all kept:
//!
//! - **Every closed set is a CHECK.** `state` is the only one here, and
//!   `personas_core::models::curator::CURATOR_REQUEST_STATES` spells it a
//!   second time as the array a door validates against BEFORE a write, so a
//!   refusal names the field rather than surfacing a SQLite constraint error
//!   (census `unchecked-closed-set-default`).
//! - **Every foreign key states ON DELETE.** There is none here, and that is
//!   deliberate rather than an omission - see `session_id` below.
//! - **No nullable-with-default column.** A DEFAULT fires only on an omitting
//!   INSERT; without NOT NULL it binds the writer and promises the reader
//!   nothing (census `nullable-default-column`). `state` is the only column
//!   carrying a DEFAULT and it is NOT NULL.
//!
//! ## The nullables, and why none of them is a zero
//!
//! Every nullable is an unknown that must not read as an absence, which is this
//! feature's governing rule:
//!
//! - `argument` - a bare-runnable skill takes none. Measured 2026-09-24,
//!   `hygiene`, `librarian` and `harvest` document a bare invocation and the
//!   other five do not, so NULL here is a real and common answer.
//! - `note` - the operator wrote none. Their words are carried into the
//!   worker's brief unchanged when they did, so an empty string and "they said
//!   nothing" must not collapse.
//! - `started_at` / `settled_at` - has not happened yet.
//! - `session_id` - she has not dispatched it yet.
//! - `outcome` / `result_ref` / `failure_reason` - the worker has not written
//!   a result, or wrote one that did not fail.
//!
//! ## `session_id` carries no foreign key, and that is the argued call
//!
//! `fleet_sessions` is a durable mirror of a PROCESS registry, and its rows are
//! reaped: `commands/fleet` deletes sessions the machine no longer has. A
//! `REFERENCES fleet_sessions(id)` here would give that reaper two bad choices
//! - CASCADE, which deletes the operator's request because a terminal was
//! cleaned up, or RESTRICT, which makes a stale request block the reap. The
//! request is the durable thing and the session is the ephemeral one, so the
//! link is recorded and not enforced. `result_ref` has the same shape for the
//! same reason: it names a path on disk, which no constraint can police.
//!
//! ## The index is the drain, and there is only one read that matters
//!
//! The lane is drained OLDEST-FIRST within `queued` - that ordering is the
//! operator's promise, not an implementation detail: a request they wrote first
//! runs first. `(state, created_at)` serves exactly that query and the count
//! beside it. No second index is added speculatively; the table is small by
//! construction (a person types into it) and an index nothing reads is a write
//! cost with no reader.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "curator_request",
            description: "One thing the operator asked Curator to run, in the order they wrote it",
            already_applied: |conn| has_table(conn, "curator_request"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_request (
                        id TEXT PRIMARY KEY NOT NULL,
                        skill TEXT NOT NULL,
                        argument TEXT,
                        note TEXT,
                        state TEXT NOT NULL DEFAULT 'queued'
                            CHECK (state IN ('queued','dispatched','landed','declined','failed',
                                'cancelled')),
                        created_at TEXT NOT NULL,
                        started_at TEXT,
                        settled_at TEXT,
                        session_id TEXT,
                        outcome TEXT,
                        result_ref TEXT,
                        failure_reason TEXT
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_request.lane_index",
            description: "Drain the lane oldest-first without sorting every request ever written",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_request")?
                    || has_index(conn, "idx_curator_request_lane")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_curator_request_lane
                     ON curator_request(state, created_at);",
                )
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::migrations::run(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        conn
    }

    fn insert(conn: &Connection, id: &str, state: Option<&str>) -> rusqlite::Result<usize> {
        match state {
            Some(state) => conn.execute(
                "INSERT INTO curator_request (id, skill, created_at, state)
                 VALUES (?1, 'hygiene', '2026-09-24T00:00:00Z', ?2)",
                rusqlite::params![id, state],
            ),
            None => conn.execute(
                "INSERT INTO curator_request (id, skill, created_at)
                 VALUES (?1, 'hygiene', '2026-09-24T00:00:00Z')",
                rusqlite::params![id],
            ),
        }
    }

    #[test]
    fn the_chain_creates_the_lane_and_its_index() {
        let conn = migrated_conn();
        assert!(has_table(&conn, "curator_request").unwrap());
        assert!(has_index(&conn, "idx_curator_request_lane").unwrap());
    }

    /// The boot path runs the chain on every start, so a step that is not
    /// idempotent fails the second launch rather than the first.
    #[test]
    fn the_chain_is_idempotent() {
        let conn = migrated_conn();
        crate::migrations::run_incremental(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        assert!(has_index(&conn, "idx_curator_request_lane").unwrap());
    }

    /// A request arrives QUEUED. Nothing a door forgets to set may land a row
    /// in a state Curator would treat as already in flight.
    #[test]
    fn an_omitting_insert_lands_queued() {
        let conn = migrated_conn();
        insert(&conn, "r1", None).unwrap();
        let state: String = conn
            .query_row(
                "SELECT state FROM curator_request WHERE id = 'r1'",
                [],
                |r| r.get("state"),
            )
            .unwrap();
        assert_eq!(state, "queued");
    }

    /// The store refuses a state outside the set whichever writer reaches it -
    /// the door validates first and names the field, but the CHECK is what
    /// holds when a second writer appears.
    #[test]
    fn the_store_refuses_a_state_outside_the_set() {
        let conn = migrated_conn();
        for state in personas_core::models::CURATOR_REQUEST_STATES {
            insert(&conn, &format!("ok-{state}"), Some(state)).unwrap();
        }
        assert!(insert(&conn, "bad", Some("running")).is_err());
        assert!(insert(&conn, "bad2", Some("")).is_err());
    }

    /// `state` is the only column with a DEFAULT and it is NOT NULL; every
    /// other column is either NOT NULL with no default or a plain nullable.
    /// Read off the declaration rather than probed with a write, for the reason
    /// `e50` gives: a rejected `UPDATE ... SET x = NULL` in a migration file is
    /// indistinguishable, to census `default-contradicted-by-backfill`, from
    /// the defect that rule exists to catch.
    #[test]
    fn no_column_is_nullable_with_a_default() {
        let conn = migrated_conn();
        let mut stmt = conn
            .prepare(
                "SELECT name, [notnull] AS not_null, dflt_value \
                 FROM pragma_table_info('curator_request')",
            )
            .unwrap();
        let rows: Vec<(String, i64, Option<String>)> = stmt
            .query_map([], |r| {
                Ok((r.get("name")?, r.get("not_null")?, r.get("dflt_value")?))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows.len(), 12, "the lane carries twelve columns");
        for (name, not_null, default) in &rows {
            if default.is_some() {
                assert_eq!(name, "state", "only `state` carries a DEFAULT");
                assert_eq!(*not_null, 1, "a defaulted column must be NOT NULL");
            }
        }
        let state = rows.iter().find(|(n, _, _)| n == "state").unwrap();
        assert_eq!(state.2.as_deref(), Some("'queued'"));
    }
}
