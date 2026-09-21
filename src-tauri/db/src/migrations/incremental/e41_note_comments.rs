//! `dev_note_comments` — the per-note thread.
//!
//! A note's lifecycle columns (`status`, `result_json`, the e30 run ledger)
//! answer "where is this note"; nothing answered "what has been SAID about
//! it". The thread collects that: operator comments, Athena's reviews and
//! comments, the note-task agent's run reviews, and system status milestones.
//!
//! Schema decisions worth naming:
//!
//! 1. **`note_id` cascades.** A thread has no meaning without its note, and
//!    deleting a note permanently is an operator act that must not leave
//!    orphan rows for the unread counter to keep counting.
//! 2. **The vocabularies carry CHECKs** (`author_kind`, `kind`, `ref_kind`,
//!    `verdict`), mirroring `NoteCommentAuthor` / `NoteCommentKind` /
//!    `NoteCommentRef` / `NoteReviewVerdict` in `personas_core`. A drift is a
//!    CHECK failure at runtime, not a compile error — keep them identical.
//! 3. **Unread is durable** — `read_at` per row, NULL = unread. This is a
//!    local single-operator app, so one column is the whole read model.
//! 4. **The index is `(note_id, created_at)`**, which is exactly the thread's
//!    read ("this note's entries, oldest first") and the unread count's group.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_note_comments",
            description:
                "Notepad: dev_note_comments — the per-note thread (comments, reviews, status milestones)",
            already_applied: |conn| has_table(conn, "dev_note_comments"),
            apply: create_note_comments,
        },
    )
}

fn create_note_comments(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_note_comments (
            id           TEXT PRIMARY KEY NOT NULL,
            note_id      TEXT NOT NULL REFERENCES dev_notes(id) ON DELETE CASCADE,
            author_kind  TEXT NOT NULL
                         CHECK(author_kind IN ('operator','athena','agent','system')),
            author_name  TEXT,
            kind         TEXT NOT NULL
                         CHECK(kind IN ('comment','review','system')),
            body_md      TEXT NOT NULL,
            ref_kind     TEXT
                         CHECK(ref_kind IS NULL OR ref_kind IN ('suggestion_card','run','status')),
            ref_id       TEXT,
            verdict      TEXT
                         CHECK(verdict IS NULL OR verdict IN ('pending','approved','rejected')),
            created_at   TEXT NOT NULL,
            read_at      TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_dev_note_comments_note_created
            ON dev_note_comments(note_id, created_at);",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_note(conn: &Connection, id: &str, order: i64) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO dev_notes (id, title, status, order_index, created_at, updated_at)
             VALUES (?1, 'n', 'draft', ?2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![id, order],
        )?;
        Ok(())
    }

    /// The table lands on a fresh database, a replay is a no-op that keeps
    /// rows, and the CHECKs refuse a token outside each vocabulary.
    #[test]
    fn note_comments_land_idempotently_and_check_their_vocabularies() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        assert!(has_table(&conn, "dev_note_comments")?);
        assert!(has_index(&conn, "idx_dev_note_comments_note_created")?);

        seed_note(&conn, "n1", 0)?;
        conn.execute(
            "INSERT INTO dev_note_comments (id, note_id, author_kind, kind, body_md, created_at)
             VALUES ('c1', 'n1', 'operator', 'comment', 'hi', '2026-01-01T00:00:00Z')",
            [],
        )?;
        run(&conn)?;
        let n: i64 = conn.query_row("SELECT COUNT(id) AS n FROM dev_note_comments", [], |r| {
            r.get("n")
        })?;
        assert_eq!(n, 1, "a replay must not touch existing rows");

        for bad in [
            "INSERT INTO dev_note_comments (id, note_id, author_kind, kind, body_md, created_at)
             VALUES ('x1', 'n1', 'robot', 'comment', 'b', 't')",
            "INSERT INTO dev_note_comments (id, note_id, author_kind, kind, body_md, created_at)
             VALUES ('x2', 'n1', 'operator', 'shout', 'b', 't')",
            "INSERT INTO dev_note_comments (id, note_id, author_kind, kind, body_md, ref_kind, created_at)
             VALUES ('x3', 'n1', 'operator', 'comment', 'b', 'goal', 't')",
            "INSERT INTO dev_note_comments (id, note_id, author_kind, kind, body_md, verdict, created_at)
             VALUES ('x4', 'n1', 'operator', 'review', 'b', 'maybe', 't')",
        ] {
            assert!(conn.execute(bad, []).is_err(), "CHECK must refuse: {bad}");
        }
        Ok(())
    }

    /// Deleting the note removes its thread (FK cascade, foreign_keys ON).
    #[test]
    fn deleting_a_note_cascades_to_its_comments() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        seed_note(&conn, "n1", 0)?;
        seed_note(&conn, "n2", 1)?;
        conn.execute_batch(
            "INSERT INTO dev_note_comments (id, note_id, author_kind, kind, body_md, created_at)
                VALUES ('c1', 'n1', 'system', 'system', 'cut', 't1'),
                       ('c2', 'n2', 'athena', 'review', 'ok', 't2');
             DELETE FROM dev_notes WHERE id = 'n1';",
        )?;
        let left: Vec<String> = conn
            .prepare("SELECT id FROM dev_note_comments ORDER BY id")?
            .query_map([], |r| r.get("id"))?
            .collect::<Result<_, _>>()?;
        assert_eq!(left, vec!["c2".to_string()]);
        Ok(())
    }
}
