//! Cross-device job dispatch — the wire and the state machine.
//!
//! Device A (Athena, or an explicit "Run on" pick) sends a job to device B; B
//! runs it and streams back an acknowledgement, progress notes and a final
//! summary. This module owns the wire half and the persistence half. It does
//! NOT run anything: the execution seam is [`RemoteJobExecutor`], and the app
//! layer supplies the implementation.
//!
//! Two kinds travel: `instruction` (a natural-language ask, the text is the
//! whole request) and `fleet_session` (a `FleetSessionJobPayload` in
//! `payload_json`; its live mirror and output tail live in
//! [`super::remote_sessions`]).
//!
//! ```text
//!  A (originator)                              B (runner, a PAIRED device)
//!  send_job(peer_id, kind, instruction, payload)
//!    peer offline → persist [outbound, queued], return   (drained on link-up)
//!    peer online  → persist [outbound, pending]
//!    ── RemoteJobRequest{job_id, kind, instruction, name, payload} ──▶
//!                                        ┌─ IS THE SENDER PAIRED? ──────────┐
//!                                        │ no  → log + RemoteJobAck{false}  │
//!                                        │ yes → executor.admit(...)        │
//!                                        │       persist [inbound, running] │
//!                                        └──────────────────────────────────┘
//!    ◀── RemoteJobAck{accepted, reason} ──   executor.execute(job, handle)
//!    mark running / refused
//!    ◀── RemoteJobProgress{job_id, seq, text} ──   handle.progress(...)   (×N)
//!    ◀── RemoteSessionMirror{job_id, view} ──      handle.mirror(...)     (latest-wins)
//!    ── RemoteSessionOutputSubscribe{job_id, on} ─▶
//!    ◀── RemoteSessionOutput{job_id, seq, b64} ──  handle.output(...)     (lossy, while on)
//!    ── RemoteJobCommand{job_id, cmd, text} ──▶    executor.command(...)
//!    ◀── RemoteJobCommandAck{accepted, reason} ──
//!    ◀── RemoteJobResult{job_id, status, summary, receipt} ── handle.complete*(...)
//! ```
//!
//! ## Trust — the security core, and why an authenticated peer is not a trusted one
//!
//! The p2p connect path deliberately does not restrict who may connect: any LAN
//! peer can complete the signed handshake and pull the public exposure
//! manifest, and that is intended. The handshake proves a peer *is who it says*
//! — it says nothing about whether you want it running work on your machine.
//! So the job path adds its own gate, and this module is the ONLY place it
//! lives: [`RemoteJobs::handle_message`] refuses EVERY job and session frame
//! whose sender has no row in `owned_devices`, logs the refusal with the peer
//! id, and answers a request with `RemoteJobAck { accepted: false }` so the
//! other side gets a reason rather than a timeout. Nothing is persisted for an
//! unpaired peer, and the executor is never reached.
//!
//! ## The outbox, and why an offline peer is not an error
//!
//! A job sent to a paired device that is not connected is persisted `queued`
//! and returned; it goes on the wire when the link next comes up
//! ([`RemoteJobs::on_link_up`] drains the outbox oldest-first BEFORE resuming
//! anything). A send that gets no answer (the link died mid-exchange) goes back
//! to `queued` instead of failing: the peer either never saw it, or accepted it
//! and will re-ack the repeat without running it twice (`create_inbound` is
//! idempotent on the job id). Waiting for a peer is a suspension, not a failure
//! (registry `suspension-is-not-failure`), so no retry budget exists to burn.
//!
//! ## Resume, and why nothing is delivered twice
//!
//! A job already running when the link drops keeps running — the executor is not
//! cancelled, and every note it reports is written to `remote_job_notes` before
//! any send is attempted, so a failed send costs nothing. On reconnect the
//! ORIGINATOR drives recovery: for each of its unfinished outbound jobs it sends
//! [`Message::RemoteJobResume`] carrying the highest contiguous note it holds,
//! and the runner answers on the same stream with the notes above that number,
//! followed by the result if the job has since finished. Redelivery is harmless
//! because `remote_job_notes` is keyed `(job_id, seq)`: a note that already
//! landed is ignored and no event is emitted for it. Exactly-once is therefore a
//! property of the schema, not of anyone remembering to deduplicate. Mirrors and
//! output chunks are NOT notes and are never replayed.

use std::collections::HashSet;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Serialize;
use tokio::sync::RwLock;

use personas_core::error::AppError;
use personas_db::models::{
    FleetSessionJobPayload, FleetSessionJobReceipt, RemoteJob, RemoteJobDirection, RemoteJobStatus,
    RemoteSessionCommand, RemoteSessionOutputChunk, RemoteSessionView,
    REMOTE_JOB_KIND_FLEET_SESSION, REMOTE_JOB_KIND_INSTRUCTION,
};
use personas_db::repos::resources::owned_devices as owned_devices_repo;
use personas_db::repos::resources::remote_jobs as repo;
use personas_db::DbPool;

use super::connection::ConnectionManager;
use super::protocol::{self, Message};
use super::remote_sessions::{self, SessionLanes};
use crate::event_registry::{emit_event, event_name};

/// How long to wait for the peer's ack before giving up on a send.
const ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// How long a resume exchange may take to replay one job's backlog.
const RESUME_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// How long the running side's executor may take to carry out one steering
/// command. Under [`ACK_TIMEOUT`], so the originator hears a refusal instead of
/// timing out on its own.
const COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
/// Hard cap on instruction length, well under the 16 MB protocol frame limit.
const MAX_INSTRUCTION_BYTES: usize = 32 * 1024;
/// Hard cap on a kind-specific payload or a receipt.
const MAX_PAYLOAD_BYTES: usize = 64 * 1024;
/// Hard cap on a single progress note.
const MAX_NOTE_BYTES: usize = 16 * 1024;
/// Hard cap on the text of a `send_input` command.
const MAX_COMMAND_TEXT_BYTES: usize = 16 * 1024;
/// Hard cap on one received output chunk (base64 of an
/// [`remote_sessions::OUTPUT_ENTRY_MAX_BYTES`] entry, with headroom).
const MAX_OUTPUT_CHUNK_B64: usize = 64 * 1024;

// -- The seam -----------------------------------------------------------
//
// Everything above this line is the wire and the database. Everything an
// executor implementation needs is below: what you are asked to do, how you
// report back, and the trait that connects them.

/// What a paired device asked this device to do.
///
/// Handed to [`RemoteJobExecutor::admit`] before anything is persisted, and to
/// [`RemoteJobExecutor::execute`] once the `remote_jobs` row exists as
/// `Running`.
#[derive(Debug, Clone)]
pub struct RemoteJobAssignment {
    /// The job id both devices key this exchange by.
    pub job_id: String,
    /// The peer that asked. Guaranteed to be a paired device at accept time.
    pub peer_id: String,
    /// The peer's display name, for "Laptop asked you to…" phrasing.
    pub origin_display_name: String,
    /// Job discriminator: [`REMOTE_JOB_KIND_INSTRUCTION`] or
    /// [`REMOTE_JOB_KIND_FLEET_SESSION`].
    pub kind: String,
    /// The instruction, verbatim. For `fleet_session` it is the human-readable
    /// line the originator's history shows; the request itself is the payload.
    pub instruction: String,
    /// The kind-specific body. `None` for `instruction`; for `fleet_session`
    /// always `Some`, and already checked to parse as a
    /// [`FleetSessionJobPayload`].
    pub payload_json: Option<String>,
}

/// The executor's verdict on a request, before anything is persisted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Admission {
    Accept,
    /// Decline with a reason the originating device shows (and stores as the
    /// job's `refusal_reason`), e.g. `project_not_found`. Nothing is persisted
    /// here and `execute` is never called.
    Refuse(String),
}

/// The reporting side of the seam, handed to the executor alongside the
/// assignment. `progress` / `complete*` / `fail` persist first and send second,
/// so a dropped link costs delivery latency and never the record. `mirror` and
/// `output` are the live, non-durable half and never block.
#[derive(Clone)]
pub struct RemoteJobHandle {
    jobs: Arc<RemoteJobs>,
    job_id: String,
    peer_id: String,
    /// The runtime the job was accepted on, so the synchronous `mirror` and
    /// `output` can start their sender from any thread (a PTY reader is not a
    /// tokio task).
    rt: tokio::runtime::Handle,
}

impl RemoteJobHandle {
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    /// The paired device that asked for this job.
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    /// Report an intermediate note. Numbering, persistence, delivery and
    /// replay-after-reconnect are handled for you; call it as often as is
    /// useful. Errors are DB errors only — a peer that has gone offline is not
    /// an error, the note is simply delivered on reconnect.
    pub async fn progress(&self, text: impl Into<String>) -> Result<(), AppError> {
        self.jobs.report_progress(&self.job_id, text.into()).await
    }

    /// Finish the job successfully; `summary` is the answer the other device
    /// shows its user. Idempotent — a second terminal call is a no-op.
    pub async fn complete(&self, summary: impl Into<String>) -> Result<(), AppError> {
        self.jobs
            .report_result(
                &self.job_id,
                RemoteJobStatus::Completed,
                summary.into(),
                None,
            )
            .await
    }

    /// Finish a `fleet_session` job successfully with its receipt. The receipt
    /// is persisted on this device, travels in `RemoteJobResult.receipt_json`,
    /// and is replayed with the result after a reconnect. Idempotent like
    /// [`Self::complete`]: once terminal, neither the status nor the receipt
    /// changes.
    pub async fn complete_with_receipt(
        &self,
        summary: impl Into<String>,
        receipt: &FleetSessionJobReceipt,
    ) -> Result<(), AppError> {
        let receipt_json = serde_json::to_string(receipt)?;
        self.jobs
            .report_result(
                &self.job_id,
                RemoteJobStatus::Completed,
                summary.into(),
                Some(receipt_json),
            )
            .await
    }

    /// Finish the job unsuccessfully; `summary` is why.
    pub async fn fail(&self, summary: impl Into<String>) -> Result<(), AppError> {
        self.jobs
            .report_result(&self.job_id, RemoteJobStatus::Failed, summary.into(), None)
            .await
    }

    /// Publish the session's current view to the originating device.
    ///
    /// `view_json` is a serialized `RemoteSessionView` as THIS device sees the
    /// session (the originator reads `sessionId`, `title`, `state`,
    /// `stateReason` and `lastActivityMs` from it and supplies every other
    /// field itself). Latest-wins: calls made faster than the link can carry
    /// them collapse into the newest. Persists nothing here, never blocks, and
    /// is safe to call from any thread; the newest view is repeated on the next
    /// link-up if the peer is offline now.
    pub fn mirror(&self, view_json: impl Into<String>) {
        let view_json = view_json.into();
        if view_json.len() > remote_sessions::MAX_MIRROR_BYTES {
            tracing::warn!(job_id = %self.job_id, bytes = view_json.len(), "Mirror too large; not sent");
            return;
        }
        if self
            .jobs
            .lanes
            .push_mirror(&self.job_id, &self.peer_id, view_json)
        {
            self.spawn_lane_worker();
        }
    }

    /// Feed terminal output to the originating device's live tail.
    ///
    /// Taken only while the originator is subscribed ([`Self::output_subscribed`])
    /// and the job is open; dropped otherwise. LOSSY and BOUNDED: at most
    /// [`remote_sessions::OUTPUT_QUEUE_CAP`] entries wait, the oldest is
    /// dropped on overflow, and the network is never awaited on the caller's
    /// thread — a slow link can never back-pressure the PTY.
    pub fn output(&self, bytes: &[u8]) {
        if self.jobs.lanes.push_output(&self.job_id, bytes) {
            self.spawn_lane_worker();
        }
    }

    /// Whether the originating device is watching this job's output right now.
    /// A cheap check an executor can use to skip reading its output ring at all.
    pub fn output_subscribed(&self) -> bool {
        self.jobs.lanes.is_subscribed(&self.job_id)
    }

    fn spawn_lane_worker(&self) {
        let jobs = self.jobs.clone();
        let job_id = self.job_id.clone();
        // The worker drains the lane and exits on its own when it is empty; it
        // reports nothing (every failure is a dropped live frame, by design).
        self.rt.spawn(async move { jobs.run_lane(job_id).await });
    }
}

/// THE CONTRACT between the wire (this module) and whatever actually runs a
/// remote job.
///
/// The implementation lives in the app layer and is installed at startup via
/// [`RemoteJobs::set_executor`]; until then [`UnhandledRemoteJobs`] is in place
/// and every accepted job fails immediately with a clear reason rather than
/// hanging.
///
/// Contract for implementors:
/// - `admit` (optional) is the only place a request can be DECLINED on its
///   merits. It runs before any row exists, so it must be quick (a lookup, not
///   work). A repeat of an already-accepted job id is re-acked without calling
///   it again.
/// - `execute` is called on the inbound dispatch task, so it MUST return
///   promptly. Spawn the real work; do not await a long run inline.
/// - By the time `execute` is called, the peer is paired, the row is persisted
///   as `Running`, and the ack is on its way back. Report a failure through
///   `handle.fail(...)`.
/// - Every job must reach a terminal state through `handle.complete*` or
///   `handle.fail`, including on the error paths — a job that is never finished
///   stays `Running` forever on both devices.
/// - `command` (optional) steers a running job; its `Ok` / `Err` becomes the
///   `RemoteJobCommandAck`. It must answer within 10 s.
#[async_trait::async_trait]
pub trait RemoteJobExecutor: Send + Sync {
    async fn admit(&self, _job: &RemoteJobAssignment) -> Admission {
        Admission::Accept
    }

    async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle);

    async fn command(
        &self,
        _job_id: &str,
        _command: RemoteSessionCommand,
        _text: Option<String>,
    ) -> Result<(), AppError> {
        Err(AppError::Validation(
            "This device cannot steer remote sessions.".into(),
        ))
    }
}

/// The default executor: does no work, and says so.
///
/// Deliberately not a silent no-op. A job that is accepted and then never
/// finished would sit `Running` on both devices with no way for either user to
/// tell a missing handler from a slow one, so this fails the job immediately
/// with the reason.
pub struct UnhandledRemoteJobs;

#[async_trait::async_trait]
impl RemoteJobExecutor for UnhandledRemoteJobs {
    async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle) {
        tracing::warn!(
            job_id = %job.job_id,
            peer_id = %job.peer_id,
            "Remote job accepted but no executor is installed on this device"
        );
        let _ = handle
            .fail("This device has no assistant configured to run remote instructions.")
            .await;
    }
}

// -- The service --------------------------------------------------------

/// Owns the remote-job wire exchange on both sides.
pub struct RemoteJobs {
    pool: DbPool,
    connections: Arc<ConnectionManager>,
    executor: RwLock<Arc<dyn RemoteJobExecutor>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    /// Running side: live mirror + output state per job.
    lanes: SessionLanes,
    /// Originating side: the jobs whose output this device wants to watch. Kept
    /// so the subscription survives a dropped link: it is re-sent on link-up.
    wanted_tails: std::sync::Mutex<HashSet<String>>,
    /// Every event this service would have emitted, for tests that have no
    /// `AppHandle`. Not compiled outside tests.
    #[cfg(test)]
    pub(crate) emitted: std::sync::Mutex<Vec<(&'static str, serde_json::Value)>>,
}

impl RemoteJobs {
    pub fn new(
        pool: DbPool,
        connections: Arc<ConnectionManager>,
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    ) -> Self {
        Self {
            pool,
            connections,
            executor: RwLock::new(Arc::new(UnhandledRemoteJobs)),
            app_handle,
            lanes: SessionLanes::default(),
            wanted_tails: std::sync::Mutex::new(HashSet::new()),
            #[cfg(test)]
            emitted: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Install the executor that actually runs accepted jobs. Called once at
    /// startup by the app layer; replaces [`UnhandledRemoteJobs`].
    pub async fn set_executor(&self, executor: Arc<dyn RemoteJobExecutor>) {
        *self.executor.write().await = executor;
        tracing::info!("Remote-job executor installed");
    }

    // -- Trust ----------------------------------------------------------

    /// The one gate on the job path: the peer must be a paired device.
    ///
    /// An authenticated connection is NOT a trusted one — any LAN peer may
    /// complete the signed handshake. Only a row in `owned_devices` (written by
    /// the fingerprint-confirmed pairing ceremony) authorizes a peer to run
    /// work here or to report on ours.
    fn require_paired(&self, peer_id: &str) -> Result<String, AppError> {
        match owned_devices_repo::get_owned_device(&self.pool, peer_id)? {
            Some(device) => Ok(device.display_name),
            None => Err(AppError::Forbidden(format!(
                "Peer {peer_id} is not one of your paired devices. \
                 Pair it under Settings > Devices before sending it work."
            ))),
        }
    }

    // -- Originating side ------------------------------------------------

    /// Send an `instruction` job. A thin wrapper over [`Self::send_job`] kept
    /// for its callers; `kind` must be `None` or `"instruction"`.
    pub async fn send_instruction(
        self: &Arc<Self>,
        peer_id: &str,
        kind: Option<String>,
        instruction: &str,
    ) -> Result<RemoteJob, AppError> {
        let kind = kind.unwrap_or_else(|| REMOTE_JOB_KIND_INSTRUCTION.to_string());
        if kind != REMOTE_JOB_KIND_INSTRUCTION {
            return Err(AppError::Validation(format!(
                "Unknown remote job kind '{kind}'"
            )));
        }
        self.send_job(peer_id, &kind, instruction, None).await
    }

    /// Send a job to a paired device.
    ///
    /// - Unpaired peer: [`AppError::Forbidden`], before any row is written.
    /// - Bad kind / empty or oversized instruction / a `fleet_session` without
    ///   a readable payload: [`AppError::Validation`], nothing written.
    /// - Paired but NOT connected: the job is persisted `queued` and returned.
    ///   It is sent when the link next comes up.
    /// - Connected: persisted `pending`, sent, and returned after the ack as
    ///   `running` or `refused`. If the exchange dies, the job returns to
    ///   `queued` (it is not an error: see the module docs).
    pub async fn send_job(
        self: &Arc<Self>,
        peer_id: &str,
        kind: &str,
        instruction: &str,
        payload_json: Option<String>,
    ) -> Result<RemoteJob, AppError> {
        let display_name = self.require_paired(peer_id)?;
        let instruction = validate_job(kind, instruction, payload_json.as_deref())?;

        let job_id = uuid::Uuid::new_v4().to_string();
        let connected = self.connections.is_connected(peer_id).await;
        let job = repo::create_outbound_with_payload(
            &self.pool,
            &job_id,
            peer_id,
            &display_name,
            kind,
            &instruction,
            payload_json.as_deref(),
            if connected {
                RemoteJobStatus::Pending
            } else {
                RemoteJobStatus::Queued
            },
        )?;
        self.emit(&job).await;

        if connected {
            self.deliver_request(peer_id, &job).await;
        } else {
            tracing::info!(peer_id = %peer_id, job_id = %job_id, kind = %kind, "Peer offline; remote job queued in the outbox");
            // The link may have come up between the check above and the insert,
            // after its link-up drain already ran. Drain now so the job does not
            // wait for the NEXT link-up. The claim in `mark_pending` makes a
            // concurrent drain harmless.
            if self.connections.is_connected(peer_id).await {
                self.drain_outbox(peer_id).await;
            }
        }
        self.reload(&job_id)
    }

    /// Put one request on the wire and apply the answer. Returns `false` when
    /// the exchange failed (the link is down or the peer fell silent), in which
    /// case the job is back in the outbox.
    async fn deliver_request(self: &Arc<Self>, peer_id: &str, job: &RemoteJob) -> bool {
        let reply = self
            .exchange(
                peer_id,
                Message::RemoteJobRequest {
                    job_id: job.id.clone(),
                    kind: job.kind.clone(),
                    instruction: job.instruction.clone(),
                    origin_display_name: self.connections.local_display_name().to_string(),
                    payload_json: job.payload_json.clone(),
                },
                ACK_TIMEOUT,
            )
            .await;

        let delivered = reply.is_ok();
        let applied = match reply {
            Ok(Message::RemoteJobAck {
                accepted, reason, ..
            }) => self.settle_ack(&job.id, accepted, reason),
            Ok(other) => {
                tracing::warn!(peer_id = %peer_id, msg = ?other, "Unexpected reply to RemoteJobRequest");
                repo::mark_cancelled(
                    &self.pool,
                    &job.id,
                    "The other device sent an unexpected reply.",
                )
                .map(|_| ())
            }
            Err(e) => {
                // Not a failure: waiting for a peer is a suspension. The peer
                // either never got the request or will re-ack the repeat.
                tracing::debug!(peer_id = %peer_id, job_id = %job.id, "Remote job send got no answer, back to the outbox: {e}");
                repo::mark_queued(&self.pool, &job.id).map(|_| ())
            }
        };
        if let Err(e) = applied {
            tracing::warn!(job_id = %job.id, "Could not record the send outcome: {e}");
        }
        if let Ok(job) = self.reload(&job.id) {
            self.emit(&job).await;
        }
        delivered
    }

    /// Apply an ack to an outbound job that has not started yet. A job already
    /// running or finished (its progress or result overtook the ack on another
    /// stream) is left alone.
    fn settle_ack(
        &self,
        job_id: &str,
        accepted: bool,
        reason: Option<String>,
    ) -> Result<(), AppError> {
        let job = self.reload(job_id)?;
        if !matches!(
            job.status,
            RemoteJobStatus::Pending | RemoteJobStatus::Queued
        ) {
            return Ok(());
        }
        if accepted {
            repo::mark_running(&self.pool, job_id)
        } else {
            let reason = reason.unwrap_or_else(|| "The other device declined.".into());
            tracing::info!(job_id = %job_id, reason = %reason, "Remote job refused by peer");
            repo::mark_refused(&self.pool, job_id, &reason)
        }
    }

    /// Send every `queued` job for `peer_id`, oldest first. Stops at the first
    /// send that gets no answer (the link is not usable); that job and every
    /// one after it stay queued for the next link-up. No retry count exists or
    /// is burned.
    pub async fn drain_outbox(self: &Arc<Self>, peer_id: &str) {
        if self.require_paired(peer_id).is_err() {
            return;
        }
        let queued = match repo::list_queued_for_peer(&self.pool, peer_id) {
            Ok(jobs) => jobs,
            Err(e) => {
                tracing::warn!(peer_id = %peer_id, "Could not read the outbox: {e}");
                return;
            }
        };
        for job in queued {
            if !self.connections.is_connected(peer_id).await {
                break;
            }
            match repo::mark_pending(&self.pool, &job.id) {
                Ok(true) => {}
                // Another drain claimed it, or it moved on. Not ours to send.
                Ok(false) => continue,
                Err(e) => {
                    tracing::warn!(job_id = %job.id, "Could not claim a queued job: {e}");
                    continue;
                }
            }
            tracing::info!(peer_id = %peer_id, job_id = %job.id, "Draining a queued remote job");
            if !self.deliver_request(peer_id, &job).await {
                break;
            }
        }
    }

    /// Everything a (re)connected link owes, in order: drain the outbox, resume
    /// the jobs already running there, re-send this device's output
    /// subscriptions, and repeat the last mirror of every session this device
    /// runs for that peer. Called once per established connection.
    pub async fn on_link_up(self: &Arc<Self>, peer_id: &str) {
        if self.require_paired(peer_id).is_err() {
            return;
        }
        self.drain_outbox(peer_id).await;
        self.resume_with_peer(peer_id).await;
        self.resend_tail_subscriptions(peer_id).await;
        for (job_id, view_json) in self.lanes.last_mirrors_for_peer(peer_id) {
            self.deliver(peer_id, Message::RemoteSessionMirror { job_id, view_json })
                .await;
        }
    }

    /// Replay anything this device missed for one peer, in both directions.
    ///
    /// Outbound jobs ask the peer for the notes above what we hold; inbound jobs
    /// need nothing from us, because the peer will ask us in the same way.
    /// Queued jobs are not resumed — they were never sent; the drain sends them.
    pub async fn resume_with_peer(self: &Arc<Self>, peer_id: &str) {
        if self.require_paired(peer_id).is_err() {
            return;
        }
        let open =
            match repo::list_unfinished_for_peer(&self.pool, RemoteJobDirection::Outbound, peer_id)
            {
                Ok(jobs) => jobs,
                Err(e) => {
                    tracing::warn!(peer_id = %peer_id, "Could not list jobs to resume: {e}");
                    return;
                }
            };
        for job in open {
            if let Err(e) = self.resume_job(peer_id, &job).await {
                tracing::debug!(
                    peer_id = %peer_id,
                    job_id = %job.id,
                    "Resume for remote job did not complete: {e}"
                );
            }
        }
    }

    /// One job's resume exchange: state what we hold, then apply everything the
    /// peer replays on the same stream until it finishes or falls silent.
    async fn resume_job(self: &Arc<Self>, peer_id: &str, job: &RemoteJob) -> Result<(), AppError> {
        let (mut send, mut recv) = self.connections.open_stream(peer_id).await?;
        protocol::write_message(
            &mut send,
            &Message::RemoteJobResume {
                job_id: job.id.clone(),
                last_seq: job.last_seq,
            },
        )
        .await?;

        let deadline = tokio::time::Instant::now() + RESUME_TIMEOUT;
        loop {
            let frame = match tokio::time::timeout_at(deadline, protocol::decode(&mut recv)).await {
                // A closed stream is the normal end of a replay with nothing
                // left to send, so it is not worth surfacing as an error.
                Ok(Ok(frame)) => frame,
                Ok(Err(_)) | Err(_) => break,
            };
            match frame {
                Message::RemoteJobProgress { job_id, seq, text } => {
                    self.apply_progress(peer_id, &job_id, seq, text).await?;
                }
                Message::RemoteJobResult {
                    job_id,
                    status,
                    summary,
                    receipt_json,
                } => {
                    self.apply_result(peer_id, &job_id, &status, summary, receipt_json)
                        .await?;
                    break;
                }
                other => {
                    tracing::debug!(peer_id = %peer_id, msg = ?other, "Unexpected frame during resume");
                    break;
                }
            }
        }
        Ok(())
    }

    /// Steer a running remote session and wait for the running device's ack.
    ///
    /// Fails typed: [`AppError::NotFound`] for an unknown job,
    /// [`AppError::Validation`] for a job this device did not send or that has
    /// already finished, [`AppError::NetworkOffline`] when the device is not
    /// connected or does not answer, and [`AppError::Execution`] carrying the
    /// running device's reason when it declined.
    pub async fn send_command(
        &self,
        job_id: &str,
        command: RemoteSessionCommand,
        text: Option<String>,
    ) -> Result<(), AppError> {
        let job = self.reload(job_id)?;
        if job.direction != RemoteJobDirection::Outbound {
            return Err(AppError::Validation(
                "Only a session this device sent can be steered from here.".into(),
            ));
        }
        if job.status.is_terminal() {
            return Err(AppError::Validation(format!(
                "That remote session has already finished ({}).",
                job.status.as_str()
            )));
        }
        if text
            .as_ref()
            .is_some_and(|t| t.len() > MAX_COMMAND_TEXT_BYTES)
        {
            return Err(AppError::Validation(
                "That input is too long to send.".into(),
            ));
        }
        if !self.connections.is_connected(&job.peer_id).await {
            return Err(offline(&job.peer_display_name));
        }
        let token = command_token(command);
        let reply = self
            .exchange(
                &job.peer_id,
                Message::RemoteJobCommand {
                    job_id: job_id.to_string(),
                    command: token.clone(),
                    text,
                },
                ACK_TIMEOUT,
            )
            .await
            .map_err(|_| offline(&job.peer_display_name))?;
        match reply {
            Message::RemoteJobCommandAck { accepted: true, .. } => Ok(()),
            Message::RemoteJobCommandAck { reason, .. } => Err(AppError::Execution(format!(
                "\"{}\" declined {token}: {}",
                job.peer_display_name,
                reason.unwrap_or_else(|| "no reason given".into())
            ))),
            other => {
                tracing::warn!(job_id = %job_id, msg = ?other, "Unexpected reply to RemoteJobCommand");
                Err(AppError::Execution(format!(
                    "\"{}\" sent an unexpected reply to {token}.",
                    job.peer_display_name
                )))
            }
        }
    }

    /// Start (`true`) or stop (`false`) watching a remote session's output.
    ///
    /// The wish is remembered and re-sent on every link-up until it is turned
    /// off or the job finishes, so an open viewer survives a dropped link.
    /// Offline is therefore not an error. Unsubscribing never cancels the
    /// session.
    pub async fn subscribe_output(&self, job_id: &str, subscribe: bool) -> Result<(), AppError> {
        let job = self.reload(job_id)?;
        if job.direction != RemoteJobDirection::Outbound {
            return Err(AppError::Validation(
                "Only a session this device sent can be watched from here.".into(),
            ));
        }
        {
            let mut wanted = self.wanted_tails.lock().unwrap_or_else(|e| e.into_inner());
            if subscribe && !job.status.is_terminal() {
                wanted.insert(job_id.to_string());
            } else {
                wanted.remove(job_id);
            }
        }
        if job.status.is_terminal() && subscribe {
            return Ok(());
        }
        self.deliver(
            &job.peer_id,
            Message::RemoteSessionOutputSubscribe {
                job_id: job_id.to_string(),
                subscribe,
            },
        )
        .await;
        Ok(())
    }

    async fn resend_tail_subscriptions(&self, peer_id: &str) {
        let wanted: Vec<String> = self
            .wanted_tails
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect();
        for job_id in wanted {
            match self.reload(&job_id) {
                Ok(job) if job.peer_id == peer_id && !job.status.is_terminal() => {
                    self.deliver(
                        peer_id,
                        Message::RemoteSessionOutputSubscribe {
                            job_id,
                            subscribe: true,
                        },
                    )
                    .await;
                }
                Ok(_) => {}
                Err(_) => {
                    self.wanted_tails
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(&job_id);
                }
            }
        }
    }

    /// The originating device's view of one remote session (see
    /// [`remote_sessions::build_view`]). A DB read.
    pub fn session_view(&self, job_id: &str) -> Result<Option<RemoteSessionView>, AppError> {
        remote_sessions::view_for_job(&self.pool, job_id, remote_sessions::now_ms())
    }

    // -- Running side ----------------------------------------------------

    /// Persist and deliver one progress note. Persistence first: a send that
    /// fails because the peer went away is not an error, the note is replayed on
    /// reconnect.
    async fn report_progress(self: &Arc<Self>, job_id: &str, text: String) -> Result<(), AppError> {
        let job = self.reload(job_id)?;
        if job.status.is_terminal() {
            return Err(AppError::Validation(format!(
                "Remote job {job_id} has already finished"
            )));
        }
        let text = truncate(text, MAX_NOTE_BYTES);
        let seq = repo::next_seq(&self.pool, job_id)?;
        repo::record_note(&self.pool, job_id, seq, &text)?;
        let job = self.reload(job_id)?;
        self.emit(&job).await;

        self.deliver(
            &job.peer_id,
            Message::RemoteJobProgress {
                job_id: job_id.to_string(),
                seq,
                text,
            },
        )
        .await;
        Ok(())
    }

    /// Persist and deliver the terminal result (and receipt, when there is one).
    async fn report_result(
        self: &Arc<Self>,
        job_id: &str,
        status: RemoteJobStatus,
        summary: String,
        receipt_json: Option<String>,
    ) -> Result<(), AppError> {
        let summary = truncate(summary, MAX_NOTE_BYTES);
        // The receipt lands with the verdict or not at all: a job that is
        // already terminal keeps the receipt it finished with.
        if let Some(receipt) = receipt_json.as_deref() {
            if !self.reload(job_id)?.status.is_terminal() {
                repo::set_receipt(&self.pool, job_id, receipt)?;
            }
        }
        let changed = repo::finish(&self.pool, job_id, status, &summary)?;
        let job = self.reload(job_id)?;
        if !changed {
            return Ok(());
        }
        self.lanes.close(job_id);
        self.emit(&job).await;
        self.deliver(
            &job.peer_id,
            Message::RemoteJobResult {
                job_id: job_id.to_string(),
                status: status.as_str().to_string(),
                summary,
                receipt_json: receipt_of(&job),
            },
        )
        .await;
        Ok(())
    }

    /// Drain one job's live lane: the newest mirror first, then one output
    /// entry per [`remote_sessions::OUTPUT_FRAME_INTERVAL`]. Exits when the
    /// lane is empty; the next push starts a new worker.
    async fn run_lane(self: Arc<Self>, job_id: String) {
        while let Some(work) = self.lanes.next_work(&job_id) {
            if let Some(view_json) = work.mirror {
                self.deliver(
                    &work.peer_id,
                    Message::RemoteSessionMirror {
                        job_id: job_id.clone(),
                        view_json,
                    },
                )
                .await;
            }
            if let Some(entry) = work.output {
                self.deliver(
                    &work.peer_id,
                    Message::RemoteSessionOutput {
                        job_id: job_id.clone(),
                        seq: entry.seq,
                        chunk_b64: B64.encode(&entry.bytes),
                    },
                )
                .await;
                tokio::time::sleep(remote_sessions::OUTPUT_FRAME_INTERVAL).await;
            }
        }
    }

    // -- Inbound dispatch -------------------------------------------------

    /// Handle one remote-job or remote-session frame and return the frames to
    /// write back on the same stream, in order.
    ///
    /// This is the trust boundary: EVERY such frame from a peer with no
    /// `owned_devices` row is refused here, before any row is written and before
    /// the executor is reached. Kept separate from the QUIC plumbing so the
    /// refusal is testable without a network.
    pub async fn handle_message(
        self: &Arc<Self>,
        peer_id: &str,
        msg: Message,
    ) -> Result<Vec<Message>, AppError> {
        let paired = match self.require_paired(peer_id) {
            Ok(name) => name,
            Err(e) => {
                tracing::warn!(
                    peer_id = %peer_id,
                    reason = %e,
                    frame = frame_name(&msg),
                    "Refused a remote-job message: the peer is authenticated but NOT paired"
                );
                // A request gets a refusal so the sender sees a reason instead of
                // a timeout. Every other frame from a stranger gets nothing —
                // there is no exchange to answer.
                return Ok(match msg {
                    Message::RemoteJobRequest { job_id, .. } => vec![Message::RemoteJobAck {
                        job_id,
                        accepted: false,
                        reason: Some(
                            "This device only runs work sent by its own paired devices.".into(),
                        ),
                    }],
                    _ => Vec::new(),
                });
            }
        };

        match msg {
            Message::RemoteJobRequest {
                job_id,
                kind,
                instruction,
                origin_display_name,
                payload_json,
            } => self
                .accept_request(
                    peer_id,
                    &paired,
                    RemoteJobAssignment {
                        job_id,
                        peer_id: peer_id.to_string(),
                        origin_display_name,
                        kind,
                        instruction,
                        payload_json,
                    },
                )
                .await
                .map(|ack| vec![ack]),

            // Normally read inline by the sender on its own stream; also
            // honored here so an ack that arrives on a fresh stream still lands.
            Message::RemoteJobAck {
                job_id,
                accepted,
                reason,
            } => {
                self.apply_ack(peer_id, &job_id, accepted, reason).await?;
                Ok(Vec::new())
            }

            Message::RemoteJobProgress { job_id, seq, text } => {
                self.apply_progress(peer_id, &job_id, seq, text).await?;
                Ok(Vec::new())
            }

            Message::RemoteJobResult {
                job_id,
                status,
                summary,
                receipt_json,
            } => {
                self.apply_result(peer_id, &job_id, &status, summary, receipt_json)
                    .await?;
                Ok(Vec::new())
            }

            Message::RemoteJobResume { job_id, last_seq } => {
                self.replay_for_peer(peer_id, &job_id, last_seq)
            }

            Message::RemoteSessionMirror { job_id, view_json } => {
                self.apply_mirror(peer_id, &job_id, view_json).await;
                Ok(Vec::new())
            }

            Message::RemoteSessionOutput {
                job_id,
                seq,
                chunk_b64,
            } => {
                self.apply_output(peer_id, &job_id, seq, chunk_b64).await;
                Ok(Vec::new())
            }

            Message::RemoteSessionOutputSubscribe { job_id, subscribe } => {
                self.apply_subscribe(peer_id, &job_id, subscribe);
                Ok(Vec::new())
            }

            Message::RemoteJobCommand {
                job_id,
                command,
                text,
            } => Ok(vec![
                self.apply_command(peer_id, job_id, command, text).await,
            ]),

            Message::RemoteJobCommandAck { job_id, .. } => {
                // Always read inline by `send_command`. One arriving on a fresh
                // stream answers nothing this device is waiting for.
                tracing::debug!(peer_id = %peer_id, job_id = %job_id, "Unsolicited RemoteJobCommandAck dropped");
                Ok(Vec::new())
            }

            other => Err(AppError::Internal(format!(
                "handle_message called with a non-remote-job frame: {other:?}"
            ))),
        }
    }

    /// Accept (or decline on the merits) an incoming request from a paired peer.
    async fn accept_request(
        self: &Arc<Self>,
        peer_id: &str,
        paired_name: &str,
        mut job: RemoteJobAssignment,
    ) -> Result<Message, AppError> {
        let job_id = job.job_id.clone();
        let refuse = |reason: &str| Message::RemoteJobAck {
            job_id: job_id.clone(),
            accepted: false,
            reason: Some(reason.to_string()),
        };

        if job.job_id.trim().is_empty() {
            return Ok(refuse("The request carried no job id."));
        }
        match job.kind.as_str() {
            REMOTE_JOB_KIND_INSTRUCTION => {}
            REMOTE_JOB_KIND_FLEET_SESSION => {
                let readable = job
                    .payload_json
                    .as_deref()
                    .filter(|p| p.len() <= MAX_PAYLOAD_BYTES)
                    .map(|p| serde_json::from_str::<FleetSessionJobPayload>(p).is_ok())
                    .unwrap_or(false);
                if !readable {
                    return Ok(refuse(
                        "The request carried no readable session description.",
                    ));
                }
            }
            _ => {
                return Ok(refuse(
                    "This device does not understand that kind of request.",
                ))
            }
        }
        if job.instruction.trim().is_empty() {
            return Ok(refuse("The request carried no instruction."));
        }
        if job.instruction.len() > MAX_INSTRUCTION_BYTES {
            return Ok(refuse("That instruction is too long."));
        }
        job.instruction = job.instruction.trim().to_string();

        // Prefer the name the pairing registry holds over the one on the wire:
        // the registry name was confirmed by a human, the wire one is a claim.
        if !paired_name.trim().is_empty() {
            job.origin_display_name = paired_name.to_string();
        }

        // A repeat of a job we already accepted (a retried send, a drained
        // outbox after a lost ack) is re-acked and never re-run or re-admitted.
        if repo::get(&self.pool, &job.job_id)?.is_some() {
            tracing::debug!(peer_id = %peer_id, job_id = %job_id, "Re-acking a remote job we already accepted");
            return Ok(Message::RemoteJobAck {
                job_id,
                accepted: true,
                reason: None,
            });
        }

        let executor = self.executor.read().await.clone();
        if let Admission::Refuse(reason) = executor.admit(&job).await {
            tracing::info!(peer_id = %peer_id, job_id = %job_id, reason = %reason, "Remote job declined by the executor");
            return Ok(refuse(&reason));
        }

        let (row, is_new) = repo::create_inbound_with_payload(
            &self.pool,
            &job.job_id,
            peer_id,
            &job.origin_display_name,
            &job.kind,
            &job.instruction,
            job.payload_json.as_deref(),
        )?;

        if is_new {
            self.emit(&row).await;
            let handle = RemoteJobHandle {
                jobs: self.clone(),
                job_id: job_id.clone(),
                peer_id: peer_id.to_string(),
                rt: tokio::runtime::Handle::current(),
            };
            // Spawned so a slow executor cannot stall the ack, and so the
            // inbound dispatch task stays free to accept the next stream. The
            // executor owns the job's outcome (it must reach a terminal state
            // through the handle), so nothing waits on this task.
            tokio::spawn(async move {
                executor.execute(job, handle).await;
            });
            tracing::info!(peer_id = %peer_id, job_id = %job_id, "Accepted a remote job from a paired device");
        }

        Ok(Message::RemoteJobAck {
            job_id,
            accepted: true,
            reason: None,
        })
    }

    async fn apply_ack(
        self: &Arc<Self>,
        peer_id: &str,
        job_id: &str,
        accepted: bool,
        reason: Option<String>,
    ) -> Result<(), AppError> {
        let job = self.expect_job(peer_id, job_id, RemoteJobDirection::Outbound)?;
        if !matches!(
            job.status,
            RemoteJobStatus::Pending | RemoteJobStatus::Queued
        ) {
            return Ok(());
        }
        self.settle_ack(job_id, accepted, reason)?;
        let job = self.reload(job_id)?;
        self.emit(&job).await;
        Ok(())
    }

    async fn apply_progress(
        self: &Arc<Self>,
        peer_id: &str,
        job_id: &str,
        seq: u32,
        text: String,
    ) -> Result<(), AppError> {
        let job = self.expect_job(peer_id, job_id, RemoteJobDirection::Outbound)?;
        if seq == 0 {
            return Err(AppError::Validation(
                "progress sequence numbers start at 1".into(),
            ));
        }
        // The peer may start reporting before its ack was processed (or after a
        // lost ack sent the job back to the outbox); treat the first note as
        // the acceptance so a job never gets stuck before `running`.
        if matches!(
            job.status,
            RemoteJobStatus::Pending | RemoteJobStatus::Queued
        ) {
            repo::mark_running(&self.pool, job_id)?;
        }
        // `apply_note` is the exactly-once boundary: `false` means this note has
        // already landed (a reconnect replayed it) and must produce no event.
        if repo::apply_note(&self.pool, job_id, seq, &truncate(text, MAX_NOTE_BYTES))? {
            let job = self.reload(job_id)?;
            self.emit(&job).await;
        }
        Ok(())
    }

    async fn apply_result(
        self: &Arc<Self>,
        peer_id: &str,
        job_id: &str,
        status: &str,
        summary: String,
        receipt_json: Option<String>,
    ) -> Result<(), AppError> {
        let job = self.expect_job(peer_id, job_id, RemoteJobDirection::Outbound)?;
        let status = RemoteJobStatus::parse(status)
            .filter(|s| s.is_terminal())
            .unwrap_or(RemoteJobStatus::Failed);
        // The receipt is taken with the FIRST verdict only. A replayed result
        // must not overwrite it: by then this device's harvest may have written
        // `verified` into it.
        if !job.status.is_terminal() {
            if let Some(receipt) = receipt_json.as_deref() {
                match serde_json::from_str::<FleetSessionJobReceipt>(receipt) {
                    Ok(_) if receipt.len() <= MAX_PAYLOAD_BYTES => {
                        repo::set_receipt(&self.pool, job_id, receipt)?;
                    }
                    _ => {
                        tracing::warn!(peer_id = %peer_id, job_id = %job_id, "Unreadable receipt on a remote result; ignored")
                    }
                }
            }
        }
        if repo::finish(
            &self.pool,
            job_id,
            status,
            &truncate(summary, MAX_NOTE_BYTES),
        )? {
            self.wanted_tails
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(job_id);
            let job = self.reload(job_id)?;
            self.emit(&job).await;
        }
        Ok(())
    }

    /// Originating side: a running device's view of a session it runs for us.
    /// Persisted latest-wins and emitted as `REMOTE_SESSION_UPDATED`. Unknown
    /// or foreign job ids are dropped: a mirror is never worth an error.
    async fn apply_mirror(&self, peer_id: &str, job_id: &str, view_json: String) {
        if view_json.len() > remote_sessions::MAX_MIRROR_BYTES {
            tracing::warn!(peer_id = %peer_id, job_id = %job_id, "Oversized mirror dropped");
            return;
        }
        let Some(job) =
            self.live_frame_job(peer_id, job_id, RemoteJobDirection::Outbound, "mirror")
        else {
            return;
        };
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) = repo::set_mirror(&self.pool, job_id, &view_json, &now) {
            tracing::warn!(job_id = %job_id, "Could not store a remote session mirror: {e}");
            return;
        }
        self.emit_session_view(&job).await;
    }

    /// Originating side: one chunk of a watched session's output. Emitted as
    /// `REMOTE_SESSION_OUTPUT` and never persisted.
    async fn apply_output(&self, peer_id: &str, job_id: &str, seq: u32, chunk_b64: String) {
        if chunk_b64.len() > MAX_OUTPUT_CHUNK_B64 {
            tracing::warn!(peer_id = %peer_id, job_id = %job_id, "Oversized output chunk dropped");
            return;
        }
        if self
            .live_frame_job(peer_id, job_id, RemoteJobDirection::Outbound, "output")
            .is_none()
        {
            return;
        }
        self.publish(
            event_name::REMOTE_SESSION_OUTPUT,
            &RemoteSessionOutputChunk {
                job_id: job_id.to_string(),
                seq,
                chunk_b64,
            },
        )
        .await;
    }

    /// Running side: the originator started or stopped watching a session.
    fn apply_subscribe(&self, peer_id: &str, job_id: &str, subscribe: bool) {
        let Some(job) =
            self.live_frame_job(peer_id, job_id, RemoteJobDirection::Inbound, "subscribe")
        else {
            return;
        };
        if job.status.is_terminal() {
            return;
        }
        self.lanes.set_subscribed(job_id, peer_id, subscribe);
        tracing::debug!(peer_id = %peer_id, job_id = %job_id, subscribe, "Remote output subscription changed");
    }

    /// Running side: carry out a steering command and answer it.
    async fn apply_command(
        &self,
        peer_id: &str,
        job_id: String,
        command: String,
        text: Option<String>,
    ) -> Message {
        let ack = |accepted: bool, reason: Option<String>| Message::RemoteJobCommandAck {
            job_id: job_id.clone(),
            command: command.clone(),
            accepted,
            reason,
        };
        // A command is answered even for an unknown job: the sender is waiting
        // on this stream, and a refusal beats a 15 s timeout. Nothing is
        // written either way.
        let Some(job) =
            self.live_frame_job(peer_id, &job_id, RemoteJobDirection::Inbound, "command")
        else {
            return ack(false, Some("This device has no such session.".into()));
        };
        if job.status.is_terminal() {
            return ack(false, Some("That session has already finished.".into()));
        }
        let Some(parsed) = parse_command(&command) else {
            return ack(false, Some(format!("Unknown command '{command}'.")));
        };
        if text
            .as_ref()
            .is_some_and(|t| t.len() > MAX_COMMAND_TEXT_BYTES)
        {
            return ack(false, Some("That input is too long.".into()));
        }
        let executor = self.executor.read().await.clone();
        match tokio::time::timeout(COMMAND_TIMEOUT, executor.command(&job_id, parsed, text)).await {
            Ok(Ok(())) => ack(true, None),
            Ok(Err(e)) => ack(false, Some(e.to_string())),
            Err(_) => ack(false, Some("The session did not respond in time.".into())),
        }
    }

    /// Answer a peer's resume: the notes above what it holds, then the result if
    /// the job has since finished.
    fn replay_for_peer(
        &self,
        peer_id: &str,
        job_id: &str,
        last_seq: u32,
    ) -> Result<Vec<Message>, AppError> {
        let job = self.expect_job(peer_id, job_id, RemoteJobDirection::Inbound)?;
        let mut frames: Vec<Message> = repo::list_notes_after(&self.pool, job_id, last_seq)?
            .into_iter()
            .map(|note| Message::RemoteJobProgress {
                job_id: job_id.to_string(),
                seq: note.seq,
                text: note.text,
            })
            .collect();
        if job.status.is_terminal() {
            frames.push(Message::RemoteJobResult {
                job_id: job_id.to_string(),
                status: job.status.as_str().to_string(),
                receipt_json: receipt_of(&job),
                summary: job.summary.unwrap_or_default(),
            });
        }
        tracing::debug!(
            peer_id = %peer_id,
            job_id = %job_id,
            from_seq = last_seq,
            frames = frames.len(),
            "Replaying remote-job backlog after reconnect"
        );
        Ok(frames)
    }

    // -- Plumbing ---------------------------------------------------------

    /// Load a job and check it is the one this peer is allowed to talk about.
    ///
    /// A paired device may still only touch ITS OWN jobs — pairing is not a
    /// licence to rewrite another device's history — so the peer id and the
    /// direction are both checked.
    fn expect_job(
        &self,
        peer_id: &str,
        job_id: &str,
        direction: RemoteJobDirection,
    ) -> Result<RemoteJob, AppError> {
        let job = self.reload(job_id)?;
        if job.peer_id != peer_id || job.direction != direction {
            return Err(AppError::Forbidden(format!(
                "Peer {peer_id} referenced remote job {job_id}, which is not its own"
            )));
        }
        Ok(job)
    }

    /// [`Self::expect_job`] for the live frames (mirror, output, subscribe,
    /// command): an unknown job id is dropped with a debug log, a foreign one
    /// with a warning, and neither is an error — a live frame is never worth
    /// failing a stream over, and nothing is written for either.
    fn live_frame_job(
        &self,
        peer_id: &str,
        job_id: &str,
        direction: RemoteJobDirection,
        frame: &str,
    ) -> Option<RemoteJob> {
        match self.expect_job(peer_id, job_id, direction) {
            Ok(job) => Some(job),
            Err(AppError::NotFound(_)) => {
                tracing::debug!(peer_id = %peer_id, job_id = %job_id, frame, "Live frame for an unknown remote job dropped");
                None
            }
            Err(e) => {
                tracing::warn!(peer_id = %peer_id, job_id = %job_id, frame, "Live frame refused: {e}");
                None
            }
        }
    }

    fn reload(&self, job_id: &str) -> Result<RemoteJob, AppError> {
        repo::get(&self.pool, job_id)?
            .ok_or_else(|| AppError::NotFound(format!("No remote job with id {job_id}")))
    }

    /// One request/response round trip on a fresh stream.
    async fn exchange(
        &self,
        peer_id: &str,
        msg: Message,
        timeout: std::time::Duration,
    ) -> Result<Message, AppError> {
        let (mut send, mut recv) = self.connections.open_stream(peer_id).await?;
        protocol::write_message(&mut send, &msg).await?;
        tokio::time::timeout(timeout, protocol::decode(&mut recv))
            .await
            .map_err(|_| {
                AppError::NetworkOffline(
                    "The other device stopped responding before it answered.".into(),
                )
            })?
    }

    /// Best-effort one-way delivery. A failure here is expected whenever the
    /// peer is offline and is NOT propagated: durable frames are already
    /// persisted and the resume exchange will deliver them; live frames are
    /// lossy by contract.
    async fn deliver(&self, peer_id: &str, msg: Message) {
        let sent = async {
            let (mut send, _recv) = self.connections.open_stream(peer_id).await?;
            protocol::write_message(&mut send, &msg).await
        }
        .await;
        if let Err(e) = sent {
            tracing::debug!(
                peer_id = %peer_id,
                "Remote-job frame not delivered now: {e}"
            );
        }
    }

    /// Emit `REMOTE_JOB_UPDATED` for a job, and — for an outbound
    /// `fleet_session` job — `REMOTE_SESSION_UPDATED` with its rebuilt view, so
    /// a status change (queued → running → completed) moves the tile too.
    async fn emit(&self, job: &RemoteJob) {
        self.publish(event_name::REMOTE_JOB_UPDATED, job).await;
        if job.direction == RemoteJobDirection::Outbound
            && job.kind == REMOTE_JOB_KIND_FLEET_SESSION
        {
            self.emit_session_view(job).await;
        }
    }

    async fn emit_session_view(&self, job: &RemoteJob) {
        let mirror = match repo::get_mirror(&self.pool, &job.id) {
            Ok(mirror) => mirror,
            Err(e) => {
                tracing::warn!(job_id = %job.id, "Could not read a remote session mirror: {e}");
                None
            }
        };
        if let Some(view) =
            remote_sessions::build_view(job, mirror.as_ref(), remote_sessions::now_ms())
        {
            self.publish(event_name::REMOTE_SESSION_UPDATED, &view)
                .await;
        }
    }

    async fn publish<P: Serialize + Clone>(&self, event: &'static str, payload: &P) {
        #[cfg(test)]
        if let Ok(value) = serde_json::to_value(payload) {
            self.emitted
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((event, value));
        }
        let guard = self.app_handle.read().await;
        if let Some(app) = guard.as_ref() {
            emit_event(app, event, payload);
        }
    }
}

/// Check a job before anything is written. Returns the trimmed instruction.
fn validate_job(
    kind: &str,
    instruction: &str,
    payload_json: Option<&str>,
) -> Result<String, AppError> {
    match kind {
        REMOTE_JOB_KIND_INSTRUCTION => {
            if payload_json.is_some() {
                return Err(AppError::Validation(
                    "An instruction job carries no payload; the text is the request.".into(),
                ));
            }
        }
        REMOTE_JOB_KIND_FLEET_SESSION => {
            let payload = payload_json.ok_or_else(|| {
                AppError::Validation("A fleet session job needs its session description.".into())
            })?;
            if payload.len() > MAX_PAYLOAD_BYTES {
                return Err(AppError::Validation(format!(
                    "That session description is too long to send ({} bytes, limit {MAX_PAYLOAD_BYTES}).",
                    payload.len()
                )));
            }
            serde_json::from_str::<FleetSessionJobPayload>(payload).map_err(|e| {
                AppError::Validation(format!("The session description is not readable: {e}"))
            })?;
        }
        other => {
            return Err(AppError::Validation(format!(
                "Unknown remote job kind '{other}'"
            )))
        }
    }
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err(AppError::Validation(
            "There is no instruction to send.".into(),
        ));
    }
    if instruction.len() > MAX_INSTRUCTION_BYTES {
        return Err(AppError::Validation(format!(
            "That instruction is too long to send ({} bytes, limit {MAX_INSTRUCTION_BYTES}).",
            instruction.len()
        )));
    }
    Ok(instruction.to_string())
}

/// The typed "that device is not reachable" error, naming it and the remedy.
fn offline(display_name: &str) -> AppError {
    AppError::NetworkOffline(format!(
        "\"{display_name}\" is not reachable right now. \
         Open Personas on that device and make sure both are on the same network."
    ))
}

/// A stored receipt, re-serialized for the wire.
fn receipt_of(job: &RemoteJob) -> Option<String> {
    job.receipt
        .as_ref()
        .and_then(|r| serde_json::to_string(r).ok())
}

/// The snake_case wire token of a steering command.
fn command_token(command: RemoteSessionCommand) -> String {
    match serde_json::to_value(command) {
        Ok(serde_json::Value::String(s)) => s,
        // INVARIANT: a unit enum with `rename_all = "snake_case"` always
        // serializes to a string; this arm exists only to avoid an unwrap.
        _ => format!("{command:?}"),
    }
}

fn parse_command(token: &str) -> Option<RemoteSessionCommand> {
    serde_json::from_value(serde_json::Value::String(token.to_string())).ok()
}

/// A frame's variant name, for the refusal log (never its contents).
fn frame_name(msg: &Message) -> &'static str {
    match msg {
        Message::RemoteJobRequest { .. } => "RemoteJobRequest",
        Message::RemoteJobAck { .. } => "RemoteJobAck",
        Message::RemoteJobProgress { .. } => "RemoteJobProgress",
        Message::RemoteJobResult { .. } => "RemoteJobResult",
        Message::RemoteJobResume { .. } => "RemoteJobResume",
        Message::RemoteSessionMirror { .. } => "RemoteSessionMirror",
        Message::RemoteSessionOutputSubscribe { .. } => "RemoteSessionOutputSubscribe",
        Message::RemoteSessionOutput { .. } => "RemoteSessionOutput",
        Message::RemoteJobCommand { .. } => "RemoteJobCommand",
        Message::RemoteJobCommandAck { .. } => "RemoteJobCommandAck",
        _ => "other",
    }
}

/// Clamp a string to `max` bytes on a char boundary.
fn truncate(mut s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s.truncate(end);
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:remote_jobs_wire_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            personas_db::migrations::run(&conn).expect("initial migrations");
            personas_db::migrations::run_incremental(&conn).expect("incremental migrations");
            conn.execute(
                "INSERT INTO local_identity (id, peer_id, public_key, display_name)
                 VALUES (1, 'local-peer', X'00', 'This Device')",
                [],
            )
            .expect("seed local_identity");
        }
        pool
    }

    /// A `RemoteJobs` with no transport. Every test here exercises the trust
    /// gate and the state machine, which is deliberately all reachable without
    /// QUIC — the delivery attempts simply fail and are swallowed, exactly as
    /// they would against an offline peer.
    fn service(pool: DbPool) -> Arc<RemoteJobs> {
        let transport = Arc::new(
            crate::p2p::transport::QuicTransport::new("local-peer".into()).expect("transport"),
        );
        let connections = Arc::new(ConnectionManager::new(
            transport,
            pool.clone(),
            "local-peer".into(),
            "This Device".into(),
            8,
        ));
        Arc::new(RemoteJobs::new(
            pool,
            connections,
            Arc::new(RwLock::new(None)),
        ))
    }

    fn pair(pool: &DbPool, peer_id: &str, name: &str) {
        let group = owned_devices_repo::ensure_device_group_id(pool).expect("group");
        owned_devices_repo::register_paired_device(pool, peer_id, &group, name, "pk")
            .expect("pair");
    }

    fn request(job_id: &str, instruction: &str) -> Message {
        Message::RemoteJobRequest {
            job_id: job_id.into(),
            kind: REMOTE_JOB_KIND_INSTRUCTION.into(),
            instruction: instruction.into(),
            origin_display_name: "Laptop".into(),
            payload_json: None,
        }
    }

    /// THE security test. The peer completed the signed handshake — that is what
    /// being able to send at all means — but was never paired. It must be
    /// refused with a reason, and must leave nothing behind.
    #[tokio::test]
    async fn an_authenticated_but_unpaired_peer_is_refused() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        // No `pair(...)` call: this peer is authenticated, not trusted.

        let replies = jobs
            .handle_message("stranger-peer", request("job-1", "delete everything"))
            .await
            .expect("a refusal is an answer, not an error");

        assert_eq!(replies.len(), 1);
        match &replies[0] {
            Message::RemoteJobAck {
                job_id,
                accepted,
                reason,
            } => {
                assert_eq!(job_id, "job-1");
                assert!(!accepted, "an unpaired peer must never be accepted");
                assert!(
                    reason.as_deref().unwrap_or_default().contains("paired"),
                    "the refusal must say why: {reason:?}"
                );
            }
            other => panic!("expected a refusal ack, got {other:?}"),
        }

        assert!(
            repo::get(&pool, "job-1").expect("get").is_none(),
            "a refused request must not be persisted"
        );
        assert!(repo::list(&pool, None, 50).expect("list").is_empty());
    }

    /// An unpaired peer cannot inject progress or results either — refusing only
    /// the request would still let a stranger rewrite a real job's history.
    #[tokio::test]
    async fn an_unpaired_peer_cannot_inject_progress_or_results() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "trusted-peer", "Laptop");
        repo::create_outbound(
            &pool,
            "job-1",
            "trusted-peer",
            "Laptop",
            "instruction",
            "go",
        )
        .expect("outbound");
        repo::mark_running(&pool, "job-1").expect("running");

        for frame in [
            Message::RemoteJobProgress {
                job_id: "job-1".into(),
                seq: 1,
                text: "injected".into(),
            },
            Message::RemoteJobResult {
                job_id: "job-1".into(),
                status: "completed".into(),
                summary: "injected".into(),
                receipt_json: None,
            },
            Message::RemoteJobResume {
                job_id: "job-1".into(),
                last_seq: 0,
            },
            Message::RemoteSessionMirror {
                job_id: "job-1".into(),
                view_json: r#"{"state":"running"}"#.into(),
            },
            Message::RemoteSessionOutput {
                job_id: "job-1".into(),
                seq: 1,
                chunk_b64: "aGk=".into(),
            },
            Message::RemoteSessionOutputSubscribe {
                job_id: "job-1".into(),
                subscribe: true,
            },
            Message::RemoteJobCommand {
                job_id: "job-1".into(),
                command: "kill".into(),
                text: None,
            },
        ] {
            let replies = jobs
                .handle_message("stranger-peer", frame)
                .await
                .expect("silently ignored");
            assert!(replies.is_empty(), "a stranger gets no answer at all");
        }

        let job = repo::get(&pool, "job-1").expect("get").unwrap();
        assert_eq!(job.status, RemoteJobStatus::Running, "still untouched");
        assert!(repo::list_notes(&pool, "job-1").expect("notes").is_empty());
        assert!(
            repo::get_mirror(&pool, "job-1").expect("mirror").is_none(),
            "a stranger's mirror must not be persisted"
        );
        assert!(
            jobs.emitted.lock().unwrap().is_empty(),
            "a stranger's frames must not reach the UI"
        );
    }

    /// A PAIRED peer still may not touch a job that belongs to a different peer.
    #[tokio::test]
    async fn a_paired_peer_cannot_touch_another_peers_job() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");
        pair(&pool, "peer-b", "Phone");
        repo::create_outbound(&pool, "job-1", "peer-a", "Laptop", "instruction", "go")
            .expect("outbound");

        let err = jobs
            .handle_message(
                "peer-b",
                Message::RemoteJobProgress {
                    job_id: "job-1".into(),
                    seq: 1,
                    text: "not mine".into(),
                },
            )
            .await
            .expect_err("a foreign job must be refused");
        assert!(matches!(err, AppError::Forbidden(_)), "got {err:?}");
    }

    /// The happy path of the inbound arm: accepted, persisted as running, acked.
    #[tokio::test]
    async fn a_paired_peers_request_is_accepted_and_persisted() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        let replies = jobs
            .handle_message("peer-a", request("job-1", "summarize my inbox"))
            .await
            .expect("accepted");
        match &replies[0] {
            Message::RemoteJobAck {
                accepted, reason, ..
            } => {
                assert!(accepted);
                assert!(reason.is_none());
            }
            other => panic!("expected an ack, got {other:?}"),
        }

        let job = repo::get(&pool, "job-1").expect("get").unwrap();
        assert_eq!(job.direction, RemoteJobDirection::Inbound);
        assert_eq!(job.status, RemoteJobStatus::Running);
        assert_eq!(job.instruction, "summarize my inbox");
        // The registry name wins over the one claimed on the wire.
        assert_eq!(job.peer_display_name, "Laptop");
    }

    /// An unknown `kind` is refused on the merits — the seam exists, but only
    /// one lane is wired.
    #[tokio::test]
    async fn an_unknown_job_kind_is_refused_on_the_merits() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        let replies = jobs
            .handle_message(
                "peer-a",
                Message::RemoteJobRequest {
                    job_id: "job-1".into(),
                    kind: "run-recipe".into(),
                    instruction: "x".into(),
                    origin_display_name: "Laptop".into(),
                    payload_json: None,
                },
            )
            .await
            .expect("answered");
        assert!(matches!(
            replies.as_slice(),
            [Message::RemoteJobAck {
                accepted: false,
                ..
            }]
        ));
        assert!(repo::get(&pool, "job-1").expect("get").is_none());
    }

    /// Re-delivering the same request must re-ack without starting a second run.
    #[tokio::test]
    async fn a_repeated_request_is_re_acked_not_re_run() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        for _ in 0..3 {
            let replies = jobs
                .handle_message("peer-a", request("job-1", "go"))
                .await
                .expect("accepted");
            assert!(matches!(
                replies.as_slice(),
                [Message::RemoteJobAck { accepted: true, .. }]
            ));
        }
        assert_eq!(repo::list(&pool, None, 50).expect("list").len(), 1);
    }

    /// The default executor must not leave a job hanging. It has no handler, so
    /// it fails the job immediately with a reason the other side can read.
    #[tokio::test]
    async fn the_default_executor_fails_the_job_instead_of_hanging() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        jobs.handle_message("peer-a", request("job-1", "go"))
            .await
            .expect("accepted");

        // The executor runs on a spawned task; give it a moment to land.
        for _ in 0..50 {
            let job = repo::get(&pool, "job-1").expect("get").unwrap();
            if job.status.is_terminal() {
                assert_eq!(job.status, RemoteJobStatus::Failed);
                assert!(
                    job.summary.unwrap_or_default().contains("no assistant"),
                    "the reason must reach the user"
                );
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("the default executor left the job running");
    }

    /// An installed executor receives the assignment and can report through the
    /// handle — the whole WP3 contract, exercised end to end without a network.
    #[tokio::test]
    async fn an_installed_executor_receives_the_assignment_and_reports_through_the_handle() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        struct Echo;
        #[async_trait::async_trait]
        impl RemoteJobExecutor for Echo {
            async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle) {
                assert_eq!(handle.job_id(), job.job_id);
                handle.progress("thinking").await.expect("progress 1");
                handle.progress("still thinking").await.expect("progress 2");
                handle
                    .complete(format!("did: {}", job.instruction))
                    .await
                    .expect("complete");
            }
        }
        jobs.set_executor(Arc::new(Echo)).await;

        jobs.handle_message("peer-a", request("job-1", "count to two"))
            .await
            .expect("accepted");

        for _ in 0..50 {
            let job = repo::get(&pool, "job-1").expect("get").unwrap();
            if job.status.is_terminal() {
                assert_eq!(job.status, RemoteJobStatus::Completed);
                assert_eq!(job.summary.as_deref(), Some("did: count to two"));
                let notes = repo::list_notes(&pool, "job-1").expect("notes");
                assert_eq!(
                    notes.iter().map(|n| n.seq).collect::<Vec<_>>(),
                    vec![1, 2],
                    "progress notes must be numbered 1..N in order"
                );
                assert_eq!(notes[0].text, "thinking");
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("the executor never finished the job");
    }

    /// The replay half of resume-on-reconnect, on the RUNNING side: asked for
    /// everything above seq 1, it answers with notes 2 and 3 plus the result.
    #[tokio::test]
    async fn a_resume_replays_only_what_the_peer_is_missing() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");
        repo::create_inbound(&pool, "job-1", "peer-a", "Laptop", "instruction", "go")
            .expect("inbound");
        for text in ["one", "two", "three"] {
            let seq = repo::next_seq(&pool, "job-1").expect("seq");
            repo::record_note(&pool, "job-1", seq, text).expect("note");
        }

        // Still running: notes only, no result yet.
        let frames = jobs
            .handle_message(
                "peer-a",
                Message::RemoteJobResume {
                    job_id: "job-1".into(),
                    last_seq: 1,
                },
            )
            .await
            .expect("replay");
        let seqs: Vec<u32> = frames
            .iter()
            .filter_map(|f| match f {
                Message::RemoteJobProgress { seq, .. } => Some(*seq),
                _ => None,
            })
            .collect();
        assert_eq!(seqs, vec![2, 3], "only the missing notes are replayed");
        assert!(
            !frames
                .iter()
                .any(|f| matches!(f, Message::RemoteJobResult { .. })),
            "an unfinished job must not replay a result"
        );

        // Once terminal, the result rides along at the end.
        repo::finish(&pool, "job-1", RemoteJobStatus::Completed, "done").expect("finish");
        let frames = jobs
            .handle_message(
                "peer-a",
                Message::RemoteJobResume {
                    job_id: "job-1".into(),
                    last_seq: 3,
                },
            )
            .await
            .expect("replay 2");
        assert!(matches!(
            frames.as_slice(),
            [Message::RemoteJobResult { status, summary, .. }]
                if status == "completed" && summary == "done"
        ));
    }

    /// The apply half, on the ORIGINATING side: a replayed window applies its
    /// missing notes once and is inert the second time.
    #[tokio::test]
    async fn replayed_progress_is_applied_exactly_once() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");
        repo::create_outbound(&pool, "job-1", "peer-a", "Laptop", "instruction", "go")
            .expect("outbound");
        repo::mark_running(&pool, "job-1").expect("running");

        let replay = [(1u32, "one"), (2, "two"), (3, "three")];
        for round in 0..2 {
            for (seq, text) in replay {
                jobs.handle_message(
                    "peer-a",
                    Message::RemoteJobProgress {
                        job_id: "job-1".into(),
                        seq,
                        text: text.into(),
                    },
                )
                .await
                .unwrap_or_else(|e| panic!("round {round} seq {seq}: {e}"));
            }
        }
        let notes = repo::list_notes(&pool, "job-1").expect("notes");
        assert_eq!(notes.len(), 3, "a second replay must add nothing");
        assert_eq!(repo::get(&pool, "job-1").expect("get").unwrap().last_seq, 3);

        // And a replayed result is likewise applied once, keeping the first verdict.
        for _ in 0..2 {
            jobs.handle_message(
                "peer-a",
                Message::RemoteJobResult {
                    job_id: "job-1".into(),
                    status: "completed".into(),
                    summary: "done".into(),
                    receipt_json: None,
                },
            )
            .await
            .expect("result");
        }
        let job = repo::get(&pool, "job-1").expect("get").unwrap();
        assert_eq!(job.status, RemoteJobStatus::Completed);
        assert_eq!(job.summary.as_deref(), Some("done"));
    }

    /// Progress that arrives before the ack was processed still moves the job out
    /// of `pending`, so a lost ack cannot strand it.
    #[tokio::test]
    async fn progress_before_the_ack_still_starts_the_job() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");
        repo::create_outbound(&pool, "job-1", "peer-a", "Laptop", "instruction", "go")
            .expect("outbound");

        jobs.handle_message(
            "peer-a",
            Message::RemoteJobProgress {
                job_id: "job-1".into(),
                seq: 1,
                text: "started".into(),
            },
        )
        .await
        .expect("progress");
        assert_eq!(
            repo::get(&pool, "job-1").expect("get").unwrap().status,
            RemoteJobStatus::Running
        );
    }

    /// Sending to a paired device that is not connected is not an error any
    /// more: the job waits in the outbox as `queued`, with its payload, and is
    /// drained on the next link-up.
    #[tokio::test]
    async fn sending_to_an_offline_device_queues_it_in_the_outbox() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        let job = jobs
            .send_instruction("peer-a", None, "do the thing")
            .await
            .expect("an offline paired device is queued for, not refused");
        assert_eq!(job.status, RemoteJobStatus::Queued);
        assert_eq!(job.peer_display_name, "Laptop");
        assert_eq!(
            repo::list_queued_for_peer(&pool, "peer-a")
                .expect("outbox")
                .len(),
            1
        );

        let payload = fleet_payload();
        let job = jobs
            .send_job(
                "peer-a",
                REMOTE_JOB_KIND_FLEET_SESSION,
                "fix it",
                Some(payload.clone()),
            )
            .await
            .expect("queued fleet session");
        assert_eq!(job.status, RemoteJobStatus::Queued);
        assert_eq!(job.payload_json.as_deref(), Some(payload.as_str()));
    }

    fn fleet_payload() -> String {
        serde_json::to_string(&FleetSessionJobPayload {
            project_id: "p1".into(),
            github_url: "https://github.com/o/r".into(),
            project_name: "Repo".into(),
            prompt: "fix it".into(),
            mode: personas_db::models::RemoteSessionMode::Headless,
            branch: "remote/aaaa/bbbb".into(),
            persona_id: None,
        })
        .unwrap()
    }

    /// A fleet session without a readable description, or an instruction that
    /// carries one, is refused before anything is written.
    #[tokio::test]
    async fn a_malformed_job_is_refused_before_anything_is_written() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");
        for (kind, payload) in [
            (REMOTE_JOB_KIND_FLEET_SESSION, None),
            (REMOTE_JOB_KIND_FLEET_SESSION, Some("{not json".to_string())),
            (REMOTE_JOB_KIND_INSTRUCTION, Some(fleet_payload())),
        ] {
            assert!(matches!(
                jobs.send_job("peer-a", kind, "go", payload).await,
                Err(AppError::Validation(_))
            ));
        }
        assert!(repo::list(&pool, None, 50).expect("list").is_empty());
    }

    /// The executor's `admit` is the one place a request is declined on its
    /// merits (e.g. `project_not_found`): refused with that reason, nothing
    /// persisted, `execute` never reached.
    #[tokio::test]
    async fn an_executor_can_decline_a_request_before_anything_is_persisted() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        struct NoSuchProject;
        #[async_trait::async_trait]
        impl RemoteJobExecutor for NoSuchProject {
            async fn admit(&self, job: &RemoteJobAssignment) -> Admission {
                assert!(job.payload_json.is_some(), "admit sees the payload");
                Admission::Refuse("project_not_found".into())
            }
            async fn execute(&self, _job: RemoteJobAssignment, _handle: RemoteJobHandle) {
                panic!("a declined job must never execute");
            }
        }
        jobs.set_executor(Arc::new(NoSuchProject)).await;

        let replies = jobs
            .handle_message(
                "peer-a",
                Message::RemoteJobRequest {
                    job_id: "job-1".into(),
                    kind: REMOTE_JOB_KIND_FLEET_SESSION.into(),
                    instruction: "fix it".into(),
                    origin_display_name: "Laptop".into(),
                    payload_json: Some(fleet_payload()),
                },
            )
            .await
            .expect("answered");
        assert!(matches!(
            replies.as_slice(),
            [Message::RemoteJobAck { accepted: false, reason: Some(r), .. }] if r == "project_not_found"
        ));
        assert!(repo::get(&pool, "job-1").expect("get").is_none());
    }

    /// Live frames for a job id this device does not know are dropped quietly
    /// (a command gets a refusal so its sender is not left waiting), and
    /// nothing is written.
    #[tokio::test]
    async fn live_frames_for_an_unknown_job_are_dropped() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");
        for frame in [
            Message::RemoteSessionMirror {
                job_id: "ghost".into(),
                view_json: "{}".into(),
            },
            Message::RemoteSessionOutput {
                job_id: "ghost".into(),
                seq: 1,
                chunk_b64: "aGk=".into(),
            },
            Message::RemoteSessionOutputSubscribe {
                job_id: "ghost".into(),
                subscribe: true,
            },
        ] {
            assert!(jobs
                .handle_message("peer-a", frame)
                .await
                .expect("dropped")
                .is_empty());
        }
        let replies = jobs
            .handle_message(
                "peer-a",
                Message::RemoteJobCommand {
                    job_id: "ghost".into(),
                    command: "kill".into(),
                    text: None,
                },
            )
            .await
            .expect("answered");
        assert!(matches!(
            replies.as_slice(),
            [Message::RemoteJobCommandAck {
                accepted: false,
                ..
            }]
        ));
        assert!(repo::list(&pool, None, 50).expect("list").is_empty());
        assert!(jobs.emitted.lock().unwrap().is_empty());
    }

    /// Sending to a device that was never paired is refused before anything else
    /// is checked, with its own typed error.
    #[tokio::test]
    async fn sending_to_an_unpaired_device_is_forbidden() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        let err = jobs
            .send_instruction("stranger", None, "do the thing")
            .await
            .expect_err("unpaired");
        assert!(matches!(err, AppError::Forbidden(_)), "got {err:?}");
        assert!(err.to_string().contains("Settings"), "state the remedy");
    }

    #[tokio::test]
    async fn an_empty_or_unknown_send_is_refused_before_the_network() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");
        assert!(matches!(
            jobs.send_instruction("peer-a", None, "   ").await,
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            jobs.send_instruction("peer-a", Some("run-recipe".into()), "x")
                .await,
            Err(AppError::Validation(_))
        ));
        assert!(repo::list(&pool, None, 50).expect("list").is_empty());
    }

    #[test]
    fn command_tokens_round_trip_the_closed_grammar() {
        for command in [
            RemoteSessionCommand::SendInput,
            RemoteSessionCommand::Kill,
            RemoteSessionCommand::Wake,
        ] {
            assert_eq!(parse_command(&command_token(command)), Some(command));
        }
        assert_eq!(command_token(RemoteSessionCommand::SendInput), "send_input");
        assert_eq!(parse_command("rm -rf"), None);
    }

    #[test]
    fn truncate_never_splits_a_character() {
        // 'é' is two bytes; a cut at byte 3 must fall back to byte 2.
        assert_eq!(truncate("aéb".to_string(), 3), "aé");
        assert_eq!(truncate("abc".to_string(), 10), "abc");
    }
}
