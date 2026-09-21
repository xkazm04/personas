//! Notepad commands — the pad's IPC surface.
//!
//! Adapters, in the repo's sense: validate, make one repo call, map the result.
//! The one piece of policy that lives HERE rather than in the repo is the
//! ten-note cap, because the repo is also the door a fork and a restore come
//! through and each of those spends a slot for a different reason.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::infrastructure::notepad_ingest::sweep_notepad_runs_core;
use crate::db::models::{
    DevNote, DevNoteRun, NoteComment, NotePlanSummary, NotePromotion, NoteReviewVerdict,
    NoteStatus, NoteUnread, NotepadIngestReport,
};
use crate::db::repos::dev::note_comments as comments_repo;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;
use personas_core::events::event_name;
use personas_core::models::serde_util::double_option;
use personas_macros::requires;
use tauri::Emitter;

/// Patch body for `notepad_update_note`. ONE object rather than bare optional
/// args because `project_id` needs three states — leave alone / clear / set —
/// and serde collapses an explicit JSON `null` on a bare `Option<Option<T>>`
/// arg into "absent". `double_option` keeps them apart (same fix as
/// `KnowledgeStructurePatch`).
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body_md: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub project_id: Option<Option<String>>,
    #[serde(default)]
    pub order_index: Option<i64>,
}

/// Refuse when the pad already holds [`repo::NOTE_CAP`] non-archived notes.
///
/// The cap is a working-set bound, and it is checked at every door that ADDS
/// one: create, fork, and restore-from-archive. Archiving is never blocked.
fn guard_cap(state: &AppState) -> Result<(), AppError> {
    if repo::count_active_notes(&state.db)? >= repo::NOTE_CAP {
        return Err(AppError::Validation("note cap reached".into()));
    }
    Ok(())
}

#[tauri::command]
pub fn notepad_list_notes(
    state: State<'_, Arc<AppState>>,
    include_archived: bool,
) -> Result<Vec<DevNote>, AppError> {
    require_auth_sync(&state)?;
    repo::list_notes(&state.db, include_archived)
}

#[tauri::command]
pub fn notepad_create_note(
    state: State<'_, Arc<AppState>>,
    title: String,
    project_id: Option<String>,
) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    guard_cap(&state)?;
    repo::create_note(&state.db, &title, project_id.as_deref())
}

#[tauri::command]
pub fn notepad_update_note(
    state: State<'_, Arc<AppState>>,
    id: String,
    patch: NotePatch,
) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    repo::update_note(
        &state.db,
        &id,
        patch.title.as_deref(),
        patch.body_md.as_deref(),
        patch.project_id.as_ref().map(|o| o.as_deref()),
        patch.order_index,
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn notepad_set_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: NoteStatus,
    dispatch_target: Option<String>,
    dispatch_key: Option<String>,
    fleet_session_id: Option<String>,
    result_json: Option<String>,
) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    // Restoring an archived note puts it back ON the pad, so it spends a slot
    // exactly the way a create does. Without this the cap is trivially defeated
    // by archiving ten notes and restoring them.
    if status == NoteStatus::Draft {
        guard_cap(&state)?;
    }
    repo::set_status(
        &state.db,
        &id,
        status,
        dispatch_target.as_deref(),
        dispatch_key.as_deref(),
        fleet_session_id.as_deref(),
        result_json.as_deref(),
    )
}

#[tauri::command]
pub fn notepad_delete_note(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::delete_note(&state.db, &id)
}

#[tauri::command]
pub fn notepad_fork_note(state: State<'_, Arc<AppState>>, id: String) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    guard_cap(&state)?;
    repo::fork_note(&state.db, &id)
}

// ── The milestone link: a note as a milestone's living brief ───────────────

/// Emit `NOTEPAD_NOTE_CHANGED` for one note. The pad listens for this rather
/// than polling, and every command below that moves a note owes it — the same
/// contract `notepad_ingest_runs` follows.
fn emit_note_changed(app: &AppHandle, note: &DevNote) {
    emit_note_status(app, &note.id, note.status);
}

/// [`emit_note_changed`] for a caller that holds the id and the new status
/// rather than the row — the dispatcher's side effects and the brief mirror.
pub(crate) fn emit_note_status(app: &AppHandle, note_id: &str, status: NoteStatus) {
    if let Err(e) = app.emit(
        event_name::NOTEPAD_NOTE_CHANGED,
        serde_json::json!({ "noteId": note_id, "status": status.as_str() }),
    ) {
        tracing::warn!(event = event_name::NOTEPAD_NOTE_CHANGED, error = %e, "notepad: note-changed emit failed");
    }
}

/// Emit what the milestone→brief mirror did (`repo::update_milestone_tracked`):
/// one `NOTEPAD_NOTE_CHANGED` per lifecycle step, plus the `system` thread row
/// that recorded it. The db crate cannot emit; every caller that can does it
/// through here.
pub(crate) fn emit_brief_moves(app: &AppHandle, moves: &[repo::BriefMove]) {
    for m in moves {
        emit_note_status(app, &m.note_id, m.status);
        if let Some(comment) = m.comment.as_ref() {
            emit_note_comment(app, comment);
        }
    }
}

/// Bind this note to a milestone as its living brief, or unbind it (`None`).
#[tauri::command]
pub fn notepad_link_milestone(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    milestone_id: Option<String>,
) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    let note = repo::link_milestone(&state.db, &id, milestone_id.as_deref())?;
    emit_note_changed(&app, &note);
    Ok(note)
}

/// Promote a note into the milestone it describes.
///
/// Three branches, in the order that does the least: an already-linked note is
/// a no-op; an UNLINKED open milestone on the same project is adopted rather
/// than shadowed by a twin; only when neither holds is a milestone minted from
/// the note's own title and body. `created` says which happened, so the UI can
/// tell "we made you a cut" from "we attached you to the one you had".
///
/// Born `planned`, NOT `active`. The schema's own semantics settle it:
/// `create_milestone` stamps `cut_at` on an `active` birth, so in this schema
/// `active` MEANS cut, and the Ship tab's Certify is what moves
/// `planned → active`. Promoting a note is the operator saying "this is a
/// milestone", not "its scope is frozen" — minting it `active` would hand every
/// promoted note a cut it never took and a scope-creep baseline measured from
/// before any scope existed. The note lands `scoped` with `cut_at` NULL, and
/// Certify walks it to `cut` through `milestones::mirror_to_brief`.
#[tauri::command]
pub fn notepad_promote_note(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<NotePromotion, AppError> {
    require_auth_sync(&state)?;
    let promotion = promote_note_core(&state.db, &id)?;
    emit_note_changed(&app, &promotion.note);
    Ok(promotion)
}

/// Body of [`notepad_promote_note`], minus the IPC envelope and the emit.
///
/// Split out for the same reason `sweep_notepad_runs_core` is: the three
/// branches are the whole behaviour, and a `tauri::State` is not something a
/// unit test can build.
pub(crate) fn promote_note_core(
    pool: &crate::db::DbPool,
    id: &str,
) -> Result<NotePromotion, AppError> {
    let note = repo::get_note(pool, id)?;

    if let Some(milestone_id) = note.milestone_id.as_deref() {
        let milestone = repo::get_milestone_by_id(pool, milestone_id)?;
        return Ok(NotePromotion {
            note,
            milestone,
            created: false,
        });
    }

    let Some(project_id) = note.project_id.as_deref() else {
        return Err(AppError::Validation(
            "Map this note to a project before promoting it — a milestone belongs to a repo".into(),
        ));
    };

    // An open milestone that nothing briefs is the one the operator is already
    // working toward. Adopting it is what he means by "promote"; minting a
    // second cut beside it is not.
    let adoptable = repo::open_milestone_for_project(pool, project_id)?.filter(|m| {
        repo::brief_note_for_milestone(pool, &m.id)
            .ok()
            .flatten()
            .is_none()
    });

    let (milestone, created) = match adoptable {
        Some(m) => (m, false),
        None => (
            repo::create_milestone(
                pool,
                project_id,
                &note.title,
                None,
                Some(&note.body_md),
                Some("planned"),
                None,
            )?,
            true,
        ),
    };

    let note = repo::link_milestone(pool, id, Some(&milestone.id))?;
    Ok(NotePromotion {
        note,
        milestone,
        created,
    })
}

/// Every linked note's milestone + goal counts, in ONE query — the pad's plan
/// strip. Unlinked notes are absent, not zeroed.
#[tauri::command]
pub fn notepad_list_plan_summaries(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<NotePlanSummary>, AppError> {
    require_auth_sync(&state)?;
    repo::list_plan_summaries(&state.db)
}

/// One note's run history, newest first.
#[tauri::command]
pub fn notepad_list_runs(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<DevNoteRun>, AppError> {
    require_auth_sync(&state)?;
    repo::list_runs(&state.db, &id)
}

/// Open a run row for a dispatch that just left. The sweepers close it; nothing
/// else opens one, so a note's history is exactly the dispatches it made.
#[tauri::command]
pub fn notepad_record_run_start(
    state: State<'_, Arc<AppState>>,
    id: String,
    kind: String,
    dispatch_key: Option<String>,
    fleet_session_id: Option<String>,
) -> Result<DevNoteRun, AppError> {
    require_auth_sync(&state)?;
    repo::record_run_start(
        &state.db,
        &id,
        &kind,
        dispatch_key.as_deref(),
        fleet_session_id.as_deref(),
    )
}

/// Run the run-ingest sweeper once, on demand.
///
/// The fleet stale ticker already calls the same door every 30 s; this exists
/// so the pad can ask "is it back yet?" the moment the operator looks at it,
/// instead of the answer depending on where in the tick they landed. Both paths
/// go through the same idempotent core.
#[tauri::command]
pub fn notepad_ingest_runs(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<NotepadIngestReport, AppError> {
    require_auth_sync(&state)?;
    let mut emit = |note_id: &str, status: NoteStatus| {
        if let Err(e) = app.emit(
            event_name::NOTEPAD_NOTE_CHANGED,
            serde_json::json!({ "noteId": note_id, "status": status.as_str() }),
        ) {
            tracing::warn!(event = event_name::NOTEPAD_NOTE_CHANGED, error = %e, "notepad: note-changed emit failed");
        }
    };
    let mut emit_comment = |comment: &NoteComment| emit_note_comment(&app, comment);
    Ok(sweep_notepad_runs_core(
        &state.db,
        &mut emit,
        &mut emit_comment,
    ))
}

/// Accept, edit or reject ONE row of an Athena `note_suggestions` card.
///
/// There is no batch confirm and deliberately so — see the header of
/// `note_suggestions.rs`. Async because it does rusqlite work on both pools and
/// a sync command would do it on the IPC worker thread.
#[tauri::command]
pub async fn notepad_resolve_suggestion(
    state: State<'_, Arc<AppState>>,
    card_id: String,
    row_id: String,
    outcome: String,
    body_md: Option<String>,
) -> Result<DevNote, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    super::note_suggestions::resolve_note_suggestion_core(
        &state.db,
        &state.user_db,
        &card_id,
        &row_id,
        &outcome,
        body_md.as_deref(),
    )
}

// ── The per-note thread (dev_note_comments, e40) ───────────────────────────

/// Run one thread repo call off the IPC worker. The handle is awaited, so a
/// panic in the blocking task reaches the caller as an `AppError` rather than
/// vanishing while the command reports success.
async fn on_db<T, F>(state: &AppState, op: &'static str, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::DbPool) -> Result<T, AppError> + Send + 'static,
{
    let pool = state.db.clone();
    tokio::task::spawn_blocking(move || f(&pool))
        .await
        .map_err(|e| AppError::Internal(format!("{op}: task failed: {e}")))?
}

/// Emit `NOTEPAD_NOTE_COMMENT` with the full row. The thread store and the
/// card bubbles key off this; a failed emit is logged, never fatal — the row
/// is already durable and the next load reads it.
pub(crate) fn emit_note_comment(app: &AppHandle, comment: &NoteComment) {
    if let Err(e) = app.emit(event_name::NOTEPAD_NOTE_COMMENT, comment) {
        tracing::warn!(event = event_name::NOTEPAD_NOTE_COMMENT, error = %e, "notepad: note-comment emit failed");
    }
}

/// One note's thread, oldest first.
#[tauri::command]
#[requires(auth)]
pub async fn notepad_list_comments(
    state: State<'_, Arc<AppState>>,
    note_id: String,
) -> Result<Vec<NoteComment>, AppError> {
    on_db(&state, "notepad_list_comments", move |db| {
        comments_repo::list_comments(db, &note_id)
    })
    .await
}

/// Every note with unread thread entries (absent = nothing unread).
#[tauri::command]
#[requires(auth)]
pub async fn notepad_unread_counts(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<NoteUnread>, AppError> {
    on_db(
        &state,
        "notepad_unread_counts",
        comments_repo::unread_counts,
    )
    .await
}

/// The operator comments on a note. Born read (it is their own words).
#[tauri::command]
#[requires(auth)]
pub async fn notepad_add_comment(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    note_id: String,
    body_md: String,
) -> Result<NoteComment, AppError> {
    let comment = on_db(&state, "notepad_add_comment", move |db| {
        comments_repo::insert_comment(
            db,
            &comments_repo::NewNoteComment::operator_comment(&note_id, &body_md),
        )
    })
    .await?;
    emit_note_comment(&app, &comment);
    Ok(comment)
}

/// Stamp every unread entry of one note read (the popover calls this on open).
#[tauri::command]
#[requires(auth)]
pub async fn notepad_mark_comments_read(
    state: State<'_, Arc<AppState>>,
    note_id: String,
) -> Result<(), AppError> {
    on_db(&state, "notepad_mark_comments_read", move |db| {
        comments_repo::mark_read(db, &note_id).map(|_| ())
    })
    .await
}

/// The operator answers a review entry: `approved` or `rejected`.
///
/// The IPC envelope around [`apply_review_verdict_core`]: run it off the IPC
/// worker, then emit what it wrote — the operator's reason as a new thread
/// entry, the note's move when the rework fired, and the answered review
/// itself (the same id as before: the pad upserts thread rows by id).
#[tauri::command]
#[requires(auth)]
pub async fn notepad_set_review_verdict(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    comment_id: String,
    verdict: NoteReviewVerdict,
    reason: Option<String>,
) -> Result<NoteComment, AppError> {
    let outcome = on_db(&state, "notepad_set_review_verdict", move |db| {
        apply_review_verdict_core(db, &comment_id, verdict, reason.as_deref())
    })
    .await?;
    if let Some(reason) = outcome.reason_comment.as_ref() {
        emit_note_comment(&app, reason);
    }
    if let Some(note) = outcome.reworked.as_ref() {
        emit_note_changed(&app, note);
    }
    emit_note_comment(&app, &outcome.review);
    Ok(outcome.review)
}

/// What [`apply_review_verdict_core`] wrote, for the command to emit.
#[derive(Debug)]
pub(crate) struct ReviewVerdictOutcome {
    /// The answered review, verdict stamped.
    pub review: NoteComment,
    /// The operator's reason, posted to the thread as their own comment.
    pub reason_comment: Option<NoteComment>,
    /// The note, when the rework move fired (`completed → published`).
    pub reworked: Option<DevNote>,
}

/// Answer one review entry.
///
/// **Which answers need a reason.** `pending` is not an answer and is refused.
/// Rejecting a **run** review needs a non-empty reason: it is what the rework
/// run is told, and a bare "no" is how the reject-and-rerun loop ping-pongs.
/// Rejecting a **suggestion-card** review does NOT (Director decision,
/// note-overview-cycle): it rejects every open row of Athena's card — a
/// decision about her proposal, not an instruction to anyone — and it must be
/// one tap. A reason given anyway is still posted, because she reads the
/// thread before she replies. Any other review keeps the strict rule.
///
/// **The rework move.** Rejecting a run review whose note is still
/// `completed`: the previous attempt's artifacts are moved aside
/// (`notepad_ingest::archive_attempt` — without that, the re-dispatched run
/// finds the old `ingested.json` and is never ingested), the reason lands as
/// an operator comment, and the note goes `completed → published`. The pad
/// re-dispatches it to Fleet right after, with the feedback appended to
/// `note.md`. A note that is no longer `completed` (a failed run leaves it
/// `in_progress`; the operator may have archived it) gets the comment and the
/// verdict only — the verdict is a fact about the review, the move is not
/// owed.
///
/// Answering a review with the verdict it already carries is a no-op: no
/// second comment, no second move. Changing an answer is allowed.
pub(crate) fn apply_review_verdict_core(
    pool: &crate::db::DbPool,
    comment_id: &str,
    verdict: NoteReviewVerdict,
    reason: Option<&str>,
) -> Result<ReviewVerdictOutcome, AppError> {
    use crate::db::models::{NoteCommentKind, NoteCommentRef};

    let reason = reason.map(str::trim).filter(|r| !r.is_empty());
    let review = comments_repo::get_comment(pool, comment_id)?;
    if review.kind != NoteCommentKind::Review {
        return Err(AppError::Validation(format!(
            "Note comment {comment_id} is not a review and takes no verdict"
        )));
    }
    let reason_optional = review.ref_kind == Some(NoteCommentRef::SuggestionCard);
    match verdict {
        NoteReviewVerdict::Pending => {
            return Err(AppError::Validation(
                "A review verdict is `approved` or `rejected`, not `pending`".into(),
            ))
        }
        NoteReviewVerdict::Rejected if reason.is_none() && !reason_optional => {
            return Err(AppError::Validation(
                "Rejecting a run review needs a reason".into(),
            ))
        }
        _ => {}
    }
    if review.verdict == Some(verdict) {
        return Ok(ReviewVerdictOutcome {
            review,
            reason_comment: None,
            reworked: None,
        });
    }

    let mut reworked = None;
    let mut reason_comment = None;
    if verdict == NoteReviewVerdict::Rejected {
        let rework = review.ref_kind == Some(NoteCommentRef::Run)
            && repo::get_note(pool, &review.note_id)?.status == NoteStatus::Completed;
        // Files first: if the marker cannot be moved, refuse before anything
        // is written, rather than send back a note whose rerun can never land.
        if rework {
            crate::commands::infrastructure::notepad_ingest::archive_attempt(
                pool,
                &review.note_id,
                review.ref_id.as_deref().unwrap_or("attempt"),
            )?;
        }
        if let Some(reason) = reason {
            reason_comment = Some(comments_repo::insert_comment(
                pool,
                &comments_repo::NewNoteComment::operator_comment(&review.note_id, reason),
            )?);
        }
        if rework {
            reworked = Some(repo::set_status(
                pool,
                &review.note_id,
                NoteStatus::Published,
                None,
                None,
                None,
                None,
            )?);
        }
    }
    let review = comments_repo::set_verdict(pool, comment_id, verdict)?;
    Ok(ReviewVerdictOutcome {
        review,
        reason_comment,
        reworked,
    })
}

/// The three branches of `notepad_promote_note`, driven through the core.
///
/// The one worth pinning is the middle: promoting must ADOPT the project's
/// already-open, unbriefed milestone rather than mint a twin beside it. A
/// promote that always creates would give a repo two "v1" cuts the first time
/// the operator promoted a note into a milestone he had already opened by hand.
#[cfg(test)]
mod promote_tests {
    use super::*;
    use crate::db::DbPool;

    fn pool() -> DbPool {
        crate::db::init_test_db().expect("test db")
    }

    fn project(pool: &DbPool) -> String {
        crate::db::repos::dev::projects::create_project(
            pool, "Personas", "C:/repo", None, None, None, None, None,
        )
        .expect("project")
        .id
    }

    #[test]
    fn promoting_with_no_open_milestone_mints_one_from_the_note() {
        let p = pool();
        let proj = project(&p);
        let note = repo::create_note(&p, "First cut", Some(&proj)).unwrap();
        repo::update_note(
            &p,
            &note.id,
            None,
            Some("## What shipping means"),
            None,
            None,
        )
        .unwrap();

        let out = promote_note_core(&p, &note.id).unwrap();
        assert!(out.created, "nothing to adopt, so a milestone was minted");
        assert_eq!(out.milestone.name, "First cut");
        assert_eq!(
            out.milestone.description.as_deref(),
            Some("## What shipping means"),
            "the note's body becomes the milestone's prose, not its heading"
        );
        assert_eq!(
            out.milestone.status, "planned",
            "promoting NAMES a milestone; Certify is what cuts it"
        );
        assert!(
            out.milestone.cut_at.is_none(),
            "a promoted milestone has taken no cut yet"
        );
        assert_eq!(
            out.note.milestone_id.as_deref(),
            Some(out.milestone.id.as_str())
        );
        assert_eq!(
            out.note.status,
            NoteStatus::Scoped,
            "scoped, not cut — nothing is frozen yet"
        );
    }

    /// The adopted milestone here is `active`, i.e. already CUT. The brief must
    /// say so: a note reading `scoped` against frozen scope states the opposite
    /// of what is true.
    #[test]
    fn promoting_adopts_the_projects_open_unbriefed_milestone() {
        let p = pool();
        let proj = project(&p);
        let existing = crate::db::repos::dev::milestones::create_milestone(
            &p,
            &proj,
            "v1 — the real cut",
            None,
            None,
            Some("active"),
            None,
        )
        .unwrap();
        let note = repo::create_note(&p, "A thought", Some(&proj)).unwrap();

        let out = promote_note_core(&p, &note.id).unwrap();
        assert!(!out.created, "the open milestone is adopted, not shadowed");
        assert_eq!(out.milestone.id, existing.id);
        assert_eq!(
            out.milestone.name, "v1 — the real cut",
            "adopting must not rename the operator's milestone"
        );
        assert_eq!(
            crate::db::repos::dev::milestones::list_milestones_by_project(&p, &proj)
                .unwrap()
                .len(),
            1,
            "no twin cut"
        );
        assert_eq!(
            out.note.status,
            NoteStatus::Cut,
            "the adopted milestone was already cut, so the brief reads cut"
        );
    }

    /// A milestone that ALREADY has a brief is not adoptable — promoting a
    /// second note into the same project mints its own cut rather than fighting
    /// the partial unique index.
    #[test]
    fn a_briefed_milestone_is_not_adoptable() {
        let p = pool();
        let proj = project(&p);
        crate::db::repos::dev::milestones::create_milestone(
            &p,
            &proj,
            "v1",
            None,
            None,
            Some("active"),
            None,
        )
        .unwrap();

        let first = repo::create_note(&p, "first", Some(&proj)).unwrap();
        let first = promote_note_core(&p, &first.id).unwrap();
        assert!(!first.created);

        let second = repo::create_note(&p, "second", Some(&proj)).unwrap();
        let second = promote_note_core(&p, &second.id).unwrap();
        assert!(second.created, "the open milestone is taken");
        assert_ne!(second.milestone.id, first.milestone.id);
        assert_eq!(
            second.milestone.status, "planned",
            "the minted one is named, not cut"
        );
        assert_eq!(second.note.status, NoteStatus::Scoped);
    }

    #[test]
    fn promoting_an_already_linked_note_is_a_no_op() {
        let p = pool();
        let proj = project(&p);
        let note = repo::create_note(&p, "brief", Some(&proj)).unwrap();
        let first = promote_note_core(&p, &note.id).unwrap();
        assert!(first.created);

        let again = promote_note_core(&p, &note.id).unwrap();
        assert!(!again.created);
        assert_eq!(again.milestone.id, first.milestone.id);
        assert_eq!(
            crate::db::repos::dev::milestones::list_milestones_by_project(&p, &proj)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn promoting_an_unmapped_note_is_refused() {
        let p = pool();
        let note = repo::create_note(&p, "homeless", None).unwrap();
        let err = promote_note_core(&p, &note.id).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }
}

/// `apply_review_verdict_core` — the reject-and-rerun loop and the reason
/// rules, driven through the core (a `tauri::State` is not buildable here).
#[cfg(test)]
mod verdict_tests {
    use super::*;
    use crate::db::models::{NoteCommentAuthor, NoteCommentKind, NoteCommentRef};
    use crate::db::DbPool;
    use comments_repo::NewNoteComment;

    fn pool() -> DbPool {
        crate::db::init_test_db().expect("test db")
    }

    /// A note walked to `completed` (unmapped — no run dir to archive), with a
    /// pending run review on its thread.
    fn completed_with_run_review(p: &DbPool) -> Result<(DevNote, NoteComment), AppError> {
        let n = repo::create_note(p, "n", None)?;
        repo::set_status(
            p,
            &n.id,
            NoteStatus::Published,
            Some("fleet"),
            None,
            None,
            None,
        )?;
        let n = repo::set_status(
            p,
            &n.id,
            NoteStatus::Completed,
            None,
            None,
            None,
            Some("{}"),
        )?;
        let review = comments_repo::insert_comment(
            p,
            &NewNoteComment {
                note_id: &n.id,
                author_kind: NoteCommentAuthor::Agent,
                author_name: Some("note-task"),
                kind: NoteCommentKind::Review,
                body_md: "did it",
                ref_kind: Some(NoteCommentRef::Run),
                ref_id: Some("run-1"),
                verdict: None,
            },
        )?;
        Ok((n, review))
    }

    #[test]
    fn rejecting_a_run_review_posts_the_reason_and_sends_the_note_back() -> Result<(), AppError> {
        let p = pool();
        let (n, review) = completed_with_run_review(&p)?;
        let out = apply_review_verdict_core(
            &p,
            &review.id,
            NoteReviewVerdict::Rejected,
            Some("  tests missing  "),
        )?;
        assert_eq!(out.review.verdict, Some(NoteReviewVerdict::Rejected));
        let reason = out.reason_comment.expect("the reason is posted");
        assert_eq!(reason.author_kind, NoteCommentAuthor::Operator);
        assert_eq!(reason.body_md, "tests missing");
        let moved = out.reworked.expect("the note is sent back");
        assert_eq!(moved.status, NoteStatus::Published);
        assert!(moved.completed_at.is_none());
        assert_eq!(
            moved.result_json.as_deref(),
            Some("{}"),
            "the previous report stays"
        );
        assert_eq!(repo::get_note(&p, &n.id)?.status, NoteStatus::Published);

        // The same answer again is a no-op: no second comment, no second move.
        let again =
            apply_review_verdict_core(&p, &review.id, NoteReviewVerdict::Rejected, Some("x"))?;
        assert!(again.reason_comment.is_none() && again.reworked.is_none());
        assert_eq!(comments_repo::list_comments(&p, &n.id)?.len(), 2);
        Ok(())
    }

    #[test]
    fn a_run_reject_needs_a_reason_and_pending_is_not_an_answer() -> Result<(), AppError> {
        let p = pool();
        let (n, review) = completed_with_run_review(&p)?;
        for reason in [None, Some("   ")] {
            assert!(matches!(
                apply_review_verdict_core(&p, &review.id, NoteReviewVerdict::Rejected, reason),
                Err(AppError::Validation(_))
            ));
        }
        assert!(matches!(
            apply_review_verdict_core(&p, &review.id, NoteReviewVerdict::Pending, None),
            Err(AppError::Validation(_))
        ));
        assert_eq!(
            repo::get_note(&p, &n.id)?.status,
            NoteStatus::Completed,
            "a refused verdict moves nothing"
        );
        Ok(())
    }

    /// A run review whose note is no longer `completed` (a failed run leaves it
    /// `in_progress`) records the verdict and the reason, and moves nothing.
    #[test]
    fn a_reject_on_a_note_that_is_not_completed_only_records() -> Result<(), AppError> {
        let p = pool();
        let n = repo::create_note(&p, "n", None)?;
        repo::set_status(&p, &n.id, NoteStatus::Published, None, None, None, None)?;
        repo::set_status(&p, &n.id, NoteStatus::InProgress, None, None, None, None)?;
        let review = comments_repo::insert_comment(
            &p,
            &NewNoteComment {
                note_id: &n.id,
                author_kind: NoteCommentAuthor::Agent,
                author_name: None,
                kind: NoteCommentKind::Review,
                body_md: "failed",
                ref_kind: Some(NoteCommentRef::Run),
                ref_id: Some("run-1"),
                verdict: None,
            },
        )?;
        let out =
            apply_review_verdict_core(&p, &review.id, NoteReviewVerdict::Rejected, Some("why"))?;
        assert!(out.reworked.is_none());
        assert!(out.reason_comment.is_some());
        assert_eq!(repo::get_note(&p, &n.id)?.status, NoteStatus::InProgress);
        Ok(())
    }

    /// Director decision: rejecting a suggestion card is one tap — no reason.
    /// Approving anything changes no status.
    #[test]
    fn a_suggestion_card_reject_needs_no_reason_and_approve_moves_nothing() -> Result<(), AppError>
    {
        let p = pool();
        let n = repo::create_note(&p, "n", None)?;
        let card = comments_repo::insert_comment(
            &p,
            &NewNoteComment {
                note_id: &n.id,
                author_kind: NoteCommentAuthor::Athena,
                author_name: Some("Athena"),
                kind: NoteCommentKind::Review,
                body_md: "- section: x",
                ref_kind: Some(NoteCommentRef::SuggestionCard),
                ref_id: Some("card-1"),
                verdict: None,
            },
        )?;
        let out = apply_review_verdict_core(&p, &card.id, NoteReviewVerdict::Rejected, None)?;
        assert_eq!(out.review.verdict, Some(NoteReviewVerdict::Rejected));
        assert!(out.reason_comment.is_none() && out.reworked.is_none());

        let (done, review) = completed_with_run_review(&p)?;
        let ok = apply_review_verdict_core(&p, &review.id, NoteReviewVerdict::Approved, None)?;
        assert_eq!(ok.review.verdict, Some(NoteReviewVerdict::Approved));
        assert!(ok.reworked.is_none());
        assert_eq!(repo::get_note(&p, &done.id)?.status, NoteStatus::Completed);
        Ok(())
    }
}
