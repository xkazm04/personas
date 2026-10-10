//! Persona chat session tombstones (mobile phase 2, PHASE2-SPEC 5.2): the
//! delete half of the persona chat projection.
//!
//! `chat_session_tombstones` records that a persona chat session was deleted
//! (`repos::communication::chat::delete_session` writes it in the same
//! transaction as the delete). The cloud sync pass reads it, after its cursor,
//! and deletes the session and its messages from `synced_chat_sessions` /
//! `synced_chat_messages` - a one-way mirror can only ever add rows otherwise.
//! It mirrors `persona_tombstones` (e06); a persona delete needs no row here,
//! because the persona tombstone already removes every chat row of the persona.
//!
//! `deleted_at` is RFC3339 with milliseconds, compared with `julianday`, so two
//! deletes in one second are still ordered.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "chat_session_tombstones",
            description:
                "Tombstones for deleted persona chat sessions so the delete reaches the cloud",
            already_applied: |conn| has_table(conn, "chat_session_tombstones"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS chat_session_tombstones (
                        session_id  TEXT PRIMARY KEY,
                        persona_id  TEXT NOT NULL,
                        deleted_at  TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_chat_session_tombstones_deleted_at
                        ON chat_session_tombstones(deleted_at);",
                )
            },
        },
    )?;
    Ok(())
}
