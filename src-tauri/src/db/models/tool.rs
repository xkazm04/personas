use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Tool Definitions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaToolDefinition {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub script_path: String,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub requires_credential_type: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateToolDefinitionInput {
    pub name: String,
    pub category: String,
    pub description: String,
    pub script_path: String,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub requires_credential_type: Option<String>,
    pub is_builtin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateToolDefinitionInput {
    pub name: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub script_path: Option<String>,
    pub input_schema: Option<Option<String>>,
    pub output_schema: Option<Option<String>>,
    pub requires_credential_type: Option<Option<String>>,
}

// ============================================================================
// Persona Tools (assignments)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTool {
    pub id: String,
    pub persona_id: String,
    pub tool_id: String,
    pub tool_config: Option<String>,
    pub created_at: String,
}
