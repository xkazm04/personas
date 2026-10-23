//! Orphan archive (2026-10-15, spark `mandate-lanes`, WP6).
//!
//! `orphan_archive` remembers the pending items the operator archived from
//! the Orphans lane: work no mandate holds that the operator chose not to
//! claim. The item itself is untouched (archived, never deleted): it stays in
//! its own list and searchable. The lanes leave an archived item out only
//! while it is still an orphan; once a mandate holds its project it routes
//! like any other item.
//!
//! One row per item (`item_id` is the frontend `DecisionItem.id`, the same id
//! the lanes snapshot carries), so archiving twice is a no-op and new work on
//! the project forms a new cluster. FK-less on purpose: the ids span many
//! source tables.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "orphan_archive",
            description: "Create orphan_archive (items archived from the Orphans lane)",
            already_applied: |conn| has_table(conn, "orphan_archive"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS orphan_archive (
                        item_id       TEXT PRIMARY KEY NOT NULL,
                        project_id    TEXT NOT NULL,
                        item_kind     TEXT NOT NULL,
                        archived_at   TEXT NOT NULL,
                        origin_device TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_orphan_archive_project
                        ON orphan_archive(project_id, archived_at);",
                )
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_table_once() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert!(has_table(&conn, "orphan_archive").unwrap());
        assert!(has_index(&conn, "idx_orphan_archive_project").unwrap());
    }
}
