//! `curator_plan_run.quiet_json` - the tail the projection does not plan.
//!
//! `e49`'s projection makes a plan item only for a subject the scan scored
//! above zero (`projection.rs`), so the 170 subjects of the 2026-09-22 corpus
//! that score nothing have **no row anywhere in this system**. They are not
//! noise: `software-engineering/table` scores 0 and holds 16 stale verdicts
//! across 6 projects, which is the largest consumer gap in the estate sitting
//! in the tail the instrument calls empty.
//!
//! This column carries them as per-bundle counts beside the run's other two
//! projections (`corpus_json`, `consumers_json`), so a surface can say "wanting
//! nothing is a fact about the subject" rather than leaving them out and
//! calling the remainder the corpus. **It does not change the ranking**: a
//! quiet subject is still not a plan item and still scores no points.
//!
//! ## `NOT NULL DEFAULT '[]'`, and the one thing that default cannot say
//!
//! `stacks_json` set the house precedent in `e49`: an empty inventory is `[]`,
//! never absent. It holds here for every run written from `e50` onward.
//!
//! It does **not** hold for a run written BEFORE this column existed. Those
//! rows take the default, and `[]` there means "never measured", not "nothing
//! is quiet" - which is the exact confusion this whole column was added to
//! end. Rather than paper over it with a nullable column the wire type has no
//! way to express, the two are told apart by an invariant the run already
//! carries:
//!
//! ```text
//! sum(quiet[].subjects) + item_count == corpus.subjects
//! ```
//!
//! Every projection from `e50` onward satisfies it (the projection's own test
//! asserts 170 + 301 == 471 on the real corpus). A pre-`e50` run reports
//! `0 + 301 != 471` and is therefore self-identifying as unmeasured. A
//! re-projection - `curator_plan_refresh`, which supersedes rather than
//! mutates - is what fills it in.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "curator_plan_run.quiet_json",
            description: "Carry the per-bundle tail of subjects that score nothing, so a plan \
                          can name what it did not plan",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_plan_run")?
                    || has_column(conn, "curator_plan_run", "quiet_json")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE curator_plan_run
                        ADD COLUMN quiet_json TEXT NOT NULL DEFAULT '[]';",
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

    fn seed_run(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO curator_plan_run
                (id, created_at, scan_generated_at, registry_head_sha, corpus_json,
                 consumers_json, policy_json, item_count)
             VALUES (?1, '2026-09-23T00:00:00Z', '2026-09-22T22:39:52Z', 'abc1234',
                     '{}', '{}', '{}', 0)",
            rusqlite::params![id],
        )
        .unwrap();
    }

    #[test]
    fn the_chain_adds_the_quiet_column() {
        let conn = migrated_conn();
        assert!(has_column(&conn, "curator_plan_run", "quiet_json").unwrap());
    }

    /// The boot path runs the chain on every start, so a step that is not
    /// idempotent fails the second launch rather than the first. An
    /// `ALTER TABLE ADD COLUMN` is the shape that fails loudest when re-run
    /// unguarded.
    #[test]
    fn the_step_is_idempotent() {
        let conn = migrated_conn();
        crate::migrations::run_incremental(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        assert!(has_column(&conn, "curator_plan_run", "quiet_json").unwrap());
    }

    /// An omitting INSERT - which is what a pre-`e50` row effectively is -
    /// lands `'[]'`, never NULL. The column is a list, and a list that was
    /// never measured is told from an empty one by the arithmetic in this
    /// module's header, not by a NULL the wire type cannot carry.
    #[test]
    fn an_omitting_insert_lands_an_empty_list_rather_than_null() {
        let conn = migrated_conn();
        seed_run(&conn, "run-1");
        let stored: String = conn
            .query_row(
                "SELECT quiet_json FROM curator_plan_run WHERE id = 'run-1'",
                [],
                |r| r.get("quiet_json"),
            )
            .unwrap();
        assert_eq!(stored, "[]");
    }

    /// The column's own contract, read off the schema rather than probed with a
    /// write: NOT NULL, defaulting to the empty list.
    ///
    /// Asking `pragma_table_info` rather than attempting a rejected
    /// `UPDATE ... SET quiet_json = NULL` is deliberate twice over. It asserts
    /// the DECLARATION instead of one consequence of it - and a write of that
    /// shape in this file is indistinguishable, to census
    /// `default-contradicted-by-backfill`, from the defect that rule exists to
    /// catch: a constant DEFAULT contradicted by a backfill in the same
    /// migration block. There is no backfill here (the whole point of the `e50`
    /// header is that an unmeasured tail must NOT be repaired into looking
    /// measured), so the honest fix is to stop writing the statement, not to
    /// widen the baseline.
    #[test]
    fn the_column_is_not_nullable_and_defaults_to_an_empty_list() {
        let conn = migrated_conn();
        let (not_null, default): (i64, Option<String>) = conn
            .query_row(
                "SELECT [notnull] AS not_null, dflt_value FROM \
                 pragma_table_info('curator_plan_run') WHERE name = 'quiet_json'",
                [],
                |r| Ok((r.get("not_null")?, r.get("dflt_value")?)),
            )
            .unwrap();
        assert_eq!(not_null, 1, "a tail that was measured as empty is '[]'");
        assert_eq!(default.as_deref(), Some("'[]'"));
    }
}
