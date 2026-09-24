//! `curator_dispatch` - the loop's own bookkeeping, and the unique index that
//! makes `curator_commit` countable.
//!
//! ## Why a table and not two columns
//!
//! The loop has to answer one question no existing row can: **which HEAD was
//! the registry on when I started this worker**. Without it the commit ledger
//! `e49` built cannot be written honestly - a `git log --since` window would
//! attribute a human's commit in the same minutes to Curator, and an audit row
//! that might be somebody else's work is worse than no row.
//!
//! The obvious shape was `head_at_dispatch` on `curator_request` AND on
//! `curator_plan_item`. It was rejected: both types are `#[ts(export)]`, so the
//! column lands on two client contracts that have nothing to do with this
//! bookkeeping, and the same fact would be spelled twice. One row per dispatch,
//! pointing at whichever lane produced it, spells it once and also gives the
//! tick the list it actually walks - "the dispatches I have not settled yet" -
//! which neither of those tables can answer without a session-state join.
//!
//! No `#[ts(export)]` model rides on this table, and that is the call `e49`
//! made for `curator_decision` and `curator_commit`: no command returns one, so
//! a binding would be dead surface. The day a console reads her dispatch log,
//! the door and the binding land together.
//!
//! ## The house properties, all kept
//!
//! - **Every closed set is a CHECK.** `lane` and `level_that_authorised`, both
//!   spelled a second time in `personas_core` (`curator_lane`,
//!   `CURATOR_DECISION_LEVELS`) as what a door validates against first.
//! - **Every foreign key states ON DELETE.** `request_id` and `plan_item_id`
//!   are both SET NULL: a dispatch OUTLIVES the row that motivated it, exactly
//!   as `curator_commit.decision_id` does, and an audit trail that vanished
//!   with a re-projected plan item is the record an audit needs most.
//! - **No nullable-with-default column.** None here carries a DEFAULT at all.
//!
//! `session_id` carries no foreign key for the reason `e51` argues at length:
//! `fleet_sessions` is a reaped mirror of a process registry, and the dispatch
//! is the durable half of the pair.
//!
//! ## The unique index on `curator_commit`
//!
//! `curator_commit` feeds `commits_today`, which is one of the three daily
//! brakes. Two of her terminals can be open on the same checkout, so two
//! settles can see overlapping `<head>..HEAD` ranges and report the same sha
//! twice. A double-counted commit moves a BRAKE, so the store refuses it rather
//! than trusting both writers to have deduplicated: `(project_slug, sha)` is
//! unique and the writer inserts OR IGNORE.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "curator_dispatch",
            description: "One worker Curator started, the lane that asked for it, and the \
                          registry HEAD it started from",
            already_applied: |conn| has_table(conn, "curator_dispatch"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_dispatch (
                        id TEXT PRIMARY KEY NOT NULL,
                        lane TEXT NOT NULL CHECK (lane IN ('queue','plan','refill')),
                        request_id TEXT
                            REFERENCES curator_request(id) ON DELETE SET NULL,
                        plan_item_id TEXT
                            REFERENCES curator_plan_item(id) ON DELETE SET NULL,
                        session_id TEXT NOT NULL,
                        skill TEXT NOT NULL,
                        argument TEXT,
                        level_that_authorised TEXT NOT NULL
                            CHECK (level_that_authorised IN ('L0','L1','L2','L3')),
                        repo_path TEXT NOT NULL,
                        head_at_dispatch TEXT,
                        created_at TEXT NOT NULL,
                        settled_at TEXT
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_dispatch.open_index",
            description: "Walk the dispatches nothing has settled yet without scanning her \
                          whole history every tick",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_dispatch")?
                    || has_index(conn, "idx_curator_dispatch_open")?)
            },
            apply: |conn| {
                // The tick's one read: every row with no `settled_at`, oldest
                // first. A partial index would be tighter, but the whole table
                // is bounded by her run cap and this one also serves the
                // history read a console will want.
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_curator_dispatch_open
                     ON curator_dispatch(settled_at, created_at);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_commit.sha_unique",
            description: "One commit is one row: a sha counted twice moves a daily brake",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_commit")?
                    || has_index(conn, "idx_curator_commit_sha")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_curator_commit_sha
                     ON curator_commit(project_slug, sha);",
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

    fn insert_dispatch(
        conn: &Connection,
        id: &str,
        lane: &str,
        level: &str,
    ) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO curator_dispatch
                (id, lane, session_id, skill, level_that_authorised, repo_path, created_at)
             VALUES (?1, ?2, 's1', 'harvest', ?3, 'C:/registry', '2026-09-24T00:00:00Z')",
            rusqlite::params![id, lane, level],
        )
    }

    fn insert_commit(conn: &Connection, id: &str, sha: &str) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO curator_commit
                (id, project_slug, repo_path, branch, sha, files_json,
                 level_that_authorised, created_at)
             VALUES (?1, 'ai-registry', 'C:/registry', 'master', ?2, '[]', 'L2',
                     '2026-09-24T00:00:00Z')",
            rusqlite::params![id, sha],
        )
    }

    #[test]
    fn the_chain_creates_the_ledger_and_both_indexes() {
        let conn = migrated_conn();
        assert!(has_table(&conn, "curator_dispatch").unwrap());
        assert!(has_index(&conn, "idx_curator_dispatch_open").unwrap());
        assert!(has_index(&conn, "idx_curator_commit_sha").unwrap());
    }

    /// The boot path runs the chain on every start, so a step that is not
    /// idempotent fails the second launch rather than the first.
    #[test]
    fn the_chain_is_idempotent() {
        let conn = migrated_conn();
        crate::migrations::run_incremental(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        assert!(has_index(&conn, "idx_curator_dispatch_open").unwrap());
    }

    /// Both closed sets hold at the store, whichever writer reaches them.
    #[test]
    fn the_store_refuses_a_lane_or_a_level_outside_its_set() {
        let conn = migrated_conn();
        for lane in ["queue", "plan", "refill"] {
            insert_dispatch(&conn, &format!("ok-{lane}"), lane, "L0").unwrap();
        }
        for level in personas_core::models::CURATOR_DECISION_LEVELS {
            insert_dispatch(&conn, &format!("lvl-{level}"), "queue", level).unwrap();
        }
        // `sleep` is a real lane of HERS, and deliberately not a dispatch lane:
        // the reconcile pass starts no worker.
        assert!(insert_dispatch(&conn, "bad-lane", "sleep", "L0").is_err());
        assert!(insert_dispatch(&conn, "bad-level", "queue", "L9").is_err());
    }

    /// The brake's correctness rests on this: the same commit seen by two
    /// settles is one row, not two.
    #[test]
    fn the_same_sha_cannot_be_counted_twice() {
        let conn = migrated_conn();
        insert_commit(&conn, "c1", "abc1234").unwrap();
        assert!(
            insert_commit(&conn, "c2", "abc1234").is_err(),
            "a second row for one sha would double-count against the daily commit cap"
        );
        // A different sha is fine, and so is the same sha in a different repo.
        insert_commit(&conn, "c3", "def5678").unwrap();
        conn.execute(
            "INSERT INTO curator_commit
                (id, project_slug, repo_path, branch, sha, files_json,
                 level_that_authorised, created_at)
             VALUES ('c4', 'other', 'C:/other', 'master', 'abc1234', '[]', 'L2',
                     '2026-09-24T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    /// A dispatch outlives the row that motivated it. Deleting the plan run
    /// (which CASCADEs to its items) must leave the audit trail standing.
    #[test]
    fn a_dispatch_outlives_the_plan_item_that_motivated_it() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO curator_plan_run
                (id, created_at, scan_generated_at, corpus_json, consumers_json,
                 policy_json, item_count)
             VALUES ('run1', '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z', '{}', '{}', '{}', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO curator_plan_item
                (id, plan_run_id, subject_id, domain, at, points, reasons_json,
                 dominant_reason, engine, techniques, applications, demand_known, updated_at)
             VALUES ('item1', 'run1', 'd/s', 'd', 'a', 5, '[]', 'deviation', 'conform',
                     1, 1, 0, '2026-09-24T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO curator_dispatch
                (id, lane, plan_item_id, session_id, skill, level_that_authorised,
                 repo_path, created_at)
             VALUES ('d1', 'plan', 'item1', 's1', 'reconcile', 'L2', 'C:/registry',
                     '2026-09-24T00:00:00Z')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM curator_plan_run WHERE id = 'run1'", [])
            .unwrap();

        let (n, item): (i64, Option<String>) = conn
            .query_row(
                "SELECT COUNT(id), MAX(plan_item_id) FROM curator_dispatch WHERE id = 'd1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(n, 1, "the dispatch survives the plan it came from");
        assert_eq!(item, None, "and forgets the item rather than dangling");
    }

    /// No column here is nullable-with-a-default. Read off the declaration for
    /// `e51`'s reason.
    #[test]
    fn no_column_is_nullable_with_a_default() {
        let conn = migrated_conn();
        let mut stmt = conn
            .prepare(
                "SELECT name, [notnull] AS not_null, dflt_value \
                 FROM pragma_table_info('curator_dispatch')",
            )
            .unwrap();
        let rows: Vec<(String, i64, Option<String>)> = stmt
            .query_map([], |r| {
                Ok((r.get("name")?, r.get("not_null")?, r.get("dflt_value")?))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows.len(), 12, "the ledger carries twelve columns");
        for (name, _, default) in &rows {
            assert!(default.is_none(), "`{name}` must carry no DEFAULT");
        }
    }
}
