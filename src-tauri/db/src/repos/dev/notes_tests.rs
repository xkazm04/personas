//! `dev_notes` repo tests.
//!
//! Included from `notes.rs` via `#[path]` so `use super::*` reaches the repo's
//! private items exactly as an inline `mod tests` would.

use super::*;
use crate::repos::dev::projects::create_project;

fn pool() -> DbPool {
    crate::init_test_db().expect("test db")
}

fn project(pool: &DbPool, name: &str) -> String {
    create_project(
        pool,
        name,
        &format!("/tmp/{name}"),
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap()
    .id
}

#[test]
fn create_lists_and_orders_notes() {
    let p = pool();
    let a = create_note(&p, "  first  ", None).unwrap();
    let b = create_note(&p, "second", None).unwrap();
    assert_eq!(a.title, "first", "title is trimmed at the door");
    assert_eq!(a.status, NoteStatus::Draft);
    assert_eq!(a.body_md, "");
    assert!(a.project_id.is_none());
    assert!(b.order_index > a.order_index, "order_index climbs");

    let listed = list_notes(&p, false).unwrap();
    assert_eq!(
        listed.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(),
        vec![a.id.as_str(), b.id.as_str()]
    );
    assert_eq!(count_active_notes(&p).unwrap(), 2);
}

#[test]
fn create_refuses_a_blank_title() {
    let p = pool();
    let err = create_note(&p, "   ", None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
}

#[test]
fn archived_notes_are_hidden_from_the_default_read_and_from_the_count() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();
    set_status(&p, &n.id, NoteStatus::Archived, None, None, None, None).unwrap();

    assert!(list_notes(&p, false).unwrap().is_empty());
    assert_eq!(list_notes(&p, true).unwrap().len(), 1);
    assert_eq!(
        count_active_notes(&p).unwrap(),
        0,
        "an archived note does not occupy a slot"
    );
}

#[test]
fn body_and_project_are_editable_only_while_draft() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let n = create_note(&p, "one", None).unwrap();

    let n = update_note(&p, &n.id, None, Some("# body"), Some(Some(&proj)), None).unwrap();
    assert_eq!(n.body_md, "# body");
    assert_eq!(n.project_id.as_deref(), Some(proj.as_str()));

    let n = set_status(
        &p,
        &n.id,
        NoteStatus::Published,
        Some("fleet"),
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(n.status, NoteStatus::Published);

    let err = update_note(&p, &n.id, None, Some("edited"), None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "body: got {err:?}");
    let err = update_note(&p, &n.id, None, None, Some(None), None).unwrap_err();
    assert!(
        matches!(err, AppError::Validation(_)),
        "project: got {err:?}"
    );

    // The body on disk is unchanged — the refusal is not a partial write.
    assert_eq!(get_note(&p, &n.id).unwrap().body_md, "# body");

    // Title still moves, because a title never reaches the run.
    let n = update_note(&p, &n.id, Some("renamed"), None, None, None).unwrap();
    assert_eq!(n.title, "renamed");
}

#[test]
fn an_archived_note_refuses_even_a_title_edit() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();
    let n = set_status(&p, &n.id, NoteStatus::Archived, None, None, None, None).unwrap();
    let err = update_note(&p, &n.id, Some("renamed"), None, None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
}

#[test]
fn set_status_refuses_an_illegal_transition_and_leaves_the_row_alone() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();
    // draft → completed is not in the table.
    let err = set_status(&p, &n.id, NoteStatus::Completed, None, None, None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    let after = get_note(&p, &n.id).unwrap();
    assert_eq!(after.status, NoteStatus::Draft);
    assert!(after.completed_at.is_none());
}

#[test]
fn set_status_stamps_the_timestamp_belonging_to_the_destination() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();

    let n = set_status(
        &p,
        &n.id,
        NoteStatus::Published,
        Some("fleet"),
        Some(&format!("note:{}", n.id)),
        None,
        None,
    )
    .unwrap();
    assert!(n.published_at.is_some());
    assert!(n.started_at.is_none());
    assert_eq!(n.dispatch_target.as_deref(), Some("fleet"));
    assert!(n.dispatch_key.as_deref().unwrap().starts_with("note:"));

    let n = set_status(
        &p,
        &n.id,
        NoteStatus::InProgress,
        None,
        None,
        Some("sess-1"),
        None,
    )
    .unwrap();
    assert!(n.started_at.is_some());
    assert_eq!(n.fleet_session_id.as_deref(), Some("sess-1"));
    assert_eq!(
        n.dispatch_target.as_deref(),
        Some("fleet"),
        "a None argument leaves the stored dispatch metadata alone"
    );

    let n = set_status(
        &p,
        &n.id,
        NoteStatus::Completed,
        None,
        None,
        None,
        Some(r#"{"schema_version":1}"#),
    )
    .unwrap();
    assert!(n.completed_at.is_some());
    assert_eq!(n.result_json.as_deref(), Some(r#"{"schema_version":1}"#));
    assert_eq!(n.fleet_session_id.as_deref(), Some("sess-1"));
}

#[test]
fn set_status_refuses_an_unknown_dispatch_target() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();
    let err = set_status(
        &p,
        &n.id,
        NoteStatus::Published,
        Some("carrier_pigeon"),
        None,
        None,
        None,
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
}

#[test]
fn restoring_to_draft_clears_the_previous_lifes_stamps_and_dispatch() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();
    let n = set_status(
        &p,
        &n.id,
        NoteStatus::Published,
        Some("fleet"),
        Some("note:x"),
        Some("sess-1"),
        None,
    )
    .unwrap();
    let n = set_status(
        &p,
        &n.id,
        NoteStatus::Completed,
        None,
        None,
        None,
        Some("{}"),
    )
    .unwrap();
    let n = set_status(&p, &n.id, NoteStatus::Archived, None, None, None, None).unwrap();
    let n = set_status(&p, &n.id, NoteStatus::Draft, None, None, None, None).unwrap();

    assert_eq!(n.status, NoteStatus::Draft);
    for (label, v) in [
        ("published_at", &n.published_at),
        ("started_at", &n.started_at),
        ("completed_at", &n.completed_at),
        ("archived_at", &n.archived_at),
        ("dispatch_target", &n.dispatch_target),
        ("dispatch_key", &n.dispatch_key),
        ("fleet_session_id", &n.fleet_session_id),
        ("result_json", &n.result_json),
    ] {
        assert!(v.is_none(), "{label} must be cleared on restore, got {v:?}");
    }
}

/// Delete takes ANY status now (the running-session guard lives in the pad),
/// and a live note's thread and run ledger go with it in the same statement.
#[test]
fn delete_takes_any_status_and_cascades_thread_and_runs() -> Result<(), AppError> {
    use crate::repos::dev::note_comments::{insert_comment, list_comments, NewNoteComment};
    let p = pool();
    let draft = create_note(&p, "d", None)?;
    delete_note(&p, &draft.id)?;
    assert!(matches!(
        get_note(&p, &draft.id).unwrap_err(),
        AppError::NotFound(_)
    ));

    for target in [
        NoteStatus::Published,
        NoteStatus::InProgress,
        NoteStatus::Completed,
    ] {
        let n = create_note(&p, "live", None)?;
        set_status(&p, &n.id, NoteStatus::Published, None, None, None, None)?;
        if target != NoteStatus::Published {
            set_status(&p, &n.id, NoteStatus::InProgress, None, None, None, None)?;
        }
        if target == NoteStatus::Completed {
            set_status(&p, &n.id, NoteStatus::Completed, None, None, None, None)?;
        }
        record_run_start(&p, &n.id, "note_task", None, None)?;
        insert_comment(&p, &NewNoteComment::operator_comment(&n.id, "hi"))?;
        delete_note(&p, &n.id)?;
        assert!(
            matches!(get_note(&p, &n.id).unwrap_err(), AppError::NotFound(_)),
            "a {target:?} note deletes"
        );
        assert!(list_runs(&p, &n.id)?.is_empty(), "runs cascade");
        assert!(list_comments(&p, &n.id)?.is_empty(), "thread cascades");
    }

    assert!(matches!(
        delete_note(&p, "nope").unwrap_err(),
        AppError::NotFound(_)
    ));
    Ok(())
}

/// The rework move: `completed → published` wipes the previous attempt's
/// stamps but keeps its report and its dispatch metadata — the pad
/// re-dispatches to the same target right after, and the next ingest
/// overwrites `result_json`.
#[test]
fn rework_clears_the_attempt_stamps_and_keeps_report_and_dispatch() -> Result<(), AppError> {
    let p = pool();
    let n = create_note(&p, "n", None)?;
    set_status(
        &p,
        &n.id,
        NoteStatus::Published,
        Some("fleet"),
        Some("note:k"),
        Some("fs-1"),
        None,
    )?;
    set_status(&p, &n.id, NoteStatus::InProgress, None, None, None, None)?;
    let done = set_status(
        &p,
        &n.id,
        NoteStatus::Completed,
        None,
        None,
        None,
        Some(r#"{"status":"completed"}"#),
    )?;
    let first_published = done.published_at.clone();
    assert!(done.completed_at.is_some());

    let back = set_status(&p, &n.id, NoteStatus::Published, None, None, None, None)?;
    assert_eq!(back.status, NoteStatus::Published);
    assert!(
        back.completed_at.is_none(),
        "the attempt's completion is gone"
    );
    assert!(back.started_at.is_none(), "the attempt's start is gone");
    assert!(back.published_at.is_some());
    assert_ne!(back.published_at, first_published, "re-publish re-stamps");
    assert_eq!(
        back.result_json.as_deref(),
        Some(r#"{"status":"completed"}"#)
    );
    assert_eq!(back.dispatch_target.as_deref(), Some("fleet"));
    assert_eq!(back.dispatch_key.as_deref(), Some("note:k"));
    Ok(())
}

#[test]
fn fork_copies_the_body_and_project_but_none_of_the_run_state() {
    let p = pool();
    let proj = project(&p, "repo-b");
    let n = create_note(&p, "original", Some(&proj)).unwrap();
    update_note(&p, &n.id, None, Some("the requirement"), None, None).unwrap();
    let n = set_status(
        &p,
        &n.id,
        NoteStatus::Published,
        Some("fleet"),
        Some("note:x"),
        Some("sess-9"),
        None,
    )
    .unwrap();

    let fork = fork_note(&p, &n.id).unwrap();
    assert_eq!(fork.title, "original (copy)");
    assert_eq!(fork.body_md, "the requirement");
    assert_eq!(fork.project_id.as_deref(), Some(proj.as_str()));
    assert_eq!(fork.status, NoteStatus::Draft);
    assert!(fork.dispatch_target.is_none());
    assert!(fork.fleet_session_id.is_none());
    assert!(fork.published_at.is_none());
    assert_ne!(fork.id, n.id);
}

#[test]
fn deleting_the_project_orphans_the_note_rather_than_the_note_dying_with_it() -> Result<(), AppError>
{
    let p = pool();
    let proj = project(&p, "repo-c");
    let n = create_note(&p, "one", Some(&proj)).unwrap();
    {
        let conn = p.get()?;
        conn.execute("DELETE FROM dev_projects WHERE id = ?1", params![proj])?;
    }
    let after = get_note(&p, &n.id).unwrap();
    assert!(
        after.project_id.is_none(),
        "ON DELETE SET NULL — the thinking outlives the project row"
    );
    Ok(())
}

#[test]
fn get_note_reports_not_found_for_an_unknown_id() {
    let p = pool();
    assert!(matches!(
        get_note(&p, "nope").unwrap_err(),
        AppError::NotFound(_)
    ));
}

#[test]
fn update_can_reorder_without_touching_anything_else() {
    let p = pool();
    let a = create_note(&p, "a", None).unwrap();
    let b = create_note(&p, "b", None).unwrap();
    update_note(&p, &b.id, None, None, None, Some(-1)).unwrap();
    let listed = list_notes(&p, false).unwrap();
    assert_eq!(
        listed.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(),
        vec![b.id.as_str(), a.id.as_str()],
        "order_index drives the pad's order"
    );
}

/// Tripwire for the one client copy of the cap (client-rule-mirroring, rung e):
/// `src/api/notepad.ts` holds `NOTE_CAP = 10` so the pad can grey out `+` before
/// the round-trip. When this number moves, that file moves in the same commit.
#[test]
fn note_cap_is_ten_and_the_client_copy_lives_in_src_api_notepad_ts() {
    assert_eq!(
        NOTE_CAP, 10,
        "NOTE_CAP changed - update NOTE_CAP in src/api/notepad.ts in the same commit"
    );
}

// ── The milestone link ──────────────────────────────────────────────────────

use crate::repos::dev::milestones::{
    create_milestone, get_milestone_by_id, set_milestone_item, update_milestone,
    update_milestone_tracked,
};

fn milestone(pool: &DbPool, project_id: &str, name: &str) -> String {
    create_milestone(pool, project_id, name, None, None, Some("planned"), None)
        .unwrap()
        .id
}

/// A linked draft. The shape almost every test below starts from.
fn linked(pool: &DbPool, project_id: &str, title: &str, milestone_id: &str) -> DevNote {
    let n = create_note(pool, title, Some(project_id)).unwrap();
    link_milestone(pool, &n.id, Some(milestone_id)).unwrap()
}

/// The cap is a LIVE-work bound. `completed` and `shipped` are finished reports
/// and `archived` is off the desk — none of the three may hold a slot, or a
/// handful of finished briefs locks the pad shut.
#[test]
fn the_cap_counts_only_live_notes() {
    let p = pool();
    let proj = project(&p, "repo-a");

    let done = create_note(&p, "done", None).unwrap();
    set_status(&p, &done.id, NoteStatus::Published, None, None, None, None).unwrap();
    set_status(&p, &done.id, NoteStatus::Completed, None, None, None, None).unwrap();

    let gone = create_note(&p, "gone", None).unwrap();
    set_status(&p, &gone.id, NoteStatus::Archived, None, None, None, None).unwrap();

    let m = milestone(&p, &proj, "M1");
    let shipped = linked(&p, &proj, "shipped", &m);
    set_status(&p, &shipped.id, NoteStatus::Cut, None, None, None, None).unwrap();
    set_status(&p, &shipped.id, NoteStatus::Shipped, None, None, None, None).unwrap();

    let live = create_note(&p, "live", None).unwrap();

    assert_eq!(
        count_active_notes(&p).unwrap(),
        1,
        "only the live draft occupies a slot"
    );
    assert_eq!(get_note(&p, &live.id).unwrap().status, NoteStatus::Draft);
}

#[test]
fn linking_a_draft_moves_it_to_scoped_in_the_same_write() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "brief", &m);

    assert_eq!(n.milestone_id.as_deref(), Some(m.as_str()));
    assert_eq!(
        n.status,
        NoteStatus::Scoped,
        "a note that is a brief is in the ship lane; the two facts are one fact"
    );
}

#[test]
fn linking_refuses_a_milestone_from_another_project() {
    let p = pool();
    let a = project(&p, "repo-a");
    let b = project(&p, "repo-b");
    let m = milestone(&p, &b, "B1");
    let n = create_note(&p, "brief", Some(&a)).unwrap();

    let err = link_milestone(&p, &n.id, Some(&m)).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    assert!(get_note(&p, &n.id).unwrap().milestone_id.is_none());
    assert_eq!(get_note(&p, &n.id).unwrap().status, NoteStatus::Draft);
}

#[test]
fn linking_refuses_an_unmapped_note_and_a_milestone_that_already_has_a_brief() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");

    let orphan = create_note(&p, "unmapped", None).unwrap();
    let err = link_milestone(&p, &orphan.id, Some(&m)).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "unmapped: {err:?}");

    linked(&p, &proj, "first", &m);
    let second = create_note(&p, "second", Some(&proj)).unwrap();
    let err = link_milestone(&p, &second.id, Some(&m)).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "taken: {err:?}");
    assert_eq!(get_note(&p, &second.id).unwrap().status, NoteStatus::Draft);
}

#[test]
fn a_note_already_linked_elsewhere_is_refused_and_a_relink_to_the_same_one_is_a_no_op() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m1 = milestone(&p, &proj, "M1");
    let m2 = milestone(&p, &proj, "M2");
    let n = linked(&p, &proj, "brief", &m1);

    let again = link_milestone(&p, &n.id, Some(&m1)).unwrap();
    assert_eq!(again.milestone_id.as_deref(), Some(m1.as_str()));

    let err = link_milestone(&p, &n.id, Some(&m2)).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
}

/// Unlinking is the ONE exit from the ship lane, and it closes once the
/// milestone has been cut: scope hangs off a cut brief.
#[test]
fn unlinking_is_allowed_from_scoped_and_refused_from_cut() {
    let p = pool();
    let proj = project(&p, "repo-a");

    let m1 = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "brief", &m1);
    let n = link_milestone(&p, &n.id, None).unwrap();
    assert!(n.milestone_id.is_none());
    assert_eq!(n.status, NoteStatus::Draft);

    let m2 = milestone(&p, &proj, "M2");
    let cut = linked(&p, &proj, "cut brief", &m2);
    set_status(&p, &cut.id, NoteStatus::Cut, None, None, None, None).unwrap();
    let err = link_milestone(&p, &cut.id, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    assert_eq!(
        get_note(&p, &cut.id).unwrap().milestone_id.as_deref(),
        Some(m2.as_str())
    );
}

/// An archived note has two restore targets, and the caller must pass the one
/// the link implies — otherwise a UI offering the wrong button lands the note
/// in a status its own column contradicts.
#[test]
fn the_archive_restore_target_follows_the_link() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");

    let brief = linked(&p, &proj, "brief", &m);
    set_status(&p, &brief.id, NoteStatus::Archived, None, None, None, None).unwrap();
    let err = set_status(&p, &brief.id, NoteStatus::Draft, None, None, None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "linked: {err:?}");
    let back = set_status(&p, &brief.id, NoteStatus::Scoped, None, None, None, None).unwrap();
    assert_eq!(back.status, NoteStatus::Scoped);
    assert!(back.archived_at.is_none());
    assert_eq!(back.milestone_id.as_deref(), Some(m.as_str()));

    let plain = create_note(&p, "plain", None).unwrap();
    set_status(&p, &plain.id, NoteStatus::Archived, None, None, None, None).unwrap();
    let err = set_status(&p, &plain.id, NoteStatus::Scoped, None, None, None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "unlinked: {err:?}");
    let back = set_status(&p, &plain.id, NoteStatus::Draft, None, None, None, None).unwrap();
    assert_eq!(back.status, NoteStatus::Draft);
}

/// The body is frozen for a dispatched note and OPEN for a brief: a milestone's
/// brief is expected to keep growing, and no CLI session has it open.
#[test]
fn a_brief_stays_editable_through_scoped_and_cut() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "brief", &m);

    let n = update_note(&p, &n.id, None, Some("## scoped body"), None, None).unwrap();
    assert_eq!(n.body_md, "## scoped body");

    let n = set_status(&p, &n.id, NoteStatus::Cut, None, None, None, None).unwrap();
    let n = update_note(&p, &n.id, None, Some("## cut body"), None, None).unwrap();
    assert_eq!(n.body_md, "## cut body");

    let n = set_status(&p, &n.id, NoteStatus::Shipped, None, None, None, None).unwrap();
    let err = update_note(&p, &n.id, None, Some("## too late"), None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "shipped: {err:?}");
}

/// The brief mirror runs in BOTH directions and neither side re-enters the
/// other: `set_brief_from_note` and `set_brief_from_milestone` are direct
/// UPDATEs, so a write through one door lands exactly once.
#[test]
fn the_brief_syncs_both_ways_without_recursion() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "First cut", &m);

    // note → milestone
    update_note(
        &p,
        &n.id,
        Some("Renamed cut"),
        Some("## What shipping means"),
        None,
        None,
    )
    .unwrap();
    let ms = get_milestone_by_id(&p, &m).unwrap();
    assert_eq!(ms.name, "Renamed cut");
    assert_eq!(ms.description.as_deref(), Some("## What shipping means"));

    // milestone → note
    update_milestone(
        &p,
        &m,
        Some("Cut from the tab"),
        None,
        Some("## Rewritten in Ship"),
        None,
        None,
        None,
    )
    .unwrap();
    let after = get_note(&p, &n.id).unwrap();
    assert_eq!(after.title, "Cut from the tab");
    assert_eq!(after.body_md, "## Rewritten in Ship");

    // And the round trip settled: the milestone still reads what the tab wrote,
    // rather than having been bounced back by the note's own mirror.
    let ms = get_milestone_by_id(&p, &m).unwrap();
    assert_eq!(ms.name, "Cut from the tab");
    assert_eq!(ms.description.as_deref(), Some("## Rewritten in Ship"));
}

/// The lifecycle mirror: the milestone's cut and ship pull the brief along, so
/// every door that moves a milestone gets it without knowing it exists.
#[test]
fn cutting_and_shipping_a_milestone_moves_its_brief() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "brief", &m);
    assert_eq!(n.status, NoteStatus::Scoped);

    update_milestone(&p, &m, None, None, None, Some("active"), None, None).unwrap();
    assert_eq!(get_note(&p, &n.id).unwrap().status, NoteStatus::Cut);

    update_milestone(&p, &m, None, None, None, Some("shipped"), None, None).unwrap();
    let after = get_note(&p, &n.id).unwrap();
    assert_eq!(after.status, NoteStatus::Shipped);
    assert!(after.completed_at.is_some());
}

/// Every step the mirror takes is handed back as a `BriefMove` (the caller
/// emits) AND recorded as a `system` status row on the note's thread (every
/// door gets the row, whether or not it can emit), one per transition.
#[test]
fn the_mirror_returns_its_moves_and_records_each_on_the_thread() -> Result<(), AppError> {
    use crate::models::{NoteCommentKind, NoteCommentRef};
    use crate::repos::dev::note_comments::list_comments;
    let p = pool();
    let proj = project(&p, "repo-a");

    let m = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "brief", &m);
    let (_, moves) =
        update_milestone_tracked(&p, &m, None, None, None, Some("active"), None, None)?;
    assert_eq!(moves.len(), 1);
    assert_eq!(moves[0].note_id, n.id);
    assert_eq!(moves[0].status, NoteStatus::Cut);
    assert!(
        moves[0].comment.is_some(),
        "the move carries its thread row"
    );

    let (_, moves) =
        update_milestone_tracked(&p, &m, None, None, None, Some("shipped"), None, None)?;
    assert_eq!(
        moves.iter().map(|m| m.status).collect::<Vec<_>>(),
        vec![NoteStatus::Shipped]
    );
    let thread = list_comments(&p, &n.id)?;
    let tokens: Vec<&str> = thread
        .iter()
        .filter(|c| c.kind == NoteCommentKind::System && c.ref_kind == Some(NoteCommentRef::Status))
        .filter_map(|c| c.ref_id.as_deref())
        .collect();
    assert_eq!(tokens, vec!["cut", "shipped"]);

    // A text-only edit moves nothing and records nothing.
    let (_, moves) =
        update_milestone_tracked(&p, &m, Some("M1 renamed"), None, None, None, None, None)?;
    assert!(moves.is_empty());
    assert_eq!(list_comments(&p, &n.id)?.len(), 2);
    Ok(())
}

/// The lane a link lands in is decided by the milestone's `cut_at`, not by the
/// link itself. `planned` has none, so the brief is `scoped` and Certify walks
/// it on; `active` already has one (`create_milestone` stamps it at an active
/// birth), so a brief arriving afterwards is born `cut` — a note reading
/// `scoped` against frozen scope would state the opposite of what is true.
#[test]
fn the_link_lands_in_cut_when_the_milestone_is_already_cut_and_scoped_when_it_is_not() {
    let p = pool();
    let proj = project(&p, "repo-a");

    let planned = milestone(&p, &proj, "not yet cut");
    assert!(get_milestone_by_id(&p, &planned).unwrap().cut_at.is_none());
    let a = linked(&p, &proj, "brief of a plan", &planned);
    assert_eq!(a.status, NoteStatus::Scoped);

    let cut = create_milestone(&p, &proj, "born active", None, None, Some("active"), None)
        .unwrap()
        .id;
    assert!(get_milestone_by_id(&p, &cut).unwrap().cut_at.is_some());
    let b = linked(&p, &proj, "brief of a cut", &cut);
    assert_eq!(
        b.status,
        NoteStatus::Cut,
        "the cut predates the link, so the brief is born into it"
    );

    // And Certify on the planned one is what moves the first note along.
    update_milestone(&p, &planned, None, None, None, Some("active"), None, None).unwrap();
    assert_eq!(get_note(&p, &a.id).unwrap().status, NoteStatus::Cut);
}

/// The ship mirror still has to cope with a brief that is only `scoped` when its
/// milestone ships — reachable because `mirror_to_brief` is best-effort, so a
/// cut whose mirror was refused leaves the note behind. The table has no
/// `scoped → shipped` edge and should not; the mirror walks through `cut`,
/// which is the truth (`update_milestone` refuses shipping a milestone that was
/// never cut).
#[test]
fn shipping_walks_a_still_scoped_brief_through_cut() -> Result<(), Box<dyn std::error::Error>> {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "brief", &m);
    assert_eq!(n.status, NoteStatus::Scoped);

    // Cut the milestone WITHOUT the note following it, the way a refused mirror
    // leaves things: stamp the milestone directly, then ship it.
    {
        let conn = p.get()?;
        conn.execute(
            "UPDATE dev_milestones SET status = 'active', cut_at = '2026-01-01T00:00:00Z' WHERE id = ?1",
            params![m],
        )
        .unwrap();
    }
    assert_eq!(get_note(&p, &n.id).unwrap().status, NoteStatus::Scoped);

    update_milestone(&p, &m, None, None, None, Some("shipped"), None, None).unwrap();
    assert_eq!(get_note(&p, &n.id).unwrap().status, NoteStatus::Shipped);
    Ok(())
}

// ── dev_note_runs ───────────────────────────────────────────────────────────

#[test]
fn a_run_opens_running_closes_once_and_lists_newest_first() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();

    let first = record_run_start(&p, &n.id, "note_task", Some("note:x"), Some("sess-1")).unwrap();
    assert_eq!(first.status, "running");
    assert_eq!(first.dispatch_key.as_deref(), Some("note:x"));
    assert!(first.completed_at.is_none());

    let open = newest_running_run(&p, &n.id, "note_task").unwrap().unwrap();
    assert_eq!(open.id, first.id);
    assert!(
        newest_running_run(&p, &n.id, "ship_milestone")
            .unwrap()
            .is_none(),
        "the lookup is per kind"
    );

    let closed = complete_run(
        &p,
        &first.id,
        "completed",
        Some(r#"{"ok":1}"#),
        Some("C:/r"),
    )
    .unwrap();
    assert_eq!(closed.status, "completed");
    assert_eq!(closed.summary_json.as_deref(), Some(r#"{"ok":1}"#));
    assert_eq!(closed.run_dir.as_deref(), Some("C:/r"));
    assert!(closed.completed_at.is_some());
    assert!(newest_running_run(&p, &n.id, "note_task")
        .unwrap()
        .is_none());

    let second = record_run_start(&p, &n.id, "ship_milestone", None, None).unwrap();
    let runs = list_runs(&p, &n.id).unwrap();
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].id, second.id, "newest first");
}

#[test]
fn a_run_refuses_an_unknown_kind_and_an_unknown_close_status() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();
    let err = record_run_start(&p, &n.id, "telepathy", None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "kind: {err:?}");

    let run = record_run_start(&p, &n.id, "athena_goals", None, None).unwrap();
    let err = complete_run(&p, &run.id, "running", None, None).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "status: {err:?}");
}

/// Deleting a note takes its history with it (`ON DELETE CASCADE`) — a ledger
/// row addressed to a note that no longer exists is not history, it is debris.
#[test]
fn deleting_a_note_cascades_its_runs() {
    let p = pool();
    let n = create_note(&p, "one", None).unwrap();
    record_run_start(&p, &n.id, "note_task", None, None).unwrap();
    delete_note(&p, &n.id).unwrap();
    assert!(list_runs(&p, &n.id).unwrap().is_empty());
}

// ── The plan strip ──────────────────────────────────────────────────────────

/// `goals_done` mirrors the client's `isComplete`
/// (`src/features/teams/sub_goals/goalStatus.ts:60`), which folds
/// `done | completed | complete | skipped` onto done — so a goal stored as
/// `skipped` counts and one stored as `blocked` does not.
#[test]
fn list_plan_summaries_counts_goals_the_way_the_client_does() {
    use crate::repos::dev::goals::create_goal;

    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");
    let n = linked(&p, &proj, "brief", &m);

    for (title, status) in [
        ("done one", "done"),
        ("done two", "completed"),
        ("done three", "  SKIPPED  "),
        ("still open", "open"),
        ("blocked", "blocked"),
    ] {
        let g = create_goal(&p, &proj, title, None, None, Some(status), None, None).unwrap();
        set_milestone_item(&p, &m, "goal", &g.id, "core", None, None).unwrap();
    }
    // A membership pointing at a goal that no longer exists must not count as
    // scope — the LEFT JOIN drops it and COUNT(g.id) skips the NULL.
    set_milestone_item(&p, &m, "goal", "ghost-goal", "core", None, None).unwrap();

    let rows = list_plan_summaries(&p).unwrap();
    assert_eq!(rows.len(), 1, "only linked notes appear");
    let row = &rows[0];
    assert_eq!(row.note_id, n.id);
    assert_eq!(row.milestone_id, m);
    assert_eq!(row.milestone_status, "planned");
    assert_eq!(row.goals_total, 5, "the orphan membership is not scope");
    assert_eq!(row.goals_done, 3);

    // An unlinked note is ABSENT, not zeroed.
    create_note(&p, "unlinked", Some(&proj)).unwrap();
    assert_eq!(list_plan_summaries(&p).unwrap().len(), 1);
}

#[test]
fn a_linked_milestone_with_no_goals_still_yields_a_row_of_zeroes() {
    let p = pool();
    let proj = project(&p, "repo-a");
    let m = milestone(&p, &proj, "M1");
    linked(&p, &proj, "brief", &m);

    let rows = list_plan_summaries(&p).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].goals_total, 0);
    assert_eq!(rows[0].goals_done, 0);
    assert!(rows[0].cut_at.is_none());
}
