use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Groups (Workspace Containers)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub collapsed: bool,
    /// Workspace description
    pub description: Option<String>,
    /// JSON-encoded ModelProfile — group-level default model
    pub default_model_profile: Option<String>,
    /// Group-level default budget cap (USD)
    pub default_max_budget_usd: Option<f64>,
    /// Group-level default turn limit
    pub default_max_turns: Option<i32>,
    /// Shared instructions appended to every persona prompt in this workspace
    pub shared_instructions: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreatePersonaGroupInput {
    pub name: String,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePersonaGroupInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
    pub collapsed: Option<bool>,
    pub description: Option<String>,
    pub default_model_profile: Option<String>,
    pub default_max_budget_usd: Option<f64>,
    pub default_max_turns: Option<i32>,
    pub shared_instructions: Option<String>,
}
