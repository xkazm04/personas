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
//! The rebuild is DERIVED, not authored: the live `CREATE TABLE` is read back
//! from `sqlite_master`, the token list is widened and the column spliced in as
//! text edits, and the copy travels by column NAME
//! (`rebuild_table_from_live_ddl`). A replacement shape written out here would
//! silently drop any column `dev_notes` gained after this file was committed.
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

/// The five tokens e22 wrote, exactly as its CHECK spells them. The transform
/// anchors on this text and refuses when it is not found exactly once.
const LEGACY_STATUS_TOKENS: &str = "'draft','published','in_progress','completed','archived'";

/// The tail of e22's `project_id` column definition — the splice point after
/// which `milestone_id` goes, so the two nullable parent links sit together.
const PROJECT_COLUMN_TAIL: &str = "REFERENCES dev_projects(id) ON DELETE SET NULL,";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_notes.milestone_id",
            description:
                "Notepad → Ship: dev_notes.milestone_id (1:1, SET NULL), the scoped/cut/shipped statuses, and the dev_note_runs ledger",
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

/// Edit the LIVE `dev_notes` DDL: widen the status CHECK and splice
/// `milestone_id` in after `project_id`. Each anchor must occur exactly once —
/// a DDL this function does not recognise is refused, never guessed at.
fn widen_dev_notes_ddl(live: &str) -> Result<String, AppError> {
    if live.matches(LEGACY_STATUS_TOKENS).count() != 1 {
        return Err(AppError::Internal(
            "e30: `dev_notes` DDL does not carry e22's status CHECK exactly once; refusing to rebuild"
                .into(),
        ));
    }
    if live.matches(PROJECT_COLUMN_TAIL).count() != 1 {
        return Err(AppError::Internal(
            "e30: `dev_notes` DDL does not carry the project_id column exactly once; refusing to rebuild"
                .into(),
        ));
    }
    let widened = live.replacen(LEGACY_STATUS_TOKENS, STATUS_TOKENS, 1);
    let spliced = widened.replacen(
        PROJECT_COLUMN_TAIL,
        &format!(
            "{PROJECT_COLUMN_TAIL}\n            \
             milestone_id      TEXT REFERENCES dev_milestones(id) ON DELETE SET NULL,"
        ),
        1,
    );
    Ok(spliced)
}

/// Rebuild `dev_notes` with `milestone_id` and the widened status CHECK,
/// derived from the table as it exists on this machine. The status/order index
/// is replayed from `sqlite_master`; the partial unique index is the one piece
/// of DDL that is genuinely new.
fn rebuild_dev_notes_with_milestone(conn: &Connection) -> Result<(), AppError> {
    rebuild_table_from_live_ddl(
        conn,
        "dev_notes",
        &widen_dev_notes_ddl,
        // 1:1 with a milestone. PARTIAL so the many unlinked notes do not
        // collide: a milestone has at most one brief, and a note is the brief
        // of at most one milestone.
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_notes_milestone
            ON dev_notes(milestone_id) WHERE milestone_id IS NOT NULL;",
    )
}

fn create_note_runs(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_note_runs (
            id                TEXT PRIMARY KEY NOT NULL,
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
