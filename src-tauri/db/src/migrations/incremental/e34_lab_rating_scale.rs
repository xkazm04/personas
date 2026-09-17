//! `lab_user_ratings.rating` moves from the three-thumb vocabulary to the
//! 1..5 scale the repository already validates against.
//!
//! Three implementations of one rule had drifted apart: the widget submitted
//! `-1 | 0 | 1`, `repos::lab::ratings::upsert_rating` rejected anything
//! outside `1..=5`, and this table's CHECK constraint still said
//! `rating IN (-1, 0, 1)`. Only the single overlapping value (`1`) could ever
//! be stored, so thumbs-down and neutral both failed at the trust boundary and
//! the one human channel into `generate_targeted_improvements` was dead.
//!
//! The widget now emits the stored scale (down 1 / neutral 3 / up 5), so the
//! CHECK has to accept it. Legacy rows are remapped by the same table:
//! `-1 -> 1`, `0 -> 3`, `1 -> 5` — a legacy `1` was a thumbs-UP, which is the
//! top of the new scale, not the bottom.
//!
//! Rebuild rather than ALTER: SQLite cannot change a CHECK in place. The shape
//! is spliced out of the live DDL (same technique as
//! `constrain_goal_status_to_canonical_set`) so a column added later still
//! survives the copy, and the step refuses to run if the DDL is not the shape
//! it was written against.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

const LEGACY_CHECK: &str = "CHECK(rating IN (-1, 0, 1))";
const NEW_CHECK: &str = "CHECK(rating BETWEEN 1 AND 5)";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "lab_user_ratings_1_5_scale",
            description: "Lab ratings: widen rating CHECK to the 1..5 scale and remap thumbs",
            already_applied: |conn| {
                if !has_table(conn, "lab_user_ratings")? {
                    // Nothing to migrate; the initial schema now creates the
                    // table with the new CHECK.
                    return Ok(true);
                }
                let sql: String = conn.query_row(
                    "SELECT COALESCE(sql, '') AS sql FROM sqlite_master
                     WHERE type='table' AND name='lab_user_ratings'",
                    [],
                    |r| r.get("sql"),
                )?;
                Ok(!sql.contains(LEGACY_CHECK))
            },
            apply: |conn| {
                let create_sql: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='lab_user_ratings'",
                    [],
                    |r| r.get("sql"),
                )?;
                if create_sql.matches(LEGACY_CHECK).count() != 1 {
                    return Err(AppError::Validation(
                        "lab_user_ratings.rating is not in the expected shape — refusing to rebuild"
                            .into(),
                    ));
                }

                // The remap happens IN the copy, not before it: an UPDATE on the
                // live table would have to satisfy the LEGACY check it is
                // escaping (`rating = 5` fails `rating IN (-1, 0, 1)`), so the
                // new values can only be written into the already-widened
                // staging table. The column list is read from the live table so
                // a column added later still rides along.
                let columns: Vec<String> = {
                    let mut stmt = conn.prepare("PRAGMA table_info(lab_user_ratings)")?;
                    let rows = stmt.query_map([], |r| r.get::<_, String>("name"))?;
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(AppError::Database)?
                };
                let column_list = columns
                    .iter()
                    .map(|c| format!("\"{c}\""))
                    .collect::<Vec<_>>()
                    .join(", ");
                let select_list = columns
                    .iter()
                    .map(|c| {
                        if c == "rating" {
                            "CASE rating WHEN -1 THEN 1 WHEN 0 THEN 3 WHEN 1 THEN 5 ELSE rating END"
                                .to_string()
                        } else {
                            format!("\"{c}\"")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ");

                let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

                let widened = create_sql.replacen(LEGACY_CHECK, NEW_CHECK, 1);
                let staged = widened.replacen("lab_user_ratings", "lab_user_ratings_scale_new", 1);

                // Dropping the table drops its indexes with it; replay their
                // DDL after the rename.
                let aux_sql: Vec<String> = {
                    let mut stmt = conn.prepare(
                        "SELECT sql FROM sqlite_master
                         WHERE tbl_name='lab_user_ratings'
                           AND type IN ('index','trigger')
                           AND sql IS NOT NULL",
                    )?;
                    let rows = stmt.query_map([], |r| r.get::<_, String>("sql"))?;
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(AppError::Database)?
                };

                let mut batch = String::new();
                batch.push_str("DROP TABLE IF EXISTS lab_user_ratings_scale_new;\n");
                batch.push_str(&staged);
                batch.push_str(";\n");
                batch.push_str(&format!(
                    "INSERT INTO lab_user_ratings_scale_new ({column_list}) \
                     SELECT {select_list} FROM lab_user_ratings;\n"
                ));
                batch.push_str("DROP TABLE lab_user_ratings;\n");
                batch.push_str(
                    "ALTER TABLE lab_user_ratings_scale_new RENAME TO lab_user_ratings;\n",
                );
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
