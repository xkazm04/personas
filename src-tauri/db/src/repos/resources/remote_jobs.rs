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
//!
//! ## The outbox
//!
//! A job sent to a paired device that is offline is stored `queued` and drained,
//! oldest first, when the link next comes up ([`list_queued_for_peer`],
//! [`mark_pending`]); a send that got no answer returns to the outbox
//! ([`mark_queued`]) rather than failing, because the peer's `create_inbound`
//! is idempotent on the job id and a repeat is re-acked, never re-run.

use crate::models::{RemoteJob, RemoteJobDirection, RemoteJobNote, RemoteJobStatus};
use crate::DbPool;
use personas_core::error::AppError;

const COLUMNS: &str = "id, direction, peer_id, peer_display_name, kind, instruction, \
                       status, summary, refusal_reason, last_seq, created_at, updated_at, \
                       completed_at, payload_json, receipt_json";

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
    create_outbound_with_payload(
        pool,
        id,
        peer_id,
        peer_display_name,
        kind,
        instruction,
        None,
        RemoteJobStatus::Pending,
    )
}

/// Insert an outbound job with its kind-specific body, as `Pending` (the peer is
/// connected and the request is about to go on the wire) or `Queued` (the peer
/// is offline, so the job waits in this device's outbox for the next link-up).
/// Any other starting status is refused: an outbound row is born in one of the
/// two states that still have a send ahead of them.
#[allow(clippy::too_many_arguments)]
pub fn create_outbound_with_payload(
    pool: &DbPool,
    id: &str,
    peer_id: &str,
    peer_display_name: &str,
    kind: &str,
    instruction: &str,
    payload_json: Option<&str>,
    status: RemoteJobStatus,
) -> Result<RemoteJob, AppError> {
    if !matches!(status, RemoteJobStatus::Queued | RemoteJobStatus::Pending) {
        return Err(AppError::Validation(format!(
            "an outbound remote job starts queued or pending, not {}",
            status.as_str()
        )));
    }
    insert(
        pool,
        id,
        RemoteJobDirection::Outbound,
        peer_id,
        peer_display_name,
        kind,
        instruction,
        payload_json,
        status,
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
    create_inbound_with_payload(
        pool,
        id,
        peer_id,
        peer_display_name,
        kind,
        instruction,
        None,
    )
}

/// [`create_inbound`] carrying the request's kind-specific body, so the running
/// side keeps what it was asked to do (a `fleet_session` payload) next to the
/// job row. Same idempotency: a repeat returns the existing row and `false`.
pub fn create_inbound_with_payload(
    pool: &DbPool,
    id: &str,
    peer_id: &str,
    peer_display_name: &str,
    kind: &str,
    instruction: &str,
    payload_json: Option<&str>,
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
        payload_json,
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
    payload_json: Option<&str>,
    status: RemoteJobStatus,
) -> Result<RemoteJob, AppError> {
    if id.trim().is_empty() {
        return Err(AppError::Validation(
            "remote job id must not be empty".into(),
        ));
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
             status, summary, refusal_reason, last_seq, created_at, updated_at, completed_at,
             payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 0, ?8, ?8, NULL, ?9)",
        rusqlite::params![
            id,
            direction.as_str(),
            peer_id,
            peer_display_name,
            kind,
            instruction,
            status.as_str(),
            now,
            payload_json,
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
    let existing =
        get(pool, id)?.ok_or_else(|| AppError::NotFound(format!("No remote job with id {id}")))?;
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
        rusqlite::params![
            id,
            status.as_str(),
            summary,
            refusal_reason,
            now,
            completed_at
        ],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("No remote job with id {id}")));
    }
    Ok(())
}

// -- The outbox ---------------------------------------------------------------
//
// An outbound job sent while its peer is offline is persisted `queued` and goes
// on the wire when the link next comes up. The two transitions below are
// CONDITIONAL updates, so two drains racing for the same row (a simultaneous
// connect raises link-up on both connections) cannot both send it: exactly one
// `mark_pending` reports `true`.

/// Outbound jobs waiting in the outbox for one peer, oldest first — the order
/// they are drained in.
pub fn list_queued_for_peer(pool: &DbPool, peer_id: &str) -> Result<Vec<RemoteJob>, AppError> {
    timed_query!("remote_jobs", "remote_jobs::list_queued_for_peer", {
        let conn = pool.get()?;
        let rows = conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM remote_jobs
                 WHERE direction = 'outbound' AND peer_id = ?1 AND status = 'queued'
                 ORDER BY created_at ASC, rowid ASC"
            ))?
            .query_map(rusqlite::params![peer_id], map_job)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// Claim a queued job for sending: `queued` → `pending`. `false` when the row
/// was not queued (another drain claimed it, or it has since moved on).
pub fn mark_pending(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    transition(pool, id, RemoteJobStatus::Queued, RemoteJobStatus::Pending)
}

/// Put a job whose send did not get an answer back in the outbox:
/// `pending` → `queued`. A send that failed on the wire is a suspension, not a
/// failure — the peer either never saw the request (and will get it on the next
/// link-up) or already accepted it (and will re-ack the repeat without running
/// it twice, because `create_inbound` is idempotent on the job id). `false` when
/// the row was not pending (an ack or a result landed in the meantime).
pub fn mark_queued(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    transition(pool, id, RemoteJobStatus::Pending, RemoteJobStatus::Queued)
}

/// Return every outbound `pending` row to the outbox. Called once at network
/// start: nothing can be in flight across a restart, so a row still `pending`
/// is one whose send died with the process, and leaving it would strand it
/// (the drain only takes `queued`, and the resume exchange has nothing to ask
/// the peer about a request it may never have received).
pub fn requeue_stranded_pending(pool: &DbPool) -> Result<usize, AppError> {
    timed_query!("remote_jobs", "remote_jobs::requeue_stranded_pending", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE remote_jobs SET status = 'queued', updated_at = ?1
              WHERE direction = 'outbound' AND status = 'pending'",
            rusqlite::params![chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(n)
    })
}

fn transition(
    pool: &DbPool,
    id: &str,
    from: RemoteJobStatus,
    to: RemoteJobStatus,
) -> Result<bool, AppError> {
    timed_query!("remote_jobs", "remote_jobs::transition", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE remote_jobs SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2",
            rusqlite::params![
                id,
                from.as_str(),
                to.as_str(),
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(n > 0)
    })
}

// -- Receipt and mirror -------------------------------------------------------

/// Store a job's completion receipt (a serialized `FleetSessionJobReceipt`).
/// The caller validates the JSON; this layer stores it verbatim, and
/// [`map_job`] reads an unparseable value back as absent.
pub fn set_receipt(pool: &DbPool, id: &str, receipt_json: &str) -> Result<(), AppError> {
    timed_query!("remote_jobs", "remote_jobs::set_receipt", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE remote_jobs SET receipt_json = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, receipt_json, chrono::Utc::now().to_rfc3339()],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("No remote job with id {id}")));
        }
        Ok(())
    })
}

/// The last-known view of a remote session, as the running device last mirrored
/// it to this (originating) device. Latest-wins: each mirror replaces the last.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteJobMirror {
    /// The running device's serialized `RemoteSessionView`, verbatim.
    pub view_json: String,
    /// RFC 3339, this device's clock, when the frame landed.
    pub mirror_at: String,
}

/// Replace a job's mirror. Deliberately does NOT touch `updated_at`: a mirror is
/// a live view, not a change to the job, and `updated_at` is what the liveness
/// rule reads as "when the job last changed state".
pub fn set_mirror(
    pool: &DbPool,
    id: &str,
    mirror_json: &str,
    mirror_at: &str,
) -> Result<(), AppError> {
    timed_query!("remote_jobs", "remote_jobs::set_mirror", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE remote_jobs SET mirror_json = ?2, mirror_at = ?3 WHERE id = ?1",
            rusqlite::params![id, mirror_json, mirror_at],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("No remote job with id {id}")));
        }
        Ok(())
    })
}

/// A job's last mirror, or `None` when none has arrived (or the job is unknown).
pub fn get_mirror(pool: &DbPool, id: &str) -> Result<Option<RemoteJobMirror>, AppError> {
    timed_query!("remote_jobs", "remote_jobs::get_mirror", {
        let conn = pool.get()?;
        match conn.query_row(
            "SELECT mirror_json, mirror_at FROM remote_jobs WHERE id = ?1",
            rusqlite::params![id],
            map_mirror,
        ) {
            Ok(mirror) => Ok(mirror),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// Every outbound job of `kind` that is still open, or finished at or after
/// `terminal_since` (RFC 3339), with its last mirror — newest first. The read
/// behind the originating device's remote-session tiles.
pub fn list_outbound_with_mirrors(
    pool: &DbPool,
    kind: &str,
    terminal_since: &str,
) -> Result<Vec<(RemoteJob, Option<RemoteJobMirror>)>, AppError> {
    timed_query!("remote_jobs", "remote_jobs::list_outbound_with_mirrors", {
        let conn = pool.get()?;
        let rows = conn
            .prepare(&format!(
                "SELECT {COLUMNS}, mirror_json, mirror_at FROM remote_jobs
                 WHERE direction = 'outbound' AND kind = ?1
                   AND (completed_at IS NULL OR completed_at >= ?2)
                 ORDER BY created_at DESC, id DESC
                 LIMIT 200"
            ))?
            .query_map(rusqlite::params![kind, terminal_since], |row| {
                Ok((map_job(row)?, map_mirror(row)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

fn map_mirror(row: &rusqlite::Row<'_>) -> rusqlite::Result<Option<RemoteJobMirror>> {
    let view_json: Option<String> = row.get("mirror_json")?;
    let mirror_at: Option<String> = row.get("mirror_at")?;
    Ok(match (view_json, mirror_at) {
        (Some(view_json), Some(mirror_at)) => Some(RemoteJobMirror {
            view_json,
            mirror_at,
        }),
        _ => None,
    })
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
        payload_json: row.get("payload_json")?,
        // An unparseable receipt reads as absent rather than failing the whole
        // listing, for the same reason an unknown status token does above.
        receipt: row
            .get::<_, Option<String>>("receipt_json")?
            .and_then(|raw| serde_json::from_str(&raw).ok()),
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
        create_outbound(
            pool,
            id,
            "peerA",
            "Laptop",
            "instruction",
            "summarize inbox",
        )
        .expect("create outbound")
    }

    #[test]
    fn outbound_and_inbound_share_a_table_and_are_told_apart_by_direction() {
        let pool = test_pool();
        outbound(&pool, "job-out");
        create_inbound(
            &pool,
            "job-in",
            "peerB",
            "Desktop",
            "instruction",
            "run tests",
        )
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
            create_inbound(&pool, "job-1", "peerB", "Desktop", "instruction", "go")
                .expect("second");
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
        create_outbound(&origin, "job-1", "peerB", "Desktop", "instruction", "go").expect("origin");

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

    fn queued(pool: &DbPool, id: &str, peer: &str) -> RemoteJob {
        create_outbound_with_payload(
            pool,
            id,
            peer,
            "Laptop",
            "fleet_session",
            "fix the flaky test",
            Some(r#"{"prompt":"fix it"}"#),
            RemoteJobStatus::Queued,
        )
        .expect("queued outbound")
    }

    /// An offline send lands in the outbox with its payload, and only `queued`
    /// or `pending` are valid starting states for an outbound row.
    #[test]
    fn an_outbox_row_keeps_its_payload_and_starts_queued() {
        let pool = test_pool();
        let job = queued(&pool, "job-q", "peerA");
        assert_eq!(job.status, RemoteJobStatus::Queued);
        assert!(
            !job.status.is_terminal(),
            "queued still has a send ahead of it"
        );
        assert_eq!(job.payload_json.as_deref(), Some(r#"{"prompt":"fix it"}"#));

        for bad in [RemoteJobStatus::Running, RemoteJobStatus::Completed] {
            assert!(matches!(
                create_outbound_with_payload(
                    &pool,
                    "job-x",
                    "peerA",
                    "L",
                    "instruction",
                    "x",
                    None,
                    bad
                ),
                Err(AppError::Validation(_))
            ));
        }
        // A queued job is not something a reconnect RESUMES - it is drained.
        assert!(
            list_unfinished_for_peer(&pool, RemoteJobDirection::Outbound, "peerA")
                .expect("unfinished")
                .is_empty()
        );
    }

    /// The drain order is oldest first, and a claim is exclusive: two drains
    /// racing for the same row cannot both send it.
    #[test]
    fn the_outbox_drains_oldest_first_and_a_claim_is_exclusive() {
        let pool = test_pool();
        queued(&pool, "job-1", "peerA");
        std::thread::sleep(std::time::Duration::from_millis(2));
        queued(&pool, "job-2", "peerA");
        queued(&pool, "job-other", "peerB");

        let ids: Vec<String> = list_queued_for_peer(&pool, "peerA")
            .expect("queued")
            .into_iter()
            .map(|j| j.id)
            .collect();
        assert_eq!(ids, vec!["job-1", "job-2"]);

        assert!(mark_pending(&pool, "job-1").expect("claim"));
        assert!(
            !mark_pending(&pool, "job-1").expect("second claim"),
            "a row can be claimed for sending once"
        );
        // An unanswered send goes back to the outbox, once.
        assert!(mark_queued(&pool, "job-1").expect("requeue"));
        assert!(!mark_queued(&pool, "job-1").expect("requeue twice"));
        assert_eq!(
            get(&pool, "job-1").expect("get").unwrap().status,
            RemoteJobStatus::Queued
        );
    }

    /// A restart strands nothing: an outbound row left `pending` goes back to
    /// the outbox, and inbound rows are untouched.
    #[test]
    fn a_restart_returns_stranded_pending_sends_to_the_outbox() {
        let pool = test_pool();
        outbound(&pool, "job-p");
        create_inbound(&pool, "job-in", "peerB", "D", "instruction", "go").expect("in");
        assert_eq!(requeue_stranded_pending(&pool).expect("requeue"), 1);
        assert_eq!(
            get(&pool, "job-p").expect("get").unwrap().status,
            RemoteJobStatus::Queued
        );
        assert_eq!(
            get(&pool, "job-in").expect("get").unwrap().status,
            RemoteJobStatus::Running
        );
    }

    /// Receipt and mirror round-trip, and the list behind the remote tiles
    /// carries both while skipping long-finished and foreign-kind rows.
    #[test]
    fn receipts_and_mirrors_round_trip_and_feed_the_tile_list() -> Result<(), AppError> {
        let pool = test_pool();
        queued(&pool, "job-1", "peerA");
        assert!(get_mirror(&pool, "job-1").expect("mirror").is_none());
        assert!(get_mirror(&pool, "ghost").expect("ghost").is_none());

        set_mirror(
            &pool,
            "job-1",
            r#"{"state":"running"}"#,
            "2026-09-23T10:00:00Z",
        )
        .expect("m1");
        set_mirror(
            &pool,
            "job-1",
            r#"{"state":"idle"}"#,
            "2026-09-23T10:00:05Z",
        )
        .expect("m2");
        let mirror = get_mirror(&pool, "job-1")
            .expect("mirror")
            .expect("present");
        assert_eq!(mirror.view_json, r#"{"state":"idle"}"#, "latest wins");
        assert_eq!(mirror.mirror_at, "2026-09-23T10:00:05Z");
        assert!(set_mirror(&pool, "ghost", "{}", "x").is_err());

        let receipt = r#"{"sessionId":"s1","branch":"remote/a/b","pushedSha":"abc","pushError":null,"verified":null}"#;
        set_receipt(&pool, "job-1", receipt).expect("receipt");
        let job = get(&pool, "job-1").expect("get").unwrap();
        assert_eq!(
            job.receipt.expect("parsed").pushed_sha.as_deref(),
            Some("abc")
        );

        outbound(&pool, "job-instruction");
        queued(&pool, "job-old", "peerA");
        finish(&pool, "job-old", RemoteJobStatus::Completed, "done").expect("finish");
        pool.get()?.execute(
            "UPDATE remote_jobs SET completed_at = '2000-01-01T00:00:00Z' WHERE id = 'job-old'",
            [],
        )?;
        let rows = list_outbound_with_mirrors(&pool, "fleet_session", "2026-01-01T00:00:00Z")
            .expect("list");
        assert_eq!(rows.len(), 1, "only the open fleet_session job: {rows:?}");
        assert_eq!(rows[0].0.id, "job-1");
        assert_eq!(
            rows[0].1.as_ref().map(|m| m.mirror_at.as_str()),
            Some("2026-09-23T10:00:05Z")
        );
        Ok(())
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
