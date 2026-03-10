use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Feedback entry linking a template (design review) to its real-world performance.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateFeedback {
    pub id: String,
    pub review_id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub rating: String,
    pub labels: String,
    pub comment: Option<String>,
    pub source: String,
    pub created_at: String,
}

/// Aggregated performance metrics for a template.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplatePerformance {
    pub review_id: String,
    #[ts(type = "number")]
    pub total_adoptions: i64,
    #[ts(type = "number")]
    pub total_executions: i64,
    pub success_rate: f64,
    pub avg_cost_usd: f64,
    #[ts(type = "number")]
    pub positive_count: i64,
    #[ts(type = "number")]
    pub negative_count: i64,
    pub top_positive_labels: Vec<String>,
    pub top_negative_labels: Vec<String>,
    pub derived_quality_score: f64,
}

/// Input for creating template feedback.
pub struct CreateTemplateFeedbackInput {
    pub review_id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub rating: String,
    pub labels: Vec<String>,
    pub comment: Option<String>,
    pub source: String,
}
