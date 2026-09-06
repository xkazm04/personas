//! The ONE gated door a `/note-task` run comes back through.
//!
//! The Notepad hands a note to a Fleet session and then has no channel back:
//! a CLI session writes files, not database rows, and it must stay that way —
//! a session that could write `personas.db` could write anything, and nothing
//! would be reviewable. So the skill writes exactly three artifacts into the
//! target repo (`started.json`, `result.json`, `report.md`) and this module is
//! the only path from the first two into `dev_notes`.
//!
//! Shape deliberately mirrors `dev_tools/ship_ingest.rs` and
//! `workspace_harvest.rs`: path-confined to the project's own runs dir,
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

use crate::db::models::{NoteStatus, NotepadIngestReport};
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
/// id and its status AFTER the write.
pub fn sweep_notepad_runs_core(
    pool: &DbPool,
    on_change: &mut dyn FnMut(&str, NoteStatus),
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
                        on_change(&note.id, NoteStatus::Completed);
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
                    on_change(&note.id, status);
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
    let report = sweep_notepad_runs_core(&state.db, &mut emit);
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
