//! A note becomes the living brief of a milestone.
//!
//! `dev_notes` was a pad: a scratch requirement that ends at `completed` and is
//! then off the desk. This step makes one note able to BE a milestone's brief —
//! the same prose the operator wrote, now carrying the cut it produced — and
//! gives every run the note went through a place to live.
//!
//! Three decisions, each closing a hole the alternative leaves open:
//!
//! 1. **`milestone_id` is 1:1, enforced by a PARTIAL unique index.** A milestone
//!    has at most one brief and a note is the brief of at most one milestone.
//!    `UNIQUE(milestone_id)` alone would not do: SQLite treats every NULL as
//!    distinct in a unique index, which is what we want for the many unlinked
//!    notes, but the `WHERE milestone_id IS NOT NULL` clause states the
//!    intent rather than relying on that subtlety being noticed.
//! 2. **`ON DELETE SET NULL`, not CASCADE.** Deleting a milestone must not
//!    delete the operator's prose — same reason `project_id` is SET NULL.
//!    The note falls back to being an ordinary pad entry.
//! 3. **The status CHECK is widened, which means a table REBUILD.** SQLite
//!    cannot `ALTER` a CHECK. The three new tokens (`scoped`, `cut`, `shipped`)
//!    are the milestone half of the lifecycle, and the vocabulary is enforced
//!    in the column for the same reason e22 gave: the management HTTP API and
//!    any future importer write here too, and Rust's transition table is not in
//!    their path.
//!
//! `dev_note_runs` is append-only history. A note can be dispatched more than
//! once (a `/note-task` run, then a `/ship-milestone` run, then an Athena
//! decomposition), and the note's own `dispatch_key` / `fleet_session_id` /
//! `result_json` columns hold only the LAST one. The ledger is what makes "what
//! has this note been through" answerable at all.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// The eight status tokens after the widening, in `NoteStatus::as_str` order.
/// Must stay identical to the enum — a drift is a CHECK failure at runtime,
/// not a compile error.
const STATUS_TOKENS: &str =
    "'draft','published','in_progress','completed','archived','scoped','cut','shipped'";

/// Every column of the OLD `dev_notes`, in `CREATE TABLE` order. Named rather
/// than `SELECT *` so the copy is a deliberate list: the staging table has one
/// more column than the source, which is exactly the case `SELECT *` cannot
/// express.
const LEGACY_COLUMNS: &str = "id, project_id, title, body_md, status, order_index, \
     dispatch_target, dispatch_key, fleet_session_id, agent_id, result_json, \
     published_at, started_at, completed_at, archived_at, created_at, updated_at";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_notes.milestone_id",
            description: "Notepad → Ship: dev_notes.milestone_id (1:1, SET NULL), the scoped/cut/shipped statuses, and the dev_note_runs ledger",
            already_applied: |conn| has_column(conn, "dev_notes", "milestone_id"),
            apply: |conn| {
                rebuild_dev_notes_with_milestone(conn)?;
                create_note_runs(conn)?;
                Ok(())
            },
        },
    )?;

    // Second, independently-probed step: a database that reached the rebuild
    // above before this table existed (a partially-applied chain, or a test
    // that dropped the ledger) still gets it on the next boot.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_note_runs",
            description:
                "Notepad: dev_note_runs — append-only history of every run a note went through",
            already_applied: |conn| has_table(conn, "dev_note_runs"),
            apply: create_note_runs,
        },
    )?;

    Ok(())
}

/// Rebuild `dev_notes` with `milestone_id` and the widened status CHECK.
///
/// Follows SQLite's documented safe-rebuild procedure, the same one
/// `e19_agent_manifest` uses: foreign keys OFF for the duration (a plain
/// `DROP TABLE` with enforcement on would fire the parent-side actions of
/// anything referencing the table), staging table, explicit-column copy,
/// drop, rename, index replay.
///
/// The guard is taken OUTSIDE `ddl_step`: `PRAGMA foreign_keys` is a silent
/// no-op inside a transaction, and `ddl_step` opens one.
fn rebuild_dev_notes_with_milestone(conn: &Connection) -> Result<(), AppError> {
    let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

    let batch = format!(
        "DROP TABLE IF EXISTS dev_notes_new;
         CREATE TABLE dev_notes_new (
            id                TEXT PRIMARY KEY NOT NULL,
            project_id        TEXT REFERENCES dev_projects(id) ON DELETE SET NULL,
            -- The milestone this note is the living brief of. SET NULL, not
            -- CASCADE: deleting a cut must not delete the prose behind it.
            milestone_id      TEXT REFERENCES dev_milestones(id) ON DELETE SET NULL,
            title             TEXT NOT NULL,
            body_md           TEXT NOT NULL DEFAULT '',
            status            TEXT NOT NULL DEFAULT 'draft'
                              CHECK(status IN ({STATUS_TOKENS})),
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
            -- The pad is ONE ordered list; see e22.
            UNIQUE(order_index)
         );
         INSERT INTO dev_notes_new ({LEGACY_COLUMNS})
            SELECT {LEGACY_COLUMNS} FROM dev_notes;
         DROP TABLE dev_notes;
         ALTER TABLE dev_notes_new RENAME TO dev_notes;
         CREATE INDEX IF NOT EXISTS idx_dev_notes_status_order
            ON dev_notes(status, order_index);
         -- 1:1 with a milestone. PARTIAL so the many unlinked notes do not
         -- collide: a milestone has at most one brief, and a note is the brief
         -- of at most one milestone.
         CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_notes_milestone
            ON dev_notes(milestone_id) WHERE milestone_id IS NOT NULL;"
    );
    ddl_step(conn, &batch)
}

fn create_note_runs(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_note_runs (
            id                TEXT PRIMARY KEY,
            note_id           TEXT NOT NULL REFERENCES dev_notes(id) ON DELETE CASCADE,
            -- Which surface started it. The ledger is the only place a note's
            -- SECOND dispatch survives — the note's own columns hold the last.
            kind              TEXT NOT NULL
                              CHECK(kind IN ('note_task','ship_milestone','athena_goals')),
            status            TEXT NOT NULL
                              CHECK(status IN ('running','completed','failed')),
            dispatch_key      TEXT,
            fleet_session_id  TEXT,
            run_dir           TEXT,
            summary_json      TEXT,
            started_at        TEXT NOT NULL,
            completed_at      TEXT,
            created_at        TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_dev_note_runs_note
            ON dev_note_runs(note_id, started_at);",
    )
}
