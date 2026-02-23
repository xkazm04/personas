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
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitLabProject {
    pub id: i64,
    #[serde(alias = "name")]
    pub name: String,
    pub path_with_namespace: String,
    pub web_url: String,
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
    pub created_at: Option<String>,
    pub web_url: Option<String>,
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
