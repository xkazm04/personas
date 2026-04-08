use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Connector Definitions
// ============================================================================

/// LLM-facing usage hint for a connector.
///
/// This is injected into the runtime system prompt (see `engine/prompt.rs`)
/// so the agent knows how to use the connector without burning tokens on
/// exploratory calls. Lives in `metadata.llm_usage_hint` inside each connector
/// JSON (`scripts/connectors/builtin/*.json`). Field budget: aim for
/// ~200-500 tokens per connector.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LlmUsageHint {
    /// One-paragraph description of what this connector exposes at runtime.
    /// Example: "GitHub REST API v3 -- repositories, issues, PRs, releases.
    /// Auth via PAT in $GITHUB_TOKEN."
    pub overview: String,
    /// 3-5 example tool calls with realistic params. Each is a curl/cli
    /// snippet the agent can adapt.
    pub examples: Vec<String>,
    /// Common gotchas or non-obvious behaviors.
    /// Example: "Pagination defaults to 30 items; use ?per_page=100."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gotchas: Option<Vec<String>>,
}

/// Partial deserialization target for the `metadata` JSON blob on a connector.
/// Only fields that are relevant to runtime prompt assembly are listed here;
/// the rest of the metadata remains untyped.
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectorMetadataPartial {
    #[serde(default)]
    pub llm_usage_hint: Option<LlmUsageHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectorDefinition {
    pub id: String,
    pub name: String,
    pub label: String,
    pub icon_url: Option<String>,
    pub color: String,
    pub category: String,
    pub fields: String,
    pub healthcheck_config: Option<String>,
    pub services: String,
    pub events: String,
    pub metadata: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateConnectorDefinitionInput {
    pub name: String,
    pub label: String,
    pub icon_url: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub fields: String,
    pub healthcheck_config: Option<String>,
    pub services: Option<String>,
    pub events: Option<String>,
    pub metadata: Option<String>,
    pub is_builtin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateConnectorDefinitionInput {
    pub name: Option<String>,
    pub label: Option<String>,
    pub icon_url: Option<Option<String>>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub fields: Option<String>,
    pub healthcheck_config: Option<Option<String>>,
    pub services: Option<String>,
    pub events: Option<String>,
    pub metadata: Option<Option<String>>,
}
