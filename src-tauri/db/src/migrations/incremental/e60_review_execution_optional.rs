//! `persona_manual_reviews.execution_id` stops being NOT NULL.
//!
//! The column was `TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE
//! CASCADE` from the first schema, which made every manual review a child of a
//! run. That held while reviews were only ever raised by an executing persona.
//! It stopped holding when the headless App Master began posting reports with
//! an approval attached (`POST /dev-tools/reports`): it runs from a terminal,
//! so its persona may never have executed inside the app — measured
//! 2026-10-07, `App Master pof` and `App Master dryrun-core` had 0 executions —
//! and there is no run to hang the approval off.
//!
//! The doors that already raise reviews without a run of their own
//! (`engine::app_master_probation`, the attention asks, the Director) anchor to
//! the persona's latest execution and refuse when there is none. That stays
//! their choice; this only lets a review exist with NO run, which is the honest
//! value for one raised outside any.
//!
//! The FK and its CASCADE are kept: a review that names a run still dies with
//! it, and SQLite does not check a NULL foreign key.
//!
//! Rebuild rather than ALTER: SQLite cannot drop a NOT NULL in place. Same
//! technique as `e34_lab_rating_scale` — the shape is spliced out of the live
//! DDL so a column added later survives the copy, indexes and triggers are
//! replayed after the rename, and the step refuses to run if the column is not
//! in the shape it was written against. Foreign keys are off for the swap so
//! dropping the old table does not cascade into `review_messages`.

use rusqlite::{Connection, OptionalExtension};

use personas_core::error::AppError;

use super::support::*;

const TABLE: &str = "persona_manual_reviews";
const STAGED: &str = "persona_manual_reviews_exec_optional_new";

/// Whether `persona_manual_reviews.execution_id` still carries NOT NULL.
fn execution_id_is_required(conn: &Connection) -> Result<bool, AppError> {
    let notnull: Option<i64> = conn
        .query_row(
            "SELECT \"notnull\" AS nn FROM pragma_table_info('persona_manual_reviews')
             WHERE name = 'execution_id'",
            [],
            |r| r.get("nn"),
        )
        .optional()?;
    Ok(notnull == Some(1))
}

/// The live DDL with `execution_id`'s NOT NULL removed, or `None` when the
/// column is not written `execution_id <ws> TEXT NOT NULL` exactly once.
fn relax_execution_id(create_sql: &str) -> Option<String> {
    let mut hits = Vec::new();
    let mut from = 0;
    while let Some(off) = create_sql[from..].find("execution_id") {
        let at = from + off;
        let after = &create_sql[at + "execution_id".len()..];
        let rest = after.trim_start();
        let ws = after.len() - rest.len();
        // A column definition, not a mention inside another identifier.
        let starts_word = at == 0
            || !create_sql[..at]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        if starts_word && ws > 0 && rest.starts_with("TEXT NOT NULL") {
            hits.push(at + "execution_id".len() + ws);
        }
        from = at + "execution_id".len();
    }
    let [type_at] = hits.as_slice() else {
        return None;
    };
    let mut out = String::with_capacity(create_sql.len());
    out.push_str(&create_sql[..*type_at]);
    out.push_str("TEXT");
    out.push_str(&create_sql[type_at + "TEXT NOT NULL".len()..]);
    Some(out)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_manual_reviews.execution_id_optional",
            description:
                "Manual reviews: execution_id becomes nullable (a review raised outside any run)",
            already_applied: |conn| Ok(!has_table(conn, TABLE)? || !execution_id_is_required(conn)?),
            apply: |conn| {
                let create_sql: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='persona_manual_reviews'",
                    [],
                    |r| r.get("sql"),
                )?;
                let Some(relaxed) = relax_execution_id(&create_sql) else {
                    return Err(AppError::Validation(
                        "persona_manual_reviews.execution_id is not in the expected shape — refusing to rebuild"
                            .into(),
                    ));
                };

                let columns: Vec<String> = {
                    let mut stmt = conn.prepare("PRAGMA table_info(persona_manual_reviews)")?;
                    let rows = stmt.query_map([], |r| r.get::<_, String>("name"))?;
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(AppError::Database)?
                };
                let column_list = columns
                    .iter()
                    .map(|c| format!("\"{c}\""))
                    .collect::<Vec<_>>()
                    .join(", ");

                // Dropping the table drops its indexes and triggers with it;
                // replay their DDL after the rename.
                let aux_sql: Vec<String> = {
                    let mut stmt = conn.prepare(
                        "SELECT sql FROM sqlite_master
                         WHERE tbl_name='persona_manual_reviews'
                           AND type IN ('index','trigger')
                           AND sql IS NOT NULL",
                    )?;
                    let rows = stmt.query_map([], |r| r.get::<_, String>("sql"))?;
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(AppError::Database)?
                };

                // Off for the swap: with foreign keys on, `DROP TABLE` runs an
                // implicit DELETE that would cascade into `review_messages`.
                let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

                let staged = relaxed.replacen(TABLE, STAGED, 1);
                let mut batch = String::new();
                batch.push_str(&format!("DROP TABLE IF EXISTS {STAGED};\n"));
                batch.push_str(&staged);
                batch.push_str(";\n");
                batch.push_str(&format!(
                    "INSERT INTO {STAGED} ({column_list}) SELECT {column_list} FROM {TABLE};\n"
                ));
                batch.push_str(&format!("DROP TABLE {TABLE};\n"));
                batch.push_str(&format!("ALTER TABLE {STAGED} RENAME TO {TABLE};\n"));
                for s in &aux_sql {
                    batch.push_str(s);
                    batch.push_str(";\n");
                }
                ddl_step(conn, &batch)
            },
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::relax_execution_id;

    #[test]
    fn only_the_execution_id_not_null_is_relaxed() {
        let ddl = "CREATE TABLE persona_manual_reviews (
    id                TEXT PRIMARY KEY NOT NULL,
    execution_id      TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE CASCADE,
    persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    title             TEXT NOT NULL
)";
        let out = relax_execution_id(ddl).expect("the live shape");
        assert!(out.contains(
            "execution_id      TEXT REFERENCES persona_executions(id) ON DELETE CASCADE"
        ));
        assert!(
            out.contains("id                TEXT PRIMARY KEY NOT NULL"),
            "{out}"
        );
        assert!(out.contains("persona_id        TEXT NOT NULL"), "{out}");
        assert!(out.contains("title             TEXT NOT NULL"), "{out}");
    }

    #[test]
    fn an_unexpected_shape_is_refused_not_guessed() {
        assert!(relax_execution_id("CREATE TABLE t (execution_id TEXT)").is_none());
        assert!(relax_execution_id("CREATE TABLE t (id TEXT)").is_none());
        // A second matching column would make the splice ambiguous.
        assert!(relax_execution_id(
            "CREATE TABLE t (execution_id TEXT NOT NULL, x TEXT, execution_id TEXT NOT NULL)"
        )
        .is_none());
        // A longer identifier that merely ends in the name is not the column.
        assert!(relax_execution_id("CREATE TABLE t (source_execution_id TEXT NOT NULL)").is_none());
    }
}
