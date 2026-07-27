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

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ToolUsageSummary {
    pub tool_name: String,
    pub total_invocations: i64,
    pub unique_executions: i64,
    pub unique_personas: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ToolUsageOverTime {
    pub date: String,
    pub tool_name: String,
    pub invocations: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct PersonaUsageSummary {
    pub persona_id: String,
    pub persona_name: String,
    pub persona_icon: Option<String>,
    pub persona_color: Option<String>,
    pub total_invocations: i64,
    pub unique_tools: i64,
}
