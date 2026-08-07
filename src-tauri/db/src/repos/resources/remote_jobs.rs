//! Repository for `remote_jobs` / `remote_job_notes` — the persistence half of
//! cross-device instruction dispatch (one paired device asks another to run a
//! natural-language instruction; the runner streams back progress and a summary).
//!
//! Pure data layer, deliberately NOT `p2p`-gated, so the exactly-once and
//! resume semantics are unit-testable in a lite build. The `p2p`-gated
//! `engine::p2p::remote_jobs` service and the `commands/network/remote_jobs.rs`
//! wrappers both call into here; neither writes SQL of its own. (The older
//! `discovered_peers` / `peer_manifests` tables ARE queried with inline SQL from
//! the engine — that is the pattern this module deliberately does not copy.)
//!
//! ## Exactly-once, and where it comes from
//!
//! Progress notes are numbered 1..N per job, minted on the running side by an
//! atomic `last_seq + 1` bump. Redelivery is made harmless by the schema, not by
//! application care: `remote_job_notes` is keyed on `(job_id, seq)`, so a
//! replayed note that already landed conflicts and is ignored, and
//! [`apply_note`] reports whether the row was genuinely new. A caller that emits
//! a UI event only when `apply_note` returns `true` therefore emits exactly once
//! per note, no matter how many times the link drops and replays.
//!
//! `remote_jobs.last_seq` on the RECEIVING side is the highest *contiguous*
//! prefix held (see [`recompute_last_seq`]), never merely the maximum. That
//! distinction is the whole point: a resume asks for "everything above what I
//! hold contiguously", so a note that arrived out of order can never mark the
//! gap beneath it as delivered.

use crate::models::{RemoteJob, RemoteJobDirection, RemoteJobNote, RemoteJobStatus};
use crate::DbPool;
use personas_core::error::AppError;

const COLUMNS: &str = "id, direction, peer_id, peer_display_name, kind, instruction, \
                       status, summary, refusal_reason, last_seq, created_at, updated_at, \
                       completed_at";

/// Insert a job row this device is originating (status `Pending`).
///
/// The id is minted by the caller and travels on the wire unchanged, so both
/// devices key the same exchange by the same string.
pub fn create_outbound(
    pool: &DbPool,
    id: &str,
    peer_id: &str,
    peer_display_name: &str,
    kind: &str,
    instruction: &str,
) -> Result<RemoteJob, AppError> {
    insert(
        pool,
        id,
        RemoteJobDirection::Outbound,
        peer_id,
        peer_display_name,
        kind,
        instruction,
        RemoteJobStatus::Pending,
    )
}

/// Record a job a paired device asked us to run, already `Running`.
///
/// Idempotent on `id`: a duplicate request (the peer retried, or a replayed
/// stream re-delivered it) returns the existing row and `false`, so the caller
/// can re-ack without starting the work twice.
pub fn create_inbound(
    pool: &DbPool,
    id: &str,
    peer_id: &str,
    peer_display_name: &str,
    kind: &str,
    instruction: &str,
) -> Result<(RemoteJob, bool), AppError> {
    if let Some(existing) = get(pool, id)? {
        return Ok((existing, false));
    }
    let job = insert(
        pool,
        id,
        RemoteJobDirection::Inbound,
        peer_id,
        peer_display_name,
        kind,
        instruction,
        RemoteJobStatus::Running,
    )?;
    Ok((job, true))
}

#[allow(clippy::too_many_arguments)]
fn insert(
    pool: &DbPool,
    id: &str,
    direction: RemoteJobDirection,
    peer_id: &str,
    peer_display_name: &str,
    kind: &str,
    instruction: &str,
    status: RemoteJobStatus,
) -> Result<RemoteJob, AppError> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("remote job id must not be empty".into()));
    }
    if peer_id.trim().is_empty() {
        return Err(AppError::Validation("peer_id must not be empty".into()));
    }
    if instruction.trim().is_empty() {
        return Err(AppError::Validation(
            "a remote job needs an instruction to run".into(),
        ));
    }
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO remote_jobs
            (id, direction, peer_id, peer_display_name, kind, instruction,
             status, summary, refusal_reason, last_seq, created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 0, ?8, ?8, NULL)",
        rusqlite::params![
            id,
            direction.as_str(),
            peer_id,
            peer_display_name,
            kind,
            instruction,
            status.as_str(),
            now,
        ],
    )?;
    get(pool, id)?.ok_or_else(|| AppError::Internal("remote job vanished after insert".into()))
}

/// Fetch one job by id.
pub fn get(pool: &DbPool, id: &str) -> Result<Option<RemoteJob>, AppError> {
    let conn = pool.get()?;
    match conn.query_row(
        &format!("SELECT {COLUMNS} FROM remote_jobs WHERE id = ?1"),
        rusqlite::params![id],
        map_job,
    ) {
        Ok(job) => Ok(Some(job)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// List jobs newest-first, optionally narrowed to one direction.
pub fn list(
    pool: &DbPool,
    direction: Option<RemoteJobDirection>,
    limit: u32,
) -> Result<Vec<RemoteJob>, AppError> {
    let conn = pool.get()?;
    let limit = limit.clamp(1, 500) as i64;
    let rows = match direction {
        Some(d) => conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM remote_jobs WHERE direction = ?1
                 ORDER BY created_at DESC, id DESC LIMIT ?2"
            ))?
            .query_map(rusqlite::params![d.as_str(), limit], map_job)?
            .collect::<Result<Vec<_>, _>>()?,
        None => conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM remote_jobs
                 ORDER BY created_at DESC, id DESC LIMIT ?1"
            ))?
            .query_map(rusqlite::params![limit], map_job)?
            .collect::<Result<Vec<_>, _>>()?,
    };
    Ok(rows)
}

/// Jobs in a non-terminal state for one peer — what a reconnect must resume.
pub fn list_unfinished_for_peer(
    pool: &DbPool,
    direction: RemoteJobDirection,
    peer_id: &str,
) -> Result<Vec<RemoteJob>, AppError> {
    let conn = pool.get()?;
    let rows = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM remote_jobs
             WHERE direction = ?1 AND peer_id = ?2 AND status IN ('pending','running')
             ORDER BY created_at ASC"
        ))?
        .query_map(rusqlite::params![direction.as_str(), peer_id], map_job)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Move a `Pending` outbound job to `Running` after the peer accepted it.
pub fn mark_running(pool: &DbPool, id: &str) -> Result<(), AppError> {
    set_status(pool, id, RemoteJobStatus::Running, None, None)
}

/// Record the peer's refusal. Terminal; nothing further will arrive.
pub fn mark_refused(pool: &DbPool, id: &str, reason: &str) -> Result<(), AppError> {
    set_status(
        pool,
        id,
        RemoteJobStatus::Refused,
        None,
        Some(reason.to_string()),
    )
}

/// Record a terminal outcome with its summary.
///
/// Idempotent by design — a replayed result lands on an already-terminal row and
/// is a no-op, reported as `false`, so the caller does not emit a second
/// completion event. Attempting a *different* terminal status on an already
/// terminal job is likewise refused silently: the first verdict wins.
pub fn finish(
    pool: &DbPool,
    id: &str,
    status: RemoteJobStatus,
    summary: &str,
) -> Result<bool, AppError> {
    if !status.is_terminal() {
        return Err(AppError::Validation(format!(
            "finish() needs a terminal status, got {}",
            status.as_str()
        )));
    }
    let existing = get(pool, id)?
        .ok_or_else(|| AppError::NotFound(format!("No remote job with id {id}")))?;
    if existing.status.is_terminal() {
        return Ok(false);
    }
    set_status(pool, id, status, Some(summary.to_string()), None)?;
    Ok(true)
}

/// Abandon a job locally without a verdict from the peer.
pub fn mark_cancelled(pool: &DbPool, id: &str, reason: &str) -> Result<bool, AppError> {
    finish(pool, id, RemoteJobStatus::Cancelled, reason)
}

fn set_status(
    pool: &DbPool,
    id: &str,
    status: RemoteJobStatus,
    summary: Option<String>,
    refusal_reason: Option<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let completed_at = status.is_terminal().then(|| now.clone());
    let affected = conn.execute(
        "UPDATE remote_jobs
            SET status = ?2,
                summary = COALESCE(?3, summary),
                refusal_reason = COALESCE(?4, refusal_reason),
                updated_at = ?5,
                completed_at = COALESCE(?6, completed_at)
          WHERE id = ?1",
        rusqlite::params![id, status.as_str(), summary, refusal_reason, now, completed_at],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("No remote job with id {id}")));
    }
    Ok(())
}

/// Mint the next progress sequence number for a job we are running.
///
/// A single atomic `last_seq + 1` bump, so two concurrent progress reports can
/// never be handed the same number even though they run on separate tasks.
pub fn next_seq(pool: &DbPool, job_id: &str) -> Result<u32, AppError> {
    let conn = pool.get()?;
    let seq: i64 = conn
        .query_row(
            "UPDATE remote_jobs SET last_seq = last_seq + 1, updated_at = ?2
              WHERE id = ?1
          RETURNING last_seq",
            rusqlite::params![job_id, chrono::Utc::now().to_rfc3339()],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("No remote job with id {job_id}"))
            }
            other => AppError::Database(other),
        })?;
    Ok(seq.max(0) as u32)
}

/// Store a note we are about to send (running side). The seq must already have
/// come from [`next_seq`].
pub fn record_note(pool: &DbPool, job_id: &str, seq: u32, text: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO remote_job_notes (job_id, seq, text, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![job_id, seq as i64, text, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

/// Apply a note that arrived from the peer (originating side).
///
/// Returns `true` only the first time a given `(job_id, seq)` lands. That return
/// value IS the exactly-once guarantee at the application boundary: emit the UI
/// event when it is `true` and a replayed note stays invisible.
pub fn apply_note(pool: &DbPool, job_id: &str, seq: u32, text: &str) -> Result<bool, AppError> {
    if seq == 0 {
        return Err(AppError::Validation(
            "progress sequence numbers start at 1".into(),
        ));
    }
    let conn = pool.get()?;
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO remote_job_notes (job_id, seq, text, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![job_id, seq as i64, text, chrono::Utc::now().to_rfc3339()],
    )?;
    drop(conn);
    if inserted > 0 {
        recompute_last_seq(pool, job_id)?;
    }
    Ok(inserted > 0)
}

/// Recompute `last_seq` as the highest CONTIGUOUS prefix of notes held.
///
/// Not `MAX(seq)`: a note that arrived while an earlier one was still missing
/// must not mark the gap beneath it as delivered, or the resume exchange would
/// ask for notes above the gap and the hole would become permanent.
pub fn recompute_last_seq(pool: &DbPool, job_id: &str) -> Result<u32, AppError> {
    let conn = pool.get()?;
    // The largest `seq` for which every seq in 1..=seq is present — equivalently,
    // the largest `seq` whose rank among this job's notes equals its own value.
    let prefix: i64 = conn.query_row(
        "SELECT COALESCE(MAX(a.seq), 0) FROM remote_job_notes a
          WHERE a.job_id = ?1
            AND a.seq = (SELECT COUNT(*) FROM remote_job_notes b
                          WHERE b.job_id = ?1 AND b.seq <= a.seq)",
        rusqlite::params![job_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE remote_jobs SET last_seq = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![job_id, prefix, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(prefix.max(0) as u32)
}

/// Notes strictly above `after_seq`, oldest first — the replay payload.
pub fn list_notes_after(
    pool: &DbPool,
    job_id: &str,
    after_seq: u32,
) -> Result<Vec<RemoteJobNote>, AppError> {
    let conn = pool.get()?;
    let rows = conn
        .prepare(
            "SELECT job_id, seq, text, created_at FROM remote_job_notes
              WHERE job_id = ?1 AND seq > ?2 ORDER BY seq ASC",
        )?
        .query_map(rusqlite::params![job_id, after_seq as i64], |row| {
            Ok(RemoteJobNote {
                job_id: row.get(0)?,
                seq: row.get::<_, i64>(1)?.max(0) as u32,
                text: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Every note for a job, oldest first (the UI transcript).
pub fn list_notes(pool: &DbPool, job_id: &str) -> Result<Vec<RemoteJobNote>, AppError> {
    list_notes_after(pool, job_id, 0)
}

fn map_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteJob> {
    let direction: String = row.get(1)?;
    let status: String = row.get(6)?;
    Ok(RemoteJob {
        id: row.get(0)?,
        // A row whose token no longer parses is treated as the safe default
        // rather than failing the whole listing: an unreadable history entry is
        // better than a Devices tab that will not load.
        direction: RemoteJobDirection::parse(&direction).unwrap_or(RemoteJobDirection::Inbound),
        peer_id: row.get(2)?,
        peer_display_name: row.get(3)?,
        kind: row.get(4)?,
        instruction: row.get(5)?,
        status: RemoteJobStatus::parse(&status).unwrap_or(RemoteJobStatus::Failed),
        summary: row.get(7)?,
        refusal_reason: row.get(8)?,
        last_seq: row.get::<_, i64>(9)?.max(0) as u32,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:remote_jobs_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::migrations::run(&conn).expect("initial migrations");
            crate::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn outbound(pool: &DbPool, id: &str) -> RemoteJob {
        create_outbound(pool, id, "peerA", "Laptop", "instruction", "summarize inbox")
            .expect("create outbound")
    }

    #[test]
    fn outbound_and_inbound_share_a_table_and_are_told_apart_by_direction() {
        let pool = test_pool();
        outbound(&pool, "job-out");
        create_inbound(&pool, "job-in", "peerB", "Desktop", "instruction", "run tests")
            .expect("create inbound");

        assert_eq!(list(&pool, None, 50).expect("all").len(), 2);
        let outs = list(&pool, Some(RemoteJobDirection::Outbound), 50).expect("out");
        assert_eq!(outs.len(), 1);
        assert_eq!(outs[0].id, "job-out");
        assert_eq!(outs[0].status, RemoteJobStatus::Pending);

        let ins = list(&pool, Some(RemoteJobDirection::Inbound), 50).expect("in");
        assert_eq!(ins.len(), 1);
        assert_eq!(
            ins[0].status,
            RemoteJobStatus::Running,
            "an accepted inbound job is running the moment it is recorded"
        );
    }

    /// The peer retried its request (or a replayed stream re-delivered it). The
    /// second call must NOT start a second job.
    #[test]
    fn a_duplicate_inbound_request_reuses_the_row() {
        let pool = test_pool();
        let (first, was_new) =
            create_inbound(&pool, "job-1", "peerB", "Desktop", "instruction", "go").expect("first");
        assert!(was_new);
        let (second, was_new) =
            create_inbound(&pool, "job-1", "peerB", "Desktop", "instruction", "go").expect("second");
        assert!(!was_new, "a repeat request must not look new");
        assert_eq!(first.id, second.id);
        assert_eq!(list(&pool, None, 50).expect("list").len(), 1);
    }

    #[test]
    fn empty_instruction_and_ids_are_refused() {
        let pool = test_pool();
        assert!(create_outbound(&pool, "", "peerA", "L", "instruction", "x").is_err());
        assert!(create_outbound(&pool, "j", "", "L", "instruction", "x").is_err());
        assert!(create_outbound(&pool, "j", "peerA", "L", "instruction", "   ").is_err());
    }

    #[test]
    fn ack_then_result_walks_the_lifecycle() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        mark_running(&pool, "job-1").expect("running");
        assert_eq!(
            get(&pool, "job-1").expect("get").unwrap().status,
            RemoteJobStatus::Running
        );

        assert!(finish(&pool, "job-1", RemoteJobStatus::Completed, "all done").expect("finish"));
        let job = get(&pool, "job-1").expect("get").unwrap();
        assert_eq!(job.status, RemoteJobStatus::Completed);
        assert_eq!(job.summary.as_deref(), Some("all done"));
        assert!(job.completed_at.is_some());
    }

    #[test]
    fn a_refusal_is_terminal_and_keeps_its_reason() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        mark_refused(&pool, "job-1", "not a paired device").expect("refuse");
        let job = get(&pool, "job-1").expect("get").unwrap();
        assert_eq!(job.status, RemoteJobStatus::Refused);
        assert_eq!(job.refusal_reason.as_deref(), Some("not a paired device"));
        assert!(job.status.is_terminal());
    }

    /// A replayed result must not double-complete a job, and must not overwrite
    /// the verdict that already landed.
    #[test]
    fn a_replayed_result_is_a_no_op() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        assert!(finish(&pool, "job-1", RemoteJobStatus::Completed, "first").expect("first"));
        assert!(
            !finish(&pool, "job-1", RemoteJobStatus::Failed, "second").expect("replay"),
            "a second terminal verdict must report itself as a no-op"
        );
        let job = get(&pool, "job-1").expect("get").unwrap();
        assert_eq!(job.status, RemoteJobStatus::Completed);
        assert_eq!(job.summary.as_deref(), Some("first"));
    }

    #[test]
    fn finish_rejects_a_non_terminal_status() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        assert!(finish(&pool, "job-1", RemoteJobStatus::Running, "x").is_err());
    }

    #[test]
    fn sequence_numbers_are_minted_monotonically_from_one() {
        let pool = test_pool();
        create_inbound(&pool, "job-1", "peerB", "D", "instruction", "go").expect("inbound");
        assert_eq!(next_seq(&pool, "job-1").expect("1"), 1);
        assert_eq!(next_seq(&pool, "job-1").expect("2"), 2);
        assert_eq!(next_seq(&pool, "job-1").expect("3"), 3);
        assert!(next_seq(&pool, "ghost").is_err());
    }

    /// The core exactly-once property: applying the same note twice reports the
    /// second as not-new, and leaves one row.
    #[test]
    fn applying_the_same_note_twice_is_reported_once() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        assert!(apply_note(&pool, "job-1", 1, "step one").expect("first"));
        assert!(
            !apply_note(&pool, "job-1", 1, "step one").expect("replay"),
            "a redelivered note must report itself as already applied"
        );
        assert_eq!(list_notes(&pool, "job-1").expect("notes").len(), 1);
        assert_eq!(get(&pool, "job-1").expect("get").unwrap().last_seq, 1);
    }

    #[test]
    fn notes_read_back_in_sequence_order() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        // Deliberately out of order on the way in.
        apply_note(&pool, "job-1", 2, "second").expect("2");
        apply_note(&pool, "job-1", 1, "first").expect("1");
        apply_note(&pool, "job-1", 3, "third").expect("3");
        let texts: Vec<String> = list_notes(&pool, "job-1")
            .expect("notes")
            .into_iter()
            .map(|n| n.text)
            .collect();
        assert_eq!(texts, vec!["first", "second", "third"]);
    }

    /// `last_seq` is the contiguous prefix, never the maximum — otherwise a gap
    /// would be skipped by the next resume and the missing note lost forever.
    #[test]
    fn last_seq_tracks_the_contiguous_prefix_not_the_maximum() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        apply_note(&pool, "job-1", 1, "one").expect("1");
        assert_eq!(get(&pool, "job-1").expect("g").unwrap().last_seq, 1);

        // 3 arrives while 2 is still missing — the anchor must NOT move to 3.
        apply_note(&pool, "job-1", 3, "three").expect("3");
        assert_eq!(
            get(&pool, "job-1").expect("g").unwrap().last_seq,
            1,
            "a gap beneath a note must not be marked delivered"
        );

        // 2 lands, closing the gap: the anchor jumps to 3 in one step.
        apply_note(&pool, "job-1", 2, "two").expect("2");
        assert_eq!(get(&pool, "job-1").expect("g").unwrap().last_seq, 3);
    }

    #[test]
    fn a_zero_sequence_number_is_refused() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        assert!(apply_note(&pool, "job-1", 0, "x").is_err());
    }

    /// The reconnect story end to end, at the persistence layer: the runner
    /// emitted 3 notes, the originator only durably held 1 when the link died,
    /// and the replay delivers exactly the 2 it missed — no duplicates, no gaps.
    #[test]
    fn a_reconnect_replays_exactly_the_missing_notes() {
        let runner = test_pool();
        let origin = test_pool();
        create_inbound(&runner, "job-1", "peerA", "Laptop", "instruction", "go").expect("runner");
        create_outbound(&origin, "job-1", "peerB", "Desktop", "instruction", "go")
            .expect("origin");

        // Runner emits three notes.
        for text in ["one", "two", "three"] {
            let seq = next_seq(&runner, "job-1").expect("seq");
            record_note(&runner, "job-1", seq, text).expect("record");
        }
        // Only the first reached the originator before the link dropped.
        assert!(apply_note(&origin, "job-1", 1, "one").expect("deliver 1"));

        // Reconnect: the originator states what it holds, the runner replays above it.
        let held = get(&origin, "job-1").expect("g").unwrap().last_seq;
        assert_eq!(held, 1);
        let replay = list_notes_after(&runner, "job-1", held).expect("replay");
        assert_eq!(replay.len(), 2, "only the missing notes are replayed");

        let mut newly_applied = 0;
        for note in &replay {
            if apply_note(&origin, "job-1", note.seq, &note.text).expect("apply") {
                newly_applied += 1;
            }
        }
        assert_eq!(newly_applied, 2);
        assert_eq!(get(&origin, "job-1").expect("g").unwrap().last_seq, 3);

        // A second replay of the SAME window delivers nothing new — exactly once.
        for note in &replay {
            assert!(
                !apply_note(&origin, "job-1", note.seq, &note.text).expect("second replay"),
                "replaying a window twice must apply nothing"
            );
        }
        let texts: Vec<String> = list_notes(&origin, "job-1")
            .expect("notes")
            .into_iter()
            .map(|n| n.text)
            .collect();
        assert_eq!(texts, vec!["one", "two", "three"]);
    }

    #[test]
    fn unfinished_jobs_for_a_peer_are_what_a_reconnect_resumes() {
        let pool = test_pool();
        outbound(&pool, "job-open");
        create_outbound(&pool, "job-done", "peerA", "Laptop", "instruction", "x").expect("done");
        finish(&pool, "job-done", RemoteJobStatus::Completed, "ok").expect("finish");
        create_outbound(&pool, "job-other", "peerZ", "Other", "instruction", "x").expect("other");

        let open = list_unfinished_for_peer(&pool, RemoteJobDirection::Outbound, "peerA")
            .expect("unfinished");
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].id, "job-open");
    }

    /// `run_incremental` runs on every launch, so the table step must be safe to
    /// replay — and replaying it must not wipe rows.
    #[test]
    fn remote_jobs_migration_is_idempotent() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        apply_note(&pool, "job-1", 1, "note").expect("note");
        {
            let conn = pool.get().expect("conn");
            for _ in 0..3 {
                crate::migrations::run_incremental(&conn).expect("replay incremental migrations");
            }
        }
        assert_eq!(list(&pool, None, 50).expect("list").len(), 1);
        assert_eq!(list_notes(&pool, "job-1").expect("notes").len(), 1);
    }

    /// Deleting a job takes its notes with it (FK cascade), so a cleared history
    /// cannot leave orphaned progress rows behind.
    #[test]
    fn deleting_a_job_cascades_to_its_notes() {
        let pool = test_pool();
        outbound(&pool, "job-1");
        apply_note(&pool, "job-1", 1, "note").expect("note");
        {
            let conn = pool.get().expect("conn");
            conn.execute("PRAGMA foreign_keys = ON;", []).expect("fk");
            conn.execute("DELETE FROM remote_jobs WHERE id = 'job-1'", [])
                .expect("delete");
        }
        assert!(list_notes(&pool, "job-1").expect("notes").is_empty());
    }
}
