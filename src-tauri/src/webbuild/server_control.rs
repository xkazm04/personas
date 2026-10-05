//! Server control: the operator's dev projects as runnable dev servers.
//!
//! A project is in the Server control view when its `dev_port` is set
//! (`e59_dev_servers`). Personas can start, stop and restart its dev server,
//! adopts one started elsewhere as `external`, and keeps the ones it started
//! alive across an app restart (`dev_server_runs`, re-adopted on boot).
//!
//! Every spawn goes through [`super::devserver::DevServerRegistry`], the one
//! spawn door Studio's previews also use. The contract is frozen in the spark
//! brief (`server-control`); the wire names below are part of it.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where a project's dev server stands. Derived by the supervisor on every
/// tick; the frontend only reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DevServerState {
    /// In the view (`dev_port` set) but no `dev_command` yet.
    Unconfigured,
    Stopped,
    /// The one-shot repo scan is running.
    Scanning,
    /// Spawned by Personas, not yet answering HTTP (at most 120 s).
    Starting,
    Running,
    Stopping,
    /// The port is held by a process Personas did not start.
    External,
    /// Spawn error, early exit, no HTTP within 120 s, or a failed scan.
    Failed,
}

/// One row of the Server control view: a dev project plus its live server.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevServerView {
    pub project_id: String,
    pub project_name: String,
    pub root_path: String,
    pub workspace_id: Option<String>,
    /// Comma-separated, the `DevProject.tech_stack` convention.
    pub tech_stack: Option<String>,
    pub dev_command: Option<String>,
    pub dev_port: u16,
    pub state: DevServerState,
    /// Root pid of a server Personas started or re-adopted.
    pub pid: Option<u32>,
    /// Owner of the LISTEN socket on `dev_port` when it is not ours.
    pub external_pid: Option<u32>,
    /// Unix epoch seconds the server started. A stamp, not an uptime, so an
    /// idle server never changes the view and never emits an event.
    #[ts(type = "number | null")]
    pub started_at: Option<i64>,
    /// `http://localhost:<dev_port>`.
    pub url: String,
    /// Why the state is `failed`; `None` otherwise.
    pub error: Option<String>,
}
