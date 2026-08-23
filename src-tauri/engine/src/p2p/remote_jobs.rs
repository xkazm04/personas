//! Cross-device instruction dispatch — the wire and the state machine.
//!
//! Device A's Athena sends a natural-language instruction to device B; B runs it
//! and streams back an acknowledgement, progress notes and a final summary. This
//! module owns the wire half and the persistence half. It does NOT run anything:
//! the execution seam is [`RemoteJobExecutor`], and the companion layer supplies
//! the implementation.
//!
//! ```text
//!  A (originator)                              B (runner, a PAIRED device)
//!  send_instruction(peer_id, instruction)
//!    persist remote_jobs[outbound, pending]
//!    ── RemoteJobRequest{job_id, kind, instruction, name} ──▶
//!                                        ┌─ IS THE SENDER PAIRED? ──────────┐
//!                                        │ no  → log + RemoteJobAck{false}  │
//!                                        │ yes → persist [inbound, running] │
//!                                        └──────────────────────────────────┘
//!    ◀── RemoteJobAck{accepted, reason} ──   executor.execute(job, handle)
//!    mark running / refused
//!    ◀── RemoteJobProgress{job_id, seq, text} ──   handle.progress(...)   (×N)
//!    ◀── RemoteJobResult{job_id, status, summary} ── handle.complete(...)
//! ```
//!
//! ## Trust — the security core, and why an authenticated peer is not a trusted one
//!
//! The p2p connect path deliberately does not restrict who may connect: any LAN
//! peer can complete the v2 signed handshake and pull the public exposure
//! manifest, and that is intended. The handshake proves a peer *is who it says*
//! — it says nothing about whether you want it running instructions on your
//! machine. So the job path adds its own gate, and this module is the ONLY place
//! it lives: [`RemoteJobs::handle_message`] refuses every remote-job frame whose
//! sender has no row in `owned_devices`, logs the refusal with the peer id, and
//! answers a request with `RemoteJobAck { accepted: false }` so the other side
//! gets a reason rather than a timeout. Nothing is persisted for an unpaired
//! peer, and the executor is never reached.
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
//! property of the schema, not of anyone remembering to deduplicate.

use std::sync::Arc;

use tokio::sync::RwLock;

use personas_core::error::AppError;
use personas_db::models::{
    RemoteJob, RemoteJobDirection, RemoteJobStatus, REMOTE_JOB_KIND_INSTRUCTION,
};
use personas_db::repos::resources::owned_devices as owned_devices_repo;
use personas_db::repos::resources::remote_jobs as repo;
use personas_db::DbPool;

use super::connection::ConnectionManager;
use super::protocol::{self, Message};
use crate::event_registry::{emit_event, event_name};

/// How long to wait for the peer's ack before giving up on a send.
const ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// How long a resume exchange may take to replay one job's backlog.
const RESUME_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Hard cap on instruction length, well under the 16 MB protocol frame limit.
const MAX_INSTRUCTION_BYTES: usize = 32 * 1024;
/// Hard cap on a single progress note.
const MAX_NOTE_BYTES: usize = 16 * 1024;

// -- The seam -----------------------------------------------------------
//
// Everything above this line is the wire and the database. Everything a
// companion/Athena implementation needs is below, and it is deliberately three
// items: what you are asked to do, how you report back, and the trait that
// connects them.

/// What a paired device asked this device to do.
///
/// Handed to [`RemoteJobExecutor::execute`] only after the request cleared the
/// pairing gate and the `remote_jobs` row exists as `Running`.
#[derive(Debug, Clone)]
pub struct RemoteJobAssignment {
    /// The job id both devices key this exchange by.
    pub job_id: String,
    /// The peer that asked. Guaranteed to be a paired device at accept time.
    pub peer_id: String,
    /// The peer's display name, for "Laptop asked you to…" phrasing.
    pub origin_display_name: String,
    /// Job discriminator; only [`REMOTE_JOB_KIND_INSTRUCTION`] is dispatched today.
    pub kind: String,
    /// The natural-language instruction, verbatim.
    pub instruction: String,
}

/// The reporting side of the seam, handed to the executor alongside the
/// assignment. Every method persists first and sends second, so a dropped link
/// costs delivery latency and never the record.
#[derive(Clone)]
pub struct RemoteJobHandle {
    jobs: Arc<RemoteJobs>,
    job_id: String,
}

impl RemoteJobHandle {
    pub fn job_id(&self) -> &str {
        &self.job_id
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
            .report_result(&self.job_id, RemoteJobStatus::Completed, summary.into())
            .await
    }

    /// Finish the job unsuccessfully; `summary` is why.
    pub async fn fail(&self, summary: impl Into<String>) -> Result<(), AppError> {
        self.jobs
            .report_result(&self.job_id, RemoteJobStatus::Failed, summary.into())
            .await
    }
}

/// THE CONTRACT between the wire (this module) and whatever actually runs a
/// remote instruction.
///
/// The implementation lives in the companion layer and is installed at startup
/// via [`RemoteJobs::set_executor`]; until then [`UnhandledRemoteJobs`] is in
/// place and every accepted job fails immediately with a clear reason rather
/// than hanging.
///
/// Contract for implementors:
/// - `execute` is called on the inbound dispatch task, so it MUST return
///   promptly. Spawn the real work; do not await a long run inline.
/// - By the time it is called, the peer is paired, the row is persisted as
///   `Running`, and the ack is already on its way back. Refusing is not an
///   option here; report a failure through `handle.fail(...)` instead.
/// - Every job must reach a terminal state through `handle.complete` or
///   `handle.fail`, including on the error paths — a job that is never finished
///   stays `Running` forever on both devices.
#[async_trait::async_trait]
pub trait RemoteJobExecutor: Send + Sync {
    async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle);
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
        }
    }

    /// Install the executor that actually runs accepted jobs. Called once at
    /// startup by the companion layer; replaces [`UnhandledRemoteJobs`].
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
    /// instructions here or to report progress on ours.
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

    /// Send an instruction to a paired device and wait for its ack.
    ///
    /// Fails fast and typed when the peer is not paired ([`AppError::Forbidden`])
    /// or not currently connected ([`AppError::NetworkOffline`], naming the
    /// device and what to do). Neither case leaves a row behind.
    pub async fn send_instruction(
        self: &Arc<Self>,
        peer_id: &str,
        kind: Option<String>,
        instruction: &str,
    ) -> Result<RemoteJob, AppError> {
        let display_name = self.require_paired(peer_id)?;
        let kind = kind.unwrap_or_else(|| REMOTE_JOB_KIND_INSTRUCTION.to_string());
        if kind != REMOTE_JOB_KIND_INSTRUCTION {
            return Err(AppError::Validation(format!(
                "Unknown remote job kind '{kind}'"
            )));
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

        // Offline is checked BEFORE any row is written, so a send to a sleeping
        // laptop leaves no phantom "pending" job in the history. `NetworkOffline`
        // is typed and carries the remedy; a generic bail here would surface as
        // an opaque toast, which is exactly what this path must not do.
        self.require_connected(peer_id, &display_name).await?;

        let job_id = uuid::Uuid::new_v4().to_string();
        let job = repo::create_outbound(
            &self.pool,
            &job_id,
            peer_id,
            &display_name,
            &kind,
            instruction,
        )?;
        self.emit(&job).await;

        let local_name = crate::identity::get_or_create_identity(&self.pool)
            .map(|i| i.display_name)
            .unwrap_or_else(|_| "A paired device".to_string());

        let ack = self
            .exchange(
                peer_id,
                Message::RemoteJobRequest {
                    job_id: job_id.clone(),
                    kind,
                    instruction: instruction.to_string(),
                    origin_display_name: local_name,
                },
                ACK_TIMEOUT,
            )
            .await;

        match ack {
            Ok(Message::RemoteJobAck { accepted: true, .. }) => {
                repo::mark_running(&self.pool, &job_id)?;
            }
            Ok(Message::RemoteJobAck {
                accepted: false,
                reason,
                ..
            }) => {
                let reason = reason.unwrap_or_else(|| "The other device declined.".into());
                tracing::info!(peer_id = %peer_id, job_id = %job_id, reason = %reason, "Remote job refused by peer");
                repo::mark_refused(&self.pool, &job_id, &reason)?;
            }
            Ok(other) => {
                repo::mark_cancelled(
                    &self.pool,
                    &job_id,
                    "The other device sent an unexpected reply.",
                )?;
                tracing::warn!(peer_id = %peer_id, msg = ?other, "Unexpected reply to RemoteJobRequest");
            }
            Err(e) => {
                // The link died between the connectivity check and the write.
                // Cancel rather than leave it pending: nothing on the other side
                // is running, because it never got the request.
                repo::mark_cancelled(
                    &self.pool,
                    &job_id,
                    &format!("Could not reach the device: {e}"),
                )?;
                let job = self.reload(&job_id)?;
                self.emit(&job).await;
                return Err(e);
            }
        }

        let job = self.reload(&job_id)?;
        self.emit(&job).await;
        Ok(job)
    }

    /// Refuse early, typed, when the device is not reachable.
    async fn require_connected(&self, peer_id: &str, display_name: &str) -> Result<(), AppError> {
        if self.connections.get_quinn_conn(peer_id).await.is_some() {
            return Ok(());
        }
        Err(AppError::NetworkOffline(format!(
            "\"{display_name}\" is not reachable right now. \
             Open Personas on that device and make sure both are on the same network."
        )))
    }

    /// Replay anything this device missed for one peer, in both directions.
    ///
    /// Called on every (re)connect. Outbound jobs ask the peer for the notes
    /// above what we hold; inbound jobs need nothing from us, because the peer
    /// will ask us in the same way.
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
                } => {
                    self.apply_result(peer_id, &job_id, &status, summary)
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

    /// Persist and deliver the terminal result.
    async fn report_result(
        self: &Arc<Self>,
        job_id: &str,
        status: RemoteJobStatus,
        summary: String,
    ) -> Result<(), AppError> {
        let summary = truncate(summary, MAX_NOTE_BYTES);
        let changed = repo::finish(&self.pool, job_id, status, &summary)?;
        let job = self.reload(job_id)?;
        if !changed {
            return Ok(());
        }
        self.emit(&job).await;
        self.deliver(
            &job.peer_id,
            Message::RemoteJobResult {
                job_id: job_id.to_string(),
                status: status.as_str().to_string(),
                summary,
            },
        )
        .await;
        Ok(())
    }

    // -- Inbound dispatch -------------------------------------------------

    /// Handle one remote-job frame and return the frames to write back on the
    /// same stream, in order.
    ///
    /// This is the trust boundary: EVERY remote-job frame from a peer with no
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
                    "Refused a remote-job message: the peer is authenticated but NOT paired"
                );
                // A request gets a refusal so the sender sees a reason instead of
                // a timeout. Unsolicited progress/result/resume frames from a
                // stranger get nothing — there is no exchange to answer.
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
            } => self
                .accept_request(
                    peer_id,
                    &paired,
                    job_id,
                    kind,
                    instruction,
                    origin_display_name,
                )
                .await
                .map(|ack| vec![ack]),

            // Normally read inline by `send_instruction` on its own stream; also
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
            } => {
                self.apply_result(peer_id, &job_id, &status, summary)
                    .await?;
                Ok(Vec::new())
            }

            Message::RemoteJobResume { job_id, last_seq } => {
                self.replay_for_peer(peer_id, &job_id, last_seq)
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
        job_id: String,
        kind: String,
        instruction: String,
        origin_display_name: String,
    ) -> Result<Message, AppError> {
        let refuse = |reason: &str| Message::RemoteJobAck {
            job_id: job_id.clone(),
            accepted: false,
            reason: Some(reason.to_string()),
        };

        if job_id.trim().is_empty() {
            return Ok(refuse("The request carried no job id."));
        }
        if kind != REMOTE_JOB_KIND_INSTRUCTION {
            return Ok(refuse(
                "This device does not understand that kind of request.",
            ));
        }
        if instruction.trim().is_empty() {
            return Ok(refuse("The request carried no instruction."));
        }
        if instruction.len() > MAX_INSTRUCTION_BYTES {
            return Ok(refuse("That instruction is too long."));
        }

        // Prefer the name the pairing registry holds over the one on the wire:
        // the registry name was confirmed by a human, the wire one is a claim.
        let display_name = if paired_name.trim().is_empty() {
            origin_display_name.clone()
        } else {
            paired_name.to_string()
        };

        let (job, is_new) = repo::create_inbound(
            &self.pool,
            &job_id,
            peer_id,
            &display_name,
            &kind,
            instruction.trim(),
        )?;

        if is_new {
            self.emit(&job).await;
            let assignment = RemoteJobAssignment {
                job_id: job_id.clone(),
                peer_id: peer_id.to_string(),
                origin_display_name: display_name,
                kind,
                instruction: instruction.trim().to_string(),
            };
            let handle = RemoteJobHandle {
                jobs: self.clone(),
                job_id: job_id.clone(),
            };
            let executor = self.executor.read().await.clone();
            // Spawned so a slow executor cannot stall the ack, and so the
            // inbound dispatch task stays free to accept the next stream.
            tokio::spawn(async move {
                executor.execute(assignment, handle).await;
            });
            tracing::info!(peer_id = %peer_id, job_id = %job_id, "Accepted a remote job from a paired device");
        } else {
            tracing::debug!(peer_id = %peer_id, job_id = %job_id, "Re-acking a remote job we already accepted");
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
        if job.status != RemoteJobStatus::Pending {
            return Ok(());
        }
        if accepted {
            repo::mark_running(&self.pool, job_id)?;
        } else {
            repo::mark_refused(
                &self.pool,
                job_id,
                &reason.unwrap_or_else(|| "The other device declined.".into()),
            )?;
        }
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
        // The peer may start reporting before its ack was processed; treat the
        // first note as the acceptance so a job never gets stuck `pending`.
        if job.status == RemoteJobStatus::Pending {
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
    ) -> Result<(), AppError> {
        self.expect_job(peer_id, job_id, RemoteJobDirection::Outbound)?;
        let status = RemoteJobStatus::parse(status)
            .filter(|s| s.is_terminal())
            .unwrap_or(RemoteJobStatus::Failed);
        if repo::finish(
            &self.pool,
            job_id,
            status,
            &truncate(summary, MAX_NOTE_BYTES),
        )? {
            let job = self.reload(job_id)?;
            self.emit(&job).await;
        }
        Ok(())
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
    /// peer is offline and is NOT propagated: the row is already durable and the
    /// resume exchange will deliver it.
    async fn deliver(&self, peer_id: &str, msg: Message) {
        let sent = async {
            let (mut send, _recv) = self.connections.open_stream(peer_id).await?;
            protocol::write_message(&mut send, &msg).await
        }
        .await;
        if let Err(e) = sent {
            tracing::debug!(
                peer_id = %peer_id,
                "Remote-job frame not delivered now, queued for resume: {e}"
            );
        }
    }

    async fn emit(&self, job: &RemoteJob) {
        let guard = self.app_handle.read().await;
        if let Some(app) = guard.as_ref() {
            emit_event(app, event_name::REMOTE_JOB_UPDATED, job);
        }
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
            },
            Message::RemoteJobResume {
                job_id: "job-1".into(),
                last_seq: 0,
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

    /// Sending to a device that is not connected fails immediately with a typed,
    /// operator-actionable error — and writes no row.
    #[tokio::test]
    async fn sending_to_an_offline_device_fails_typed_and_writes_nothing() {
        let pool = test_pool();
        let jobs = service(pool.clone());
        pair(&pool, "peer-a", "Laptop");

        let err = jobs
            .send_instruction("peer-a", None, "do the thing")
            .await
            .expect_err("an offline device cannot be sent work");
        assert!(
            matches!(err, AppError::NetworkOffline(_)),
            "expected a typed NetworkOffline, got {err:?}"
        );
        let msg = err.to_string();
        assert!(msg.contains("Laptop"), "name the device: {msg}");
        assert!(msg.contains("same network"), "state the remedy: {msg}");
        assert!(
            repo::list(&pool, None, 50).expect("list").is_empty(),
            "a refused send must not leave a phantom job"
        );
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
    }

    #[test]
    fn truncate_never_splits_a_character() {
        // 'é' is two bytes; a cut at byte 3 must fall back to byte 2.
        assert_eq!(truncate("aéb".to_string(), 3), "aé");
        assert_eq!(truncate("abc".to_string(), 10), "abc");
    }
}
