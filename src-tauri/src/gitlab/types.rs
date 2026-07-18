use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Config / Connection
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabConfig {
    pub base_url: String,
    pub is_connected: bool,
    pub username: String,
}

// ============================================================================
// GitLab API response types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabUser {
    pub id: i64,
    pub username: String,
    pub name: String,
    #[serde(alias = "avatar_url")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabProject {
    pub id: i64,
    #[serde(alias = "name")]
    pub name: String,
    #[serde(alias = "path_with_namespace")]
    pub path_with_namespace: String,
    #[serde(alias = "web_url")]
    pub web_url: String,
    #[serde(alias = "default_branch")]
    pub default_branch: Option<String>,
}

// ============================================================================
// Duo Agent types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabAgentDefinition {
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub model: Option<String>,
    pub tools: Vec<GitLabAgentTool>,
    #[ts(type = "Record<string, unknown> | null")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabAgentTool {
    pub name: String,
    pub description: String,
    #[ts(type = "Record<string, unknown> | null")]
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabAgent {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(alias = "web_url")]
    pub web_url: Option<String>,
}

/// Honest, probe-derived lifecycle status for a single GitLab deployment.
///
/// Unlike the raw agent list (which returns rows only for live Duo agents and
/// carries no lifecycle field), this reconciles the LIVE `list_duo_agents`
/// registry against `deployment_history` so the dashboard can show a truthful
/// state per deployment instead of a green `active` by construction:
///
/// - `active`     — a live Duo Agent definition is currently registered in
///                  GitLab (confirmed present via the API on this probe).
/// - `file-based` — deployed via the AGENTS.md fallback, i.e. no live Duo
///                  agent exists. A distinct honest state, previously invisible.
/// - `failed`     — a deploy recorded an `agent_id` (was a live Duo agent) but
///                  that agent is no longer in the live registry (removed/gone).
/// - `unknown`    — the GitLab API probe could not confirm live state
///                  (unreachable / errored / Duo API unavailable). Never a
///                  false green.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabDeploymentStatus {
    /// Live Duo Agent id when this deployment is a live agent; `None` for
    /// file-based deploys or when the live agent is gone.
    pub agent_id: Option<String>,
    /// Owning persona id, resolved from history when available.
    pub persona_id: Option<String>,
    /// Persona / agent display name.
    pub persona_name: String,
    /// Deploy method: `"api"` (live Duo agent) or `"agents_md"` (file fallback).
    pub method: String,
    /// Deep link to the agent or AGENTS.md file.
    pub web_url: Option<String>,
    /// Honest lifecycle token: `active` | `file-based` | `failed` | `unknown`.
    pub status: String,
    /// ISO8601 timestamp of the deploy (from history) or agent creation.
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabDeployResult {
    pub agent_id: Option<String>,
    pub web_url: Option<String>,
    /// "api" if deployed via Duo Agent API, "agents_md" if via AGENTS.md file
    pub method: String,
    /// Number of credentials provisioned as CI/CD variables (0 if not requested)
    pub credentials_provisioned: u32,
    /// For versioned deploys: whether the version tag was successfully created.
    /// `false` here while `agent_id`/`web_url` are populated means the deploy
    /// landed but tagging failed — the version trail has a gap and a later
    /// rollback has no tag to target, so the UI must surface this. Always
    /// `false` for non-versioned deploys and rollbacks (which track their own
    /// tag via `GitLabRollbackResult.new_tag`).
    pub tag_created: bool,
    /// The version number the tag was created with, when `tag_created` is true.
    pub version: Option<u32>,
}

// ============================================================================
// CI/CD Variable types (for credential provisioning)
// ============================================================================

/// A GitLab project-level CI/CD variable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabVariable {
    pub key: String,
    pub value: String,
    pub masked: bool,
    pub protected: bool,
    pub variable_type: String,
}

/// Summary of a single credential that was provisioned as CI/CD variable(s).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CredentialProvisionEntry {
    /// Env var name pushed to GitLab (value is never included)
    pub env_var_name: String,
    /// Human-readable source label (e.g. "OpenAI credential 'prod-key'")
    pub source_label: String,
}

// ============================================================================
// GitOps Versioning types
// ============================================================================

/// A git tag representing a persona version deployed to GitLab.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabPersonaVersion {
    /// Tag name (e.g. "persona/my-agent/v3")
    pub tag_name: String,
    /// Short version label extracted from tag (e.g. "v3")
    pub version: String,
    /// Persona name extracted from tag
    pub persona_name: String,
    /// Commit SHA the tag points to
    pub commit_sha: String,
    /// Commit message
    pub commit_message: Option<String>,
    /// ISO8601 timestamp when the tag was created
    pub created_at: Option<String>,
    /// Who created the tag
    pub created_by: Option<String>,
    /// Whether this is the currently deployed version
    pub is_current: bool,
    /// Environment branch the tag belongs to (dev/staging/production)
    pub environment: Option<String>,
}

/// Result from a rollback operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabRollbackResult {
    /// The tag that was rolled back to
    pub rolled_back_to: String,
    /// New tag created for the rollback
    pub new_tag: Option<String>,
    /// Deploy result from redeploying the old version
    pub deploy_result: GitLabDeployResult,
}

/// A git branch used for persona environment promotion.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabPersonaBranch {
    /// Branch name (e.g. "persona/my-agent/production")
    pub name: String,
    /// Latest commit SHA on the branch
    pub commit_sha: String,
    /// Commit message
    pub commit_message: Option<String>,
    /// Whether the branch is protected
    pub is_protected: bool,
    /// Environment label derived from branch name
    pub environment: String,
}

/// A git tag from GitLab API (internal — not exposed to frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabTag {
    pub name: String,
    pub message: Option<String>,
    pub target: Option<String>,
    pub commit: Option<GitLabTagCommit>,
}

/// Internal — not exposed to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabTagCommit {
    pub id: String,
    pub message: Option<String>,
    #[serde(alias = "authored_date")]
    pub authored_date: Option<String>,
    #[serde(alias = "author_name")]
    pub author_name: Option<String>,
}

// ============================================================================
// Deployment History types
// ============================================================================

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
    pub created_at: String,
}

/// A git branch from GitLab API (internal — not exposed to frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabBranch {
    pub name: String,
    pub commit: Option<GitLabBranchCommit>,
    #[serde(default, alias = "protected")]
    pub protected: bool,
}

/// Internal — not exposed to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabBranchCommit {
    pub id: String,
    pub message: Option<String>,
}
