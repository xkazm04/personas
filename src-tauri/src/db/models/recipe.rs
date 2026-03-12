use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Recipe Definitions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeDefinition {
    pub id: String,
    pub project_id: String,
    pub credential_id: Option<String>,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub output_contract: Option<String>,
    pub tool_requirements: Option<String>,
    pub credential_requirements: Option<String>,
    pub model_preference: Option<String>,
    pub sample_inputs: Option<String>,
    pub tags: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateRecipeInput {
    pub credential_id: Option<String>,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub output_contract: Option<String>,
    pub tool_requirements: Option<String>,
    pub credential_requirements: Option<String>,
    pub model_preference: Option<String>,
    pub sample_inputs: Option<String>,
    pub tags: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateRecipeInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub prompt_template: Option<String>,
    pub input_schema: Option<String>,
    pub output_contract: Option<String>,
    pub tool_requirements: Option<String>,
    pub credential_requirements: Option<String>,
    pub model_preference: Option<String>,
    pub sample_inputs: Option<String>,
    pub tags: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

// ============================================================================
// Persona <-> Recipe Links
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaRecipeLink {
    pub id: String,
    pub persona_id: String,
    pub recipe_id: String,
    pub sort_order: i32,
    pub config: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaRecipeLinkInput {
    pub persona_id: String,
    pub recipe_id: String,
    pub sort_order: Option<i32>,
    pub config: Option<String>,
}

// ============================================================================
// Recipe Generation (from description)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GenerateRecipeDraftInput {
    pub credential_id: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeDraft {
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub tags: Option<String>,
    pub example_result: Option<String>,
    pub sample_inputs: Option<String>,
}

// ============================================================================
// Recipe Execution (Test Runner)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeExecutionInput {
    pub recipe_id: String,
    pub input_data: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeExecutionResult {
    pub recipe_id: String,
    pub recipe_name: String,
    pub rendered_prompt: String,
    pub llm_output: Option<String>,
    pub input_data: std::collections::HashMap<String, serde_json::Value>,
    pub executed_at: String,
}

// ============================================================================
// Recipe Versions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeVersion {
    pub id: String,
    pub recipe_id: String,
    pub version_number: i32,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub sample_inputs: Option<String>,
    pub description: Option<String>,
    pub changes_summary: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeVersionDraft {
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub sample_inputs: Option<String>,
    pub description: Option<String>,
    pub changes_summary: Option<String>,
}
