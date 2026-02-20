use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Budget Alert Rules
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BudgetAlertRule {
    pub id: String,
    pub persona_id: Option<String>,
    pub rule_type: String,
    pub threshold_usd: f64,
    pub enabled: bool,
    pub created_at: String,
}
