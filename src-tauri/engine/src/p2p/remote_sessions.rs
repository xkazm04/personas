//! Remote sessions over the job lane: the live half that is NOT a progress note.
//!
//! A `fleet_session` job is an ordinary remote job (request, ack, notes, result,
//! all durable and exactly-once; see [`super::remote_jobs`]) plus two live
//! streams that are deliberately neither durable nor exactly-once:
//!
//! - **The mirror** (running → originating): the running device's current view
//!   of the session. Latest-wins. The running side keeps only the last one in
//!   memory (to repeat it on the next link-up); the originating side persists
//!   the last one it received (`remote_jobs.mirror_json`) so a restart paints a
//!   tile instead of a blank.
//! - **The output tail** (running → originating, only while subscribed): the
//!   session's terminal bytes. LOSSY and BOUNDED: at most
//!   [`OUTPUT_QUEUE_CAP`] entries wait per job, the oldest is dropped when a new
//!   one would overflow, and a slow link never back-pressures the PTY that
//!   produces them (registry `terminal-multiplexing/multi-client-fan-out`).
//!
//! This module owns the running side's per-job [`SessionLanes`] (plain data
//! behind a `std` mutex, so the executor can feed it from any thread without
//! awaiting anything) and the originating side's [`build_view`], the one rule
//! that turns a job row plus its last mirror into a [`RemoteSessionView`].

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Deserialize;

use personas_core::error::AppError;
use personas_db::models::{
    FleetSessionJobPayload, RemoteJob, RemoteJobDirection, RemoteJobStatus, RemoteSessionState,
    RemoteSessionView, REMOTE_JOB_KIND_FLEET_SESSION,
};
use personas_db::repos::resources::remote_jobs::{self as repo, RemoteJobMirror};
use personas_db::DbPool;

/// Most output entries that may wait to be sent for one job. A new entry that
/// would exceed it drops the OLDEST, so the tail always shows the latest output.
pub const OUTPUT_QUEUE_CAP: usize = 64;
/// Largest single output entry. Consecutive small writes are merged into the
/// newest waiting entry up to this size, so a chatty PTY does not turn into one
/// frame per keystroke.
pub const OUTPUT_ENTRY_MAX_BYTES: usize = 32 * 1024;
/// Minimum gap between two output frames of one job. Every frame is its own
/// QUIC stream and the receiving side disconnects a peer that opens more than
/// 100 streams in 10 s (`connection.rs` `PEER_MSG_RATE_LIMIT`), so the tail is
/// paced at 4 frames/s per job — still up to 128 KB/s of terminal text.
pub const OUTPUT_FRAME_INTERVAL: Duration = Duration::from_millis(250);
/// Largest mirror frame accepted. A view is a few hundred bytes; anything near
/// this is not a view.
pub const MAX_MIRROR_BYTES: usize = 64 * 1024;
/// A running session whose last mirror is older than this reads `unknown`
/// (three 15 s health ticks; design decision D8). A quiet remote session is
/// never shown as running.
pub const MIRROR_FRESH_FOR_MS: f64 = 45_000.0;
/// How long a finished remote session stays in [`list_views`].
pub const FINISHED_VISIBLE_FOR: chrono::Duration = chrono::Duration::hours(1);

// -- The running side: per-job lanes -------------------------------------------

/// One waiting chunk of output. `seq` is minted when the entry is created, so a
/// dropped entry leaves a gap in the sequence the viewer can see.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OutputEntry {
    pub seq: u32,
    pub bytes: Vec<u8>,
}

#[derive(Default)]
struct Lane {
    peer_id: String,
    subscribed: bool,
    /// The newest mirror not yet sent. Replaced, never queued: latest-wins.
    pending_mirror: Option<String>,
    /// The newest mirror ever pushed, repeated on the next link-up.
    last_mirror: Option<String>,
    queue: VecDeque<OutputEntry>,
    /// The last seq minted for this job (0 = none yet).
    last_seq: u32,
    /// A sender task is draining this lane. Flipped under the same lock that
    /// hands out work, so a push can never be stranded between "the worker
    /// found nothing" and "the worker exited".
    worker_running: bool,
    /// The job finished: no new output is taken; what is queued still drains.
    closed: bool,
}

/// What a lane worker should send next.
#[derive(Debug)]
pub(crate) struct Work {
    pub peer_id: String,
    pub mirror: Option<String>,
    pub output: Option<OutputEntry>,
}

/// The running device's live state for every remote session it runs.
#[derive(Default)]
pub(crate) struct SessionLanes {
    lanes: Mutex<HashMap<String, Lane>>,
}

impl SessionLanes {
    /// The lanes are a delivery cache, not an invariant: a panic while a guard
    /// was held leaves nothing worth refusing to read, so poisoning is recovered.
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Lane>> {
        self.lanes.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Claim the worker slot if it is free. `true` = the caller must spawn one.
    fn claim_worker(lane: &mut Lane) -> bool {
        if lane.worker_running {
            false
        } else {
            lane.worker_running = true;
            true
        }
    }

    /// Record the newest view of a session. Returns `true` when the caller must
    /// start a worker to send it.
    pub fn push_mirror(&self, job_id: &str, peer_id: &str, view_json: String) -> bool {
        let mut lanes = self.lock();
        let lane = lanes.entry(job_id.to_string()).or_default();
        lane.peer_id = peer_id.to_string();
        lane.last_mirror = Some(view_json.clone());
        lane.pending_mirror = Some(view_json);
        Self::claim_worker(lane)
    }

    /// Queue terminal output. Dropped on the floor (returns `false`) unless the
    /// originating device is subscribed and the job is still open. Never blocks
    /// beyond the lock, never grows past [`OUTPUT_QUEUE_CAP`] entries.
    pub fn push_output(&self, job_id: &str, bytes: &[u8]) -> bool {
        if bytes.is_empty() {
            return false;
        }
        let mut lanes = self.lock();
        let Some(lane) = lanes.get_mut(job_id) else {
            return false;
        };
        if !lane.subscribed || lane.closed {
            return false;
        }
        let mut rest = bytes;
        // Top up the newest waiting entry first: it has not been handed to the
        // worker yet (the worker takes from the FRONT), so merging is safe.
        if let Some(back) = lane.queue.back_mut() {
            let room = OUTPUT_ENTRY_MAX_BYTES.saturating_sub(back.bytes.len());
            let take = room.min(rest.len());
            back.bytes.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
        }
        for piece in rest.chunks(OUTPUT_ENTRY_MAX_BYTES) {
            lane.last_seq = lane.last_seq.wrapping_add(1);
            lane.queue.push_back(OutputEntry {
                seq: lane.last_seq,
                bytes: piece.to_vec(),
            });
            while lane.queue.len() > OUTPUT_QUEUE_CAP {
                lane.queue.pop_front();
            }
        }
        Self::claim_worker(lane)
    }

    /// Is the originating device currently watching this job's output?
    pub fn is_subscribed(&self, job_id: &str) -> bool {
        self.lock()
            .get(job_id)
            .map(|l| l.subscribed && !l.closed)
            .unwrap_or(false)
    }

    /// Turn the output tail on or off. Turning it off discards what is waiting:
    /// nobody is watching any more.
    pub fn set_subscribed(&self, job_id: &str, peer_id: &str, subscribed: bool) {
        let mut lanes = self.lock();
        let lane = lanes.entry(job_id.to_string()).or_default();
        lane.peer_id = peer_id.to_string();
        lane.subscribed = subscribed;
        if !subscribed {
            lane.queue.clear();
        }
    }

    /// Hand the worker its next unit of work, or retire it. When there is
    /// nothing left the worker slot is released under the same lock, and a
    /// finished job's lane is dropped.
    pub fn next_work(&self, job_id: &str) -> Option<Work> {
        let mut lanes = self.lock();
        let lane = lanes.get_mut(job_id)?;
        let mirror = lane.pending_mirror.take();
        let output = if lane.subscribed {
            lane.queue.pop_front()
        } else {
            None
        };
        if mirror.is_none() && output.is_none() {
            lane.worker_running = false;
            if lane.closed {
                lanes.remove(job_id);
            }
            return None;
        }
        Some(Work {
            peer_id: lane.peer_id.clone(),
            mirror,
            output,
        })
    }

    /// The job finished. Output already queued still drains; nothing new is
    /// taken, and the lane disappears once its worker is idle.
    pub fn close(&self, job_id: &str) {
        let mut lanes = self.lock();
        let remove = match lanes.get_mut(job_id) {
            Some(lane) => {
                lane.closed = true;
                !lane.worker_running
            }
            None => false,
        };
        if remove {
            lanes.remove(job_id);
        }
    }

    /// The last view of every session this device runs for `peer_id`, to
    /// repeat on link-up so the originator does not sit on `unknown` until the
    /// session next changes state.
    pub fn last_mirrors_for_peer(&self, peer_id: &str) -> Vec<(String, String)> {
        self.lock()
            .iter()
            .filter(|(_, lane)| lane.peer_id == peer_id && !lane.closed)
            .filter_map(|(job_id, lane)| {
                lane.last_mirror.clone().map(|view| (job_id.clone(), view))
            })
            .collect()
    }
}

// -- The originating side: one view per job ------------------------------------

/// The fields a mirror may carry. Parsed leniently: the running side may send a
/// whole [`RemoteSessionView`] (extra fields are ignored) or just these, and a
/// missing field reads as absent rather than failing the view.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct MirrorFields {
    session_id: Option<String>,
    title: Option<String>,
    state: Option<RemoteSessionState>,
    state_reason: Option<String>,
    last_activity_ms: Option<f64>,
}

/// Wall-clock now in epoch milliseconds, the unit every `*_ms` field uses.
pub fn now_ms() -> f64 {
    chrono::Utc::now().timestamp_millis() as f64
}

fn rfc3339_ms(s: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.timestamp_millis() as f64)
}

/// Build the originating device's view of one remote session.
///
/// `None` for anything that is not an OUTBOUND `fleet_session` job with a
/// readable payload. The identity fields (job, peer, project, mode, status,
/// receipt) always come from THIS device's row and payload; only the live
/// fields (session id, title, state, reason, last activity) come from the
/// mirror, because those are the only ones the running device knows better.
///
/// The state rule (D8: a quiet remote session reads `unknown`, never running):
/// - `queued` / `pending` job → `Queued`: it has not started anywhere.
/// - `running` job → the mirrored state while the last mirror is under
///   [`MIRROR_FRESH_FOR_MS`] old; `Spawning` in the first
///   [`MIRROR_FRESH_FOR_MS`] after acceptance when no mirror has arrived yet;
///   otherwise `Unknown`.
/// - terminal job → `Exited`, or the mirror's `Finished`; a failure, refusal or
///   cancellation carries its reason.
pub fn build_view(
    job: &RemoteJob,
    mirror: Option<&RemoteJobMirror>,
    now_ms: f64,
) -> Option<RemoteSessionView> {
    if job.direction != RemoteJobDirection::Outbound || job.kind != REMOTE_JOB_KIND_FLEET_SESSION {
        return None;
    }
    let payload: FleetSessionJobPayload = match job
        .payload_json
        .as_deref()
        .map(serde_json::from_str::<FleetSessionJobPayload>)
    {
        Some(Ok(p)) => p,
        _ => {
            tracing::warn!(job_id = %job.id, "fleet_session job has no readable payload; no view");
            return None;
        }
    };

    let mirror_at_ms = mirror.and_then(|m| rfc3339_ms(&m.mirror_at)).unwrap_or(0.0);
    let fields: MirrorFields = mirror
        .and_then(|m| serde_json::from_str(&m.view_json).ok())
        .unwrap_or_default();
    let created_at_ms = rfc3339_ms(&job.created_at).unwrap_or(0.0);
    let updated_at_ms = rfc3339_ms(&job.updated_at).unwrap_or(created_at_ms);
    let fresh = mirror_at_ms > 0.0 && now_ms - mirror_at_ms <= MIRROR_FRESH_FOR_MS;

    let (state, state_reason) = match job.status {
        RemoteJobStatus::Queued | RemoteJobStatus::Pending => (RemoteSessionState::Queued, None),
        RemoteJobStatus::Running => match fields.state {
            Some(state) if fresh => (state, fields.state_reason.clone()),
            None if mirror_at_ms == 0.0 && now_ms - updated_at_ms <= MIRROR_FRESH_FOR_MS => {
                (RemoteSessionState::Spawning, None)
            }
            _ => (RemoteSessionState::Unknown, None),
        },
        RemoteJobStatus::Completed => match fields.state {
            Some(RemoteSessionState::Finished) => (RemoteSessionState::Finished, None),
            _ => (RemoteSessionState::Exited, None),
        },
        RemoteJobStatus::Failed | RemoteJobStatus::Cancelled => {
            (RemoteSessionState::Exited, job.summary.clone())
        }
        RemoteJobStatus::Refused => (
            RemoteSessionState::Exited,
            job.refusal_reason.clone().or_else(|| job.summary.clone()),
        ),
    };

    let last_activity_ms = fields
        .last_activity_ms
        .unwrap_or(0.0)
        .max(mirror_at_ms)
        .max(updated_at_ms);

    Some(RemoteSessionView {
        job_id: job.id.clone(),
        session_id: fields.session_id,
        peer_id: job.peer_id.clone(),
        peer_display_name: job.peer_display_name.clone(),
        project_id: payload.project_id,
        project_label: payload.project_name,
        github_url: payload.github_url,
        title: fields.title,
        state,
        state_reason,
        mode: payload.mode,
        created_at_ms,
        last_activity_ms,
        mirror_at_ms,
        job_status: job.status,
        receipt: job.receipt.clone(),
    })
}

/// The view of one job, read from the database (no network needed).
pub fn view_for_job(
    pool: &DbPool,
    job_id: &str,
    now_ms: f64,
) -> Result<Option<RemoteSessionView>, AppError> {
    let Some(job) = repo::get(pool, job_id)? else {
        return Ok(None);
    };
    let mirror = repo::get_mirror(pool, job_id)?;
    Ok(build_view(&job, mirror.as_ref(), now_ms))
}

/// Every remote session this device dispatched that is still open or finished
/// within [`FINISHED_VISIBLE_FOR`], newest first. A DB read: it works with the
/// network stopped, and the liveness rule is applied here, on read.
pub fn list_views(pool: &DbPool, now_ms: f64) -> Result<Vec<RemoteSessionView>, AppError> {
    let since = (chrono::Utc::now() - FINISHED_VISIBLE_FOR).to_rfc3339();
    Ok(
        repo::list_outbound_with_mirrors(pool, REMOTE_JOB_KIND_FLEET_SESSION, &since)?
            .into_iter()
            .filter_map(|(job, mirror)| build_view(&job, mirror.as_ref(), now_ms))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::models::RemoteSessionMode;

    fn job(status: RemoteJobStatus) -> RemoteJob {
        let payload = FleetSessionJobPayload {
            project_id: "p1".into(),
            github_url: "https://github.com/o/r".into(),
            project_name: "Repo".into(),
            prompt: "fix it".into(),
            mode: RemoteSessionMode::Interactive,
            branch: "remote/aaaa/bbbb".into(),
            persona_id: None,
        };
        RemoteJob {
            id: "job-1".into(),
            direction: RemoteJobDirection::Outbound,
            peer_id: "peer-b".into(),
            peer_display_name: "Desktop".into(),
            kind: REMOTE_JOB_KIND_FLEET_SESSION.into(),
            instruction: "fix it".into(),
            payload_json: Some(serde_json::to_string(&payload).unwrap()),
            receipt: None,
            status,
            summary: None,
            refusal_reason: None,
            last_seq: 0,
            created_at: "2026-09-23T10:00:00+00:00".into(),
            updated_at: "2026-09-23T10:00:00+00:00".into(),
            completed_at: None,
        }
    }

    fn at(s: &str) -> f64 {
        rfc3339_ms(s).unwrap()
    }

    fn mirror(state: &str, when: &str) -> RemoteJobMirror {
        RemoteJobMirror {
            view_json: format!(r#"{{"sessionId":"s1","title":"t","state":"{state}"}}"#),
            mirror_at: when.into(),
        }
    }

    #[test]
    fn a_fresh_mirror_is_believed_and_a_quiet_one_reads_unknown() {
        let j = job(RemoteJobStatus::Running);
        let m = mirror("awaiting_input", "2026-09-23T10:01:00+00:00");

        let v = build_view(&j, Some(&m), at("2026-09-23T10:01:30+00:00")).expect("view");
        assert_eq!(v.state, RemoteSessionState::AwaitingInput);
        assert_eq!(v.session_id.as_deref(), Some("s1"));
        assert_eq!(v.project_label, "Repo");
        assert_eq!(v.peer_display_name, "Desktop");
        assert_eq!(v.mirror_at_ms, at("2026-09-23T10:01:00+00:00"));

        let v = build_view(&j, Some(&m), at("2026-09-23T10:01:46+00:00")).expect("view");
        assert_eq!(
            v.state,
            RemoteSessionState::Unknown,
            "46 s without a word is unknown, never running"
        );
    }

    #[test]
    fn no_mirror_reads_spawning_briefly_then_unknown_and_queued_is_queued() {
        let j = job(RemoteJobStatus::Running);
        assert_eq!(
            build_view(&j, None, at("2026-09-23T10:00:10+00:00"))
                .unwrap()
                .state,
            RemoteSessionState::Spawning
        );
        assert_eq!(
            build_view(&j, None, at("2026-09-23T10:05:00+00:00"))
                .unwrap()
                .state,
            RemoteSessionState::Unknown
        );
        let q = job(RemoteJobStatus::Queued);
        let v = build_view(&q, None, at("2026-09-23T12:00:00+00:00")).unwrap();
        assert_eq!(v.state, RemoteSessionState::Queued);
        assert_eq!(v.job_status, RemoteJobStatus::Queued);
    }

    #[test]
    fn a_finished_job_exits_with_its_reason_and_other_jobs_have_no_view() {
        let mut j = job(RemoteJobStatus::Refused);
        j.refusal_reason = Some("project_not_found".into());
        let v = build_view(&j, None, 0.0).unwrap();
        assert_eq!(v.state, RemoteSessionState::Exited);
        assert_eq!(v.state_reason.as_deref(), Some("project_not_found"));

        let mut instruction = job(RemoteJobStatus::Running);
        instruction.kind = "instruction".into();
        assert!(build_view(&instruction, None, 0.0).is_none());
        let mut inbound = job(RemoteJobStatus::Running);
        inbound.direction = RemoteJobDirection::Inbound;
        assert!(build_view(&inbound, None, 0.0).is_none());
    }

    #[test]
    fn the_output_tail_is_bounded_drops_the_oldest_and_shows_the_gap() {
        let lanes = SessionLanes::default();
        assert!(
            !lanes.push_output("job-1", b"x"),
            "nothing is taken before anyone subscribes"
        );
        lanes.set_subscribed("job-1", "peer-a", true);

        // Fill past the cap with entries that cannot merge (each is full size).
        let full = vec![b'a'; OUTPUT_ENTRY_MAX_BYTES];
        assert!(
            lanes.push_output("job-1", &full),
            "first push claims the worker"
        );
        for _ in 1..OUTPUT_QUEUE_CAP + 10 {
            assert!(!lanes.push_output("job-1", &full), "worker already claimed");
        }
        let first = lanes
            .next_work("job-1")
            .expect("work")
            .output
            .expect("entry");
        assert_eq!(first.seq, 11, "the 10 oldest entries were dropped");

        // Small writes merge into the newest waiting entry instead of queueing.
        let lanes = SessionLanes::default();
        lanes.set_subscribed("job-2", "peer-a", true);
        lanes.push_output("job-2", b"one");
        lanes.push_output("job-2", b"two");
        let w = lanes.next_work("job-2").expect("work");
        assert_eq!(w.output.expect("entry").bytes, b"onetwo");
        assert!(
            lanes.next_work("job-2").is_none(),
            "worker retires when idle"
        );
    }

    #[test]
    fn mirrors_are_latest_wins_and_a_closed_lane_drains_then_disappears() {
        let lanes = SessionLanes::default();
        assert!(lanes.push_mirror("job-1", "peer-a", "v1".into()));
        assert!(!lanes.push_mirror("job-1", "peer-a", "v2".into()));
        lanes.set_subscribed("job-1", "peer-a", true);
        lanes.push_output("job-1", b"tail");
        lanes.close("job-1");
        assert!(
            !lanes.push_output("job-1", b"late"),
            "a finished job takes no output"
        );

        let w = lanes.next_work("job-1").expect("work");
        assert_eq!(
            w.mirror.as_deref(),
            Some("v2"),
            "only the latest view is sent"
        );
        assert_eq!(w.output.expect("queued output still drains").bytes, b"tail");
        assert!(lanes.next_work("job-1").is_none());
        assert!(
            lanes.last_mirrors_for_peer("peer-a").is_empty(),
            "the finished lane is gone"
        );
    }

    #[test]
    fn unsubscribing_discards_the_waiting_tail() {
        let lanes = SessionLanes::default();
        lanes.set_subscribed("job-1", "peer-a", true);
        lanes.push_output("job-1", b"abc");
        assert!(lanes.is_subscribed("job-1"));
        lanes.set_subscribed("job-1", "peer-a", false);
        assert!(!lanes.is_subscribed("job-1"));
        assert!(lanes.next_work("job-1").is_none());
    }
}
