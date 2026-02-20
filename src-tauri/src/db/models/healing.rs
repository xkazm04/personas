use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Healing Issues
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaHealingIssue {
    pub id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: String,
    pub description: String,
    pub severity: String,
    pub category: String,
    pub suggested_fix: Option<String>,
    pub auto_fixed: bool,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}
