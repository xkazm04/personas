//! The ONE gated door a `/note-task` run comes back through.
//!
//! The Notepad hands a note to a Fleet session and then has no channel back:
//! a CLI session writes files, not database rows, and it must stay that way —
//! a session that could write `personas.db` could write anything, and nothing
//! would be reviewable. So the skill writes exactly three artifacts into the
//! target repo (`started.json`, `result.json`, `report.md`) and this module is
//! the only path from the first two into `dev_notes`.
//!
//! Shape deliberately mirrors `dev_tools/ship_ingest.rs`: path-confined to the project's own runs dir,
//! size-capped, version-checked, self-identifying, and idempotent through an
//! `ingested.json` marker.
//!
//! **Nothing here may panic and nothing here may fail the tick.** It runs from
//! the fleet stale ticker (every 30 s) across every published note at once, so
//! one malformed file in one repo must cost exactly that one note. Every read
//! is best-effort with a `tracing::warn!`; a bad file is SKIPPED WITHOUT a
//! marker, so fixing the file is enough to make the next tick ingest it.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::models::{
    NoteComment, NoteCommentAuthor, NoteCommentKind, NoteCommentRef, NoteStatus,
    NotepadIngestReport,
};
use crate::db::repos::dev::note_comments::{self as comments_repo, NewNoteComment};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::AppState;
use personas_core::events::event_name;
use personas_db::DbPool;

/// The only `schema_version` this door accepts. Bump ONLY together with
/// `.claude/skills/note-task/SKILL.md`; an unknown version is refused rather
/// than best-effort parsed.
pub const NOTEPAD_RESULT_VERSION: u32 = 1;

/// `<repo>/.personas/notepad/runs/<note_id>/`.
const RUNS_REL: [&str; 3] = [".personas", "notepad", "runs"];

/// A note's report is prose plus a short artifact list. A megabyte is already
/// two orders of magnitude more than that; past it the file is a mistake (a log
/// dump, a pasted transcript), not a report.
const MAX_RESULT_BYTES: u64 = 1_048_576;

// ── result.json / started.json shapes ───────────────────────────────────────

#[derive(Debug, Deserialize)]
struct NoteRunResult {
    /// Absent is NOT tolerated — see [`NOTEPAD_RESULT_VERSION`].
    #[serde(default)]
    schema_version: Option<u32>,
    /// Self-identification. Must match the directory, so a result dropped into
    /// the wrong run dir is caught instead of applied to someone else's note.
    #[serde(default)]
    note_id: Option<String>,
    /// `"completed"` | `"failed"`.
    #[serde(default)]
    status: Option<String>,
    /// The run's summary for the operator (the skill caps it at 2000
    /// characters). Becomes the body of the run's `review` thread entry.
    #[serde(default)]
    summary: Option<String>,
    /// Optional `[{ "body_md": "..." }]` — anything the agent wants to say to
    /// the operator beyond the summary. Additive: `schema_version` stays 1.
    ///
    /// Held as raw JSON and narrowed by [`agent_comments`] rather than typed
    /// here, because this field is the one part of the file a result can get
    /// wrong WITHOUT the run being wrong — a malformed `comments` must cost the
    /// comments, never the completion.
    #[serde(default)]
    comments: Option<serde_json::Value>,
}

/// Comments one result may post. Past this the agent is writing a log into
/// the operator's thread, not talking to him.
const MAX_AGENT_COMMENTS: usize = 8;

/// Longest thread entry an ingest writes, in bytes (clipped on a char
/// boundary). Mirrors the 4 KiB the Athena ops use.
const MAX_THREAD_BODY_BYTES: usize = 4096;

/// Who a `/note-task` run's thread entries are signed by. The skill IS the
/// author; the fleet session label is a UI convention this module cannot see.
const NOTE_TASK_AUTHOR: &str = "note-task";

/// Clip to at most `max` bytes without splitting a codepoint.
pub(crate) fn clip_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// The non-empty `body_md` strings of a result's `comments`, capped. Anything
/// that is not an array of objects carrying a string `body_md` is skipped with
/// a warning.
fn agent_comments(note_id: &str, raw: Option<&serde_json::Value>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    let Some(items) = raw.as_array() else {
        tracing::warn!(note = %note_id, "notepad ingest: result.json `comments` is not an array, ignored");
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| item.get("body_md").and_then(|b| b.as_str()))
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .take(MAX_AGENT_COMMENTS)
        .map(|b| clip_bytes(b, MAX_THREAD_BODY_BYTES).to_string())
        .collect()
}

#[derive(Debug, Deserialize)]
struct NoteRunStarted {
    #[serde(default)]
    schema_version: Option<u32>,
    #[serde(default)]
    note_id: Option<String>,
}

/// A note the sweeper might have work for, plus where its repo lives.
struct PendingNote {
    id: String,
    status: NoteStatus,
    root_path: String,
}

fn run_dir(root: &str, note_id: &str) -> PathBuf {
    let mut p = PathBuf::from(root);
    for seg in RUNS_REL {
        p.push(seg);
    }
    p.push(note_id);
    p
}

/// Read a small JSON file under the size cap. `Ok(None)` = not present (the
/// ordinary case); `Err` = present but unusable, which the caller logs.
fn read_capped(path: &Path) -> Result<Option<String>, String> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("stat failed: {e}")),
    };
    if !meta.is_file() {
        return Err("not a regular file".into());
    }
    if meta.len() > MAX_RESULT_BYTES {
        return Err(format!(
            "{} bytes exceeds the {MAX_RESULT_BYTES}-byte cap",
            meta.len()
        ));
    }
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) => Err(format!("read failed: {e}")),
    }
}

/// Every note the sweeper could act on: dispatched to Fleet, not yet finished,
/// and belonging to a project whose root path we know.
fn pending_notes(pool: &DbPool) -> Result<Vec<PendingNote>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT n.id, n.status, p.root_path
           FROM dev_notes n
           JOIN dev_projects p ON p.id = n.project_id
          WHERE n.status IN ('published', 'in_progress')
            AND n.dispatch_target = 'fleet'",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, status, root_path) = row.map_err(AppError::Database)?;
        // A status outside the vocabulary can only come from a write that got
        // past the column CHECK. Skip the row rather than fail the sweep.
        let Some(status) = NoteStatus::parse(&status) else {
            tracing::warn!(note = %id, status = %status, "notepad ingest: unknown note status, skipped");
            continue;
        };
        out.push(PendingNote {
            id,
            status,
            root_path,
        });
    }
    Ok(out)
}

/// Stamp the idempotency marker. Best-effort: a marker we could not write means
/// the next tick re-ingests, and every write this door makes is idempotent.
fn write_marker(dir: &Path, note_id: &str, outcome: &str) {
    let payload = json!({
        "schema_version": NOTEPAD_RESULT_VERSION,
        "note_id": note_id,
        "outcome": outcome,
        "ingested_at": chrono::Utc::now().to_rfc3339(),
    });
    if let Err(e) = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into()),
    ) {
        tracing::warn!(note = %note_id, error = %e, "notepad ingest: could not write ingested.json");
    }
}

/// One sweep, with the event emission factored out so the whole door is
/// testable without a `tauri::AppHandle`.
///
/// `on_change` is called once per note whose row actually moved, with the note
/// id and its status AFTER the write. `on_comment` is called once per thread
/// entry the sweep appended (see [`post_run_thread`]).
pub fn sweep_notepad_runs_core(
    pool: &DbPool,
    on_change: &mut dyn FnMut(&str, NoteStatus),
    on_comment: &mut dyn FnMut(&NoteComment),
) -> NotepadIngestReport {
    let mut report = NotepadIngestReport::default();

    let notes = match pending_notes(pool) {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(error = %e, "notepad ingest: could not list pending notes");
            return report;
        }
    };

    for note in notes {
        let dir = run_dir(&note.root_path, &note.id);
        if !dir.is_dir() {
            continue;
        }
        // Already consumed. The marker is the idempotency spine: this door is
        // called from the ticker AND on demand from the pad, and both must be
        // safe to run at any time.
        if dir.join("ingested.json").exists() {
            continue;
        }

        let mut status = note.status;

        // ── started.json: published → in_progress ───────────────────────────
        if status == NoteStatus::Published {
            match read_capped(&dir.join("started.json")) {
                Ok(Some(raw)) => match serde_json::from_str::<NoteRunStarted>(&raw) {
                    Ok(parsed) if started_is_ours(&parsed, &note.id) => {
                        match repo::set_status(
                            pool,
                            &note.id,
                            NoteStatus::InProgress,
                            None,
                            None,
                            None,
                            None,
                        ) {
                            Ok(_) => {
                                status = NoteStatus::InProgress;
                                report.started += 1;
                                on_change(&note.id, status);
                            }
                            Err(e) => {
                                tracing::warn!(note = %note.id, error = %e, "notepad ingest: could not mark in_progress");
                            }
                        }
                    }
                    Ok(_) => {
                        tracing::warn!(note = %note.id, "notepad ingest: started.json is for a different note or an unknown schema_version, skipped");
                    }
                    Err(e) => {
                        tracing::warn!(note = %note.id, error = %e, "notepad ingest: started.json is not valid JSON, skipped");
                    }
                },
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(note = %note.id, error = %e, "notepad ingest: started.json unreadable, skipped");
                }
            }
        }

        // ── result.json: the run reporting back ─────────────────────────────
        let raw = match read_capped(&dir.join("result.json")) {
            Ok(Some(raw)) => raw,
            Ok(None) => continue,
            Err(e) => {
                tracing::warn!(note = %note.id, error = %e, "notepad ingest: result.json unreadable, skipped");
                continue;
            }
        };
        let parsed: NoteRunResult = match serde_json::from_str(&raw) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(note = %note.id, error = %e, "notepad ingest: result.json is not valid JSON, skipped");
                continue;
            }
        };
        if parsed.schema_version != Some(NOTEPAD_RESULT_VERSION) {
            tracing::warn!(note = %note.id, version = ?parsed.schema_version, "notepad ingest: unsupported result schema_version, skipped");
            continue;
        }
        if parsed.note_id.as_deref() != Some(note.id.as_str()) {
            tracing::warn!(note = %note.id, claimed = ?parsed.note_id, "notepad ingest: result.json names a different note, skipped");
            continue;
        }
        match parsed.status.as_deref() {
            Some("completed") => {
                match repo::set_status(
                    pool,
                    &note.id,
                    NoteStatus::Completed,
                    None,
                    None,
                    None,
                    Some(&raw),
                ) {
                    Ok(_) => {
                        report.completed += 1;
                        let run_id = close_note_task_run(pool, &note.id, "completed", &raw, &dir);
                        on_change(&note.id, NoteStatus::Completed);
                        post_run_thread(
                            pool,
                            &note.id,
                            run_id.as_deref(),
                            "completed",
                            &parsed,
                            on_comment,
                        );
                        write_marker(&dir, &note.id, "completed");
                    }
                    Err(e) => {
                        tracing::warn!(note = %note.id, error = %e, "notepad ingest: could not complete note");
                    }
                }
            }
            // A failure is a REPORT, not a completion. The note keeps its
            // status so the operator can read the why and re-dispatch; only
            // `result_json` changes.
            Some("failed") => match repo::set_result_json(pool, &note.id, &raw) {
                Ok(_) => {
                    report.failed += 1;
                    let run_id = close_note_task_run(pool, &note.id, "failed", &raw, &dir);
                    on_change(&note.id, status);
                    post_run_thread(
                        pool,
                        &note.id,
                        run_id.as_deref(),
                        "failed",
                        &parsed,
                        on_comment,
                    );
                    write_marker(&dir, &note.id, "failed");
                }
                Err(e) => {
                    tracing::warn!(note = %note.id, error = %e, "notepad ingest: could not record failure");
                }
            },
            other => {
                tracing::warn!(note = %note.id, status = ?other, "notepad ingest: unknown result status, skipped");
            }
        }
    }

    report
}

/// Close the note's open `note_task` run with the outcome the result reported,
/// returning the run's id (`None` only when no row could be read or written).
///
/// The pad opens a run row when it dispatches; a run the operator started by
/// hand (`/note-task <id>` in a terminal, no dispatch) has none, and gets one
/// recorded here so the note's history is the runs it actually had rather than
/// the dispatches the pad remembers making.
///
/// **Idempotent on a re-sweep.** A failed run's ingest can repeat (the note
/// stays `in_progress`, so a marker that did not write lets the next tick
/// re-read the same file). The newest closed `note_task` run already carrying
/// this exact report IS that run, so it is returned as-is instead of a second
/// row being minted for the same result — which is also what keys the thread
/// writes in [`post_run_thread`] to one review per run.
///
/// Best-effort throughout: the note's own status and `result_json` already
/// landed, and a missing ledger row must not turn a successful ingest into a
/// failure.
fn close_note_task_run(
    pool: &DbPool,
    note_id: &str,
    outcome: &str,
    raw: &str,
    dir: &Path,
) -> Option<String> {
    let run_dir = dir.to_string_lossy().into_owned();
    let existing = repo::newest_running_run(pool, note_id, "note_task").unwrap_or_else(|e| {
        tracing::warn!(note = %note_id, error = %e, "notepad ingest: could not read the note's open run");
        None
    });
    let run_id = match existing {
        Some(run) => run.id,
        None => {
            let already = repo::list_runs(pool, note_id)
                .unwrap_or_default()
                .into_iter()
                .find(|r| r.kind == "note_task");
            if let Some(run) =
                already.filter(|r| r.status != "running" && r.summary_json.as_deref() == Some(raw))
            {
                return Some(run.id);
            }
            match repo::record_run_start(pool, note_id, "note_task", None, None) {
                Ok(run) => run.id,
                Err(e) => {
                    tracing::warn!(note = %note_id, error = %e, "notepad ingest: could not open a run row for an undispatched run");
                    return None;
                }
            }
        }
    };
    if let Err(e) = repo::complete_run(pool, &run_id, outcome, Some(raw), Some(&run_dir)) {
        tracing::warn!(note = %note_id, run = %run_id, error = %e, "notepad ingest: run row left open");
    }
    Some(run_id)
}

/// Append a run's entries to the note's thread and hand each to `on_comment`.
///
/// In thread order: each agent `comment` from `result.json`, then a `system` /
/// `status` row whose `ref_id` is the run's outcome (`completed` | `failed`),
/// then the `review` of the run LAST. The outcome row sits immediately before
/// the review so the pad can label it; the review is last so the newest unread
/// entry, the one the pad springs out of the card, carries Approve / Reject.
///
/// Keyed on the run id: a note that already carries this run's review gets
/// nothing (a re-sweep of the same result). Without a run id there is nothing
/// to key on, and the review's `ref_id` is what the rework path follows, so
/// the thread writes are skipped with a warning rather than posted unkeyed.
///
/// Best-effort like the rest of the door: the note already moved.
fn post_run_thread(
    pool: &DbPool,
    note_id: &str,
    run_id: Option<&str>,
    outcome: &'static str,
    parsed: &NoteRunResult,
    on_comment: &mut dyn FnMut(&NoteComment),
) {
    let Some(run_id) = run_id else {
        tracing::warn!(note = %note_id, "notepad ingest: no run row, so the run's thread entries were not posted");
        return;
    };
    match comments_repo::has_run_review(pool, note_id, run_id) {
        Ok(true) => return,
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(note = %note_id, run = %run_id, error = %e, "notepad ingest: could not check for an existing run review");
            return;
        }
    }

    let summary = parsed
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| clip_bytes(s, MAX_THREAD_BODY_BYTES).to_string());
    let comments = agent_comments(note_id, parsed.comments.as_ref());

    let mut rows: Vec<NewNoteComment<'_>> = Vec::with_capacity(comments.len() + 2);
    for body in &comments {
        rows.push(NewNoteComment {
            note_id,
            author_kind: NoteCommentAuthor::Agent,
            author_name: Some(NOTE_TASK_AUTHOR),
            kind: NoteCommentKind::Comment,
            body_md: body,
            ref_kind: None,
            ref_id: None,
            verdict: None,
        });
    }
    // The run's outcome, as a `system` / `status` row immediately BEFORE the
    // review, so the pad can label the review ("run completed" / "run failed")
    // from the row above it without the schema carrying an outcome column.
    // `completed` is also the note's own milestone; `failed` moves no status
    // and is purely the run's outcome.
    rows.push(NewNoteComment::status_milestone(note_id, outcome));
    rows.push(NewNoteComment {
        note_id,
        author_kind: NoteCommentAuthor::Agent,
        author_name: Some(NOTE_TASK_AUTHOR),
        kind: NoteCommentKind::Review,
        // No summary: the outcome token. The pad labels the entry from
        // `ref_kind = run`, so the body only has to be non-empty data.
        body_md: summary.as_deref().unwrap_or(outcome),
        ref_kind: Some(NoteCommentRef::Run),
        ref_id: Some(run_id),
        verdict: None,
    });

    for row in &rows {
        match comments_repo::insert_comment(pool, row) {
            Ok(comment) => on_comment(&comment),
            Err(e) => {
                tracing::warn!(note = %note_id, run = %run_id, kind = row.kind.as_str(), error = %e, "notepad ingest: thread entry not posted");
            }
        }
    }
}

/// Move a finished attempt's artifacts out of the note's run dir, so the NEXT
/// run of the same note can be ingested at all.
///
/// The sweeper's idempotency spine is `runs/<note_id>/ingested.json`, and the
/// run dir is keyed by NOTE, not by run. A rejected run that is re-dispatched
/// (`completed → published`, the rework move) would otherwise find the old
/// marker still sitting there and be skipped forever. So the rework path calls
/// this first: `started.json`, `result.json`, `report.md` and `ingested.json`
/// move into `runs/<note_id>/attempts/<label>/`, where the next run can still
/// read what was rejected (the `note-task` skill's Phase 0 points there).
///
/// A note with no project or no run dir has nothing to move — `Ok`. Any other
/// I/O failure is an error, because a rework that could not clear the marker
/// is a rework whose result will never land, and the caller must refuse the
/// move rather than report success.
pub(crate) fn archive_attempt(pool: &DbPool, note_id: &str, label: &str) -> Result<(), AppError> {
    let note = repo::get_note(pool, note_id)?;
    let Some(project_id) = note.project_id.as_deref() else {
        return Ok(());
    };
    let project = repo::get_project_by_id(pool, project_id)?;
    archive_attempt_in(&run_dir(&project.root_path, note_id), label)
}

/// The run artifacts [`archive_attempt`] moves aside.
const ATTEMPT_ARTIFACTS: [&str; 4] = ["started.json", "result.json", "report.md", "ingested.json"];

/// The filesystem half of [`archive_attempt`], over a known run dir.
fn archive_attempt_in(dir: &Path, label: &str) -> Result<(), AppError> {
    if !dir.is_dir() || !ATTEMPT_ARTIFACTS.iter().any(|a| dir.join(a).exists()) {
        return Ok(());
    }
    // The label is a run id (a uuid); anything else is reduced to a path-safe
    // token so it can never climb out of `attempts/`.
    let mut safe: String = label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        safe = "attempt".into();
    }
    let attempts = dir.join("attempts");
    let mut dest = attempts.join(&safe);
    if dest.exists() {
        dest = attempts.join(format!(
            "{safe}-{}",
            chrono::Utc::now().format("%Y%m%dT%H%M%S%3f")
        ));
    }
    std::fs::create_dir_all(&dest).map_err(|e| {
        AppError::Internal(format!("notepad rework: create {}: {e}", dest.display()))
    })?;
    for name in ATTEMPT_ARTIFACTS {
        let from = dir.join(name);
        if from.exists() {
            std::fs::rename(&from, dest.join(name)).map_err(|e| {
                AppError::Internal(format!("notepad rework: move {}: {e}", from.display()))
            })?;
        }
    }
    Ok(())
}

/// `started.json` is ours when it names this note and carries a version we
/// know. A missing `note_id` is tolerated — the directory already addresses the
/// note and the file predates any ambiguity — but a WRONG one is not.
fn started_is_ours(parsed: &NoteRunStarted, note_id: &str) -> bool {
    let version_ok = matches!(parsed.schema_version, None | Some(NOTEPAD_RESULT_VERSION));
    let id_ok = match parsed.note_id.as_deref() {
        None => true,
        Some(claimed) => claimed == note_id,
    };
    version_ok && id_ok
}

/// Called from the fleet stale ticker (`commands/fleet/stale.rs`), right after
/// the feed-impact sweep. No-op when no note is out with a Fleet session.
pub fn sweep_pending_notepad_ingests(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let mut emit = |note_id: &str, status: NoteStatus| {
        if let Err(e) = app.emit(
            event_name::NOTEPAD_NOTE_CHANGED,
            json!({ "noteId": note_id, "status": status.as_str() }),
        ) {
            tracing::warn!(event = event_name::NOTEPAD_NOTE_CHANGED, error = %e, "notepad: note-changed emit failed");
        }
    };
    let mut emit_comment = |comment: &NoteComment| {
        crate::commands::infrastructure::dev_tools::notepad::emit_note_comment(app, comment);
    };
    let report = sweep_notepad_runs_core(&state.db, &mut emit, &mut emit_comment);
    if report != NotepadIngestReport::default() {
        tracing::info!(
            started = report.started,
            completed = report.completed,
            failed = report.failed,
            "notepad ingest: swept note runs"
        );
    }
}

#[cfg(test)]
#[path = "notepad_ingest_tests.rs"]
mod notepad_ingest_tests;
