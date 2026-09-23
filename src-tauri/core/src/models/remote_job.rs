//! A natural-language job one paired device asked another to run.
//!
//! Both roles share this one shape and are told apart by [`RemoteJobDirection`]:
//! `Outbound` is "I asked", `Inbound` is "I was asked". A device that both sends
//! and receives therefore has both kinds of row in the same table, and a listing
//! reads as one conversation history rather than two disjoint logs.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Which side of the exchange this row records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum RemoteJobDirection {
    /// This device sent the instruction; the peer is running it.
    Outbound,
    /// A paired device sent us the instruction; we are running it.
    Inbound,
}

impl RemoteJobDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            RemoteJobDirection::Outbound => "outbound",
            RemoteJobDirection::Inbound => "inbound",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "outbound" => Some(RemoteJobDirection::Outbound),
            "inbound" => Some(RemoteJobDirection::Inbound),
            _ => None,
        }
    }
}

/// Lifecycle of a remote job, from either side's point of view.
///
/// Machine tokens, not display strings — the frontend maps them through the
/// i18n `status_tokens` table. Only `Pending` and `Running` are non-terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum RemoteJobStatus {
    /// Outbound only: the peer was offline when the job was sent, so it waits in
    /// this device's outbox and goes on the wire when the link next comes up.
    /// Non-terminal. Never seen on the inbound side.
    Queued,
    /// Outbound only: the request is on the wire, no ack yet.
    Pending,
    /// Accepted and executing on the remote device.
    Running,
    /// Finished; `summary` carries the answer.
    Completed,
    /// The running side gave up; `summary` carries why.
    Failed,
    /// Never started — the peer declined (unpaired, no handler, unknown kind).
    Refused,
    /// Abandoned locally without a verdict from the peer.
    Cancelled,
}

impl RemoteJobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RemoteJobStatus::Queued => "queued",
            RemoteJobStatus::Pending => "pending",
            RemoteJobStatus::Running => "running",
            RemoteJobStatus::Completed => "completed",
            RemoteJobStatus::Failed => "failed",
            RemoteJobStatus::Refused => "refused",
            RemoteJobStatus::Cancelled => "cancelled",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "queued" => Some(RemoteJobStatus::Queued),
            "pending" => Some(RemoteJobStatus::Pending),
            "running" => Some(RemoteJobStatus::Running),
            "completed" => Some(RemoteJobStatus::Completed),
            "failed" => Some(RemoteJobStatus::Failed),
            "refused" => Some(RemoteJobStatus::Refused),
            "cancelled" => Some(RemoteJobStatus::Cancelled),
            _ => None,
        }
    }

    /// True once no further progress or result can arrive for this job.
    pub fn is_terminal(self) -> bool {
        !matches!(
            self,
            RemoteJobStatus::Queued | RemoteJobStatus::Pending | RemoteJobStatus::Running
        )
    }
}

/// The only job kind that exists today: run this instruction as written.
///
/// The `kind` discriminator ships now, while PROTOCOL_VERSION 2 is unshipped
/// and the wire shape is still free, so a later typed-job lane (run this recipe,
/// sync this persona) does not need a protocol break to land.
pub const REMOTE_JOB_KIND_INSTRUCTION: &str = "instruction";

/// Run one fleet session on the receiving device, exactly as described by a
/// [`FleetSessionJobPayload`] carried in the job's `payload_json`. The receiving
/// fleet queue admits it with `DispatchOrigin::Remote`; its lifecycle streams
/// back as `RemoteSessionMirror` frames and its completion as a
/// [`FleetSessionJobReceipt`].
pub const REMOTE_JOB_KIND_FLEET_SESSION: &str = "fleet_session";

/// One row of `remote_jobs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteJob {
    /// Job id, minted by the originating device and used verbatim by both.
    pub id: String,
    pub direction: RemoteJobDirection,
    /// The other device's peer_id. Always a row in `owned_devices`.
    pub peer_id: String,
    /// The other device's display name at the time of the exchange, kept so a
    /// history entry still reads sensibly after the device is unpaired.
    pub peer_display_name: String,
    pub kind: String,
    pub instruction: String,
    /// Kind-specific request body as JSON. `None` for `instruction` (the text is
    /// the whole request); a [`FleetSessionJobPayload`] for `fleet_session`.
    pub payload_json: Option<String>,
    /// The completion receipt of a `fleet_session` job. `None` until terminal,
    /// and always `None` for `instruction`.
    pub receipt: Option<FleetSessionJobReceipt>,
    pub status: RemoteJobStatus,
    /// The final answer (or the failure reason). `None` until terminal.
    pub summary: Option<String>,
    /// Why the peer refused, when `status == Refused`.
    pub refusal_reason: Option<String>,
    /// The highest progress sequence number this side has durably handled —
    /// emitted, on the running side; received, on the originating side. The
    /// resume-on-reconnect exchange replays strictly above this number.
    pub last_seq: u32,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

/// One progress note. Persisted so a link that drops mid-job can replay the
/// notes the originating device never saw.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteJobNote {
    pub job_id: String,
    /// 1-based, monotonic per job, no gaps.
    pub seq: u32,
    pub text: String,
    pub created_at: String,
}

/// How a dispatched fleet session is driven on the receiving device. The same
/// two tokens as the fleet's own `FleetSessionMode`; restated here because this
/// crate cannot see the app crate's type and the wire must not depend on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RemoteSessionMode {
    /// PTY + xterm on the receiving device (the `fleet` transport).
    Interactive,
    /// `claude -p` stream-json, no TTY (the `cli` transport).
    Headless,
}

/// The request body of a `fleet_session` job, minted on the ORIGINATING device.
///
/// The project travels as three keys because Stage 1 has no shared project id:
/// the receiver resolves `github_url` first, then `project_id`, then an exact
/// `project_name`, against its own `dev_projects`, and refuses with
/// `project_not_found` when none matches.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetSessionJobPayload {
    pub project_id: String,
    pub github_url: String,
    pub project_name: String,
    pub prompt: String,
    pub mode: RemoteSessionMode,
    /// The branch the session works on, minted by the originator as
    /// `remote/<originPeerShort8>/<jobShort8>` so it is unique per job and
    /// readable in `git branch -r`.
    pub branch: String,
    pub persona_id: Option<String>,
}

/// What a finished `fleet_session` job left behind. The running device fills
/// everything but `verified`; the originating device's harvest fills `verified`
/// after fetching the branch: `Some(true)` the SHA exists locally after fetch,
/// `Some(false)` it does not, `None` the originator could not check (it has no
/// local checkout of the project) - "could not verify" is not "broken".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetSessionJobReceipt {
    pub session_id: String,
    pub branch: String,
    /// Read from `git ls-remote` on the running device, never from the model's
    /// own account. `None` when nothing was pushed.
    pub pushed_sha: Option<String>,
    /// Why the push did not happen or failed (`None` on success, and when there
    /// was nothing to push - see `pushed_sha`).
    pub push_error: Option<String>,
    pub verified: Option<bool>,
}

/// The originator's view of a remote session's lifecycle: every
/// `FleetSessionState` token plus `unknown`.
///
/// `Unknown` is what the originator shows when it cannot see the session: the
/// link is down, or no mirror or health frame arrived for 45 s (three 15 s
/// health ticks). A quiet remote session is never shown as running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RemoteSessionState {
    Queued,
    Spawning,
    Running,
    AwaitingInput,
    Idle,
    Stale,
    Finished,
    Hibernated,
    Exited,
    Unknown,
}

/// One remote session as the ORIGINATING device tracks it. Built from the last
/// `RemoteSessionMirror` frame (persisted in `remote_jobs.mirror_json`) plus the
/// job row, and re-derived to `state: Unknown` by the liveness rule.
///
/// Millisecond fields are `f64` so they bind to TypeScript `number` (an `i64`
/// would bind to `bigint`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionView {
    pub job_id: String,
    /// The fleet session id on the running device. `None` until the running
    /// device has admitted it.
    pub session_id: Option<String>,
    pub peer_id: String,
    pub peer_display_name: String,
    pub project_id: String,
    pub project_label: String,
    pub github_url: String,
    pub title: Option<String>,
    pub state: RemoteSessionState,
    pub state_reason: Option<String>,
    pub mode: RemoteSessionMode,
    pub created_at_ms: f64,
    pub last_activity_ms: f64,
    /// When this device last heard a mirror frame for the job. `0` = never.
    pub mirror_at_ms: f64,
    /// The job's own status, so a view can say "queued until it wakes".
    pub job_status: RemoteJobStatus,
    pub receipt: Option<FleetSessionJobReceipt>,
}

/// A steering verb the originator may send for a running remote session. A
/// closed grammar: anything else is unrepresentable on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RemoteSessionCommand {
    SendInput,
    Kill,
    Wake,
}

/// How reachable a paired device is right now, for the "Run on" pickers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DeviceReachability {
    /// An authenticated connection is up.
    Connected,
    /// Seen on the LAN recently but not connected.
    Stale,
    /// Not seen. Work sent now waits in the outbox as `queued`.
    Offline,
}

/// One paired device as a dispatch target.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DispatchDevice {
    pub peer_id: String,
    pub display_name: String,
    pub is_home: bool,
    pub reachability: DeviceReachability,
}

/// One chunk of a remote session's terminal output, as the
/// `network:remote-session-output` event carries it. A lossy tail: `seq` counts
/// chunks per job so the viewer can tell it skipped some, and nothing replays a
/// dropped chunk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionOutputChunk {
    pub job_id: String,
    pub seq: u32,
    pub chunk_b64: String,
}
