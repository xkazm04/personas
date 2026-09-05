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

#[test]
fn delete_is_allowed_only_for_draft_or_archived() {
    let p = pool();
    let draft = create_note(&p, "d", None).unwrap();
    delete_note(&p, &draft.id).unwrap();
    assert!(matches!(
        get_note(&p, &draft.id).unwrap_err(),
        AppError::NotFound(_)
    ));

    let live = create_note(&p, "p", None).unwrap();
    let live = set_status(&p, &live.id, NoteStatus::Published, None, None, None, None).unwrap();
    let err = delete_note(&p, &live.id).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "got {err:?}");

    let live = set_status(&p, &live.id, NoteStatus::Archived, None, None, None, None).unwrap();
    delete_note(&p, &live.id).unwrap();
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
