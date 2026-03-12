use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A cached credential recipe capturing AI-discovered knowledge about a connector's
/// credential setup. Populated by the Design path on success; consumed by Negotiator
/// and AutoCred to skip redundant AI discovery calls.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialRecipe {
    pub id: String,
    /// Connector name (e.g. "github", "slack") -- unique key for lookup.
    pub connector_name: String,
    /// Display label (e.g. "GitHub", "Slack").
    pub connector_label: String,
    /// Connector category (e.g. "dev_tools", "communication").
    pub category: String,
    /// Brand color hex.
    pub color: String,
    /// OAuth provider ID if applicable, null for API key auth.
    pub oauth_type: Option<String>,
    /// JSON-serialized array of credential field definitions.
    pub fields_json: String,
    /// JSON-serialized healthcheck endpoint config, or null.
    pub healthcheck_json: Option<String>,
    /// Markdown setup instructions discovered by AI.
    pub setup_instructions: Option<String>,
    /// One-line summary of what the connector does.
    pub summary: Option<String>,
    /// Docs URL extracted from setup instructions.
    pub docs_url: Option<String>,
    /// Which path populated this recipe: "design", "negotiator", "autocred".
    pub source: String,
    #[ts(type = "number")]
    pub usage_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating a credential recipe.
pub struct CreateCredentialRecipeInput {
    pub connector_name: String,
    pub connector_label: String,
    pub category: String,
    pub color: String,
    pub oauth_type: Option<String>,
    pub fields_json: String,
    pub healthcheck_json: Option<String>,
    pub setup_instructions: Option<String>,
    pub summary: Option<String>,
    pub docs_url: Option<String>,
    pub source: String,
}
