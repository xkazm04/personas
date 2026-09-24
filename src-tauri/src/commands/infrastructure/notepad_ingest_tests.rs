//! Sweeper tests over a real migrated database and a real temp repo tree.
//!
//! Every case here is a file the door will actually meet on disk. The point of
//! the sweep is that ONE bad file costs ONE note, so the malformed cases assert
//! the note is untouched, not merely that nothing panicked.

use super::*;
use crate::db::models::{NoteComment, NoteCommentAuthor, NoteCommentKind, NoteCommentRef};
use personas_db::repos::dev_tools as devrepo;
use personas_db::DbPool;

/// A pool plus a temp dir standing in for a managed repo.
fn fixture() -> (DbPool, tempfile::TempDir) {
    let pool = personas_db::init_test_db().expect("test db");
    let dir = tempfile::tempdir().expect("tempdir");
    (pool, dir)
}

/// A note already dispatched to Fleet, sitting in `published`.
fn dispatched_note(pool: &DbPool, root: &Path) -> String {
    let project = devrepo::create_project(
        pool,
        "notepad-fixture",
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect("project");
    let note = devrepo::create_note(pool, "do the thing", Some(&project.id)).expect("note");
    devrepo::set_status(
        pool,
        &note.id,
        NoteStatus::Published,
        Some("fleet"),
        Some(&format!("note:{}", note.id)),
        None,
        None,
    )
    .expect("publish");
    note.id
}

fn runs(root: &Path, note_id: &str) -> PathBuf {
    let dir = run_dir(&root.to_string_lossy(), note_id);
    std::fs::create_dir_all(&dir).expect("mkdir runs");
    dir
}

fn write(dir: &Path, name: &str, body: &str) {
    std::fs::write(dir.join(name), body).expect("write fixture file");
}

/// Run one sweep, returning the report and the (noteId, status) changes emitted.
fn sweep(pool: &DbPool) -> (NotepadIngestReport, Vec<(String, NoteStatus)>) {
    let (report, seen, _) = sweep_with_comments(pool);
    (report, seen)
}

/// [`sweep`], plus the thread entries the sweep handed to `on_comment`.
fn sweep_with_comments(
    pool: &DbPool,
) -> (
    NotepadIngestReport,
    Vec<(String, NoteStatus)>,
    Vec<NoteComment>,
) {
    let mut seen: Vec<(String, NoteStatus)> = Vec::new();
    let mut comments: Vec<NoteComment> = Vec::new();
    let mut on_change = |id: &str, st: NoteStatus| seen.push((id.to_string(), st));
    let mut on_comment = |c: &NoteComment| comments.push(c.clone());
    let report = sweep_notepad_runs_core(pool, &mut on_change, &mut on_comment);
    (report, seen, comments)
}

#[test]
fn started_json_flips_published_to_in_progress() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "started.json",
        &format!(r#"{{"schema_version":1,"note_id":"{id}","started_at":"2026-09-05T10:00:00Z"}}"#),
    );

    let (report, seen) = sweep(&pool);
    assert_eq!(report.started, 1);
    assert_eq!(report.completed, 0);
    assert_eq!(seen, vec![(id.clone(), NoteStatus::InProgress)]);
    assert_eq!(
        devrepo::get_note(&pool, &id).unwrap().status,
        NoteStatus::InProgress
    );
    assert!(
        !dir.join("ingested.json").exists(),
        "a start is not a completion — no marker yet, the run is still going"
    );
}

#[test]
fn a_completed_result_completes_the_note_and_stamps_the_marker() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    let body = format!(
        r#"{{"schema_version":1,"note_id":"{id}","status":"completed","summary":"did it","artifacts":[{{"path":"src/x.rs","kind":"file"}}],"finished_at":"2026-09-05T11:00:00Z"}}"#
    );
    write(
        &dir,
        "started.json",
        &format!(r#"{{"schema_version":1,"note_id":"{id}"}}"#),
    );
    write(&dir, "result.json", &body);

    let (report, seen) = sweep(&pool);
    assert_eq!(report.started, 1);
    assert_eq!(report.completed, 1);
    assert_eq!(report.failed, 0);
    assert_eq!(
        seen,
        vec![
            (id.clone(), NoteStatus::InProgress),
            (id.clone(), NoteStatus::Completed)
        ]
    );

    let note = devrepo::get_note(&pool, &id).unwrap();
    assert_eq!(note.status, NoteStatus::Completed);
    assert!(note.completed_at.is_some());
    assert_eq!(note.result_json.as_deref(), Some(body.as_str()));
    assert!(dir.join("ingested.json").exists());

    // Idempotent: the marker makes a second sweep a no-op.
    let (again, seen2) = sweep(&pool);
    assert_eq!(again, NotepadIngestReport::default());
    assert!(seen2.is_empty());
}

#[test]
fn a_failed_result_records_the_report_without_completing_the_note() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "started.json",
        &format!(r#"{{"schema_version":1,"note_id":"{id}"}}"#),
    );
    let body = format!(
        r#"{{"schema_version":1,"note_id":"{id}","status":"failed","summary":"gates red","artifacts":[]}}"#
    );
    write(&dir, "result.json", &body);

    let (report, _) = sweep(&pool);
    assert_eq!(report.failed, 1);
    assert_eq!(report.completed, 0);

    let note = devrepo::get_note(&pool, &id).unwrap();
    assert_eq!(
        note.status,
        NoteStatus::InProgress,
        "a failed run is a report, not a completion"
    );
    assert!(note.completed_at.is_none());
    assert_eq!(note.result_json.as_deref(), Some(body.as_str()));
    assert!(dir.join("ingested.json").exists());
}

#[test]
fn malformed_json_is_skipped_and_leaves_the_note_alone() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(&dir, "result.json", "{ this is not json");

    let (report, seen) = sweep(&pool);
    assert_eq!(report, NotepadIngestReport::default());
    assert!(seen.is_empty());
    let note = devrepo::get_note(&pool, &id).unwrap();
    assert_eq!(note.status, NoteStatus::Published);
    assert!(note.result_json.is_none());
    assert!(
        !dir.join("ingested.json").exists(),
        "no marker — fixing the file must be enough to make the next tick work"
    );
}

#[test]
fn a_result_naming_a_different_note_is_refused() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "result.json",
        r#"{"schema_version":1,"note_id":"somebody-elses-note","status":"completed","summary":"x"}"#,
    );

    let (report, _) = sweep(&pool);
    assert_eq!(report, NotepadIngestReport::default());
    assert_eq!(
        devrepo::get_note(&pool, &id).unwrap().status,
        NoteStatus::Published
    );
}

#[test]
fn an_unknown_schema_version_is_refused_rather_than_best_effort_parsed() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "result.json",
        &format!(r#"{{"schema_version":99,"note_id":"{id}","status":"completed","summary":"x"}}"#),
    );
    let (report, _) = sweep(&pool);
    assert_eq!(report, NotepadIngestReport::default());

    // …and so is a result with no version at all.
    write(
        &dir,
        "result.json",
        &format!(r#"{{"note_id":"{id}","status":"completed","summary":"x"}}"#),
    );
    let (report, _) = sweep(&pool);
    assert_eq!(report, NotepadIngestReport::default());
    assert_eq!(
        devrepo::get_note(&pool, &id).unwrap().status,
        NoteStatus::Published
    );
}

#[test]
fn an_oversize_result_is_skipped() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    // Valid JSON, correct note, correct version — and one byte over the cap.
    let filler = "x".repeat(MAX_RESULT_BYTES as usize);
    write(
        &dir,
        "result.json",
        &format!(
            r#"{{"schema_version":1,"note_id":"{id}","status":"completed","summary":"{filler}"}}"#
        ),
    );

    let (report, seen) = sweep(&pool);
    assert_eq!(report, NotepadIngestReport::default());
    assert!(seen.is_empty());
    assert_eq!(
        devrepo::get_note(&pool, &id).unwrap().status,
        NoteStatus::Published
    );
}

#[test]
fn a_started_json_for_a_different_note_does_not_start_this_one() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "started.json",
        r#"{"schema_version":1,"note_id":"not-this-one"}"#,
    );

    let (report, _) = sweep(&pool);
    assert_eq!(report.started, 0);
    assert_eq!(
        devrepo::get_note(&pool, &id).unwrap().status,
        NoteStatus::Published
    );
}

#[test]
fn a_draft_note_is_never_swept() {
    let (pool, tmp) = fixture();
    let project = devrepo::create_project(
        &pool,
        "draft-fixture",
        &tmp.path().to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let note = devrepo::create_note(&pool, "still thinking", Some(&project.id)).unwrap();
    let dir = runs(tmp.path(), &note.id);
    write(
        &dir,
        "result.json",
        &format!(
            r#"{{"schema_version":1,"note_id":"{}","status":"completed","summary":"x"}}"#,
            note.id
        ),
    );

    let (report, _) = sweep(&pool);
    assert_eq!(
        report,
        NotepadIngestReport::default(),
        "a draft was never handed to anyone — a result for it is not ours to believe"
    );
    assert_eq!(
        devrepo::get_note(&pool, &note.id).unwrap().status,
        NoteStatus::Draft
    );
}

// ── the thread: what a finished run posts ───────────────────────────────────

/// A completed run posts, in order: each agent comment from `result.json`,
/// the `completed` outcome row, and the run's review LAST (pending, keyed on
/// the run row). A re-sweep posts nothing twice.
#[test]
fn a_completed_run_posts_status_comments_then_the_review() -> Result<(), AppError> {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let run = devrepo::record_run_start(&pool, &id, "note_task", None, None)?;
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "result.json",
        &format!(
            r#"{{"schema_version":1,"note_id":"{id}","status":"completed","summary":"did it","comments":[{{"body_md":"heads up: gates were slow"}},{{"body_md":"   "}},{{"nope":1}}]}}"#
        ),
    );

    let (report, _, posted) = sweep_with_comments(&pool);
    assert_eq!(report.completed, 1);
    let shape: Vec<(NoteCommentKind, NoteCommentAuthor, &str)> = posted
        .iter()
        .map(|c| (c.kind, c.author_kind, c.body_md.as_str()))
        .collect();
    assert_eq!(
        shape,
        vec![
            (
                NoteCommentKind::Comment,
                NoteCommentAuthor::Agent,
                "heads up: gates were slow"
            ),
            (
                NoteCommentKind::System,
                NoteCommentAuthor::System,
                "completed"
            ),
            (NoteCommentKind::Review, NoteCommentAuthor::Agent, "did it"),
        ]
    );
    let review = &posted[2];
    assert_eq!(review.ref_kind, Some(NoteCommentRef::Run));
    assert_eq!(
        review.ref_id.as_deref(),
        Some(run.id.as_str()),
        "keyed on the dispatched run"
    );
    assert_eq!(review.author_name.as_deref(), Some("note-task"));
    assert_eq!(
        review.verdict,
        Some(crate::db::models::NoteReviewVerdict::Pending)
    );

    // Marker gone (a failed marker write) — the re-sweep must still not repost.
    std::fs::remove_file(dir.join("ingested.json")).expect("drop marker");
    let (_, _, again) = sweep_with_comments(&pool);
    assert!(again.is_empty(), "a re-sweep posts nothing: {again:?}");
    Ok(())
}

/// A failed run moves no status, but its outcome still rides as a `system` /
/// `status` row with `ref_id = "failed"` right before the review, so the pad
/// can label the review "run failed". Its re-sweep (the note stays in_progress, so the file IS re-read when the
/// marker is missing) reuses the closed run rather than minting a second one,
/// which is what keeps the review single.
#[test]
fn a_failed_run_posts_only_its_review_and_a_resweep_is_single() -> Result<(), AppError> {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "result.json",
        &format!(
            r#"{{"schema_version":1,"note_id":"{id}","status":"failed","summary":"gates red"}}"#
        ),
    );
    let (_, _, posted) = sweep_with_comments(&pool);
    assert_eq!(posted.len(), 2);
    assert_eq!(posted[0].kind, NoteCommentKind::System);
    assert_eq!(posted[0].ref_kind, Some(NoteCommentRef::Status));
    assert_eq!(posted[0].ref_id.as_deref(), Some("failed"));
    assert_eq!(posted[1].kind, NoteCommentKind::Review);
    assert_eq!(posted[1].body_md, "gates red");

    std::fs::remove_file(dir.join("ingested.json")).expect("drop marker");
    let (report, _, again) = sweep_with_comments(&pool);
    assert_eq!(report.failed, 1, "the failure is re-recorded");
    assert!(again.is_empty(), "but not re-posted: {again:?}");
    assert_eq!(
        devrepo::list_runs(&pool, &id)?.len(),
        1,
        "the closed run is reused, not duplicated"
    );
    Ok(())
}

/// A malformed `comments` costs the comments, never the completion.
#[test]
fn a_malformed_comments_field_does_not_cost_the_run() {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "result.json",
        &format!(
            r#"{{"schema_version":1,"note_id":"{id}","status":"completed","comments":"not a list"}}"#
        ),
    );
    let (report, _, posted) = sweep_with_comments(&pool);
    assert_eq!(report.completed, 1);
    let kinds: Vec<NoteCommentKind> = posted.iter().map(|c| c.kind).collect();
    assert_eq!(
        kinds,
        vec![NoteCommentKind::System, NoteCommentKind::Review]
    );
    assert_eq!(
        posted[1].body_md, "completed",
        "no summary: the outcome token"
    );
}

/// The rework path's file half: the previous attempt's artifacts move into
/// `attempts/<label>/`, so the re-dispatched run is NOT skipped by the old
/// marker — and the next result is ingested.
#[test]
fn archive_attempt_clears_the_marker_so_the_rerun_ingests() -> Result<(), AppError> {
    let (pool, tmp) = fixture();
    let id = dispatched_note(&pool, tmp.path());
    let dir = runs(tmp.path(), &id);
    write(
        &dir,
        "result.json",
        &format!(r#"{{"schema_version":1,"note_id":"{id}","status":"completed","summary":"v1"}}"#),
    );
    write(&dir, "report.md", "first attempt");
    sweep(&pool);
    assert!(dir.join("ingested.json").exists());

    archive_attempt(&pool, &id, "run-1")?;
    for f in ["result.json", "report.md", "ingested.json"] {
        assert!(!dir.join(f).exists(), "{f} moved out of the run dir");
        assert!(
            dir.join("attempts").join("run-1").join(f).exists(),
            "{f} kept under attempts/"
        );
    }
    // A second archive with the same label does not clobber the first.
    write(&dir, "result.json", "{}");
    archive_attempt(&pool, &id, "run-1")?;
    assert!(dir
        .join("attempts")
        .join("run-1")
        .join("report.md")
        .exists());

    // The rework move, then a fresh result: it ingests.
    devrepo::set_status(&pool, &id, NoteStatus::Published, None, None, None, None)?;
    write(
        &dir,
        "result.json",
        &format!(r#"{{"schema_version":1,"note_id":"{id}","status":"completed","summary":"v2"}}"#),
    );
    let (report, _) = sweep(&pool);
    assert_eq!(report.completed, 1, "the rerun is not skipped");
    // An unknown note is refused, not silently skipped.
    archive_attempt(&pool, "no-such-note", "x").unwrap_err();
    Ok(())
}
