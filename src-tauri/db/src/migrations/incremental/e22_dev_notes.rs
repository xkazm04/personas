//! `dev_notes` — the Notepad's one table.
//!
//! A **note** is a scratch requirement the operator writes in the app and then
//! hands to a CLI session (`/note-task <id>`) or to Athena. It is deliberately
//! NOT a `dev_idea` and NOT a `dev_goal`: an idea is triage input and a goal is
//! a committed objective, while a note is a draft that may never leave the pad.
//! The lifecycle it carries (`draft → published → in_progress → completed →
//! archived`) is the whole point — the status column is the handshake between
//! the pad, the dispatcher and the run's `result.json`.
//!
//! Three schema decisions worth naming, because each closes a specific hole:
//!
//! 1. **`project_id` is nullable with `ON DELETE SET NULL`.** A note is written
//!    before the operator has decided which repo it belongs to, and deleting a
//!    project must not delete the thinking that went into it. Cascade would.
//! 2. **`status` and `dispatch_target` carry CHECKs.** The transition table is
//!    enforced in Rust (`NoteStatus::can_transition_to`), but the *vocabulary*
//!    is enforced here so a stray write through any other door — the management
//!    HTTP API, a future importer — cannot mint a note in a status the UI has
//!    no presentation for.
//! 3. **The index is `(status, order_index)`**, which is exactly the pad's only
//!    read: "the non-archived notes, in the operator's order".

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_notes",
            description:
                "Notepad: dev_notes (draft → published → in_progress → completed → archived)",
            already_applied: |conn| has_table(conn, "dev_notes"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_notes (
                        id                TEXT PRIMARY KEY NOT NULL,
                        project_id        TEXT REFERENCES dev_projects(id) ON DELETE SET NULL,
                        title             TEXT NOT NULL,
                        body_md           TEXT NOT NULL DEFAULT '',
                        status            TEXT NOT NULL DEFAULT 'draft'
                                          CHECK(status IN ('draft','published','in_progress','completed','archived')),
                        order_index       INTEGER NOT NULL DEFAULT 0,
                        dispatch_target   TEXT
                                          CHECK(dispatch_target IS NULL OR dispatch_target IN ('fleet','athena_goals')),
                        dispatch_key      TEXT,
                        fleet_session_id  TEXT,
                        agent_id          TEXT,
                        result_json       TEXT,
                        published_at      TEXT,
                        started_at        TEXT,
                        completed_at      TEXT,
                        archived_at       TEXT,
                        created_at        TEXT NOT NULL,
                        updated_at        TEXT NOT NULL,
                        -- The pad is ONE ordered list; two notes on the same
                        -- slot would make the tab order plan-dependent.
                        -- create/fork take MAX+1, so the constraint only ever
                        -- bites a reorder that forgot to go two-phase.
                        UNIQUE(order_index)
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_notes_status_order
                        ON dev_notes(status, order_index);",
                )?;
                Ok(())
            },
        },
    )?;

    Ok(())
}
