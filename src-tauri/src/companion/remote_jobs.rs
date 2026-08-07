//! Athena's end of the cross-device link — BOTH ends of it.
//!
//! WP2 built the wire (`engine::p2p::remote_jobs`): a paired device hands this
//! one a natural-language instruction, and progress notes and a final summary
//! travel back. This module is the half that actually does something with it:
//!
//! - **Inbound** — [`AthenaRemoteJobs`] implements the wire's
//!   [`RemoteJobExecutor`] seam by running the instruction as a REAL Athena
//!   turn, with her own ops, her own approval rows and her own autopilot rules.
//!   Nothing is stripped from her for being remote; see "Why no deny-list".
//! - **Outbound** — [`install`] also registers a listener on the wire's own
//!   `network:remote-job-updated` event so that what the OTHER machine did
//!   lands in this Athena's memory as episodes. Without it she can watch a job
//!   finish in the Devices tab and still have nothing to say about it.
//!
//! ## Why no deny-list
//!
//! A remote instruction is executed with Athena's FULL op set. The design
//! decision (WP3) is deliberate: the gate that matters already happened —
//! `RemoteJobs::handle_message` refuses any peer without an `owned_devices`
//! row, so the only sender that can reach here is a device the operator paired
//! by confirming a fingerprint. Past that point the request is the operator's
//! own, arriving over a different keyboard. Everything that constrains Athena
//! locally still constrains her here, unchanged and unduplicated: approval rows
//! for anything gated, `AUTOAPPROVE_ALLOWLIST` + the boldness matrix under
//! autonomous mode, `validate_fleet_cwd` on every spawn, the role caps. A
//! second, remote-only policy would be a second answer to the same question —
//! and the one that silently rots.
//!
//! ## Why a job can never be left `Running`
//!
//! A job stuck `Running` is the worst failure here: it hangs on BOTH devices,
//! and the one that asked cannot tell "still working" from "died". Four layers,
//! in order of how far the damage got:
//!
//! 1. `execute` returns immediately and does the work in a spawned task, so a
//!    slow turn never stalls the inbound dispatch loop.
//! 2. The turn runs in an INNER `tokio::spawn`, and its `JoinHandle` is
//!    awaited. A panic inside the turn is a `JoinError`, not a lost task, so it
//!    still reaches `handle.fail`.
//! 3. That await is wrapped in a timeout ([`REMOTE_TURN_TIMEOUT`]) slightly
//!    above the CLI's own per-turn ceiling, so a wedged turn is reported and
//!    the inner task aborted.
//! 4. A process that dies mid-job outlives all three. [`sweep_interrupted`]
//!    runs at startup and fails every inbound job left `Running`: this device
//!    knows nothing is executing, because nothing survived the restart. The
//!    originator learns about it through the ordinary resume exchange — a
//!    terminal row replays its result on the next reconnect.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::db::models::{RemoteJob, RemoteJobDirection, RemoteJobStatus};
use crate::db::repos::resources::remote_jobs as repo;
use crate::engine::event_registry::event_name;
use crate::engine::p2p::remote_jobs::{RemoteJobAssignment, RemoteJobExecutor, RemoteJobHandle};

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::{
    self, RemoteJobTurnEvent, TurnOrigin, DEFAULT_SESSION_ID, REMOTE_JOB_TURN_EVENT,
};
use crate::error::AppError;
use crate::AppState;

/// Ceiling on one remote turn, measured from the moment the job is accepted.
/// Deliberately above `session::TURN_TIMEOUT` (25 min) so a turn that hits its
/// OWN timeout reports that as the reason — this one only fires when the turn
/// machinery itself wedged, e.g. blocked forever on the conversation's turn
/// lock behind a stuck local turn.
const REMOTE_TURN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(27 * 60);

/// Longest summary sent back over the wire. The transport truncates at 16 KB;
/// cutting earlier keeps the other device's episode readable.
const MAX_SUMMARY_CHARS: usize = 4_000;

/// How many of a finished job's progress notes ride along in the episode this
/// device writes for it. See [`append_outbound_episode`] for the volume policy.
const EPISODE_NOTE_CAP: usize = 5;
const EPISODE_NOTE_CHARS: usize = 200;

// ── Inbound: an arriving instruction becomes a real turn ────────────────

/// The executor installed on [`RemoteJobs::set_executor`] at startup.
pub struct AthenaRemoteJobs {
    app: AppHandle,
}

#[async_trait::async_trait]
impl RemoteJobExecutor for AthenaRemoteJobs {
    /// Runs on the inbound dispatch task — returns immediately, always.
    async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle) {
        let app = self.app.clone();
        tokio::spawn(async move {
            run_assignment(app, job, handle).await;
        });
    }
}

/// The whole inbound lifecycle for one job. Every exit path — success, turn
/// error, panic, timeout — ends in exactly one `complete` or `fail`.
async fn run_assignment(app: AppHandle, job: RemoteJobAssignment, handle: RemoteJobHandle) {
    let source = session::remote_device_source(&job.origin_display_name);
    emit_turn_event(&app, &job, "started", "");

    // The first note is what turns a silent "running" row on the other device
    // into "she picked it up". A failure here is a DB failure, not a reason to
    // abandon the job — the turn still runs.
    if let Err(e) = handle
        .progress(format!("{} is on it.", local_device_label(&app)))
        .await
    {
        tracing::warn!(job_id = %job.job_id, error = %e, "remote job: opening progress note failed");
    }

    let turn_app = app.clone();
    let instruction = job.instruction.clone();
    let turn_source = source.clone();
    // INNER spawn: its JoinHandle turns a panic into a value we can report,
    // instead of a task that vanishes and a job that never finishes.
    let inner = tokio::spawn(async move { run_turn(turn_app, instruction, turn_source).await });
    let abort = inner.abort_handle();

    let outcome: Result<String, String> =
        match tokio::time::timeout(REMOTE_TURN_TIMEOUT, inner).await {
            Ok(Ok(Ok(text))) => Ok(text),
            Ok(Ok(Err(e))) => Err(format!("The assistant could not finish that: {e}")),
            Ok(Err(join)) => {
                tracing::error!(job_id = %job.job_id, error = %join, "remote job: the turn task died");
                Err(if join.is_panic() {
                    "The assistant crashed while working on that.".to_string()
                } else {
                    "The assistant's turn was cancelled before it finished.".to_string()
                })
            }
            Err(_elapsed) => {
                abort.abort();
                Err(format!(
                    "The assistant did not finish within {} minutes and was stopped.",
                    REMOTE_TURN_TIMEOUT.as_secs() / 60
                ))
            }
        };

    let (phase, summary) = match outcome {
        Ok(text) => {
            let text = cap(text, MAX_SUMMARY_CHARS);
            let text = if text.trim().is_empty() {
                "Done — she finished without a written summary.".to_string()
            } else {
                text
            };
            if let Err(e) = handle.complete(text.clone()).await {
                tracing::warn!(job_id = %job.job_id, error = %e, "remote job: complete() failed");
            }
            ("completed", text)
        }
        Err(reason) => {
            let reason = cap(reason, MAX_SUMMARY_CHARS);
            if let Err(e) = handle.fail(reason.clone()).await {
                tracing::warn!(job_id = %job.job_id, error = %e, "remote job: fail() failed");
            }
            ("failed", reason)
        }
    };
    emit_turn_event(&app, &job, phase, &summary);
}

/// One Athena turn, driven exactly like a user-initiated one except for its
/// provenance tag and the suppressed transcript.
async fn run_turn(
    app: AppHandle,
    instruction: String,
    source: String,
) -> Result<String, AppError> {
    let state = app.state::<Arc<AppState>>();
    let user_db = Arc::new(state.user_db.clone());
    let sys_db = Arc::new(state.db.clone());
    #[cfg(feature = "ml")]
    let embedder = state.embedding_manager.clone();
    let autonomous = crate::commands::companion::chat::autonomous_mode_enabled(&state.db);
    let turn = session::send_turn(
        &app,
        user_db,
        sys_db,
        #[cfg(feature = "ml")]
        embedder,
        instruction,
        TurnOrigin::External { source },
        // No TTS: the person who asked is not in the room.
        false,
        false,
        autonomous,
        DEFAULT_SESSION_ID.to_string(),
    )
    .await?;
    Ok(turn.assistant_text)
}

fn emit_turn_event(app: &AppHandle, job: &RemoteJobAssignment, phase: &str, summary: &str) {
    let payload = RemoteJobTurnEvent {
        job_id: job.job_id.clone(),
        source: job.origin_display_name.clone(),
        instruction: cap(job.instruction.clone(), 400),
        phase: phase.to_string(),
        summary: summary.to_string(),
    };
    if let Err(e) = app.emit(REMOTE_JOB_TURN_EVENT, payload) {
        tracing::warn!(error = %e, "remote job turn event emit failed");
    }
}

/// This device's own name, for a progress note the OTHER device reads.
fn local_device_label(app: &AppHandle) -> String {
    let state = app.state::<Arc<AppState>>();
    crate::engine::identity::get_or_create_identity(&state.db)
        .map(|i| i.display_name)
        .unwrap_or_else(|_| "The other device".to_string())
}

// ── Outbound: what happened over there becomes memory over here ─────────

/// Turn a finished (or just-started) OUTBOUND job into a `System` episode.
///
/// **Volume policy — at most two episodes per job, whatever the note count.**
/// A remote turn can emit dozens of progress notes; one episode each would
/// crowd the recall window with "still working" lines that say nothing an hour
/// later. So:
///   1. the FIRST note only (`last_seq == 1`) writes a short "picked it up"
///      episode, so a turn taken while the job runs knows it is in flight;
///   2. the terminal transition writes the episode that matters — status,
///      summary, and a digest of up to [`EPISODE_NOTE_CAP`] notes, each capped
///      at [`EPISODE_NOTE_CHARS`] characters.
/// Everything in between stays where it already lives: the `remote_job_notes`
/// rows and the Devices tab that renders them.
///
/// Exactly-once falls out of the wire's own semantics rather than a guard
/// here: `apply_note` only emits for a genuinely new note, and `finish` only
/// emits on the transition that changed the row, so a reconnect replay is
/// silent.
async fn append_outbound_episode(app: &AppHandle, job: &RemoteJob) {
    let content = if job.status.is_terminal() {
        let notes = repo::list_notes(&app.state::<Arc<AppState>>().db, &job.id)
            .unwrap_or_default()
            .into_iter()
            .rev()
            .take(EPISODE_NOTE_CAP)
            .collect::<Vec<_>>();
        let mut digest = notes
            .into_iter()
            .rev()
            .map(|n| format!("  - {}", cap(n.text, EPISODE_NOTE_CHARS)))
            .collect::<Vec<_>>()
            .join("\n");
        if !digest.is_empty() {
            digest = format!("\n\nProgress it reported (last {EPISODE_NOTE_CAP}):\n{digest}");
        }
        let verdict = match job.status {
            RemoteJobStatus::Completed => "finished it",
            RemoteJobStatus::Refused => "refused it",
            RemoteJobStatus::Cancelled => "never started it",
            _ => "could not finish it",
        };
        format!(
            "[device: {name}] I asked \"{name}\" to: {instruction}\n\nIt {verdict}. {summary}{digest}",
            name = job.peer_display_name,
            instruction = cap(job.instruction.clone(), 1_000),
            summary = job
                .summary
                .clone()
                .or_else(|| job.refusal_reason.clone())
                .unwrap_or_default(),
        )
    } else {
        format!(
            "[device: {name}] \"{name}\" picked up the request \"{instruction}\" and is working on it.",
            name = job.peer_display_name,
            instruction = cap(job.instruction.clone(), 300),
        )
    };

    let state = app.state::<Arc<AppState>>();
    let pool = &state.user_db;
    let written = {
        #[cfg(feature = "ml")]
        {
            match state.embedding_manager.as_ref() {
                Some(emb) => {
                    episodic::append_episode_and_embed(
                        pool,
                        emb,
                        DEFAULT_SESSION_ID,
                        EpisodeRole::System,
                        &content,
                    )
                    .await
                }
                None => episodic::append_episode(
                    pool,
                    DEFAULT_SESSION_ID,
                    EpisodeRole::System,
                    &content,
                ),
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, &content)
        }
    };
    if let Err(e) = written {
        tracing::warn!(job_id = %job.id, error = %e, "remote job: episode write failed");
    }
}

/// Does this job update deserve an episode? See the volume policy above.
fn episode_worthy(job: &RemoteJob) -> bool {
    if job.direction != RemoteJobDirection::Outbound {
        return false;
    }
    job.status.is_terminal() || (job.status == RemoteJobStatus::Running && job.last_seq == 1)
}

// ── Startup wiring ─────────────────────────────────────────────────────

/// Fail every inbound job left `Running` by a crash / force-quit.
///
/// Nothing is executing for them — no task survived the process — so leaving
/// them `Running` would strand the row here AND on the device that asked. The
/// terminal row is enough: the originator's reconnect sends `RemoteJobResume`,
/// and `replay_for_peer` answers a terminal job with its result. Returns how
/// many were swept.
pub fn sweep_interrupted(db: &crate::db::DbPool) -> Result<usize, AppError> {
    let mut swept = 0;
    for job in repo::list(db, Some(RemoteJobDirection::Inbound), 500)? {
        if job.status.is_terminal() {
            continue;
        }
        if repo::finish(
            db,
            &job.id,
            RemoteJobStatus::Failed,
            "This device restarted before the assistant finished. Send it again.",
        )? {
            swept += 1;
        }
    }
    Ok(swept)
}

/// Install both ends. Called once at startup, after the network service exists.
pub async fn install(app: &AppHandle, network: &Arc<crate::engine::p2p::NetworkService>) {
    let state = app.state::<Arc<AppState>>();
    match sweep_interrupted(&state.db) {
        Ok(0) => {}
        Ok(n) => tracing::info!(count = n, "remote jobs: failed inbound jobs interrupted by a restart"),
        Err(e) => tracing::warn!(error = %e, "remote jobs: interrupted-job sweep failed"),
    }

    network
        .remote_jobs
        .set_executor(Arc::new(AthenaRemoteJobs { app: app.clone() }))
        .await;

    // The outbound half. The wire emits this on every job transition on both
    // sides; the filter picks the two moments worth remembering.
    let listener_app = app.clone();
    app.listen(event_name::REMOTE_JOB_UPDATED, move |event| {
        let job: RemoteJob = match serde_json::from_str(event.payload()) {
            Ok(j) => j,
            Err(e) => {
                tracing::warn!(error = %e, "remote job event payload did not parse");
                return;
            }
        };
        if !episode_worthy(&job) {
            return;
        }
        let app = listener_app.clone();
        tauri::async_runtime::spawn(async move {
            append_outbound_episode(&app, &job).await;
        });
    });
    tracing::info!("Athena remote-job executor installed");
}

/// Clamp to `max` characters (not bytes — this text is user-facing).
fn cap(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        return s;
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(direction: RemoteJobDirection, status: RemoteJobStatus, last_seq: u32) -> RemoteJob {
        RemoteJob {
            id: "job-1".into(),
            direction,
            peer_id: "peer-a".into(),
            peer_display_name: "Laptop".into(),
            kind: "instruction".into(),
            instruction: "go".into(),
            status,
            summary: None,
            refusal_reason: None,
            last_seq,
            created_at: "now".into(),
            updated_at: "now".into(),
            completed_at: None,
        }
    }

    /// The volume policy, pinned. A chatty remote turn must cost two episodes,
    /// not one per note — the recall window is the scarce resource.
    #[test]
    fn only_the_first_note_and_the_terminal_transition_earn_an_episode() {
        assert!(episode_worthy(&job(
            RemoteJobDirection::Outbound,
            RemoteJobStatus::Running,
            1
        )));
        for seq in [2u32, 3, 40] {
            assert!(
                !episode_worthy(&job(RemoteJobDirection::Outbound, RemoteJobStatus::Running, seq)),
                "note {seq} must not write an episode"
            );
        }
        for status in [
            RemoteJobStatus::Completed,
            RemoteJobStatus::Failed,
            RemoteJobStatus::Refused,
            RemoteJobStatus::Cancelled,
        ] {
            assert!(episode_worthy(&job(RemoteJobDirection::Outbound, status, 12)));
        }
    }

    /// Inbound jobs are OUR errands for someone else. Their result already
    /// reaches the asker over the wire; writing it into this device's memory
    /// would put the other person's conversation in Athena's head.
    #[test]
    fn inbound_jobs_never_write_episodes_here() {
        for status in [
            RemoteJobStatus::Running,
            RemoteJobStatus::Completed,
            RemoteJobStatus::Failed,
        ] {
            assert!(!episode_worthy(&job(RemoteJobDirection::Inbound, status, 1)));
        }
    }

    #[test]
    fn the_source_label_round_trips_and_is_distinguishable_from_app_surfaces() {
        let s = session::remote_device_source("Laptop");
        assert!(s.starts_with("Laptop"));
        assert!(session::is_remote_device_source(&s));
        assert!(!session::is_remote_device_source("Fleet"));
        // An unnamed device still produces a legible provenance tag.
        assert!(session::is_remote_device_source(&session::remote_device_source("  ")));
    }

    #[test]
    fn cap_adds_an_ellipsis_only_when_it_cuts() {
        assert_eq!(cap("abc".into(), 5), "abc");
        assert_eq!(cap("abcdef".into(), 3), "abc…");
        // Multi-byte characters are counted, never split.
        assert_eq!(cap("ééé".into(), 2), "éé…");
    }
}
