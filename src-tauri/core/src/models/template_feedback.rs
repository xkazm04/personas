use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Labels that can be applied to template feedback.
/// This is the single source of truth — the TypeScript type is auto-generated via ts-rs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackLabel {
    AccuratePrompt,
    GoodToolSelection,
    Reliable,
    CostEfficient,
    WrongTools,
    PoorInstructions,
    MissingContext,
    OverEngineered,
    UnderSpecified,
    WrongTriggers,
    CredentialIssues,
}

impl FeedbackLabel {
    /// All defined label variants, for iteration or display.
    pub const ALL: &'static [FeedbackLabel] = &[
        FeedbackLabel::AccuratePrompt,
        FeedbackLabel::GoodToolSelection,
        FeedbackLabel::Reliable,
        FeedbackLabel::CostEfficient,
        FeedbackLabel::WrongTools,
        FeedbackLabel::PoorInstructions,
        FeedbackLabel::MissingContext,
        FeedbackLabel::OverEngineered,
        FeedbackLabel::UnderSpecified,
        FeedbackLabel::WrongTriggers,
        FeedbackLabel::CredentialIssues,
    ];
}

/// Rating sentiment for template feedback.
/// This is the single source of truth — the TypeScript type is auto-generated via ts-rs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackRating {
    Positive,
    Negative,
    Neutral,
}

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
    /// False when one or more metric sub-queries failed and defaults were substituted.
    /// The frontend should show an error/empty state instead of the derived score.
    pub data_available: bool,
}

/// Input for creating template feedback.
pub struct CreateTemplateFeedbackInput {
    pub review_id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub rating: FeedbackRating,
    pub labels: Vec<FeedbackLabel>,
    pub comment: Option<String>,
    pub source: String,
}
