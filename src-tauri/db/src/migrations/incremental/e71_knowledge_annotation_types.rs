//! `execution_knowledge.knowledge_type` admits the annotation types (2026-10-21).
//!
//! `upsert_annotation` writes `user_annotation` / `agent_annotation`, and the
//! annotation doors (`verify_annotation`, `dismiss_annotation`, the summary
//! counts) read them, but the table's original CHECK listed only the five
//! learned-pattern types. e02 added the annotation columns and left a comment
//! saying the new types are "validated in application code" - the CHECK was
//! never widened, so every annotation insert failed with `CHECK constraint
//! failed` and no annotation row could exist. SQLite cannot alter a CHECK in
//! place, so the table is rebuilt through [`rebuild_table_from_live_ddl`]; the
//! indexes (including the UNIQUE the upsert conflicts on) are replayed.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "execution_knowledge.knowledge_type.annotations",
            description: "execution_knowledge.knowledge_type CHECK admits the annotation types",
            already_applied: |conn| {
                if !has_table(conn, "execution_knowledge")? {
                    return Ok(true);
                }
                let ddl: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='execution_knowledge'",
                    [],
                    |r| r.get("sql"),
                )?;
                Ok(ddl.contains("'user_annotation'"))
            },
            apply: |conn| {
                rebuild_table_from_live_ddl(
                    conn,
                    "execution_knowledge",
                    &|create_sql| {
                        // `'model_performance'` closes the type CHECK and
                        // occurs exactly once; anything else means the table
                        // is not the shape this step was written against.
                        if create_sql.matches("'model_performance'").count() != 1 {
                            return Err(AppError::Validation(
                                "execution_knowledge type CHECK is not in the expected shape - \
                                 refusing to rebuild"
                                    .into(),
                            ));
                        }
                        Ok(create_sql.replacen(
                            "'model_performance'",
                            "'model_performance','user_annotation','agent_annotation'",
                            1,
                        ))
                    },
                    "",
                )
            },
        },
    )?;
    Ok(())
}
