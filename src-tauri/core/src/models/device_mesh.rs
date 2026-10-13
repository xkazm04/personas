//! The device mesh: what one paired Personas desktop tells the others about
//! itself, and the closed set of things one may ask another to do.
//!
//! Three channels, each with the semantics its job needs:
//!
//! * [`DeviceSnapshot`] - LATEST-WINS state (load, agents, queue). Sent over the
//!   authenticated lane to `owned_devices` only, every health tick and on
//!   change; never persisted, never replayed. A snapshot older than
//!   [`SNAPSHOT_STALE_AFTER_MS`] is shown as [`MeshLiveness::Unknown`], never
//!   as live.
//! * `mesh_verb` remote jobs ([`MeshVerbPayload`]) - a durable record before
//!   any effect, so a verb aimed at an offline peer waits in the outbox as
//!   `queued` like every other remote job.
//! * `cli_mail` remote jobs - a small durable mailbox two Claude Code CLIs use
//!   to coordinate through their apps (the onboarding skill).
//!
//! Discovery still advertises nothing beyond id, name and protocol version;
//! everything here travels only after the pairing ceremony.
//!
//! Absent-value convention: an absent optional is `None` (TS `null`), never an
//! omitted key and never `0`. Millisecond fields are `f64` so they bind to
//! TypeScript `number`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{DeviceReachability, GpuClass, ResourceAxis};

/// Run one closed mesh verb on the receiving device ([`MeshVerbPayload`] in
/// the job's `payload_json`; the outcome comes back as a [`MeshVerbReceipt`]).
pub const REMOTE_JOB_KIND_MESH_VERB: &str = "mesh_verb";

/// Deliver one CLI mailbox message ([`CliMailPayload`] in `payload_json`).
pub const REMOTE_JOB_KIND_CLI_MAIL: &str = "cli_mail";

/// A snapshot older than this renders `unknown`: three missed 15 s ticks.
pub const SNAPSHOT_STALE_AFTER_MS: f64 = 45_000.0;

/// The largest CLI mail body accepted, in bytes.
pub const CLI_MAIL_MAX_BYTES: usize = 16 * 1024;

/// This device's whole-machine load, as shares of its own capacity (0..=1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostLoad {
    pub cpu_share: f64,
    pub ram_share: f64,
    /// `None` when the platform cannot read GPU engines.
    pub gpu_share: Option<f64>,
}

/// One persona on the device that sent the snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAgent {
    pub persona_id: String,
    pub name: String,
    pub enabled: bool,
    /// The persona's project switch; `None` when the persona has no project.
    pub project_id: Option<String>,
    pub project_enabled: Option<bool>,
    /// The dominant axis over the persona's recent measured runs; `None`
    /// until it has one.
    pub dominant: Option<ResourceAxis>,
    /// True while a run of this persona is live on that device.
    pub running: bool,
}

/// One queued fleet entry on the device that sent the snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeviceQueueEntry {
    pub session_id: String,
    pub title: String,
    pub project_label: Option<String>,
    pub rank: u32,
    pub machine_units: u32,
    pub gpu: GpuClass,
}

/// What one device tells its paired peers about itself. Latest-wins.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshot {
    pub peer_id: String,
    pub display_name: String,
    /// The sender's app version (`CARGO_PKG_VERSION`).
    pub app_version: String,
    pub sent_at_ms: f64,
    pub host: DeviceHostLoad,
    /// Live fleet sessions plus running persona executions.
    pub running: u32,
    pub queued: u32,
    pub agents: Vec<DeviceAgent>,
    pub queue: Vec<DeviceQueueEntry>,
}

/// Whether a device's snapshot can be believed right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum MeshLiveness {
    /// A snapshot arrived within [`SNAPSHOT_STALE_AFTER_MS`].
    Live,
    /// No snapshot, or the last one is older than the stale window. Never
    /// rendered as live.
    Unknown,
}

/// One device as the Monitor's device strip reads it. For THIS device
/// (`is_self`) the snapshot is built locally and liveness is always `live`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MeshDeviceView {
    pub peer_id: String,
    pub display_name: String,
    pub is_self: bool,
    pub is_home: bool,
    pub reachability: DeviceReachability,
    pub liveness: MeshLiveness,
    pub snapshot: Option<DeviceSnapshot>,
    /// When the last snapshot from this device landed here.
    pub received_at_ms: Option<f64>,
    /// The most recent onboarding/probe verdict for this device.
    pub last_probe: Option<MeshProbeVerdict>,
}

/// The closed verb grammar one paired device may ask another to run. Every
/// write acts only on what that device's snapshot showed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "verb", rename_all = "snake_case")]
pub enum MeshVerbPayload {
    /// A capability probe whose success is useful work: the receipt carries
    /// the receiver's version and build features.
    Ping,
    #[serde(rename_all = "camelCase")]
    PersonaSetEnabled { persona_id: String, enabled: bool },
    #[serde(rename_all = "camelCase")]
    ProjectSetEnabled { project_id: String, enabled: bool },
    /// The full new order of the receiver's queued session ids.
    #[serde(rename_all = "camelCase")]
    QueueReorder { session_ids: Vec<String> },
    #[serde(rename_all = "camelCase")]
    QueueCancel { session_id: String },
    #[serde(rename_all = "camelCase")]
    QueueStartNow { session_id: String },
}

impl MeshVerbPayload {
    /// The verb's snake_case token, as the `verb` tag carries it.
    pub fn verb(&self) -> &'static str {
        match self {
            MeshVerbPayload::Ping => "ping",
            MeshVerbPayload::PersonaSetEnabled { .. } => "persona_set_enabled",
            MeshVerbPayload::ProjectSetEnabled { .. } => "project_set_enabled",
            MeshVerbPayload::QueueReorder { .. } => "queue_reorder",
            MeshVerbPayload::QueueCancel { .. } => "queue_cancel",
            MeshVerbPayload::QueueStartNow { .. } => "queue_start_now",
        }
    }
}

/// The outcome of one `mesh_verb` job, carried in the job's `receipt_json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MeshVerbReceipt {
    pub verb: String,
    pub ok: bool,
    /// The refusal reason, or for `ping` the receiver's
    /// `"<version> <features>"`.
    pub detail: Option<String>,
}

/// One CLI mailbox message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CliMailPayload {
    /// The coordination topic, e.g. `onboard/t3`.
    pub topic: String,
    /// At most [`CLI_MAIL_MAX_BYTES`].
    pub body: String,
}

/// One received CLI mail, as `/mesh/mail` returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CliMail {
    pub job_id: String,
    pub peer_id: String,
    pub topic: String,
    pub body: String,
    pub received_at_ms: f64,
}

/// One onboarding or probe test result against a peer. One row of the
/// append-only `mesh_probe_results` table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MeshProbeVerdict {
    pub peer_id: String,
    /// The test id, e.g. `t1_ping` .. `t7_cli_mail`.
    pub test_id: String,
    pub passed: bool,
    /// The test was not run (e.g. the push test without `--allow-push`). A
    /// skip is `passed: false, skipped: true`, so a surface can tell "not
    /// run" from "failed". Absent on the wire reads as `false`.
    #[serde(default)]
    pub skipped: bool,
    pub detail: Option<String>,
    pub at_ms: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verb_payload_is_tagged_with_camel_case_fields() {
        let v = MeshVerbPayload::PersonaSetEnabled {
            persona_id: "p1".into(),
            enabled: false,
        };
        assert_eq!(
            serde_json::to_value(&v).expect("serializes"),
            serde_json::json!({ "verb": "persona_set_enabled", "personaId": "p1", "enabled": false })
        );
        assert_eq!(
            serde_json::to_value(MeshVerbPayload::Ping).expect("serializes"),
            serde_json::json!({ "verb": "ping" })
        );
        let back: MeshVerbPayload = serde_json::from_value(
            serde_json::json!({ "verb": "queue_reorder", "sessionIds": ["a", "b"] }),
        )
        .expect("parses");
        assert_eq!(back.verb(), "queue_reorder");
    }

    #[test]
    fn verb_tokens_match_the_serde_tag() {
        let all = [
            MeshVerbPayload::Ping,
            MeshVerbPayload::PersonaSetEnabled {
                persona_id: String::new(),
                enabled: true,
            },
            MeshVerbPayload::ProjectSetEnabled {
                project_id: String::new(),
                enabled: true,
            },
            MeshVerbPayload::QueueReorder {
                session_ids: vec![],
            },
            MeshVerbPayload::QueueCancel {
                session_id: String::new(),
            },
            MeshVerbPayload::QueueStartNow {
                session_id: String::new(),
            },
        ];
        for v in all {
            let tag = serde_json::to_value(&v).expect("serializes")["verb"].clone();
            assert_eq!(tag, serde_json::json!(v.verb()));
        }
    }
}
