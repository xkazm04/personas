use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct N8nPersonaOutput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<serde_json::Value>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub notification_channels: Option<String>,
    // Entity fields — populated by connector-aware transform
    pub triggers: Option<Vec<N8nTriggerDraft>>,
    pub tools: Option<Vec<N8nToolDraft>>,
    pub required_connectors: Option<Vec<N8nConnectorRef>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct N8nTriggerDraft {
    pub trigger_type: String,
    pub config: Option<serde_json::Value>,
    pub description: Option<String>,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct N8nToolDraft {
    pub name: String,
    pub category: String,
    pub description: String,
    pub requires_credential_type: Option<String>,
    pub input_schema: Option<serde_json::Value>,
    pub implementation_guide: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct N8nConnectorRef {
    pub name: String,
    pub n8n_credential_type: String,
    pub has_credential: bool,
}

pub fn normalize_n8n_persona_draft(mut draft: N8nPersonaOutput, workflow_name: &str) -> N8nPersonaOutput {
    if draft.name.as_deref().unwrap_or("").trim().is_empty() {
        draft.name = Some(format!("{} (n8n)", workflow_name.trim()));
    }
    if draft.color.as_deref().unwrap_or("").trim().is_empty() {
        draft.color = Some("#8b5cf6".into());
    }
    if draft.icon.as_deref().unwrap_or("").trim().is_empty() {
        draft.icon = Some("Sparkles".into());
    }
    draft
}
