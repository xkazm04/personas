//! System-operation automations.
//!
//! A `SystemOpAutomation` binds a trigger (a `schedule` cron or an `event`
//! listener) to a built-in **system operation** — a callable backend action
//! that is NOT a persona execution (the first one being a dev-tools context-map
//! scan). It is the persisted shape the Chain Studio commits when a route runs
//! `schedule|event → System event`, and what the Context Map "Plan update"
//! button creates. Distinct from `persona_triggers` (which always run a
//! persona); the action here is a registered system op identified by `op_kind`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A persisted trigger → system-operation automation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SystemOpAutomation {
    pub id: String,
    /// Registered operation key (e.g. `"context_scan"`).
    pub op_kind: String,
    /// JSON-encoded op params (e.g. `{"projectId":"…","deltaMode":true}`).
    pub params_json: String,
    /// `"schedule"` (cron) | `"event"` (event-bus listener).
    pub trigger_kind: String,
    /// Cron expression — set when `trigger_kind == "schedule"`.
    pub cron: Option<String>,
    /// Optional IANA timezone for the cron.
    pub timezone: Option<String>,
    /// Event type to listen for — set when `trigger_kind == "event"`.
    pub listen_event_type: Option<String>,
    /// Optional wildcard filter on the event `source_id`.
    pub source_filter: Option<String>,
    pub enabled: bool,
    /// Next computed fire time (schedule kind only).
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    /// `"ok"` | `"failed"` | `"running"`.
    pub last_status: Option<String>,
    /// Short human detail of the last run (e.g. a scan id or error).
    pub last_detail: Option<String>,
    /// Optional user-facing label.
    pub label: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Catalog entry describing one available system operation. Drives the Chain
/// Studio "System events" rail (the right-hand targets).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SystemOpKindMeta {
    /// Stable key matching `SystemOpAutomation.op_kind`.
    pub kind: String,
    pub label: String,
    pub description: String,
    /// True when the op is scoped to a single dev-tools project (needs a
    /// `projectId` param). The Studio prompts for the project on commit.
    pub requires_project: bool,
}
