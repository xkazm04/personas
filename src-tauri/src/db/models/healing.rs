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

// ============================================================================
// Healing Knowledge Base (fleet-wide failure patterns)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HealingKnowledge {
    pub id: String,
    pub service_type: String,
    pub pattern_key: String,
    pub description: String,
    #[ts(type = "number | null")]
    pub recommended_delay_secs: Option<i64>,
    #[ts(type = "number")]
    pub occurrence_count: i64,
    pub last_seen_at: String,
    pub created_at: String,
}
