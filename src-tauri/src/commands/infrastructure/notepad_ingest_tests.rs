//! Sweeper tests over a real migrated database and a real temp repo tree.
//!
//! Every case here is a file the door will actually meet on disk. The point of
//! the sweep is that ONE bad file costs ONE note, so the malformed cases assert
//! the note is untouched, not merely that nothing panicked.

use super::*;
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
    let mut seen: Vec<(String, NoteStatus)> = Vec::new();
    let mut on_change = |id: &str, st: NoteStatus| seen.push((id.to_string(), st));
    let report = sweep_notepad_runs_core(pool, &mut on_change);
    (report, seen)
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
