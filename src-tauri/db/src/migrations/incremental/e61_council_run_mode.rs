//! `dev_council_runs.mode`: a council run is `full` or `lite`, and rounds are
//! counted per mode.
//!
//! Registry council 0.4.0 added `--lite`: ONE pass by the running session over
//! a fixed subset of the rubric (`value`, `craft`, `robustness` of
//! `feature-v1`), written in the same `result.json` with `mode: "lite"`. Its
//! rounds are counted SEPARATELY from the full council's - a lite run lives in
//! `<date>-<slug>-lite-r<n>`, has its own cap of three and its own supersede
//! chain - because three cheap lite reworks must not exhaust the expensive
//! verdict's three rounds.
//!
//! The store could not hold that: `UNIQUE (subject_id, round_no)` made a lite
//! round 1 and a full round 1 of one subject the same row. This step adds
//! `mode TEXT NOT NULL DEFAULT 'full'` (every run ingested before 0.4.0 was a
//! full council) and widens the key to `UNIQUE (subject_id, mode, round_no)`.
//!
//! Rebuild rather than ALTER: SQLite cannot change a table constraint in
//! place. Same technique as `e34_lab_rating_scale` - the shape is spliced out
//! of the live DDL so a column added later survives, indexes and triggers are
//! replayed, and the step refuses to run on a shape it was not written
//! against. Foreign keys are off for the swap: verdicts, decisions and
//! scenario results all reference this table, and dropping it with them on
//! would cascade (or, for decisions, RESTRICT) through every one.
//!
//! **`dev_council_decisions` is rebuilt right after it, unchanged, and that is
//! load-bearing.** Deleting a subject cascades into BOTH its runs and its
//! decisions, while a decision pins its run with `ON DELETE RESTRICT`. SQLite
//! runs a parent's cascade actions newest-child-table first, so the store only
//! ever worked because `dev_council_decisions` was created after
//! `dev_council_runs`: the decisions went first and the RESTRICT found nothing
//! to protect. Recreating the runs table alone made it the newest child, the
//! runs went first, and deleting a decided subject - or the project above it -
//! failed on the RESTRICT (caught by `e43_council`'s own test). Recreating the
//! decisions table after it restores the order the schema depends on.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

const TABLE: &str = "dev_council_runs";
const STAGED: &str = "dev_council_runs_mode_new";
const DECISIONS: &str = "dev_council_decisions";
const DECISIONS_STAGED: &str = "dev_council_decisions_order_new";
const LEGACY_KEY: &str = "UNIQUE (subject_id, round_no)";
const MODE_AND_KEY: &str = "mode TEXT NOT NULL DEFAULT 'full' CHECK (mode IN ('full','lite')),
                        UNIQUE (subject_id, mode, round_no)";

/// The statements that recreate `table` as `new_ddl` (a CREATE TABLE for
/// `table`), copying every row and replaying its indexes and triggers. Read
/// from the live schema before anything is dropped.
fn rebuild_statements(
    conn: &Connection,
    table: &str,
    staged_name: &str,
    new_ddl: &str,
) -> Result<String, AppError> {
    let columns: Vec<String> = {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>("name"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };
    let column_list = columns
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let aux_sql: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT sql FROM sqlite_master
             WHERE tbl_name = ?1 AND type IN ('index','trigger') AND sql IS NOT NULL",
        )?;
        let rows = stmt.query_map([table], |r| r.get::<_, String>("sql"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };
    let staged = new_ddl.replacen(table, staged_name, 1);
    let mut batch = String::new();
    batch.push_str(&format!("DROP TABLE IF EXISTS {staged_name};\n"));
    batch.push_str(&staged);
    batch.push_str(";\n");
    batch.push_str(&format!(
        "INSERT INTO {staged_name} ({column_list}) SELECT {column_list} FROM {table};\n"
    ));
    batch.push_str(&format!("DROP TABLE {table};\n"));
    batch.push_str(&format!("ALTER TABLE {staged_name} RENAME TO {table};\n"));
    for s in &aux_sql {
        batch.push_str(s);
        batch.push_str(";\n");
    }
    Ok(batch)
}

fn table_ddl(conn: &Connection, table: &str) -> Result<String, AppError> {
    Ok(conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?1",
        [table],
        |r| r.get("sql"),
    )?)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_runs.mode",
            description: "Council runs carry full|lite, and rounds are unique per (subject, mode)",
            already_applied: |conn| Ok(!has_table(conn, TABLE)? || has_column(conn, TABLE, "mode")?),
            apply: |conn| {
                let create_sql = table_ddl(conn, TABLE)?;
                if create_sql.matches(LEGACY_KEY).count() != 1 {
                    return Err(AppError::Validation(
                        "dev_council_runs is not in the expected shape (one UNIQUE (subject_id, round_no)) - refusing to rebuild"
                            .into(),
                    ));
                }
                let widened = create_sql.replacen(LEGACY_KEY, MODE_AND_KEY, 1);
                let mut batch = rebuild_statements(conn, TABLE, STAGED, &widened)?;
                // See the module header: the decisions table must stay NEWER
                // than the runs table, or deleting a decided subject trips the
                // RESTRICT on `dev_council_decisions.run_id`.
                if has_table(conn, DECISIONS)? {
                    let decisions_sql = table_ddl(conn, DECISIONS)?;
                    batch.push_str(&rebuild_statements(
                        conn,
                        DECISIONS,
                        DECISIONS_STAGED,
                        &decisions_sql,
                    )?);
                }

                let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;
                ddl_step(conn, &batch)
            },
        },
    )?;
    Ok(())
}
