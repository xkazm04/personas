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

use crate::models::{DevNote, DevNoteRun, NotePlanSummary, NoteStatus};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::validation::require_non_empty;
use rusqlite::params;

/// Every column of `dev_notes`, in the order [`row_to_note_raw`] reads them.
/// Named rather than `*` so a column added later is a deliberate edit here and
/// not a silent widening of every SELECT.
const NOTE_COLUMNS: &str = "id, project_id, milestone_id, title, body_md, status, order_index, \
     dispatch_target, dispatch_key, fleet_session_id, agent_id, result_json, \
     published_at, started_at, completed_at, archived_at, created_at, updated_at";

/// The pad's ceiling on NON-ARCHIVED notes. Ten is a working-set bound, not a
/// storage bound: the pad is a desk, and a desk with fifty things on it is a
/// pile. Archiving is always available and never blocked by the cap.
pub const NOTE_CAP: i64 = 10;

row_mapper!(row_to_note_raw -> DevNoteRow {
    id, project_id, milestone_id, title, body_md, status, order_index,
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
    milestone_id: Option<String>,
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
        milestone_id: raw.milestone_id,
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

/// Statuses that occupy a slot on the desk. NOT `status != 'archived'`: a
/// `completed` note is a finished report and a `shipped` one is a milestone
/// that already landed — neither is live work, and counting them would let a
/// handful of finished briefs lock the pad shut.
const ACTIVE_STATUSES: &str = "'draft','published','in_progress','scoped','cut'";

/// Live count of notes occupying a slot — the number the cap is checked
/// against. See [`ACTIVE_STATUSES`].
pub fn count_active_notes(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!("dev_notes", "dev_notes::count_active", {
        let conn = pool.get()?;
        conn.query_row(
            &format!(
                "SELECT COUNT(*) AS active FROM dev_notes WHERE status IN ({ACTIVE_STATUSES})"
            ),
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

/// Statuses in which the body is still the operator's to write.
///
/// `draft` is the pad's own; `scoped` and `cut` are the ship lane's — a note
/// that is a milestone's living brief is EXPECTED to keep growing, and the
/// reason the pad froze a body in the first place (a CLI session may have
/// `note.md` open) does not apply to a brief nobody dispatched.
const BODY_EDITABLE: [NoteStatus; 3] = [NoteStatus::Draft, NoteStatus::Scoped, NoteStatus::Cut];

/// Patch-style update. `Some(None)` on `project_id` unlinks; `None` leaves a
/// field untouched.
///
/// Refuses a `body_md` edit outside [`BODY_EDITABLE`] and a `project_id` edit
/// outside `draft` — see the module note. A `title` edit is allowed in every
/// status except `archived`, because a title is a label on the pad and never
/// reaches the run.
///
/// When the note is a milestone's brief, a `title` / `body_md` write MIRRORS
/// into the milestone's `name` / `description` through
/// [`crate::repos::dev::milestones::set_brief_from_note`] — a direct UPDATE,
/// never `update_milestone`, so the mirror cannot bounce back here.
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
        if body_md.is_some() && !BODY_EDITABLE.contains(&current.status) {
            return Err(AppError::Validation(
                "A note's body is editable only while it is a draft or a live milestone brief — a published note may already be open in a running session".into(),
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

        // The brief mirror. Only when this note IS a milestone's brief, and
        // only for the two columns the milestone actually shows. The callee is
        // a direct UPDATE on `dev_milestones`, so there is no path back into
        // this function and no recursion to guard against.
        if let Some(milestone_id) = current.milestone_id.as_deref() {
            if title.is_some() || body_md.is_some() {
                super::milestones::set_brief_from_note(
                    pool,
                    milestone_id,
                    title.map(str::trim),
                    body_md,
                )?;
            }
        }

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
        // An archived note has TWO restore targets and the link decides which:
        // a linked note comes back as the brief it was, an unlinked one as a
        // draft. The caller passes the target rather than this function
        // guessing, so a UI offering the wrong button is refused here instead
        // of silently landing the note in a status its link contradicts.
        if current.status == NoteStatus::Archived {
            match (next, current.milestone_id.is_some()) {
                (NoteStatus::Scoped, false) => {
                    return Err(AppError::Validation(
                        "This note is not a milestone's brief — restore it to draft".into(),
                    ))
                }
                (NoteStatus::Draft, true) => return Err(AppError::Validation(
                    "This note is a milestone's brief — restore it to scoped, or unlink it first"
                        .into(),
                )),
                _ => {}
            }
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
            NoteStatus::Published => {
                qb.set("published_at", now.clone());
            }
            NoteStatus::InProgress => {
                qb.set("started_at", now.clone());
            }
            NoteStatus::Completed => {
                qb.set("completed_at", now.clone());
            }
            NoteStatus::Archived => {
                qb.set("archived_at", now.clone());
            }
            // Restore. The stamps of the previous life are cleared with the
            // dispatch metadata below: a restored draft that still claimed a
            // `completed_at` would render as finished work in every list that
            // reads a timestamp instead of the status.
            NoteStatus::Draft => {
                qb.set("archived_at", None::<String>);
            }
            // The ship lane. `scoped` is reachable as an archive RESTORE, so it
            // clears `archived_at` for the same reason `draft` does. `cut` and
            // `shipped` stamp nothing of their own: the dates that matter
            // (`cut_at`, `shipped_at`) belong to the milestone, and a second
            // copy on the note is a second thing to keep true.
            NoteStatus::Scoped => {
                qb.set("archived_at", None::<String>);
            }
            NoteStatus::Cut => {}
            // The note's work is over; this is the stamp every "when did it
            // finish" read already looks at.
            NoteStatus::Shipped => {
                qb.set("completed_at", now.clone());
            }
        }
        if next == NoteStatus::Draft {
            qb.set("published_at", None::<String>);
            qb.set("started_at", None::<String>);
            qb.set("completed_at", None::<String>);
            qb.set("dispatch_target", None::<String>);
            qb.set("dispatch_key", None::<String>);
            qb.set("fleet_session_id", None::<String>);
            qb.set("result_json", None::<String>);
            // Draft and "is a milestone's brief" are mutually exclusive by
            // construction. Both doors into `draft` — the archive restore and
            // the `scoped` unlink — end here, so the link is dropped once,
            // rather than once per caller that remembers to.
            qb.set("milestone_id", None::<String>);
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

// ── The milestone link: a note as a milestone's living brief ───────────────

/// Bind a note to a milestone, or unbind it.
///
/// Linking requires the milestone to exist, to belong to the note's OWN
/// project, and to have no brief already. The last of those is also a database
/// invariant (`idx_dev_notes_milestone`, partial unique) — the check here is
/// what turns a constraint violation into a sentence the operator can act on.
///
/// A `draft` becomes `scoped` in the same transaction as the link, because the
/// two facts are one fact: "this note is a brief" and "this note is in the ship
/// lane" can never disagree, and a second statement is a second place for them
/// to.
///
/// And if the milestone was ALREADY cut when the brief arrived (an adopted open
/// milestone, or one Certify cut before anyone wrote a brief for it), the note
/// walks straight on to `cut` in the same transaction. `cut` is not a stage the
/// note passes through on its own schedule — it is a statement about the
/// milestone's scope being frozen, and a brief reading `scoped` against a cut
/// milestone says the opposite of what is true.
///
/// Unlinking (`None`) is allowed from `scoped` only, and lands the note back in
/// `draft`. `cut` and `shipped` refuse: scope hangs off a cut brief, and
/// unlinking would leave it describing nothing.
pub fn link_milestone(
    pool: &DbPool,
    note_id: &str,
    milestone_id: Option<&str>,
) -> Result<DevNote, AppError> {
    timed_query!("dev_notes", "dev_notes::link_milestone", {
        let current = get_note(pool, note_id)?;

        let Some(milestone_id) = milestone_id else {
            // ── unlink ──────────────────────────────────────────────────────
            if current.milestone_id.is_none() {
                return Ok(current);
            }
            if current.status != NoteStatus::Scoped {
                return Err(AppError::Validation(format!(
                    "A `{}` note cannot be unlinked — its milestone already carries scope",
                    current.status.as_str()
                )));
            }
            // `set_status` owns the clearing: → draft drops `milestone_id`
            // along with every stamp of the previous life.
            return set_status(pool, note_id, NoteStatus::Draft, None, None, None, None);
        };

        if current.milestone_id.as_deref() == Some(milestone_id) {
            return Ok(current);
        }
        if current.milestone_id.is_some() {
            return Err(AppError::Validation(
                "This note is already the brief of another milestone — unlink it first".into(),
            ));
        }
        let Some(project_id) = current.project_id.as_deref() else {
            return Err(AppError::Validation(
                "Map this note to a project before making it a milestone's brief".into(),
            ));
        };
        // Ownership is asserted by the QUERY, not by comparing two ids the caller
        // handed over: from this note's project a milestone that is not its own
        // simply does not exist. The one column read here is the one the lane
        // move below needs.
        let was_cut = {
            let conn = pool.get()?;
            match conn.query_row(
                "SELECT cut_at IS NOT NULL AS was_cut FROM dev_milestones
                  WHERE id = ?1 AND project_id = ?2",
                params![milestone_id, project_id],
                |r| r.get::<_, i64>("was_cut"),
            ) {
                Ok(v) => v != 0,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    return Err(AppError::Validation(
                        "That milestone belongs to a different project, or no longer exists".into(),
                    ));
                }
                Err(e) => return Err(AppError::Database(e)),
            }
        };

        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        // ONE transaction: the link and the lane move are one fact. IMMEDIATE
        // because the uniqueness read below informs the write after it.
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let taken: i64 = tx.query_row(
            "SELECT COUNT(*) AS taken FROM dev_notes WHERE milestone_id = ?1 AND id != ?2",
            params![milestone_id, note_id],
            |r| r.get("taken"),
        )?;
        if taken > 0 {
            return Err(AppError::Validation(
                "That milestone already has a brief".into(),
            ));
        }
        tx.execute(
            "UPDATE dev_notes SET milestone_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![note_id, milestone_id, now],
        )?;
        if current.status == NoteStatus::Draft {
            // `cut_at` set means the milestone's scope is already frozen, so the
            // brief is born into `cut` rather than into `scoped`. The ordinary
            // case — a `planned` milestone, which is by definition not yet cut —
            // lands in `scoped` and reaches `cut` through
            // `milestones::mirror_to_brief` when Certify moves it to `active`.
            let lane = if was_cut {
                NoteStatus::Cut
            } else {
                NoteStatus::Scoped
            };
            tx.execute(
                "UPDATE dev_notes SET status = ?2, archived_at = NULL WHERE id = ?1",
                params![note_id, lane.as_str()],
            )?;
        }
        tx.commit()?;
        drop(conn);
        get_note(pool, note_id)
    })
}

/// Mirror a milestone's `name` / `description` onto the note that is its brief.
///
/// A DIRECT update, deliberately: it bypasses the draft-only edit rule (the
/// operator edited the milestone, which is consent for the brief to follow) and
/// it does not call [`update_note`], which would mirror straight back. The
/// no-recursion property is this function's whole shape — do not give it a
/// caller other than `milestones::update_milestone`.
///
/// A no-op when no note is linked.
pub fn set_brief_from_milestone(
    pool: &DbPool,
    milestone_id: &str,
    name: Option<&str>,
    description: Option<&str>,
) -> Result<(), AppError> {
    if name.is_none() && description.is_none() {
        return Ok(());
    }
    timed_query!("dev_notes", "dev_notes::set_brief_from_milestone", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut qb = QueryBuilder::new();
        qb.set("updated_at", now);
        if let Some(n) = name {
            let n = n.trim();
            personas_core::validation::require_non_empty("Milestone name", n)?;
            qb.set("title", n.to_string());
        }
        if let Some(d) = description {
            qb.set("body_md", d.to_string());
        }
        qb.where_eq("milestone_id", milestone_id.to_string());
        let sql = qb.build_update("dev_notes");
        let conn = pool.get()?;
        conn.execute(&sql, qb.params_ref().as_slice())?;
        Ok(())
    })
}

/// The note that is this milestone's brief, if there is one.
///
/// A one-row lookup on the partial unique index `idx_dev_notes_milestone`, so
/// "who briefs this milestone" is a query rather than a scan every caller
/// writes for itself.
pub fn brief_note_for_milestone(
    pool: &DbPool,
    milestone_id: &str,
) -> Result<Option<DevNote>, AppError> {
    timed_query!("dev_notes", "dev_notes::brief_for_milestone", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {NOTE_COLUMNS} FROM dev_notes WHERE milestone_id = ?1"
        ))?;
        let mut rows = stmt.query_map(params![milestone_id], row_to_note)?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(AppError::Database)?)),
            None => Ok(None),
        }
    })
}

// ── dev_note_runs: what this note has been through ─────────────────────────

/// Every column of `dev_note_runs`, in the order [`row_to_note_run`] reads them.
const RUN_COLUMNS: &str = "id, note_id, kind, status, dispatch_key, fleet_session_id, \
     run_dir, summary_json, started_at, completed_at, created_at";

/// The run kinds, mirroring the `dev_note_runs.kind` CHECK.
pub const NOTE_RUN_KINDS: [&str; 3] = ["note_task", "ship_milestone", "athena_goals"];

row_mapper!(row_to_note_run -> DevNoteRun {
    id, note_id, kind, status, dispatch_key, fleet_session_id,
    run_dir, summary_json, started_at, completed_at, created_at,
});

/// A note's runs, newest first.
pub fn list_runs(pool: &DbPool, note_id: &str) -> Result<Vec<DevNoteRun>, AppError> {
    timed_query!("dev_note_runs", "dev_note_runs::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {RUN_COLUMNS} FROM dev_note_runs WHERE note_id = ?1 \
             ORDER BY started_at DESC, rowid DESC"
        ))?;
        let rows = stmt.query_map(params![note_id], row_to_note_run)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Open a run row. The note must exist (the FK says so); `kind` is checked here
/// so a bad value is a sentence rather than a CHECK violation.
pub fn record_run_start(
    pool: &DbPool,
    note_id: &str,
    kind: &str,
    dispatch_key: Option<&str>,
    fleet_session_id: Option<&str>,
) -> Result<DevNoteRun, AppError> {
    if !NOTE_RUN_KINDS.contains(&kind) {
        return Err(AppError::Validation(format!(
            "Unknown note run kind `{kind}`"
        )));
    }
    timed_query!("dev_note_runs", "dev_note_runs::start", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_note_runs
                (id, note_id, kind, status, dispatch_key, fleet_session_id, started_at, created_at)
             VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6, ?6)",
            params![id, note_id, kind, dispatch_key, fleet_session_id, now],
        )?;
        drop(conn);
        get_run(pool, &id)
    })
}

/// Close a run row. `status` is `completed` or `failed`; `running` is refused,
/// because a close that leaves the run open is not a close.
pub fn complete_run(
    pool: &DbPool,
    run_id: &str,
    status: &str,
    summary_json: Option<&str>,
    run_dir: Option<&str>,
) -> Result<DevNoteRun, AppError> {
    if !["completed", "failed"].contains(&status) {
        return Err(AppError::Validation(format!(
            "A note run closes as `completed` or `failed`, not `{status}`"
        )));
    }
    timed_query!("dev_note_runs", "dev_note_runs::complete", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut qb = QueryBuilder::new();
        qb.set("status", status.to_string());
        qb.set("completed_at", now);
        // Write-when-given, the same convention `set_status` follows: a
        // re-close that knows only the outcome must not erase the run dir the
        // first one recorded.
        if let Some(v) = summary_json {
            qb.set("summary_json", v.to_string());
        }
        if let Some(v) = run_dir {
            qb.set("run_dir", v.to_string());
        }
        qb.where_eq("id", run_id.to_string());
        let sql = qb.build_update("dev_note_runs");
        let conn = pool.get()?;
        let changed = conn.execute(&sql, qb.params_ref().as_slice())?;
        drop(conn);
        if changed == 0 {
            return Err(AppError::NotFound(format!("Note run {run_id}")));
        }
        get_run(pool, run_id)
    })
}

/// The newest still-`running` row of one kind, or `None`. The sweepers use it
/// to close the run a dispatch opened rather than minting a second one.
pub fn newest_running_run(
    pool: &DbPool,
    note_id: &str,
    kind: &str,
) -> Result<Option<DevNoteRun>, AppError> {
    timed_query!("dev_note_runs", "dev_note_runs::newest_running", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {RUN_COLUMNS} FROM dev_note_runs
              WHERE note_id = ?1 AND kind = ?2 AND status = 'running'
              ORDER BY started_at DESC, rowid DESC LIMIT 1"
        ))?;
        let mut rows = stmt.query_map(params![note_id, kind], row_to_note_run)?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(AppError::Database)?)),
            None => Ok(None),
        }
    })
}

fn get_run(pool: &DbPool, run_id: &str) -> Result<DevNoteRun, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        &format!("SELECT {RUN_COLUMNS} FROM dev_note_runs WHERE id = ?1"),
        params![run_id],
        row_to_note_run,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Note run {run_id}")),
        other => AppError::Database(other),
    })
}

// ── The desk's plan strip ──────────────────────────────────────────────────

/// Every linked note's milestone, with its goal counts — ONE query.
///
/// The pad draws at most ten notes and each linked one wants a progress bar, so
/// the alternative is ten round trips for a strip the operator glances at.
///
/// `goals_done` mirrors `isComplete` in
/// `src/features/teams/sub_goals/goalStatus.ts:60` — the client normalizes a
/// goal status by trimming, lower-casing and folding `done | completed |
/// complete | skipped` onto `done`, and this predicate is that fold. A drift
/// here shows up as a progress bar that disagrees with the Goals board.
pub fn list_plan_summaries(pool: &DbPool) -> Result<Vec<NotePlanSummary>, AppError> {
    timed_query!("dev_notes", "dev_notes::list_plan_summaries", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT n.id              AS note_id,
                    m.id              AS milestone_id,
                    m.status          AS milestone_status,
                    m.goal            AS goal,
                    m.target_date     AS target_date,
                    m.cut_at          AS cut_at,
                    m.shipped_at      AS shipped_at,
                    COUNT(g.id)       AS goals_total,
                    COALESCE(SUM(
                        CASE WHEN LOWER(TRIM(g.status))
                             IN ('done','completed','complete','skipped')
                        THEN 1 ELSE 0 END
                    ), 0)             AS goals_done
               FROM dev_notes n
               JOIN dev_milestones m ON m.id = n.milestone_id
               -- LEFT so a milestone with no goals still yields a row of
               -- zeroes, and so a membership pointing at a deleted goal is
               -- dropped by COUNT(g.id) rather than counted as scope.
               LEFT JOIN dev_milestone_items i
                      ON i.milestone_id = m.id AND i.item_kind = 'goal'
               LEFT JOIN dev_goals g ON g.id = i.item_id
              WHERE n.milestone_id IS NOT NULL
              GROUP BY n.id, m.id
              ORDER BY n.order_index, n.created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(NotePlanSummary {
                note_id: row.get("note_id")?,
                milestone_id: row.get("milestone_id")?,
                milestone_status: row.get("milestone_status")?,
                goal: row.get("goal")?,
                target_date: row.get("target_date")?,
                cut_at: row.get("cut_at")?,
                shipped_at: row.get("shipped_at")?,
                goals_total: row.get::<_, i64>("goals_total")?.max(0) as u32,
                goals_done: row.get::<_, i64>("goals_done")?.max(0) as u32,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

#[cfg(test)]
#[path = "notes_tests.rs"]
mod notes_tests;
