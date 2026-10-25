//! The mandate mesh mirror (spark `mandate-lanes`, WP9): what a charter's
//! HOME device tells its paired peers about it, and the closed set of
//! verdicts a peer may send home.
//!
//! ## The home rule
//!
//! A charter's **home** is the device whose database holds its
//! `persona_responsibilities` row: the device it was created (hired, drafted
//! or adopted) on. Its steward, its items and its spend live there, so only
//! the home device ever writes the charter or appends to its `charter_acts`.
//! A paired peer holds a MIRROR (`mirrored_charters` +
//! `mirrored_charter_acts`, migration `e69_charter_mirror`), never a
//! `persona_responsibilities` row, so nothing on the peer that reads charters
//! (the router, the sweep, the re-read law, the orphanage) can see a mirrored
//! charter, let alone file an item under it. The owned-device `is_home` flag
//! is a different thing (the machine the user nominates for other purposes)
//! and does not move a charter's home.
//!
//! ## The two streams (sync-replication: one declaration per stream)
//!
//! | Stream | Kind | Direction | Authority | Conflict policy |
//! |---|---|---|---|---|
//! | mirror | [`REMOTE_JOB_KIND_CHARTER_MIRROR`] | home -> every paired peer | home | latest `sent_at_ms` wins for the summary; acts are append-only, keyed by act id, and only the one-way `reverted` transition updates a stored act |
//! | verdict | [`REMOTE_JOB_KIND_CHARTER_VERDICT`] | peer -> home | home | the home applies it through the SAME door its own UI uses, refusing it when the envelope moved since the peer saw it |
//!
//! Both ride the existing remote-job wire: its pairing gate (`owned_devices`
//! only), its durable outbox (a job for an offline peer waits `queued`) and
//! its idempotent inbound create (a re-delivered job id is re-acked, never
//! re-run). Spend caps stay per device: a peer never dispatches under a
//! mirrored mandate, so it never spends against a mirrored cap.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::mandate::{
    CharterAct, MandateActOutcome, MandateChange, MandateSignInput, MandateSummary,
};

/// Home -> peer: one charter's latest summary and its newest acts
/// ([`CharterMirrorPayload`] in `payload_json`). Completes on arrival.
pub const REMOTE_JOB_KIND_CHARTER_MIRROR: &str = "charter_mirror";

/// Peer -> home: one verdict on a mirrored charter
/// ([`CharterVerdictPayload`] in `payload_json`), answered with a
/// [`CharterVerdictReceipt`].
pub const REMOTE_JOB_KIND_CHARTER_VERDICT: &str = "charter_verdict";

/// The newest acts one mirror job carries (a bounded backfill, never the
/// whole history).
pub const MIRROR_ACTS_PER_JOB: usize = 50;

/// The most acts a peer keeps per mirrored charter.
pub const MIRROR_ACTS_KEPT: usize = 500;

/// The longest operator reason a verdict may carry (drop, keep).
pub const VERDICT_REASON_MAX_BYTES: usize = 2 * 1024;

/// What a home device sends a peer about one of its charters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharterMirrorPayload {
    /// The charter as the home reads it, any status (a `retired` status is
    /// the tombstone: the peer stops listing it).
    pub charter: MandateSummary,
    /// The charter's newest acts, newest first, at most
    /// [`MIRROR_ACTS_PER_JOB`].
    pub acts: Vec<CharterAct>,
    /// The home's clock when the snapshot was built; latest wins.
    pub sent_at_ms: f64,
}

impl CharterMirrorPayload {
    /// What is wrong with it, or `None`. Both ends run it (the sender before
    /// writing the job, the receiver before persisting it).
    pub fn problem(&self) -> Option<String> {
        if self.charter.charter_id.trim().is_empty() {
            return Some("A mandate mirror names no mandate.".into());
        }
        if self.acts.len() > MIRROR_ACTS_PER_JOB {
            return Some(format!(
                "A mandate mirror carries {} acts (limit {MIRROR_ACTS_PER_JOB}).",
                self.acts.len()
            ));
        }
        if let Some(stray) = self
            .acts
            .iter()
            .find(|a| a.charter_id != self.charter.charter_id || a.id.trim().is_empty())
        {
            return Some(format!(
                "A mandate mirror carries act {} of another mandate.",
                stray.id
            ));
        }
        if !self.sent_at_ms.is_finite() {
            return Some("A mandate mirror carries no send time.".into());
        }
        None
    }
}

/// The closed grammar of what a peer may decide on a mirrored mandate. Only
/// these parse; anything else is refused before it is persisted. Each one is
/// applied at home through the door the home's own UI uses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CharterVerdict {
    Sign {
        envelope: MandateSignInput,
    },
    /// Widen, narrow, merge policy or budget.
    Amend {
        change: MandateChange,
    },
    Suspend,
    Resume,
    Drop {
        reason: Option<String>,
    },
    Keep {
        reason: String,
    },
    /// Revert one act of THIS mandate.
    #[serde(rename_all = "camelCase")]
    Revert {
        act_id: String,
    },
}

impl CharterVerdict {
    /// The door's name, for logs and the job's one-line instruction.
    pub fn door(&self) -> &'static str {
        match self {
            Self::Sign { .. } => "sign",
            Self::Amend { .. } => "amend",
            Self::Suspend => "suspend",
            Self::Resume => "resume",
            Self::Drop { .. } => "drop",
            Self::Keep { .. } => "keep",
            Self::Revert { .. } => "revert",
        }
    }
}

/// Peer -> home.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharterVerdictPayload {
    pub charter_id: String,
    pub verdict: CharterVerdict,
    /// The envelope version the peer's mirror showed when the operator
    /// decided. The home refuses the verdict when its charter has moved past
    /// it: a write acts only on what the projection showed.
    pub seen_envelope_version: i64,
}

impl CharterVerdictPayload {
    pub fn problem(&self) -> Option<String> {
        if self.charter_id.trim().is_empty() {
            return Some("A mandate verdict names no mandate.".into());
        }
        let reason = match &self.verdict {
            CharterVerdict::Drop { reason } => reason.as_deref().unwrap_or(""),
            CharterVerdict::Keep { reason } => reason.as_str(),
            CharterVerdict::Revert { act_id } if act_id.trim().is_empty() => {
                return Some("A revert names no act.".into())
            }
            _ => "",
        };
        if reason.len() > VERDICT_REASON_MAX_BYTES {
            return Some(format!(
                "That reason is too long ({} bytes, limit {VERDICT_REASON_MAX_BYTES}).",
                reason.len()
            ));
        }
        None
    }
}

/// Home -> peer, as the verdict job's receipt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharterVerdictReceipt {
    /// The home applied it (and its act will mirror back).
    pub applied: bool,
    /// The refreshed mandate and the act the home recorded.
    pub outcome: Option<MandateActOutcome>,
    /// Why not, when not.
    pub reason: Option<String>,
}

/// Where a mirrored mandate lives. `MandateSummary::mirror` is `None` on the
/// home device.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateMirror {
    /// The home device's peer id.
    pub home_peer_id: String,
    /// The home device's name as this device's pairing registry holds it.
    pub home_name: String,
    /// When this device last stored a snapshot from home (RFC 3339).
    pub mirrored_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_verdict_grammar_is_closed_and_tagged() {
        let v: CharterVerdict = serde_json::from_str(r#"{"kind":"revert","actId":"a1"}"#).unwrap();
        assert_eq!(
            v,
            CharterVerdict::Revert {
                act_id: "a1".into()
            }
        );
        assert_eq!(
            serde_json::to_string(&CharterVerdict::Suspend).unwrap(),
            r#"{"kind":"suspend"}"#
        );
        // A door the grammar does not name does not parse.
        assert!(serde_json::from_str::<CharterVerdict>(r#"{"kind":"adopt"}"#).is_err());
        assert!(serde_json::from_str::<CharterVerdict>(r#"{"kind":"delete"}"#).is_err());
    }

    #[test]
    fn a_verdict_reason_is_bounded() {
        let long = CharterVerdictPayload {
            charter_id: "c1".into(),
            verdict: CharterVerdict::Keep {
                reason: "x".repeat(VERDICT_REASON_MAX_BYTES + 1),
            },
            seen_envelope_version: 1,
        };
        assert!(long.problem().is_some());
        let empty_revert = CharterVerdictPayload {
            charter_id: "c1".into(),
            verdict: CharterVerdict::Revert { act_id: " ".into() },
            seen_envelope_version: 1,
        };
        assert!(empty_revert.problem().is_some());
    }
}
