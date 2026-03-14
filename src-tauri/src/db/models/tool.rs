use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Tool Definitions
// ============================================================================

/// Determines the execution strategy for a tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    /// Automation-backed tool (category == "automation", id starts with "auto_").
    Automation,
    /// Script-based tool executed via `npx tsx`.
    Script,
    /// API tool with a curl command in its implementation_guide.
    Api,
}

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
    pub implementation_guide: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl PersonaToolDefinition {
    /// Determine the execution strategy for this tool.
    ///
    /// Returns `Ok(ToolKind)` when exactly one strategy applies, or `Err` with
    /// a human-readable message when zero or multiple strategies match.
    pub fn tool_kind(&self) -> Result<ToolKind, String> {
        if self.category == "automation" {
            return Ok(ToolKind::Automation);
        }
        let has_script = !self.script_path.is_empty();
        let has_api = self.implementation_guide.as_ref().is_some_and(|g| !g.is_empty());
        match (has_script, has_api) {
            (true, true) => Err(format!(
                "Tool '{}' has conflicting execution strategies: both script_path and implementation_guide are set. Remove one to resolve ambiguity.",
                self.name
            )),
            (true, false) => Ok(ToolKind::Script),
            (false, true) => Ok(ToolKind::Api),
            (false, false) => Err(format!(
                "Tool '{}' has no execution strategy: no script_path, no implementation_guide, and category is not 'automation'",
                self.name
            )),
        }
    }
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
    pub implementation_guide: Option<String>,
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
    pub implementation_guide: Option<Option<String>>,
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
