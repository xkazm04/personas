//! `dev_notes` — the Notepad.
//!
//! The pad is a small, hard-edged table with an unusually opinionated repo,
//! and every rule below exists because the alternative is a silent lie:
//!
//! - **Body and project are draft-only.** Once a note is published, a CLI
//!   session may already have `note.md` open. Editing the requirement under a
//!   running agent produces a run that answers a question nobody asked, and
//!   nothing downstream can detect it. So the edit is REFUSED here, in the one
//!   door every writer goes through, rather than greyed out in a UI that is
//!   only one of several writers.
//! - **Status moves go through the table** in [`NoteStatus::can_transition_to`],
//!   never through a free-form string. A move the table does not name is an
//!   `AppError::Validation`, not a best-effort write.
//! - **The cap is counted, not remembered.** `count_active_notes` is a live
//!   `COUNT(*)`; the pad's ten-note ceiling is a property of the table, so it
//!   cannot drift from a cached number the way a stored counter would.
//! - **Delete is draft-or-archived only.** A published/in-progress/completed
//!   note is the other half of a run that exists on disk; deleting it strands
//!   `runs/<note_id>/` with nothing to ingest into.

use crate::models::{DevNote, NoteStatus};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::validation::require_non_empty;
use rusqlite::params;

/// Every column of `dev_notes`, in the order [`row_to_note_raw`] reads them.
/// Named rather than `*` so a column added later is a deliberate edit here and
/// not a silent widening of every SELECT.
const NOTE_COLUMNS: &str = "id, project_id, title, body_md, status, order_index, \
     dispatch_target, dispatch_key, fleet_session_id, agent_id, result_json, \
     published_at, started_at, completed_at, archived_at, created_at, updated_at";

/// The pad's ceiling on NON-ARCHIVED notes. Ten is a working-set bound, not a
/// storage bound: the pad is a desk, and a desk with fifty things on it is a
/// pile. Archiving is always available and never blocked by the cap.
pub const NOTE_CAP: i64 = 10;

row_mapper!(row_to_note_raw -> DevNoteRow {
    id, project_id, title, body_md, status, order_index,
    dispatch_target, dispatch_key, fleet_session_id, agent_id, result_json,
    published_at, started_at, completed_at, archived_at, created_at, updated_at,
});

/// The row exactly as SQLite hands it over, with `status` still a `String`.
///
/// [`row_mapper!`] builds a mapper of `&Row -> rusqlite::Result<T>`, and the
/// `status` column has to become a [`NoteStatus`] — a fallible conversion the
/// macro has no vocabulary for. Rather than hand-roll the whole mapper and lose
/// the macro's column-name discipline, the macro maps into this shadow struct
/// and [`row_to_note`] does the single narrowing step. A row whose status is
/// outside the vocabulary (only reachable if something wrote past the column
/// CHECK) surfaces as a mapping error, never as a silently defaulted `draft`.
struct DevNoteRow {
    id: String,
    project_id: Option<String>,
    title: String,
    body_md: String,
    status: String,
    order_index: i32,
    dispatch_target: Option<String>,
    dispatch_key: Option<String>,
    fleet_session_id: Option<String>,
    agent_id: Option<String>,
    result_json: Option<String>,
    published_at: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    archived_at: Option<String>,
    created_at: String,
    updated_at: String,
}

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<DevNote> {
    let raw = row_to_note_raw(row)?;
    let status = NoteStatus::parse(&raw.status).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unknown dev_notes.status `{}`", raw.status),
            )),
        )
    })?;
    Ok(DevNote {
        id: raw.id,
        project_id: raw.project_id,
        title: raw.title,
        body_md: raw.body_md,
        status,
        order_index: raw.order_index,
        dispatch_target: raw.dispatch_target,
        dispatch_key: raw.dispatch_key,
        fleet_session_id: raw.fleet_session_id,
        agent_id: raw.agent_id,
        result_json: raw.result_json,
        published_at: raw.published_at,
        started_at: raw.started_at,
        completed_at: raw.completed_at,
        archived_at: raw.archived_at,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
    })
}

/// The pad, in the operator's order. `include_archived = false` is the default
/// read — archived notes are off the desk, not deleted.
pub fn list_notes(pool: &DbPool, include_archived: bool) -> Result<Vec<DevNote>, AppError> {
    timed_query!("dev_notes", "dev_notes::list", {
        let conn = pool.get()?;
        let sql = if include_archived {
            format!("SELECT {NOTE_COLUMNS} FROM dev_notes ORDER BY order_index, created_at")
        } else {
            format!(
                "SELECT {NOTE_COLUMNS} FROM dev_notes WHERE status != 'archived' ORDER BY order_index, created_at"
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], row_to_note)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Live count of non-archived notes — the number the cap is checked against.
pub fn count_active_notes(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!("dev_notes", "dev_notes::count_active", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT COUNT(*) AS active FROM dev_notes WHERE status != 'archived'",
            [],
            |r| r.get::<_, i64>("active"),
        )
        .map_err(AppError::Database)
    })
}

pub fn get_note(pool: &DbPool, id: &str) -> Result<DevNote, AppError> {
    timed_query!("dev_notes", "dev_notes::get", {
        let conn = pool.get()?;
        conn.query_row(
            &format!("SELECT {NOTE_COLUMNS} FROM dev_notes WHERE id = ?1"),
            params![id],
            row_to_note,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Note {id}")),
            other => AppError::Database(other),
        })
    })
}

/// Create a draft. The cap is enforced by the COMMAND, not here: the repo is
/// also the door a fork and a restore come through, and each of those has its
/// own thing to say when the pad is full.
pub fn create_note(
    pool: &DbPool,
    title: &str,
    project_id: Option<&str>,
) -> Result<DevNote, AppError> {
    let title = title.trim();
    require_non_empty("Note title", title)?;
    timed_query!("dev_notes", "dev_notes::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let order_index: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM dev_notes",
                [],
                |row| row.get::<_, i32>("next_index"),
            )
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO dev_notes (id, project_id, title, body_md, status, order_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, '', 'draft', ?4, ?5, ?5)",
            params![id, project_id, title, order_index, now],
        )?;
        drop(conn);
        get_note(pool, &id)
    })
}

/// Patch-style update. `Some(None)` on `project_id` unlinks; `None` leaves a
/// field untouched.
///
/// Refuses a `body_md` or `project_id` edit on a non-draft note — see the
/// module note. A `title` edit is allowed in every status except `archived`,
/// because a title is a label on the pad and never reaches the run.
pub fn update_note(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    body_md: Option<&str>,
    project_id: Option<Option<&str>>,
    order_index: Option<i64>,
) -> Result<DevNote, AppError> {
    timed_query!("dev_notes", "dev_notes::update", {
        let current = get_note(pool, id)?;
        let is_draft = current.status == NoteStatus::Draft;
        if body_md.is_some() && !is_draft {
            return Err(AppError::Validation(
                "A note's body is editable only while it is a draft — a published note may already be open in a running session".into(),
            ));
        }
        if project_id.is_some() && !is_draft {
            return Err(AppError::Validation(
                "A note's project is editable only while it is a draft".into(),
            ));
        }
        if title.is_some() && current.status == NoteStatus::Archived {
            return Err(AppError::Validation(
                "An archived note cannot be edited — restore it to draft first".into(),
            ));
        }
        if let Some(t) = title {
            require_non_empty("Note title", t.trim())?;
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut qb = QueryBuilder::new();
        qb.set("updated_at", now);
        if let Some(t) = title {
            qb.set("title", t.trim().to_string());
        }
        if let Some(b) = body_md {
            qb.set("body_md", b.to_string());
        }
        if let Some(p) = project_id {
            qb.set("project_id", p.map(|s| s.to_string()));
        }
        if let Some(o) = order_index {
            qb.set("order_index", o);
        }
        // The WHERE goes on LAST so its placeholder index follows every SET.
        qb.where_eq("id", id.to_string());
        let sql = qb.build_update("dev_notes");
        let conn = pool.get()?;
        conn.execute(&sql, qb.params_ref().as_slice())?;
        drop(conn);
        get_note(pool, id)
    })
}

/// Move a note along the lifecycle, stamping the timestamp that belongs to the
/// destination and recording whatever dispatch metadata the caller has.
///
/// The transition is validated against [`NoteStatus::can_transition_to`] — an
/// illegal move is `AppError::Validation`, never a silent no-op. Dispatch
/// fields are write-when-given: passing `None` leaves what is already stored,
/// so a later `result_json` write does not erase the `fleet_session_id` the
/// dispatch stamped.
#[allow(clippy::too_many_arguments)]
pub fn set_status(
    pool: &DbPool,
    id: &str,
    next: NoteStatus,
    dispatch_target: Option<&str>,
    dispatch_key: Option<&str>,
    fleet_session_id: Option<&str>,
    result_json: Option<&str>,
) -> Result<DevNote, AppError> {
    timed_query!("dev_notes", "dev_notes::set_status", {
        let current = get_note(pool, id)?;
        if !current.status.can_transition_to(next) {
            return Err(AppError::Validation(format!(
                "Illegal note transition {} → {}",
                current.status.as_str(),
                next.as_str()
            )));
        }
        if let Some(t) = dispatch_target {
            if !["fleet", "athena_goals"].contains(&t) {
                return Err(AppError::Validation(format!(
                    "Unknown note dispatch target `{t}`"
                )));
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut qb = QueryBuilder::new();
        qb.set("status", next.as_str().to_string());
        qb.set("updated_at", now.clone());
        match next {
            NoteStatus::Published => qb.set("published_at", now.clone()),
            NoteStatus::InProgress => qb.set("started_at", now.clone()),
            NoteStatus::Completed => qb.set("completed_at", now.clone()),
            NoteStatus::Archived => qb.set("archived_at", now.clone()),
            // Restore. The stamps of the previous life are cleared with the
            // dispatch metadata below: a restored draft that still claimed a
            // `completed_at` would render as finished work in every list that
            // reads a timestamp instead of the status.
            NoteStatus::Draft => qb.set("archived_at", None::<String>),
        };
        if next == NoteStatus::Draft {
            qb.set("published_at", None::<String>);
            qb.set("started_at", None::<String>);
            qb.set("completed_at", None::<String>);
            qb.set("dispatch_target", None::<String>);
            qb.set("dispatch_key", None::<String>);
            qb.set("fleet_session_id", None::<String>);
            qb.set("result_json", None::<String>);
        } else {
            if let Some(v) = dispatch_target {
                qb.set("dispatch_target", v.to_string());
            }
            if let Some(v) = dispatch_key {
                qb.set("dispatch_key", v.to_string());
            }
            if let Some(v) = fleet_session_id {
                qb.set("fleet_session_id", v.to_string());
            }
            if let Some(v) = result_json {
                qb.set("result_json", v.to_string());
            }
        }

        // The WHERE goes on LAST so its placeholder index follows every SET.
        qb.where_eq("id", id.to_string());
        let sql = qb.build_update("dev_notes");
        let conn = pool.get()?;
        conn.execute(&sql, qb.params_ref().as_slice())?;
        drop(conn);
        get_note(pool, id)
    })
}

/// Store a run's report on a note WITHOUT moving it — the failed-run case.
///
/// A `result.json` reporting `"failed"` is a report, not a completion: the note
/// stays where it is (`in_progress`) so the operator can read the failure and
/// re-dispatch, and `result_json` carries the why.
pub fn set_result_json(pool: &DbPool, id: &str, result_json: &str) -> Result<DevNote, AppError> {
    timed_query!("dev_notes", "dev_notes::set_result_json", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE dev_notes SET result_json = ?1, updated_at = ?2 WHERE id = ?3",
            params![result_json, now, id],
        )?;
        drop(conn);
        if changed == 0 {
            return Err(AppError::NotFound(format!("Note {id}")));
        }
        get_note(pool, id)
    })
}

/// Delete a note. Allowed ONLY for `draft` or `archived` — see the module note.
pub fn delete_note(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("dev_notes", "dev_notes::delete", {
        let current = get_note(pool, id)?;
        if !matches!(current.status, NoteStatus::Draft | NoteStatus::Archived) {
            return Err(AppError::Validation(format!(
                "A note in status `{}` cannot be deleted — archive it first",
                current.status.as_str()
            )));
        }
        let conn = pool.get()?;
        let deleted = conn.execute("DELETE FROM dev_notes WHERE id = ?1", params![id])?;
        if deleted == 0 {
            // `get_note` above saw it; a sibling writer removed it in between.
            return Err(AppError::NotFound(format!("Note {id}")));
        }
        Ok(())
    })
}

/// Copy a note into a fresh draft: same body, same project, title suffixed
/// `(copy)`. The fork carries NO dispatch metadata and none of the original's
/// timestamps — it is a new requirement that happens to start from old words.
pub fn fork_note(pool: &DbPool, id: &str) -> Result<DevNote, AppError> {
    let source = get_note(pool, id)?;
    let created = create_note(
        pool,
        &format!("{} (copy)", source.title),
        source.project_id.as_deref(),
    )?;
    // The body is set in a second step because `create_note` deliberately has no
    // body parameter: a note is born empty everywhere else in the app, and a
    // fork is the one exception rather than a reason to widen the door.
    update_note(pool, &created.id, None, Some(&source.body_md), None, None)
}

#[cfg(test)]
#[path = "notes_tests.rs"]
mod notes_tests;
