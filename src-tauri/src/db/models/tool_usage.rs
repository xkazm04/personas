use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Tool Usage Analytics
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaToolUsage {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub tool_name: String,
    pub invocation_count: i32,
    pub created_at: String,
}
