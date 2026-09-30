//! **Her method lane, and the record of whether any of it helped.**
//!
//! Two steps, for the two halves of one change: she may now dispatch a worker at
//! a gap in the registry's own method files, and she now samples whether the
//! ecosystem of projects is growing so that lane has something to serve.
//!
//! ## Why `curator_dispatch` is rebuilt rather than left alone
//!
//! `lane` is a CHECK over a closed set, and SQLite cannot alter one - the table
//! is recreated, copied and renamed through [`rebuild_table_from_live_ddl`],
//! which is the same procedure every other CHECK widening in this file uses.
//!
//! The alternative was to record a method dispatch under the existing `plan`
//! token, and it was rejected deliberately. A method edit changes what every
//! future worker is told to do, where a plan run changes what one subject says;
//! it is the most privileged thing she does. An audit trail that could not tell
//! the two apart would be hiding precisely the row a reviewer opened it for -
//! and `level_that_authorised` is on this table for the same reason, so that a
//! later policy change cannot re-authorise an old commit retroactively.
//!
//! ## Why the growth samples are a table and not two settings scalars
//!
//! The other things her loop remembers (the harvest marks, the last sleep) are
//! single scalars in `app_settings`, because only the newest value has any
//! meaning. Growth is the opposite: **the answer IS the difference between two
//! rows**, and "nothing has grown for eleven consecutive passes" cannot be read
//! from a scalar at all. It is also the first number she keeps that is about the
//! world rather than about her own activity, which is why it earns storage of
//! its own.
//!
//! Every metric column is nullable and nothing defaults to zero. That is the
//! rule this feature has already been bitten by three times - `dry_streak`
//! reading `0` because nothing increments it, the runtime caps rendering `0` for
//! "no ceiling declared", and a `u32` deserialiser failing 449 of 475 subjects -
//! and a growth metric is exactly where the mistake would be invisible: a column
//! that reported `0` projects for "the map could not be read" would make the
//! ecosystem look like it had collapsed.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "curator_dispatch.method_lane",
            description: "Let her record a dispatch aimed at the registry's own method files, \
                          under its own lane rather than hidden inside `plan`",
            // The postcondition, probed the way every step here probes: the
            // token is in the live DDL. `has_table` is checked first because a
            // fresh database has not reached e52 yet when this runs in a chain
            // that was interrupted.
            already_applied: |conn| {
                if !has_table(conn, "curator_dispatch")? {
                    return Ok(true);
                }
                let ddl: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='curator_dispatch'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(ddl.contains("'method'"))
            },
            apply: |conn| {
                rebuild_table_from_live_ddl(
                    conn,
                    "curator_dispatch",
                    &|create_sql| {
                        // `'refill'` is the last entry of the lane CHECK and
                        // occurs exactly once in this DDL. If it does not, the
                        // table is not the shape this step was written against -
                        // bail rather than build a table that silently keeps the
                        // old constraint, or mangles a different clause.
                        if create_sql.matches("'refill'").count() != 1 {
                            return Err(AppError::Validation(
                                "curator_dispatch lane CHECK is not in the expected shape - \
                                 refusing to rebuild"
                                    .into(),
                            ));
                        }
                        Ok(create_sql.replacen("'refill'", "'refill','method'", 1))
                    },
                    "",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_growth",
            description: "One sample of the ecosystem's size, so two of them can be subtracted \
                          and her loop can tell motion from movement",
            already_applied: |conn| has_table(conn, "curator_growth"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_growth (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        measured_at TEXT NOT NULL,
                        projects INTEGER,
                        judged_pairs INTEGER,
                        stale_verdicts INTEGER,
                        applied_subjects INTEGER,
                        subjects INTEGER,
                        techniques INTEGER,
                        applications INTEGER
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_growth.recent_index",
            description: "Read the newest samples without scanning her whole history",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_growth")?
                    || has_index(conn, "idx_curator_growth_recent")?)
            },
            apply: |conn| {
                // The only read: the newest N samples, newest first. `id`
                // descending breaks a tie between two samples taken inside the
                // same second, which two of her terminals can produce.
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_curator_growth_recent
                     ON curator_growth(measured_at DESC, id DESC);",
                )
            },
        },
    )?;

    Ok(())
}
