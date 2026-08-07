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
        !matches!(self, RemoteJobStatus::Pending | RemoteJobStatus::Running)
    }
}

/// The only job kind that exists today: run this instruction as written.
///
/// The `kind` discriminator ships now, while PROTOCOL_VERSION 2 is unshipped
/// and the wire shape is still free, so a later typed-job lane (run this recipe,
/// sync this persona) does not need a protocol break to land.
pub const REMOTE_JOB_KIND_INSTRUCTION: &str = "instruction";

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
