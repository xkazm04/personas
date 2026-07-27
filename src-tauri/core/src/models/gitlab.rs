//! Row shapes for the GitLab integration's persisted tables.
//!
//! Only the *stored* shapes live here — the API request/response types stay in
//! the desktop crate's `gitlab` module. The split follows the crate boundary:
//! `db::repos::resources::deployment_history` reads and writes this record, and
//! the repo layer cannot depend on an integration module above it.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A record of a deployment action for auditability and rollback.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabDeploymentRecord {
    pub id: String,
    pub persona_id: String,
    pub persona_name: String,
    pub project_id: i64,
    /// "api" or "agents_md"
    pub method: String,
    pub credentials_provisioned: u32,
    /// "success" or "failed"
    pub deploy_result: String,
    pub agent_id: Option<String>,
    pub web_url: Option<String>,
    /// Snapshot of the system prompt at deploy time
    pub snapshot_prompt: Option<String>,
    /// If this was a rollback, the ID of the deployment it rolled back from
    pub rolled_back_from: Option<String>,
    /// Deploy target: "gitlab" (Duo agent / AGENTS.md) or "cloud" (Personas
    /// Cloud managed endpoint). Lets the unified audit trail mix both sources.
    pub target: String,
    pub created_at: String,
}
