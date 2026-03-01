use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single knowledge entry extracted from execution history.
/// Accumulates structured intelligence about tool sequences, failure patterns,
/// cost-quality tradeoffs, data flows, and model performance.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionKnowledge {
    pub id: String,
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub knowledge_type: String,
    pub pattern_key: String,
    pub pattern_data: String,
    #[ts(type = "number")]
    pub success_count: i64,
    #[ts(type = "number")]
    pub failure_count: i64,
    pub avg_cost_usd: f64,
    pub avg_duration_ms: f64,
    pub confidence: f64,
    pub last_execution_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Dashboard summary of the knowledge graph for a persona or globally.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct KnowledgeGraphSummary {
    #[ts(type = "number")]
    pub total_entries: i64,
    #[ts(type = "number")]
    pub tool_sequence_count: i64,
    #[ts(type = "number")]
    pub failure_pattern_count: i64,
    #[ts(type = "number")]
    pub model_performance_count: i64,
    pub top_patterns: Vec<ExecutionKnowledge>,
    pub recent_learnings: Vec<ExecutionKnowledge>,
}
