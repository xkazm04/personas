use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Skill Component Type
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SkillComponentType {
    Tool,
    TriggerTemplate,
    CredentialSchema,
}

impl SkillComponentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Tool => "tool",
            Self::TriggerTemplate => "trigger_template",
            Self::CredentialSchema => "credential_schema",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "tool" => Ok(Self::Tool),
            "trigger_template" => Ok(Self::TriggerTemplate),
            "credential_schema" => Ok(Self::CredentialSchema),
            other => Err(format!("Invalid component type: {other}")),
        }
    }
}

// ============================================================================
// Skill
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkillInput {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_builtin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSkillInput {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<Option<String>>,
    pub category: Option<Option<String>>,
}

// ============================================================================
// Skill Component
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillComponent {
    pub id: String,
    pub skill_id: String,
    pub component_type: SkillComponentType,
    pub component_data: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkillComponentInput {
    pub component_type: SkillComponentType,
    pub component_data: String,
}

// ============================================================================
// Persona Skill (assignment)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaSkill {
    pub id: String,
    pub persona_id: String,
    pub skill_id: String,
    pub enabled: bool,
    pub config: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Skill With Components (composite view)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillWithComponents {
    #[serde(flatten)]
    pub skill: Skill,
    pub components: Vec<SkillComponent>,
}
