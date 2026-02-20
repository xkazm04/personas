use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Triggers
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTrigger {
    pub id: String,
    pub persona_id: String,
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: bool,
    pub last_triggered_at: Option<String>,
    pub next_trigger_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTriggerInput {
    pub persona_id: String,
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTriggerInput {
    pub trigger_type: Option<String>,
    pub config: Option<String>,
    pub enabled: Option<bool>,
    pub next_trigger_at: Option<Option<String>>,
}
